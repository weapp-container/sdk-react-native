import Foundation
import UIKit

@MainActor
private enum WCRNRegistry {
    @MainActor final class Entry {
        let owner: UUID
        let session: WeappContainerSession
        let event: (String, WeappJSON) -> Void
        let storageKey: String?
        var closeTask: Task<Void, Error>?
        weak var surface: WCRNSurface?
        var view: WeappContainerView?
        var retirement: Task<Void, Error>?
        var accountCleanup: (operationId:String,continuation:CheckedContinuation<Void,Error>)?
        var deviceServices:WeappNativeDeviceServices?
        init(owner: UUID, session: WeappContainerSession, event: @escaping (String, WeappJSON) -> Void) {
            self.owner = owner; self.session = session; self.event = event
            if case .persistent(let key, _) = session.configuration.storage { storageKey = key } else { storageKey = nil }
        }
        func close(id: String, attempts: Int = 1) -> Task<Void, Error> {
            if let closeTask { return closeTask }
            accountCleanup?.continuation.resume(throwing:CancellationError()); accountCleanup=nil
            let task = Task { @MainActor [self] in
                defer { closeTask = nil }
                for attempt in 1...attempts {
                    do {
                        try await session.close()
                        try await deviceServices?.close()
                        WCRNRegistry.sessions.removeValue(forKey: id)
                        if let storageKey { WCRNRegistry.closingStorage[storageKey]?.removeValue(forKey: id) }
                        return
                    } catch {
                        if attempt == attempts { throw error }
                    }
                }
            }
            closeTask = task
            if let storageKey { WCRNRegistry.closingStorage[storageKey, default: [:]][id] = task }
            return task
        }
        // Publish the handoff before scheduling async GPU drain. A new Fabric
        // instance can then await the exact predecessor, without retry timers.
        func detach(from owner: WCRNSurface) -> Task<Void, Error>? {
            guard surface === owner, let retiringView = view else { return nil }
            if let retirement { return retirement }
            let task = Task { @MainActor [self] in
                defer { retirement = nil }
                try await retiringView.detach()
                retiringView.removeFromSuperview()
                view = nil; surface = nil
            }
            retirement = task
            return task
        }
        func attach(to owner: WCRNSurface, isCurrent: () -> Bool) async throws -> WeappContainerView? {
            if retirement == nil, let previous = surface, previous !== owner, previous.window == nil { _ = detach(from: previous) }
            if let retirement { try await retirement.value }
            guard isCurrent() else { return nil }
            guard surface == nil || surface === owner else { throw WeappContainerError(code: "ERR_VIEW_IN_USE", message: "A session can be mounted in only one native view") }
            if let view { return view }
            let created = try WeappContainerView(session: session)
            let report = event
            created.onPresented = { revision in report("presented", .object(["revision": .number(Double(revision)), "backend": .string("skia-gpu-metal")])) }
            surface = owner; view = created
            return created
        }
    }
    static var sessions: [String: Entry] = [:]
    // A replaced React runtime may create a new module before the old GPU and
    // storage owners finish closing. Wait only for known closing writers.
    static var closingStorage: [String: [String: Task<Void, Error>]] = [:]
}

