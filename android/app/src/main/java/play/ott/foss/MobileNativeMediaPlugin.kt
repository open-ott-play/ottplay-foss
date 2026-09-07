package play.ott.foss

import android.app.PictureInPictureParams
import android.content.Context
import android.content.Context.AUDIO_SERVICE
import android.media.AudioManager
import android.os.Build
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "MobileNativeMedia")
class MobileNativeMediaPlugin : Plugin() {

    companion object {
        private const val TAG = "MobileNativeMedia"
    }

    private var isFullscreen = false

    @PluginMethod
    fun getVolume(call: PluginCall) {
        val am = bridge.context.getSystemService(AUDIO_SERVICE) as? AudioManager
            ?: run {
                call.resolve(JSObject().apply {
                    put("ok", false)
                    put("volume", 0)
                    put("unsupported", true)
                })
                return
            }

        val cur = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val pct = if (max > 0) (cur * 100 / max) else 0

        call.resolve(JSObject().apply {
            put("ok", true)
            put("volume", pct)
        })
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val volume = call.getInt("volume", 0)
        val clamped = volume.coerceIn(0, 100)

        val am = bridge.context.getSystemService(AUDIO_SERVICE) as? AudioManager
            ?: run {
                call.resolve(JSObject().apply {
                    put("ok", false)
                    put("volume", clamped)
                    put("unsupported", true)
                })
                return
            }

        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val target = (clamped * max / 100).coerceIn(0, max)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)

        call.resolve(JSObject().apply {
            put("ok", true)
            put("volume", clamped)
        })
    }

    @PluginMethod
    fun playPip(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(JSObject().apply { put("ok", false) })
            return
        }

        val activity = bridge.activity
        val webView = bridge.webView ?: run {
            call.resolve(JSObject().apply { put("ok", false) })
            return
        }

        val params = PictureInPictureParams.Builder()
            .setAspectRatio(android.util.Rational(16, 9))
            .build()

        activity.enterPictureInPictureMode(params)
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun stopPip(call: PluginCall) {
        val activity = bridge.activity
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode) {
            activity.moveTaskToBack(false)
            call.resolve(JSObject().apply { put("ok", true) })
        } else {
            call.resolve(JSObject().apply { put("ok", true) })
        }
    }

    @PluginMethod
    fun setFullscreen(call: PluginCall) {
        val fullscreen = call.getBool("fullscreen", false)
        isFullscreen = fullscreen
        val activity = bridge.activity

        activity.runOnUiThread {
            if (fullscreen) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN)
                activity.actionBar?.hide()
                bridge.webView?.let { webViewWrap(it, activity.window.decorView) }
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN)
                activity.actionBar?.show()
                restoreSystemUi(activity.window.decorView)
            }
        }

        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun allowSleep(call: PluginCall) {
        bridge.activity.runOnUiThread {
            bridge.webView?.clearFocus()
        }
        call.resolve(JSObject().apply { put("ok", true } })
    }

    @PluginMethod
    fun preventSleep(call: PluginCall) {
        bridge.activity.runOnUiThread {
            bridge.webView?.keepScreenOn = true
        }
        call.resolve(JSObject().apply { put("ok", true } })
    }

    private fun webViewWrap(webView: WebView?, systemUi: View) {
        if (webView == null) return
        systemUi.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

    private fun restoreSystemUi(systemUi: View) {
        systemUi.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
    }
}
