import {EventEmitter} from 'expo-modules-core';

const emitter = new EventEmitter({} as any);

const BUTTON_MAPPING: { [key: number]: number } = {
    0: 96,  // A button -> KEYCODE_BUTTON_A
    1: 97,  // B button -> KEYCODE_BUTTON_B
    4: 102, // L1 -> KEYCODE_BUTTON_L1
    5: 103, // R1 -> KEYCODE_BUTTON_R1
    6: 104, // L2 -> KEYCODE_BUTTON_L2
    7: 105, // R2 -> KEYCODE_BUTTON_R2
    10: 106, // L3/THUMBL -> KEYCODE_BUTTON_THUMBL
    11: 107, // R3 (if needed)
    8: 109,  // Select/Back
    9: 108,  // Start
};

const AXIS_NAMES = {
    0: 'AXIS_X',      // Left stick X
    1: 'AXIS_Y',      // Left stick Y
    2: 'AXIS_Z',      // Right stick X
    3: 'AXIS_RZ',     // Right stick Y (rotation Z)
    4: 'AXIS_RX',     // Left trigger
    5: 'AXIS_RY',     // Right trigger
};

type WebSocketState = 'disconnected' | 'connecting' | 'connected' | 'error';

class ExpoJoystickWeb {
    private gamepadIndex: number | null = null;
    private animationFrameId: number | null = null;
    private lastAxisValues: { [key: string]: number } = {};
    private buttonStates: { [key: number]: boolean } = {};
    private isPolling: boolean = false;

    private webSocket: WebSocket | null = null;
    private socketState: WebSocketState = 'disconnected';
    private lastIp: string | null = null;
    private lastPort: number | null = null;
    private retryAttempts: number = 0;
    private retryTimeout: number | null = null;

    private sendOverWsEnabled: { [key: number]: boolean } = {};
    private buttonModifiers: { [key: number]: { [key: string]: any } } = {};
    private axisModifiers: { [key: string]: { [key: string]: any } } = {};
    private deadzoneOverrides: { [key: string]: number } = {};
    private defaultDeadzone: number = 0.01;
    private axisInversions: { [key: string]: boolean } = {
        'AXIS_X': false,
        'AXIS_Y': false,
        'AXIS_Z': false,
        'AXIS_RZ': false
    };

    private pollIntervalMs: number = 40; // 25 FPS
    private lastPollTime: number = 0;
    private lastSentPayload: any = null;

    constructor() {
        Object.values(BUTTON_MAPPING).forEach(keyCode => {
            this.sendOverWsEnabled[keyCode] = true;
        });

        this.startGamepadDetection();
    }