@MainActor
@objc(WCRNInstance)
public final class WCRNInstance: NSObject {
    @objc public weak var devicePresenter:UIViewController?
    private let owner = UUID()
    private var active = true
    private var retainedCalls = Set<String>()
    private var calls: [String: (session: String, continuation: CheckedContinuation<WeappJSON, Error>)] = [:]
    @objc public var onEvent: ((String, String, String) -> Void)?
    private func json(_ text: String) throws -> WeappJSON { try JSONDecoder().decode(WeappJSON.self, from: Data(text.utf8)) }
    private func encode(_ value: WeappJSON) throws -> String { String(decoding: try JSONEncoder().encode(value), as: UTF8.self) }
    private func bridge(_ failure: Error) -> NSError {
        if let failure = failure as? WeappContainerError { return NSError(domain: "WeappContainer", code: 1, userInfo: [NSLocalizedDescriptionKey: failure.message, "weappCode": failure.code]) }
        return failure as NSError
    }
    private func error(_ code: String, _ message: String) -> WeappContainerError { .init(code: code, message: message) }
    private func emit(_ id: String, _ type: String, _ value: WeappJSON) {
        guard active else { return }
        do { onEvent?(id, type, try encode(value)) } catch { NSLog("WeappContainer event encoding failed: %@", String(describing: error)) }
    }
    private func lookup(_ id: String) throws -> WeappContainerSession {
        guard active, let entry = WCRNRegistry.sessions[id], entry.owner == owner else { throw error("ERR_SESSION", "Session does not belong to this React instance") }
        return entry.session
    }
    @objc public func create(_ configuration: String, completion: @escaping (String?, NSError?) -> Void) {
        Task { @MainActor [self] in
        do {
            guard active else { throw error("ERR_INVALIDATED", "React instance was invalidated") }
            let storage = try json(configuration)["storage"]
            let config: WeappContainerConfiguration
            if storage["memoryOnly"].bool == true { config = .init(storage: .memoryOnly) }
            else if let key = storage["key"].string, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { config = .init(storageKey: key) }
            else { throw error("ERR_CONFIGURATION", "Select memoryOnly or a stable storage key") }
            if case .persistent(let key, _) = config.storage {
                for pending in Array((WCRNRegistry.closingStorage[key] ?? [:]).values) { try await pending.value }
            }
            guard active else { return }
            let id = UUID().uuidString
            let session = WeappContainerSession(configuration: config)
            session.onEvent = { [weak self] event in
                switch event {
                case .ready(let value): self?.emit(id, "ready", value)
                case .navigation(let value): self?.emit(id, "navigation", value)
                case .chrome(let value): self?.emit(id, "chrome", value)
                case .message(let value): self?.emit(id, "message", value)
                case .raw(let value): self?.emit(id, value["type"].string ?? "runtime", value)
                case .error(let error): self?.emit(id, "error", .object(["code": .string(error.code), "message": .string(error.message)]))
                case .closed(let error): self?.emit(id, "closed", .object(["ok": .bool(error == nil), "error": error.map { .object(["code": .string($0.code), "message": .string($0.message)]) } ?? .null]))
                }
            }
            let entry=WCRNRegistry.Entry(owner: owner, session: session, event: { [weak self] type, value in self?.emit(id, type, value) })
            WCRNRegistry.sessions[id]=entry
            session.onAccountCleanup = { [weak self,weak entry] operationId in
                guard let self,let entry else { throw CancellationError() }
                entry.accountCleanup?.continuation.resume(throwing:CancellationError()); entry.accountCleanup=nil
                try await withTaskCancellationHandler(operation: {
                    try Task.checkCancellation()
                    try await withCheckedThrowingContinuation { (continuation:CheckedContinuation<Void,Error>) in
                        entry.accountCleanup=(operationId,continuation)
                        self.emit(id,"accountCleanupRequired",.object(["operationId":.string(operationId)]))
                    }
                }, onCancel: {
                    Task { @MainActor [weak entry] in
                        guard let entry,entry.accountCleanup?.operationId==operationId else { return }
                        entry.accountCleanup?.continuation.resume(throwing:CancellationError()); entry.accountCleanup=nil
                    }
                })
            }
            completion(id, nil)
        } catch { if active { completion(nil, bridge(error)) } }
        }
    }
    @objc public func invoke(_ id: String, operation: String, payload: String, completion: @escaping (String?, NSError?) -> Void) {
        Task { @MainActor [self] in
            do {
                let session = try lookup(id)
                let value = try json(payload)
                var result = WeappJSON.null
                switch operation {
                case "installNativeDeviceApis":
                    guard let entry=WCRNRegistry.sessions[id],entry.deviceServices==nil else { throw error("ERR_DEVICE_ADAPTER","Native devices already installed") }
                    guard let presenter=devicePresenter else { throw error("ERR_DEVICE_ADAPTER","A React presenter is required") }
                    func origins(_ key:String)->[String] { if case .array(let values)=value[key] { return values.compactMap(\.string) }; return [] }
                    let wifiConfiguration: WeappWifiConfiguration?
                    if value["wifiConfiguration"] == .null { wifiConfiguration = nil }
                    else {
                        guard case .object = value["wifiConfiguration"],
                              let connect = value["wifiConfiguration"]["connectToNetworks"].bool,
                              let read = value["wifiConfiguration"]["readCurrentNetwork"].bool else {
                            throw error("ERR_DEVICE_ADAPTER", "wifiConfiguration requires connectToNetworks and readCurrentNetwork booleans")
                        }
                        wifiConfiguration = .init(connectToNetworks: connect, readCurrentNetwork: read)
                    }
                    let nfcConfiguration: WeappNfcConfiguration?
                    if value["nfcConfiguration"] == .null { nfcConfiguration = nil }
                    else {
                        guard case .object(let flags) = value["nfcConfiguration"] else { throw error("ERR_DEVICE_ADAPTER", "nfcConfiguration must be an object") }
                        func flag(_ key: String, _ fallback: Bool = false) throws -> Bool {
                            guard let raw = flags[key] else { return fallback }
                            guard let boolean = raw.bool else { throw WeappContainerError(code: "ERR_DEVICE_ADAPTER", message: "nfcConfiguration.\(key) must be a boolean") }; return boolean
                        }
                        nfcConfiguration = try .init(ndef: flag("ndef", true), isoDep: flag("isoDep"), mifareUltralight: flag("mifareUltralight"), nfcF: flag("nfcF"), nfcV: flag("nfcV"))
                    }
                    let driver=try WeappNativeDeviceServices(presenter:presenter,
                        networkOrigins:origins("allowedNetworkOrigins"),
                        allowLoopbackForDevelopment:value["allowLoopbackForDevelopment"].bool == true,
                        enableBluetooth:value["bluetooth"].bool != false,
                        allowedMediaOrigins:origins("allowedMediaOrigins"),
                        recordingAudioSession:value["dedicatedAudioSession"].bool == true ? WeappExclusiveRecordingAudioSession() : nil,
                        enableNfc:value["nfc"].bool == true,
                        wifiConfiguration:wifiConfiguration, nfcConfiguration:nfcConfiguration)
                    entry.deviceServices=driver
                    try driver.install(in:session)
                case "completeAccountCleanup":
                    guard let entry=WCRNRegistry.sessions[id],let pending=entry.accountCleanup,
                          pending.operationId==value["operationId"].string else { throw error("ERR_ACCOUNT_CLEANUP","Account cleanup belongs to another operation") }
                    entry.accountCleanup=nil
                    if let message=value["error"]["message"].string { pending.continuation.resume(throwing:error("ERR_ACCOUNT_CLEANUP",message)) }
                    else { pending.continuation.resume() }
                case "registerHostMethod":
                    guard let name = value["name"].string else { throw error("ERR_ARGUMENT", "Missing host method name") }
                    try session.registerHostMethod(name) { [weak self] payload in
                        guard let self else { throw CancellationError() }
                        return try await self.hostCall(id, method: name, payload: payload)
                    }
                case "registerApiHandler":
                    guard let name = value["name"].string else { throw error("ERR_ARGUMENT", "Missing API name") }
                    try session.registerApiHandler(name) { [weak self] call in
                        guard let self else { throw CancellationError() }
                        return try await self.hostCall(id, method:name, payload:call.payload, context:call.context, deadlineNs:call.deadlineNs, cancelToken:call.cancelToken, cancellation:call.cancellation, retained:call.keepsResourceAlive)
                    }
                case "hostComponents", "authorizeInstalledPack", "migrateLegacyStorage", "deleteAccountData", "retryAccountCleanup", "configureHostServices", "hostApiEvent", "hostComponentFrame", "hostComponentEvent", "authorizePhoneButton", "prepareAccountHostServiceSnapshots", "updateHostServiceSnapshots", "switchAccount", "queryAccountSwitch", "updateAccountSwitchLaunch", "acknowledgeAccountCleanup", "retryAccountSwitch", "cancelAccountSwitch", "createHostBinary", "readHostBinary", "retainHostBinary", "releaseHostBinary":
                    guard case .object(let fields) = value else { throw error("ERR_ARGUMENT", "Expected object") }
                    result = try session.hostServicesCommand(operation,fields)
                case "load":
                    let url: URL
                    if let directory = value["directory"].string, directory.hasPrefix("/") { url = URL(fileURLWithPath: directory, isDirectory: true) }
                    else if let asset = value["asset"].string, !asset.isEmpty, !asset.hasPrefix("/"), !asset.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }), let root = Bundle.main.resourceURL { url = root.appendingPathComponent(asset, isDirectory: true) }
                    else { throw error("ERR_ARGUMENT", "Expected absolute directory or relative bundle asset") }
                    guard case .object(let options) = value["options"] else { throw error("ERR_ARGUMENT", "options must be an object") }
                    try await session.load(packURL: url, route: value["route"].string, options: options)
                case "sendMessage": try session.sendMessage(value["message"])
                case "navigate":
                    guard let route = value["route"].string, case .object(let query) = value["query"] else { throw error("ERR_ARGUMENT", "Expected route and query") }
                    try session.navigate(route: route, query: query, replace: value["replace"].bool ?? false)
                case "back": try session.back()
                case "state": result = try session.state()
                case "capabilities": result = try session.capabilities()
                case "setForeground":
                    guard let visible = value["visible"].bool else { throw error("ERR_ARGUMENT", "visible must be a boolean") }
                    try session.setForeground(visible)
                case "flushStorage": try await session.flushStorage()
                case "close":
                    guard let entry = WCRNRegistry.sessions[id] else { throw error("ERR_SESSION", "Unknown session") }
                    try await entry.close(id: id).value
                default: throw error("ERR_OPERATION", "Unsupported adapter operation: \(operation)")
                }
                if active { completion(try encode(result), nil) }
            } catch { if active { completion(nil, bridge(error)) } }
        }
    }
    private func hostCall(_ session: String, method: String, payload: WeappJSON, context: WeappJSON = .null, deadlineNs:String? = nil, cancelToken:String? = nil, cancellation:WeappHostApiCancellation? = nil, retained:Bool = false) async throws -> WeappJSON {
        let id = UUID().uuidString
        if retained {
            retainedCalls.insert(id)
            cancellation?.onCancel { [weak self] in
                guard let self, self.retainedCalls.remove(id) != nil else { return }
                if self.calls[id] != nil { self.cancelCall(id) }
                else { self.emit(session,"hostCallCancelled",.object(["callId":.string(id)])) }
            }
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard active, !Task.isCancelled, cancellation?.isCancelled != true else { continuation.resume(throwing: CancellationError()); return }
                calls[id] = (session, continuation)
                emit(session, "hostCall", .object(["callId": .string(id), "method": .string(method), "payload": payload, "context":context, "deadlineNs":deadlineNs.map(WeappJSON.string) ?? .null, "cancelToken":cancelToken.map(WeappJSON.string) ?? .null, "retainUntilCancelled":.bool(retained)]))
            }
        } onCancel: { Task { @MainActor [weak self] in self?.cancelCall(id) } }
    }
    private func cancelCall(_ id: String) {
        guard let call = calls.removeValue(forKey: id) else { return }
        call.continuation.resume(throwing: CancellationError())
        emit(call.session, "hostCallCancelled", .object(["callId": .string(id)]))
    }
    @objc public func completeHostCall(_ session: String, callId: String, response: String, completion: @escaping (String?, NSError?) -> Void) {
        do {
            _ = try lookup(session)
            // Cancellation can win while JS is posting its completed result.
            guard let call = calls[callId] else { completion(nil, nil); return }
            guard call.session == session else { throw error("ERR_SESSION", "Host call belongs to another session") }
            let value = try json(response)
            if case .object(let failure) = value["error"] {
                guard let codeText = failure["code"]?.string, let code = WeappHostError.Code(rawValue: codeText), let message = failure["message"]?.string else { throw error("ERR_ARGUMENT", "Invalid host error") }
                let details: [String:WeappJSON]
                if case .object(let fields) = failure["details"] ?? .object([:]) { details=fields } else { throw error("ERR_ARGUMENT","Invalid error details") }
                calls.removeValue(forKey:callId); retainedCalls.remove(callId)
                call.continuation.resume(throwing: WeappHostError(code: code, message: message, retryable: failure["retryable"]?.bool ?? false, details:details))
            } else {
                calls.removeValue(forKey: callId)
                call.continuation.resume(returning: value["result"])
            }
            completion(nil, nil)
        } catch { completion(nil, bridge(error)) }
    }
    @objc public func invalidate() {
        guard active else { return }
        active = false; onEvent = nil; retainedCalls.removeAll()
        for id in Array(calls.keys) { cancelCall(id) }
        let owned = WCRNRegistry.sessions.filter { $0.value.owner == owner }
        // Register all closing writers synchronously before yielding to a new
        // React instance, so its create can await persistence and GPU drain.
        for (id, entry) in owned {
            let closing = entry.close(id: id, attempts: 3)
            Task { @MainActor in
                do { try await closing.value }
                catch { NSLog("WeappContainer invalidation retains failed owner %@: %@", id, String(describing: error)) }
            }
        }
    }
}

