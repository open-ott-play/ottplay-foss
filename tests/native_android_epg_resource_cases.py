"""Small fixture adapters and bounded-heap Android XMLTV regression cases."""

KOTLIN_ADAPTERS = r'''
    private fun parseFixture(xml: String): Parsed = parseXmltv(xml.byteInputStream(Charsets.UTF_8))
    private fun expandedFixture(data: ByteArray): ByteArray? = try {
        if (data.size >= 2 && data[0] == 0x1f.toByte() && data[1] == 0x8b.toByte())
            java.util.zip.GZIPInputStream(data.inputStream()).use { it.readBytes() }
        else data
    } catch (_: Exception) { null }
    private fun readCacheText(source: String, allowStale: Boolean = false): String? {
        if (readCache(source, allowStale) == null) return null
        return String(expandedFixture(cacheFile.readBytes())!!, Charsets.UTF_8)
    }
    private fun writeCacheFixture(data: ByteArray, source: String) {
        val file = File.createTempFile("fixture-cache-", ".tmp", context.cacheDir)
        try { file.writeBytes(data); writeCache(file, source) } finally { file.delete() }
    }
'''

KOTLIN_RESOURCE_TESTS = r'''
    fun runResourceTests() {
        val dir = java.nio.file.Files.createTempDirectory("epg-resource-test").toFile()
        context = com.getcapacitor.Context(dir, dir)
        fun clean() = check(dir.listFiles()!!.none { it.name.startsWith("ott-xmltv-") })
        fun padded(size: Int): InputStream {
            val padding = object: InputStream() {
                var remaining = size
                override fun read(): Int = if (remaining-- > 0) 32 else -1
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    if (length == 0) return 0
                    if (remaining <= 0) return -1
                    val count = minOf(length, remaining)
                    java.util.Arrays.fill(buffer, offset, offset + count, 32.toByte())
                    remaining -= count
                    return count
                }
            }
            return java.io.SequenceInputStream(java.util.Collections.enumeration(listOf(
                "<tv>".byteInputStream(), padding,
                "<channel id=\"a\"><display-name>Safe</display-name></channel></tv>".byteInputStream()
            )))
        }
        fun request(source: String, expected: Boolean) {
            val call = PluginCall(source)
            getChannels(call)
            check(call.resolved == expected && call.rejected != expected) { "$source: ${call.rejection}" }
            check(call.resolveCount + call.rejectCount == 1)
            clean()
        }
        try {
            okhttp3.Fixture.reset()
            okhttp3.Fixture.stream = { padded(24 * 1024 * 1024) }
            request("https://stream.invalid/plain", true)
            check(okhttp3.Fixture.closed == 1)
            parsedCache.clear()
            okhttp3.Fixture.stream = null
            request("https://stream.invalid/plain", true) // parse the real disk cache
            check(okhttp3.Fixture.requests == 1)

            val gzip = File(dir, "fixture.gz")
            java.util.zip.GZIPOutputStream(gzip.outputStream()).use { output ->
                padded(24 * 1024 * 1024).use { it.copyTo(output) }
            }
            okhttp3.Fixture.stream = { gzip.inputStream() }
            okhttp3.Fixture.length = gzip.length()
            request("https://stream.invalid/gzip", true)
            parsedCache.clear()
            okhttp3.Fixture.stream = null
            request("https://stream.invalid/gzip", true)
            println("PASS Kotlin XMLTV: 24 MiB plain/gzip network and disk inputs under a 64 MiB heap")

            inputByteLimit = 1024
            okhttp3.Fixture.stream = { error("Declared overflow must not open the stream") }
            okhttp3.Fixture.length = 1025
            request("https://stream.invalid/declared", false)
            okhttp3.Fixture.stream = { padded(2048) }
            okhttp3.Fixture.length = -1
            request("https://stream.invalid/chunked", false)

            inputByteLimit = 64 * 1024 * 1024
            expandedByteLimit = 1024
            okhttp3.Fixture.stream = { gzip.inputStream() }
            request("https://stream.invalid/expanded", false)
            expandedByteLimit = 512 * 1024 * 1024
            okhttp3.Fixture.stream = null
            okhttp3.Fixture.data = gzip.readBytes().dropLast(4).toByteArray()
            request("https://stream.invalid/truncated-gzip", false)

            okhttp3.Fixture.data = "<tv><channel id=\"b\"><display-name>After failure</display-name></channel></tv>".toByteArray()
            inputByteLimit = okhttp3.Fixture.data!!.size
            request("https://stream.invalid/recovery", true)
            check(okhttp3.Fixture.closed == okhttp3.Fixture.requests)
            parsedCache.clear()
            metaFile.writeText("x".repeat(metadataByteLimit + 1))
            check(readCache("https://stream.invalid/recovery") == null)
            println("PASS Kotlin XMLTV: declared/chunked/expanded limits, gzip errors, stream closure, temporary cleanup, recovery")
        } finally { okhttp3.Fixture.reset(); dir.deleteRecursively() }
    }
'''
