import Capacitor
import zlib
import JavaScriptCore
import CryptoKit

@objc(MobileXmltvEpg)
public class MobileXmltvEpg: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MobileXmltvEpgPlugin"
    public let jsName = "MobileXmltvEpg"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEpg", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getChannels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prefetch", returnType: CAPPluginReturnPromise),
    ]
    private lazy var cacheURL: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("epg2.xml.gz")
    }()
    private lazy var metaURL: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("epg2.meta")
    }()
    private let cacheLock = NSLock()
    private let policyLock = NSLock()
    private var policy: SharedGuide?
    private func withPolicy<T>(_ action: (SharedGuide) throws -> T) throws -> T {
        policyLock.lock()
        defer { policyLock.unlock() }
        if policy == nil { policy = try SharedGuide() }
        return try action(policy!)
    }

    private typealias Parsed = (channels: [String: String], programs: [String: [(start: Int, stop: Int, title: String, desc: String)]], icons: [String: String], names: [String: [String]])
    private let sourceLock = NSLock()
    private var parsedCache: [String: (fetched: TimeInterval, data: Parsed)] = [:]
    private var pendingSources: [String: [(Result<Parsed, Error>) -> Void]] = [:]

    private func sourceUrls(_ call: CAPPluginCall) throws -> [String] {
        try withPolicy { try $0.sources(call.getArray("xmltv_urls", String.self) ?? [], single: call.getString("xmltv_url") ?? "") }
    }

    private func loadSources(_ call: CAPPluginCall, force: Bool = false, completion: @escaping (Result<Parsed, Error>) -> Void) {
        do { loadSources(try sourceUrls(call), force: force, completion: completion) }
        catch { completion(.failure(error)) }
    }

    private func loadSource(_ source: String, force: Bool = false, completion: @escaping (Result<Parsed, Error>) -> Void) {
        guard let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            completion(.failure(NSError(domain: "MobileXmltvEpg", code: -3, userInfo: [NSLocalizedDescriptionKey: "invalid XMLTV URL"])))
            return
        }
        sourceLock.lock()
        let action: String
        do { action = try withPolicy { try $0.lookup(now: Date().timeIntervalSince1970, fetched: parsedCache[source]?.fetched,
            force: force, pending: pendingSources[source] != nil) } }
        catch { sourceLock.unlock(); completion(.failure(error)); return }
        if action == "CACHE", let cached = parsedCache[source] {
            sourceLock.unlock(); completion(.success(cached.data)); return
        }
        if action == "JOIN" {
            pendingSources[source]!.append(completion); sourceLock.unlock(); return
        }
        pendingSources[source] = [completion]
        sourceLock.unlock()
        func finish(_ result: Result<Parsed, Error>) {
            sourceLock.lock()
            if case .success(let parsed) = result { parsedCache[source] = (Date().timeIntervalSince1970, parsed) }
            let callbacks = pendingSources.removeValue(forKey: source) ?? []
            sourceLock.unlock()
            callbacks.forEach { $0(result) }
        }
        var disk: Parsed?
        var memory: Parsed?
        var network: (data: Data, xml: String)?
        var parsedNetwork: Parsed?
        var failure: Error = NSError(domain: "MobileXmltvEpg", code: -4,
            userInfo: [NSLocalizedDescriptionKey: "invalid or empty XMLTV"])
        func next(_ action: String, _ succeeded: Bool, _ channels: Int = 0) throws -> String {
            try self.withPolicy { try $0.loadNext(action, succeeded: succeeded, channels: channels) }
        }
        func perform(_ action: String) {
            do {
                switch action {
                case "READ_FRESH_DISK", "READ_STALE_DISK":
                    let xml = try? self.readCache(for: url, allowStale: action == "READ_STALE_DISK")
                    disk = xml.flatMap { try? self.parseXmltv($0) }
                    perform(try next(action, disk != nil, disk?.channels.count ?? 0))
                case "FETCH":
                    self.fetchXmltv(url) { result in
                        do {
                            switch result {
                            case .success(let response):
                                network = response
                                // The first parse historically maps parser failure to the invalid-XMLTV error.
                                parsedNetwork = try? self.parseXmltv(response.xml)
                                perform(try next(action, parsedNetwork != nil, parsedNetwork?.channels.count ?? 0))
                            case .failure(let error):
                                failure = error
                                perform(try next(action, false))
                            }
                        } catch { finish(.failure(error)) }
                    }
                case "WRITE_DISK":
                    var written = false
                    do { try self.writeCache(network!.data, for: url); written = true }
                    catch { failure = error }
                    perform(try next(action, written))
                case "REPARSE_NETWORK":
                    do { parsedNetwork = try self.parseXmltv(network!.xml) }
                    catch { parsedNetwork = nil; failure = error }
                    perform(try next(action, parsedNetwork != nil, parsedNetwork?.channels.count ?? 0))
                case "READ_MEMORY":
                    self.sourceLock.lock()
                    memory = self.parsedCache[source]?.data
                    self.sourceLock.unlock()
                    perform(try next(action, memory != nil, memory?.channels.count ?? 0))
                case "USE_FRESH_DISK", "USE_STALE_DISK": finish(.success(disk!))
                case "USE_NETWORK": finish(.success(parsedNetwork!))
                case "USE_MEMORY": finish(.success(memory!))
                case "FAIL": finish(.failure(failure))
                default: finish(.failure(NSError(domain: "SharedGuide", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid source load action"])))
                }
            } catch { finish(.failure(error)) }
        }
        do { perform(try withPolicy { try $0.loadStart(force: force) }) }
        catch { finish(.failure(error)) }
    }

    // Source order is significant: the first feed defining an ID owns its programs.
    private func loadSources(_ sources: [String], force: Bool = false, completion: @escaping (Result<Parsed, Error>) -> Void) {
        var merged: Parsed = ([:], [:], [:], [:])
        var errors: [Int: Error] = [:]
        let batch: JavaScriptCore.JSValue
        do { batch = try withPolicy { try $0.sourceBatch(sources.count) } }
        catch { completion(.failure(error)); return }
        func next() {
            do {
                let index = try self.withPolicy { try $0.batchNext(batch) }
                if index < 0 {
                    let failed = try self.withPolicy { try $0.batchFailure(batch) }
                    if failed >= 0 { completion(.failure(errors[failed]!)) }
                    else { completion(.success(merged)) }
                    return
                }
                loadSource(sources[index], force: force) { result in
                    do {
                        switch result {
                        case .success(let parsed):
                            let ids = try self.withPolicy { try $0.unowned(Array(merged.channels.keys), incoming: Array(parsed.channels.keys)) }
                            for id in ids {
                                merged.channels[id] = parsed.channels[id]
                                merged.programs[id] = parsed.programs[id]
                                merged.icons[id] = parsed.icons[id]
                                merged.names[id] = parsed.names[id]
                            }
                            try self.withPolicy { try $0.batchAdvance(batch, succeeded: true, channels: parsed.channels.count) }
                        case .failure(let error):
                            errors[index] = error
                            try self.withPolicy { try $0.batchAdvance(batch, succeeded: false, channels: 0) }
                        }
                        next()
                    } catch { completion(.failure(error)) }
                }
            } catch { completion(.failure(error)) }
        }
        next()
    }

    @objc func getEpg(_ call: CAPPluginCall) {
        loadSources(call) { result in
            switch result {
            case .success(let parsed):
                do { call.resolve(try self.buildSlice(parsed, channelId: call.getString("channel_id") ?? "",
                    ch: call.getString("ch"), hash: call.getString("hash") ?? "",
                    timeShiftHours: call.getInt("time_shift_hours") ?? 0,
                    archiveHours: call.getInt("archive_hours") ?? 0,
                    tvgName: call.getString("tvg_name"))) }
                catch { call.reject(error.localizedDescription) }
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    @objc func getChannels(_ call: CAPPluginCall) {
        loadSources(call) { result in
            switch result {
            case .success(let parsed):
                let rows: [[String: Any]] = parsed.channels.keys.sorted().map { id in
                    ["id": id, "name": parsed.channels[id] ?? id,
                     "names": parsed.names[id] ?? [parsed.channels[id] ?? id], "icon": parsed.icons[id] ?? ""]
                }
                call.resolve(["channels": rows])
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    @objc func prefetch(_ call: CAPPluginCall) {
        loadSources(call, force: true) { result in
            switch result {
            case .success: call.resolve()
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - Cache

    private func readCache(for url: URL, allowStale: Bool = false) throws -> String? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        let meta = try String(contentsOf: metaURL, encoding: .utf8)
        let fields = meta.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        // Timestamp-only metadata predates source tracking and cannot be trusted.
        guard fields.count == 2, let fetched = Double(fields[0]),
              try withPolicy({ try $0.disk(source: url.absoluteString, storedSource: String(fields[1]),
                  now: Date().timeIntervalSince1970, fetched: fetched, stale: allowStale) }) else { return nil }
        let gz = try Data(contentsOf: cacheURL)
        guard let xml = gunzip(gz) else { return nil }
        return String(data: xml, encoding: .utf8)
    }

    private func writeCache(_ data: Data, for url: URL) throws {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        // Invalidate metadata first so an interrupted write cannot label another source's data.
        if FileManager.default.fileExists(atPath: metaURL.path) {
            try FileManager.default.removeItem(at: metaURL)
        }
        try data.write(to: cacheURL, options: .atomic)
        let meta = "\(Date().timeIntervalSince1970)\n\(url.absoluteString)"
        try meta.write(to: metaURL, atomically: true, encoding: .utf8)
    }

    private func fetchXmltv(_ url: URL, completion: @escaping (Result<(data: Data, xml: String), Error>) -> Void) {
        URLSession.shared.dataTask(with: url) { data, response, err in
            if let response = response as? HTTPURLResponse, !(200...299).contains(response.statusCode) {
                completion(.failure(NSError(domain: "MobileXmltvEpg", code: response.statusCode))); return
            }
            if let err = err { completion(.failure(err)); return }
            guard let data = data, !data.isEmpty else {
                completion(.failure(NSError(domain: "MobileXmltvEpg", code: -1, userInfo: [NSLocalizedDescriptionKey: "empty response"])))
                return
            }
            guard let xml = self.gunzip(data),
                  let xmlStr = String(data: xml, encoding: .utf8) else {
                completion(.failure(NSError(domain: "MobileXmltvEpg", code: -2, userInfo: [NSLocalizedDescriptionKey: "gunzip failed"])))
                return
            }
            completion(.success((data, xmlStr)))
        }.resume()
    }

    // MARK: - Gzip

    private func gunzip(_ data: Data) -> Data? {
        // HTTP may already decompress the response; custom XMLTV is often plain XML.
        if !data.starts(with: [0x1f, 0x8b]) {
            guard let text = String(data: data, encoding: .utf8), text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<") else { return nil }
            return data
        }
        let bufferSize = 64 * 1024
        let dstBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { dstBuffer.deallocate() }

        var stream = z_stream()
        let windowBits: Int32 = 16 + MAX_WBITS
        guard inflateInit2_(&stream, windowBits, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            return nil
        }
        defer { inflateEnd(&stream) }

        return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Data? in
            guard let inBase = raw.bindMemory(to: Bytef.self).baseAddress else { return nil }
            stream.next_in = UnsafeMutablePointer(mutating: inBase)
            stream.avail_in = uInt(raw.count)

            var result = Data()
            var ret: Int32 = Z_OK
            repeat {
                stream.next_out = dstBuffer
                stream.avail_out = uInt(bufferSize)
                ret = inflate(&stream, Z_NO_FLUSH)
                if ret != Z_OK && ret != Z_STREAM_END {
                    return nil
                }
                let produced = bufferSize - Int(stream.avail_out)
                if produced > 0 {
                    result.append(dstBuffer, count: produced)
                }
            } while ret != Z_STREAM_END

            return result
        }
    }

    // MARK: - XMLTV Parse

    private func parseXmltv(_ xml: String) throws -> Parsed {
        guard let data = xml.data(using: .utf8) else { return ([:], [:], [:], [:]) }
        let parser = try XmltvParser(core: ())
        try parser.parse(data)
        return (parser.channels, parser.programs, parser.icons, parser.names)
    }

    private class XmltvParser: NSObject, XMLParserDelegate {
        private let guide: SharedGuide
        private var coreError: Error?
        init(core: Void) throws { guide = try SharedGuide(); super.init() }
        var channels: [String: String] = [:]
        var icons: [String: String] = [:]
        var names: [String: [String]] = [:]
        private var channelName = ""
        var programs: [String: [(start: Int, stop: Int, title: String, desc: String)]] = [:]

        private var currentChannelId: String?
        private var currentProgChannel: String?
        private var currentProgStart: Int = 0
        private var currentProgStop: Int = 0
        private var currentProgTitle: String = ""
        private var currentProgDesc: String = ""
        private var textTarget: TextTarget?

        enum TextTarget { case channelName, progTitle, progDesc }

        func parse(_ data: Data) throws {
            let parser = XMLParser(data: data)
            parser.delegate = self
            if !parser.parse() { channels.removeAll(); programs.removeAll() }
            if let error = coreError { throw error }
        }

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String]) {
            switch elementName {
            case "channel":
                currentChannelId = attributeDict["id"]
            case "programme":
                currentProgChannel = attributeDict["channel"]
                do {
                    currentProgStart = try guide.time(attributeDict["start"] ?? "")
                    currentProgStop = try guide.time(attributeDict["stop"] ?? "")
                } catch { coreError = error; parser.abortParsing(); return }
                currentProgTitle = ""
                currentProgDesc = ""
            case "display-name" where currentChannelId != nil:
                channelName = ""
                textTarget = .channelName
            case "icon" where currentChannelId != nil:
                icons[currentChannelId!] = attributeDict["src"] ?? ""
            case "title" where currentProgChannel != nil:
                textTarget = .progTitle
            case "desc" where currentProgChannel != nil:
                textTarget = .progDesc
            default:
                break
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard let target = textTarget else { return }
            switch target {
            case .channelName:
                channelName += string
            case .progTitle:
                currentProgTitle += string
            case .progDesc:
                currentProgDesc += string
            }
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            switch elementName {
            case "channel":
                if let id = currentChannelId, channels[id] == nil { channels[id] = id }
                currentChannelId = nil
                textTarget = nil
            case "programme":
                if let ch = currentProgChannel, !currentProgTitle.isEmpty {
                    programs[ch, default: []].append((currentProgStart, currentProgStop, currentProgTitle, currentProgDesc))
                }
                currentProgChannel = nil
                textTarget = nil
            case "display-name":
                if let id = currentChannelId {
                    let name = channelName.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !name.isEmpty { names[id, default: []].append(name); if channels[id] == nil { channels[id] = name } }
                }
                textTarget = nil
            case "title", "desc": textTarget = nil
            default:
                break
            }
        }

    }

    // MARK: - Channel Resolution + EPG Slice

    private func buildSlice(_ parsed: Parsed, channelId: String, ch: String?, hash: String, timeShiftHours: Int, archiveHours: Int, tvgName: String? = nil) throws -> [String: Any] {
        let guide = try SharedGuide()
        let rows = parsed.channels.keys.sorted().flatMap { id in
            (parsed.names[id] ?? [parsed.channels[id]!]).map { [id, $0.precomposedStringWithCanonicalMapping] }
        }
        let xmltvId = try guide.resolve(rows, id: hash, names: [tvgName ?? "", ch ?? ""].map { $0.precomposedStringWithCanonicalMapping }) ?? hash
        let progs = (parsed.programs[xmltvId] ?? []).sorted { $0.start < $1.start }
        let shift = timeShiftHours != 0 ? timeShiftHours : try guide.shift(ch ?? tvgName ?? "")
        let selection = try guide.slice(progs.map { [Double($0.start), Double($0.stop)] },
            now: Date().timeIntervalSince1970, archive: archiveHours, shift: shift)
        let epgData: [[String: Any]] = selection.map { row in
            let prog = progs[Int(row[0])]
            return ["time": Int(row[1]), "time_to": Int(row[2]), "name": prog.title,
                    "descr": prog.desc, "icon": ""]
        }

        return ["epg_data": epgData]
    }
}

/// JavaScriptCore supplies execution and Swift's grapheme-count primitive only.
/// The bundled compiler output is the same artifact used by the browser and Rust.
private final class SharedGuide {
    private static let source: Result<String, Error> = Result {
        guard let url = Bundle.main.url(forResource: "ottplay-core", withExtension: "js") else {
            throw failure("Missing shared guide resource")
        }
        guard let manifest = Bundle.main.url(forResource: "ottplay-core.manifest", withExtension: "json"),
              let receipt = try JSONSerialization.jsonObject(with: Data(contentsOf: manifest)) as? [String: Any],
              let artifacts = receipt["artifacts"] as? [String: [String: Any]],
              let expected = artifacts["ottplay-core.js"]?["sha256"] as? String else {
            throw failure("Missing shared guide receipt")
        }
        let data = try Data(contentsOf: url)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == expected, let source = String(data: data, encoding: .utf8) else {
            throw failure("Modified shared guide resource")
        }
        return source
    }
    private let context: JSContext
    private let core: JavaScriptCore.JSValue
    private var functions: [String: JavaScriptCore.JSValue] = [:]

    private static func failure(_ message: String) -> Error {
        NSError(domain: "SharedGuide", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    init() throws {
        guard let context = JSContext() else { throw Self.failure("Cannot create shared guide context") }
        context.evaluateScript(try Self.source.get())
        guard context.exception == nil, let core = context.objectForKeyedSubscript("OttPlayCore"), !core.isUndefined else {
            throw Self.failure("Cannot initialize shared guide")
        }
        self.context = context
        self.core = core
    }
    private func checked(_ action: () -> JavaScriptCore.JSValue?) throws -> JavaScriptCore.JSValue {
        context.exception = nil
        guard let value = action(), context.exception == nil, !value.isUndefined else {
            throw Self.failure("Shared guide execution failed")
        }
        return value
    }
    private func call(_ name: String, _ arguments: [Any]) throws -> JavaScriptCore.JSValue {
        if functions[name] == nil { functions[name] = core.forProperty(name) }
        return try checked { functions[name]?.call(withArguments: arguments) }
    }
    func sources(_ supplied: [String], single: String) throws -> [String] {
        let trim: @convention(block) (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let identity: @convention(block) (String) -> String = { $0.precomposedStringWithCanonicalMapping }
        guard let values = try call("nativeGuideSources", [supplied, single, trim, identity]).toArray() as? [String] else {
            throw Self.failure("Invalid shared guide sources")
        }
        return values
    }
    func unowned(_ existing: [String], incoming: [String]) throws -> [String] {
        let identity: @convention(block) (String) -> String = { $0.precomposedStringWithCanonicalMapping }
        guard let values = try call("nativeGuideUnowned", [existing, incoming, identity]).toArray() as? [String] else {
            throw Self.failure("Invalid shared guide ownership")
        }
        return values
    }
    func lookup(now: Double, fetched: Double?, force: Bool, pending: Bool) throws -> String {
        try call("nativeGuideLookup", [now, fetched as Any? ?? NSNull(), force, pending]).toString()
    }
    func disk(source: String, storedSource: String, now: Double, fetched: Double, stale: Bool) throws -> Bool {
        try call("nativeGuideDisk", [source, storedSource, now, fetched, stale]).toBool()
    }
    func loadStart(force: Bool) throws -> String { try call("nativeGuideLoadStart", [force]).toString() }
    func loadNext(_ action: String, succeeded: Bool, channels: Int) throws -> String {
        try call("nativeGuideLoadNext", [action, succeeded, channels, "swift"]).toString()
    }
    func sourceBatch(_ count: Int) throws -> JavaScriptCore.JSValue {
        try checked { core.forProperty("NativeGuideSourceBatch")?.construct(withArguments: [count]) }
    }
    func batchNext(_ batch: JavaScriptCore.JSValue) throws -> Int {
        Int(try checked { batch.invokeMethod("next", withArguments: []) }.toInt32())
    }
    func batchAdvance(_ batch: JavaScriptCore.JSValue, succeeded: Bool, channels: Int) throws {
        // Unit-returning JS methods produce undefined; check the VM exception explicitly.
        context.exception = nil
        batch.invokeMethod("advance", withArguments: [succeeded, channels])
        if context.exception != nil { throw Self.failure("Shared guide execution failed") }
    }
    func batchFailure(_ batch: JavaScriptCore.JSValue) throws -> Int {
        Int(try checked { batch.invokeMethod("failure", withArguments: []) }.toInt32())
    }
    func time(_ input: String) throws -> Int { Int(try call("nativeGuideTime", [input, "swift"]).toDouble()) }
    func shift(_ input: String) throws -> Int { Int(try call("nativeGuideShift", [input, "swift"]).toInt32()) }
    func resolve(_ rows: [[String]], id: String, names: [String]) throws -> String? {
        let measure: @convention(block) (String) -> Int = { $0.count }
        let precision: @convention(block) (Double) -> Double = { $0 }
        let index = try checked { core.forProperty("NativeGuide")?.construct(withArguments: [rows, "swift", measure, precision]) }
        let result = try checked { index.invokeMethod("resolve", withArguments: [id, names]) }
        return result.isNull ? nil : result.toString()
    }
    func slice(_ times: [[Double]], now: Double, archive: Int, shift: Int) throws -> [[Double]] {
        guard let result = try call("nativeGuideSlice", [times, now.rounded(.towardZero), archive, shift]).toArray() as? [[Double]] else {
            throw Self.failure("Invalid shared guide slice")
        }
        return result
    }
}
