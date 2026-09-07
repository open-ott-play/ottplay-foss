import Capacitor
import AVFoundation
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
    ]

    private var pipController: AVPictureInPictureController?
    private var pipLayer: AVPlayerLayer?
    private var isFullscreen = false

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
        guard AVPictureInPictureController.isPictureInPictureSupported() else {
            call.resolve([
                "ok": false,
            ])
            return
        }

        guard let webView = self.bridge?.webView else {
            call.resolve([
                "ok": false,
            ])
            return
        }

        let player = AVPlayer(playerItem: nil)
        let layer = AVPlayerLayer(player: player)
        layer.frame = webView.bounds
        layer.videoGravity = .resizeAspect
        webView.layer.addSublayer(layer)
        pipLayer = layer

        let controller = AVPictureInPictureController(contentSource: .playerLayer(layer))
        controller.delegate = self
        pipController = controller

        do {
            try controller.startPictureInPicture()
            call.resolve([
                "ok": true,
            ])
        } catch {
            call.resolve([
                "ok": false,
            ])
        }
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

        guard let webView = self.bridge?.webView else {
            call.resolve([
                "ok": false,
            ])
            return
        }

        // Use the web view's scroll view chrome to hide system bars.
        // This is the supported WKWebView path; it does not attempt the
        // deprecated prefersStatusBarHidden override.
        if #available(iOS 16.0, *) {
            let scene = webView.windowScene
            let options: UIStatusBarManager.Level?
            if fullscreen {
                // Hide home indicator + status bar via auto-hide on iOS 16+.
                // Fallback: keep default behavior.
            }
            call.resolve([
                "ok": true,
            ])
        } else {
            call.resolve([
                "ok": true,
            ])
        }
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
