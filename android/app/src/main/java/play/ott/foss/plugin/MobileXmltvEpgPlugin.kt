package play.ott.foss.plugin

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.math.max

@CapacitorPlugin(name = "MobileXmltvEpg")
class MobileXmltvEpgPlugin : Plugin() {

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val cacheFile: File by lazy {
        File(context.cacheDir, "epg2.xml.gz")
    }
    private val metaFile: File by lazy {
        File(context.filesDir, "epg2.meta")
    }

    private val cacheLock = Any()

    companion object {
        private const val TTL_SECONDS = 2 * 3600
        private const val DEFAULT_URL = "https://cdn.epg.one/epg2.xml.gz"
    }

    @PluginMethod
    fun getEpg(call: PluginCall) {
        val urlStr = call.getString("xmltv_url")?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_URL
        val ch = call.getString("ch")
        val hash = call.getString("hash") ?: ""
        val channelId = call.getString("channel_id") ?: ""
        val timeShift = call.getInt("time_shift_hours") ?: 0
        val archiveHours = call.getInt("archive_hours") ?: 0

        val fresh = try { readCache(urlStr) } catch (_: Throwable) { null }
        if (fresh != null) {
            val parsed = parseXmltv(fresh)
            call.resolve(buildSlice(parsed, channelId, ch, hash, timeShift, archiveHours))
            return
        }

        val request = Request.Builder().url(urlStr).build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(httpCall: Call, e: IOException) {
                val stale = try { readCache(urlStr, allowStale = true) } catch (_: Throwable) { null }
                if (stale != null) {
                    val parsed = parseXmltv(stale)
                    call.resolve(buildSlice(parsed, channelId, ch, hash, timeShift, archiveHours))
                    return
                }
                call.reject(e.localizedMessage ?: "fetch failed")
            }

            override fun onResponse(httpCall: Call, response: Response) {
                val data = response.body?.bytes() ?: return onFailure(httpCall, IOException("empty body"))
                val xml = gunzip(data) ?: return onFailure(httpCall, IOException("gunzip failed"))
                try { writeCache(data, urlStr) } catch (_: Throwable) { /* ignore cache write errors */ }
                val parsed = parseXmltv(String(xml))
                call.resolve(buildSlice(parsed, channelId, ch, hash, timeShift, archiveHours))
            }
        })
    }

    @PluginMethod
    fun prefetch(call: PluginCall) {
        val urlStr = call.getString("xmltv_url")?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_URL
        val request = Request.Builder().url(urlStr).build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(httpCall: Call, e: IOException) { call.reject(e.localizedMessage ?: "fetch failed") }
            override fun onResponse(httpCall: Call, response: Response) {
                val data = response.body?.bytes() ?: return call.reject("empty body")
                if (gunzip(data) == null) return call.reject("gunzip failed")
                try { writeCache(data, urlStr) } catch (_: Throwable) { /* ignore cache write errors */ }
                call.resolve()
            }
        })
    }

    // MARK: - Cache

    @Throws(IOException::class)
    private fun readCache(sourceUrl: String, allowStale: Boolean = false): String? = synchronized(cacheLock) {
        if (!metaFile.exists() || !cacheFile.exists()) return@synchronized null
        val fields = metaFile.readText().split('\n', limit = 2)
        // Timestamp-only metadata predates source tracking and cannot be trusted.
        if (fields.size != 2 || fields[1] != sourceUrl) return@synchronized null
        val fetched = fields[0].toLongOrNull() ?: return@synchronized null
        val age = max(0L, System.currentTimeMillis() / 1000 - fetched)
        if (!allowStale && age > TTL_SECONDS) return@synchronized null
        gunzip(cacheFile.readBytes())?.let { String(it, Charsets.UTF_8) }
    }

    @Throws(IOException::class)
    private fun writeCache(data: ByteArray, sourceUrl: String) = synchronized(cacheLock) {
        // Invalidate metadata first so an interrupted write cannot label another source's data.
        if (metaFile.exists() && !metaFile.delete()) throw IOException("cannot invalidate cache metadata")
        cacheFile.writeBytes(data)
        metaFile.writeText("${System.currentTimeMillis() / 1000}\n$sourceUrl")
    }

    // MARK: - Gzip

    private fun gunzip(data: ByteArray): ByteArray? {
        return try {
            val gis = java.util.zip.GZIPInputStream(data.inputStream())
            gis.use { it.readBytes() }
        } catch (_: Throwable) { null }
    }

    // MARK: - XMLTV Parser

    private fun parseXmltv(xml: String): Parsed {
        val channels = mutableMapOf<String, String>()
        val programs = mutableMapOf<String, MutableList<Program>>()
        val reader = XmlReader()
        reader.parse(xml)
        channels.putAll(reader.channels)
        reader.programs.forEach { (ch, list) ->
            programs.getOrPut(ch) { mutableListOf() }.addAll(list)
        }
        return Parsed(channels, programs)
    }

    private data class Program(val start: Int, val stop: Int, val title: String, val desc: String)
    private data class Parsed(val channels: Map<String, String>, val programs: Map<String, List<Program>>)

    private class XmlReader {
        val channels = mutableMapOf<String, String>()
        val programs = mutableMapOf<String, MutableList<Program>>()

        private var currentChannelId: String? = null
        private var currentProgChannel: String? = null
        private var currentProgStart = 0
        private var currentProgStop = 0
        private var currentProgTitle = StringBuilder()
        private var currentProgDesc = StringBuilder()
        private var textTarget: String? = null

        private val tag = StringBuilder()
        private val buf = StringBuilder()

        fun parse(xml: String) {
            var i = 0
            while (i < xml.length) {
                if (xml[i] == '<') {
                    buf.clear()
                    while (i < xml.length && xml[i] != '>') {
                        buf.append(xml[i])
                        i++
                    }
                    if (i < xml.length) { buf.append(xml[i]); i++ }
                    handleTag(buf.toString())
                } else {
                    buf.clear()
                    while (i < xml.length && xml[i] != '<') {
                        buf.append(xml[i])
                        i++
                    }
                    handleText(buf.toString())
                }
            }
        }

        private fun handleTag(raw: String) {
            val trimmed = raw.trim()
            if (trimmed.startsWith("</")) {
                val name = trimmed.drop(2).dropLastWhile { it == ' ' }.dropLastWhile { it != ' ' && it != '>' }.trim()
                closeTag(name)
                return
            }
            if (!trimmed.startsWith("<")) return
            val isSelfClosing = trimmed.endsWith("/>")
            val inner = trimmed.drop(1).dropLast(if (isSelfClosing) 2 else 1).trim()
            val name = inner.takeWhile { it != ' ' }.trim()
            val attrs = inner.drop(name.length).trim()
            openTag(name, attrs)
            if (isSelfClosing) closeTag(name)
        }

        private fun openTag(name: String, attrs: String) {
            when (name) {
                "channel" -> currentChannelId = attr(attrs, "id")
                "programme" -> {
                    currentProgChannel = attr(attrs, "channel")
                    currentProgStart = parseTime(attr(attrs, "start"))
                    currentProgStop = parseTime(attr(attrs, "stop"))
                    currentProgTitle = StringBuilder()
                    currentProgDesc = StringBuilder()
                }
                "display-name" -> if (currentChannelId != null) textTarget = "ch"
                "title" -> if (currentProgChannel != null) textTarget = "title"
                "desc" -> if (currentProgChannel != null) textTarget = "desc"
                "icon" -> { /* skip for now */ }
            }
        }

        private fun closeTag(name: String) {
            when (name) {
                "channel" -> currentChannelId = null.also { textTarget = null }
                "programme" -> {
                    val ch = currentProgChannel
                    if (ch != null && currentProgTitle.isNotBlank()) {
                        programs.getOrPut(ch) { mutableListOf() }
                            .add(Program(currentProgStart, currentProgStop, currentProgTitle.toString(), currentProgDesc.toString()))
                    }
                    currentProgChannel = null
                    textTarget = null
                }
                "title", "desc", "display-name" -> textTarget = null
            }
        }

        private fun handleText(text: String) {
            val target = textTarget ?: return
            when (target) {
                "ch" -> currentChannelId?.let {
                    channels[it] = (channels[it] ?: "") + text
                }
                "title" -> currentProgTitle.append(text)
                "desc" -> currentProgDesc.append(text)
            }
        }

        private fun attr(attrs: String, key: String): String {
            val pattern = Regex("""$key="([^"]*)"""")
            return pattern.find(attrs)?.groupValues?.get(1) ?: ""
        }

        private fun parseTime(ts: String): Int {
            val trimmed = ts.trim()
            if (trimmed.length < 14) return 0
            val datePart = trimmed.substring(0, 14)
            val tzPart = trimmed.substring(14).trim()
            val sdf = java.text.SimpleDateFormat("yyyyMMddHHmmss")
            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
            return try {
                val date = sdf.parse(datePart) ?: return 0
                var unix = (date.time / 1000).toInt()
                if (tzPart.length >= 5) {
                    val sign = if (tzPart[0] == '+') 1 else if (tzPart[0] == '-') -1 else 0
                    if (sign != 0) {
                        val hours = tzPart.substring(1, 3).toIntOrNull() ?: 0
                        val mins = tzPart.substring(3, 5).toIntOrNull() ?: 0
                        unix -= sign * (hours * 3600 + mins * 60)
                    }
                }
                unix
            } catch (_: Throwable) { 0 }
        }
    }

    // MARK: - Channel resolution + EPG slice

    private fun resolveXmltvId(channels: Map<String, String>, ch: String?, hash: String): String {
        if (!ch.isNullOrEmpty()) {
            val normalized = normalize(ch)
            val exact = channels.values.firstOrNull { normalize(it) == normalized }
            if (exact != null) return channels.entries.first { it.value == exact }.key
            val lower = ch.lowercase()
            return channels.entries.firstOrNull { it.value.lowercase().contains(lower) }?.key ?: hash
        }
        if (hash.isNotEmpty() && channels.containsKey(hash)) return hash
        return hash
    }

    private fun normalize(name: String): String {
        var s = name.lowercase()
        s = s.replace(Regex("""[+-]\s*\d+\s*(ч|h|hours?)?"""), "")
        s = s.replace(Regex("""\([^)]*\)"""), "")
        s = s.replace(Regex("""\s+"""), " ")
        s = s.trim()
        s = s.replace(Regex("""^(hd|fhd|uhd|4k)\s+"""), "")
        s = s.replace(Regex("""\s+(hd|fhd|uhd|4k)$"""), "")
        return s.trim()
    }

    private fun buildSlice(
        parsed: Parsed,
        channelId: String,
        ch: String?,
        hash: String,
        timeShiftHours: Int,
        archiveHours: Int
    ): JSObject {
        val xmltvId = resolveXmltvId(parsed.channels, ch, hash)
        val progs = parsed.programs[xmltvId] ?: emptyList()
        val now = (System.currentTimeMillis() / 1000).toInt()
        val lookbackH = if (archiveHours > 0) archiveHours else 48
        val windowStart = now - lookbackH * 3600
        val windowEnd = now + 48 * 3600
        val shift = timeShiftHours * 3600

        val epgData = JSObject()
        val list = JSArray()
        for (prog in progs) {
            val start = prog.start + shift
            val stop = prog.stop + shift
            if (stop <= windowStart || start >= windowEnd) continue
            val entry = JSObject().apply {
                put("time", start)
                put("time_to", stop)
                put("name", prog.title)
                put("descr", prog.desc)
                put("icon", "")
            }
            list.put(entry)
        }
        epgData.put("epg_data", list)
        return epgData
    }
}
