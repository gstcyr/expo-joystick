import { NativeModulesProxy, EventEmitter, Subscription } from 'expo-modules-core';

// Import the native module. On web, it will be resolved to ExpoJoystick.web.ts
// and on native platforms to ExpoJoystick.ts
import ExpoJoystickModule from './ExpoJoystickModule';
import { KeyEventPayload, MotionEventPayload, MotionEventPayload2 } from './ExpoJoystick.types';

// Get the native constant value.
export const MotionEvent = ExpoJoystickModule.MotionEvent;
export const KeyEvent = ExpoJoystickModule.KeyEvent;

const emitter = new EventEmitter(ExpoJoystickModule ?? NativeModulesProxy.ExpoJoystick);

export function onButtonPress(listener: (event: KeyEventPayload) => void): Subscription {
  return emitter.addListener('onButtonPress', listener);
}

export function onJoyStick(listener: (event: MotionEventPayload) => void): Subscription {
  return emitter.addListener('onJoyStick', (event: MotionEventPayload2) => {
    listener({
            LEFT: [event.AXIS_X, event.AXIS_Y],
            RIGHT: [event.AXIS_Z, event.AXIS_RZ],
            DPAD: [event.AXIS_HAT_X, event.AXIS_HAT_Y],
            TRIGGER_L: event.AXIS_RX,
            TRIGGER_R: event.AXIS_RY
        });
  })
}

export function connectWebSocket(ip, port) {
    ExpoJoystickModule.connectWebSocket(ip, port);
}

export function disconnectWebSocket() {
    ExpoJoystickModule.disconnectWebSocket();
}