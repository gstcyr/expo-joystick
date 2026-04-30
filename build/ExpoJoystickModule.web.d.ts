/**
 * ExpoJoystick.web.ts
 *
 * Web implementation of the ExpoJoystick native module.
 * Mirrors the Kotlin module's behaviour using the Web Gamepad API.
 *
 * Drop this file next to ExpoJoystickModule.ts – Expo's platform resolution
 * will automatically pick it up on web builds.
 */
declare type Listener<T> = (event: T) => void;
/**
 * This object is what ExpoJoystickModule resolves to on web.
 * It exposes addListener / removeAllListeners so that the EventEmitter wrapper
 * in index.ts works without changes, AND it exposes all the function-style API
 * methods for direct calls from index.ts.
 */
declare const ExpoJoystickWebModule: {
    addListener(eventName: string, listener: Listener<unknown>): {
        remove: () => void;
    };
    removeAllListeners(eventName: string): void;
    connectWebSocket(ip: string, port: number): void;
    disconnectWebSocket(): void;
    getWebSocketStatus(): string;
    getDeviceName(): string;
    getGamepadConfiguration(): unknown[];
    getGamepadState(): unknown[];
    sendButtonPressOverWebSocket(keyCode: number, enabled: boolean): void;
    setButtonModifiers(keyCode: number, modifiers: Record<string, unknown>): void;
    setAxisModifiers(motionEvent: number, modifiers: Record<string, unknown>): void;
    updateAxisModifiers(motionEvent: number, modifiers: Record<string, unknown>): void;
    setButtonEventName(keyCode: number, eventName: string): void;
    setAnalogInputEventName(label: string, eventName: string): void;
    setAxisDeadzone(motionEvent: number, deadZone: number): void;
    setAxisInverted(motionEvent: number, inverted: boolean): void;
};
export default ExpoJoystickWebModule;
//# sourceMappingURL=ExpoJoystickModule.web.d.ts.map