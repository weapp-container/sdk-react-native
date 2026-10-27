package com.sonofmagic.weapp.container.reactnative

import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.*
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.WeappContainerNativeViewManagerDelegate
import com.facebook.react.viewmanagers.WeappContainerNativeViewManagerInterface
import com.sonofmagic.weapp.container.sdk.WeappContainerView

class ContainerSurface(val reactContext: ThemedReactContext) : FrameLayout(reactContext) {
    private val nativeView = WeappContainerView(reactContext)
    private var sessionId = ""
    private var entry: ContainerRegistry.Entry? = null
    private var waiting: java.util.concurrent.CompletableFuture<Unit>? = null
    init { addView(nativeView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }
    fun setSession(value: String?) {
        val next = value ?: ""
        if (sessionId == next) return
        sessionId = next
        bind()
    }
    private fun report(error: Throwable) {
        val dispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
        dispatcher?.dispatchEvent(SurfaceErrorEvent(UIManagerHelper.getSurfaceId(reactContext), id, error.message ?: "Surface binding failed"))
    }
    private fun retire() {
        val previous = entry ?: return
        if (previous.surface?.get() !== this) { entry = null; return }
        if (previous.retirement != null) return
        val result = nativeView.unbindAsync()
        previous.retirement = result
        result.whenComplete { _, error -> reactContext.runOnUiQueueThread {
            if (previous.retirement === result) {
                if (error == null) { previous.surface = null; if (entry === previous) entry = null }
                previous.retirement = null
            }
            if (error != null) report(error)
        } }
    }
    private fun bind() {
        try {
            val target = if (isAttachedToWindow) sessionId else ""
            val next = if (target.isEmpty()) null else ContainerRegistry.sessions[target]
            if (entry != null && entry !== next) retire()
            if (target.isEmpty()) { retire(); return }
            require(next != null && next.owner.owns(reactContext.reactApplicationContext)) { "Unknown session for this React instance" }
            val previousSurface = next.surface?.get()
            if (next.retirement == null && previousSurface != null && previousSurface !== this && !previousSurface.isAttachedToWindow) previousSurface.retire()
            val pending = entry?.retirement ?: next.retirement
            if (pending != null) {
                if (waiting === pending) return
                waiting = pending
                pending.whenComplete { _, error -> reactContext.runOnUiQueueThread {
                    if (waiting === pending) { waiting = null; if (error == null) bind() else report(error) }
                } }
                return
            }
            require(next.surface?.get() == null || next.surface?.get() === this) { "A session can be mounted in only one native view" }
            nativeView.bind(next.session)
            next.surface = java.lang.ref.WeakReference(this); entry = next
        } catch (error: Throwable) { report(error) }
    }
    fun detach() { sessionId = ""; retire() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); bind() }
    override fun onDetachedFromWindow() { retire(); super.onDetachedFromWindow() }
}
private class SurfaceErrorEvent(surfaceId: Int, viewId: Int, private val message: String) : Event<SurfaceErrorEvent>(surfaceId, viewId) {
    override fun getEventName() = "topSurfaceError"
    override fun getEventData() = Arguments.createMap().apply { putString("code", "ERR_SURFACE"); putString("message", message) }
    override fun canCoalesce() = false
}
class WeappContainerViewManager : SimpleViewManager<ContainerSurface>(), WeappContainerNativeViewManagerInterface<ContainerSurface> {
    private val delegate = WeappContainerNativeViewManagerDelegate(this)
    override fun getDelegate(): ViewManagerDelegate<ContainerSurface> = delegate
    override fun getName() = "WeappContainerNativeView"
    override fun createViewInstance(reactContext: ThemedReactContext) = ContainerSurface(reactContext)
    @ReactProp(name = "sessionId")
    override fun setSessionId(view: ContainerSurface, value: String?) { view.setSession(value) }
    override fun onDropViewInstance(view: ContainerSurface) { view.detach(); super.onDropViewInstance(view) }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = mutableMapOf("topSurfaceError" to mapOf("registrationName" to "onSurfaceError"))
}
