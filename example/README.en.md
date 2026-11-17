<a id="独立的-react-native-消费者"></a>
# Independent React Native consumer

[简体中文](README.md) · **English**


From the standalone SDK root, run `node tools/create-consumer.mjs --package /absolute/path/sdk.tgz --out /absolute/path/new-consumer`. The shared fixture is authored entirely from included source; it does not borrow a private base pack or assert a compiler/conformance pass.

The pinned official React Native 0.88.0 template installs the exact npm archive, checks its file inventory, and adds the shared portable fixture. `App.tsx` exercises native sessions. `tools/smoke.mjs --consumer /absolute/path/consumer --platform ios|android --device EXISTING_DEVICE_ID --out FRESH_EVIDENCE_DIRECTORY` performs explicit device validation when dependencies and hardware are available. Release is the default; `--development` tests actual refresh/reload. Preparation alone is not a device or GPU pass.

Use `tools/export-example.mjs` to export a verified consumer. Temporary applications/test runners belong to the invoking task and must be cleaned up by that task.
