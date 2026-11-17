<a id="independent-react-native-consumer"></a>
# 独立的 React Native 消费者

**简体中文** · [English](README.en.md)


从独立 SDK 根目录运行 `node tools/create-consumer.mjs --package /absolute/path/sdk.tgz --out /absolute/path/new-consumer`。共享的测试用例完全基于包含的源码编写；它不依赖私有基础包，也不要求编译器或符合性通过。

固定版本的官方 React Native 0.88.0 模板安装精确的 npm 归档文件，检查其文件清单，并添加共享的可移植测试用例。`App.tsx` 对原生会话进行测试。`tools/smoke.mjs --consumer /absolute/path/consumer --platform ios|android --device EXISTING_DEVICE_ID --out FRESH_EVIDENCE_DIRECTORY` 在依赖项和硬件可用时执行显式的设备验证。发布模式为默认；`--development` 测试实际的刷新/重新加载。仅准备阶段并不能构成设备或 GPU 通过。

使用 `tools/export-example.mjs` 导出一个已验证的消费者。临时应用程序/测试运行器属于调用任务，必须由该任务负责清理。
