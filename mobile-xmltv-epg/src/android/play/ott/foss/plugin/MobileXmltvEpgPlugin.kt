package play.ott.foss.plugin

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import play.ott.foss.BuildConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import play.ott.core.NativeGuideSources
import play.ott.core.NativeSourceFormat
import play.ott.core.NativeCacheLookup
import play.ott.core.NativeGuideClock
import play.ott.core.NativeGuideFormat
import play.ott.core.NativeGuideNames
import play.ott.core.NativeGuideEntry
import play.ott.core.NativeGuideIndex
import play.ott.core.NativeGuideWindow

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

    private val sourceLock = Any()
    private val parsedCache = mutableMapOf<String, Pair<Long, Parsed>>()
    private val pendingSources = mutableMapOf<String, MutableList<(Result<Parsed>) -> Unit>>()

    private fun sourceUrls(call: PluginCall): List<String> {
        val supplied = call.getArray("xmltv_urls")
        return NativeGuideSources.urls(
            (0 until (supplied?.length() ?: 0)).map { supplied!!.optString(it) },
            call.getString("xmltv_url") ?: "", BuildConfig.BUNDLED_EPG_DEFAULTS, NativeSourceFormat.ANDROID)
    }

    private fun loadSource(source: String, force: Boolean = false, completion: (Result<Parsed>) -> Unit) {
        if (!source.startsWith("http://") && !source.startsWith("https://")) {
            completion(Result.failure(IOException("invalid XMLTV URL"))); return
        }
        synchronized(sourceLock) {
            val cached = parsedCache[source]
            when (NativeGuideSources.lookupAndroid(System.currentTimeMillis() / 1000, cached?.first, force, pendingSources.containsKey(source))) {
                NativeCacheLookup.CACHE -> { completion(Result.success(cached!!.second)); return }
                NativeCacheLookup.JOIN -> { pendingSources[source]!!.add(completion); return }
                NativeCacheLookup.LOAD -> Unit
            }
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
            val parsed = fresh?.let { runCatching { parseXmltv(it) }.getOrNull() }
            // A readable disk entry can still be truncated or contain a non-XMLTV document.
            if (parsed != null && parsed.channels.isNotEmpty()) { finish(Result.success(parsed)); return }
        }
        fun failed(error: Throwable) {
            val memory = synchronized(sourceLock) { parsedCache[source]?.second }
            if (memory != null) { finish(Result.success(memory)); return }
            val stale = try { readCache(source, allowStale = true) } catch (_: Throwable) { null }
            val parsed = stale?.let { runCatching { parseXmltv(it) }.getOrNull() }
            finish(if (parsed != null && parsed.channels.isNotEmpty()) Result.success(parsed) else Result.failure(error))
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
                    NativeGuideSources.unowned(channels.keys, parsed.channels.keys.toList()).forEach { id ->
                        val name = parsed.channels.getValue(id)
                        channels[id] = name
                        programs[id] = parsed.programs[id] ?: emptyList()
                        icons[id] = parsed.icons[id] ?: ""
                        names[id] = parsed.names[id] ?: listOf(name)
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
        if (fields.size != 2) return@synchronized null
        val fetched = fields[0].toLongOrNull() ?: return@synchronized null
        if (!NativeGuideSources.diskAndroid(sourceUrl, fields[1], System.currentTimeMillis() / 1000, fetched, allowStale)) return@synchronized null
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

        private val guideClock = NativeGuideClock(NativeGuideFormat.ARCHIVED_ANDROID)
        private fun parseTime(ts: String): Int = guideClock.seconds(ts).toInt()
    }

    // MARK: - Channel resolution + EPG slice

    private fun resolveXmltvId(channels: Map<String, String>, ch: String?, hash: String,
        tvgName: String? = null, names: Map<String, List<String>> = emptyMap()): String {
        val rows = channels.keys.sorted().flatMap { id ->
            (names[id] ?: listOf(channels[id]!!)).ifEmpty { listOf("") }.map { NativeGuideEntry(id, it) }
        }
        return NativeGuideIndex(rows, NativeGuideFormat.ARCHIVED_ANDROID)
            .resolve(hash, listOfNotNull(tvgName, ch)) ?: hash
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
        val hours = if (timeShiftHours != 0) timeShiftHours else NativeGuideNames.regionalShift(ch ?: tvgName ?: "", NativeGuideFormat.ARCHIVED_ANDROID)
        val window = NativeGuideWindow(now.toDouble(), archiveHours.toDouble(), hours.toDouble())

        val epgData = JSObject()
        val list = JSArray()
        for (prog in progs.sortedBy { it.start }) {
            val start = (prog.start + window.shift).toInt()
            val stop = (prog.stop + window.shift).toInt()
            if (!window.includes(prog.start.toDouble(), prog.stop.toDouble())) continue
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
