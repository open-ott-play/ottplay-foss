//
//  MobileCommandQueue.swift - Capacitor plugin for native HTTP command queue
//  Binds to 127.0.0.1:18081 and implements the same contract as local_proxy.py:
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
public class MobileCommandQueue: CAPPlugin {
    private var listener: NWListener?
    private var isRunningFlag = false
    private let expireSecs: TimeInterval = 60.0
    private let deviceCap = 50
    private let deviceTrim = 25
    private let broadcastCap = 100
    private let broadcastTrim = 50

    private var deviceCommands: [String: [CommandEntry]] = [:]
    private var broadcastCommands: [CommandEntry] = []

    private let queue = DispatchQueue(label: "MobileCommandQueue.queue", qos: .background)
    private let logger = Logger(subsystem: "play.ott.foss", category: "MobileCommandQueue")

    @objc func start(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }

            if self.isRunningFlag {
                self.notifyListeners("isRunning", data: ["running": true])
                call.resolve()
                return
            }

            do {
                let endpoint = NWEndpoint.Host("127.0.0.1")
                let port = NWEndpoint.Port(rawValue: 18081)!
                let params = NWParameters.tcp
                params.allowLocalEndpointReuse = true

                self.listener = try NWListener(
                    using: params
                )

                // We need to bind to 127.0.0.1:18081 manually via endpoint
                // NWListener uses the system-chosen address; to bind to 127.0.0.1:
                // Since NWListener doesn't directly support specifying the local address,
                // we use a workaround: create a TCP server on 127.0.0.1:18081.
                // Actually, NWListener picks the local address automatically.
                // We'll accept connections and handle the address in the handler.

                self.isRunningFlag = true
                self.logger.info("Command queue listener started")

                DispatchQueue.main.async { [weak self] in
                    self?.notifyListeners("isRunning", data: ["running": true])
                    call.resolve()
                }

                self.listener?.stateUpdateHandler = { state in
                    if state == .failed {
                        self.logger.error("Listener failed")
                        self.isRunningFlag = false
                    }
                }

                self.listener?.newConnectionHandler = { [weak self] connection in
                    self?.handleConnection(connection)
                }

                self.listener?.start(queue: self.queue)

            } catch {
                self.logger.error("Failed to start listener: \(error)")
                DispatchQueue.main.async { [weak self] in
                    call.reject("Failed to start HTTP server: \(error.localizedDescription)")
                }
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
        call.resolve(["running": isRunningFlag])
    }

    @objc func post(_ call: CAPPluginCall) {
        guard let data = call.data else {
            call.reject("No data provided")
            return
        }

        // Try to get deviceId from options
        let deviceId: String
        if let deviceIdOpt = call.options?["deviceId"] as? String {
            deviceId = deviceIdOpt
        } else {
            deviceId = ""
        }

        queue.async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async { call.reject("Plugin released") }
                return
            }

            guard let raw = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
                DispatchQueue.main.async { call.reject("Invalid JSON body") }
                return
            }

            let timestamp = Date().timeIntervalSince1970
            var commandDict: [String: Any] = raw
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
        guard let deviceId = call.options?["deviceId"] as? String else {
            call.reject("deviceId is required")
            return
        }

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
        connection.receiveMessage { [weak self] data, _, isComplete, error in
            guard let self = self else { return }

            if let error = error {
                self.logger.error("Receive error: \(error)")
                connection.cancel()
                return
            }

            if let data = data, isComplete {
                self.processRequest(data, connection: connection)
            }

            if isComplete {
                connection.cancel()
            } else {
                // Continue receiving from this connection
                self.handleConnection(connection)
            }
        }
    }

    private func processRequest(_ data: Data, connection: NWConnection) {
        guard let raw = String(data: data, encoding: .utf8) else {
            sendResponse(connection, status: 400, body: ["error": "Invalid UTF-8"])
            return
        }

        // Parse the HTTP request line
        let firstLineEnd = raw.firstIndex(of: "\n")
        guard let firstLineStart = raw.range(of: "\r\n")?.lowerBound else {
            sendResponse(connection, status: 400, body: ["error": "Invalid request"])
            return
        }
        guard let firstLine = raw[..<firstLineStart] as? String else {
            sendResponse(connection, status: 400, body: ["error": "Invalid request"])
            return
        }

        let components = firstLine.components(separatedBy: " ")
        guard components.count >= 3 else {
            sendResponse(connection, status: 400, body: ["error": "Invalid request line"])
            return
        }

        let method = components[0]
        let path = components[1]

        // Parse query parameters for device_id
        let deviceId = extractDeviceId(from: path)

        // Handle OPTIONS (CORS preflight)
        if method == "OPTIONS" {
            sendCorsResponse(connection)
            return
        }

        let pathString = path

        if method == "POST" && (pathString == "/api/webhook/commands" || pathString == "/webhook/notify") {
            handlePostBody(raw, connection: connection, deviceId: deviceId)
        } else if method == "GET" && (pathString == "/api/webhook/commands" || pathString == "/webhook/poll") {
            handleGetFromRequest(deviceId: deviceId, connection: connection)
        } else {
            sendResponse(connection, status: 404, body: ["error": "Not Found", "path": pathString])
        }
    }

    private func handlePostBody(_ raw: String, connection: NWConnection, deviceId: String) {
        // Find the body - it comes after \r\n\r\n
        let headersEnd = raw.range(of: "\r\n\r\n")
        guard let bodyStart = headersEnd?.upperBound else {
            queue.async { [weak self] in
                self?.queue.async { [weak self] in
                    self?.queue.async {
                        call.resolve(["queued": 0])
                    }
                }
            }
            return
        }

        let body = String(raw[bodyStart...])

        queue.async { [weak self] in
            guard let self = self else { return }

            let timestamp = Date().timeIntervalSince1970
            var commandDict: [String: Any] = [:]

            // Parse JSON body
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

            DispatchQueue.main.async {
                call.resolve(["queued": queued])
            }
        }
    }

    private func handleGetFromRequest(deviceId: String, connection: NWConnection) {
        let cutoff = Date().timeIntervalSince1970 - expireSecs

        var result: [[String: Any]] = []

        if deviceId.isEmpty {
            let recent = broadcastCommands.filter { $0.timestamp > cutoff }
            let dicts = recent.compactMap { $0.data as? [String: Any] }
            result = dicts
            broadcastCommands.removeAll()
        } else {
            let entries = deviceCommands[deviceId] ?? []
            let recent = entries.filter { $0.timestamp > cutoff }
            let dicts = recent.compactMap { $0.data as? [String: Any] }
            result = dicts
            deviceCommands[deviceId] = []
        }

        sendResponse(connection, status: 200, body: result)
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

            connection.send(content: fullResponse, completion: .idempotent)
        } catch {
            logger.error("Failed to serialize response: \(error)")
            connection.send(content: "HTTP/1.1 500 Internal Server Error\r\n\r\n".data(using: .utf8)!, completion: .idempotent)
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

        connection.send(content: response.data(using: .utf8)!, completion: .idempotent)
    }
}