import {useState} from 'react';
import {Platform} from 'react-native';
import { NativeModulesProxy, EventEmitter, Subscription } from 'expo-modules-core';

// Import the native module. On web, it will be resolved to ExpoJoystick.web.ts
// and on native platforms to ExpoJoystick.ts
import ExpoJoystickModule from './ExpoJoystickModule';
import {
    AnalogInputLabel, KeyEventLabel,
    KeyEventPayload,
    MotionEventLabel,
    MotionEventPayload,
    MotionEventPayload2
} from './ExpoJoystick.types';
import {MotionEvent} from "./ExpoJoystick.constants";
export { MotionEvent, KeyEvent, AnalogInput, WebSocketStatus } from "./ExpoJoystick.constants";

// Get the native constant value.
//export const MotionEvent = ExpoJoystickModule.MotionEvent;
//export const KeyEvent = ExpoJoystickModule.KeyEvent;

const emitter = new EventEmitter(ExpoJoystickModule ?? NativeModulesProxy.ExpoJoystick);

export function onButtonPress(listener: (event: KeyEventPayload) => void): Subscription {
  return emitter.addListener('onButtonPress', listener);
}

export function onJoyStick(listener: (event: MotionEventPayload) => void): Subscription {
  return emitter.addListener('onJoyStick', (event: MotionEventPayload2) => {
      listener({
            LEFT: [event.AXIS_X || 0, event.AXIS_Y || 0],
            RIGHT: [event.AXIS_Z || 0, event.AXIS_RZ || 0],
            DPAD: [event.AXIS_HAT_X || 0, event.AXIS_HAT_Y || 0],
            TRIGGER_L: event.AXIS_RX || 0,
            TRIGGER_R: event.AXIS_RY || 0
        });
  })
}

export function onJoyStickRaw(listener: (event: MotionEventPayload) => void): Subscription {
    return emitter.addListener('onJoyStick', (event: MotionEventPayload) => {
        listener(event);
    })
}

export function getDeviceName(){
    return ExpoJoystickModule.getDeviceName()
}

export function getGamepadConfiguration(){
    return ExpoJoystickModule.getGamepadConfiguration()
}

export function getGamepadState() {
    return ExpoJoystickModule.getGamepadState();
}

export function connectWebSocket(ip, port) {
    ExpoJoystickModule.connectWebSocket(ip, port);
}

export function disconnectWebSocket() {
    ExpoJoystickModule.disconnectWebSocket();
}
export function getWebSocketStatus() {
    return ExpoJoystickModule.getWebSocketStatus();
}

type WebSocketStatusEvent = {
  status: string;
  error?: string;
};

export function useWebSocketStatus() {
    if(Platform.OS !== 'android') return "disabled";

    const [status, setStatus] = useState(getWebSocketStatus());
    const sub = emitter.addListener("websocketStatus", ({status, error}: WebSocketStatusEvent) => {
        setStatus(status);
        return () => sub.remove();
    })
    return status;
}


export function sendButtonPressOverWebSocket(keyCode: KeyEventLabel, enabled) {
    ExpoJoystickModule.sendButtonPressOverWebSocket(keyCode, enabled)
}

export function setButtonModifiers(keyCode: KeyEventLabel, modifiers) {
    ExpoJoystickModule.setButtonModifiers(keyCode, modifiers);
}
export function updateButtonModifiers(keyCode: KeyEventLabel, modifiers) {
    ExpoJoystickModule.updateButtonModifiers(keyCode, modifiers);
}

export function setButtonEventName(keyCode: KeyEventLabel, eventName){
    ExpoJoystickModule.setButtonEventName(keyCode, eventName);
}

export function setAnalogInputEventName(inputCode: AnalogInputLabel, eventName) {
    ExpoJoystickModule.setAnalogInputEventName(inputCode, eventName);
}

export function setAxisInverted(motionEvent: MotionEventLabel, inverted: boolean) {
    ExpoJoystickModule.setAxisInverted(motionEvent, inverted);
}

/**
  Sets Axis Modifiers
 */
export function setAxisModifiers(motionEvent: MotionEventLabel, modifiers) {
    ExpoJoystickModule.setAxisModifiers(motionEvent, modifiers);
}
/**
  Updates the Axis Modifiers
 */
export function updateAxisModifiers(motionEvent: MotionEventLabel, modifiers) {
    ExpoJoystickModule.updateAxisModifiers(motionEvent, modifiers);
}