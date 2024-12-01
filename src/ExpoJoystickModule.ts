import { requireNativeModule, EventEmitter, Subscription } from 'expo-modules-core';

// It loads the native module object from the JSI or falls back to
// the bridge module (from NativeModulesProxy) if the remote debugger is on.

const ExpoJoystickModule = requireNativeModule('ExpoJoystick');



export default ExpoJoystickModule;