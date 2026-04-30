import { Subscription } from 'expo-modules-core';
import { AnalogInputLabel, KeyEventLabel, KeyEventPayload, MotionEventLabel, MotionEventPayload } from './ExpoJoystick.types';
export { MotionEvent, KeyEvent, AnalogInput, WebSocketStatus } from "./ExpoJoystick.constants";
export declare function onButtonPress(listener: (event: KeyEventPayload) => void): Subscription;
export declare function onJoyStick(listener: (event: MotionEventPayload) => void): Subscription;
export declare function onJoyStickRaw(listener: (event: MotionEventPayload) => void): Subscription;
export declare function getDeviceName(): any;
export declare function getGamepadConfiguration(): any;
export declare function getGamepadState(): any;
export declare function connectWebSocket(ip: any, port: any): void;
export declare function disconnectWebSocket(): void;
export declare function getWebSocketStatus(): any;
export declare function useWebSocketStatus(): any;
export declare function sendButtonPressOverWebSocket(keyCode: KeyEventLabel, enabled: any): void;
export declare function setButtonModifiers(keyCode: KeyEventLabel, modifiers: any): void;
export declare function updateButtonModifiers(keyCode: KeyEventLabel, modifiers: any): void;
export declare function setButtonEventName(keyCode: KeyEventLabel, eventName: any): void;
export declare function setAnalogInputEventName(inputCode: AnalogInputLabel, eventName: any): void;
export declare function setAxisInverted(motionEvent: MotionEventLabel, inverted: boolean): void;
/**
  Sets Axis Modifiers
 */
export declare function setAxisModifiers(motionEvent: MotionEventLabel, modifiers: any): void;
/**
  Updates the Axis Modifiers
 */
export declare function updateAxisModifiers(motionEvent: MotionEventLabel, modifiers: any): void;
//# sourceMappingURL=index.d.ts.map