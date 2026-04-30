/**
 * ExpoJoystick.web.ts
 *
 * Web implementation of the ExpoJoystick native module.
 * Mirrors the Kotlin module's behaviour using the Web Gamepad API.
 *
 * Drop this file next to ExpoJoystickModule.ts – Expo's platform resolution
 * will automatically pick it up on web builds.
 */
// ---------------------------------------------------------------------------
// Web Gamepad button → keyCode mapping
// Mirrors GAMEPAD_KEYS + validKeyCodes in the Kotlin module.
// Standard Gamepad API button indices → KeyEvent keyCodes
// ---------------------------------------------------------------------------
const BUTTON_INDEX_TO_KEYCODE = {
    0: 96,
    1: 97,
    2: 99,
    3: 100,
    4: 102,
    5: 103,
    6: 104,
    7: 105,
    8: 109,
    9: 108,
    10: 106,
    11: 107,
    12: 19,
    13: 20,
    14: 21,
    15: 22,
    16: 110, // MODE → KEYCODE_BUTTON_MODE
};
const KEYCODE_TO_NAME = {
    96: "KEYCODE_BUTTON_A",
    97: "KEYCODE_BUTTON_B",
    99: "KEYCODE_BUTTON_X",
    100: "KEYCODE_BUTTON_Y",
    102: "KEYCODE_BUTTON_L1",
    103: "KEYCODE_BUTTON_R1",
    104: "KEYCODE_BUTTON_L2",
    105: "KEYCODE_BUTTON_R2",
    109: "KEYCODE_BUTTON_SELECT",
    108: "KEYCODE_BUTTON_START",
    106: "KEYCODE_BUTTON_THUMBL",
    107: "KEYCODE_BUTTON_THUMBR",
    19: "KEYCODE_DPAD_UP",
    20: "KEYCODE_DPAD_DOWN",
    21: "KEYCODE_DPAD_LEFT",
    22: "KEYCODE_DPAD_RIGHT",
    110: "KEYCODE_BUTTON_MODE",
};
// Standard Gamepad API axis indices → MotionEvent axis names
// axes[0]=X, axes[1]=Y, axes[2]=Z, axes[3]=RZ
const AXIS_INDEX_TO_NAME = {
    0: "AXIS_X",
    1: "AXIS_Y",
    2: "AXIS_Z",
    3: "AXIS_RZ",
};
// Analog trigger axes are typically buttons[6].value / buttons[7].value on
// standard mapping, but some browsers expose them as axes[4] / axes[5].
// We handle both cases below.
// ---------------------------------------------------------------------------
// AnalogInput label → axis names (mirrors Kotlin ANALOG_INPUTS)
// ---------------------------------------------------------------------------
const ANALOG_INPUTS = {
    LEFT_STICK: ["AXIS_X", "AXIS_Y"],
    RIGHT_STICK: ["AXIS_Z", "AXIS_RZ"],
    DPAD: ["AXIS_HAT_X", "AXIS_HAT_Y"],
    LEFT_TRIGGER: ["AXIS_RX"],
    RIGHT_TRIGGER: ["AXIS_RY"],
};
// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
// Emitter listeners keyed by event name
const listeners = {
    onButtonPress: new Set(),
    onJoyStick: new Set(),
    websocketStatus: new Set(),
};
function emit(event, payload) {
    listeners[event]?.forEach(fn => {
        try {
            fn(payload);
        }
        catch { /* swallow */ }
    });
}
// Axis & button state
const lastAxisValues = {};
const previousAxisValues = {};
const currentButtonStates = {};
// Configuration
const deadzoneOverrides = {};
const axisInversions = {};
const buttonModifiers = {};
const axisModifiers = {};
const buttonEventNames = {};
const labelEventNames = {};
const sendOverWsEnabled = {};
const DEFAULT_DEADZONE = 0.01;
// Polling
let rafId = null;
let hasGamepad = false;
let lastPollTime = 0;
const POLL_INTERVAL_MS = 16; // ~60 fps
// WebSocket
let ws = null;
let wsState = "disconnected";
let wsLastIp = null;
let wsLastPort = null;
let wsRetry = 0;
let wsRetryTimer = null;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deadzone(axisName) {
    return deadzoneOverrides[axisName] ?? DEFAULT_DEADZONE;
}
function applyInversion(axisIndex, value) {
    return axisInversions[axisIndex] === true ? -value : value;
}
// Returns the first connected gamepad (or null)
function getGamepad() {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
        if (pads[i])
            return pads[i];
    }
    return null;
}
// ---------------------------------------------------------------------------
// WebSocket helpers (mirrors Kotlin logic)
// ---------------------------------------------------------------------------
function sendJsonOverWs(map) {
    if (wsState !== "connected" || !ws)
        return;
    try {
        ws.send(JSON.stringify(map));
    }
    catch { /* ignore */ }
}
function attemptReconnect() {
    if (!wsLastIp || !wsLastPort)
        return;
    const delay = Math.min(1000 * Math.pow(2, wsRetry), 32000);
    wsRetry++;
    if (wsRetryTimer)
        clearTimeout(wsRetryTimer);
    wsRetryTimer = setTimeout(() => connectWebSocket(wsLastIp, wsLastPort), delay);
}
function connectWebSocket(ip, port) {
    wsLastIp = ip;
    wsLastPort = port;
    if (wsRetryTimer) {
        clearTimeout(wsRetryTimer);
        wsRetryTimer = null;
    }
    wsState = "connecting";
    emit("websocketStatus", { status: "connecting" });
    const url = `ws://${ip}:${port}`;
    ws = new WebSocket(url);
    ws.onopen = () => {
        wsRetry = 0;
        wsState = "connected";
        emit("websocketStatus", { status: "connected" });
    };
    ws.onerror = (ev) => {
        wsState = "error";
        emit("websocketStatus", { status: "error", error: String(ev) });
        attemptReconnect();
    };
    ws.onclose = (ev) => {
        wsState = "disconnected";
        emit("websocketStatus", { status: "disconnected" });
        if (ev.code !== 1000)
            attemptReconnect();
    };
}
function disconnectWebSocket() {
    if (wsRetryTimer) {
        clearTimeout(wsRetryTimer);
        wsRetryTimer = null;
    }
    ws?.close(1000, "Manual disconnect");
    ws = null;
    wsLastIp = null;
    wsLastPort = null;
}
// ---------------------------------------------------------------------------
// Label payload builder (mirrors Kotlin buildLabelPayloads)
// ---------------------------------------------------------------------------
function buildLabelPayloads(delta) {
    const result = [];
    for (const [label, eventName] of Object.entries(labelEventNames)) {
        const axes = ANALOG_INPUTS[label];
        if (!axes)
            continue;
        const isSingle = axes.length === 1;
        const axisIndex0 = getAxisIndexForName(axes[0]);
        const axisIndex1 = isSingle ? -1 : getAxisIndexForName(axes[1]);
        const x = applyInversion(axisIndex0, lastAxisValues[axes[0]] ?? 0);
        const y = isSingle ? 0 : applyInversion(axisIndex1, lastAxisValues[axes[1]] ?? 0);
        const prevX = previousAxisValues[axes[0]] ?? 0;
        const prevY = isSingle ? 0 : (previousAxisValues[axes[1]] ?? 0);
        const xActive = Math.abs(x) >= DEFAULT_DEADZONE || Math.abs(prevX) >= DEFAULT_DEADZONE;
        const yActive = !isSingle && (Math.abs(y) >= DEFAULT_DEADZONE || Math.abs(prevY) >= DEFAULT_DEADZONE);
        if (!xActive && !yActive)
            continue;
        const payload = {};
        // Collect per-axis modifiers
        const mods = {};
        for (const axName of axes) {
            const idx = getAxisIndexForName(axName);
            if (axisModifiers[idx])
                mods[axName] = axisModifiers[idx];
        }
        if (Object.keys(mods).length)
            payload["modifiers"] = mods;
        if (isSingle) {
            payload["value"] = x;
        }
        else {
            payload["x"] = x;
            payload["y"] = y;
        }
        if (delta !== undefined)
            payload["delta"] = delta;
        result.push([eventName, payload]);
    }
    return result;
}
function sendLabelPayloads(delta) {
    for (const [eventName, payload] of buildLabelPayloads(delta)) {
        sendJsonOverWs({ method: eventName, data: payload });
    }
}
// Reverse lookup: axis name → axis index (best-effort)
function getAxisIndexForName(axisName) {
    for (const [idx, name] of Object.entries(AXIS_INDEX_TO_NAME)) {
        if (name === axisName)
            return Number(idx);
    }
    // Triggers
    if (axisName === "AXIS_RX")
        return 100; // sentinel for left trigger
    if (axisName === "AXIS_RY")
        return 101; // sentinel for right trigger
    return -1;
}
// ---------------------------------------------------------------------------
// Polling loop – reads gamepad state and fires events
// ---------------------------------------------------------------------------
function pollGamepad(now) {
    if (hasGamepad)
        rafId = requestAnimationFrame(pollGamepad); // poll as long as gamepad is connected
    if (now - lastPollTime < POLL_INTERVAL_MS)
        return;
    const delta = Math.round(now - lastPollTime);
    lastPollTime = now;
    const pad = getGamepad();
    if (!pad) {
        stopPolling();
        return;
    }
    // ---- Axes ----
    // Standard mapping: axes[0..3] = LX, LY, RX, RY
    const axisMotionMap = [];
    for (let i = 0; i < pad.axes.length && i <= 3; i++) {
        const name = AXIS_INDEX_TO_NAME[i];
        if (!name)
            continue;
        axisMotionMap.push({ name, axisIndex: i, value: pad.axes[i] });
    }
    // Triggers: prefer axes[4]/axes[5] if present, else buttons[6]/buttons[7].value
    const ltValue = pad.axes.length > 4 ? pad.axes[4] : (pad.buttons[6]?.value ?? 0);
    const rtValue = pad.axes.length > 5 ? pad.axes[5] : (pad.buttons[7]?.value ?? 0);
    axisMotionMap.push({ name: "AXIS_RX", axisIndex: 100, value: ltValue });
    axisMotionMap.push({ name: "AXIS_RY", axisIndex: 101, value: rtValue });
    // D-Pad via buttons[12..15] if HAT axes not available
    const hatXBtn = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
    const hatYBtn = (pad.buttons[13]?.pressed ? 1 : 0) - (pad.buttons[12]?.pressed ? 1 : 0);
    axisMotionMap.push({ name: "AXIS_HAT_X", axisIndex: -1, value: hatXBtn });
    axisMotionMap.push({ name: "AXIS_HAT_Y", axisIndex: -1, value: hatYBtn });
    let anyAxisActive = false;
    const motionPayload = { action: "ACTION_MOVE", modifiers: {} };
    const activeModifiers = {};
    for (const { name, axisIndex, value } of axisMotionMap) {
        previousAxisValues[name] = lastAxisValues[name] ?? 0;
        const inverted = applyInversion(axisIndex, value);
        lastAxisValues[name] = inverted;
        motionPayload[name] = inverted;
        const dz = deadzone(name);
        if (Math.abs(inverted) > dz || Math.abs(previousAxisValues[name]) > dz) {
            anyAxisActive = true;
        }
        if (axisModifiers[axisIndex])
            activeModifiers[name] = axisModifiers[axisIndex];
    }
    motionPayload["modifiers"] = activeModifiers;
    if (anyAxisActive) {
        // Emit onJoyStick (same shape as Kotlin's raw event)
        emit("onJoyStick", motionPayload);
        // Send label payloads over WebSocket
        sendLabelPayloads(delta);
    }
    // ---- Buttons ----
    for (let i = 0; i < pad.buttons.length; i++) {
        const keyCode = BUTTON_INDEX_TO_KEYCODE[i];
        if (keyCode === undefined)
            continue;
        const pressed = pad.buttons[i].pressed;
        const wasDown = currentButtonStates[keyCode] ?? false;
        if (pressed === wasDown)
            continue; // no change
        currentButtonStates[keyCode] = pressed;
        const action = pressed ? "ACTION_DOWN" : "ACTION_UP";
        const keyName = KEYCODE_TO_NAME[keyCode] ?? `KEYCODE_${keyCode}`;
        const modifiers = buttonModifiers[keyCode] ?? {};
        const btnPayload = { action, keyCode, keyName, modifiers };
        emit("onButtonPress", btnPayload);
        if (sendOverWsEnabled[keyCode] !== false) {
            const eventName = buttonEventNames[keyCode];
            if (eventName) {
                const data = { pressed };
                if (Object.keys(modifiers).length)
                    data["modifiers"] = modifiers;
                sendJsonOverWs({ method: eventName, data });
            }
            else {
                sendJsonOverWs({ method: "onButtonPress", data: btnPayload });
            }
        }
    }
}
function startPolling() {
    if (rafId !== null)
        return;
    hasGamepad = true;
    lastPollTime = performance.now();
    rafId = requestAnimationFrame(pollGamepad);
}
function stopPolling() {
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    hasGamepad = false;
}
// ---------------------------------------------------------------------------
// Gamepad connect / disconnect events
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
    const tryStartOnLoad = () => {
        if (getGamepad()) {
            startPolling();
        }
    };
    // Poll briefly on startup to catch pre-connected gamepads
    let startupChecks = 0;
    const startupInterval = setInterval(() => {
        if (getGamepad()) {
            startPolling();
            clearInterval(startupInterval);
        }
        else if (++startupChecks > 20) { // give up after ~2s
            clearInterval(startupInterval);
        }
    }, 500);
    window.addEventListener("gamepadconnected", (e) => {
        console.log("Gamepad connected?: ", e.gamepad.id);
        startPolling();
        clearInterval(startupInterval);
    });
    window.addEventListener("gamepaddisconnected", () => {
        console.log('gamepad disconnected');
        if (!getGamepad())
            stopPolling();
    });
    tryStartOnLoad();
}
// ---------------------------------------------------------------------------
// Minimal EventEmitter shim so the existing index.ts `emitter` works on web
// ---------------------------------------------------------------------------
/**
 * This object is what ExpoJoystickModule resolves to on web.
 * It exposes addListener / removeAllListeners so that the EventEmitter wrapper
 * in index.ts works without changes, AND it exposes all the function-style API
 * methods for direct calls from index.ts.
 */
