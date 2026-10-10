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
import java.io.InputStream
import java.io.FilterInputStream
import java.util.concurrent.TimeUnit
import play.ott.core.NativeGuideSources
import play.ott.core.NativeSourceFormat
import play.ott.core.NativeSourceLoad
import play.ott.core.NativeSourceLoadAction
import play.ott.core.NativeSourceBatch
import play.ott.core.NativeCacheLookup
import play.ott.core.NativeGuideFormat
import play.ott.core.NativeGuideNames
import play.ott.core.NativeGuideEntry
import play.ott.core.NativeGuideIndex
import play.ott.core.NativeGuideWindow
import play.ott.core.NativeRecordRules
import play.ott.core.XmltvRecordFormat
import play.ott.core.XmltvRecords

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

    private var inputByteLimit = 64 * 1024 * 1024
    private var expandedByteLimit = 512 * 1024 * 1024
    private var metadataByteLimit = 8 * 1024

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
        var networkFile: File? = null
        fun finish(result: Result<Parsed>) {
            networkFile?.delete()
            networkFile = null
            val callbacks = synchronized(sourceLock) {
                result.getOrNull()?.let { parsedCache[source] = Pair(System.currentTimeMillis() / 1000, it) }
                pendingSources.remove(source) ?: emptyList()
            }
            callbacks.forEach { it(result) }
        }
        var parsed: Parsed? = null
        var failure: Throwable = IOException("invalid or empty XMLTV")
        fun transition(action: NativeSourceLoadAction, succeeded: Boolean = parsed != null) =
            NativeSourceLoad.next(action, succeeded, parsed?.channels?.size ?: 0, NativeSourceFormat.ANDROID)
        fun dispatch(action: NativeSourceLoadAction) {
            when (action) {
                NativeSourceLoadAction.READ_FRESH_DISK, NativeSourceLoadAction.READ_STALE_DISK -> {
                    parsed = runCatching {
                        readCache(source, allowStale = action == NativeSourceLoadAction.READ_STALE_DISK)
                    }.getOrNull()
                    dispatch(transition(action))
                }
                NativeSourceLoadAction.READ_MEMORY -> {
                    parsed = synchronized(sourceLock) { parsedCache[source]?.second }
                    dispatch(transition(action))
                }
                NativeSourceLoadAction.FETCH -> {
                    parsed = null
                    fun failed(error: Throwable) {
                        networkFile?.delete()
                        networkFile = null
                        failure = error
                        dispatch(transition(action, false))
                    }
                    try {
                        client.newCall(Request.Builder().url(source).build()).enqueue(object : Callback {
                            override fun onFailure(httpCall: Call, e: IOException) { failed(e) }
                            override fun onResponse(httpCall: Call, response: Response) {
                                try {
                                    if (!response.isSuccessful) throw IOException("XMLTV HTTP ${response.code}")
                                    val body = response.body ?: throw IOException("empty XMLTV body")
                                    if (body.contentLength() > inputByteLimit) throw IOException("XMLTV delivered body exceeds size limit")
                                    val file = File.createTempFile("ott-xmltv-", ".tmp", context.cacheDir)
                                    networkFile = file
                                    body.byteStream().use { input ->
                                        file.outputStream().use { output ->
                                            LimitedInput(input, inputByteLimit, "delivered body").copyTo(output, 32 * 1024)
                                        }
                                    }
                                    parsed = file.inputStream().use { parseXmltv(it) }
                                    dispatch(transition(action))
                                } catch (error: Throwable) { failed(error) }
                                finally { response.close() }
                            }
                        })
                    } catch (error: Throwable) { failed(error) }
                }
                NativeSourceLoadAction.WRITE_DISK -> {
                    val written = runCatching { writeCache(networkFile!!, source) }.isSuccess
                    dispatch(transition(action, written))
                }
                NativeSourceLoadAction.USE_FRESH_DISK, NativeSourceLoadAction.USE_NETWORK,
                NativeSourceLoadAction.USE_MEMORY, NativeSourceLoadAction.USE_STALE_DISK ->
                    finish(Result.success(parsed!!))
                NativeSourceLoadAction.FAIL -> finish(Result.failure(failure))
                NativeSourceLoadAction.REPARSE_NETWORK -> error("Unexpected Android source action: $action")
            }
        }
        dispatch(NativeSourceLoad.start(force))
    }

    // The first feed defining an ID owns that channel and its programs.
    private fun loadSources(sources: List<String>, force: Boolean = false, completion: (Result<Parsed>) -> Unit) {
        val channels = mutableMapOf<String, String>()
        val programs = mutableMapOf<String, List<Program>>()
        val icons = mutableMapOf<String, String>()
        val names = mutableMapOf<String, List<String>>()
        val batch = NativeSourceBatch(sources.size)
        val errors = mutableMapOf<Int, Throwable>()
        fun next() {
            val index = batch.next()
            if (index < 0) {
                val failure = batch.failure()
                completion(if (failure >= 0) Result.failure(errors.getValue(failure))
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
                }.onFailure { errors[index] = it }
                batch.advance(result.isSuccess, result.getOrNull()?.channels?.size ?: 0)
                next()
            }
        }
        next()
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
    private fun readCache(sourceUrl: String, allowStale: Boolean = false): Parsed? = synchronized(cacheLock) {
        if (!metaFile.exists() || !cacheFile.exists()) return@synchronized null
        if (metaFile.length() > metadataByteLimit || cacheFile.length() > inputByteLimit) return@synchronized null
        val fields = metaFile.readText().split('\n', limit = 2)
        // Timestamp-only metadata predates source tracking and cannot be trusted.
        if (fields.size != 2) return@synchronized null
        val fetched = fields[0].toLongOrNull() ?: return@synchronized null
        if (!NativeGuideSources.diskAndroid(sourceUrl, fields[1], System.currentTimeMillis() / 1000, fetched, allowStale)) return@synchronized null
        cacheFile.inputStream().use { parseXmltv(it) }
    }

    @Throws(IOException::class)
    private fun writeCache(data: File, sourceUrl: String) = synchronized(cacheLock) {
        if (data.length() > inputByteLimit) throw IOException("XMLTV cache input exceeds size limit")
        val metadata = "${System.currentTimeMillis() / 1000}\n$sourceUrl"
        if (metadata.toByteArray(Charsets.UTF_8).size > metadataByteLimit) throw IOException("XMLTV cache metadata exceeds size limit")
        // Invalidate metadata first so an interrupted write cannot label another source's data.
        if (metaFile.exists() && !metaFile.delete()) throw IOException("cannot invalidate cache metadata")
        data.copyTo(cacheFile, overwrite = true)
        metaFile.writeText(metadata)
    }

    // Bound both downloaded bytes and gzip expansion without materializing the
    // document as a byte array and a second, UTF-16 copy on old Android heaps.
    private class LimitedInput(input: InputStream, private val limit: Int, private val resource: String) : FilterInputStream(input) {
        private var count = 0
        private fun consumed(size: Int): Int {
            if (size > limit - count) throw IOException("XMLTV $resource exceeds size limit")
            if (size > 0) count += size
            return size
        }
        override fun read(): Int {
            val value = `in`.read()
            if (value != -1) consumed(1)
            return value
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            consumed(`in`.read(buffer, offset, minOf(length, limit - count + 1)))
    }

    // MARK: - XMLTV Parser

    private fun parseXmltv(input: InputStream): Parsed {
        val reader = XmlReader()
        val buffered = input.buffered()
        buffered.mark(2)
        val gzip = buffered.read() == 0x1f && buffered.read() == 0x8b
        buffered.reset()
        val expanded = if (gzip) java.util.zip.GZIPInputStream(buffered) else buffered
        LimitedInput(expanded, expandedByteLimit, "expanded document").use { bounded ->
            // SAX may close its input at the root's end before requesting gzip's
            // trailer. Keep ownership here and require CRC/truncation validation.
            val borrowed = object : FilterInputStream(bounded) { override fun close() {} }
            reader.parse(org.xml.sax.InputSource(borrowed.reader(Charsets.UTF_8)))
            val buffer = ByteArray(8192)
            while (bounded.read(buffer) != -1) { /* validate the complete gzip stream */ }
        }
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
        private val records = XmltvRecords(XmltvRecordFormat.ARCHIVED_ANDROID)

        fun parse(xml: org.xml.sax.InputSource) {
            val factory = javax.xml.parsers.SAXParserFactory.newInstance()
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false)
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            factory.newSAXParser().parse(xml, this)
        }

        override fun startElement(uri: String?, local: String?, name: String, attrs: org.xml.sax.Attributes) {
            records.start(name, (0 until attrs.length).associate { attrs.getQName(it) to attrs.getValue(it) })
        }

        override fun endElement(uri: String?, local: String?, name: String) {
            records.end(name)
            for (row in records.drain()) when (row[0]) {
                "channel" -> channels[row[1]] = row[2]
                "name" -> names.getOrPut(row[1]) { mutableListOf() }.add(row[2])
                "icon" -> icons[row[1]] = row[2]
                "programme" -> programs.getOrPut(row[1]) { mutableListOf() }
                    .add(Program(row[2].toInt(), row[3].toInt(), row[4], row[5]))
            }
        }

        override fun characters(chars: CharArray, start: Int, length: Int) {
            records.text(String(chars, start, length))
        }
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
        for (index in NativeRecordRules.order(progs.map { it.start.toDouble() }, XmltvRecordFormat.ARCHIVED_ANDROID)) {
            val prog = progs[index]
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
