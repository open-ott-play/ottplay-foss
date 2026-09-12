import UIKit
import Capacitor
import CapApp_SPM

class MainViewController: CAPBridgeViewController {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .landscape
    }

    override var shouldAutorotate: Bool {
        true // Allow both landscape directions without enabling portrait.
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MobileCommandQueue())
        bridge?.registerPluginInstance(M3UProxyPlugin())
        bridge?.registerPluginInstance(MobileXmltvEpg())
        bridge?.registerPluginInstance(MobileNativeMedia())
        bridge?.registerPluginInstance(DashExoPlayer())
        bridge?.registerPluginInstance(StalkerPortalPlugin())
    }

    override var prefersStatusBarHidden: Bool {
        MobileNativeMedia.sharedFullscreenActive
    }

    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {
        .slide
    }

    open override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var handled = false
        for press in presses {
            let jsCode: Int?
            switch press.type {
            case .playPause:
                jsCode = 80 // keys.PLAY / keys.PAUSE
            case .menu:
                jsCode = 27 // keys.EXIT (Android BACK parity)
            case .select:
                // Some remotes send select as UIPress without a keydown.
                jsCode = 13 // keys.ENTER
            default:
                jsCode = nil
            }
            if let code = jsCode {
                injectDoKey(code)
                handled = true
            }
        }
        if !handled {
            super.pressesBegan(presses, with: event)
        }
    }

    private func injectDoKey(_ code: Int) {
        bridge?.webView?.evaluateJavaScript(
            "window._doKey && window._doKey(\(code))",
            completionHandler: nil
        )
    }
}
