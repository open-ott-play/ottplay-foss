// Mode B native HTTP for Stalker /stalker_portal/api/ and host_ott/swop/a.php.
package play.ott.foss

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.HttpURLConnection
import java.net.URL

@CapacitorPlugin(name = "StalkerPortal")
class StalkerPortalPlugin : Plugin() {

    @PluginMethod
    fun portalRequest(call: PluginCall) {
        val rawUrl = call.getString("url") ?: run {
            call.reject("missing url")
            return
        }
        val urlStr = rawUrl
        val method = (call.getString("method") ?: "GET").uppercase()
        val bodyString = call.getString("body") ?: ""
        val contentType = call.getString("contentType") ?: "application/json"

        Thread {
            try {
                val url = URL(urlStr)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.setRequestProperty("Content-Type", contentType)
                if (bodyString.isNotEmpty()) {
                    conn.doOutput = true
                    conn.outputStream.use { it.write(bodyString.toByteArray(Charsets.UTF_8)) }
                }
                conn.connectTimeout = 15000
                conn.readTimeout = 15000

                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
                val ct = conn.contentType ?: "application/octet-stream"

                val ret = JSObject()
                ret.put("status", status)
                ret.put("body", body)
                ret.put("contentType", ct)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("portalRequest failed: ${e.message}")
            }
        }.start()
    }
}
