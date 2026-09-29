// Mode B native HTTP for Stalker /stalker_portal/api/, host_ott/swop/a.php,
// and Mag path-shaped /load.php|/c/portal URLs (allowlist + header forward only).
package play.ott.foss

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.HttpURLConnection
import java.net.URL
import okhttp3.OkHttpClient
import okhttp3.CookieJar
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import java.io.ByteArrayOutputStream

@CapacitorPlugin(name = "StalkerPortal")
class StalkerPortalPlugin : Plugin() {

    private val swopClient = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)
        .cookieJar(CookieJar.NO_COOKIES)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .proxy(java.net.Proxy.NO_PROXY)
        .callTimeout(10, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
        .build()


    /** Archived bridge fixture; the standalone Android app has its own transport. */
    @PluginMethod
    fun swopRequest(call: PluginCall) {
        Thread {
            try {
                val raw = call.getString("url") ?: error("missing url")
                require(Regex("^https://([A-Za-z0-9.-]+|\\[[0-9a-fA-F:]+\\])(:[0-9]{1,5})?/swop/(session|val)$").matches(raw))
                val uri = java.net.URI(raw)
                require(uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
                require(uri.port == -1 || uri.port in 1..65535)
                val body = call.getString("body") ?: error("missing body")
                val bytes = body.toByteArray(Charsets.UTF_8)
                require(bytes.size <= 65536)
                val json = org.json.JSONTokener(body)
                require(json.nextValue() is org.json.JSONObject && json.nextClean() == '\u0000')
                val clientId = call.getString("clientId") ?: error("missing identity")
                require(Regex("^[A-Za-z0-9._:-]{1,128}$").matches(clientId))
                // Explicit native assertion about the relay, not browser proof/auth.
                val origin = "https://" + uri.host + if (uri.port != -1 && uri.port != 443) ":${uri.port}" else ""
                val request = Request.Builder().url(raw)
                    .header("Origin", origin).header("Accept", "application/json")
                    .header("X-Swop-Client-Id", clientId)
                    .post(bytes.toRequestBody("application/json".toMediaType())).build()
                swopClient.newCall(request).execute().use { response ->
                    require(response.code !in 300..399)
                    val responseBody = response.body ?: error("missing response")
                    require(responseBody.contentLength() <= 65536)
                    val output = ByteArrayOutputStream()
                    responseBody.byteStream().use { stream ->
                        val buffer = ByteArray(4096)
                        while (true) {
                            val read = stream.read(buffer)
                            if (read == -1) break
                            require(output.size() + read <= 65536)
                            output.write(buffer, 0, read)
                        }
                    }
                    val text = Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(output.toByteArray())).toString()
                    call.resolve(JSObject().put("status", response.code).put("statusText", response.message)
                        .put("body", text).put("headers", "Content-Type: application/json\r\n"))
                }
            } catch (error: Exception) {
                call.reject("Native remote text entry request failed",
                    if (error is java.io.InterruptedIOException) "timeout" else null)
            }
        }.start()
    }

    private fun isAllowedUrl(url: String): Boolean {
        return url.contains("/stalker_portal/api/") ||
            url.contains("/stalker_portal/stream/") ||
            url.contains("/swop/a.php") ||
            url.contains("/load.php") ||
            url.contains("/portal.php") ||
            url.contains("/c/portal")
    }

    private fun isForbiddenHeader(name: String): Boolean {
        val n = name.lowercase()
        return n == "host" || n == "content-length" || n == "connection" ||
            n == "transfer-encoding" || n == "upgrade"
    }

    @PluginMethod
    fun portalRequest(call: PluginCall) {
        val rawUrl = call.getString("url") ?: run {
            call.reject("missing url")
            return
        }
        if (!isAllowedUrl(rawUrl)) {
            call.reject("url is not an allowed stalker/swop/load.php/c/portal path")
            return
        }
        performRequest(call, rawUrl)
    }

    @PluginMethod
    fun httpRequest(call: PluginCall) {
        val rawUrl = call.getString("url") ?: run {
            call.reject("missing url")
            return
        }
        performRequest(call, rawUrl)
    }

    private fun performRequest(call: PluginCall, rawUrl: String) {
        val urlStr = rawUrl
        val method = (call.getString("method") ?: "GET").uppercase()
        val bodyString = call.getString("body") ?: ""
        val contentType = call.getString("contentType") ?: "application/json"
        val headersObj = call.getObject("headers")

        Thread {
            try {
                val url = URL(urlStr)
                require(url.protocol == "http" || url.protocol == "https") { "Only HTTP(S) URLs are supported" }
                if (BuildConfig.FLAVOR == "play" && url.protocol == "http") {
                    call.reject("OTT-play FOSS Play requires HTTPS sources. Use an HTTPS provider URL or the Full edition for HTTP sources.", "https_required")
                    return@Thread
                }
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = method
                val timeout = (call.getInt("timeoutMs") ?: 15000).coerceAtLeast(1)
                conn.connectTimeout = timeout
                conn.readTimeout = timeout
                conn.instanceFollowRedirects = true

                var contentTypeFromHeaders = false
                if (headersObj != null) {
                    val keys = headersObj.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        if (isForbiddenHeader(key)) continue
                        val value = headersObj.optString(key, null) ?: continue
                        if (key.equals("content-type", ignoreCase = true)) {
                            contentTypeFromHeaders = true
                        }
                        conn.setRequestProperty(key, value)
                    }
                }
                if (!contentTypeFromHeaders && bodyString.isNotEmpty()) {
                    conn.setRequestProperty("Content-Type", contentType)
                }
                if (bodyString.isNotEmpty()) {
                    conn.doOutput = true
                    conn.outputStream.use { it.write(bodyString.toByteArray(Charsets.UTF_8)) }
                }

                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                val ct = conn.contentType ?: "application/octet-stream"

                val setCookieArr = JSArray()
                conn.headerFields?.get("Set-Cookie")?.forEach { setCookieArr.put(it) }

                val ret = JSObject()
                ret.put("status", status)
                ret.put("statusText", conn.responseMessage ?: "")
                val responseHeaders = StringBuilder()
                conn.headerFields.forEach { (name, values) ->
                    if (name != null) values.forEach { responseHeaders.append(name).append(": ").append(it).append("\r\n") }
                }
                ret.put("headers", responseHeaders.toString())
                ret.put("body", body)
                ret.put("contentType", ct)
                ret.put("setCookie", setCookieArr)
                conn.disconnect()
                call.resolve(ret)
            } catch (e: Exception) {
                val code = if (e is java.net.SocketTimeoutException) "timeout" else null
                val message = when (e) {
                    is java.net.SocketTimeoutException -> "Provider request timed out"
                    is javax.net.ssl.SSLException -> "Provider TLS connection failed; check its HTTPS certificate"
                    is java.net.UnknownHostException -> "Provider hostname could not be resolved"
                    else -> "Provider request failed"
                }
                // Exceptions can contain full provider URLs with credentials.
                call.reject(message, code)
            }
        }.start()
    }
}
