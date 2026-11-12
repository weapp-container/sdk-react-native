# Weapp Container React Native SDK

首次公开发布正在准备；安装命令须在对应注册源出现本版本后使用。历史私有归档及其锁文件保持原样。

版本 `0.1.0-preview.7.0`；React Native 0.88 新架构，Android API 26+ / Java 17，iOS 16+。安装公开预览：

```sh
npm install @weapp-container/react-native@0.1.0-preview.7.0
```

Android 从 Maven Central 获取 `io.github.weapp-container:weapp-container-android:0.1.0-preview.7.0`。iOS Podfile 添加：

```ruby
source 'https://github.com/weapp-container/Specs.git'
source 'https://cdn.cocoapods.org/'
```

随后在 iOS 工程运行 `pod install`。桥接包依赖同版本 `WeappContainer` Pod，不重复捆绑运行库。普通安装无需 Node 准备命令、Rust 或兄弟 SDK checkout。

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

## 会话生命周期

Controller 与 View 分离，卸载 View 可以保留会话。页面隐藏时显式切换前后台，结束功能时等待关闭完成：

```tsx
await controller.setForeground(false);
// 页面重新显示时
await controller.setForeground(true);

// 不再复用当前会话时
unsubscribe();
await controller.flushStorage();
await controller.close();
```

在 React effect 中创建会话时，处理“组件已卸载但 create 尚未完成”的情况：新建成功后检查组件状态，已卸载则立即关闭。Effect cleanup 不能返回 Promise，应将异步关闭交给会话管理逻辑，并在下次创建前等待它完成。关闭失败时保留 Controller 供重试。完整实现可参考 [example/App.tsx](example/App.tsx)。

宿主方法只接收和返回 JSON 可表示的值。异步操作应观察 `AbortSignal`，在取消后终止对应工作；可抛出导出的 `HostError`，返回 `permission_denied`、`unsupported` 等明确错误代码。

需要登录、账号、网络或设备 API 时，在 `load()` 前调用 `configureHostServices`，再按需调用 `installNativeDeviceApis`。宿主负责网络 origin 白名单和系统权限，受限 Showcase 的编译时策略继续生效。配置、账号切换和完整类型见 [src/index.tsx](src/index.tsx) 与 [CONTRACT.md](CONTRACT.md)。

## 发布构建

Maintainers use `tools/package-public.mjs` with verified Android and iOS release manifests. Historical offline packaging tools remain for auditing old distributions. See `PUBLIC-RELEASE.md`.

## 更多资料与许可

- [公开 API](src/index.tsx) · [协议与能力协商](CONTRACT.md)
- [完整示例](example/App.tsx) · [示例运行说明](example/README.md)
- [公共类型和 C ABI](https://github.com/weapp-container/sdk-contract)

接入层源码使用 [Apache-2.0](LICENSE)。运行库与第三方组件遵循分发归档中的 `RUNTIME-LICENSE` 和 notices；源码开源不授予私有运行库下载权或额外的商用权利。
