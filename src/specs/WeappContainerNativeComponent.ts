import type {ViewProps, HostComponent, CodegenTypes} from 'react-native';
import {codegenNativeComponent} from 'react-native';
type SurfaceError = Readonly<{code: string; message: string}>;
export interface NativeProps extends ViewProps {
  sessionId: string;
  onSurfaceError?: CodegenTypes.DirectEventHandler<SurfaceError>;
}
export default codegenNativeComponent<NativeProps>('WeappContainerNativeView') as HostComponent<NativeProps>;