    private startGamepadDetection() {
        window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
            console.log('Gamepad connected:', e.gamepad);
            this.gamepadIndex = e.gamepad.index;
            this.startPolling();
        });

        window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
            console.log('Gamepad disconnected:', e.gamepad);
            if (this.gamepadIndex === e.gamepad.index) {
                this.gamepadIndex = null;
                this.stopPolling();
            }
        });

        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i]) {
                this.gamepadIndex = i;
                this.startPolling();
                break;
            }
        }
    }

    private startPolling() {
        if (this.isPolling) return;
        this.isPolling = true;
        this.lastPollTime = performance.now();
        this.pollGamepad();
    }

    private stopPolling() {
        this.isPolling = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    private pollGamepad() {
        if (!this.isPolling) return;

        const now = performance.now();
        const deltaTime = now - this.lastPollTime;

        if (deltaTime >= this.pollIntervalMs) {
            this.lastPollTime = now;
            this.updateGamepadState();
        }

        this.animationFrameId = requestAnimationFrame(() => this.pollGamepad());
    }

    private updateGamepadState() {
        if (this.gamepadIndex === null) return;

        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[this.gamepadIndex];

        if (!gamepad) return;

        gamepad.buttons.forEach((button, index) => {
            const pressed = button.pressed;
            const wasPressed = this.buttonStates[index] || false;

            if (pressed !== wasPressed) {
                this.buttonStates[index] = pressed;
                this.handleButtonEvent(index, pressed);
            }
        });

        this.handleAxisEvent(gamepad);
    }

    private handleButtonEvent(buttonIndex: number, pressed: boolean) {
        const keyCode = BUTTON_MAPPING[buttonIndex];
        if (keyCode === undefined) return;

        const keyName = this.getKeyName(keyCode);

        this.sendButtonEvent(keyName, keyCode, pressed)
    }

    private sendButtonEvent(keyName: string, keyCode: number, pressed: boolean) {
        const action = pressed ? 'ACTION_DOWN' : 'ACTION_UP';

        const params = {
            action,
            keyCode,
            keyName,
            modifiers: this.buttonModifiers[keyCode] || {}
        };

        if (this.sendOverWsEnabled[keyCode]) {
            this.sendJsonOverWebSocket({
                method: 'onButtonPress',
                data: params
            });
        }
    }

    private handleAxisEvent(gamepad: Gamepad) {
        const axisValuesToSend: { [key: string]: number } = {};
        const axisModifiersToSend: { [key: string]: any } = {};
        let hasMovement = false;

        gamepad.axes.forEach((value, index) => {
            const axisName = AXIS_NAMES[index as keyof typeof AXIS_NAMES];
            if (!axisName) return;

            const previousValue = this.lastAxisValues[axisName] || 0;

            if (this.shouldIncludeAxis(axisName, value, previousValue)) {
                const invertedValue = this.axisInversions[axisName] ? -value : value;
                axisValuesToSend[axisName] = invertedValue;

                const axisCode = this.getAxisCode(axisName);
                if (this.axisModifiers[axisCode]) {
                    axisModifiersToSend[axisName] = this.axisModifiers[axisCode];
                }

                if (Math.abs(value) > this.defaultDeadzone) {
                    hasMovement = true;
                }
            }

            this.lastAxisValues[axisName] = value;
        });

        if (gamepad.axes.length > 9) {
            const hatX = gamepad.axes[9] || 0;
            const hatY = gamepad.axes[10] || 0;

            if (this.shouldIncludeAxis('AXIS_HAT_X', hatX, this.lastAxisValues['AXIS_HAT_X'] || 0)) {
                axisValuesToSend['AXIS_HAT_X'] = hatX;
            }
            if (this.shouldIncludeAxis('AXIS_HAT_Y', hatY, this.lastAxisValues['AXIS_HAT_Y'] || 0)) {
                axisValuesToSend['AXIS_HAT_Y'] = hatY;
            }

            this.lastAxisValues['AXIS_HAT_X'] = hatX;
            this.lastAxisValues['AXIS_HAT_Y'] = hatY;
        }

        if (Object.keys(axisValuesToSend).length > 0) {
            const params = {
                action: 'ACTION_MOVE',
                modifiers: axisModifiersToSend,
                ...axisValuesToSend
            };

            this.lastSentPayload = params;
            emitter.emit('onJoyStick', params);

            this.sendJsonOverWebSocket({
                method: 'onJoystick',
                data: params
            });
        }
    }

    private shouldIncludeAxis(axisName: string, current: number, previous: number): boolean {
        const deadzone = this.deadzoneOverrides[axisName] || this.defaultDeadzone;
        const isMoving = Math.abs(current) > deadzone;
        const wasMoving = Math.abs(previous) > deadzone;

        return isMoving || wasMoving;
    }

    private getAxisCode(axisName: string): number {
        const mapping: { [key: string]: number } = {
            'AXIS_X': 0,
            'AXIS_Y': 1,
            'AXIS_Z': 11,
            'AXIS_RZ': 14,
            'AXIS_RX': 12,
            'AXIS_RY': 13,
            'AXIS_HAT_X': 15,
            'AXIS_HAT_Y': 16,
            'AXIS_SCROLL': 8
        };
        return mapping[axisName] || -1;
    }

    private getKeyName(keyCode: number): string {
        const mapping: { [key: number]: string } = {
            96: 'KEYCODE_BUTTON_A',
            97: 'KEYCODE_BUTTON_B',
            102: 'KEYCODE_BUTTON_L1',
            103: 'KEYCODE_BUTTON_R1',
            104: 'KEYCODE_BUTTON_L2',
            105: 'KEYCODE_BUTTON_R2',
            106: 'KEYCODE_BUTTON_THUMBL',
            107: 'KEYCODE_BUTTON_THUMBR',
            108: 'KEYCODE_BUTTON_START',
            109: 'KEYCODE_BUTTON_SELECT'
        };
        return mapping[keyCode] || `KEYCODE_${keyCode}`;
    }

    connectWebSocket(ip: string, port: number) {
        this.lastIp = ip;
        this.lastPort = port;

        console.log("connectWebSocket", ip, port)

        const url = `ws://${ip}:${port}`;

        this.socketState = 'connecting';
        emitter.emit('websocketStatus', {status: 'connecting'});

        try {
            this.webSocket = new WebSocket(url);

            this.webSocket.onopen = () => {
                console.log('WebSocket connected to', url);
                this.retryAttempts = 0;
                if (this.retryTimeout !== null) {
                    clearTimeout(this.retryTimeout);
                    this.retryTimeout = null;
                }
                this.socketState = 'connected';
                emitter.emit('websocketStatus', {status: 'connected'});
            };

            this.webSocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.socketState = 'error';
                emitter.emit('websocketStatus', {
                    status: 'error',
                    error: 'Connection error'
                });
            };

            this.webSocket.onclose = (event) => {
                console.log('WebSocket closed:', event.reason);

                if (event.code !== 1000) { // Only reconnect if not manually disconnected
                    this.attemptReconnect();
                }

                this.socketState = 'disconnected';
                emitter.emit('websocketStatus', {status: 'disconnected'});
            };

        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.socketState = 'error';
            emitter.emit('websocketStatus', {
                status: 'error',
                error: String(error)
            });
        }
    }

    private attemptReconnect() {
        if (this.lastIp !== null && this.lastPort !== null) {
            const delay = 1000 * Math.pow(2, Math.min(this.retryAttempts, 5));
            this.retryAttempts++;

            if (this.retryTimeout !== null) {
                clearTimeout(this.retryTimeout);
            }

            this.retryTimeout = window.setTimeout(() => {
                this.connectWebSocket(this.lastIp!, this.lastPort!);
            }, delay);

            console.log(`Retrying in ${delay / 1000}s...`);
        }
    }

    disconnectWebSocket() {
        if (this.retryTimeout !== null) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }

        if (this.webSocket) {
            this.webSocket.close(1000, 'Manual disconnect');
            this.webSocket = null;
        }
    }

    private sendJsonOverWebSocket(data: any) {
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            try {
                this.webSocket.send(JSON.stringify(data));
            } catch (error) {
                console.error('Failed to send JSON over WebSocket:', error);
            }
        }
    }

    getWebSocketStatus(): string {
        return this.socketState;
    }

    sendButtonPressOverWebSocket(keyCode: number, enabled: boolean) {
        this.sendOverWsEnabled[keyCode] = enabled;
    }

    setButtonModifiers(keyCode: number, modifiers: { [key: string]: any }) {
        this.buttonModifiers[keyCode] = modifiers;
    }

    setAxisModifiers(motionEvent: number, modifiers: { [key: string]: any }) {
        this.axisModifiers[motionEvent] = modifiers;
    }

    setAxisDeadzone(motionEvent: number, deadzone: number) {
        const axisName = Object.keys(AXIS_NAMES).find(
            key => this.getAxisCode(AXIS_NAMES[parseInt(key) as keyof typeof AXIS_NAMES]) === motionEvent
        );

        if (axisName) {
            const name = AXIS_NAMES[parseInt(axisName) as keyof typeof AXIS_NAMES];
            this.deadzoneOverrides[name] = deadzone;
        }
    }

    private getKeyCodeFromName(keyName: string): number | null {
        const mapping: { [key: string]: number } = {
            'KEYCODE_BUTTON_A': 96,
            'KEYCODE_BUTTON_B': 97,
            'KEYCODE_BUTTON_L1': 102,
            'KEYCODE_BUTTON_R1': 103,
            'KEYCODE_BUTTON_L2': 104,
            'KEYCODE_BUTTON_R2': 105,
            'KEYCODE_BUTTON_THUMBL': 106,
            'KEYCODE_BUTTON_THUMBR': 107,
            'KEYCODE_BUTTON_START': 108,
            'KEYCODE_BUTTON_SELECT': 109
        };
        return mapping[keyName] || null;
    }

    buttonDown(keyName: string) {
        const keyCode = this.getKeyCodeFromName(keyName);
        if (keyCode === null) {
            console.warn(`Unknown button keyName: ${keyName}`);
            return;
        }

        this.sendButtonEvent(keyName, keyCode, true)
    }

    buttonUp(keyName: string) {
        const keyCode = this.getKeyCodeFromName(keyName);
        if (keyCode === null) {
            console.warn(`Unknown button keyName: ${keyName}`);
            return;
        }

        this.sendButtonEvent(keyName, keyCode, false)
    }

    setInvertX(inverted: boolean) {
        this.axisInversions['AXIS_X'] = inverted;
        this.axisInversions['AXIS_Z'] = inverted;
    }

    setInvertY(inverted: boolean) {
        this.axisInversions['AXIS_Y'] = inverted;
        this.axisInversions['AXIS_RZ'] = inverted;
    }

    leftStickMove(x: number, y: number) {
        const invertedX = this.axisInversions['AXIS_X'] ? -x : x;
        const invertedY = this.axisInversions['AXIS_Y'] ? -y : y;

        const params = {
            action: 'ACTION_MOVE',
            modifiers: {},
            AXIS_X: invertedX,
            AXIS_Y: invertedY
        };

        emitter.emit('onJoyStick', params);

        this.sendJsonOverWebSocket({
            method: 'onJoystick',
            data: params
        });
    }

    rightStickMove(x: number, y: number) {
        const invertedX = this.axisInversions['AXIS_Z'] ? -x : x;
        const invertedY = this.axisInversions['AXIS_RZ'] ? -y : y;

        const params = {
            action: 'ACTION_MOVE',
            modifiers: {},
            AXIS_Z: invertedX,
            AXIS_RZ: invertedY
        };

        emitter.emit('onJoyStick', params);

        this.sendJsonOverWebSocket({
            method: 'onJoystick',
            data: params
        });
    }
}

