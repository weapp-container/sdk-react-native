import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/index.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function harness(){
  const requests=[],replies=[],errors=[];let listener;
  const native={create:async()=> 'public-controller',onEvent:callback=>{listener=callback;return {remove(){}}},
    invoke:async(id,operation,payload)=>{requests.push({id,operation,...JSON.parse(payload)});return 'null'},
    completeHostCall:async(id,callId,response)=>{replies.push({id,callId,...JSON.parse(response)})}};
  const exports={};
  new Function('exports','require','AbortController','AggregateError','console',compiled)(exports,
    name=>({default:name==='react'?{}:name.includes('NativeWeappContainer')?native:{}}),
    AbortController,AggregateError,{error:(...args)=>errors.push(args)});
  return {Controller:exports.WeappContainerController,requests,replies,errors,
    emit:(type,payload)=>listener({sessionId:'public-controller',type,payload:JSON.stringify(payload)})};
}
test('toolkit cleanup blocks completion and ignores superseded async work',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}});
  const first=deferred(),second=deferred(),signals=[];
  controller.registerAccountCleanupHandler(({operationId,signal})=>{signals.push(signal);return operationId==='first'?first.promise:second.promise});
  h.emit('accountCleanupRequired',{operationId:'first'});await flush();
  assert.equal(h.requests.length,0);
  h.emit('accountCleanupRequired',{operationId:'second'});await flush();
  assert.equal(signals[0].aborted,true);
  first.resolve();await flush();assert.equal(h.requests.length,0);
  second.resolve();await flush();
  assert.deepEqual(h.requests,[{id:'public-controller',operation:'completeAccountCleanup',operationId:'second'}]);
  await controller.close();
});
test('native device install keeps Wi-Fi disabled by default and forwards explicit platform configuration',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}});
  await controller.installNativeDeviceApis();
  assert.equal(h.requests[0].enableWifi,false);
  assert.equal(Object.hasOwn(h.requests[0],'wifiConfiguration'),false);
  await controller.installNativeDeviceApis({bluetooth:false,nfc:true,enableWifi:true,
    wifiConfiguration:{connectToNetworks:true,readCurrentNetwork:false}});
  assert.equal(h.requests[1].bluetooth,false);
  assert.equal(h.requests[1].nfc,true);
  assert.equal(h.requests[1].enableWifi,true);
  assert.deepEqual(h.requests[1].wifiConfiguration,{connectToNetworks:true,readCurrentNetwork:false});
  await controller.close();
});
test('failed cleanup awaits other resources and reports failure instead of authorizing startup',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}}),pending=deferred();
  const unregister=controller.registerAccountCleanupHandler(()=>{throw new Error('camera drain failed')});
  controller.registerAccountCleanupHandler(()=>pending.promise);
  h.emit('accountCleanupRequired',{operationId:'cleanup'});await flush();assert.equal(h.requests.length,0);
  pending.resolve();await flush();assert.equal(h.requests[0].error.code,'ERR_ACCOUNT_CLEANUP');
  unregister();
  await controller.close();
});
test('close waits for superseded cleanup and all custom resources before native retirement',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}});
  const old=deferred(),retire=deferred(),contexts=[];
  controller.registerAccountCleanupHandler(context=>{contexts.push(context);return context.operationId==='switch'?old.promise:retire.promise});
  h.emit('accountCleanupRequired',{operationId:'switch'});await flush();
  const closing=controller.close();await flush();
  assert.equal(contexts[0].signal.aborted,true);assert.equal(contexts.length,1);assert.equal(h.requests.length,0);
  old.resolve();await flush();assert.equal(contexts[1].operationId,'close:public-controller');assert.equal(h.requests.length,0);
  retire.resolve();await closing;
  assert.deepEqual(h.requests.map(value=>value.operation),['close']);
});
test('failed close drains all handlers and remains blocked until close is retried',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}}),pending=deferred();let fail=true;
  controller.registerAccountCleanupHandler(()=>{if(fail) throw new Error('resource is busy')});
  controller.registerAccountCleanupHandler(()=>pending.promise);
  const closing=controller.close();let settled=false;void closing.catch(()=>{settled=true});await flush();
  assert.equal(settled,false);assert.equal(h.requests.length,0);
  pending.resolve();await assert.rejects(closing,/Container resource cleanup failed/);
  await assert.rejects(controller.state(),/closing or closed/);assert.equal(h.requests.length,0);
  fail=false;await controller.close();assert.equal(h.requests.length,1);assert.equal(h.requests[0].operation,'close');
});
test('retained resource receives cancellation after setup and preserves native context exactly',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}});let context;
  await controller.registerApiHandler('wx.onLocationChange',(_,value)=>{context=value;return {errMsg:'onLocationChange:ok'}});
  const trusted={sessionId:'incarnation-7',callId:'native-call',account:{epoch:'18446744073709551615',principalId:'user'},application:{appId:'trusted'}};
  h.emit('hostCall',{callId:'transport-call',method:'wx.onLocationChange',payload:{},context:trusted,
    deadlineNs:'18446744073709551615',retainUntilCancelled:true});await flush();
  assert.equal(context.deadlineNs,'18446744073709551615');
  assert.equal(context.apiContext.callId,'native-call');
  assert.equal(context.apiContext.account.epoch,'18446744073709551615');
  assert.equal(h.replies.length,1);assert.equal(context.signal.aborted,false);
  h.emit('accountSwitch',{receipt:{phase:'revoking'}});assert.equal(context.signal.aborted,true);
  h.emit('hostCallCancelled',{callId:'transport-call'});assert.equal(h.replies.length,1);
  await controller.close();
});
