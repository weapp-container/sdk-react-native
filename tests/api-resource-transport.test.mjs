import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('resource reads use both native SDK gates with the original context payload',()=>{
  const android=readFileSync(new URL('../android/src/main/java/com/sonofmagic/weapp/container/reactnative/WeappContainerModule.kt',import.meta.url),'utf8');
  const ios=readFileSync(new URL('../ios/WCRNInstance.swift',import.meta.url),'utf8');
  assert.match(android,/"hostComponents"[^\n]*"hostApiResource"[^\n]*session\.hostServicesCommand\(operation,value\)/);
  assert.match(ios,/case "hostComponents"[^\n]*"hostApiResource"/);
  assert.match(ios,/result = try session\.hostServicesCommand\(operation,fields\)/);
  assert.doesNotMatch(android,/if \(operation == "hostApiResource"\)/);
  assert.doesNotMatch(ios,/if operation == "hostApiResource"/);
});
