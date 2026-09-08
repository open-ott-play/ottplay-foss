package play.ott.foss

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "DashExoPlayer")
class DashExoPlayerPlugin : Plugin() {

    companion object {
        const val ACTION_START = "play.ott.foss.action.START_DASH"
        const val ACTION_STOP = "play.ott.foss.action.STOP_DASH"
        const val ACTION_PAUSE = "play.ott.foss.action.PAUSE_DASH"
        const val EXTRA_URL = "url"
        const val EXTRA_POSITION = "position"
    }

    @PluginMethod
    fun isDashSupported(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun playDash(call: PluginCall) {
        val url = call.getString("url") ?: run {
            call.resolve(JSObject().apply { put("ok", false); put("error", "missing url") })
            return
        }
        val position = (call.getDouble("position", 0.0) ?: 0.0).toLong()
        val intent = Intent(context, DashPlayerService::class.java).apply {
            action = ACTION_START
            putExtra(EXTRA_URL, url)
            putExtra(EXTRA_POSITION, position)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            call.resolve(JSObject().apply { put("ok", false); put("error", e.message) })
        }
    }

    @PluginMethod
    fun pauseDash(call: PluginCall) {
        val intent = Intent(context, DashPlayerService::class.java).apply { action = ACTION_PAUSE }
        context.startService(intent)
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun stopDash(call: PluginCall) {
        val intent = Intent(context, DashPlayerService::class.java).apply { action = ACTION_STOP }
        context.startService(intent)
        call.resolve(JSObject().apply { put("ok", true) })
    }
}

class DashPlayerService : Service() {

    companion object {
        const val TAG = "DashPlayerService"
        const val CHANNEL_ID = "dash_player"
        const val NOTIFICATION_ID = 4406
        const val SESSION_TAG = "ottplay_dash"
    }

    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        mediaSession = MediaSession(this, SESSION_TAG).apply {
            isActive = true
            setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { player?.play(); updateSessionState(true) }
                override fun onPause() { player?.pause(); updateSessionState(false) }
                override fun onStop() {
                    player?.stop()
                    player?.release()
                    player = null
                    stopSelfSafe()
                }
            })
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            DashExoPlayerPlugin.ACTION_START -> {
                val url = intent.getStringExtra(DashExoPlayerPlugin.EXTRA_URL) ?: return START_NOT_STICKY
                val position = intent.getLongExtra(DashExoPlayerPlugin.EXTRA_POSITION, 0L)
                releasePlayer()
                val p = ExoPlayer.Builder(this).build()
                player = p
                val mediaItem = MediaItem.Builder()
                    .setUri(url)
                    .setMimeType(androidx.media3.common.MimeTypes.APPLICATION_MPD)
                    .build()
                p.setMediaItem(mediaItem)
                p.prepare()
                if (position > 0) p.seekTo(position)
                p.play()
                p.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(state: Int) {
                        if (state == Player.STATE_ENDED) {
                            stopSelfSafe()
                        }
                    }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        Log.e(TAG, "ExoPlayer error", error)
                    }
                })
                promoteForeground()
                updateSessionState(true)
            }
            DashExoPlayerPlugin.ACTION_PAUSE -> {
                player?.pause()
                updateSessionState(false)
            }
            DashExoPlayerPlugin.ACTION_STOP -> {
                releasePlayer()
                stopSelfSafe()
            }
            else -> { /* ignore */ }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releasePlayer()
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        stopForegroundCompat()
        super.onDestroy()
    }

    private fun releasePlayer() {
        player?.stop()
        player?.release()
        player = null
        updateSessionState(false)
    }

    private fun promoteForeground() {
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                @Suppress("DEPRECATION")
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed", e)
            stopSelf()
        }
    }

    private fun updateSessionState(playing: Boolean) {
        val state = if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        val actions =
            PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_STOP or
                PlaybackState.ACTION_PLAY_PAUSE
        mediaSession?.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (playing) 1f else 0f)
                .build()
        )
    }

    private fun buildNotification(): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val contentPi = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            nm.getNotificationChannel(CHANNEL_ID) == null
        ) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "DASH playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply { setShowBadge(false) }
            nm.createNotificationChannel(ch)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("OTT-play FOSS")
            .setContentText("DASH playback")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentPi)
            .setOngoing(player?.isPlaying == true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_pause,
                    "Pause",
                    pending(2, DashExoPlayerPlugin.ACTION_PAUSE)
                )
            )
            .addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_stop,
                    "Stop",
                    pending(1, DashExoPlayerPlugin.ACTION_STOP)
                )
            )
            .build()
    }

    private fun pending(requestCode: Int, action: String): PendingIntent {
        return PendingIntent.getService(
            this,
            requestCode,
            Intent(this, DashPlayerService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun stopSelfSafe() {
        stopForegroundCompat()
        stopSelf()
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun ensureChannel() {
        // Channel created lazily in buildNotification; nothing to do here.
    }
}
