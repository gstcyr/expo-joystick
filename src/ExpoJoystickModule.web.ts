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
// Types (duplicated here so this file is self-contained)
// ---------------------------------------------------------------------------

type Listener<T> = (event: T) => void;

interface KeyEventPayload {
    action: string;       // "ACTION_DOWN" | "ACTION_UP"
    keyCode: number;
    keyName: string;
    modifiers: Record<string, unknown>;
}

interface MotionEventPayload2 {
    AXIS_X?: number;
    AXIS_Y?: number;
    AXIS_Z?: number;
    AXIS_RZ?: number;
    AXIS_HAT_X?: number;
    AXIS_HAT_Y?: number;
    AXIS_RX?: number;   // left trigger
    AXIS_RY?: number;   // right trigger
    action: string;
    modifiers: Record<string, unknown>;
}

interface WebSocketStatusEvent {
    status: string;
    error?: string;
}

// ---------------------------------------------------------------------------
// Web Gamepad button → keyCode mapping
// Mirrors GAMEPAD_KEYS + validKeyCodes in the Kotlin module.
// Standard Gamepad API button indices → KeyEvent keyCodes
// ---------------------------------------------------------------------------

const BUTTON_INDEX_TO_KEYCODE: Record<number, number> = {
    0:  96,  // A  → KEYCODE_BUTTON_A
    1:  97,  // B  → KEYCODE_BUTTON_B
    2:  99,  // X  → KEYCODE_BUTTON_X
    3:  100, // Y  → KEYCODE_BUTTON_Y
    4:  102, // L1 → KEYCODE_BUTTON_L1
    5:  103, // R1 → KEYCODE_BUTTON_R1
    6:  104, // L2 → KEYCODE_BUTTON_L2
    7:  105, // R2 → KEYCODE_BUTTON_R2
    8:  109, // SELECT → KEYCODE_BUTTON_SELECT
    9:  108, // START  → KEYCODE_BUTTON_START
    10: 106, // THUMBL → KEYCODE_BUTTON_THUMBL
    11: 107, // THUMBR → KEYCODE_BUTTON_THUMBR
    12: 19,  // DPAD_UP    → KEYCODE_DPAD_UP
    13: 20,  // DPAD_DOWN  → KEYCODE_DPAD_DOWN
    14: 21,  // DPAD_LEFT  → KEYCODE_DPAD_LEFT
    15: 22,  // DPAD_RIGHT → KEYCODE_DPAD_RIGHT
    16: 110, // MODE → KEYCODE_BUTTON_MODE
};

const KEYCODE_TO_NAME: Record<number, string> = {
    96:  "KEYCODE_BUTTON_A",
    97:  "KEYCODE_BUTTON_B",
    99:  "KEYCODE_BUTTON_X",
    100: "KEYCODE_BUTTON_Y",
    102: "KEYCODE_BUTTON_L1",
    103: "KEYCODE_BUTTON_R1",
    104: "KEYCODE_BUTTON_L2",
    105: "KEYCODE_BUTTON_R2",
    109: "KEYCODE_BUTTON_SELECT",
    108: "KEYCODE_BUTTON_START",
    106: "KEYCODE_BUTTON_THUMBL",
    107: "KEYCODE_BUTTON_THUMBR",
    19:  "KEYCODE_DPAD_UP",
    20:  "KEYCODE_DPAD_DOWN",
    21:  "KEYCODE_DPAD_LEFT",
    22:  "KEYCODE_DPAD_RIGHT",
    110: "KEYCODE_BUTTON_MODE",
};

