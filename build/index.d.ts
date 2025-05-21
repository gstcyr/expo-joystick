import { Subscription } from 'expo-modules-core';
import { KeyEventPayload, MotionEventPayload } from './ExpoJoystick.types';
export declare const MotionEvent: any;
export declare const KeyEvent: any;
export declare function onButtonPress(listener: (event: KeyEventPayload) => void): Subscription;
export declare function onJoyStick(listener: (event: MotionEventPayload) => void): Subscription;
export declare function connectWebSocket(ip: any, port: any): void;
export declare function disconnectWebSocket(): void;
//# sourceMappingURL=index.d.ts.map