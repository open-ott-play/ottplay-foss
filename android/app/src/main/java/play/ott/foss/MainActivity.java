package play.ott.foss;

import android.view.KeyEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int code = event.getKeyCode();
            int jsCode = -1;

            switch (code) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    jsCode = 38;
                    break;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    jsCode = 40;
                    break;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    jsCode = 37;
                    break;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    jsCode = 39;
                    break;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    jsCode = 13;
                    break;
                case KeyEvent.KEYCODE_BACK:
                    jsCode = 27;
                    break;
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                    jsCode = 80;
                    break;
                case KeyEvent.KEYCODE_MEDIA_STOP:
                    jsCode = 83;
                    break;
                case KeyEvent.KEYCODE_VOLUME_UP:
                    jsCode = 175;
                    break;
                case KeyEvent.KEYCODE_VOLUME_DOWN:
                    jsCode = 174;
                    break;
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                    jsCode = 35;
                    break;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                    jsCode = 36;
                    break;
                case KeyEvent.KEYCODE_BUTTON_A:
                case KeyEvent.KEYCODE_BUTTON_SELECT:
                    jsCode = 13; // ENTER
                    break;
                case KeyEvent.KEYCODE_BUTTON_B:
                    jsCode = 27; // EXIT
                    break;
                default:
                    break;
            }

            if (jsCode >= 0) {
                // Only consume when inject succeeded. If bridge/webview is null
                // during early boot, fall through so keys are not swallowed forever.
                if (getBridge() != null) {
                    WebView webView = getBridge().getWebView();
                    if (webView != null) {
                        webView.evaluateJavascript(
                                "window._doKey && window._doKey(" + jsCode + ")",
                                null
                        );
                        return true;
                    }
                }
                return super.dispatchKeyEvent(event);
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
