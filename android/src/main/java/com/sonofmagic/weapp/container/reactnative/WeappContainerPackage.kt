package com.sonofmagic.weapp.container.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

class WeappContainerPackage : BaseReactPackage() {
    override fun getModule(name: String, context: ReactApplicationContext): NativeModule? = if (name == WeappContainerModule.NAME) WeappContainerModule(context) else null
    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(WeappContainerModule.NAME to ReactModuleInfo(WeappContainerModule.NAME, WeappContainerModule::class.java.name, false, false, false, true))
    }
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(WeappContainerViewManager())
}
