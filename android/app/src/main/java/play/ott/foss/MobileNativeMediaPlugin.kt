package play.ott.foss

import android.app.PictureInPictureParams
import android.content.Context.AUDIO_SERVICE
import android.content.Intent
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
    private var backgroundAudioActive = false

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
        if (bridge.webView == null) {
            call.resolve(JSObject().apply { put("ok", false) })
            return
        }

        val params = PictureInPictureParams.Builder()
            .setAspectRatio(android.util.Rational(16, 9))
            .build()

        try {
            activity.enterPictureInPictureMode(params)
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            Log.w(TAG, "playPip failed", e)
            call.resolve(JSObject().apply { put("ok", false) })
        }
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
            bridge.webView?.keepScreenOn = false
        }
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun preventSleep(call: PluginCall) {
        bridge.activity.runOnUiThread {
            bridge.webView?.keepScreenOn = true
        }
        call.resolve(JSObject().apply { put("ok", true) })
    }

    /**
     * Start the mediaPlayback foreground service so HLS/<video> can keep
     * playing when the activity is backgrounded. Real ContextCompat.startForegroundService —
     * never reports ok without attempting to start the service.
     */
    @PluginMethod
    fun startBackgroundAudio(call: PluginCall) {
        val title = call.getString("title") ?: "OTT-play FOSS"
        val artist = call.getString("artist") ?: "Now playing"
        val ctx = bridge.context
        val intent = Intent(ctx, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_START
            putExtra(MediaPlaybackService.EXTRA_TITLE, title)
            putExtra(MediaPlaybackService.EXTRA_ARTIST, artist)
        }
        try {
            ContextCompat.startForegroundService(ctx, intent)
            backgroundAudioActive = true
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            Log.e(TAG, "startBackgroundAudio failed", e)
            backgroundAudioActive = false
            call.resolve(JSObject().apply {
                put("ok", false)
                put("error", e.message ?: "startForegroundService failed")
            })
        }
    }

    /** Pause MediaSession state; keep FGS alive while paused briefly. */
    @PluginMethod
    fun pauseBackgroundAudio(call: PluginCall) {
        if (!backgroundAudioActive) {
            call.resolve(JSObject().apply { put("ok", true) })
            return
        }
        val ctx = bridge.context
        val intent = Intent(ctx, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_PAUSE
        }
        try {
            ctx.startService(intent)
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            Log.e(TAG, "pauseBackgroundAudio failed", e)
            call.resolve(JSObject().apply {
                put("ok", false)
                put("error", e.message ?: "pause failed")
            })
        }
    }

    /** Resume MediaSession / notification after pause. */
    @PluginMethod
    fun resumeBackgroundAudio(call: PluginCall) {
        val title = call.getString("title") ?: "OTT-play FOSS"
        val artist = call.getString("artist") ?: "Now playing"
        val ctx = bridge.context
        val intent = Intent(ctx, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_RESUME
            putExtra(MediaPlaybackService.EXTRA_TITLE, title)
            putExtra(MediaPlaybackService.EXTRA_ARTIST, artist)
        }
        try {
            if (backgroundAudioActive) {
                ctx.startService(intent)
            } else {
                ContextCompat.startForegroundService(ctx, intent)
                backgroundAudioActive = true
            }
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            Log.e(TAG, "resumeBackgroundAudio failed", e)
            call.resolve(JSObject().apply {
                put("ok", false)
                put("error", e.message ?: "resume failed")
            })
        }
    }

    /** Finish Activity / leave Cap app (fallback if App.exitApp unavailable). */
    @PluginMethod
    fun exitApp(call: PluginCall) {
        val act = activity
        if (act == null) {
            call.reject("no activity")
            return
        }
        act.runOnUiThread {
            try {
                act.finishAndRemoveTask()
            } catch (_e: Exception) {
                act.finish()
            }
        }
        val ret = JSObject()
        ret.put("ok", true)
        call.resolve(ret)
    }

    /** Stop and tear down the mediaPlayback foreground service. */
    @PluginMethod
    fun stopBackgroundAudio(call: PluginCall) {
        val ctx = bridge.context
        val intent = Intent(ctx, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_STOP
        }
        try {
            ctx.startService(intent)
            ctx.stopService(Intent(ctx, MediaPlaybackService::class.java))
            backgroundAudioActive = false
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            Log.e(TAG, "stopBackgroundAudio failed", e)
            backgroundAudioActive = false
            call.resolve(JSObject().apply {
                put("ok", false)
                put("error", e.message ?: "stopService failed")
            })
        }
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
