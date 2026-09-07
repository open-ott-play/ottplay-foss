import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MobileCommandQueue())
        bridge?.registerPluginInstance(M3UProxyPlugin())
        bridge?.registerPluginInstance(MobileXmltvEpg())
        bridge?.registerPluginInstance(MobileNativeMedia())
    }
}
