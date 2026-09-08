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
import android.webkit.WebView
import java.lang.ref.WeakReference

/**
 * Foreground service (mediaPlayback) so WebView HLS/<video> audio can continue
 * when the app is backgrounded under modern Android rules.
 *
 * MediaSession / notification transport controls drive the Cap WebView via
 * evaluateJavascript (_doKey + <video> play/pause), matching the iOS remote
 * → WKWebView pattern from #313.
 */
class MediaPlaybackService : Service() {

    companion object {
        const val ACTION_START = "play.ott.foss.action.START_MEDIA_PLAYBACK"
        const val ACTION_STOP = "play.ott.foss.action.STOP_MEDIA_PLAYBACK"
        const val ACTION_PAUSE = "play.ott.foss.action.PAUSE_MEDIA_PLAYBACK"
        const val ACTION_RESUME = "play.ott.foss.action.RESUME_MEDIA_PLAYBACK"
        const val ACTION_PLAY = "play.ott.foss.action.PLAY_MEDIA_PLAYBACK"
        const val ACTION_NEXT = "play.ott.foss.action.NEXT_MEDIA_PLAYBACK"
        const val ACTION_PREV = "play.ott.foss.action.PREV_MEDIA_PLAYBACK"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"

        private const val TAG = "MediaPlaybackService"
        private const val CHANNEL_ID = "ott_media_playback"
        private const val NOTIFICATION_ID = 4405
        private const val SESSION_TAG = "ottplay_foss_media"

        // Cap keyhandler codes for channel skip (src/keyhandler/index.ts).
        // Play/pause must NOT use _doKey(PLAY/PAUSE): those toggle and can
        // liveStop() in live TV mode. Match iOS #313: drive <video> directly.
        private const val KEY_NEXT = 35
        private const val KEY_PREV = 36

        const val EXTRA_SESSION_ONLY = "session_only"

        @Volatile
        private var webViewRef: WeakReference<WebView>? = null

        /** Called from [MobileNativeMediaPlugin] when the Cap bridge is ready. */
        fun bindWebView(webView: WebView?) {
            webViewRef = if (webView != null) WeakReference(webView) else null
        }

        fun clearWebView(webView: WebView?) {
            val cur = webViewRef?.get()
            if (webView == null || cur == null || cur === webView) {
                webViewRef = null
            }
        }

        private fun evalOnWebView(js: String) {
            val wv = webViewRef?.get() ?: run {
                Log.w(TAG, "evalOnWebView: no WebView bound")
                return
            }
            wv.post {
                try {
                    wv.evaluateJavascript(js, null)
                } catch (e: Exception) {
                    Log.w(TAG, "evaluateJavascript failed", e)
                }
            }
        }

        private fun drivePlay() {
            evalOnWebView(
                "var v=document.querySelector('video'); if(v){v.play();} true;"
            )
        }

        private fun drivePause() {
            evalOnWebView(
                "var v=document.querySelector('video'); if(v){v.pause();} true;"
            )
        }

        private fun driveStop() {
            evalOnWebView(
                "var v=document.querySelector('video');" +
                    " if(v){v.pause(); v.removeAttribute('src'); try{v.load();}catch(e){}} true;"
            )
        }

        private fun driveNext() {
            evalOnWebView(
                "(function(){if(window._doKey)window._doKey($KEY_NEXT);})();"
            )
        }

        private fun drivePrev() {
            evalOnWebView(
                "(function(){if(window._doKey)window._doKey($KEY_PREV);})();"
            )
        }
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
                    drivePlay()
                    updatePlaybackState()
                    updateNotification()
                }

                override fun onPause() {
                    playing = false
                    drivePause()
                    updatePlaybackState()
                    updateNotification()
                }

                override fun onStop() {
                    driveStop()
                    stopSelfSafe()
                }

                override fun onSkipToNext() {
                    driveNext()
                }

                override fun onSkipToPrevious() {
                    drivePrev()
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                driveStop()
                stopSelfSafe()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                playing = false
                val sessionOnly = intent.getBooleanExtra(EXTRA_SESSION_ONLY, false)
                if (!sessionOnly) {
                    drivePause()
                }
                updatePlaybackState()
                updateNotification()
                return START_STICKY
            }
            ACTION_PLAY -> {
                playing = true
                title = intent.getStringExtra(EXTRA_TITLE) ?: title
                artist = intent.getStringExtra(EXTRA_ARTIST) ?: artist
                drivePlay()
                updatePlaybackState()
                promoteForeground()
                return START_STICKY
            }
            ACTION_RESUME -> {
                playing = true
                title = intent.getStringExtra(EXTRA_TITLE) ?: title
                artist = intent.getStringExtra(EXTRA_ARTIST) ?: artist
                // Plugin resume: JS already continued playback; refresh session only.
                updatePlaybackState()
                promoteForeground()
                return START_STICKY
            }
            ACTION_NEXT -> {
                driveNext()
                return START_STICKY
            }
            ACTION_PREV -> {
                drivePrev()
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
                PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_SKIP_TO_NEXT or
                PlaybackState.ACTION_SKIP_TO_PREVIOUS
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

    private fun servicePi(requestCode: Int, action: String): PendingIntent {
        return PendingIntent.getService(
            this,
            requestCode,
            Intent(this, MediaPlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
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

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val playPauseAction = if (playing) {
            Notification.Action.Builder(
                android.R.drawable.ic_media_pause,
                "Pause",
                servicePi(2, ACTION_PAUSE)
            ).build()
        } else {
            Notification.Action.Builder(
                android.R.drawable.ic_media_play,
                "Play",
                servicePi(3, ACTION_PLAY)
            ).build()
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
                    android.R.drawable.ic_media_previous,
                    "Prev",
                    servicePi(4, ACTION_PREV)
                ).build()
            )
            .addAction(playPauseAction)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_media_next,
                    "Next",
                    servicePi(5, ACTION_NEXT)
                ).build()
            )
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Stop",
                    servicePi(1, ACTION_STOP)
                ).build()
            )

        mediaSession?.sessionToken?.let { token ->
            builder.setStyle(
                Notification.MediaStyle()
                    .setMediaSession(token)
                    .setShowActionsInCompactView(0, 1, 2)
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
