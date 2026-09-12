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

    private val sourceLock = Any()
    private val parsedCache = mutableMapOf<String, Pair<Long, Parsed>>()
    private val pendingSources = mutableMapOf<String, MutableList<(Result<Parsed>) -> Unit>>()

    private fun sourceUrls(call: PluginCall): List<String> {
        val supplied = call.getArray("xmltv_urls")
        val urls = (0 until (supplied?.length() ?: 0)).map { supplied!!.optString(it) }.filter { it.isNotBlank() }
        return (if (urls.isNotEmpty()) urls else listOf(call.getString("xmltv_url")?.takeIf { it.isNotBlank() } ?: DEFAULT_URL))
            .map { it.trim() }.distinct()
    }

    private fun loadSource(source: String, force: Boolean = false, completion: (Result<Parsed>) -> Unit) {
        if (!source.startsWith("http://") && !source.startsWith("https://")) {
            completion(Result.failure(IOException("invalid XMLTV URL"))); return
        }
        synchronized(sourceLock) {
            val cached = parsedCache[source]
            if (!force && cached != null && System.currentTimeMillis() / 1000 - cached.first < TTL_SECONDS) {
                completion(Result.success(cached.second)); return
            }
            pendingSources[source]?.let { it.add(completion); return }
            pendingSources[source] = mutableListOf(completion)
        }
        fun finish(result: Result<Parsed>) {
            val callbacks = synchronized(sourceLock) {
                result.getOrNull()?.let { parsedCache[source] = Pair(System.currentTimeMillis() / 1000, it) }
                pendingSources.remove(source) ?: emptyList()
            }
            callbacks.forEach { it(result) }
        }
        if (!force) {
            val fresh = try { readCache(source) } catch (_: Throwable) { null }
            if (fresh != null) { finish(runCatching { parseXmltv(fresh) }); return }
        }
        fun failed(error: Throwable) {
            val memory = synchronized(sourceLock) { parsedCache[source]?.second }
            if (memory != null) { finish(Result.success(memory)); return }
            val stale = try { readCache(source, allowStale = true) } catch (_: Throwable) { null }
            finish(if (stale != null) runCatching { parseXmltv(stale) } else Result.failure(error))
        }
        try {
            client.newCall(Request.Builder().url(source).build()).enqueue(object : Callback {
                override fun onFailure(httpCall: Call, e: IOException) { failed(e) }
                override fun onResponse(httpCall: Call, response: Response) {
                    try {
                        if (!response.isSuccessful) throw IOException("XMLTV HTTP ${response.code}")
                        val data = response.body?.bytes() ?: throw IOException("empty XMLTV body")
                        val xml = gunzip(data) ?: throw IOException("invalid XMLTV encoding")
                        val parsed = parseXmltv(String(xml, Charsets.UTF_8))
                        if (parsed.channels.isEmpty()) throw IOException("invalid or empty XMLTV")
                        try { writeCache(data, source) } catch (_: Throwable) { }
                        finish(Result.success(parsed))
                    } catch (error: Throwable) { failed(error) }
                    finally { response.close() }
                }
            })
        } catch (error: Throwable) { failed(error) }
    }

    // The first feed defining an ID owns that channel and its programs.
    private fun loadSources(sources: List<String>, force: Boolean = false, completion: (Result<Parsed>) -> Unit) {
        val channels = mutableMapOf<String, String>()
        val programs = mutableMapOf<String, List<Program>>()
        val icons = mutableMapOf<String, String>()
        val names = mutableMapOf<String, List<String>>()
        var firstError: Throwable? = null
        fun next(index: Int) {
            if (index == sources.size) {
                completion(if (channels.isEmpty() && firstError != null) Result.failure(firstError!!)
                    else Result.success(Parsed(channels, programs, icons, names)))
                return
            }
            loadSource(sources[index], force) { result ->
                result.onSuccess { parsed ->
                    parsed.channels.forEach { (id, name) ->
                        if (!channels.containsKey(id)) {
                            channels[id] = name
                            programs[id] = parsed.programs[id] ?: emptyList()
                            icons[id] = parsed.icons[id] ?: ""
                            names[id] = parsed.names[id] ?: listOf(name)
                        }
                    }
                }.onFailure { if (firstError == null) firstError = it }
                next(index + 1)
            }
        }
        next(0)
    }

    @PluginMethod
    fun getEpg(call: PluginCall) {
        loadSources(sourceUrls(call)) { result ->
            result.onSuccess { parsed ->
                call.resolve(buildSlice(parsed, call.getString("channel_id") ?: "", call.getString("ch"),
                    call.getString("hash") ?: "", call.getInt("time_shift_hours") ?: 0,
                    call.getInt("archive_hours") ?: 0, call.getString("tvg_name")))
            }.onFailure { call.reject(it.localizedMessage ?: "XMLTV fetch failed") }
        }
    }

    @PluginMethod
    fun getChannels(call: PluginCall) {
        loadSources(sourceUrls(call)) { result ->
            result.onSuccess { parsed ->
                val rows = JSArray()
                parsed.channels.keys.sorted().forEach { id ->
                    val aliases = JSArray()
                    (parsed.names[id] ?: listOf(parsed.channels[id] ?: id)).forEach { aliases.put(it) }
                    rows.put(JSObject().apply {
                        put("id", id); put("name", parsed.channels[id] ?: id)
                        put("names", aliases); put("icon", parsed.icons[id] ?: "")
                    })
                }
                call.resolve(JSObject().apply { put("channels", rows) })
            }.onFailure { call.reject(it.localizedMessage ?: "XMLTV fetch failed") }
        }
    }

    @PluginMethod
    fun prefetch(call: PluginCall) {
        loadSources(sourceUrls(call), force = true) { result ->
            result.onSuccess { call.resolve() }.onFailure { call.reject(it.localizedMessage ?: "XMLTV fetch failed") }
        }
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
        if (data.size < 2 || data[0] != 0x1f.toByte() || data[1] != 0x8b.toByte()) {
            return if (String(data, Charsets.UTF_8).trimStart().startsWith("<")) data else null
        }
        return try {
            val gis = java.util.zip.GZIPInputStream(data.inputStream())
            gis.use { it.readBytes() }
        } catch (_: Throwable) { null }
    }

    // MARK: - XMLTV Parser

    private fun parseXmltv(xml: String): Parsed {
        val reader = XmlReader()
        reader.parse(xml)
        return Parsed(reader.channels, reader.programs, reader.icons, reader.names)
    }

    private data class Program(val start: Int, val stop: Int, val title: String, val desc: String)
    private data class Parsed(val channels: Map<String, String>, val programs: Map<String, List<Program>>,
        val icons: Map<String, String> = emptyMap(), val names: Map<String, List<String>> = emptyMap())

    private class XmlReader : org.xml.sax.helpers.DefaultHandler() {
        val channels = mutableMapOf<String, String>()
        val programs = mutableMapOf<String, MutableList<Program>>()
        val icons = mutableMapOf<String, String>()
        val names = mutableMapOf<String, MutableList<String>>()
        private var currentChannelId: String? = null
        private var currentProgChannel: String? = null
        private var currentProgStart = 0
        private var currentProgStop = 0
        private var currentProgTitle = StringBuilder()
        private var currentProgDesc = StringBuilder()
        private var channelName = StringBuilder()
        private var textTarget: String? = null

        fun parse(xml: String) {
            val factory = javax.xml.parsers.SAXParserFactory.newInstance()
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false)
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            factory.newSAXParser().parse(org.xml.sax.InputSource(java.io.StringReader(xml)), this)
        }

        override fun startElement(uri: String?, local: String?, name: String, attrs: org.xml.sax.Attributes) {
            when (name) {
                "channel" -> currentChannelId = attrs.getValue("id")
                "programme" -> {
                    currentProgChannel = attrs.getValue("channel")
                    currentProgStart = parseTime(attrs.getValue("start") ?: "")
                    currentProgStop = parseTime(attrs.getValue("stop") ?: "")
                    currentProgTitle = StringBuilder(); currentProgDesc = StringBuilder()
                }
                "display-name" -> if (currentChannelId != null) { channelName = StringBuilder(); textTarget = "ch" }
                "title" -> if (currentProgChannel != null) textTarget = "title"
                "desc" -> if (currentProgChannel != null) textTarget = "desc"
                "icon" -> currentChannelId?.let { icons[it] = attrs.getValue("src") ?: "" }
            }
        }

        override fun endElement(uri: String?, local: String?, name: String) {
            when (name) {
                "channel" -> { currentChannelId?.let { channels.putIfAbsent(it, it) }; currentChannelId = null; textTarget = null }
                "display-name" -> {
                    currentChannelId?.let { id ->
                        val value = channelName.toString().trim()
                        if (value.isNotEmpty()) { channels.putIfAbsent(id, value); names.getOrPut(id) { mutableListOf() }.add(value) }
                    }
                    textTarget = null
                }
                "programme" -> {
                    currentProgChannel?.let { if (currentProgTitle.isNotBlank()) {
                        programs.getOrPut(it) { mutableListOf() }.add(Program(currentProgStart, currentProgStop, currentProgTitle.toString(), currentProgDesc.toString()))
                    } }
                    currentProgChannel = null; textTarget = null
                }
                "title", "desc" -> textTarget = null
            }
        }

        override fun characters(chars: CharArray, start: Int, length: Int) {
            when (textTarget) {
                "ch" -> channelName.append(chars, start, length)
                "title" -> currentProgTitle.append(chars, start, length)
                "desc" -> currentProgDesc.append(chars, start, length)
            }
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

    private fun matchScore(a: String, b: String): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        if (a.contains(b) || b.contains(a)) return minOf(a.length, b.length).toDouble() / maxOf(a.length, b.length)
        val aa = a.split(" ").toSet()
        val bb = b.split(" ").toSet()
        val common = aa.intersect(bb).size
        return if (common >= maxOf(2, minOf(aa.size, bb.size) / 2)) common.toDouble() / maxOf(aa.size, bb.size) else 0.0
    }

    private fun resolveXmltvId(channels: Map<String, String>, ch: String?, hash: String,
        tvgName: String? = null, names: Map<String, List<String>> = emptyMap()): String {
        if (hash.isNotEmpty() && channels.containsKey(hash)) return hash
        val candidates = listOfNotNull(tvgName, ch).map { normalize(it) }.filter { it.isNotEmpty() }
        val ids = channels.keys.sorted()
        for (candidate in candidates) {
            ids.firstOrNull { id -> (names[id] ?: listOf(channels[id]!!)).any { normalize(it) == candidate } }?.let { return it }
        }
        var best = ""
        var score = 0.0
        for (candidate in candidates) for (id in ids) for (name in names[id] ?: listOf(channels[id]!!)) {
            val value = normalize(name)
            val next = matchScore(candidate, value)
            if (next >= 0.4 && next > score) { best = id; score = next }
        }
        return best.ifEmpty { hash }
    }

    private fun regionalShift(name: String): Int {
        val match = Regex("""([+-])\s*(\d+)\s*(?:ч|h|hours?)?""", RegexOption.IGNORE_CASE).find(name) ?: return 0
        val hours = match.groupValues[2].toIntOrNull() ?: return 0
        return (if (match.groupValues[1] == "-") -1 else 1) * (if (hours > 24) hours % 24 else hours)
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
        archiveHours: Int,
        tvgName: String? = null
    ): JSObject {
        val xmltvId = resolveXmltvId(parsed.channels, ch, hash, tvgName, parsed.names)
        val progs = parsed.programs[xmltvId] ?: emptyList()
        val now = (System.currentTimeMillis() / 1000).toInt()
        val lookbackH = if (archiveHours > 0) archiveHours else 48
        val windowStart = now - lookbackH * 3600
        val windowEnd = now + 48 * 3600
        val shift = (if (timeShiftHours != 0) timeShiftHours else regionalShift(ch ?: tvgName ?: "")) * 3600

        val epgData = JSObject()
        val list = JSArray()
        for (prog in progs.sortedBy { it.start }) {
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
