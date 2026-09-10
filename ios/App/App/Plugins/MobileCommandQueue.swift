//
//  MobileCommandQueue.swift - Capacitor plugin for native HTTP command queue
//  Prefers 127.0.0.1:18081; falls back through 18082..=18090 when busy (Cap+Tauri
//  coexistence on one Mac). Pin with OTTPLAY_QUEUE_PORT. Same contract as local_proxy.py:
//  - GET  /api/webhook/health (alias /webhook/health) — status/backend/port (no drain)
//  - POST /api/webhook/commands (alias /webhook/notify) — enqueue JSON body; attach ts; optional ?device_id=
//  - GET /api/webhook/commands (alias /webhook/poll) — return pending array then clear; expire entries >60s
//  - CORS headers; OPTIONS handling
//  - Caps: per-device 50 (trim to 25), broadcast 100 (trim to 50)
//
import Capacitor
import Foundation
import Network
import os

/// Command queue entry with timestamp
struct CommandEntry {
    let data: [String: Any]
    let timestamp: TimeInterval
}

@objc(MobileCommandQueue)
public class MobileCommandQueue: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MobileCommandQueuePlugin"
    public let jsName = "MobileCommandQueue"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "post", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isRunning", returnType: CAPPluginReturnPromise),
    ]

    private var listener: NWListener?
    private var isRunningFlag = false
    private var boundPort: UInt16 = 0
    private let defaultPort: UInt16 = 18081
    private let fallbackEnd: UInt16 = 18090
    private let backendId = "capacitor"
    private let expireSecs: TimeInterval = 60.0
    private let deviceCap = 50
    private let deviceTrim = 25
    private let broadcastCap = 100
    private let broadcastTrim = 50

    private var deviceCommands: [String: [CommandEntry]] = [:]
    private var broadcastCommands: [CommandEntry] = []

    private let queue = DispatchQueue(label: "MobileCommandQueue.queue", qos: .background)
    private let logger = Logger(subsystem: "play.ott.foss", category: "MobileCommandQueue")

    public override func load() {
        // capacitor.config / docs: auto-start Mode B loopback on plugin load.
        startListener { _, _ in }
    }

    @objc func start(_ call: CAPPluginCall) {
        startListener { [weak self] ok, err in
            if let err = err {
                call.reject(err)
            } else {
                call.resolve(["running": true, "port": self?.boundPort ?? 0])
            }
        }
    }

    private func portsToTry() -> [UInt16] {
        if let env = ProcessInfo.processInfo.environment["OTTPLAY_QUEUE_PORT"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty,
           let p = UInt16(env),
           p > 0 {
            return [p]
        }
        return Array(defaultPort...fallbackEnd)
    }

    /// Probe whether 127.0.0.1:port is free (TOCTOU-acceptable for Mode B loopback).
    private func canBindLoopback(port: UInt16) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return bindResult == 0
    }

    private func startListener(completion: @escaping (_ ok: Bool, _ error: String?) -> Void) {
        queue.async { [weak self] in
            guard let self = self else { return }

            if self.isRunningFlag {
                let port = self.boundPort
                self.notifyListeners("isRunning", data: ["running": true, "port": port])
                DispatchQueue.main.async { completion(true, nil) }
                return
            }

            let ports = self.portsToTry()
            var lastError = "no ports to try"
            for port in ports {
                guard self.canBindLoopback(port: port) else {
                    self.logger.info("Command queue port \(port) busy, trying next")
                    lastError = "127.0.0.1:\(port) busy"
                    continue
                }
                guard let nwPort = NWEndpoint.Port(rawValue: port) else {
                    lastError = "invalid port \(port)"
                    continue
                }
                do {
                    let params = NWParameters.tcp
                    params.requiredLocalEndpoint = NWEndpoint.hostPort(
                        host: "127.0.0.1",
                        port: nwPort
                    )

                    self.listener = try NWListener(using: params)

                    self.listener?.stateUpdateHandler = { [weak self] state in
                        if case .failed(_) = state {
                            self?.logger.error("Listener failed")
                            self?.isRunningFlag = false
                            self?.boundPort = 0
                        }
                    }

                    self.listener?.newConnectionHandler = { [weak self] connection in
                        self?.handleConnection(connection)
                    }

                    self.isRunningFlag = true
                    self.boundPort = port
                    self.listener?.start(queue: self.queue)

                    self.logger.info("Command queue listener started on 127.0.0.1:\(port)")

                    DispatchQueue.main.async { [weak self] in
                        self?.notifyListeners("isRunning", data: ["running": true, "port": port])
                        completion(true, nil)
                    }
                    return
                } catch {
                    self.logger.error("Failed to start listener on \(port): \(error)")
                    lastError = error.localizedDescription
                    self.listener = nil
                }
            }

            self.logger.error("Failed to bind any command-queue port in \(ports): \(lastError)")
            DispatchQueue.main.async {
                completion(false, "Failed to start HTTP server: \(lastError)")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self, self.isRunningFlag else {
                DispatchQueue.main.async { call.resolve() }
                return
            }

            self.listener?.cancel()
            self.listener = nil
            self.isRunningFlag = false
            self.boundPort = 0
            self.deviceCommands.removeAll()
            self.broadcastCommands.removeAll()

            self.logger.info("Command queue stopped")
            DispatchQueue.main.async { [weak self] in
                self?.notifyListeners("isRunning", data: ["running": false])
                call.resolve()
            }
        }
    }

    @objc func isRunning(_ call: CAPPluginCall) {
        call.resolve(["running": isRunningFlag, "port": boundPort])
    }

    @objc func post(_ call: CAPPluginCall) {
        guard var commandDict = call.getObject("data") as? [String: Any] else {
            call.reject("No data provided")
            return
        }

        let deviceId: String = call.options?["deviceId"] as? String ?? ""

        queue.async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async { call.reject("Plugin released") }
                return
            }

            let timestamp = Date().timeIntervalSince1970
            commandDict["ts"] = timestamp

            let entry = CommandEntry(data: commandDict, timestamp: timestamp)

            var queued: Int
            if deviceId.isEmpty {
                self.broadcastCommands.append(entry)
                if self.broadcastCommands.count > self.broadcastCap {
                    let drop = self.broadcastCommands.count - self.broadcastTrim
                    self.broadcastCommands.removeFirst(drop)
                }
                queued = self.broadcastCommands.count
            } else {
                if self.deviceCommands[deviceId] == nil {
                    self.deviceCommands[deviceId] = []
                }
                self.deviceCommands[deviceId]?.append(entry)
                if self.deviceCommands[deviceId]?.count ?? 0 > self.deviceCap {
                    let drop = (self.deviceCommands[deviceId]?.count ?? 0) - self.deviceTrim
                    self.deviceCommands[deviceId]?.removeFirst(drop)
                }
                queued = self.deviceCommands[deviceId]?.count ?? 0
            }

            DispatchQueue.main.async {
                call.resolve(["queued": queued])
            }
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        let deviceId: String = call.options?["deviceId"] as? String ?? ""

        queue.async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async { call.reject("Plugin released") }
                return
            }

            let cutoff = Date().timeIntervalSince1970 - self.expireSecs

            var result: [[String: Any]] = []

            if deviceId.isEmpty {
                let recent = self.broadcastCommands.filter { $0.timestamp > cutoff }
                let dicts = recent.compactMap { $0.data as? [String: Any] }
                result = dicts
                self.broadcastCommands.removeAll()
            } else {
                let entries = self.deviceCommands[deviceId] ?? []
                let recent = entries.filter { $0.timestamp > cutoff }
                let dicts = recent.compactMap { $0.data as? [String: Any] }
                result = dicts
                self.deviceCommands[deviceId] = []
            }

            DispatchQueue.main.async {
                call.resolve(["commands": result])
            }
        }
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(connection, accumulated: Data())
    }

    private func receiveRequest(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }

            if let error = error {
                self.logger.error("Receive error: \(error)")
                connection.cancel()
                return
            }

            var buffer = accumulated
            if let data = data, !data.isEmpty {
                buffer.append(data)
            }

            if let raw = String(data: buffer, encoding: .utf8), raw.contains("\r\n\r\n") {
                self.processRequest(raw, connection: connection)
                return
            }

            if isComplete {
                if let raw = String(data: buffer, encoding: .utf8), !raw.isEmpty {
                    self.processRequest(raw, connection: connection)
                } else {
                    connection.cancel()
                }
                return
            }

            if data == nil || data?.isEmpty == true {
                connection.cancel()
                return
            }

            self.receiveRequest(connection, accumulated: buffer)
        }
    }

    private func processRequest(_ raw: String, connection: NWConnection) {
        let lines = raw.components(separatedBy: CharacterSet.newlines)
        guard let requestLine = lines.first, !requestLine.isEmpty else {
            sendResponse(connection, status: 400, body: ["error": "Invalid request", "len": raw.count])
            return
        }

        let components = requestLine.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard components.count >= 3 else {
            sendResponse(connection, status: 400, body: ["error": "Invalid request line", "line": requestLine])
            return
        }

        let method = components[0]
        let rawPath = components[1]
        let path = rawPath.split(separator: "?").first.map(String.init) ?? rawPath

        let deviceId = extractDeviceId(from: rawPath)

        if method == "OPTIONS" {
            sendCorsResponse(connection)
            return
        }

        if method == "GET" && (path == "/api/webhook/health" || path == "/webhook/health") {
            sendResponse(connection, status: 200, body: [
                "status": "ok",
                "service": "ottplay-command-queue",
                "backend": backendId,
                "port": boundPort,
            ])
            return
        }

        if method == "POST" && (path == "/api/webhook/commands" || path == "/webhook/notify") {
            handlePostBody(raw, connection: connection, deviceId: deviceId)
        } else if method == "GET" && (path == "/api/webhook/commands" || path == "/webhook/poll") {
            handleGetFromRequest(deviceId: deviceId, connection: connection)
        } else {
            sendResponse(connection, status: 404, body: ["error": "Not Found", "path": path])
        }
    }

    private func handlePostBody(_ raw: String, connection: NWConnection, deviceId: String) {
        guard let headersEnd = raw.range(of: "\r\n\r\n") else {
            sendResponse(connection, status: 400, body: ["error": "Missing headers"])
            return
        }

        let body = String(raw[headersEnd.upperBound...])

        queue.async { [weak self] in
            guard let self = self else { return }

            let timestamp = Date().timeIntervalSince1970
            var commandDict: [String: Any] = [:]

            if let data = body.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] {
                commandDict = parsed
            }

            commandDict["ts"] = timestamp

            let entry = CommandEntry(data: commandDict, timestamp: timestamp)

            var queued: Int
            if deviceId.isEmpty {
                self.broadcastCommands.append(entry)
                if self.broadcastCommands.count > self.broadcastCap {
                    let drop = self.broadcastCommands.count - self.broadcastTrim
                    self.broadcastCommands.removeFirst(drop)
                }
                queued = self.broadcastCommands.count
            } else {
                if self.deviceCommands[deviceId] == nil {
                    self.deviceCommands[deviceId] = []
                }
                self.deviceCommands[deviceId]?.append(entry)
                if self.deviceCommands[deviceId]?.count ?? 0 > self.deviceCap {
                    let drop = (self.deviceCommands[deviceId]?.count ?? 0) - self.deviceTrim
                    self.deviceCommands[deviceId]?.removeFirst(drop)
                }
                queued = self.deviceCommands[deviceId]?.count ?? 0
            }

            sendResponse(connection, status: 200, body: ["status": "ok", "queued": queued])
        }
    }

    private func handleGetFromRequest(deviceId: String, connection: NWConnection) {
        queue.async { [weak self] in
            guard let self = self else { return }

            let cutoff = Date().timeIntervalSince1970 - self.expireSecs

            var result: [[String: Any]] = []

            if deviceId.isEmpty {
                let recent = self.broadcastCommands.filter { $0.timestamp > cutoff }
                let dicts = recent.compactMap { $0.data as? [String: Any] }
                result = dicts
                self.broadcastCommands.removeAll()
            } else {
                let entries = self.deviceCommands[deviceId] ?? []
                let recent = entries.filter { $0.timestamp > cutoff }
                let dicts = recent.compactMap { $0.data as? [String: Any] }
                result = dicts
                self.deviceCommands[deviceId] = []
            }

            sendResponse(connection, status: 200, body: result)
        }
    }

    private func extractDeviceId(from path: String) -> String {
        guard let queryStart = path.firstIndex(of: "?") else { return "" }
        let query = String(path[path.index(after: queryStart)...])
        for pair in query.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            if parts.count == 2, String(parts[0]) == "device_id" {
                return String(parts[1]).trimmingCharacters(in: .whitespaces)
            }
        }
        return ""
    }

    private func sendResponse(_ connection: NWConnection, status: Int, body: Any) {
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: body)
            var headers = [
                "Access-Control-Allow-Origin: *",
                "Access-Control-Allow-Methods: GET, POST, OPTIONS",
                "Access-Control-Allow-Headers: *",
                "Access-Control-Max-Age: 86400",
                "Content-Type: application/json; charset=utf-8"
            ]

            var response = "HTTP/1.1 \(status) \(status == 200 ? "OK" : status == 400 ? "Bad Request" : "Not Found")\r\n"
            for h in headers {
                response += "\(h)\r\n"
            }
            response += "Content-Length: \(jsonData.count)\r\n"
            response += "\r\n"

            var fullResponse = Data(response.utf8)
            fullResponse.append(jsonData)

            connection.send(content: fullResponse, completion: .contentProcessed { _ in
                connection.cancel()
            })
        } catch {
            logger.error("Failed to serialize response: \(error)")
            connection.send(content: "HTTP/1.1 500 Internal Server Error\r\n\r\n".data(using: .utf8)!, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func sendCorsResponse(_ connection: NWConnection) {
        var response = "HTTP/1.1 200 OK\r\n"
        response += "Access-Control-Allow-Origin: *\r\n"
        response += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        response += "Access-Control-Allow-Headers: *\r\n"
        response += "Access-Control-Max-Age: 86400\r\n"
        response += "Content-Length: 0\r\n"
        response += "\r\n"

        connection.send(content: response.data(using: .utf8)!, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
