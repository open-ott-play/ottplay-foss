package play.ott.foss;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import play.ott.foss.plugin.MobileXmltvEpgPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // These local Kotlin plugins are not in Capacitor's generated npm plugin list.
        // BridgeActivity creates the bridge in super.onCreate(), so add them first.
        registerPlugin(MobileNativeMediaPlugin.class);
        registerPlugin(MobileXmltvEpgPlugin.class);
        registerPlugin(M3UProxyPlugin.class);
        registerPlugin(StalkerPortalPlugin.class);
        registerPlugin(MobileCommandQueuePlugin.class);
        registerPlugin(DashExoPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    private static String dispatchKey(String name) {
        return "(function(){if(window._doKey&&window.keys&&typeof window.keys."
                + name + "==='number')window._doKey(window.keys." + name + ");})();";
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int code = event.getKeyCode();
            String script = null;
            boolean mediaAction = false;

            switch (code) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    script = dispatchKey("UP");
                    break;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    script = dispatchKey("DOWN");
                    break;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    script = dispatchKey("LEFT");
                    break;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    script = dispatchKey("RIGHT");
                    break;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    script = dispatchKey("ENTER");
                    break;
                case KeyEvent.KEYCODE_BACK:
                    script = dispatchKey("EXIT");
                    break;
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                    script = "if(window.stbIsPlaying&&window.stbIsPlaying()){if(window.stbPause)window.stbPause();}else if(window.stbContinue)window.stbContinue();";
                    mediaAction = true;
                    break;
                case KeyEvent.KEYCODE_MEDIA_PLAY:
                    script = "if(window.stbContinue&&window.stbIsPlaying&&!window.stbIsPlaying())window.stbContinue();";
                    mediaAction = true;
                    break;
                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                    script = "if(window.stbPause)window.stbPause();";
                    mediaAction = true;
                    break;
                case KeyEvent.KEYCODE_MEDIA_STOP:
                    script = "if(window.stbStop)window.stbStop();";
                    mediaAction = true;
                    break;
                case KeyEvent.KEYCODE_VOLUME_UP:
                    script = dispatchKey("VOL_UP");
                    break;
                case KeyEvent.KEYCODE_VOLUME_DOWN:
                    script = dispatchKey("VOL_DOWN");
                    break;
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                    script = dispatchKey("NEXT");
                    mediaAction = true;
                    break;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                    script = dispatchKey("PREV");
                    mediaAction = true;
                    break;
                case KeyEvent.KEYCODE_BUTTON_A:
                case KeyEvent.KEYCODE_BUTTON_SELECT:
                    script = dispatchKey("ENTER");
                    break;
                case KeyEvent.KEYCODE_BUTTON_B:
                    script = dispatchKey("EXIT");
                    break;
                default:
                    break;
            }

            if (script != null) {
                // Only consume when inject succeeded. If bridge/webview is null
                // during early boot, fall through so keys are not swallowed forever.
                if (getBridge() != null) {
                    WebView webView = getBridge().getWebView();
                    if (webView != null) {
                        // One media action per press; navigation and volume still repeat.
                        if (!mediaAction || event.getRepeatCount() == 0) {
                            webView.evaluateJavascript(script, null);
                        }
                        return true;
                    }
                }
                return super.dispatchKeyEvent(event);
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
