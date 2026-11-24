<a id="独立的-react-native-消费者"></a>
# Independent React Native consumer

[简体中文](README.md) · **English**


Run the following from the standalone SDK root. `create-consumer.mjs` generates the fixture and adds it to the Android project:

```sh
mkdir -p /tmp/weapp-rn-package
npm pack @weapp-container/react-native@0.1.0-preview.7.1 --pack-destination /tmp/weapp-rn-package
node tools/create-consumer.mjs \
  --package /tmp/weapp-rn-package/weapp-container-react-native-0.1.0-preview.7.1.tgz \
  --out /tmp/weapp-rn-consumer
cd /tmp/weapp-rn-consumer
npx react-native run-android --deviceId <serial>
```

The public prerelease currently supports this Android native dependency path. The iOS Pod references an unavailable SDK archive, so public-package `pod install` cannot currently complete. The example screen provides `Rerender`, `RapidRemount`, `Navigate`, `Back`, `Detach`, `Reattach`, `Pause`, `Resume`, `Close`, `Reopen`, and `Finish` actions. `App.tsx` demonstrates the full Controller, Fabric View, host-method, AbortSignal, message, and stable-storage-key lifecycle.

The pinned official React Native 0.88.0 template installs the exact npm archive, checks its file inventory, and adds the shared portable fixture. `App.tsx` exercises native sessions. `tools/smoke.mjs --consumer /absolute/path/consumer --platform ios|android --device EXISTING_DEVICE_ID --out FRESH_EVIDENCE_DIRECTORY` performs explicit device validation when dependencies and hardware are available. Release is the default; `--development` tests actual refresh/reload. Preparation alone is not a device or GPU pass.

Use `tools/export-example.mjs` to export a verified consumer. Temporary applications/test runners belong to the invoking task and must be cleaned up by that task.
