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
            left: [event.AXIS_X, event.AXIS_Y],
            right: [event.AXIS_Z, event.AXIS_RZ],
            dpad: [event.AXIS_HAT_X, event.AXIS_HAT_Y],
            triggers: [event.AXIS_RX, event.AXIS_RY]
        });
  })
}