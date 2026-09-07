import Capacitor

@objc(MobileXmltvEpg)
public class MobileXmltvEpg: CAPPlugin {
    private let cacheURL: URL
    private let metaURL: URL
    private let ttl: TimeInterval = 2 * 3600
    private let defaultURL = "https://cdn.epg.one/epg2.xml.gz"

    public override func load() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        cacheURL = docs.appendingPathComponent("epg2.xml.gz")
        metaURL = docs.appendingPathComponent("epg2.meta")
    }

    @objc func getEpg(_ call: CAPPluginCall) {
        let urlStr = call.getString("xmltv_url") ?? defaultURL
        let ch = call.getString("ch")
        let hash = call.getString("hash") ?? ""
        let channelId = call.getString("channel_id") ?? ""
        let timeShift = call.getInt("time_shift_hours") ?? 0

        guard let url = URL(string: urlStr) else {
            call.reject("invalid url")
            return
        }

        if let xml = try? readFreshCache() {
            let parsed = parseXmltv(xml)
            call.resolve(buildSlice(parsed, channelId: channelId, ch: ch, hash: hash, timeShiftHours: timeShift))
            return
        }

        fetchAndCache(url) { [weak self] result in
            switch result {
            case .success(let xmlStr):
                let parsed = self?.parseXmltv(xmlStr) ?? ([:], [:])
                call.resolve(self?.buildSlice(parsed, channelId: channelId, ch: ch, hash: hash, timeShiftHours: timeShift) ?? ["epg_data": []])
            case .failure(let err):
                if let stale = try? String(contentsOf: self!.cacheURL),
                   let xml = self?.gunzip(Array(stale.utf8)) {
                    let parsed = self?.parseXmltv(xml) ?? ([:], [:])
                    call.resolve(self?.buildSlice(parsed, channelId: channelId, ch: ch, hash: hash, timeShiftHours: timeShift) ?? ["epg_data": []])
                } else {
                    call.reject(err.localizedDescription)
                }
            }
        }
    }

    @objc func prefetch(_ call: CAPPluginCall) {
        let urlStr = call.getString("xmltv_url") ?? defaultURL
        guard let url = URL(string: urlStr) else {
            call.reject("invalid url")
            return
        }
        fetchAndCache(url) { _ in call.resolve() }
    }

    // MARK: - Cache

    private func readFreshCache() throws -> String? {
        let meta = try? String(contentsOf: metaURL)
        guard let fetched = Double(meta?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""),
              Date().timeIntervalSince1970 - fetched < ttl else { return nil }
        let gz = try Data(contentsOf: cacheURL)
        guard let xml = gunzip(gz) else { return nil }
        return String(data: xml, encoding: .utf8)
    }

    private func fetchAndCache(_ url: URL, completion: @escaping (Result<String, Error>) -> Void) {
        URLSession.shared.dataTask(with: url) { data, _, err in
            if let err = err { completion(.failure(err)); return }
            guard let data = data, !data.isEmpty else {
                completion(.failure(NSError(domain: "MobileXmltvEpg", code: -1, userInfo: [NSLocalizedDescriptionKey: "empty response"])))
                return
            }
            do {
                try data.write(to: self.cacheURL)
                try String(Date().timeIntervalSince1970.description).write(toFile: self.metaURL.path, atomically: true, encoding: .utf8)
                guard let xml = self.gunzip(data),
                      let xmlStr = String(data: xml, encoding: .utf8) else {
                    completion(.failure(NSError(domain: "MobileXmltvEpg", code: -2, userInfo: [NSLocalizedDescriptionKey: "gunzip failed"])))
                    return
                }
                completion(.success(xmlStr))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    // MARK: - Gzip

    private func gunzip(_ data: Data) -> Data? {
        let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { stream.deallocate() }

        guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_GZIP) != COMPRESSION_STATUS_ERROR else {
            return nil
        }
        defer { compression_stream_destroy(stream) }

        stream.pointee.src_ptr = (data as NSData).bytes.bindMemory(to: UInt8.self, capacity: data.count)
        stream.pointee.src_size = data.count

        let bufferSize = 64 * 1024
        let dstBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { dstBuffer.deallocate() }

        var result = Data()
        repeat {
            stream.pointee.dst_ptr = dstBuffer
            stream.pointee.dst_size = bufferSize
            let status = compression_stream_process(stream, 0)
            if status == COMPRESSION_STATUS_ERROR { return nil }
            let produced = bufferSize - stream.pointee.dst_size
            if produced > 0 {
                result.append(dstBuffer, count: produced)
            }
        } while stream.pointee.status != COMPRESSION_STATUS_END

        return result
    }

    // MARK: - XMLTV Parse

    private func parseXmltv(_ xml: String) -> (channels: [String: String], programs: [String: [(start: Int, stop: Int, title: String, desc: String)]]) {
        guard let data = xml.data(using: .utf8) else { return ([:], [:]) }
        let parser = XmltvParser()
        parser.parse(data)
        return (parser.channels, parser.programs)
    }

    private class XmltvParser: NSObject, XMLParserDelegate {
        var channels: [String: String] = [:]
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
            parser.parse()
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
                textTarget = .channelName
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
                if let id = currentChannelId {
                    channels[id] = (channels[id] ?? "") + string
                }
            case .progTitle:
                currentProgTitle += string
            case .progDesc:
                currentProgDesc += string
            }
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            switch elementName {
            case "channel":
                currentChannelId = nil
                textTarget = nil
            case "programme":
                if let ch = currentProgChannel, !currentProgTitle.isEmpty {
                    programs[ch] = (programs[ch] ?? []) + [(currentProgStart, currentProgStop, currentProgTitle, currentProgDesc)]
                }
                currentProgChannel = nil
                textTarget = nil
            case "title", "desc", "display-name":
                textTarget = nil
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

    private func resolveXmltvId(channels: [String: String], ch: String?, hash: String) -> String {
        if let name = ch, !name.isEmpty {
            let normalized = normalize(name)
            // Exact match after normalization
            for (id, channelName) in channels {
                if normalize(channelName) == normalized {
                    return id
                }
            }
            // Substring fallback
            let lower = name.lowercased()
            for (id, channelName) in channels {
                if channelName.lowercased().contains(lower) {
                    return id
                }
            }
        }
        if !hash.isEmpty {
            if channels[hash] != nil { return hash }
            return hash
        }
        return hash
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

    private func buildSlice(_ parsed: (channels: [String: String], programs: [String: [(start: Int, stop: Int, title: String, desc: String)]]), channelId: String, ch: String?, hash: String, timeShiftHours: Int) -> [String: Any] {
        let xmltvId = resolveXmltvId(channels: parsed.channels, ch: ch, hash: hash)
        let progs = parsed.programs[xmltvId] ?? []
        let now = Int(Date().timeIntervalSince1970)
        let windowStart = now - 48 * 3600
        let windowEnd = now + 48 * 3600
        let shift = timeShiftHours * 3600

        let epgData: [[String: Any]] = progs.compactMap { prog in
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
