import Capacitor
import zlib

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
    private let ttl: TimeInterval = 2 * 3600
    private let defaultURL = "https://cdn.epg.one/epg2.xml.gz"

    private typealias Parsed = (channels: [String: String], programs: [String: [(start: Int, stop: Int, title: String, desc: String)]], icons: [String: String], names: [String: [String]])
    private let sourceLock = NSLock()
    private var parsedCache: [String: (fetched: TimeInterval, data: Parsed)] = [:]
    private var pendingSources: [String: [(Result<Parsed, Error>) -> Void]] = [:]

    private func sourceUrls(_ call: CAPPluginCall) -> [String] {
        let supplied = call.getArray("xmltv_urls", String.self) ?? []
        let single = call.getString("xmltv_url") ?? ""
        let values = supplied.isEmpty ? (single.isEmpty ? [defaultURL] : [single]) : supplied
        var urls: [String] = []
        for value in values {
            let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty && !urls.contains(value) { urls.append(value) }
        }
        return urls.isEmpty ? [defaultURL] : urls
    }

    private func loadSource(_ source: String, force: Bool = false, completion: @escaping (Result<Parsed, Error>) -> Void) {
        guard let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            completion(.failure(NSError(domain: "MobileXmltvEpg", code: -3, userInfo: [NSLocalizedDescriptionKey: "invalid XMLTV URL"])))
            return
        }
        sourceLock.lock()
        if !force, let cached = parsedCache[source], Date().timeIntervalSince1970 - cached.fetched < ttl {
            sourceLock.unlock(); completion(.success(cached.data)); return
        }
        if pendingSources[source] != nil {
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
        if !force, let xml = try? readCache(for: url) {
            finish(.success(parseXmltv(xml))); return
        }
        fetchAndCache(url) { result in
            switch result {
            case .success(let xml): finish(.success(self.parseXmltv(xml)))
            case .failure(let error):
                self.sourceLock.lock()
                let memory = self.parsedCache[source]?.data
                self.sourceLock.unlock()
                if let memory = memory { finish(.success(memory)) }
                else if let xml = try? self.readCache(for: url, allowStale: true) { finish(.success(self.parseXmltv(xml))) }
                else { finish(.failure(error)) }
            }
        }
    }

    // Source order is significant: the first feed defining an ID owns its programs.
    private func loadSources(_ sources: [String], force: Bool = false, completion: @escaping (Result<Parsed, Error>) -> Void) {
        var merged: Parsed = ([:], [:], [:], [:])
        var firstError: Error?
        func next(_ index: Int) {
            if index == sources.count {
                if merged.channels.isEmpty, let error = firstError { completion(.failure(error)) }
                else { completion(.success(merged)) }
                return
            }
            loadSource(sources[index], force: force) { result in
                switch result {
                case .success(let parsed):
                    for (id, name) in parsed.channels where merged.channels[id] == nil {
                        merged.channels[id] = name
                        merged.programs[id] = parsed.programs[id]
                        merged.icons[id] = parsed.icons[id]
                        merged.names[id] = parsed.names[id]
                    }
                case .failure(let error): if firstError == nil { firstError = error }
                }
                next(index + 1)
            }
        }
        next(0)
    }

    @objc func getEpg(_ call: CAPPluginCall) {
        loadSources(sourceUrls(call)) { result in
            switch result {
            case .success(let parsed):
                call.resolve(self.buildSlice(parsed, channelId: call.getString("channel_id") ?? "",
                    ch: call.getString("ch"), hash: call.getString("hash") ?? "",
                    timeShiftHours: call.getInt("time_shift_hours") ?? 0,
                    archiveHours: call.getInt("archive_hours") ?? 0,
                    tvgName: call.getString("tvg_name")))
            case .failure(let error): call.reject(error.localizedDescription)
            }
        }
    }

    @objc func getChannels(_ call: CAPPluginCall) {
        loadSources(sourceUrls(call)) { result in
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
        loadSources(sourceUrls(call), force: true) { result in
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
        guard fields.count == 2, fields[1] == url.absoluteString,
              let fetched = Double(fields[0]),
              allowStale || Date().timeIntervalSince1970 - fetched < ttl else { return nil }
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

    private func fetchAndCache(_ url: URL, completion: @escaping (Result<String, Error>) -> Void) {
        URLSession.shared.dataTask(with: url) { data, response, err in
            if let response = response as? HTTPURLResponse, !(200...299).contains(response.statusCode) {
                completion(.failure(NSError(domain: "MobileXmltvEpg", code: response.statusCode))); return
            }
            if let err = err { completion(.failure(err)); return }
            guard let data = data, !data.isEmpty else {
                completion(.failure(NSError(domain: "MobileXmltvEpg", code: -1, userInfo: [NSLocalizedDescriptionKey: "empty response"])))
                return
            }
            do {
                guard let xml = self.gunzip(data),
                      let xmlStr = String(data: xml, encoding: .utf8) else {
                    completion(.failure(NSError(domain: "MobileXmltvEpg", code: -2, userInfo: [NSLocalizedDescriptionKey: "gunzip failed"])))
                    return
                }
                guard !self.parseXmltv(xmlStr).channels.isEmpty else {
                    completion(.failure(NSError(domain: "MobileXmltvEpg", code: -4, userInfo: [NSLocalizedDescriptionKey: "invalid or empty XMLTV"]))); return
                }
                try self.writeCache(data, for: url)
                completion(.success(xmlStr))
            } catch {
                completion(.failure(error))
            }
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

    private func parseXmltv(_ xml: String) -> Parsed {
        guard let data = xml.data(using: .utf8) else { return ([:], [:], [:], [:]) }
        let parser = XmltvParser()
        parser.parse(data)
        return (parser.channels, parser.programs, parser.icons, parser.names)
    }

    private class XmltvParser: NSObject, XMLParserDelegate {
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

        func parse(_ data: Data) {
            let parser = XMLParser(data: data)
            parser.delegate = self
            if !parser.parse() { channels.removeAll(); programs.removeAll() }
        }

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String]) {
            switch elementName {
            case "channel":
                currentChannelId = attributeDict["id"]
            case "programme":
                currentProgChannel = attributeDict["channel"]
                currentProgStart = parseTime(attributeDict["start"] ?? "")
                currentProgStop = parseTime(attributeDict["stop"] ?? "")
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
                    programs[ch] = (programs[ch] ?? []) + [(currentProgStart, currentProgStop, currentProgTitle, currentProgDesc)]
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

        private func parseTime(_ ts: String) -> Int {
            let trimmed = ts.trimmingCharacters(in: .whitespaces)
            guard trimmed.count >= 14 else { return 0 }
            let datePart = String(trimmed.prefix(14))
            let tzPart = String(trimmed.dropFirst(14)).trimmingCharacters(in: .whitespaces)

            let formatter = DateFormatter()
            formatter.dateFormat = "yyyyMMddHHmmss"
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            guard let date = formatter.date(from: datePart) else { return 0 }
            var unix = Int(date.timeIntervalSince1970)

            if tzPart.count >= 5 {
                let sign: Int = tzPart.hasPrefix("+") ? 1 : (tzPart.hasPrefix("-") ? -1 : 0)
                if sign != 0 {
                    let hours = Int(tzPart.dropFirst().prefix(2)) ?? 0
                    let mins = Int(tzPart.dropFirst(3).prefix(2)) ?? 0
                    unix -= sign * (hours * 3600 + mins * 60)
                }
            }
            return unix
        }
    }

    // MARK: - Channel Resolution + EPG Slice

    private func matchScore(_ a: String, _ b: String) -> Double {
        if a.isEmpty || b.isEmpty { return 0 }
        if a.contains(b) || b.contains(a) { return Double(min(a.count, b.count)) / Double(max(a.count, b.count)) }
        let aa = Set(a.split(whereSeparator: { $0.isWhitespace }))
        let bb = Set(b.split(whereSeparator: { $0.isWhitespace }))
        let common = aa.intersection(bb).count
        return common >= max(2, min(aa.count, bb.count) / 2) ? Double(common) / Double(max(aa.count, bb.count)) : 0
    }

    private func resolveXmltvId(channels: [String: String], ch: String?, hash: String, tvgName: String? = nil, names: [String: [String]] = [:]) -> String {
        if !hash.isEmpty && channels[hash] != nil { return hash }
        let candidates = [tvgName ?? "", ch ?? ""].filter { !$0.isEmpty }.map { normalize($0) }
        let ids = channels.keys.sorted()
        for candidate in candidates where !candidate.isEmpty {
            for id in ids where (names[id] ?? [channels[id]!]).contains(where: { normalize($0) == candidate }) { return id }
        }
        var best = ""
        var score = 0.0
        for candidate in candidates where !candidate.isEmpty {
            for id in ids {
                for name in names[id] ?? [channels[id]!] {
                    let name = normalize(name)
                    let next = matchScore(candidate, name)
                    if next >= 0.4 && next > score { best = id; score = next }
                }
            }
        }
        return best.isEmpty ? hash : best
    }

    private func regionalShift(_ name: String) -> Int {
        let expression = try! NSRegularExpression(pattern: #"([+-])\s*(\d+)\s*(?:ч|h|hours?)?"#, options: .caseInsensitive)
        let value = name as NSString
        guard let match = expression.firstMatch(in: name, range: NSRange(location: 0, length: value.length)),
              let hours = Int(value.substring(with: match.range(at: 2))) else { return 0 }
        return (value.substring(with: match.range(at: 1)) == "-" ? -1 : 1) * (hours > 24 ? hours % 24 : hours)
    }

    private func normalize(_ name: String) -> String {
        var s = name.lowercased()
        s = s.replacingOccurrences(of: #"[+-]\s*\d+\s*(ч|h|hours?)?"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\([^)]*\)"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        s = s.trimmingCharacters(in: .whitespaces)
        s = s.replacingOccurrences(of: #"^(hd|fhd|uhd|4k)\s+"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+(hd|fhd|uhd|4k)$"#, with: "", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespaces)
    }

    private func buildSlice(_ parsed: Parsed, channelId: String, ch: String?, hash: String, timeShiftHours: Int, archiveHours: Int, tvgName: String? = nil) -> [String: Any] {
        let xmltvId = resolveXmltvId(channels: parsed.channels, ch: ch, hash: hash, tvgName: tvgName, names: parsed.names)
        let progs = parsed.programs[xmltvId] ?? []
        let now = Int(Date().timeIntervalSince1970)
        let lookbackH = archiveHours > 0 ? archiveHours : 48
        let windowStart = now - lookbackH * 3600
        let windowEnd = now + 48 * 3600
        let shift = (timeShiftHours != 0 ? timeShiftHours : regionalShift(ch ?? tvgName ?? "")) * 3600

        let epgData: [[String: Any]] = progs.sorted { $0.start < $1.start }.compactMap { prog in
            let start = prog.0 + shift
            let stop = prog.1 + shift
            guard stop > windowStart && start < windowEnd else { return nil }
            return [
                "time": start,
                "time_to": stop,
                "name": prog.2,
                "descr": prog.3,
                "icon": ""
            ]
        }

        return ["epg_data": epgData]
    }
}
