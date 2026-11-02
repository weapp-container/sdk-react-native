import React from 'react';
import type {ViewProps} from 'react-native';
import Native from './specs/NativeWeappContainer';
import Surface from './specs/WeappContainerNativeComponent';

export type JSONValue = null | boolean | number | string | JSONValue[] | {[key: string]: JSONValue};
export type JSONObject = {[key: string]: JSONValue};
export type TrustedApplication = {hostAppId:string;tenantId:string;publisherId:string;appId:string;environment:'develop'|'trial'|'release';version:string;packRoot:string};
export type HostAccount = {principalId:string|null;epoch:string};
export type HostServicesConfiguration = {application:TrustedApplication;account:HostAccount;apis?:string[];syncValues?:JSONObject};
export type NativeDeviceApiOptions = {
  bluetooth?:boolean; allowedNetworkOrigins?:string[]; allowLoopbackForDevelopment?:boolean;
  allowedMediaOrigins?:string[]; dedicatedAudioSession?:boolean; nfc?:boolean; enableWifi?:boolean;
  wifiConfiguration?:{connectToNetworks:boolean;readCurrentNetwork:boolean};
  nfcConfiguration?:{ndef?:boolean;isoDep?:boolean;mifareUltralight?:boolean;nfcF?:boolean;nfcV?:boolean};
};
export type HostApiCallContext = {application:TrustedApplication;account:HostAccount;sessionId:string;callId:string;api:string;deadlineNs:string|null;cancelToken:string|null;componentTarget?:{pageId:string;nodeId:string;ownerScopeId:string|null}};
export type Configuration = {storage: {key: string} | {memoryOnly: true};hostServices?:HostServicesConfiguration};
/** Asset paths are relative to Android assets or the iOS main resource bundle. */
export type PackSource = {directory: string} | {asset: string};
export type HostErrorCode = 'invalid_request' | 'permission_denied' | 'timeout' | 'cancelled' | 'unsupported';
export class HostError extends Error {
  constructor(public readonly code: HostErrorCode, message: string, public readonly retryable = false, public readonly details:JSONObject={}) { super(message); }
}
export type HostHandler = (payload: JSONValue, context: {signal: AbortSignal;callId:string;method:string;deadlineNs?:string;cancelToken?:string;apiContext?:HostApiCallContext}) => JSONValue | Promise<JSONValue>;
export type AccountCleanupHandler = (context: {operationId:string;signal:AbortSignal}) => void | Promise<void>;
export type ContainerEvent = {type: 'accountCleanupRequired' | 'ready' | 'navigation' | 'message' | 'error' | 'closed' | 'presented' | 'accountSwitch' | 'hostApiEvent'; payload: JSONValue};

function encode(value: JSONValue): string {
  const ancestors = new Set<object>();
  const check = (item: JSONValue): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || ancestors.has(item)) throw new TypeError('Expected finite, acyclic JSON data');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Expected plain JSON data');
    ancestors.add(item);
    for (const child of Object.values(item)) check(child);
    ancestors.delete(item);
  };
  check(value);
  return JSON.stringify(value);
}
const owners = new Map<string, WeappContainerController>();
const lifecycle = globalThis as typeof globalThis & {__weappContainerCleanup?: Promise<void>};
let disposed = false;
let subscription: {remove(): void} | undefined;

