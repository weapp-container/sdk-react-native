<a id="independent-react-native-consumer"></a>
# 独立的 React Native 消费者

**简体中文** · [English](README.en.md)


从独立 SDK 根目录运行以下命令。`create-consumer.mjs` 会生成 fixture 并将它加入 Android 工程：

```sh
mkdir -p /tmp/weapp-rn-package
npm pack @weapp-container/react-native@0.1.0-preview.7.1 --pack-destination /tmp/weapp-rn-package
node tools/create-consumer.mjs \
  --package /tmp/weapp-rn-package/weapp-container-react-native-0.1.0-preview.7.1.tgz \
  --out /tmp/weapp-rn-consumer
cd /tmp/weapp-rn-consumer
npx react-native run-android --deviceId <serial>
```

当前公开预览只支持这条 Android 原生依赖路径。iOS Pod 固定引用的 SDK 归档尚不可用，暂时无法按公开包完成 `pod install`。示例屏幕提供 `Rerender`、`RapidRemount`、`Navigate`、`Back`、`Detach`、`Reattach`、`Pause`、`Resume`、`Close`、`Reopen` 和 `Finish` 操作，`App.tsx` 展示 Controller、Fabric View、宿主方法、AbortSignal、消息和稳定 storage key 的完整生命周期。

固定版本的官方 React Native 0.88.0 模板安装精确的 npm 归档文件，检查其文件清单，并添加共享的可移植测试用例。`App.tsx` 对原生会话进行测试。`tools/smoke.mjs --consumer /absolute/path/consumer --platform ios|android --device EXISTING_DEVICE_ID --out FRESH_EVIDENCE_DIRECTORY` 在依赖项和硬件可用时执行显式的设备验证。发布模式为默认；`--development` 测试实际的刷新/重新加载。仅准备阶段并不能构成设备或 GPU 通过。

使用 `tools/export-example.mjs` 导出一个已验证的消费者。临时应用程序/测试运行器属于调用任务，必须由该任务负责清理。
