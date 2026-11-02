package com.sonofmagic.weapp.container.reactnative

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.sonofmagic.weapp.container.sdk.*
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture

internal object ContainerRegistry {
    class Entry(val owner: WeappContainerModule, val session: WeappContainerSession, var requestedForeground: Boolean = true) {
        var surface: java.lang.ref.WeakReference<ContainerSurface>? = null
        var retirement: CompletableFuture<Unit>? = null
        var accountCleanup: Pair<String,CompletableFuture<Unit>>? = null
        var deviceServices:AndroidNativeDeviceServices?=null
        private var closing: CompletableFuture<Unit>? = null
        fun close(id: String, attempts: Int = 1): CompletableFuture<Unit> {
            closing?.let { return it }
            accountCleanup?.let { owner.emitCleanupCancellation(id, it.first) }
            val result = CompletableFuture<Unit>()
            closing = result
            session.storageKey?.let { closingStorage.getOrPut(it) { mutableMapOf() }[id] = result }
            fun attempt(remaining: Int) {
                session.closeAsync().whenComplete { _, error ->
                    if (error != null && remaining > 1) { attempt(remaining - 1); return@whenComplete }
                    closing = null
                    try {
                        if(error!=null) throw error
                        deviceServices?.close()
                        sessions.remove(id)
                        session.storageKey?.let { closingStorage[it]?.remove(id) }
                        result.complete(Unit)
                    } catch(failure:Throwable) { result.completeExceptionally(failure) }
                }
            }
            attempt(attempts)
            return result
        }
    }
    val sessions = mutableMapOf<String, Entry>() // Android main thread only.
    val closingStorage = mutableMapOf<String, MutableMap<String, CompletableFuture<Unit>>>()
}

