import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/index.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function harness(){
  const requests=[],replies=[],errors=[];let listener,resourceFailure;
  const native={create:async()=> 'public-controller',onEvent:callback=>{listener=callback;return {remove(){}}},
    invoke:async(id,operation,payload)=>{requests.push({id,operation,...JSON.parse(payload)});if(operation==='hostApiResource'){if(resourceFailure)throw resourceFailure;return JSON.stringify({bytes:[0,128,255],totalBytes:1048579})}return 'null'},
    completeHostCall:async(id,callId,response)=>{replies.push({id,callId,...JSON.parse(response)})}};
  const exports={};
  new Function('exports','require','AbortController','AggregateError','console',compiled)(exports,
    name=>({default:name==='react'?{}:name.includes('NativeWeappContainer')?native:{}}),
    AbortController,AggregateError,{error:(...args)=>errors.push(args)});
  return {Controller:exports.WeappContainerController,requests,replies,errors,failResources:error=>{resourceFailure=error},
    emit:(type,payload)=>listener({sessionId:'public-controller',type,payload:JSON.stringify(payload)})};
}
test('API resource requests preserve exact native identity and propagate the revoked-owner gate',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}});let observed;
  const trusted={application:{hostAppId:'host',tenantId:'tenant',publisherId:'publisher',appId:'app',environment:'release',version:'v2',packRoot:'a'.repeat(64)},account:{principalId:'user',epoch:'18446744073709551615'},sessionId:'native-incarnation',callId:'native-call',api:'object:InnerAudioContext.src',deadlineNs:'18446744073709551614',cancelToken:'native-cancel',componentTarget:{pageId:'9007199254740993',nodeId:'audio',ownerScopeId:null}};
  await controller.registerApiHandler('object:InnerAudioContext.src',async(_,call)=>{observed=await controller.readHostApiResource(call.apiContext,1048576,3);return {}});
  h.emit('hostCall',{callId:'transport-call',method:'object:InnerAudioContext.src',payload:{value:'assets/a.bin'},context:trusted});await flush();
  assert.deepEqual(observed,{bytes:[0,128,255],totalBytes:1048579});
  assert.deepEqual(h.requests.find(request=>request.operation==='hostApiResource'),{id:'public-controller',operation:'hostApiResource',context:trusted,offset:1048576,length:3});
  h.emit('accountSwitch',{receipt:{phase:'revoking'}});h.failResources(new Error('ERR_IDENTITY_SWITCHING'));
  await assert.rejects(controller.readHostApiResource(trusted,0,1),/ERR_IDENTITY_SWITCHING/);
  await controller.close();
});
test('toolkit cleanup blocks completion and ignores superseded async work',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}});
  const first=deferred(),second=deferred(),signals=[];
  controller.registerAccountCleanupHandler(({operationId,signal})=>{signals.push(signal);return operationId==='first'?first.promise:second.promise});
  h.emit('accountCleanupRequired',{operationId:'first'});await flush();
  assert.equal(h.requests.length,0);
  h.emit('accountCleanupRequired',{operationId:'second'});await flush();
  assert.equal(signals[0].aborted,true);
  first.resolve();await flush();assert.deepEqual(h.requests,[{id:'public-controller',operation:'completeAccountCleanup',operationId:'first',retired:true}]);
  second.resolve();await flush();
  assert.deepEqual(h.requests.at(-1),{id:'public-controller',operation:'completeAccountCleanup',operationId:'second'});
  assert.equal(h.requests.filter(request=>!request.retired).length,1);
  await controller.close();
});
test('a newer cleanup cannot start or acknowledge while the cancelled older hook still owns resources',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}}),old=deferred(),latest=deferred(),started=[];
  controller.registerAccountCleanupHandler(({operationId})=>{started.push(operationId);return operationId==='old'?old.promise:latest.promise});
  h.emit('accountCleanupRequired',{operationId:'old'});await flush();
  h.emit('accountCleanupRequired',{operationId:'skipped'});
  h.emit('accountCleanupRequired',{operationId:'latest'});latest.resolve();await flush();
  assert.deepEqual(started,['old']);assert.equal(h.requests.length,0);
  old.resolve();await flush();assert.deepEqual(started,['old','latest']);
  assert.deepEqual(h.requests.map(({operationId,retired})=>({operationId,retired})),[
    {operationId:'old',retired:true},{operationId:'skipped',retired:true},{operationId:'latest',retired:undefined}]);
  await controller.close();
});
test('a superseded failed cleanup finishes before the latest retry and queued close drains only after its terminal',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}}),old=deferred(),started=[];
  controller.registerAccountCleanupHandler(({operationId})=>{started.push(operationId);return operationId==='old'?old.promise:Promise.resolve()});
  h.emit('accountCleanupRequired',{operationId:'old'});await flush();
  h.emit('accountCleanupRequired',{operationId:'latest'});await flush();assert.deepEqual(started,['old']);
  old.reject(new Error('old cleanup failed'));await flush();
  assert.deepEqual(started,['old','latest']);assert.equal(h.requests[0].retired,true);assert.equal(h.requests.at(-1).operationId,'latest');assert.equal(h.requests.at(-1).error,undefined);
  const late=deferred();controller.registerAccountCleanupHandler(({operationId})=>operationId==='pending'?late.promise:Promise.resolve());
  h.emit('accountCleanupRequired',{operationId:'pending'});await flush();
  h.emit('accountCleanupRequired',{operationId:'queued'});const closing=controller.close();await flush();
  assert.equal(h.requests.some(request=>request.operation==='close'),false);late.resolve();await closing;
  assert.equal(started.includes('queued'),false);assert.equal(h.requests.at(-1).operation,'close');
});
test('native cancellation retains its transport until actual hooks end, including an event received during close',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}}),native=deferred();let signal;
  controller.registerAccountCleanupHandler(context=>{signal=context.signal;return context.operationId==='pending'?native.promise:Promise.resolve()});
  h.emit('accountCleanupRequired',{operationId:'pending'});await flush();
  h.emit('accountCleanupCancelled',{operationId:'another'});assert.equal(signal.aborted,false);
  h.emit('accountCleanupCancelled',{operationId:'pending'});await flush();assert.equal(signal.aborted,true);assert.equal(h.requests.length,0);
  const closing=controller.close();h.emit('accountCleanupRequired',{operationId:'late'});await flush();assert.equal(h.requests.length,0);
  native.resolve();await closing;await flush();
  assert.deepEqual(h.requests.filter(request=>request.operation==='completeAccountCleanup').map(({operationId,retired})=>({operationId,retired})),[
    {operationId:'pending',retired:true},{operationId:'late',retired:true}]);
});
test('native device install keeps Wi-Fi disabled by default and forwards explicit platform configuration',async()=>{
  const h=harness(),controller=await h.Controller.create({storage:{memoryOnly:true}});
  await controller.installNativeDeviceApis();
  assert.equal(h.requests[0].enableWifi,false);
  assert.equal(Object.hasOwn(h.requests[0],'wifiConfiguration'),false);
  assert.equal(Object.hasOwn(h.requests[0],'nfcConfiguration'),false);
  await controller.installNativeDeviceApis({bluetooth:false,nfc:true,enableWifi:true,
    wifiConfiguration:{connectToNetworks:true,readCurrentNetwork:false},nfcConfiguration:{ndef:true,isoDep:true,nfcV:true}});
  assert.equal(h.requests[1].bluetooth,false);
  assert.equal(h.requests[1].nfc,true);
  assert.equal(h.requests[1].enableWifi,true);
  assert.deepEqual(h.requests[1].wifiConfiguration,{connectToNetworks:true,readCurrentNetwork:false});
  assert.deepEqual(h.requests[1].nfcConfiguration,{ndef:true,isoDep:true,nfcV:true});
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
  old.resolve();await flush();assert.equal(contexts[1].operationId,'close:public-controller');assert.deepEqual(h.requests,[{id:'public-controller',operation:'completeAccountCleanup',operationId:'switch',retired:true}]);
  retire.resolve();await closing;
  assert.deepEqual(h.requests.map(value=>value.operation),['completeAccountCleanup','close']);
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
