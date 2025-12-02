declare const _default: {
    connectWebSocket: (ip: string, port: number) => void;
    disconnectWebSocket: () => void;
    getWebSocketStatus: () => string;
    sendButtonPressOverWebSocket: (keyCode: number, enabled: boolean) => void;
    setButtonModifiers: (keyCode: number, modifiers: {
        [key: string]: any;
    }) => void;
    setAxisModifiers: (motionEvent: number, modifiers: {
        [key: string]: any;
    }) => void;
    setAxisDeadzone: (motionEvent: number, deadzone: number) => void;
    buttonDown: (keyName: string) => void;
    buttonUp: (keyName: string) => void;
    setJoystickInversion: (motionEvent: number, inverted: boolean) => void;
    leftStickMove: (x: number, y: number) => void;
    rightStickMove: (x: number, y: number) => void;
};
export default _default;
//# sourceMappingURL=ExpoJoystickModule.web.d.ts.map