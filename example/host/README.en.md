<a id="原生宿主路由和滚动消费者"></a>
# Native host routing and scrolling consumer

[简体中文](README.md) · **English**


Run from the standalone SDK root; the portable fixture is authored from the included source:

```sh
node tools/create-host-consumer.mjs --package /absolute/path/sdk.tgz --out /absolute/path/new-host-consumer
node tools/host-smoke.mjs --consumer /absolute/path/new-host-consumer --platform ios --device EXISTING_SIMULATOR_ID --out FRESH_EVIDENCE_DIRECTORY
```

Android is selected with `--platform android` and an existing emulator/device ID. The harness verifies parent routing, scroll ownership and session cleanup. Hardware tests have not been run by the source export; preparation is not validation.
