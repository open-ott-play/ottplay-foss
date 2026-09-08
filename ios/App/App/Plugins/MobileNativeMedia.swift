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
        CAPPluginMethod(name: "exitApp", returnType: CAPPluginReturnPromise),
    ]

    private var pipController: AVPictureInPictureController?
    private var pipPlayer: AVPlayer?
    private var pipLayer: AVPlayerLayer?
    private var pipItemObservation: NSKeyValueObservation?
    private var pipPossibleObservation: NSKeyValueObservation?
    private var pendingPipCall: CAPPluginCall?
    private var pipResolved = false
    private var fullscreenActive = false
    private var remoteCommandsConfigured = false
    private var backgroundAudioActive = false

    /// Shared flag read by MainViewController (avoids Cap bridge plugin-lookup API drift).
    private(set) static var sharedFullscreenActive = false

    /// Read by MainViewController for status-bar / home-indicator chrome.
    var isFullscreenActive: Bool { fullscreenActive }

    public override func load() {
        // Configure playback session early so WKWebView HLS/<video> can continue
        // when backgrounded (pairs with Info.plist UIBackgroundModes: audio).
        _ = configurePlaybackSession()
    }

    @objc func exitApp(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Cap iOS has no Activity.finish; exit(0) matches App.exitApp semantics.
            call.resolve(["ok": true])
            exit(0)
        }
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
        guard let urlString = call.getString("url"), !urlString.isEmpty else {
            call.resolve([
                "ok": false,
                "error": "missing url",
            ])
            return
        }

        guard let url = URL(string: urlString) else {
            call.resolve([
                "ok": false,
                "error": "invalid url",
            ])
            return
        }

        guard AVPictureInPictureController.isPictureInPictureSupported() else {
            call.resolve([
                "ok": false,
                "unsupported": true,
            ])
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            self.teardownPip(keepCall: false)
            self.pendingPipCall = call
            self.pipResolved = false

            guard let bridge = self.bridge else {
                self.resolvePipOnce([
                    "ok": false,
                    "error": "bridge unavailable",
                ])
                return
            }

            _ = self.configurePlaybackSession()

            let player = AVPlayer(url: url)
            let layer = AVPlayerLayer(player: player)

            let container: UIView? =
                (bridge.webView as? UIView) ??
                bridge.viewController?.view

            guard let targetView = container else {
                self.resolvePipOnce([
                    "ok": false,
                    "error": "no container view",
                ])
                return
            }

            // Small 16:9 layer in hierarchy (required for AVPictureInPictureController).
            let size = CGSize(width: 160, height: 90)
            layer.frame = CGRect(
                x: max(8, targetView.bounds.width - size.width - 8),
                y: max(8, targetView.bounds.height - size.height - 8),
                width: size.width,
                height: size.height
            )
            layer.videoGravity = .resizeAspect
            layer.isHidden = false
            targetView.layer.addSublayer(layer)

            guard let pipController = AVPictureInPictureController(playerLayer: layer) else {
                layer.removeFromSuperlayer()
                self.resolvePipOnce([
                    "ok": false,
                    "error": "pip controller unavailable",
                ])
                return
            }
            pipController.delegate = self
            if #available(iOS 14.0, *) {
                pipController.requiresLinearPlayback = false
            }
            if #available(iOS 14.2, *) {
                pipController.canStartPictureInPictureAutomaticallyFromInline = true
            }

            self.pipPlayer = player
            self.pipLayer = layer
            self.pipController = pipController

            player.play()

            // Observe item readiness + pip-possible; hop to main before Cap/UIKit work.
            self.pipItemObservation = player.currentItem?.observe(
                \.status,
                options: [.initial, .new]
            ) { [weak self] item, _ in
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    if item.status == .failed {
                        self.resolvePipOnce([
                            "ok": false,
                            "error": item.error?.localizedDescription ?? "player item failed",
                        ])
                        self.teardownPip(keepCall: true)
                        return
                    }
                    if item.status == .readyToPlay {
                        self.tryStartPip()
                    }
                }
            }

            self.pipPossibleObservation = pipController.observe(
                \.isPictureInPicturePossible,
                options: [.initial, .new]
            ) { [weak self] controller, _ in
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    if controller.isPictureInPicturePossible {
                        self.tryStartPip()
                    }
                }
            }

            // Honest timeout — never leave the Cap call hanging, never fake ok:true.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
                guard let self = self, !self.pipResolved else { return }
                self.resolvePipOnce([
                    "ok": false,
                    "error": "pip not possible",
                ])
                self.teardownPip(keepCall: true)
            }
        }
    }

    @objc func stopPip(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.teardownPip(keepCall: false)
            call.resolve(["ok": true])
        }
    }

    @objc func setFullscreen(_ call: CAPPluginCall) {
        let target = call.getBool("fullscreen", false)
        fullscreenActive = target
        MobileNativeMedia.sharedFullscreenActive = target

        guard let viewController = bridge?.viewController else {
            call.resolve([
                "ok": false,
                "unsupported": true,
            ])
            return
        }

        DispatchQueue.main.async {
            viewController.setNeedsStatusBarAppearanceUpdate()
            if #available(iOS 11.0, *) {
                viewController.setNeedsUpdateOfHomeIndicatorAutoHidden()
            }
            call.resolve(["ok": true])
        }
    }

    @objc func allowSleep(_ call: CAPPluginCall) {
        UIApplication.shared.isIdleTimerDisabled = false
        call.resolve(["ok": true])
    }

    @objc func preventSleep(_ call: CAPPluginCall) {
        UIApplication.shared.isIdleTimerDisabled = true
        call.resolve(["ok": true])
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
        call.resolve(["ok": true])
    }

    @objc func pauseBackgroundAudio(_ call: CAPPluginCall) {
        if backgroundAudioActive {
            let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            var next = info
            next[MPNowPlayingInfoPropertyPlaybackRate] = 0.0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = next
        }
        call.resolve(["ok": true])
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
        call.resolve(["ok": true])
    }

    @objc func stopBackgroundAudio(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        backgroundAudioActive = false
        // Keep session category as playback for the next channel; do not deactivate
        // aggressively (other Cap audio paths may still need the session).
        call.resolve(["ok": true])
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
        let info: [String: Any] = [
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
            if let webView = bridge.webView as? WKWebView {
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
        }
    }

    private func tryStartPip() {
        guard !pipResolved else { return }
        guard let controller = pipController, controller.isPictureInPicturePossible else { return }
        guard let player = pipPlayer, player.currentItem?.status == .readyToPlay else { return }

        _ = configurePlaybackSession()
        player.play()
        // Do not resolve ok:true here — wait for didStart / failedToStart / timeout.
        controller.startPictureInPicture()
    }

    private func resolvePipOnce(_ result: [String: Any]) {
        guard !pipResolved else { return }
        pipResolved = true
        pendingPipCall?.resolve(result)
        pendingPipCall = nil
        pipItemObservation = nil
        pipPossibleObservation = nil
    }

    /// Tear down native PiP resources. When `keepCall` is true, leave pending resolve alone
    /// (caller already resolved or will resolve).
    private func teardownPip(keepCall: Bool) {
        pipItemObservation = nil
        pipPossibleObservation = nil
        if pipController?.isPictureInPictureActive == true {
            pipController?.stopPictureInPicture()
        }
        pipPlayer?.pause()
        pipPlayer?.replaceCurrentItem(with: nil)
        pipLayer?.removeFromSuperlayer()
        pipController = nil
        pipPlayer = nil
        pipLayer = nil
        if !keepCall {
            pendingPipCall = nil
            pipResolved = false
        }
    }

    deinit {
        teardownPip(keepCall: false)
    }
}

extension MobileNativeMedia: AVPictureInPictureControllerDelegate {
    public func pictureInPictureControllerDidStartPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        resolvePipOnce(["ok": true])
    }

    public func pictureInPictureController(
        _ pictureInPictureController: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        resolvePipOnce([
            "ok": false,
            "error": error.localizedDescription,
        ])
        teardownPip(keepCall: true)
    }

    public func pictureInPictureControllerDidStopPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        teardownPip(keepCall: false)
    }
}