const instance = new ExpoJoystickWeb();

export default {
    connectWebSocket: (ip: string, port: number) => instance.connectWebSocket(ip, port),
    disconnectWebSocket: () => instance.disconnectWebSocket(),
    getWebSocketStatus: () => instance.getWebSocketStatus(),
    sendButtonPressOverWebSocket: (keyCode: number, enabled: boolean) =>
        instance.sendButtonPressOverWebSocket(keyCode, enabled),
    setButtonModifiers: (keyCode: number, modifiers: { [key: string]: any }) =>
        instance.setButtonModifiers(keyCode, modifiers),
    setAxisModifiers: (motionEvent: number, modifiers: { [key: string]: any }) =>
        instance.setAxisModifiers(motionEvent, modifiers),
    setAxisDeadzone: (motionEvent: number, deadzone: number) =>
        instance.setAxisDeadzone(motionEvent, deadzone),
    buttonDown: (keyName: string) => instance.buttonDown(keyName),
    buttonUp: (keyName: string) => instance.buttonUp(keyName),
    setInvertX: (inverted: boolean) => instance.setInvertX(inverted),
    setInvertY: (inverted: boolean) => instance.setInvertY(inverted),
    leftStickMove: (x: number, y: number) => instance.leftStickMove(x, y),
    rightStickMove: (x: number, y: number) => instance.rightStickMove(x, y),
};
