package play.ott.foss

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.app.PendingIntent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/** Package updates are explicit authenticated remote operations, never a timer. */
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {
    @PluginMethod fun status(call: PluginCall) {
        try { call.resolve(AppUpdates.status(context)) }
        catch (_: Exception) { call.reject("Update status unavailable") }
    }
    @PluginMethod fun prepare(call: PluginCall) {
        try {
            call.resolve(AppUpdates.prepare(context, call.getString("url") ?: "", call.getString("sha256") ?: ""))
        } catch (_: Exception) { call.reject("Update preparation rejected") }
    }
    @PluginMethod fun install(call: PluginCall) {
        try {
            call.resolve(AppUpdates.install(context, call.getString("sha256") ?: ""))
        } catch (_: Exception) { call.reject("Update installation rejected") }
    }
}

internal object AppUpdates {
    private val executor = Executors.newSingleThreadExecutor()
    private var downloading = false
    private const val LIMIT = 128L * 1024 * 1024
    private fun prefs(context: Context) = context.getSharedPreferences("app_update", Context.MODE_PRIVATE)
    private fun stage(context: Context) = File(context.filesDir, "app-update.apk")
    private fun version(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    @Suppress("DEPRECATION")
    private fun current(context: Context): PackageInfo =
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun fileDigest(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(65536)
            while (true) { val count = input.read(buffer); if (count < 0) break; md.update(buffer, 0, count) }
        }
        return md.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    private fun validHash(value: String) = value.matches(Regex("[a-f0-9]{64}"))
    private fun https(value: String): URL {
        require(value.length in 1..2048 && value.none { it <= ' ' || it == '\\' || it == '\u007f' })
        val url = URL(value)
        require(url.protocol == "https" && url.host.isNotEmpty() && url.userInfo == null && url.ref == null)
        require(url.port == -1 || url.port in 1..65535)
        return url
    }
    private fun state(context: Context, phase: String, error: String = "") {
        check(prefs(context).edit().putString("phase", phase).putString("error", error).commit())
    }
    @Synchronized fun status(context: Context): JSObject {
        val p = prefs(context)
        if (!downloading && p.getString("phase", "idle") == "downloading")
            state(context, "failed", "interrupted")
        val installed = current(context)
        val target = p.getLong("targetCode", 0)
        if (target > 0 && version(installed) >= target && p.getString("phase", "") != "installed") {
            state(context, "installed")
            stage(context).delete()
        }
        return JSObject().apply {
            put("version", 1)
            put("phase", p.getString("phase", "idle"))
            put("sha256", p.getString("sha256", ""))
            put("installed_version", installed.versionName ?: "")
            put("installed_code", version(installed))
            put("target_version", p.getString("targetVersion", ""))
            put("target_code", target)
            put("error", p.getString("error", ""))
            put("can_request_installs", Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls())
            put("user_confirmation_required", true)
        }
    }
    @Synchronized fun prepare(context: Context, address: String, hash: String): JSObject {
        https(address)
        require(validHash(hash))
        val app = context.applicationContext
        val p = prefs(app)
        if (downloading || p.getString("phase", "") in listOf("installing", "awaiting_confirmation")) {
            require(p.getString("sha256", "") == hash)
            return status(app)
        }
        check(p.edit().clear().putString("sha256", hash).putString("phase", "downloading").commit())
        downloading = true
        executor.execute {
            val partial = File(app.filesDir, "app-update.part")
            try {
                download(address, partial)
                require(fileDigest(partial) == hash)
                val info = verify(app, partial)
                synchronized(this) {
                    check(partial.renameTo(stage(app)))
                    check(p.edit().putLong("targetCode", version(info)).putString("targetVersion", info.versionName)
                        .putString("phase", "ready").commit())
                }
            } catch (_: Exception) {
                synchronized(this) { runCatching { state(app, "failed", "download_or_verification_failed") } }
            } finally {
                partial.delete()
                synchronized(this) { downloading = false }
            }
        }
        return status(app)
    }
    private fun download(address: String, output: File) {
        var url = https(address)
        val deadline = android.os.SystemClock.elapsedRealtime() + 180000
        for (redirect in 0..5) {
            val connection = url.openConnection() as HttpsURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.setRequestProperty("Accept-Encoding", "identity")
            try {
                val code = connection.responseCode
                if (code in listOf(301, 302, 303, 307, 308)) {
                    require(redirect < 5)
                    url = https(URL(url, connection.getHeaderField("Location") ?: "").toString())
                    continue
                }
                require(code == 200 && connection.contentLengthLong <= LIMIT)
                connection.inputStream.use { input ->
                    output.outputStream().use { out ->
                        val buffer = ByteArray(65536)
                        var total = 0L
                        while (true) {
                            require(android.os.SystemClock.elapsedRealtime() < deadline)
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= LIMIT)
                            out.write(buffer, 0, count)
                        }
                        require(total > 0)
                        out.fd.sync()
                    }
                }
                return
            } finally { connection.disconnect() }
        }
        error("Too many redirects")
    }
    @Suppress("DEPRECATION")
    private fun verify(context: Context, file: File): PackageInfo {
        val installed = current(context)
        val candidate = context.packageManager.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNATURES)
            ?: error("Invalid APK")
        require(candidate.packageName == context.packageName && version(candidate) > version(installed))
        val expected = installed.signatures?.map { digest(it.toByteArray()) }?.toSet()
        val actual = candidate.signatures?.map { digest(it.toByteArray()) }?.toSet()
        require(!expected.isNullOrEmpty() && actual == expected)
        return candidate
    }
    @Synchronized fun install(context: Context, hash: String): JSObject {
        val p = prefs(context)
        require(validHash(hash) && p.getString("sha256", "") == hash)
        require(!downloading && p.getString("phase", "") in listOf("ready", "awaiting_permission"))
        var id = -1
        try {
            val file = stage(context)
            require(fileDigest(file) == hash)
            verify(context, file)
            if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
                state(context, "awaiting_permission")
                context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return status(context)
            }
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(context.packageName)
            id = installer.createSession(params)
            installer.openSession(id).use { session ->
                file.inputStream().use { input ->
                    session.openWrite("base.apk", 0, file.length()).use { out -> input.copyTo(out); session.fsync(out) }
                }
                val intent = Intent(context, AppUpdateReceiver::class.java).setAction(context.packageName + ".APP_UPDATE")
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
                val result = PendingIntent.getBroadcast(context, id, intent, flags)
                check(p.edit().putInt("sessionId", id).commit())
                state(context, "installing")
                session.commit(result.intentSender)
            }
        } catch (error: Exception) {
            if (id >= 0) runCatching { context.packageManager.packageInstaller.abandonSession(id) }
            runCatching { state(context, "failed", "installation_failed") }
            throw error
        }
        return status(context)
    }
    @Synchronized fun installationResult(context: Context, sessionId: Int, result: Int, confirmation: Intent?) {
        if (sessionId < 0 || prefs(context).getInt("sessionId", -1) != sessionId) return
        when (result) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                if (confirmation == null) { state(context, "failed", "confirmation_unavailable"); return }
                state(context, "awaiting_confirmation")
                try { context.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (_: Exception) { state(context, "failed", "confirmation_unavailable") }
            }
            PackageInstaller.STATUS_SUCCESS -> { state(context, "installed"); stage(context).delete() }
            else -> state(context, "failed", "installation_failed")
        }
    }
}
