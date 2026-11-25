# Weapp Container React Native SDK

**简体中文** · [English](README.en.md)

<a id="public-distribution-candidate-preview7"></a>
## 公开发行候选：preview.7

`0.1.0-preview.7.1` 已发布到 npm，Android Maven 依赖也可匿名解析。它仍是预览版，没有稳定版。当前 React Native iOS Pod 所依赖的 iOS SDK 归档 URL 不可用，因此已发布版本目前仅支持 Android 原生构建；iOS 支持需等待配套归档发布。发行渠道状态见[SDK 发行状态](https://github.com/weapp-container/weapp-container/blob/main/docs/public-sdk-release.md)。

版本 `0.1.0-preview.7.1`；React Native 0.88 新架构，Android API 26+ / Java 17，iOS 16+。安装公开预览：

```sh
npm install @weapp-container/react-native@0.1.0-preview.7.1
```

Android 从 Maven Central 获取 `io.github.weapp-container:weapp-container-android:0.1.0-preview.7.1`。npm 包可以安装，但其 iOS Pod 依赖的固定 SDK 归档当前不可用，不能完成 iOS 原生构建。普通应用应只在 Android 使用当前预览版；iOS 原生支持尚未发布。Android 普通安装无需 Rust 或兄弟 SDK checkout。

[开发文档](https://container.weapp.dev/docs/) · [源码构建](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.md) · [API 与协议](https://github.com/weapp-container/sdk-contract/blob/main/README.md)

在 React Native 应用中嵌入原生小程序容器，支持 Android 与 iOS，使用 Fabric 组件和 TurboModule。通过 TypeScript Controller 加载 pack、导航、收发消息和管理会话。

包名：`@weapp-container/react-native`；示例与 npm 预览版本：`0.1.0-preview.7.1`；原生 ABI：`1`。本仓库提供 Apache-2.0 许可的接入层。普通应用使用公开预览包和 Android Maven 依赖；源码构建与归档准备属于 SDK 维护流程。

> 当前源码与默认公开锁均使用 preview.7.1。准备工具默认读取 `runtime-artifacts.0.1.0-preview.7.1.lock.json`；`runtime-artifacts.lock.json` 仅保留历史 preview.5.3 输入。自定义本地归档仍须通过 `--manifest` 指定同版本审核锁。npm 与 Android Maven 预览包已公开，iOS 原生归档尚未发布。

<a id="start-from-current-source"></a>
## 维护者源码构建

普通 Android 应用直接安装上面的 npm 包。只有维护 SDK、生成 iOS 配套原生依赖或更新发行清单时，才按[源码构建说明](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.md)准备源码和目标工具链。npm `.7.1` 与 Android Maven 依赖可获取，但 iOS Podspec 引用的 SDK 归档当前不可用。

<a id="requirements"></a>
## 环境要求

| 项目 | 版本 |
| --- | --- |
| Node.js / Python | Node.js 24+、Python 3 |
| React Native / React | React Native 0.88.0（新架构）、React 19.3.0 |
| TypeScript | 5.9.3 |
| Android | API 26+；arm64-v8a、x86_64；Android SDK、JDK、Gradle 工具链 |
| iOS | iOS 16+；arm64 真机、arm64/x86_64 模拟器；macOS、Xcode、CocoaPods |

当前公开预览尚不能构建 iOS 原生应用，因为 Podspec 引用的配套 SDK 归档尚未发布。

<a id="1-install-the-sdk"></a>
## 1. 安装 SDK

在 React Native 应用中安装已发布的 npm 预览包：

```sh
npm install @weapp-container/react-native@0.1.0-preview.7.1
```

Android 使用公开 Maven 依赖并可按下方示例构建。当前预览的 iOS Pod 依赖归档尚不可用，因此不要在 iOS 上执行 `pod install` 来接入此版本。Android 应用只启用 `arm64-v8a,x86_64`。

需要生成自定义分发包时，请先阅读文末面向维护者的“从源码生成分发包”。

<a id="2-create-a-session-and-register-host-methods"></a>
## 2. 创建会话与注册宿主方法

由页面或路由管理 Controller，保留同一个实例，不要在 React render 中重复创建。首次加载 pack 前注册方法和事件：

```tsx
import {
  WeappContainerController,
  WeappContainerView,
} from '@weapp-container/react-native';

const controller = await WeappContainerController.create({
  storage: {key: 'account-42:catalog'},
});
await controller.registerHostMethod('host.echo', async (payload, {signal}) => {
  if (signal.aborted) throw new Error('Host call cancelled');
  return {value: payload};
});
const unsubscribe = controller.subscribe(event => {
  if (event.type === 'message') console.log(event.payload);
  if (event.type === 'error') console.error(event.payload);
});
```

使用稳定的应用/账号标识作为存储 key。只需要内存状态时，改为 `storage: {memoryOnly: true}`。

<a id="3-mount-the-view-and-load-a-pack"></a>
## 3. 挂载 View 并加载 pack

在组件中渲染具有正数宽高的区域，传入上面创建的 Controller：

```tsx
<WeappContainerView
  controller={controller}
  style={{height: 480, width: '100%'}}
  onSurfaceError={error => console.error(error.code, error.message)}
/>
```

加载随应用打包的 pack：

```tsx
await controller.load({asset: 'catalog-pack'});
```

`asset` 相对于 Android 的 `assets/` 或 iOS 主资源 bundle。Android 可放在 `android/app/src/main/assets/catalog-pack/`；iOS 将整个 `catalog-pack` 目录作为资源文件夹加入应用 target，保留目录结构。

也可以加载已生成、已校验并解包到应用私有目录的 pack：

```tsx
await controller.load({directory: '/verified/local/catalog-pack'});
await controller.navigate('pages/detail/index', {id: '42'});
await controller.sendMessage({type: 'refresh'});
await controller.back();
```

pack 需要符合运行库格式，不能直接传入普通小程序源码目录。完整的 React 页面挂载与资源打包示例见 [example/App.tsx](example/App.tsx) 和[独立示例生成器](tools/create-consumer.mjs)。

<a id="session-lifecycle"></a>
## 会话生命周期

Controller 与 View 分离，卸载 View 可以保留会话。页面隐藏时显式切换前后台，结束功能时等待关闭完成：

```tsx
await controller.setForeground(false);
// When the page becomes visible again
await controller.setForeground(true);

// When the session will no longer be reused
unsubscribe();
await controller.flushStorage();
await controller.close();
```

在 React effect 中创建会话时，处理“组件已卸载但 create 尚未完成”的情况：新建成功后检查组件状态，已卸载则立即关闭。Effect cleanup 不能返回 Promise，应将异步关闭交给会话管理逻辑，并在下次创建前等待它完成。关闭失败时保留 Controller 供重试。完整实现可参考 [example/App.tsx](example/App.tsx)。

宿主方法只接收和返回 JSON 可表示的值。异步操作应观察 `AbortSignal`，在取消后终止对应工作；可抛出导出的 `HostError`，返回 `permission_denied`、`unsupported` 等明确错误代码。

需要登录、账号、网络或设备 API 时，在 `load()` 前调用 `configureHostServices`，再按需调用 `installNativeDeviceApis`。宿主负责网络 origin 白名单和系统权限，受限 Showcase 的编译时策略继续生效。配置、账号切换和完整类型见 [src/index.tsx](src/index.tsx) 与 [CONTRACT.md](CONTRACT.md)。

<a id="build-a-distribution-from-source"></a>
## 从源码生成分发包

```sh
npm install --ignore-scripts
npm run typecheck
node tools/prepare-native.mjs --platform android --arch universal \
  --manifest /absolute/reviewed-preview6-lock.json --artifact-dir /absolute/archives
node tools/prepare-native.mjs --platform ios --arch universal \
  --manifest /absolute/reviewed-preview6-lock.json --artifact-dir /absolute/archives
node tools/package.mjs --out /absolute/new-sdk-packages \
  --manifest /absolute/reviewed-preview6-lock.json --artifact-dir /absolute/archives
```

以上示例使用已获授权的离线归档。在线下载时省略 `--artifact-dir`，通过环境变量 `WEAPP_CONTAINER_RUNTIME_TOKEN` 提供私有运行库仓库的只读授权。不要提交凭据或归档。

准备工具校验精确版本、ABI、架构、大小和 SHA-256，将原生依赖放入忽略提交的 `native/` 目录。打包要求独立、已提交且通过源码清单校验的仓库，同时验证 Android/iOS 原生依赖，执行 TypeScript 构建、RN codegen 和 `npm pack`，输出 `.tgz` 与 `build.json`。需要额外校验 lock 文件本身时，追加 `--manifest-sha256` 和独立确认的 SHA-256。

从生成的归档创建包含测试 pack 的独立应用：

```sh
node tools/create-consumer.mjs \
  --package /absolute/new-sdk-packages/weapp-container-react-native-0.1.0-preview.7.1.tgz \
  --out /absolute/new-rn-consumer
```

该命令使用固定的 React Native 模板，安装 SDK 并准备原生工程；实际构建和设备运行另行执行。见 [example/README.md](example/README.md)。

<a id="troubleshooting"></a>
## 常见问题

| 现象 | 检查项 |
| --- | --- |
| 默认准备命令拒绝版本 | 确认使用当前 preview.7.1 公开锁；自定义 manifest 必须与包装层和归档一致 |
| 找不到 AAR / XCFramework | 先准备同版本原生 SDK；单独安装源码不会附带运行库 |
| Android 链接或安装失败 | API 26+，仅启用 arm64-v8a、x86_64 |
| 原生组件不可用 | 使用新架构，完成原生依赖准备、CocoaPods 安装和应用重新构建 |
| 关闭后仍有异步回调 | 取消宿主任务并等待原生清理完成，不复用已关闭的 Controller |

<a id="documentation-and-licensing"></a>
## 更多资料与许可

- [公开 API](src/index.tsx) · [协议与能力协商](CONTRACT.md)
- [完整示例](example/App.tsx) · [示例运行说明](example/README.md)
- [公共类型和 C ABI](https://github.com/weapp-container/sdk-contract/blob/main/README.md)

接入层源码使用 [Apache-2.0](LICENSE)。运行库与第三方组件遵循分发归档中的 `RUNTIME-LICENSE` 和 notices；源码开源不授予私有运行库下载权或额外的商用权利。

<a id="historical-archives-and-migration"></a>
## 历史归档与迁移

运行库发行工具已迁入 [核心仓库](https://github.com/weapp-container/weapp-container/tree/main/tools/runtime-artifacts)。新清单使用核心仓库的精确版本 Release；用 `--manifest` 显式选取。更新后的下载器把旧锁中的 `runtime-artifacts` 标识定向到私有的 `weapp-container/runtime-artifacts-private-archive`，仅允许九个冻结版本，保留原版本、哈希及随附许可，回执记录实际存储库。旧版下载器需升级；同名新仓库只保留停更工具源码。无跨仓库回退，私有档案仍需读取权限，源码许可不代表历史发行物公开可用。

核心运行时与 SDK 自有源码采用 Apache-2.0，可按[主仓库源码构建说明](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.md)构建当前运行库。现有预编译归档保留原许可、访问要求及精确版本和哈希锁；本次源码更新不发布替代二进制。

## 发布构建

维护者通过 `tools/package-public.mjs` 使用已验证的 Android/iOS 发行清单构建公开候选。历史离线工具用于复核旧分发，详见[公开发行流程](PUBLIC-RELEASE.md)。
