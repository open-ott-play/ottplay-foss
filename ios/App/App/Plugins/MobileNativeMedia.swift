import Capacitor
import AVFoundation
import AVKit
import MediaPlayer
import WebKit

@objc(MobileNativeMedia)
public class MobileNativeMedia: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MobileNativeMediaPlugin"
    public let jsName = "MobileNativeMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playPip", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPip", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFullscreen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "allowSleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preventSleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startBackgroundAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseBackgroundAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeBackgroundAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopBackgroundAudio", returnType: CAPPluginReturnPromise),
    ]

    private var pipController: AVPictureInPictureController?
    private var pipLayer: AVPlayerLayer?
    private var isFullscreen = false
    private var remoteCommandsConfigured = false
    private var backgroundAudioActive = false

    public override func load() {
        // Configure playback session early so WKWebView HLS/<video> can continue
        // when backgrounded (pairs with Info.plist UIBackgroundModes: audio).
        _ = configurePlaybackSession()
    }

    @objc func getVolume(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(true)
        } catch {
            call.resolve([
                "ok": false,
                "volume": 0,
                "unsupported": true,
            ])
            return
        }

        let vol = Int(round(session.outputVolume * 100))
        call.resolve([
            "ok": true,
            "volume": vol,
        ])
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let volume = call.getInt("volume", 0)
        let clamped = max(0, min(100, volume))
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(true)
        } catch {
            call.resolve([
                "ok": false,
                "volume": clamped,
                "unsupported": true,
            ])
            return
        }

        // `outputVolume` on iOS is read-only without private APIs.
        // Use MPVolumeView as the only public set path; hide it in a zero-size container.
        let picker = MPVolumeView(frame: CGRect(x: -100, y: -100, width: 0, height: 0))
        picker.showsRouteButton = false
        picker.showsVolumeSlider = true

        guard let slider = picker.subviews.compactMap({ $0 as? UISlider }).first else {
            call.resolve([
                "ok": false,
                "volume": clamped,
                "unsupported": true,
            ])
            return
        }

        // Post to main run loop so the slider actually drives the system volume.
        DispatchQueue.main.async {
            slider.value = Float(clamped) / 100.0
            call.resolve([
                "ok": true,
                "volume": clamped,
            ])
        }
    }

    @objc func playPip(_ call: CAPPluginCall) {
        // Honest unsupported until a real AVPlayer (with media item) is wired.
        // Empty AVPlayer(playerItem: nil) PiP is fake and must not report ok:true.
        guard AVPictureInPictureController.isPictureInPictureSupported() else {
            call.resolve([
                "ok": false,
                "unsupported": true,
            ])
            return
        }
        call.resolve([
            "ok": false,
            "unsupported": true,
        ])
    }

    @objc func stopPip(_ call: CAPPluginCall) {
        pipController?.stopPictureInPicture()
        pipLayer?.removeFromSuperlayer()
        pipLayer = nil
        pipController = nil
        call.resolve([
            "ok": true,
        ])
    }

    @objc func setFullscreen(_ call: CAPPluginCall) {
        let fullscreen = call.getBool("fullscreen", false)
        isFullscreen = fullscreen
        // Honest unsupported until real UIKit video chrome exists.
        // Do not fake ok:true with an empty body.
        call.resolve([
            "ok": false,
            "unsupported": true,
        ])
    }

    @objc func allowSleep(_ call: CAPPluginCall) {
        UIApplication.shared.isIdleTimerDisabled = false
        call.resolve([
            "ok": true,
        ])
    }

    @objc func preventSleep(_ call: CAPPluginCall) {
        UIApplication.shared.isIdleTimerDisabled = true
        call.resolve([
            "ok": true,
        ])
    }

    /// Activate AVAudioSession category `.playback` and publish Now Playing metadata
    /// so WKWebView video audio can continue in background (UIBackgroundModes: audio).
    @objc func startBackgroundAudio(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "OTT-play FOSS"
        let artist = call.getString("artist") ?? "Now playing"

        guard configurePlaybackSession() else {
            call.resolve([
                "ok": false,
                "error": "AVAudioSession setCategory/setActive failed",
            ])
            return
        }

        configureRemoteCommandsIfNeeded()
        updateNowPlaying(title: title, artist: artist, rate: 1.0)
        backgroundAudioActive = true
        call.resolve([
            "ok": true,
        ])
    }

    @objc func pauseBackgroundAudio(_ call: CAPPluginCall) {
        if backgroundAudioActive {
            let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            var next = info
            next[MPNowPlayingInfoPropertyPlaybackRate] = 0.0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = next
        }
        call.resolve([
            "ok": true,
        ])
    }

    @objc func resumeBackgroundAudio(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "OTT-play FOSS"
        let artist = call.getString("artist") ?? "Now playing"
        guard configurePlaybackSession() else {
            call.resolve([
                "ok": false,
                "error": "AVAudioSession setCategory/setActive failed",
            ])
            return
        }
        configureRemoteCommandsIfNeeded()
        updateNowPlaying(title: title, artist: artist, rate: 1.0)
        backgroundAudioActive = true
        call.resolve([
            "ok": true,
        ])
    }

    @objc func stopBackgroundAudio(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        backgroundAudioActive = false
        // Keep session category as playback for the next channel; do not deactivate
        // aggressively (other Cap audio paths may still need the session).
        call.resolve([
            "ok": true,
        ])
    }

    private func configurePlaybackSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playback,
                mode: .moviePlayback,
                options: [.allowAirPlay, .allowBluetoothA2DP]
            )
            try session.setActive(true, options: [])
            return true
        } catch {
            return false
        }
    }

    private func updateNowPlaying(title: String, artist: String, rate: Double) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyPlaybackRate: rate,
        ]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// Best-effort lock-screen play/pause → WKWebView `<video>` via evaluateJavaScript.
    /// Not a native AVPlayer pipeline; documented as limited / follow-up for richer controls.
    private func configureRemoteCommandsIfNeeded() {
        if remoteCommandsConfigured { return }
        remoteCommandsConfigured = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.stopCommand.isEnabled = true

        center.playCommand.addTarget { [weak self] _ in
            self?.evalVideoJS("var v=document.querySelector('video'); if(v){v.play();} true;")
            self?.updateNowPlayingRate(1.0)
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.evalVideoJS("var v=document.querySelector('video'); if(v){v.pause();} true;")
            self?.updateNowPlayingRate(0.0)
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.evalVideoJS(
                "var v=document.querySelector('video'); if(v){ if(v.paused){v.play();} else {v.pause();} } true;"
            )
            return .success
        }
        center.stopCommand.addTarget { [weak self] _ in
            self?.evalVideoJS(
                "var v=document.querySelector('video'); if(v){v.pause(); v.removeAttribute('src'); v.load();} true;"
            )
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            self?.backgroundAudioActive = false
            return .success
        }
    }

    private func updateNowPlayingRate(_ rate: Double) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func evalVideoJS(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            guard let bridge = self?.bridge else { return }
            // Cap bridge webView is a WKWebView subclass.
            if let webView = bridge.webView as? WKWebView {
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
        }
    }

    deinit {
        pipLayer?.removeFromSuperlayer()
        pipController = nil
        pipLayer = nil
    }
}

extension MobileNativeMedia: AVPictureInPictureControllerDelegate {
    public func pictureInPictureControllerDidStopPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        pipLayer?.removeFromSuperlayer()
        pipLayer = nil
        pipController = nil
    }
}
