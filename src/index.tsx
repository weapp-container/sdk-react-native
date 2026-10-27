import React from 'react';
import type {ViewProps} from 'react-native';
import Native from './specs/NativeWeappContainer';
import Surface from './specs/WeappContainerNativeComponent';

export type JSONValue = null | boolean | number | string | JSONValue[] | {[key: string]: JSONValue};
export type JSONObject = {[key: string]: JSONValue};
export type Configuration = {storage: {key: string} | {memoryOnly: true}};
/** Asset paths are relative to Android assets or the iOS main resource bundle. */
export type PackSource = {directory: string} | {asset: string};
export type HostErrorCode = 'invalid_request' | 'permission_denied' | 'timeout' | 'cancelled' | 'unsupported';
export class HostError extends Error {
  constructor(public readonly code: HostErrorCode, message: string, public readonly retryable = false) { super(message); }
}
export type HostHandler = (payload: JSONValue, context: {signal: AbortSignal}) => JSONValue | Promise<JSONValue>;
export type ContainerEvent = {type: 'ready' | 'navigation' | 'message' | 'error' | 'closed' | 'presented'; payload: JSONValue};

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
  private calls = new Map<string, AbortController>();
  private listeners = new Set<(event: ContainerEvent) => void>();
  private closing?: Promise<void>;
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
    return controller;
  }
  private async command(operation: string, payload: JSONValue = {}): Promise<JSONValue> {
    if (this.closed || this.closing) throw new Error('Container is closing or closed');
    return JSON.parse(await Native.invoke(this.sessionId, operation, encode(payload))) as JSONValue;
  }
  async registerHostMethod(name: string, handler: HostHandler): Promise<void> {
    if (!name.trim() || name.startsWith('wx.') || this.handlers.has(name)) throw new TypeError('Host method must be unique and must not use the wx. namespace');
    this.handlers.set(name, handler);
    try { await this.command('registerHostMethod', {name}); } catch (error) { this.handlers.delete(name); throw error; }
  }
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
    for (const call of this.calls.values()) call.abort();
    this.calls.clear();
    this.closing = Native.invoke(this.sessionId, 'close', '{}').then(() => {
      this.closed = true; owners.delete(this.sessionId); this.listeners.clear(); this.handlers.clear();
    }).catch(error => { this.closing = undefined; throw error; });
    return this.closing;
  }
  private receive(type: string, payloadJSON: string): void {
    const payload = JSON.parse(payloadJSON) as JSONObject;
    if (type === 'hostCallCancelled') {
      const id = String(payload.callId); this.calls.get(id)?.abort(); this.calls.delete(id); return;
    }
    if (type === 'hostCall') { void this.dispatchHostCall(payload); return; }
    for (const listener of this.listeners) {
      try { listener({type: type as ContainerEvent['type'], payload}); }
      catch (error) { console.error('WeappContainer event listener failed', error); }
    }
  }
  private async dispatchHostCall(payload: JSONObject): Promise<void> {
    const id = String(payload.callId);
    if (this.closing || this.closed) {
      try { await Native.completeHostCall(this.sessionId, id, encode({error: {code: 'cancelled', message: 'Container is closing', retryable: false}})); } catch { /* Native close may already have cancelled this call. */ }
      return;
    }
    const abort = new AbortController(); this.calls.set(id, abort);
    let response: JSONValue;
    try {
      const handler = this.handlers.get(String(payload.method));
      if (!handler) throw new HostError('unsupported', 'Host method is not registered');
      const result = await handler(payload.payload ?? null, {signal: abort.signal});
      encode(result); response = {result};
    } catch (error) {
      response = {error: {code: error instanceof HostError ? error.code : 'invalid_request', message: error instanceof Error ? error.message : String(error), retryable: error instanceof HostError && error.retryable}};
    }
    if (this.calls.get(id) !== abort || abort.signal.aborted) return;
    this.calls.delete(id);
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
