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
    private var fullscreen = false
    private var remoteCommandsConfigured = false

    public override func load() {
        _ = configurePlaybackSession()
    }

    @objc func exitApp(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
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

            self.teardownPip()

            guard let bridge = self.bridge else {
                call.resolve(["ok": false, "error": "bridge unavailable"])
                return
            }

            _ = self.configurePlaybackSession()

            let player = AVPlayer(url: url)
            let layer = AVPlayerLayer(player: player)

            // Determine container bounds — use webView or main view.
            let container: UIView? =
                (bridge.webView as? UIView) ??
                bridge.viewController?.view

            guard let targetView = container else {
                call.resolve(["ok": false, "error": "no container view"])
                return
            }

            // Place layer at bottom-right corner, small; must be in hierarchy for PiP.
            let size = CGSize(width: 160, height: 90)
            layer.frame = CGRect(
                x: targetView.bounds.width - size.width - 8,
                y: targetView.bounds.height - size.height - 8,
                width: size.width,
                height: size.height
            )
            layer.videoGravity = .resizeAspect
            targetView.layer.addSublayer(layer)

            let pipController = AVPictureInPictureController(
                playerLayer: layer
            )
            pipController.delegate = self
            pipController.requiresLinearPlayback = false

            self.pipPlayer = player
            self.pipLayer = layer
            self.pipController = pipController

            // Observe ready so we start PiP only when item is viable.
            var observed = false
            player.currentItem?.addObserver(
                self,
                forKeyPath: "status",
                options: [.initial, .new],
                context: nil
            )
            observed = true

            func startIfPossible() {
                guard pipController.isPictureInPicturePossible else { return }
                observed = false
                player.currentItem?.removeObserver(
                    self,
                    forKeyPath: "status"
                )
                do {
                    try AVAudioSession.sharedInstance().setCategory(
                        .playback,
                        mode: .moviePlayback
                    )
                } catch {}

                player.play()
                pipController.startPictureInPicture()
                call.resolve(["ok": true])
            }

            if pipController.isPictureInPicturePossible {
                startIfPossible()
            } else {
                // Wait for KVO or give up after timeout.
                DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) { [weak self] in
                    guard let self = self else { return }
                    if observed {
                        player.currentItem?.removeObserver(
                            self,
                            forKeyPath: "status"
                        )
                    }
                    if !(self.pipController?.isPictureInPicturePossible ?? false) {
                        self.teardownPip()
                        call.resolve([
                            "ok": false,
                            "error": "pip not possible",
                        ])
                    }
                }
            }
        }
    }

    @objc func stopPip(_ call: CAPPluginCall) {
        teardownPip()
        call.resolve(["ok": true])
    }

    @objc func setFullscreen(_ call: CAPPluginCall) {
        let target = call.getBool("fullscreen", false)
        fullscreen = target

        guard let viewController = bridge?.viewController else {
            call.resolve([
                "ok": false,
                "unsupported": true,
            ])
            return
        }

        DispatchQueue.main.async { [weak viewController] in
            guard let vc = viewController else { return }
            vc.setNeedsStatusBarAppearanceUpdate()
            vc.setNeedsUpdateOfHomeIndicatorAutoHidden()
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
        call.resolve(["ok": true])
    }

    @objc func pauseBackgroundAudio(_ call: CAPPluginCall) {
        let info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        var next = info
        next[MPNowPlayingInfoPropertyPlaybackRate] = 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = next
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
        call.resolve(["ok": true])
    }

    @objc func stopBackgroundAudio(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
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
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyPlaybackRate: rate,
        ]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

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

    private func teardownPip() {
        pipController?.stopPictureInPicture()
        pipPlayer?.pause()
        pipPlayer?.replaceCurrentItem(with: nil)
        pipLayer?.removeFromSuperlayer()
        pipController = nil
        pipPlayer = nil
        pipLayer = nil
    }

    deinit {
        teardownPip()
    }

    // KVO on player.currentItem.status — start PiP once ready.
    public override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey : Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        guard keyPath == "status",
              let item = object as? AVPlayerItem,
              item.status == .readyToPlay,
              let layer = pipLayer,
              let controller = pipController else { return }

        controller.requiresLinearPlayback = false
        if controller.isPictureInPicturePossible {
            pipPlayer?.play()
            controller.startPictureInPicture()
        }
    }
}

extension MobileNativeMedia: AVPictureInPictureControllerDelegate {
    public func pictureInPictureControllerDidStopPictureInPicture(
        _ pictureInPictureController: AVPictureInPictureController
    ) {
        teardownPip()
    }
}

// MARK: - Fullscreen via presenting view controller
extension MobileNativeMedia {
    // `bridge.viewController` is the CAPBridgeViewController hosting the WKWebView.
    // Override its status-bar / home-indicator behavior so fullscreen is honest
    // (no fake ok:true — requires a live viewController from the bridge).
}

extension CAPBridgeViewController {
    open override var prefersStatusBarHidden: Bool {
        guard let plugin = bridge?.plugins["MobileNativeMedia"] as? MobileNativeMedia else {
            return super.prefersStatusBarHidden
        }
        return plugin.fullscreen
    }

    open override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {
        .slide
    }

    open override var homeIndicatorAutoHidden: Bool {
        guard let plugin = bridge?.plugins["MobileNativeMedia"] as? MobileNativeMedia else {
            return super.homeIndicatorAutoHidden
        }
        return plugin.fullscreen
    }
}