const ExpoJoystickWebModule = {
    // ---- EventEmitter interface (used by expo-modules-core EventEmitter) ----
    addListener(eventName, listener) {
        if (!listeners[eventName])
            listeners[eventName] = new Set();
        listeners[eventName].add(listener);
        return { remove: () => listeners[eventName].delete(listener) };
    },
    removeAllListeners(eventName) {
        listeners[eventName]?.clear();
    },
    // ---- Module functions ----
    connectWebSocket(ip, port) {
        connectWebSocket(ip, port);
    },
    disconnectWebSocket() {
        disconnectWebSocket();
    },
    getWebSocketStatus() {
        return wsState;
    },
    getDeviceName() {
        const pad = getGamepad();
        return pad?.id ?? "";
    },
    getGamepadConfiguration() {
        const pad = getGamepad();
        if (!pad)
            return [];
        const axes = [];
        for (let i = 0; i < pad.axes.length; i++) {
            const name = AXIS_INDEX_TO_NAME[i] ?? `AXIS_${i}`;
            axes.push({
                axis: i,
                name,
                min: -1,
                max: 1,
                flat: DEFAULT_DEADZONE,
                source: ["JOYSTICK"],
                inverted: axisInversions[i] === true,
            });
        }
        const buttons = pad.buttons.map((_, i) => {
            const keyCode = BUTTON_INDEX_TO_KEYCODE[i];
            return keyCode !== undefined
                ? { keyCode, name: KEYCODE_TO_NAME[keyCode] ?? `KEYCODE_${keyCode}` }
                : null;
        }).filter(Boolean);
        return [{
                deviceId: pad.index,
                deviceName: pad.id,
                sources: ["GAMEPAD", "JOYSTICK"],
                axes,
                buttons,
            }];
    },
    getGamepadState() {
        const pad = getGamepad();
        if (!pad)
            return [];
        const axesState = {};
        for (const [name, val] of Object.entries(lastAxisValues)) {
            axesState[name] = val;
        }
        const buttonsState = {};
        for (const [keyCode, name] of Object.entries(KEYCODE_TO_NAME)) {
            buttonsState[name] = currentButtonStates[Number(keyCode)] ?? false;
        }
        return [{
                deviceId: pad.index,
                deviceName: pad.id,
                axes: axesState,
                buttons: buttonsState,
            }];
    },
    sendButtonPressOverWebSocket(keyCode, enabled) {
        sendOverWsEnabled[keyCode] = enabled;
    },
    setButtonModifiers(keyCode, modifiers) {
        buttonModifiers[keyCode] = { ...modifiers };
    },
    setAxisModifiers(motionEvent, modifiers) {
        axisModifiers[motionEvent] = { ...modifiers };
    },
    updateAxisModifiers(motionEvent, modifiers) {
        axisModifiers[motionEvent] = { ...(axisModifiers[motionEvent] ?? {}), ...modifiers };
    },
    setButtonEventName(keyCode, eventName) {
        buttonEventNames[keyCode] = eventName;
    },
    setAnalogInputEventName(label, eventName) {
        if (!ANALOG_INPUTS[label])
            throw new Error(`Unknown analog input label: '${label}'. Must be one of: ${Object.keys(ANALOG_INPUTS).join(", ")}`);
        labelEventNames[label] = eventName;
        // Start polling if a gamepad is already connected
        if (getGamepad())
            startPolling();
    },
    setAxisDeadzone(motionEvent, deadZone) {
        const name = AXIS_INDEX_TO_NAME[motionEvent] ?? `AXIS_${motionEvent}`;
        deadzoneOverrides[name] = deadZone;
    },
    setAxisInverted(motionEvent, inverted) {
        axisInversions[motionEvent] = inverted;
    },
};
export default ExpoJoystickWebModule;
//# sourceMappingURL=ExpoJoystickModule.web.js.map