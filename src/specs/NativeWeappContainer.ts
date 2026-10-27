import type {TurboModule, CodegenTypes} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
export type NativeEvent = Readonly<{sessionId: string; type: string; payload: string}>;
export interface Spec extends TurboModule {
  create(configuration: string): Promise<string>;
  invoke(sessionId: string, operation: string, payload: string): Promise<string>;
  completeHostCall(sessionId: string, callId: string, response: string): Promise<void>;
  readonly onEvent: CodegenTypes.EventEmitter<NativeEvent>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('WeappContainer');
