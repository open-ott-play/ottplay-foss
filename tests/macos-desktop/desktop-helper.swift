// Hosted macOS acceptance helper. No permission prompts or TCC changes.
// Compile only in the approved hosted job: Swift 5 mode, macOS 14+ SDK.
import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct Refusal: Error {
    let code: String
    let detail: String
}
func require(_ yes: Bool, _ code: String, _ detail: String) throws {
    if !yes { throw Refusal(code: code, detail: detail) }
}
let started = ProcessInfo.processInfo.systemUptime
func tick() throws {
    try require(ProcessInfo.processInfo.systemUptime - started < 25,
                "deadline", "Helper's 25-second deadline expired")
}
func pause(_ seconds: Double = 0.05) throws {
    try tick()
    RunLoop.current.run(until: Date(timeIntervalSinceNow: seconds))
}
func waitUntil(_ detail: String, seconds: Double = 5, _ body: () throws -> Bool) throws {
    let end = ProcessInfo.processInfo.systemUptime + seconds
    repeat {
        if try body() { return }
        try pause()
    } while ProcessInfo.processInfo.systemUptime < end
    throw Refusal(code: "ui_not_ready", detail: detail)
}
func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func string(_ element: AXUIElement, _ name: String) -> String {
    (attr(element, name) as? String) ?? ""
}
func children(_ element: AXUIElement, _ name: String = "AXChildren") -> [AXUIElement] {
    (attr(element, name) as? [AXUIElement]) ?? []
}
func elementAttr(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attr(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
func number(_ element: AXUIElement, _ name: String) -> Int? {
    (attr(element, name) as? NSNumber)?.intValue
}
func frame(_ element: AXUIElement) -> CGRect? {
    guard let p = attr(element, "AXPosition"), let s = attr(element, "AXSize"),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point),
          AXValueGetValue(s as! AXValue, .cgSize, &size),
          point.x.isFinite, point.y.isFinite, size.width.isFinite, size.height.isFinite,
          size.width > 0, size.height > 0 else { return nil }
    return CGRect(origin: point, size: size)
}
func rectJSON(_ rect: CGRect) -> [String: Double] {
    ["x": Double(rect.origin.x), "y": Double(rect.origin.y), "width": Double(rect.width), "height": Double(rect.height)]
}
func walk(_ root: AXUIElement) throws -> [AXUIElement] {
    var pending: [(AXUIElement, Int)] = [(root, 0)]
    var result: [AXUIElement] = []
    while let (node, depth) = pending.popLast() {
        try tick()
        try require(result.count < 1400, "ax_tree_limit", "AX tree exceeded 1400 nodes")
        result.append(node)
        if depth < 14 {
            for child in children(node).reversed() { pending.append((child, depth + 1)) }
        }
    }
    return result
}
func unique(_ root: AXUIElement, role: String, titles: [String]) throws -> AXUIElement {
    let found = try walk(root).filter {
        string($0, "AXRole") == role && titles.contains(string($0, "AXTitle"))
    }
    try require(found.count == 1, "ax_match", "Expected one \(role) named \(titles); found \(found.count)")
    return found[0]
}
func press(_ element: AXUIElement) throws {
    try tick()
    try require(number(element, "AXEnabled") != 0, "ax_disabled", "Control is disabled")
    try require(AXUIElementPerformAction(element, "AXPress" as CFString) == .success,
                "ax_press", "AXPress refused")
}
func set(_ element: AXUIElement, _ name: String, _ value: CFTypeRef) throws {
    try tick()
    try require(AXUIElementSetAttributeValue(element, name as CFString, value) == .success,
                "ax_set", "Cannot set \(name)")
}
func ax(_ pid: pid_t) -> AXUIElement {
    let result = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(result, 0.5)
    return result
}
func front(_ app: NSRunningApplication) throws {
    try require(!app.isTerminated, "app_exited", "Target application exited")
    try require(app.activate(options: [.activateIgnoringOtherApps]), "activate", "Cannot activate target")
    try waitUntil("Target did not become frontmost") {
        NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier
    }
}
func key(_ app: NSRunningApplication, _ code: CGKeyCode, flags: CGEventFlags = []) throws {
    try front(app)
    try require(CGPreflightPostEventAccess(), "post_permission", "Synthetic event permission absent")
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
        throw Refusal(code: "event_allocation", detail: "Cannot create key events")
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}
func finderPermission() -> OSStatus {
    let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.finder")
    return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, false)
}
func finder() throws -> NSRunningApplication {
    let found = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").filter { !$0.isTerminated }
    try require(found.count == 1, "finder_unavailable", "Expected one running Finder")
    return found[0]
}
func prerequisites() throws -> [String: Any] {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    let onConsole = session?[kCGSessionOnConsoleKey as String] as? Bool ?? false
    let loggedIn = session?[kCGSessionLoginDoneKey as String] as? Bool ?? false
    let facts: [String: Any] = [
        "accessibility": AXIsProcessTrusted(),
        "post_events": CGPreflightPostEventAccess(),
        "screen_capture": CGPreflightScreenCaptureAccess(),
        "finder_automation_status": Int(finderPermission()),
        "on_console": onConsole, "login_complete": loggedIn,
        "display_active": CGDisplayIsActive(CGMainDisplayID()) != 0,
        "os": ProcessInfo.processInfo.operatingSystemVersionString
    ]
    for name in ["accessibility", "post_events", "screen_capture", "on_console", "login_complete", "display_active"] {
        try require(facts[name] as? Bool == true, "preflight_" + name, "Required capability absent: " + name)
    }
    // AppleEvent authorization is telemetry only; no AppleEvents are sent.
    let app = try finder()
    try require(elementAttr(ax(app.processIdentifier), "AXMenuBar") != nil,
                "finder_ax", "Finder AX menu bar unavailable")
    return facts
}
func safeURL(_ text: String) throws -> URL {
    try require(text.hasPrefix("/") && text.utf8.count <= 4096 && !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                "path", "Expected bounded absolute path without control characters")
    let url = URL(fileURLWithPath: text).standardizedFileURL
    try require(url.path == url.resolvingSymlinksInPath().path, "symlink_path", "Fixture and app paths must be canonical, without symlink aliases")
    return url
}
struct Target {
    let url: URL
    let bundleID: String
    init(_ path: String) throws {
        url = try safeURL(path)
        guard url.pathExtension == "app", let bundle = Bundle(url: url),
              let id = bundle.bundleIdentifier, !id.isEmpty,
              let executable = bundle.executableURL, FileManager.default.isExecutableFile(atPath: executable.path),
              id != "com.apple.finder" else {
            throw Refusal(code: "app_bundle", detail: "Expected executable QA application bundle")
        }
        bundleID = id
    }
    func running() throws -> [NSRunningApplication] {
        let all = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).filter { !$0.isTerminated }
        try require(all.allSatisfy { $0.bundleURL?.resolvingSymlinksInPath().path == url.path },
                    "bundle_collision", "Another application path uses the QA bundle identifier")
        try require(all.count <= 1, "instance_collision", "Multiple target application instances")
        return all
    }
    func one() throws -> NSRunningApplication {
        let found = try running()
        try require(found.count == 1, "target_not_running", "QA application is not running")
        return found[0]
    }
    func json(_ app: NSRunningApplication) -> [String: Any] {
        ["pid": Int(app.processIdentifier), "bundle_id": bundleID, "path": url.path]
    }
}
func fixture(_ path: String) throws -> URL {
    let url = try safeURL(path)
    let facts = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    try require(facts.isRegularFile == true && facts.isSymbolicLink != true && (facts.fileSize ?? 0) > 0,
                "fixture_file", "Expected a nonempty regular file")
    return url
}
func window(_ app: NSRunningApplication) throws -> AXUIElement {
    let root = ax(app.processIdentifier)
    let windows = children(root, "AXWindows").filter { string($0, "AXRole") == "AXWindow" && frame($0) != nil }
    try require(windows.count == 1, "window_ambiguity", "Expected exactly one target window")
    return windows[0]
}
func windowRecord(_ app: NSRunningApplication) throws -> [String: Any] {
    guard let all = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        throw Refusal(code: "windows", detail: "WindowServer enumeration unavailable")
    }
    let found = all.filter {
        ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier &&
        ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 &&
        ((($0[kCGWindowBounds as String] as? [String: Any])?["Width"] as? NSNumber)?.doubleValue ?? 0) > 100
    }
    try require(found.count == 1, "native_window_ambiguity", "Expected one on-screen target content window")
    return found[0]
}
func selectedFileElements(_ root: AXUIElement, file: URL) throws -> [AXUIElement] {
    let nodes = try walk(root)
    let selected = nodes.flatMap { children($0, "AXSelectedChildren") } + nodes.filter { number($0, "AXSelected") == 1 }
    try require(selected.count <= 16, "finder_selection", "Selection is not bounded to one fixture")
    var found: [AXUIElement] = []
    for node in selected {
        for child in try walk(node) where selectedURL(child)?.standardizedFileURL.path == file.path {
            if !found.contains(where: { CFEqual($0, child) }) { found.append(child) }
        }
    }
    return found
}
func reveal(_ file: URL) throws -> NSRunningApplication {
    let app = try finder()
    // Public Finder reveal, followed by exact AX URL proof. No AppleScript or
    // basename-only fallback: a missing accessibility URL is a refusal.
    NSWorkspace.shared.activateFileViewerSelecting([file])
    try front(app)
    try waitUntil("Finder does not expose the exact selected fixture URL") {
        try require(try finder().processIdentifier == app.processIdentifier, "finder_changed", "Finder changed during reveal")
        return try !selectedFileElements(ax(app.processIdentifier), file: file).isEmpty
    }
    return app
}
func selectedURL(_ node: AXUIElement) -> URL? {
    guard let value = attr(node, "AXURL") else { return nil }
    if let url = value as? URL, url.isFileURL { return url }
    if let text = value as? String, let url = URL(string: text), url.isFileURL { return url }
    return nil
}
func chooserSelection(_ root: AXUIElement, target: URL) throws -> AXUIElement? {
    let nodes = try walk(root)
    // AXURL is required: a basename alone cannot prove the chosen bundle path.
    return nodes.first {
        number($0, "AXSelected") == 1 && selectedURL($0)?.standardizedFileURL.path == target.path
    }
}
func finderOpen(_ target: Target, file: URL) throws -> [String: Any] {
    let before = try target.running().first?.processIdentifier
    let app = try reveal(file)
    let root = ax(app.processIdentifier)
    guard let menu = elementAttr(root, "AXMenuBar") else { throw Refusal(code: "menu", detail: "No Finder menu bar") }
    let fileMenu = try unique(menu, role: "AXMenuBarItem", titles: ["File"])
    try press(fileMenu)
    var openWith: AXUIElement?
    try waitUntil("Finder File menu has no Open With") {
        openWith = try walk(fileMenu).first { string($0, "AXRole") == "AXMenuItem" && string($0, "AXTitle") == "Open With" }
        return openWith != nil
    }
    try press(openWith!)
    var other: AXUIElement?
    try waitUntil("Finder Open With has no Other item") {
        other = try walk(openWith!).first { string($0, "AXRole") == "AXMenuItem" && ["Other…", "Other..."].contains(string($0, "AXTitle")) }
        return other != nil
    }
    try press(other!)
    try waitUntil("Finder application chooser absent") {
        try walk(root).contains { string($0, "AXRole") == "AXButton" && string($0, "AXTitle") == "Open" }
    }
    try key(app, 5, flags: [.maskCommand, .maskShift]) // Go to Folder, not an Open With substitute.
    var field: AXUIElement?
    try waitUntil("Go to Folder text field absent") {
        guard let focused = elementAttr(root, "AXFocusedUIElement"),
              ["AXTextField", "AXComboBox"].contains(string(focused, "AXRole")) else { return false }
        field = focused
        return true
    }
    try set(field!, "AXValue", target.url.path as CFString)
    try require(string(field!, "AXValue") == target.url.path, "chooser_path", "Go to Folder did not retain exact bundle path")
    try key(app, 36)
    try waitUntil("Application chooser cannot attest exact selected QA bundle URL") {
        try chooserSelection(root, target: target.url) != nil
    }
    let boxes = try walk(root).filter { string($0, "AXRole") == "AXCheckBox" && string($0, "AXTitle") == "Always Open With" }
    try require(boxes.count == 1, "default_checkbox", "Cannot locate exactly one Always Open With checkbox")
    try require(number(boxes[0], "AXValue") == 0, "default_checkbox", "Always Open With is selected or unreadable; refusing to change defaults")
    let open = try unique(root, role: "AXButton", titles: ["Open"])
    try require(try chooserSelection(root, target: target.url) != nil, "chooser_changed", "Selected application changed before Open")
    try press(open)
    var running: NSRunningApplication?
    try waitUntil("Exact QA bundle did not receive Finder Open With", seconds: 8) {
        running = try target.running().first
        return running != nil && NSWorkspace.shared.frontmostApplication?.processIdentifier == running?.processIdentifier
    }
    if let before { try require(running!.processIdentifier == before, "warm_pid_changed", "Warm Open With changed target PID") }
    var result = target.json(running!)
    result["route"] = "finder_file_open_with_other"
    result["selected_file"] = file.path
    result["selected_application"] = target.url.path
    result["default_checkbox"] = false
    result["was_running"] = before != nil
    result["delivery_only"] = true
    return result
}
func moveWindow(_ win: AXUIElement, rect: CGRect) throws {
    var origin = rect.origin
    var size = rect.size
    guard let p = AXValueCreate(.cgPoint, &origin), let s = AXValueCreate(.cgSize, &size) else { throw Refusal(code: "geometry", detail: "Cannot create AX geometry") }
    try set(win, "AXPosition", p)
    try set(win, "AXSize", s)
}
func hitPID(_ point: CGPoint) -> pid_t? {
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success,
          let hit else { return nil }
    var pid: pid_t = 0
    return AXUIElementGetPid(hit, &pid) == .success ? pid : nil
}
func mouse(_ type: CGEventType, _ point: CGPoint) throws {
    try tick()
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
        throw Refusal(code: "event_allocation", detail: "Cannot create pointer event")
    }
    event.setIntegerValueField(.mouseEventClickState, value: 1)
    event.post(tap: .cghidEventTap)
}
func finderDrop(_ target: Target, file: URL) throws -> [String: Any] {
    let app = try target.one()
    try front(app)
    let qaWindow = try window(app)
    let finderApp = try reveal(file)
    let finderWindow = try window(finderApp)
    let display = CGDisplayBounds(CGMainDisplayID())
    try require(display.width >= 1100 && display.height >= 650, "display_size", "Display is too small for two independently visible windows")
    let margin: CGFloat = 24
    let width = (display.width - margin * 3) / 2
    try moveWindow(finderWindow, rect: CGRect(x: display.minX + margin, y: display.minY + 70, width: width, height: display.height - 110))
    try moveWindow(qaWindow, rect: CGRect(x: display.minX + width + margin * 2, y: display.minY + 70, width: width, height: display.height - 110))
    try front(finderApp)
    let root = ax(finderApp.processIdentifier)
    try waitUntil("Finder selection moved during window arrangement") { try !selectedFileElements(root, file: file).isEmpty }
    let selected = try selectedFileElements(root, file: file)
    let candidates = selected.compactMap { node -> (AXUIElement, CGRect)? in
        guard let rect = frame(node), rect.width >= 8, rect.height >= 8,
              ["AXRow", "AXCell", "AXImage", "AXButton", "AXTextField"].contains(string(node, "AXRole")) else { return nil }
        return (node, rect)
    }.sorted { $0.1.width * $0.1.height < $1.1.width * $1.1.height }
    guard let source = candidates.first else { throw Refusal(code: "drag_source", detail: "Finder exposes no selected file geometry") }
    let webs = try walk(qaWindow).filter { string($0, "AXRole") == "AXWebArea" && frame($0) != nil }
    try require(webs.count == 1, "drag_target", "Expected one QA web content area")
    let destination = frame(webs[0])!
    let from = CGPoint(x: source.1.midX, y: source.1.midY)
    let to = CGPoint(x: destination.midX, y: destination.midY)
    try require(display.contains(from) && display.contains(to), "drag_coordinates", "Drag point outside display")
    try require(hitPID(from) == finderApp.processIdentifier && hitPID(to) == app.processIdentifier,
                "drag_occluded", "Exact Finder source or QA destination is covered")
    try require(try target.one().processIdentifier == app.processIdentifier, "target_changed", "QA target changed before drag")
    try require(CGPreflightPostEventAccess(), "post_permission", "Pointer event permission absent")
    try mouse(.mouseMoved, from)
    try mouse(.leftMouseDown, from)
    // Always release the button, including deadline/refusal during motion.
    var buttonDown = true
    var lastPoint = from
    defer { if buttonDown, let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: lastPoint, mouseButton: .left) { up.post(tap: .cghidEventTap) } }
    try pause(0.15)
    for index in 1...24 {
        let t = CGFloat(index) / 24
        lastPoint = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        try mouse(.leftMouseDragged, lastPoint)
        try pause(0.025)
    }
    try mouse(.leftMouseUp, to)
    buttonDown = false
    var result = target.json(app)
    result["route"] = "finder_selected_file_cgevent_drag"
    result["selected_file"] = file.path
    result["source_pid"] = Int(finderApp.processIdentifier)
    result["source_point"] = ["x": from.x, "y": from.y]
    result["target_point"] = ["x": to.x, "y": to.y]
    result["delivery_only"] = true
    return result
}
final class ResultBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, Error>?
    func put(_ value: Result<Value, Error>) { lock.lock(); result = value; lock.unlock() }
    func get() -> Result<Value, Error>? { lock.lock(); defer { lock.unlock() }; return result }
}
func awaitResult<Value>(_ box: ResultBox<Value>) throws -> Value {
    try waitUntil("Asynchronous platform operation timed out", seconds: 8) { box.get() != nil }
    return try box.get()!.get()
}
@available(macOS 14.0, *)
func screenshot(_ target: Target, output: String) throws -> [String: Any] {
    let app = try target.one()
    let record = try windowRecord(app)
    let id = (record[kCGWindowNumber as String] as! NSNumber).uint32Value
    let destination = try safeURL(output)
    try require(destination.pathExtension.lowercased() == "png" && !FileManager.default.fileExists(atPath: destination.path), "screenshot_path", "Output must be a new PNG path")
    let contentBox = ResultBox<SCShareableContent>()
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
        if let content { contentBox.put(.success(content)) }
        else { contentBox.put(.failure(error ?? Refusal(code: "screen_content", detail: "No shareable content"))) }
    }
    let content = try awaitResult(contentBox)
    guard let win = content.windows.first(where: { $0.windowID == id && $0.owningApplication?.processID == app.processIdentifier }) else {
        throw Refusal(code: "screen_owner", detail: "Exact native window is no longer shareable")
    }
    try require(win.frame.width > 0 && win.frame.height > 0 && win.frame.width <= 4096 && win.frame.height <= 4096,
                "capture_size", "Target window exceeds bounded screenshot dimensions")
    let filter = SCContentFilter(desktopIndependentWindow: win)
    let config = SCStreamConfiguration()
    config.width = Int(win.frame.width.rounded(.up))
    config.height = Int(win.frame.height.rounded(.up))
    config.showsCursor = false
    let imageBox = ResultBox<CGImage>()
    SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
        if let image { imageBox.put(.success(image)) }
        else { imageBox.put(.failure(error ?? Refusal(code: "screenshot", detail: "No captured image"))) }
    }
    let image = try awaitResult(imageBox)
    try require(try target.one().processIdentifier == app.processIdentifier, "screen_owner", "QA exited or changed during capture")
    guard let sink = CGImageDestinationCreateWithURL(destination as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw Refusal(code: "png_output", detail: "Cannot create PNG output")
    }
    CGImageDestinationAddImage(sink, image, nil)
    try require(CGImageDestinationFinalize(sink), "png_output", "PNG encoding failed")
    var result = target.json(app)
    result["window_id"] = id
    result["png"] = destination.path
    result["width"] = image.width
    result["height"] = image.height
    result["scope"] = "Window screenshot, not decoded-frame or audible-output evidence"
    return result
}
func snapshot(_ target: Target) throws -> [String: Any] {
    let app = try target.one()
    let win = try window(app)
    let nodes = try walk(win).map { node -> [String: Any] in
        let role = string(node, "AXRole")
        var item: [String: Any] = ["role": role, "title": String(string(node, "AXTitle").prefix(256))]
        if let rect = frame(node) { item["frame"] = rectJSON(rect) }
        // Never include secure fields; the isolated fixture may contain only synthetic metadata.
        if string(node, "AXSubrole") != "AXSecureTextField" {
            if let value = attr(node, "AXValue") as? String { item["value"] = String(value.prefix(256)) }
        }
        return item
    }
    let record = try windowRecord(app)
    var result = target.json(app)
    result["window_id"] = record[kCGWindowNumber as String]
    result["nodes"] = nodes
    return result
}
func launchServicesOpen(_ target: Target, file: URL) throws -> [String: Any] {
    let box = ResultBox<NSRunningApplication>()
    let config = NSWorkspace.OpenConfiguration()
    config.createsNewApplicationInstance = false
    NSWorkspace.shared.open([file], withApplicationAt: target.url, configuration: config) { app, error in
        if let app { box.put(.success(app)) }
        else { box.put(.failure(error ?? Refusal(code: "launchservices", detail: "Explicit open failed"))) }
    }
    let app = try awaitResult(box)
    try require(try target.one().processIdentifier == app.processIdentifier, "launch_owner", "Opened application identity differs")
    var result = target.json(app)
    result["route"] = "launchservices_explicit_application_not_finder"
    result["selected_file"] = file.path
    result["delivery_only"] = true
    return result
}
func main(_ args: [String]) throws -> [String: Any] {
    try require(!args.isEmpty, "usage", "Expected an action")
    if args[0] == "preflight" {
        try require(args.count == 1, "usage", "preflight takes no arguments")
        return ["capabilities": try prerequisites()]
    }
    if args[0] == "handler" {
        try require(args.count == 2, "usage", "handler FILE")
        let file = try fixture(args[1])
        let selected = NSWorkspace.shared.urlForApplication(toOpen: file)?.resolvingSymlinksInPath().path
        return ["file": file.path, "application_path": selected as Any? ?? NSNull()]
    }
    try require(args.count >= 2, "usage", "Action requires absolute QA app path")
    let target = try Target(args[1])
    if args[0] == "apps" {
        try require(args.count == 2, "usage", "apps APP")
        return ["apps": try target.running().map { target.json($0) }]
    }
    if args[0] == "quit" {
        try require(args.count == 2, "usage", "quit APP")
        guard let app = try target.running().first else { return ["apps": [], "already_stopped": true] }
        let result = target.json(app)
        try require(app.terminate(), "quit_refused", "Exact QA app refused graceful termination")
        try waitUntil("Exact QA app did not exit", seconds: 8) { app.isTerminated }
        return result
    }
    _ = try prerequisites()
    switch args[0] {
    case "snapshot":
        try require(args.count == 2, "usage", "snapshot APP")
        return try snapshot(target)
    case "screenshot":
        try require(args.count == 3, "usage", "screenshot APP OUTPUT.png")
        if #available(macOS 14.0, *) { return try screenshot(target, output: args[2]) }
        throw Refusal(code: "macos_version", detail: "Screenshot requires macOS 14+")
    case "finder-open", "finder-drop", "open":
        try require(args.count == 3, "usage", "ACTION APP FILE")
        let file = try fixture(args[2])
        if args[0] == "finder-open" { return try finderOpen(target, file: file) }
        if args[0] == "finder-drop" { return try finderDrop(target, file: file) }
        return try launchServicesOpen(target, file: file)
    default:
        throw Refusal(code: "usage", detail: "Unknown action")
    }
}
_ = NSApplication.shared
NSApp.setActivationPolicy(.prohibited)
let args = Array(CommandLine.arguments.dropFirst())
var output: [String: Any] = ["schema": 1, "action": args.first ?? ""]
var status: Int32 = 0
do {
    guard #available(macOS 14.0, *) else { throw Refusal(code: "macos_version", detail: "Helper requires macOS 14+") }
    output.merge(try main(args)) { _, fresh in fresh }
    output["status"] = "ok"
} catch let refusal as Refusal {
    output["status"] = "refused"
    output["error"] = ["code": refusal.code, "detail": refusal.detail]
    status = 2
} catch {
    output["status"] = "refused"
    output["error"] = ["code": "platform_error", "detail": String(describing: type(of: error))]
    status = 2
}
output["elapsed_ms"] = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
if let data = try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]),
   let text = String(data: data, encoding: .utf8) { print(text) }
else { print("{\"schema\":1,\"status\":\"refused\",\"error\":{\"code\":\"json\"}}"); status = 2 }
exit(status)
