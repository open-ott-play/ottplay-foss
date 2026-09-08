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

/**
 * Foreground service (mediaPlayback) so WebView HLS/<video> audio can continue
 * when the app is backgrounded under modern Android rules.
 *
 * Starts/stops from [MobileNativeMediaPlugin]. Lock-screen transport controls
 * beyond the notification + MediaSession skeleton are a documented follow-up
 * (WKWebView/HTML5 video is not a native MediaPlayer).
 */
class MediaPlaybackService : Service() {

    companion object {
        const val ACTION_START = "play.ott.foss.action.START_MEDIA_PLAYBACK"
        const val ACTION_STOP = "play.ott.foss.action.STOP_MEDIA_PLAYBACK"
        const val ACTION_PAUSE = "play.ott.foss.action.PAUSE_MEDIA_PLAYBACK"
        const val ACTION_RESUME = "play.ott.foss.action.RESUME_MEDIA_PLAYBACK"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"

        private const val TAG = "MediaPlaybackService"
        private const val CHANNEL_ID = "ott_media_playback"
        private const val NOTIFICATION_ID = 4405
        private const val SESSION_TAG = "ottplay_foss_media"
    }

    private var mediaSession: MediaSession? = null
    private var title: String = "OTT-play FOSS"
    private var artist: String = "Now playing"
    private var playing: Boolean = true

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        mediaSession = MediaSession(this, SESSION_TAG).apply {
            setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    playing = true
                    updatePlaybackState()
                    updateNotification()
                }

                override fun onPause() {
                    playing = false
                    updatePlaybackState()
                    updateNotification()
                }

                override fun onStop() {
                    stopSelfSafe()
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelfSafe()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                playing = false
                updatePlaybackState()
                updateNotification()
                return START_STICKY
            }
            ACTION_RESUME -> {
                playing = true
                title = intent.getStringExtra(EXTRA_TITLE) ?: title
                artist = intent.getStringExtra(EXTRA_ARTIST) ?: artist
                updatePlaybackState()
                promoteForeground()
                return START_STICKY
            }
            ACTION_START, null -> {
                playing = true
                title = intent?.getStringExtra(EXTRA_TITLE) ?: title
                artist = intent?.getStringExtra(EXTRA_ARTIST) ?: artist
                updatePlaybackState()
                promoteForeground()
                return START_STICKY
            }
            else -> return START_NOT_STICKY
        }
    }

    override fun onDestroy() {
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        stopForegroundCompat()
        super.onDestroy()
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

    private fun updateNotification() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun updatePlaybackState() {
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
        mediaSession?.setMetadata(
            android.media.MediaMetadata.Builder()
                .putString(android.media.MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(android.media.MediaMetadata.METADATA_KEY_ARTIST, artist)
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

        val stopPi = PendingIntent.getService(
            this,
            1,
            Intent(this, MediaPlaybackService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        builder
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentPi)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Stop",
                    stopPi
                ).build()
            )

        mediaSession?.sessionToken?.let { token ->
            builder.setStyle(
                Notification.MediaStyle()
                    .setMediaSession(token)
                    .setShowActionsInCompactView(0)
            )
        }

        return builder.build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Media playback",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps HLS / video audio playing in the background"
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
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
}
