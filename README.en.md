# Weapp Container React Native SDK

Runtime packaging and publication now live in the [core repository](https://github.com/weapp-container/weapp-container/tree/main/tools/runtime-artifacts). New manifests select exact core releases through `--manifest`. The default lock retains its historical `runtime-artifacts` source, version, hashes and bundled licenses. The retired repository remains a read-only archive; downloads never fall back between repositories. Private repositories still require read access; source licensing does not imply public binary availability.

The core runtime and SDK source are available under Apache-2.0. Build the current runtime from the [core source guide](https://github.com/weapp-container/weapp-container/blob/main/docs/sdk-repositories.md). Existing prebuilt archives retain their original licenses, access requirements and exact version/hash pins; this source update does not publish replacement binaries.

[简体中文](README.md) | [English](README.en.md)

Embed a native mini-program container in React Native applications on Android and iOS, using a Fabric component and TurboModule. A TypeScript Controller handles packs, navigation, messages and session ownership.

Package: `@weapp-container/react-native`; current version: `0.1.0-preview.6.0`; native ABI: `1`. This repository contains the Apache-2.0 integration layer. The runtime is a separately authorized binary dependency.

> Current source requires preview.6.0 native SDKs, while the default lock still preserves historical preview.5.3 archives. Source integrations must select a reviewed preview.6.0 lock with `--manifest`. Default preparation rejects the mismatch. Public source does not imply an npm release or public native downloads.

## Requirements

| Component | Version |
| --- | --- |
| Node.js / Python | Node.js 24+, Python 3 |
| React Native / React | React Native 0.88.0 (new architecture), React 19.3.0 |
| TypeScript | 5.9.3 |
| Android | API 26+; arm64-v8a, x86_64; Android SDK, JDK and Gradle toolchain |
| iOS | iOS 16+; arm64 device, arm64/x86_64 simulator; macOS, Xcode and CocoaPods |

## 1. Install the SDK

If you have an authorized SDK distribution with native dependencies, install its local archive in your React Native application:

```sh
npm install /absolute/packages/weapp-container-react-native-0.1.0-preview.6.0.tgz
cd ios
pod install
```

The archive includes native SDKs and notices; consuming it requires neither core source nor Rust tooling. Enable only `arm64-v8a,x86_64` in Android and set the iOS deployment target to `16.0` or later.

To generate a distribution from this repository, follow “Build a distribution from source” below.

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

For login, accounts, networking or device APIs, call `configureHostServices`, then optionally `installNativeDeviceApis`, before `load()`. The host controls network origin allowlists and OS permissions. Restricted Showcase runtimes continue to enforce their compiled policy. See [src/index.tsx](src/index.tsx) and [CONTRACT.md](CONTRACT.md) for configuration, account switching and full types.

## Build a distribution from source

```sh
git clone https://github.com/weapp-container/sdk-react-native.git
cd sdk-react-native
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
  --package /absolute/new-sdk-packages/weapp-container-react-native-0.1.0-preview.6.0.tgz \
  --out /absolute/new-rn-consumer
```

The generator uses a pinned React Native template, installs the SDK and prepares native projects. Native builds and device execution are separate steps. See [example/README.md](example/README.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Default preparation rejects the version | The default lock is historical preview.5.3; explicitly select a reviewed preview.6.0 lock |
| Missing AAR / XCFramework | Prepare matching native SDKs; a source checkout does not include the runtime |
| Android linking or installation fails | API 26+, arm64-v8a and x86_64 only |
| Native component is unavailable | Use the new architecture, prepare native dependencies, install CocoaPods and rebuild |
| Work remains after closing | Cancel host tasks and await native cleanup; do not reuse a closed Controller |

## Documentation and licensing

- [Public API](src/index.tsx) · [Protocol and capability negotiation](CONTRACT.md)
- [Complete example](example/App.tsx) · [Running the example](example/README.md)
- [Public types and C ABI](https://github.com/weapp-container/sdk-contract)

The integration source is licensed under [Apache-2.0](LICENSE). Runtime and third-party components retain the `RUNTIME-LICENSE` and notices in their archives. Historical archives retain their supplied licenses and access requirements.