// Standard Gamepad API axis indices → MotionEvent axis names
// axes[0]=X, axes[1]=Y, axes[2]=Z, axes[3]=RZ
const AXIS_INDEX_TO_NAME: Record<number, string> = {
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

const ANALOG_INPUTS: Record<string, string[]> = {
    LEFT_STICK:    ["AXIS_X",     "AXIS_Y"],
    RIGHT_STICK:   ["AXIS_Z",     "AXIS_RZ"],     // AXIS_RX, AXIS_RY
    DPAD:          ["AXIS_HAT_X", "AXIS_HAT_Y"],
    LEFT_TRIGGER:  ["AXIS_RX"],
    RIGHT_TRIGGER: ["AXIS_RY"],
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

// Emitter listeners keyed by event name
const listeners: Record<string, Set<Listener<unknown>>> = {
    onButtonPress:    new Set(),
    onJoyStick:       new Set(),
    websocketStatus:  new Set(),
};

function emit(event: string, payload: unknown): void {
    listeners[event]?.forEach(fn => {
        try { fn(payload); } catch { /* swallow */ }
    });
}

// Axis & button state
const lastAxisValues: Record<string, number>    = {};
const previousAxisValues: Record<string, number> = {};
const currentButtonStates: Record<number, boolean> = {};

// Configuration
const deadzoneOverrides: Record<string, number>                 = {};
const axisInversions: Record<number, boolean>                   = {};
const buttonModifiers: Record<number, Record<string, unknown>>  = {};
const axisModifiers: Record<number, Record<string, unknown>>    = {};
const buttonEventNames: Record<number, string>                  = {};
const labelEventNames: Record<string, string>                   = {};
const sendOverWsEnabled: Record<number, boolean>                = {};

const DEFAULT_DEADZONE = 0.01;

// Polling
let rafId: number | null = null;
let hasGamepad: boolean = false;
let lastPollTime         = 0;
const POLL_INTERVAL_MS   = 16; // ~60 fps

// WebSocket
let ws:           WebSocket | null = null;
let wsState       = "disconnected";
let wsLastIp:     string | null    = null;
let wsLastPort:   number | null    = null;
let wsRetry       = 0;
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deadzone(axisName: string): number {
    return deadzoneOverrides[axisName] ?? DEFAULT_DEADZONE;
}

function applyInversion(axisIndex: number, value: number): number {
    return axisInversions[axisIndex] === true ? -value : value;
}

// Returns the first connected gamepad (or null)
function getGamepad(): Gamepad | null {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
        if (pads[i]) return pads[i];
    }
    return null;
}

// ---------------------------------------------------------------------------
// WebSocket helpers (mirrors Kotlin logic)
// ---------------------------------------------------------------------------

function sendJsonOverWs(map: Record<string, unknown>): void {
    if (wsState !== "connected" || !ws) return;
    try {
        ws.send(JSON.stringify(map));
    } catch { /* ignore */ }
}

function attemptReconnect(): void {
    if (!wsLastIp || !wsLastPort) return;
    const delay = Math.min(1000 * Math.pow(2, wsRetry), 32000);
    wsRetry++;
    if (wsRetryTimer) clearTimeout(wsRetryTimer);
    wsRetryTimer = setTimeout(() => connectWebSocket(wsLastIp!, wsLastPort!), delay);
}

function connectWebSocket(ip: string, port: number): void {
    wsLastIp   = ip;
    wsLastPort = port;

    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }

    wsState = "connecting";
    emit("websocketStatus", { status: "connecting" });

    const url = `ws://${ip}:${port}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
        wsRetry  = 0;
        wsState  = "connected";
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
        if (ev.code !== 1000) attemptReconnect();
    };
}

function disconnectWebSocket(): void {
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    ws?.close(1000, "Manual disconnect");
    ws = null;
    wsLastIp   = null;
    wsLastPort = null;
}

// ---------------------------------------------------------------------------
// Label payload builder (mirrors Kotlin buildLabelPayloads)
// ---------------------------------------------------------------------------

function buildLabelPayloads(delta?: number): Array<[string, Record<string, unknown>]> {
    const result: Array<[string, Record<string, unknown>]> = [];

    for (const [label, eventName] of Object.entries(labelEventNames)) {
        const axes = ANALOG_INPUTS[label];
        if (!axes) continue;
        const isSingle = axes.length === 1;

        const axisIndex0 = getAxisIndexForName(axes[0]);
        const axisIndex1 = isSingle ? -1 : getAxisIndexForName(axes[1]);

        const x = applyInversion(axisIndex0, lastAxisValues[axes[0]] ?? 0);
        const y = isSingle ? 0 : applyInversion(axisIndex1, lastAxisValues[axes[1]] ?? 0);
        const prevX = previousAxisValues[axes[0]] ?? 0;
        const prevY = isSingle ? 0 : (previousAxisValues[axes[1]] ?? 0);

        const xActive = Math.abs(x) >= DEFAULT_DEADZONE || Math.abs(prevX) >= DEFAULT_DEADZONE;
        const yActive = !isSingle && (Math.abs(y) >= DEFAULT_DEADZONE || Math.abs(prevY) >= DEFAULT_DEADZONE);
        if (!xActive && !yActive) continue;

        const payload: Record<string, unknown> = {};

        // Collect per-axis modifiers
        const mods: Record<string, unknown> = {};
        for (const axName of axes) {
            const idx = getAxisIndexForName(axName);
            if (axisModifiers[idx]) mods[axName] = axisModifiers[idx];
        }
        if (Object.keys(mods).length) payload["modifiers"] = mods;

        if (isSingle) {
            payload["value"] = x;
        } else {
            payload["x"] = x;
            payload["y"] = y;
        }
        if (delta !== undefined) payload["delta"] = delta;

        result.push([eventName, payload]);
    }
    return result;
}

function sendLabelPayloads(delta?: number): void {
    for (const [eventName, payload] of buildLabelPayloads(delta)) {
        sendJsonOverWs({ method: eventName, data: payload });
    }
}

// Reverse lookup: axis name → axis index (best-effort)
function getAxisIndexForName(axisName: string): number {
    for (const [idx, name] of Object.entries(AXIS_INDEX_TO_NAME)) {
        if (name === axisName) return Number(idx);
    }
    // Triggers
    if (axisName === "AXIS_RX") return 100; // sentinel for left trigger
    if (axisName === "AXIS_RY") return 101; // sentinel for right trigger
    return -1;
}

// ---------------------------------------------------------------------------
// Polling loop – reads gamepad state and fires events
// ---------------------------------------------------------------------------

function pollGamepad(now: number): void {
    if(hasGamepad) rafId = requestAnimationFrame(pollGamepad); // poll as long as gamepad is connected

    if (now - lastPollTime < POLL_INTERVAL_MS) return;
    const delta = Math.round(now - lastPollTime);
    lastPollTime = now;

    const pad = getGamepad();
    if (!pad) {
        stopPolling();
        return;
    }

    // ---- Axes ----
    // Standard mapping: axes[0..3] = LX, LY, RX, RY
    const axisMotionMap: Array<{ name: string; axisIndex: number; value: number }> = [];

    for (let i = 0; i < pad.axes.length && i <= 3; i++) {
        const name = AXIS_INDEX_TO_NAME[i];
        if (!name) continue;
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
    const motionPayload: Record<string, unknown> = { action: "ACTION_MOVE", modifiers: {} };
    const activeModifiers: Record<string, unknown> = {};

    for (const { name, axisIndex, value } of axisMotionMap) {
        previousAxisValues[name] = lastAxisValues[name] ?? 0;
        const inverted = applyInversion(axisIndex, value);
        lastAxisValues[name] = inverted;
        motionPayload[name] = inverted;

        const dz = deadzone(name);
        if (Math.abs(inverted) > dz || Math.abs(previousAxisValues[name]) > dz) {
            anyAxisActive = true;
        }
        if (axisModifiers[axisIndex]) activeModifiers[name] = axisModifiers[axisIndex];
    }
    motionPayload["modifiers"] = activeModifiers;

    if(anyAxisActive) {
        // Emit onJoyStick (same shape as Kotlin's raw event)
        emit("onJoyStick", motionPayload);

        // Send label payloads over WebSocket
        sendLabelPayloads(delta);
    }

    // ---- Buttons ----
    for (let i = 0; i < pad.buttons.length; i++) {
        const keyCode = BUTTON_INDEX_TO_KEYCODE[i];
        if (keyCode === undefined) continue;

        const pressed  = pad.buttons[i].pressed;
        const wasDown  = currentButtonStates[keyCode] ?? false;

        if (pressed === wasDown) continue; // no change

        currentButtonStates[keyCode] = pressed;
        const action   = pressed ? "ACTION_DOWN" : "ACTION_UP";
        const keyName  = KEYCODE_TO_NAME[keyCode] ?? `KEYCODE_${keyCode}`;
        const modifiers = buttonModifiers[keyCode] ?? {};

        const btnPayload: KeyEventPayload = { action, keyCode, keyName, modifiers };
        emit("onButtonPress", btnPayload);

        if (sendOverWsEnabled[keyCode] !== false) {
            const eventName = buttonEventNames[keyCode];
            if (eventName) {
                const data: Record<string, unknown> = { pressed };
                if (Object.keys(modifiers).length) data["modifiers"] = modifiers;
                sendJsonOverWs({ method: eventName, data });
            } else {
                sendJsonOverWs({ method: "onButtonPress", data: btnPayload });
            }
        }
    }
}

function startPolling(): void {
    if (rafId !== null) return;
    hasGamepad = true;
    lastPollTime = performance.now();
    rafId = requestAnimationFrame(pollGamepad);
}

function stopPolling(): void {
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
        } else if (++startupChecks > 20) { // give up after ~2s
            clearInterval(startupInterval);
        }
    }, 500);

    window.addEventListener("gamepadconnected", (e) => {
        console.log("Gamepad connected?: ", e.gamepad.id)
        startPolling();
        clearInterval(startupInterval);
    });

    window.addEventListener("gamepaddisconnected", () => {
        console.log('gamepad disconnected');
        if (!getGamepad()) stopPolling();
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
    addListener(eventName: string, listener: Listener<unknown>): { remove: () => void } {
        if (!listeners[eventName]) listeners[eventName] = new Set();
        listeners[eventName].add(listener);
        return { remove: () => listeners[eventName].delete(listener) };
    },
    removeAllListeners(eventName: string): void {
        listeners[eventName]?.clear();
    },

    // ---- Module functions ----
    connectWebSocket(ip: string, port: number): void {
        connectWebSocket(ip, port);
    },
    disconnectWebSocket(): void {
        disconnectWebSocket();
    },
    getWebSocketStatus(): string {
        return wsState;
    },
    getDeviceName(): string {
        const pad = getGamepad();
        return pad?.id ?? "";
    },
    getGamepadConfiguration(): unknown[] {
        const pad = getGamepad();
        if (!pad) return [];

        const axes: any = [];
        for (let i = 0; i < pad.axes.length; i++) {
            const name = AXIS_INDEX_TO_NAME[i] ?? `AXIS_${i}`;
            axes.push({
                axis:     i,
                name,
                min:     -1,
                max:      1,
                flat:     DEFAULT_DEADZONE,
                source:   ["JOYSTICK"],
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
            deviceId:   pad.index,
            deviceName: pad.id,
            sources:    ["GAMEPAD", "JOYSTICK"],
            axes,
            buttons,
        }];
    },
    getGamepadState(): unknown[] {
        const pad = getGamepad();
        if (!pad) return [];

        const axesState: Record<string, number> = {};
        for (const [name, val] of Object.entries(lastAxisValues)) {
            axesState[name] = val;
        }

        const buttonsState: Record<string, boolean> = {};
        for (const [keyCode, name] of Object.entries(KEYCODE_TO_NAME)) {
            buttonsState[name] = currentButtonStates[Number(keyCode)] ?? false;
        }

        return [{
            deviceId:   pad.index,
            deviceName: pad.id,
            axes:       axesState,
            buttons:    buttonsState,
        }];
    },
    sendButtonPressOverWebSocket(keyCode: number, enabled: boolean): void {
        sendOverWsEnabled[keyCode] = enabled;
    },
    setButtonModifiers(keyCode: number, modifiers: Record<string, unknown>): void {
        buttonModifiers[keyCode] = { ...modifiers };
    },
    setAxisModifiers(motionEvent: number, modifiers: Record<string, unknown>): void {
        axisModifiers[motionEvent] = { ...modifiers };
    },
    updateAxisModifiers(motionEvent: number, modifiers: Record<string, unknown>): void {
        axisModifiers[motionEvent] = { ...(axisModifiers[motionEvent] ?? {}), ...modifiers };
    },
    setButtonEventName(keyCode: number, eventName: string): void {
        buttonEventNames[keyCode] = eventName;
    },
    setAnalogInputEventName(label: string, eventName: string): void {
        if (!ANALOG_INPUTS[label]) throw new Error(`Unknown analog input label: '${label}'. Must be one of: ${Object.keys(ANALOG_INPUTS).join(", ")}`);
        labelEventNames[label] = eventName;
        // Start polling if a gamepad is already connected
        if (getGamepad()) startPolling();
    },
    setAxisDeadzone(motionEvent: number, deadZone: number): void {
        const name = AXIS_INDEX_TO_NAME[motionEvent] ?? `AXIS_${motionEvent}`;
        deadzoneOverrides[name] = deadZone;
    },
    setAxisInverted(motionEvent: number, inverted: boolean): void {
        axisInversions[motionEvent] = inverted;
    },
};

export default ExpoJoystickWebModule;