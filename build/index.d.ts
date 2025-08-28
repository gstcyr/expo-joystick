import { Subscription } from 'expo-modules-core';
import { KeyEventPayload, MotionEventPayload } from './ExpoJoystick.types';
export { MotionEvent, KeyEvent } from "./ExpoJoystick.constants";
export declare function onButtonPress(listener: (event: KeyEventPayload) => void): Subscription;
export declare function onJoyStick(listener: (event: MotionEventPayload) => void): Subscription;
export declare function connectWebSocket(ip: any, port: any): void;
export declare function disconnectWebSocket(): void;
export declare function sendButtonPressOverWebSocket(keyCode: any, enabled: any): void;
export declare function setButtonModifiers(keyCode: any, modifiers: any): void;
export declare function setAxisModifiers(motionEvent: any, modifiers: any): void;
//# sourceMappingURL=index.d.ts.map