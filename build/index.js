import { useState } from 'react';
import { Platform } from 'react-native';
import { NativeModulesProxy, EventEmitter } from 'expo-modules-core';
// Import the native module. On web, it will be resolved to ExpoJoystick.web.ts
// and on native platforms to ExpoJoystick.ts
import ExpoJoystickModule from './ExpoJoystickModule';
export { MotionEvent, KeyEvent, AnalogInput, WebSocketStatus } from "./ExpoJoystick.constants";
// Get the native constant value.
//export const MotionEvent = ExpoJoystickModule.MotionEvent;
//export const KeyEvent = ExpoJoystickModule.KeyEvent;
const emitter = new EventEmitter(ExpoJoystickModule ?? NativeModulesProxy.ExpoJoystick);
export function onButtonPress(listener) {
    return emitter.addListener('onButtonPress', listener);
}
export function onJoyStick(listener) {
    return emitter.addListener('onJoyStick', (event) => {
        listener({
            LEFT: [event.AXIS_X || 0, event.AXIS_Y || 0],
            RIGHT: [event.AXIS_Z || 0, event.AXIS_RZ || 0],
            DPAD: [event.AXIS_HAT_X || 0, event.AXIS_HAT_Y || 0],
            TRIGGER_L: event.AXIS_RX || 0,
            TRIGGER_R: event.AXIS_RY || 0
        });
    });
}
export function onJoyStickRaw(listener) {
    return emitter.addListener('onJoyStick', (event) => {
        listener(event);
    });
}
export function getDeviceName() {
    return ExpoJoystickModule.getDeviceName();
}
export function getGamepadConfiguration() {
    return ExpoJoystickModule.getGamepadConfiguration();
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
export function useWebSocketStatus() {
    if (Platform.OS !== 'android')
        return "disabled";
    const [status, setStatus] = useState(getWebSocketStatus());
    const sub = emitter.addListener("websocketStatus", ({ status, error }) => {
        setStatus(status);
        return () => sub.remove();
    });
    return status;
}
export function sendButtonPressOverWebSocket(keyCode, enabled) {
    ExpoJoystickModule.sendButtonPressOverWebSocket(keyCode, enabled);
}
export function setButtonModifiers(keyCode, modifiers) {
    ExpoJoystickModule.setButtonModifiers(keyCode, modifiers);
}
export function updateButtonModifiers(keyCode, modifiers) {
    ExpoJoystickModule.updateButtonModifiers(keyCode, modifiers);
}
export function setButtonEventName(keyCode, eventName) {
    ExpoJoystickModule.setButtonEventName(keyCode, eventName);
}
export function setAnalogInputEventName(inputCode, eventName) {
    ExpoJoystickModule.setAnalogInputEventName(inputCode, eventName);
}
export function setAxisInverted(motionEvent, inverted) {
    ExpoJoystickModule.setAxisInverted(motionEvent, inverted);
}
/**
  Sets Axis Modifiers
 */
export function setAxisModifiers(motionEvent, modifiers) {
    ExpoJoystickModule.setAxisModifiers(motionEvent, modifiers);
}
/**
  Updates the Axis Modifiers
 */
export function updateAxisModifiers(motionEvent, modifiers) {
    ExpoJoystickModule.updateAxisModifiers(motionEvent, modifiers);
}
//# sourceMappingURL=index.js.map