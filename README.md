# Weapp Container React Native SDK

Apache-2.0 Fabric/TurboModule bindings for iOS and Android. Source repository: https://github.com/weapp-container/sdk-react-native. Package `@weapp-container/react-native`, version **0.1.0-preview.5**, native ABI **1**. Public component/controller names are preserved.

This source repository contains the TypeScript wrapper, native platform adapters, consumers and source tests. Container-core/Rust sources, native binaries, generated application packs, caches and source history are excluded. Native runtimes are separate authorized binary dependencies.

The npm wrapper remains preview.2; its native dependency is now explicitly pinned
to **0.1.0-preview.5**. These versions have independent release identities.
Caches are isolated by version, platform, architecture and content hash; failed
preparation preserves the current vendor installation and historical caches.

## Prepare native dependencies

Use Node.js 24+, Python 3, React Native **0.88.0**, React **19.3.0**, TypeScript **5.9.3**, iOS **16.0+** and Android **26+**. Android slices are `arm64-v8a,x86_64`; unsupported requests explicitly fail.

The exact release is private `weapp-container/runtime-artifacts`, tag `runtime-v0.1.0-preview.5`. `runtime-artifacts.lock.json` requires version/ABI/component/platform/architecture, size and SHA-256 pins. The current lock pins the reviewed Android universal SDK (arm64-v8a and x86_64) and iOS universal SDK (arm64 device, arm64 simulator and x86_64 simulator). The checked-in lock preserves all ten reviewed runtime/SDK assets; native preparation consumes only the Android/iOS SDK entries. Every preparation and package assembly revalidates these exact bytes; a pin does not itself assert release publication or a device pass. There is no floating version, fabricated hash, parent checkout or core-source build fallback.

Install an approved lock, then supply `WEAPP_CONTAINER_RUNTIME_TOKEN` with read access to that repository, or `WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR` with authorized offline `.tar.gz` assets:

Network artifact transfers have a single 15-minute deadline covering headers,
redirects and the complete body; release metadata has a separate 30-second
deadline. For slower connections, set `WEAPP_CONTAINER_RUNTIME_TIMEOUT_MS` to a
positive base-10 integer in milliseconds, up to `3600000` (one hour). Invalid
values return `ERR_RUNTIME_OPTIONS`; transfer failures and timeouts return
sanitized `ERR_RUNTIME_NETWORK`. Explicit API/CLI overrides are documented in the
[shared SDK contract](https://github.com/weapp-container/sdk-contract).

```sh
node tools/prepare-native.mjs --platform android --arch universal
node tools/prepare-native.mjs --platform ios --arch universal
npm install --ignore-scripts
npm run typecheck
node tools/package.mjs --out /absolute/path/new-package-output
```

A universal pin must list its actual architectures. Native preparation verifies archives, performs bounded safe extraction under ignored `.runtime/`, and installs platform dependencies in ignored `native/`. Packaging revalidates the exact lock and every installed path/hash/mode, runs TypeScript and RN codegen, stages only distribution inputs, records inventory hashes, and runs `npm pack`. It requires this standalone checkout to be committed; it never borrows Git provenance from a parent directory. Missing AAR/XCFramework fails explicitly before native dependency resolution. No Rust compiler runs in this repository.

The assembled npm archive carries the authorized native SDKs and their license notices. Consumers installing that archive need no parent repository or private source; source-clone consumers must prepare the native dependencies first. Repository read access is separate from permission to redistribute runtime binaries.

## API and independent consumers

```tsx
import {WeappContainerView, WeappContainerController} from '@weapp-container/react-native';
```

See `src/index.tsx` for the exact exported types and `example/App.tsx` for sessions, messages, callbacks and cleanup. The example creates an authored portable pack from the included fixture source:

```sh
node tools/create-consumer.mjs \
  --package /absolute/path/weapp-container-react-native-0.1.0-preview.2.tgz \
  --out /absolute/path/new-rn-consumer
```

The fixture requires no private base pack and explicitly identifies itself as handwritten; it is not weapp-vite compiler or upstream conformance evidence. The consumer generator uses the official pinned React Native template, installs and verifies the exact npm archive, then prepares both native application projects. It records preparation, not successful native builds.

`tools/create-host-consumer.mjs` adds the parent-routing/scroll harness. `tools/smoke.mjs` and `tools/host-smoke.mjs` require caller-selected existing simulator/device IDs and a fresh evidence directory; they do not constitute evidence until actually executed. `tools/export-example.mjs` exports a prepared consumer after its dependency and inventory checks. `example/ConsumerUITests.swift` and host tests retain platform UI assertions.

## Validation, licensing and provenance

```sh
node --test tests/source-contract.test.mjs
npm run typecheck
```

`CONTRACT.md` defines the SDK protocol, including native GPU presentation receipts. Both native adapters embed the platform SDK’s `WeappContainerView`, so its completed-presentation/input gate applies directly; the React Native wrapper does not acknowledge draw submission itself.

`ORIGIN.json` records the private source revision, original path/SHA-256 and exported hashes. `LICENSE` covers the wrappers; binary SDK notices remain attached to their verified distributions. This source split does not assert a binary release, registry publication, native compilation, device/GPU pass, or complete WeChat parity.

### Reviewing later SDK source changes

`ORIGIN.json` remains the historical extraction receipt. `SOURCE-INVENTORY.json` separately pins the current reviewed wrapper source paths, SHA-256, sizes and executable modes, including the unchanged historical receipt. Neither file is build or device acceptance evidence. Source tests and package assembly require an independent Git checkout and reject untracked files, unreviewed tracked paths, changed bytes, symlinks, core sources, binary files and build caches.

After reviewing source or runtime-lock updates, stage all intended new files and explicitly refresh the current inventory; do not rewrite `ORIGIN.json`:

```sh
git add <reviewed-files>
node tools/source-inventory.mjs --write --version 0.1.0-preview.5 --reason "Describe the reviewed source changes"
git add SOURCE-INVENTORY.json
node tools/source-inventory.mjs
node --test tests/source-inventory.test.mjs tests/source-contract.test.mjs
```

Commit the source and inventory together before assembling distributable packages. The inventory's `sourceBaseCommit` identifies the checkout on which the review was prepared; it does not bind later build or runtime evidence to that earlier commit. Runtime artifact locks must use actual published archive hashes and are reviewed independently.

## preview.5 source status

This checkout implements the preview.5 protocol and pins newly built preview.5 artifacts. Historical preview.4 bytes and evidence retain their original bindings. The source version and lock do not establish a Player, GPU or device pass; consult separately source-bound validation reports.