@ReactModule(name = WeappContainerModule.NAME)
class WeappContainerModule(context: ReactApplicationContext) : NativeWeappContainerSpec(context), LifecycleEventListener {
    companion object { const val NAME = "WeappContainer" }
    @Volatile private var active = true
    private var hostForeground = context.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED
    private val invalidated = java.util.concurrent.atomic.AtomicBoolean(false)
    private data class Pending(val sessionId: String, val reply: HostReply, val retained:Boolean=false)
    private val calls = mutableMapOf<String, Pending>()
    private var nextPermission=39000
    private val permissionBroker=AndroidPermissionBroker { permissions,call,completion ->
        val activity=reactApplicationContext.currentActivity as? PermissionAwareActivity
        if(activity==null || call.isCancelled) completion(false)
        else {
            val id=nextPermission++; if(nextPermission>=65000) nextPermission=39000
            activity.requestPermissions(permissions,id,PermissionListener { requestCode,_,_ ->
                if(requestCode!=id) false else {
                    completion(!call.isCancelled && permissions.all { reactApplicationContext.currentActivity?.checkSelfPermission(it)==android.content.pm.PackageManager.PERMISSION_GRANTED }); true
                }
            })
        }
    }
    init { context.addLifecycleEventListener(this) }
    override fun getName() = NAME
    internal fun owns(context: ReactContext) = active && context === reactApplicationContext
    private fun emit(id: String, type: String, payload: Any?) {
        if (!active || !reactApplicationContext.hasActiveReactInstance()) return
        emitOnEvent(Arguments.createMap().apply { putString("sessionId", id); putString("type", type); putString("payload", JSONArray().put(payload ?: JSONObject.NULL).toString().drop(1).dropLast(1)) })
    }
    private fun lookup(id: String): WeappContainerSession {
        check(active) { "React instance was invalidated" }
        val entry = ContainerRegistry.sessions[id]
        require(entry?.owner === this) { "Session does not belong to this React instance" }
        return checkNotNull(entry).session
    }
    private fun reject(promise: Promise, error: Throwable) {
        if (active) promise.reject((error as? ContainerException)?.code ?: "ERR_REACT_NATIVE", error.message, error)
    }
    private fun <T> complete(future: CompletableFuture<T>, promise: Promise, map: (T) -> Any? = { "null" }) {
        future.whenComplete { value, error ->
            if (active) { if (error != null) reject(promise, error) else promise.resolve(map(value)) }
        }
    }
    override fun create(configuration: String, promise: Promise) = reactApplicationContext.runOnUiQueueThread {
        try {
            check(active)
            val storage = JSONObject(configuration).getJSONObject("storage")
            val key = if (storage.optBoolean("memoryOnly")) null else storage.getString("key").also { require(it.isNotBlank()) }
            val pending = key?.let { ContainerRegistry.closingStorage[it]?.values?.toTypedArray() } ?: emptyArray()
            CompletableFuture.allOf(*pending).whenComplete { _, error -> reactApplicationContext.runOnUiQueueThread {
                if (!active) return@runOnUiQueueThread
                if (error != null) { reject(promise, error); return@runOnUiQueueThread }
                try {
                val id = UUID.randomUUID().toString()
                val session = WeappContainerSession(reactApplicationContext, key)
                session.eventListener = ContainerEventListener { event ->
                    val type = event.getString("type")
                    val value = when (type) {
                        "message" -> event.opt("message")
                        "ready" -> event.opt("state")
                        "error" -> event.opt("error")
                        "closed" -> JSONObject().put("ok", event.optBoolean("ok", true)).put("error", event.opt("error") ?: JSONObject.NULL)
                        else -> event
                    }
                    emit(id, type, value)
                }
                val entry=ContainerRegistry.Entry(this,session)
                ContainerRegistry.sessions[id] = entry
                session.accountCleanupHandler = { operationId ->
                    val pending=CompletableFuture<Unit>()
                    check(entry.accountCleanup==null) { "Previous account cleanup transport has not ended" }
                    entry.accountCleanup=operationId to pending
                    emit(id,"accountCleanupRequired",JSONObject().put("operationId",operationId))
                    pending
                }
                session.setForeground(hostForeground)
                if (active) promise.resolve(id)
                } catch (failure: Throwable) { reject(promise, failure) }
            } }

        } catch (error: Throwable) { reject(promise, error) }
    }
    override fun invoke(sessionId: String, operation: String, payload: String, promise: Promise) = reactApplicationContext.runOnUiQueueThread {
        try {
            val value = JSONObject(payload)
            // A real terminal may race React invalidation. Only the exact
            // outstanding cleanup receipt can retire this module's old owner.
            val session = if (operation == "completeAccountCleanup") {
                val entry = ContainerRegistry.sessions[sessionId]
                require(entry?.owner === this) { "Session does not belong to this React instance" }
                checkNotNull(entry).session
            } else lookup(sessionId)
            when (operation) {
                "installNativeDeviceApis" -> {
                    val entry=checkNotNull(ContainerRegistry.sessions[sessionId])
                    check(entry.deviceServices==null) { "Native devices already installed" }
                    val activity=checkNotNull(reactApplicationContext.currentActivity) { "A foreground React Activity is required" }
                    val rawOrigins=value.optJSONArray("allowedNetworkOrigins") ?: JSONArray()
                    val origins=(0 until rawOrigins.length()).map { rawOrigins.getString(it) }.toSet()
                    val driver=AndroidNativeDeviceServices(activity,networkOrigins=origins,
                        allowLoopbackForDevelopment=value.optBoolean("allowLoopbackForDevelopment",false),
                        enableBluetooth=value.optBoolean("bluetooth",true),permissions=permissionBroker,
                        enableNfc=value.optBoolean("nfc",false),
                        enableWifi=value.optBoolean("enableWifi",false))
                    entry.deviceServices=driver
                    complete(driver.install(session),promise)
                }
                "completeAccountCleanup" -> {
                    val entry=checkNotNull(ContainerRegistry.sessions[sessionId])
                    val pending=entry.accountCleanup
                    require(pending?.first==value.getString("operationId")) { "Account cleanup belongs to another operation" }
                    entry.accountCleanup=null
                    val error=value.optJSONObject("error")
                    if(!active || value.optBoolean("retired")) pending!!.second.completeExceptionally(ContainerException("ERR_CANCELLED","Retired account cleanup ended"))
                    else if(error!=null) pending!!.second.completeExceptionally(ContainerException("ERR_ACCOUNT_CLEANUP",error.optString("message","Account cleanup failed")))
                    else pending!!.second.complete(Unit)
                    promise.resolve("null")
                }
                "registerHostMethod", "registerApiHandler" -> {
                    val name = value.getString("name")
                    val handler = HostMethod { call, reply ->
                        val id = UUID.randomUUID().toString()
                        if (!active) { reply.reject(HostErrorCode.CANCELLED, "React instance was invalidated"); return@HostMethod }
                        calls[id] = Pending(sessionId, reply, call.keepsResourceAlive)
                        call.onCancel = {
                            if (calls.remove(id) != null) emit(sessionId, "hostCallCancelled", JSONObject().put("callId", id))
                        }
                        if (!call.isCancelled) emit(sessionId, "hostCall", JSONObject().put("callId", id).put("method", name).put("payload", call.payload ?: JSONObject.NULL).put("context", call.context ?: JSONObject.NULL).put("deadlineNs",call.deadlineNsDecimal ?: JSONObject.NULL).put("cancelToken",call.cancelToken ?: JSONObject.NULL).put("retainUntilCancelled",call.keepsResourceAlive))
                    }
                    complete(if (operation == "registerApiHandler") session.registerApiHandler(name,handler) else session.registerHostMethod(name,handler), promise)
                }
                "load" -> {
                    val source = if (value.has("asset")) PackSource.Asset(value.getString("asset")) else PackSource.Directory(File(value.getString("directory")).also { require(it.isAbsolute) })
                    complete(session.load(source, LoadOptions(value.optString("route").takeIf { value.has("route") }, value.getJSONObject("options"))), promise)
                }
                "sendMessage" -> complete(session.sendMessage(value.opt("message")), promise)
                "navigate" -> complete(session.navigate(value.getString("route"), value.getJSONObject("query"), value.optBoolean("replace")), promise)
                "back" -> complete(session.back(), promise)
                "state" -> complete(session.state(), promise) { it.toString() }
                "capabilities" -> complete(session.capabilities(), promise) { it.toString() }
                "setForeground" -> {
                    val entry = checkNotNull(ContainerRegistry.sessions[sessionId])
                    entry.requestedForeground = value.getBoolean("visible")
                    complete(session.setForeground(entry.requestedForeground && hostForeground), promise)
                }
                "flushStorage" -> complete(session.flushStorage(), promise)
                "close" -> complete(checkNotNull(ContainerRegistry.sessions[sessionId]).close(sessionId), promise)
                "hostComponents", "authorizeInstalledPack", "migrateLegacyStorage", "deleteAccountData", "retryAccountCleanup", "configureHostServices", "hostApiEvent", "hostComponentFrame", "hostComponentEvent", "authorizePhoneButton", "prepareAccountHostServiceSnapshots", "updateHostServiceSnapshots", "switchAccount", "queryAccountSwitch", "updateAccountSwitchLaunch", "acknowledgeAccountCleanup", "retryAccountSwitch", "cancelAccountSwitch", "createHostBinary", "readHostBinary", "retainHostBinary", "releaseHostBinary" -> complete(session.hostServicesCommand(operation,value),promise) { JSONArray().put(it ?: JSONObject.NULL).toString().drop(1).dropLast(1) }
                else -> throw IllegalArgumentException("Unsupported adapter operation: $operation")
            }
        } catch (error: Throwable) { reject(promise, error) }
    }
    internal fun emitCleanupCancellation(id: String, operationId: String) {
        emit(id,"accountCleanupCancelled",JSONObject().put("operationId",operationId))
    }
    override fun completeHostCall(sessionId: String, callId: String, response: String, promise: Promise) = reactApplicationContext.runOnUiQueueThread {
        try {
            lookup(sessionId)
            val call = calls[callId]
            if (call != null) {
                require(call.sessionId == sessionId)
                val value = JSONObject(response)
                val error = value.optJSONObject("error")
                if (error != null) {
                    val code = when (error.getString("code")) {
                        "invalid_request" -> HostErrorCode.INVALID_REQUEST
                        "permission_denied" -> HostErrorCode.PERMISSION_DENIED
                        "timeout" -> HostErrorCode.TIMEOUT
                        "cancelled" -> HostErrorCode.CANCELLED
                        "unsupported" -> HostErrorCode.UNSUPPORTED
                        else -> throw IllegalArgumentException("Invalid host error code")
                    }
                    call.reply.reject(code, error.getString("message"), error.optBoolean("retryable"), error.optJSONObject("details") ?: JSONObject())
                } else call.reply.resolve(value.opt("result"))
                if(error != null || !call.retained) calls.remove(callId)
            }
            if (active) promise.resolve(null)
        } catch (error: Throwable) { reject(promise, error) }
    }
    private fun foreground(visible: Boolean) = reactApplicationContext.runOnUiQueueThread {
        hostForeground = visible
        ContainerRegistry.sessions.filterValues { it.owner === this }.forEach { (id, entry) ->
            entry.session.setForeground(visible && entry.requestedForeground).whenComplete { _, error -> if (error != null) emit(id, "error", JSONObject().put("code", "ERR_LIFECYCLE").put("message", error.message)) }
        }
    }
    override fun onHostResume() {
        ContainerRegistry.sessions.values.filter { it.owner===this }.forEach { entry -> entry.deviceServices?.rebindActivity(reactApplicationContext.currentActivity) }
        foreground(true)
    }
    override fun onHostPause() { foreground(false) }
    override fun onHostDestroy() {
        ContainerRegistry.sessions.values.filter { it.owner===this }.forEach { entry -> entry.deviceServices?.rebindActivity(null) }
        foreground(false)
    }
    override fun invalidate() {
        if (!invalidated.compareAndSet(false, true)) return
        active = false
        super.invalidate()
        reactApplicationContext.runOnUiQueueThread {
            reactApplicationContext.removeLifecycleEventListener(this)
            calls.values.forEach { it.reply.reject(HostErrorCode.CANCELLED, "React instance was invalidated") }; calls.clear()
            ContainerRegistry.sessions.filterValues { it.owner === this }.forEach { (id, entry) ->
                entry.session.eventListener = null
                entry.close(id, 3).whenComplete { _, error ->
                    if (error != null) android.util.Log.e(NAME, "React invalidation retains failed native owner: $id", error)
                }
            }
        }
    }
}
