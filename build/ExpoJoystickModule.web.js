import { EventEmitter } from 'expo-modules-core';
const emitter = new EventEmitter({});
const BUTTON_MAPPING = {
    0: 96,
    1: 97,
    4: 102,
    5: 103,
    6: 104,
    7: 105,
    10: 106,
    11: 107,
    8: 109,
    9: 108, // Start
};
const AXIS_NAMES = {
    0: 'AXIS_X',
    1: 'AXIS_Y',
    2: 'AXIS_Z',
    3: 'AXIS_RZ',
    4: 'AXIS_RX',
    5: 'AXIS_RY', // Right trigger
};
class ExpoJoystickWeb {
    gamepadIndex = null;
    animationFrameId = null;
    lastAxisValues = {};
    buttonStates = {};
    isPolling = false;
    webSocket = null;
    socketState = 'disconnected';
    lastIp = null;
    lastPort = null;
    retryAttempts = 0;
    retryTimeout = null;
    sendOverWsEnabled = {};
    buttonModifiers = {};
    axisModifiers = {};
    deadzoneOverrides = {};
    defaultDeadzone = 0.01;
    pollIntervalMs = 40; // 25 FPS
    lastPollTime = 0;
    lastSentPayload = null;
    constructor() {
        Object.values(BUTTON_MAPPING).forEach(keyCode => {
            this.sendOverWsEnabled[keyCode] = true;
        });
        this.startGamepadDetection();
    }
    startGamepadDetection() {
        window.addEventListener('gamepadconnected', (e) => {
            console.log('Gamepad connected:', e.gamepad);
            this.gamepadIndex = e.gamepad.index;
            this.startPolling();
        });
        window.addEventListener('gamepaddisconnected', (e) => {
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
    startPolling() {
        if (this.isPolling)
            return;
        this.isPolling = true;
        this.lastPollTime = performance.now();
        this.pollGamepad();
    }
    stopPolling() {
        this.isPolling = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    pollGamepad() {
        if (!this.isPolling)
            return;
        const now = performance.now();
        const deltaTime = now - this.lastPollTime;
        if (deltaTime >= this.pollIntervalMs) {
            this.lastPollTime = now;
            this.updateGamepadState();
        }
        this.animationFrameId = requestAnimationFrame(() => this.pollGamepad());
    }
    updateGamepadState() {
        if (this.gamepadIndex === null)
            return;
        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[this.gamepadIndex];
        if (!gamepad)
            return;
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
    handleButtonEvent(buttonIndex, pressed) {
        console.log("HERE", buttonIndex, pressed);
        const keyCode = BUTTON_MAPPING[buttonIndex];
        if (keyCode === undefined)
            return;
        const keyName = this.getKeyName(keyCode);
        this.sendButtonEvent(keyName, keyCode, pressed);
    }
    sendButtonEvent(keyName, keyCode, pressed) {
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
    handleAxisEvent(gamepad) {
        const axisValuesToSend = {};
        const axisModifiersToSend = {};
        let hasMovement = false;
        gamepad.axes.forEach((value, index) => {
            const axisName = AXIS_NAMES[index];
            if (!axisName)
                return;
            const previousValue = this.lastAxisValues[axisName] || 0;
            if (this.shouldIncludeAxis(axisName, value, previousValue)) {
                axisValuesToSend[axisName] = value;
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
    shouldIncludeAxis(axisName, current, previous) {
        const deadzone = this.deadzoneOverrides[axisName] || this.defaultDeadzone;
        const isMoving = Math.abs(current) > deadzone;
        const wasMoving = Math.abs(previous) > deadzone;
        return isMoving || wasMoving;
    }
    getAxisCode(axisName) {
        const mapping = {
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
    getKeyName(keyCode) {
        const mapping = {
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
    connectWebSocket(ip, port) {
        this.lastIp = ip;
        this.lastPort = port;
        console.log("connectWebSocket", ip, port);
        const url = `ws://${ip}:${port}`;
        this.socketState = 'connecting';
        emitter.emit('websocketStatus', { status: 'connecting' });
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
                emitter.emit('websocketStatus', { status: 'connected' });
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
                emitter.emit('websocketStatus', { status: 'disconnected' });
            };
        }
        catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.socketState = 'error';
            emitter.emit('websocketStatus', {
                status: 'error',
                error: String(error)
            });
        }
    }
    attemptReconnect() {
        if (this.lastIp !== null && this.lastPort !== null) {
            const delay = 1000 * Math.pow(2, Math.min(this.retryAttempts, 5));
            this.retryAttempts++;
            if (this.retryTimeout !== null) {
                clearTimeout(this.retryTimeout);
            }
            this.retryTimeout = window.setTimeout(() => {
                this.connectWebSocket(this.lastIp, this.lastPort);
            }, delay);
            console.log(`Retrying in ${delay / 1000}s...`);
        }
    }
    disconnectWebSocket() {
        console.log("disconnect");
        if (this.retryTimeout !== null) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
        if (this.webSocket) {
            this.webSocket.close(1000, 'Manual disconnect');
            this.webSocket = null;
        }
    }
    sendJsonOverWebSocket(data) {
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            try {
                this.webSocket.send(JSON.stringify(data));
            }
            catch (error) {
                console.error('Failed to send JSON over WebSocket:', error);
            }
        }
    }
    getWebSocketStatus() {
        return this.socketState;
    }
    testFunction() {
        return "WEB";
    }
    sendButtonPressOverWebSocket(keyCode, enabled) {
        this.sendOverWsEnabled[keyCode] = enabled;
    }
    setButtonModifiers(keyCode, modifiers) {
        this.buttonModifiers[keyCode] = modifiers;
    }
    setAxisModifiers(motionEvent, modifiers) {
        this.axisModifiers[motionEvent] = modifiers;
    }
    setAxisDeadzone(motionEvent, deadzone) {
        const axisName = Object.keys(AXIS_NAMES).find(key => this.getAxisCode(AXIS_NAMES[parseInt(key)]) === motionEvent);
        if (axisName) {
            const name = AXIS_NAMES[parseInt(axisName)];
            this.deadzoneOverrides[name] = deadzone;
        }
    }
    getKeyCodeFromName(keyName) {
        const mapping = {
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
    buttonDown(keyName) {
        console.log("buttonDown", keyName);
        const keyCode = this.getKeyCodeFromName(keyName);
        if (keyCode === null) {
            console.warn(`Unknown button keyName: ${keyName}`);
            return;
        }
        this.sendButtonEvent(keyName, keyCode, true);
    }
    buttonUp(keyName) {
        console.log("buttonUp", keyName);
        const keyCode = this.getKeyCodeFromName(keyName);
        if (keyCode === null) {
            console.warn(`Unknown button keyName: ${keyName}`);
            return;
        }
        this.sendButtonEvent(keyName, keyCode, true);
    }
}
const instance = new ExpoJoystickWeb();
export default {
    connectWebSocket: (ip, port) => instance.connectWebSocket(ip, port),
    disconnectWebSocket: () => instance.disconnectWebSocket(),
    getWebSocketStatus: () => instance.getWebSocketStatus(),
    testFunction: () => instance.testFunction(),
    sendButtonPressOverWebSocket: (keyCode, enabled) => instance.sendButtonPressOverWebSocket(keyCode, enabled),
    setButtonModifiers: (keyCode, modifiers) => instance.setButtonModifiers(keyCode, modifiers),
    setAxisModifiers: (motionEvent, modifiers) => instance.setAxisModifiers(motionEvent, modifiers),
    setAxisDeadzone: (motionEvent, deadzone) => instance.setAxisDeadzone(motionEvent, deadzone),
    buttonDown: (keyName) => instance.buttonDown(keyName),
    buttonUp: (keyName) => instance.buttonUp(keyName),
};
//# sourceMappingURL=ExpoJoystickModule.web.js.map