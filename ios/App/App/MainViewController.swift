import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MobileCommandQueue())
        bridge?.registerPluginInstance(M3UProxyPlugin())
        bridge?.registerPluginInstance(MobileXmltvEpg())
        bridge?.registerPluginInstance(MobileNativeMedia())
        bridge?.registerPluginInstance(StalkerPortalPlugin())
    }

    open override var prefersStatusBarHidden: Bool {
        MobileNativeMedia.sharedFullscreenActive
    }

    open override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {
        .slide
    }

    open override var prefersHomeIndicatorAutoHidden: Bool {
        MobileNativeMedia.sharedFullscreenActive
    }
}