/** Session owner. Keep it outside render; detach and close are separate operations. */
export class WeappContainerController {
  private handlers = new Map<string, HostHandler>();
  private apiHandlers = new Map<string, HostHandler>();
  private calls = new Map<string, AbortController>();
  private listeners = new Set<(event: ContainerEvent) => void>();
  private cleanupHandlers = new Set<AccountCleanupHandler>();
  private cleanup?: {operationId:string;abort:AbortController};
  private cleanupTasks = new Set<Promise<void>>();
  private cleanupTail: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private closeRequested = false;
  private closed = false;
  private constructor(public readonly sessionId: string) {}
  static async create(configuration: Configuration): Promise<WeappContainerController> {
    await lifecycle.__weappContainerCleanup;
    if (disposed) throw new Error('React Native module was disposed');
    if (!configuration?.storage || (!('memoryOnly' in configuration.storage) && !configuration.storage.key?.trim())) throw new TypeError('Select memoryOnly or a stable nonblank storage key');
    subscription ??= Native.onEvent(event => owners.get(event.sessionId)?.receive(event.type, event.payload));
    const id = await Native.create(encode(configuration as unknown as JSONValue));
    if (disposed) { await Native.invoke(id, 'close', '{}'); throw new Error('React Native module was disposed during create'); }
    const controller = new WeappContainerController(id);
    owners.set(id, controller);
    if(configuration.hostServices) {
      try { await controller.configureHostServices(configuration.hostServices); }
      catch(error) { await controller.close(); throw error; }
    }
    return controller;
  }
  private async command(operation: string, payload: JSONValue = {}): Promise<JSONValue> {
    if (this.closed || this.closeRequested) throw new Error('Container is closing or closed');
    return JSON.parse(await Native.invoke(this.sessionId, operation, encode(payload))) as JSONValue;
  }
  async registerHostMethod(name: string, handler: HostHandler): Promise<void> {
    if (!name.trim() || name.startsWith('wx.') || this.handlers.has(name)) throw new TypeError('Host method must be unique and must not use the wx. namespace');
    this.handlers.set(name, handler);
    try { await this.command('registerHostMethod', {name}); } catch (error) { this.handlers.delete(name); throw error; }
  }
  async configureHostServices(configuration:HostServicesConfiguration):Promise<void> { await this.command('configureHostServices', configuration as unknown as JSONValue); }
  async registerApiHandler(name:string,handler:HostHandler):Promise<void> {
    if(this.apiHandlers.has(name)) throw new TypeError('API handler is already registered');
    this.apiHandlers.set(name,handler);
    try { await this.command('registerApiHandler',{name}); } catch(error) { this.apiHandlers.delete(name); throw error; }
  }
  /** Await custom resources before a new account owner can start. */
  registerAccountCleanupHandler(handler:AccountCleanupHandler):()=>void {
    if(this.closed || this.closeRequested) throw new Error('Container is closing or closed');
    this.cleanupHandlers.add(handler); return ()=>this.cleanupHandlers.delete(handler);
  }
  async installNativeDeviceApis(options:NativeDeviceApiOptions={}):Promise<void> {
    await this.command('installNativeDeviceApis',{
      bluetooth:options.bluetooth??true,
      allowedNetworkOrigins:[...(options.allowedNetworkOrigins??[])],
      allowLoopbackForDevelopment:options.allowLoopbackForDevelopment??false,
      allowedMediaOrigins:[...(options.allowedMediaOrigins??[])],
      dedicatedAudioSession:options.dedicatedAudioSession??false,
      nfc:options.nfc??false,
      enableWifi:options.enableWifi??false,
      ...(options.wifiConfiguration === undefined ? {} : {wifiConfiguration:{...options.wifiConfiguration}}),
      ...(options.nfcConfiguration === undefined ? {} : {nfcConfiguration:{...options.nfcConfiguration}}),
    });
  }
  async retryAccountCleanup():Promise<void> { await this.command('retryAccountCleanup'); }
  hostComponents():Promise<JSONValue> { return this.command('hostComponents'); }
  async authorizeInstalledPack(application:TrustedApplication):Promise<void> { await this.command('authorizeInstalledPack',application as unknown as JSONValue); }
  async migrateLegacyStorage(sourceKey:string):Promise<void> { await this.command('migrateLegacyStorage',{sourceKey}); }
  deleteAccountData(principalId:string):Promise<JSONValue> { return this.command('deleteAccountData',{principalId}); }
  async emitHostApiEvent(event:JSONObject):Promise<void> { await this.command('hostApiEvent',event); }
  submitHostComponentFrame(frame:JSONObject):Promise<JSONValue> { return this.command('hostComponentFrame',frame); }
  async emitHostComponentEvent(event:JSONObject):Promise<void> { await this.command('hostComponentEvent',event); }
  async authorizePhoneButton(nodeId:string):Promise<void> { await this.command('authorizePhoneButton',{nodeId}); }
  async prepareAccountHostServiceSnapshots(operationId:string,values:JSONObject):Promise<void> { await this.command('prepareAccountHostServiceSnapshots',{operationId,values}); }
  async updateHostServiceSnapshots(values:JSONObject):Promise<void> { await this.command('updateHostServiceSnapshots',{values}); }
  switchAccount(account:HostAccount,launches:JSONObject={}):Promise<JSONValue> { return this.command('switchAccount',{account:account as unknown as JSONValue,launches}); }
  queryAccountSwitch(operationId?:string):Promise<JSONValue> { return this.command('queryAccountSwitch',operationId?{operationId}:{}); }
  async updateAccountSwitchLaunch(options:JSONObject):Promise<void> { await this.command('updateAccountSwitchLaunch',{options}); }
  async retryAccountSwitch(options:JSONObject={}):Promise<void> { await this.command('retryAccountSwitch',{options}); }
  async cancelAccountSwitch(operationId:string):Promise<void> { await this.command('cancelAccountSwitch',{operationId}); }
  createHostBinary(bytes:Uint8Array):Promise<JSONValue> { return this.command('createHostBinary',{bytes:Array.from(bytes)}); }
  readHostBinary(id:string,offset:number,length:number):Promise<JSONValue> { return this.command('readHostBinary',{id,offset,length}); }
  async retainHostBinary(id:string):Promise<void> { await this.command('retainHostBinary',{id}); }
  async releaseHostBinary(id:string):Promise<void> { await this.command('releaseHostBinary',{id}); }
  async load(source: PackSource, options: {route?: string; options?: JSONObject} = {}): Promise<void> {
    await this.command('load', {...source, ...(options.route === undefined ? {} : {route: options.route}), options: options.options ?? {}});
  }
  async sendMessage(message: JSONValue): Promise<void> { await this.command('sendMessage', {message}); }
  async navigate(route: string, query: JSONObject = {}, replace = false): Promise<void> { await this.command('navigate', {route, query, replace}); }
  async back(): Promise<void> { await this.command('back'); }
  async setForeground(visible: boolean): Promise<void> { await this.command('setForeground', {visible}); }
  async flushStorage(): Promise<void> { await this.command('flushStorage'); }
  state(): Promise<JSONValue> { return this.command('state'); }
  capabilities(): Promise<JSONValue> { return this.command('capabilities'); }
  subscribe(listener: (event: ContainerEvent) => void): () => void {
    if (this.closed) throw new Error('Container is closed');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.closing) return this.closing;
    this.closeRequested = true;
    for (const call of this.calls.values()) call.abort();
    this.calls.clear();
    this.cleanup?.abort.abort(); this.cleanup=undefined;
    this.closing = (async () => {
      // Superseded account cleanup must finish before resources are retired again.
      await Promise.allSettled([...this.cleanupTasks]);
      const abort = new AbortController();
      const results = await Promise.allSettled([...this.cleanupHandlers].map(handler =>
        Promise.resolve().then(() => handler({operationId:`close:${this.sessionId}`,signal:abort.signal}))));
      const failures = results.filter((result):result is PromiseRejectedResult => result.status==='rejected');
      if(failures.length) throw new AggregateError(failures.map(result=>result.reason),'Container resource cleanup failed');
      await Native.invoke(this.sessionId, 'close', '{}');
      this.closed = true; owners.delete(this.sessionId); this.listeners.clear(); this.handlers.clear(); this.apiHandlers.clear(); this.cleanupHandlers.clear();
    })().catch(error => { this.closing = undefined; throw error; });
    return this.closing;
  }
  private receive(type: string, payloadJSON: string): void {
    const payload = JSON.parse(payloadJSON) as JSONObject;
    if(type==='accountSwitch' && (payload.receipt as JSONObject | undefined)?.phase==='revoking') { this.cleanup?.abort.abort(); for(const call of this.calls.values()) call.abort(); this.calls.clear(); }
    if(type==='accountCleanupRequired') {
      if(this.closed) return;
      const task=this.cleanupAccount(String(payload.operationId)); this.cleanupTasks.add(task);
      void task.finally(()=>this.cleanupTasks.delete(task)); return;
    }
    if(type==='accountCleanupCancelled') {
      if(this.cleanup?.operationId===String(payload.operationId)) this.cleanup.abort.abort();
      return;
    }
    if (type === 'hostCallCancelled') {
      const id = String(payload.callId); this.calls.get(id)?.abort(); this.calls.delete(id); return;
    }
    if (type === 'hostCall') { void this.dispatchHostCall(payload); return; }
    for (const listener of this.listeners) {
      try { listener({type: type as ContainerEvent['type'], payload}); }
      catch (error) { console.error('WeappContainer event listener failed', error); }
    }
  }
  private cleanupAccount(operationId:string):Promise<void> {
    this.cleanup?.abort.abort();
    const current={operationId,abort:new AbortController()}; this.cleanup=current;
    const run=async():Promise<void>=>{
      let response:JSONObject={operationId};
      const retired=()=>this.cleanup!==current || current.abort.signal.aborted || this.closed || this.closeRequested;
      try { if(!retired()) {
        const results=await Promise.allSettled([...this.cleanupHandlers].map(handler=>Promise.resolve().then(()=>handler({operationId,signal:current.abort.signal}))));
        const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
        if(failures.length) throw new AggregateError(failures.map(result=>result.reason),'Account resource cleanup failed');
      } } catch(error) { response.error={code:'ERR_ACCOUNT_CLEANUP',message:error instanceof Error?error.message:String(error)}; }
      if(retired()) response={operationId,retired:true};
      // Even a revoked/closing owner must finish its exact transport waiter.
      // Native treats retired as cancellation and never as permission to start.
      try { await Native.invoke(this.sessionId,'completeAccountCleanup',encode(response)); }
      catch(error) { if(!this.closed && !this.closing) console.error('WeappContainer account cleanup reply failed',error); }
      finally { if(this.cleanup===current) this.cleanup=undefined; }
    };
    // Cancellation gates the old operation immediately, but only its actual
    // handler terminals release devices/files for the next account or close.
    const task=this.cleanupTail.then(run,run);
    this.cleanupTail=task.then(()=>{},()=>{});
    return task;
  }
  private async dispatchHostCall(payload: JSONObject): Promise<void> {
    const id = String(payload.callId);
    if (this.closeRequested || this.closed) {
      try { await Native.completeHostCall(this.sessionId, id, encode({error: {code: 'cancelled', message: 'Container is closing', retryable: false}})); } catch { /* Native close may already have cancelled this call. */ }
      return;
    }
    const abort = new AbortController(); this.calls.set(id, abort);
    let response: JSONValue;
    try {
      const handler = this.apiHandlers.get(String(payload.method)) ?? this.handlers.get(String(payload.method));
      if (!handler) throw new HostError('unsupported', 'Host method is not registered');
      const result = await handler(payload.payload ?? null, {signal: abort.signal,callId:id,method:String(payload.method),...(payload.deadlineNs==null?{}:{deadlineNs:String(payload.deadlineNs)}),...(payload.cancelToken==null?{}:{cancelToken:String(payload.cancelToken)}),...(payload.context?{apiContext:payload.context as unknown as HostApiCallContext}:{})});
      encode(result); response = {result};
    } catch (error) {
      response = {error: {code: error instanceof HostError ? error.code : 'invalid_request', message: error instanceof Error ? error.message : String(error), retryable: error instanceof HostError && error.retryable,details:error instanceof HostError?error.details:{}}};
    }
    if (this.calls.get(id) !== abort || abort.signal.aborted) return;
    if(!(payload.retainUntilCancelled===true && response!==null && typeof response==='object' && 'result' in response)) this.calls.delete(id);
    try { await Native.completeHostCall(this.sessionId, id, encode(response)); }
    catch (error) { if (!this.closing && !this.closed) console.error('WeappContainer host reply failed', error); }
  }
}
export type WeappContainerViewProps = ViewProps & {controller: WeappContainerController; onSurfaceError?: (error: {code: string; message: string}) => void};
export function WeappContainerView({controller, onSurfaceError, ...props}: WeappContainerViewProps): React.JSX.Element {
  return <Surface {...props} sessionId={controller.sessionId} onSurfaceError={onSurfaceError ? event => onSurfaceError(event.nativeEvent) : undefined} />;
}
/** Await before replacing an entire React surface or account. Failed close remains retryable. */
export async function closeAllContainers(): Promise<void> {
  const results = await Promise.allSettled([...owners.values()].map(owner => owner.close()));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Container cleanup failed');
}
declare const module: {hot?: {dispose(callback: () => void): void}};
if (typeof module !== 'undefined' && module.hot) module.hot.dispose(() => {
  disposed = true;
  const cleanup = closeAllContainers().finally(() => { subscription?.remove(); subscription = undefined; });
  lifecycle.__weappContainerCleanup = cleanup;
  // Retain the rejection for the next create, and avoid an unhandled promise rejection meanwhile.
  void cleanup.catch(error => console.error('WeappContainer Fast Refresh cleanup failed', error));
});