@MainActor
@objc(WCRNSurface)
public final class WCRNSurface: UIView {
    private var requested = ""
    private var attached = ""
    private var generation: UInt64 = 0
    private var nativeView: WeappContainerView?
    private var entry: WCRNRegistry.Entry?
    private var transition: Task<Void, Never>?
    private var target: String { window == nil ? "" : requested }
    @objc public var onError: ((String, String) -> Void)?
    @objc public func setSessionId(_ id: String) { guard requested != id else { return }; requested = id; generation &+= 1; reconcile() }
    public override func didMoveToWindow() { super.didMoveToWindow(); generation &+= 1; reconcile() }
    public override func layoutSubviews() { super.layoutSubviews(); nativeView?.frame = bounds }
    private func reconcile() {
        // Window detachment must publish retirement synchronously, before a
        // replacement Fabric view receives its props on this same main turn.
        if attached != target { _ = entry?.detach(from: self) }
        guard transition == nil else { return }
        transition = Task { @MainActor [self] in
            defer { transition = nil }
            while true {
                do {
                    if let current = entry {
                        // Retirement may finish before this task gets its main
                        // turn, including when Fabric reuses this same UIView.
                        // A matching ID alone does not mean we still own a view.
                        if attached == target && current.retirement == nil && current.surface === self && current.view === nativeView { break }
                        if let retirement = current.detach(from: self) { try await retirement.value }
                        nativeView = nil; entry = nil; attached = ""
                    }
                    let next = target
                    if next.isEmpty { break }
                    guard let nextEntry = WCRNRegistry.sessions[next] else { throw WeappContainerError(code: "ERR_SESSION", message: "Unknown React Native session") }
                    let revision = generation
                    guard let view = try await nextEntry.attach(to: self, isCurrent: { self.generation == revision && self.target == next }) else { continue }
                    view.frame = bounds; view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                    nativeView = view; entry = nextEntry; attached = next; addSubview(view)
                } catch {
                    let failure = error as? WeappContainerError
                    onError?(failure?.code ?? "ERR_SURFACE", failure?.message ?? String(describing: error))
                    break
                }
            }
        }
    }
}
