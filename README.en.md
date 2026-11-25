# Weapp Container React Native SDK

[简体中文](README.md) · **English**

<a id="公开发行候选preview7"></a>
## Public distribution candidate: preview.7

`0.1.0-preview.7.1` is published to npm, and its Android Maven dependency resolves anonymously. It remains a prerelease, with no stable version available. The iOS SDK archive referenced by the React Native Pod is unavailable, so the published release currently supports Android native builds only. iOS support depends on publication of the matching archive. See the [SDK release status](https://github.com/weapp-container/weapp-container/blob/main/docs/public-sdk-release.en.md).

Version `0.1.0-preview.7.1` targets React Native 0.88 with the New Architecture, Android API 26+ / Java 17, and iOS 16+. Install the public preview:

```sh
npm install @weapp-container/react-native@0.1.0-preview.7.1
```

Android resolves `io.github.weapp-container:weapp-container-android:0.1.0-preview.7.1` from Maven Central. The npm package is installable, but its iOS Pod depends on an unavailable fixed SDK archive, so an iOS native build cannot complete. Use the current prerelease for Android only. Android installation needs no Rust or sibling SDK checkout.

[Documentation](https://container.weapp.dev/en/docs/) · [Source builds](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.en.md) · [APIs and protocols](https://github.com/weapp-container/sdk-contract/blob/main/README.en.md)

Embed a native mini-program container in React Native applications on Android and iOS, using a Fabric component and TurboModule. A TypeScript Controller handles packs, navigation, messages and session ownership.

Package: `@weapp-container/react-native`; example and npm prerelease version: `0.1.0-preview.7.1`; native ABI: `1`. This repository contains the Apache-2.0 integration layer. Applications use the published prerelease and Android Maven dependency; source builds and archive preparation are SDK maintenance workflows.

> Current source and the default public lock both use preview.7.1. Preparation reads `runtime-artifacts.0.1.0-preview.7.1.lock.json` by default; `runtime-artifacts.lock.json` retains historical preview.5.3 inputs only. Custom local archives still require a reviewed same-version lock selected with `--manifest`. The npm and Android Maven prereleases are public; the iOS native archive is not.

<a id="从当前源码开始"></a>
## Maintainer source builds

Normal Android applications should install the npm package above. SDK maintainers generating the iOS native dependency or updating release manifests should follow the [source build guide](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.en.md) from a prepared checkout. The npm `.7.1` package and Android Maven dependency are available, while the SDK archive referenced by the iOS Podspec is unavailable.

<a id="环境要求"></a>
## Requirements

| Component | Version |
| --- | --- |
| Node.js / Python | Node.js 24+, Python 3 |
| React Native / React | React Native 0.88.0 (new architecture), React 19.3.0 |
| TypeScript | 5.9.3 |
| Android | API 26+; arm64-v8a, x86_64; Android SDK, JDK and Gradle toolchain |
| iOS | iOS 16+; arm64 device, arm64/x86_64 simulator; macOS, Xcode and CocoaPods |

The published prerelease cannot currently build an iOS application because the matching SDK archive referenced by its Podspec has not been published.

<a id="1-安装-sdk"></a>
## 1. Install the SDK

Install the published npm prerelease in your React Native application:

```sh
npm install @weapp-container/react-native@0.1.0-preview.7.1
```

Android resolves its native dependency from the public Maven artifact and can be built using the example below. The iOS Pod depends on an unavailable archive, so do not run `pod install` to integrate this prerelease on iOS. Enable only `arm64-v8a,x86_64` in Android.

To generate a custom distribution, follow “Build a distribution from source” below as a maintainer workflow.

<a id="2-创建会话与注册宿主方法"></a>
## 2. Create a session and register host methods

Let a page or route own the Controller and retain that instance. Do not recreate it during React render. Register methods and events before loading the first pack:

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

Use a stable application/account identity for the storage key. For memory-only state, use `storage: {memoryOnly: true}` instead.

<a id="3-挂载-view-并加载-pack"></a>
## 3. Mount the View and load a pack

Render a View with positive width and height, passing the Controller created above:

```tsx
<WeappContainerView
  controller={controller}
  style={{height: 480, width: '100%'}}
  onSurfaceError={error => console.error(error.code, error.message)}
/>
```

Load a pack bundled with the application:

```tsx
await controller.load({asset: 'catalog-pack'});
```

`asset` is relative to Android `assets/` or the iOS main resource bundle. On Android, use `android/app/src/main/assets/catalog-pack/`. On iOS, add the whole `catalog-pack` directory to the application target as a resource folder, preserving its directory structure.

Alternatively, load a generated, verified pack extracted into application-private storage:

```tsx
await controller.load({directory: '/verified/local/catalog-pack'});
await controller.navigate('pages/detail/index', {id: '42'});
await controller.sendMessage({type: 'refresh'});
await controller.back();
```

The pack must use the runtime's supported format. An ordinary mini-program source directory is insufficient. See [example/App.tsx](example/App.tsx) and the [independent consumer generator](tools/create-consumer.mjs) for full React mounting and resource setup.

<a id="会话生命周期"></a>
## Session lifecycle

Controllers and Views have separate lifetimes. Unmounting a View can preserve its session. Set foreground state explicitly when hiding a page and await closing when finished:

```tsx
await controller.setForeground(false);
// When the page becomes visible again
await controller.setForeground(true);

// When the session will no longer be reused
unsubscribe();
await controller.flushStorage();
await controller.close();
```

When creating a session in a React effect, handle unmounts that happen before `create` resolves: check the component's state and immediately close a newly created orphan. An effect cleanup cannot return a Promise; let the session owner track asynchronous closing and await it before creating a replacement. Retain the Controller for retry if closing fails. See [example/App.tsx](example/App.tsx) for a full implementation.

Host methods accept and return JSON-compatible values. Asynchronous work should observe its `AbortSignal` and stop the corresponding work on cancellation. Throw the exported `HostError` for explicit codes such as `permission_denied` or `unsupported`.

For login, accounts, networking or device APIs, call `configureHostServices`, then optionally `installNativeDeviceApis`, before `load()`. The host controls network origin allowlists and OS permissions. Restricted Showcase runtimes continue to enforce their compiled policy. See [src/index.tsx](src/index.tsx) and [CONTRACT.md](CONTRACT.en.md) for configuration, account switching and full types.

<a id="从源码生成分发包"></a>
## Build a distribution from source

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

This example uses authorized offline archives. For online downloads, omit `--artifact-dir` and provide read access to the private runtime repository through `WEAPP_CONTAINER_RUNTIME_TOKEN`. Keep credentials and archives out of Git.

Preparation verifies the exact version, ABI, architectures, size and SHA-256, installing dependencies under the ignored `native/` directory. Packaging requires a committed standalone checkout that passes source inventory checks. It verifies both Android and iOS dependencies, builds TypeScript, runs RN codegen and `npm pack`, and writes a `.tgz` and `build.json`. To additionally verify the lock itself, pass `--manifest-sha256` with an independently confirmed digest.

Create an independent application with a test pack from that archive:

```sh
node tools/create-consumer.mjs \
  --package /absolute/new-sdk-packages/weapp-container-react-native-0.1.0-preview.7.1.tgz \
  --out /absolute/new-rn-consumer
```

The generator uses a pinned React Native template, installs the SDK and prepares native projects. Native builds and device execution are separate steps. See [example/README.md](example/README.en.md).

<a id="常见问题"></a>
## Troubleshooting

| Symptom | Check |
| --- | --- |
| Default preparation rejects the version | Use the current preview.7.1 public lock; a custom manifest must match the wrapper and archives |
| Missing AAR / XCFramework | Prepare matching native SDKs; a source checkout does not include the runtime |
| Android linking or installation fails | API 26+, arm64-v8a and x86_64 only |
| Native component is unavailable | Use the new architecture, prepare native dependencies, install CocoaPods and rebuild |
| Work remains after closing | Cancel host tasks and await native cleanup; do not reuse a closed Controller |

<a id="更多资料与许可"></a>
## Documentation and licensing

- [Public API](src/index.tsx) · [Protocol and capability negotiation](CONTRACT.en.md)
- [Complete example](example/App.tsx) · [Running the example](example/README.en.md)
- [Public types and C ABI](https://github.com/weapp-container/sdk-contract/blob/main/README.en.md)

The integration source is licensed under [Apache-2.0](LICENSE). Runtime and third-party components retain the `RUNTIME-LICENSE` and notices in their archives. Historical archives retain their supplied licenses and access requirements.

<a id="历史归档与迁移"></a>
## Historical archives and migration

Historical storage: updated downloaders map the nine frozen legacy `runtime-artifacts` versions to the private `weapp-container/runtime-artifacts-private-archive`, retaining original lock bytes, hashes and licenses and recording the resolved repository. Old downloaders must upgrade. The new repository at the old name contains retired tool source only; new runtime releases use the core repository. Private archive access still requires authorization, with no cross-repository fallback.

Runtime packaging and publication now live in the [core repository](https://github.com/weapp-container/weapp-container/tree/main/tools/runtime-artifacts). New manifests select exact core releases through `--manifest`. The default lock retains its historical `runtime-artifacts` source, version, hashes and bundled licenses. The retired repository remains a read-only archive; downloads never fall back between repositories. Private repositories still require read access; source licensing does not imply public binary availability.

The core runtime and SDK source are available under Apache-2.0. Build the current runtime from the [core source guide](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-source-build.en.md). Existing prebuilt archives retain their original licenses, access requirements and exact version/hash pins; this source update does not publish replacement binaries.

## Release builds

Maintainers use `tools/package-public.mjs` with verified Android/iOS release manifests to build public candidates. Historical offline tools remain for reviewing old distributions; see [public release workflow](PUBLIC-RELEASE.en.md).
