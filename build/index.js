import { useState } from 'react';
import { NativeModulesProxy, EventEmitter } from 'expo-modules-core';
// Import the native module. On web, it will be resolved to ExpoJoystick.web.ts
// and on native platforms to ExpoJoystick.ts
import ExpoJoystickModule from './ExpoJoystickModule';
export { MotionEvent, KeyEvent, WebSocketStatus } from "./ExpoJoystick.constants";
// Get the native constant value.
//export const MotionEvent = ExpoJoystickModule.MotionEvent;
//export const KeyEvent = ExpoJoystickModule.KeyEvent;
const emitter = new EventEmitter(ExpoJoystickModule ?? NativeModulesProxy.ExpoJoystick);
export function testFunction() {
    return ExpoJoystickModule.testFunction();
}
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
export function setAxisModifiers(motionEvent, modifiers) {
    ExpoJoystickModule.setAxisModifiers(motionEvent, modifiers);
}
export function setAxisDeadzone(motionEvent, deadZone) {
    ExpoJoystickModule.setAxisDeadzone(motionEvent, deadZone);
}
export function buttonDown(keyName) {
    console.log("BUTTON DOWN");
    if (ExpoJoystickModule.buttonDown) {
        ExpoJoystickModule.buttonDown(keyName);
    }
}
export function buttonUp(keyName) {
    console.log("BUTTON UP");
    if (ExpoJoystickModule.buttonUp) {
        ExpoJoystickModule.buttonUp(keyName);
    }
}
//# sourceMappingURL=index.js.map