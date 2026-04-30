package expo.modules.joystick

import android.app.Activity
import android.hardware.input.InputManager
import android.view.InputDevice
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.util.Log
import android.view.InputEvent
import android.view.MotionEvent
import android.view.KeyEvent
import java.lang.reflect.Modifier
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import okhttp3.*
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.*
import kotlin.math.absoluteValue


class ExpoJoystickModule : Module() {

    private val GAMEPAD_KEYS = listOf(
        KeyEvent.KEYCODE_BUTTON_A,
        KeyEvent.KEYCODE_BUTTON_B,
        KeyEvent.KEYCODE_BUTTON_X,
        KeyEvent.KEYCODE_BUTTON_Y,

        KeyEvent.KEYCODE_BUTTON_L1,
        KeyEvent.KEYCODE_BUTTON_R1,
        KeyEvent.KEYCODE_BUTTON_L2,
        KeyEvent.KEYCODE_BUTTON_R2,

        KeyEvent.KEYCODE_BUTTON_THUMBL,
        KeyEvent.KEYCODE_BUTTON_THUMBR,

        KeyEvent.KEYCODE_BUTTON_START,
        KeyEvent.KEYCODE_BUTTON_SELECT,
        KeyEvent.KEYCODE_BUTTON_MODE,

        KeyEvent.KEYCODE_DPAD_UP,
        KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT,
        KeyEvent.KEYCODE_DPAD_RIGHT
    )

    private val SOURCE_NAMES = mapOf(
        InputDevice.SOURCE_KEYBOARD to "KEYBOARD",
        InputDevice.SOURCE_DPAD to "DPAD",
        InputDevice.SOURCE_GAMEPAD to "GAMEPAD",
        InputDevice.SOURCE_JOYSTICK to "JOYSTICK",
        InputDevice.SOURCE_MOUSE to "MOUSE",
        InputDevice.SOURCE_TOUCHSCREEN to "TOUCHSCREEN",
        InputDevice.SOURCE_TOUCHPAD to "TOUCHPAD",
        InputDevice.SOURCE_TRACKBALL to "TRACKBALL",
        InputDevice.SOURCE_STYLUS to "STYLUS",
        InputDevice.SOURCE_ROTARY_ENCODER to "ROTARY_ENCODER"
    )

    // Add this to your class properties
    private val currentButtonStates = mutableMapOf<Int, Boolean>()

    private fun deviceHasKey(device: InputDevice, keyCode: Int): Boolean {
        // device.hasKeys returns an array of booleans in the same order
        return device.hasKeys(keyCode).firstOrNull() == true
    }

    private fun decodeSources(sources: Int): List<String> {
        return SOURCE_NAMES
            .filter { (mask, _) ->
                (sources and mask) == mask
            }
            .map { it.value }
    }

    // TODO: Calibration setters, these can't be static
    private val ANALOG_INPUTS = mapOf(
        "LEFT_STICK"    to listOf(MotionEvent.AXIS_X,     MotionEvent.AXIS_Y),
        "RIGHT_STICK"   to listOf(MotionEvent.AXIS_Z,     MotionEvent.AXIS_RZ),
            // CAN ALSO BE (listOf(MotionEvent.AXIS_RX, MotionEvent.AXIS_RY)
        "DPAD"          to listOf(MotionEvent.AXIS_HAT_X, MotionEvent.AXIS_HAT_Y),
        "LEFT_TRIGGER"  to listOf(MotionEvent.AXIS_RX),   // single-axis, still a list for uniform handling
        "RIGHT_TRIGGER" to listOf(MotionEvent.AXIS_RY),
    )

    private val axisToLabel: Map<Int, String> = ANALOG_INPUTS
        .flatMap { (label, axes) -> axes.map { it to label } }
        .toMap()

    private val axisAliases = mapOf(
        MotionEvent.AXIS_GAS   to MotionEvent.AXIS_RTRIGGER,  // R2
        MotionEvent.AXIS_BRAKE to MotionEvent.AXIS_LTRIGGER,
        MotionEvent.AXIS_RX    to MotionEvent.AXIS_LTRIGGER,   // sometimes RX is right joystick
        MotionEvent.AXIS_RY    to MotionEvent.AXIS_RTRIGGER,   // sometimes RY is right joystick 
    )

    private fun normalizeAxis(axis: Int): Int = axisAliases[axis] ?: axis


    // Maps a label (e.g. "LEFT_STICK") to an event name (e.g. "pan")
    private val labelEventNames = mutableMapOf<String, String>()

    override fun definition() = ModuleDefinition {
        // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
        // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
        // The module will be accessible from `requireNativeModule('ExpoJoystick')` in JavaScript.
        Name("ExpoJoystick")

        // Defines event names that the module can send to JavaScript.
        Events("onButtonPress", "onJoyStick", "websocketStatus")

        Constants(
            "MotionEvent" to mapOf(
                "AXIS_HAT_X" to MotionEvent.AXIS_HAT_X,
                "AXIS_HAT_Y" to MotionEvent.AXIS_HAT_Y,
                "AXIS_X" to MotionEvent.AXIS_X,
                "AXIS_Y" to MotionEvent.AXIS_Y,
                "AXIS_Z" to MotionEvent.AXIS_Z,
                "AXIS_RZ" to MotionEvent.AXIS_RZ,
                "AXIS_RX" to MotionEvent.AXIS_RX, // LTRIGGER
                "AXIS_RY" to MotionEvent.AXIS_RY, // RTRIGGER
                "AXIS_SCROLL" to MotionEvent.AXIS_SCROLL,
                "ACTION_MOVE" to MotionEvent.ACTION_MOVE,
            ),
            "AnalogInput" to ANALOG_INPUTS.mapValues { (_, axes) ->
                if (axes.size == 1) axes.first() else axes  // single-axis inputs expose an Int, pairs expose a List
            },
            "KeyEvent" to mapOf(
                "KEYCODE_BUTTON_A" to KeyEvent.KEYCODE_BUTTON_A,
                "KEYCODE_BUTTON_B" to KeyEvent.KEYCODE_BUTTON_B,
                "KEYCODE_BUTTON_L1" to KeyEvent.KEYCODE_BUTTON_L1,
                "KEYCODE_BUTTON_L2" to KeyEvent.KEYCODE_BUTTON_L2,
                "KEYCODE_BUTTON_THUMBL" to KeyEvent.KEYCODE_BUTTON_THUMBL,
                "KEYCODE_BUTTON_R1" to KeyEvent.KEYCODE_BUTTON_R1,
                "KEYCODE_BUTTON_R2" to KeyEvent.KEYCODE_BUTTON_R2,
                "ACTION_UP" to KeyEvent.ACTION_UP,
                "ACTION_DOWN" to KeyEvent.ACTION_DOWN
            ),
        )

        // Register listeners when the module is initialized
        // Hook into the module lifecycle
        OnCreate {
            // Get the current activity and register listeners
            appContext.currentActivity?.let {
                registerInputListeners(it)
            }
            reactReady = true
        }

        OnDestroy {
            // Clean up listeners when the module is destroyed
            reactReady = false
            lastAxisValues.clear()
            previousAxisValues.clear()
            stopJoystickPolling()
            disconnectWebSocket()
            appContext.currentActivity?.let { activity ->
                unregisterInputListeners(activity)
            }
        }

        OnStartObserving("onButtonPress") {
            reactReady = true
        }

        Function("connectWebSocket") { ip: String, port: Int ->
            connectWebSocket(ip, port)
        }
        Function("disconnectWebSocket") {
            disconnectWebSocket()
        }
        Function("getDeviceName") { ->
            InputDevice.getDeviceIds().toList()
                .mapNotNull { id -> InputDevice.getDevice(id) }
                .firstOrNull { device ->
                    (device.sources and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
                            (device.sources and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                }?.name ?: ""
        }
        Function("getGamepadConfiguration") {
            val devicesOut = mutableListOf<Map<String, Any>>()

            for (id in InputDevice.getDeviceIds()) {
                val device = InputDevice.getDevice(id) ?: continue

                val isController =
                    (device.sources and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
                            (device.sources and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD

                if (!isController) continue

                // ---- Axes ----
                val axes = device.motionRanges
                    .filter { range ->
                        (range.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
                    }
                    .map { range ->
                        val normalizedAxis = normalizeAxis(range.axis)
                        mapOf(
                            "axis" to normalizedAxis,
                            "name" to getAxisName(normalizedAxis),
                            "min" to range.min,
                            "max" to range.max,
                            "flat" to range.flat,
                            "source" to decodeSources(range.source),
                            "inverted" to (axisInversions[normalizedAxis] == true)
                        )
                    }

                // ---- Buttons ----
                val buttons = GAMEPAD_KEYS
                    .filter { deviceHasKey(device, it) }
                    .map { keyCode ->
                        mapOf(
                            "keyCode" to keyCode,
                            "name" to KeyEvent.keyCodeToString(keyCode)
                        )
                    }

                devicesOut.add(
                    mapOf(
                        "deviceId" to device.id,
                        "deviceName" to device.name,
                        "sources" to decodeSources(device.sources),
                        "axes" to axes,
                        "buttons" to buttons
                    )
                )
            }

            devicesOut
        }
        Function("getGamepadState") {
            val devicesState = mutableListOf<Map<String, Any>>()

            for (id in InputDevice.getDeviceIds()) {
                val device = InputDevice.getDevice(id) ?: continue

                // Filter for actual controllers
                val isController = (device.sources and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
                        (device.sources and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                if (!isController) continue

                // Map Axis Names to current values
                val axesState = device.motionRanges
                    .filter { (it.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK }
                    .associate { range ->
                        getAxisName(range.axis) to (lastAxisValues[getAxisName(range.axis)] ?: 0f)
                    }

                // Map Button Names to current boolean states
                val buttonsState = GAMEPAD_KEYS
                    .filter { deviceHasKey(device, it) }
                    .associate { keyCode ->
                        KeyEvent.keyCodeToString(keyCode) to (currentButtonStates[keyCode] ?: false)
                    }

                devicesState.add(mapOf(
                    "deviceId" to device.id,
                    "deviceName" to device.name,
                    "axes" to axesState,
                    "buttons" to buttonsState
                ))
            }
            devicesState
        }
        Function("sendButtonPressOverWebSocket") { keyCode: Int, send: Boolean ->
            sendOverWsEnabled[keyCode] = send;
        }
        Function("setButtonModifiers") { keyCode: Int, modifiers: Map<String, Any> ->
            buttonModifiers[keyCode] = modifiers.toMutableMap();
        }
        Function("updateButtonModifiers") { keyCode: Int, modifiers: Map<String, Any> ->
            val existing = buttonModifiers.getOrPut(keyCode) { mutableMapOf() }
            existing.putAll(modifiers)
        }
        Function("setAxisModifiers") { motionEvent: Int, modifiers: Map<String, Any> ->
            axisModifiers[motionEvent] = modifiers.toMutableMap();
        }
        Function("updateAxisModifiers") { motionEvent: Int, modifiers: Map<String, Any> ->
            val existing = axisModifiers.getOrPut(motionEvent) { mutableMapOf() }
            existing.putAll(modifiers)
        }
        Function("setButtonEventName") { keyCode: Int, eventName: String ->
            buttonEventName[keyCode] = eventName;
        }
        Function("setAnalogInputEventName") { label: String, eventName: String ->
            require(ANALOG_INPUTS.containsKey(label)) { "Unknown analog input label: '$label'. Must be one of: ${ANALOG_INPUTS.keys.joinToString()}" }
            labelEventNames[label] = eventName
        }
        Function("setAxisDeadzone") { motionEvent: Int, deadZone: Float ->
            val axisName = getAxisName(motionEvent)
            deadzoneOverrides[axisName] = deadZone;

            //resendCurrentJoystickState()
        }
        Function("setAxisInverted") { motionEvent: Int, inverted: Boolean ->
            axisInversions[motionEvent] = inverted
        }
        Function("getWebSocketStatus") {
            socketState.name.lowercase()
        }
    }

    private var reactReady = false
    // Tracks previous value for each AXIS_* to suppress unchanged or zero-state repeats
    private val lastAxisValues = mutableMapOf<String, Float>()
    private val previousAxisValues = mutableMapOf<String, Float>()

    // Optional per-axis deadzone overrides (default = 0.01f)
    private val deadzoneOverrides = mutableMapOf<String, Float>()

    // Default deadzone fallback
    private val defaultDeadzone = 0.01f

    private var lastSent: Long = System.currentTimeMillis()
    private val pollThread = HandlerThread("JoystickPoller").apply {start() } //Handler(Looper.getMainLooper())
    private val handler = Handler(pollThread.looper)
    private var isPolling = false
    private val pollIntervalMs = 16L  // 25 FPS

    // --- WebSocket Support ---
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient()
    private var retryAttempts = 0
    private var lastIp: String? = null
    private var lastPort: Int? = null

    enum class WebSocketState {
        DISCONNECTED, CONNECTING, CONNECTED, ERROR
    }
    private var socketState = WebSocketState.DISCONNECTED

    private var inputManager: InputManager? = null
    private var originalCallback: android.view.Window.Callback? = null

    private val validKeyCodes = (listOf(
        KeyEvent.KEYCODE_F1, KeyEvent.KEYCODE_F2, KeyEvent.KEYCODE_F3, KeyEvent.KEYCODE_F4,
        KeyEvent.KEYCODE_F5, KeyEvent.KEYCODE_F6, KeyEvent.KEYCODE_F7, KeyEvent.KEYCODE_F8,
        KeyEvent.KEYCODE_F9, KeyEvent.KEYCODE_F10, KeyEvent.KEYCODE_Z,
        KeyEvent.KEYCODE_BACK
    ) + GAMEPAD_KEYS).toSet()

    private val sendOverWsEnabled: MutableMap<Int, Boolean> = validKeyCodes.associateWith { true }.toMutableMap()
    private val buttonModifiers: MutableMap<Int, MutableMap<String, Any>> = mutableMapOf()
    private val axisModifiers: MutableMap<Int, MutableMap<String, Any>> = mutableMapOf()

    private val buttonEventName: MutableMap<Int, String> = mutableMapOf()
    private val axisEventName: MutableMap<Int, String> = mutableMapOf()

    private val axisInversions = mutableMapOf<Int, Boolean>()

    fun <T> getIntConstantName(targetClass: Class<T>, value: Int): String {
        val fields = targetClass.declaredFields
        for (field in fields) {
            if (Modifier.isStatic(field.modifiers) && field.type == Int::class.javaPrimitiveType) {
                try {
                    if (field.getInt(null) == value) {
                        return field.name
                    }
                } catch (e: IllegalAccessException) {
                    // Handle cases where the field might not be accessible
                    e.printStackTrace()
                }
            }
        }
        return "UNKNOWN_CONSTANT"
    }


    private val pollRunnable = object : Runnable {
        override fun run() {
            val delta = System.currentTimeMillis() - lastSent
            sendLabelPayloads(delta)
            lastSent = System.currentTimeMillis()

            if (lastAxisValues.values.all { it.absoluteValue < defaultDeadzone }) {
                stopJoystickPolling()
            } else {
                handler.postDelayed(this, pollIntervalMs)
            }
        }
    }

    private fun shouldIncludeAxis(axisName: String, current: Float, previous: Float?): Boolean {
        val deadzone = deadzoneOverrides[axisName] ?: defaultDeadzone
        val isMoving = current.absoluteValue > deadzone
        val wasMoving = (previous?.absoluteValue ?: 0f) > deadzone

        return isMoving || wasMoving
    }

    private fun getAxisName(value: Int): String {
        return MotionEvent::class.java.fields
            .firstOrNull { field ->
                field.type == Int::class.java &&
                        field.name.startsWith("AXIS_") &&
                        field.getInt(null) == value
            }?.name ?: "AXIS_$value"
    }

    private fun sendLabelPayloads(delta: Long? = null) {
        for ((eventName, payload) in buildLabelPayloads(delta)) {
            sendJsonOverWebSocket(mapOf("method" to eventName, "data" to payload))
        }
    }

    private fun buildLabelPayloads(delta: Long? = null): List<Pair<String, Map<String, Any?>>> {
        val result = mutableListOf<Pair<String, Map<String, Any?>>>()

        for ((label, eventName) in labelEventNames) {
            val axes = ANALOG_INPUTS[label] ?: continue
            val isSingleAxis = axes.size == 1

            val x = (lastAxisValues[getAxisName(axes[0])] ?: 0f) * if (axisInversions[axes[0]] == true) -1f else 1f
            val y = if (isSingleAxis) 0f else (lastAxisValues[getAxisName(axes[1])] ?: 0f) * if (axisInversions[axes[1]] == true) -1f else 1f
            val prevX = previousAxisValues[getAxisName(axes[0])] ?: 0f
            val prevY = if (isSingleAxis) 0f else previousAxisValues[getAxisName(axes[1])] ?: 0f

            val xActive = x.absoluteValue >= defaultDeadzone || prevX.absoluteValue >= defaultDeadzone
            val yActive = !isSingleAxis && (y.absoluteValue >= defaultDeadzone || prevY.absoluteValue >= defaultDeadzone)

            if (!xActive && !yActive) continue

            val payload = mutableMapOf<String, Any?>()

            val modifiers = axes.mapNotNull { axis -> axisModifiers[axis]?.let { getAxisName(axis) to it } }.toMap()
            if (modifiers.isNotEmpty()) {
                payload["modifiers"] = modifiers
            }
            if (isSingleAxis) {
                payload["value"] = x
            } else {
                payload["x"] = x
                payload["y"] = y
            }
            delta?.let { payload["delta"] = it }
            result.add(eventName to payload)
        }

        return result
    }

    private fun registerInputListeners(activity: Activity) {

        originalCallback = activity.window.callback

        // Override the window callback to capture key events
        activity.window.callback = object : android.view.Window.Callback by originalCallback!! {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                var handled = handleKeyEvent(event)
                return if (handled) {
                    true
                } else {
                    originalCallback?.dispatchKeyEvent(event) ?: false // let the system handle it
                }
            }
        }

        activity.window.decorView.setOnGenericMotionListener { _, event ->
            if (event != null && event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK) {

                for (range in event.device.motionRanges) {
                    if (!range.isFromSource(InputDevice.SOURCE_JOYSTICK)) continue
                    val normalizedAxis = normalizeAxis(range.axis)
                    val axisName = getAxisName(normalizedAxis)
                    previousAxisValues[axisName] = lastAxisValues[axisName] ?: 0f
                    lastAxisValues[axisName] = event.getAxisValue(range.axis)

                }

                sendLabelPayloads()

                // Build per-axis modifiers for any axes that have them
                val activeModifiers = event.device.motionRanges
                    .filter { it.isFromSource(InputDevice.SOURCE_JOYSTICK) }
                    .mapNotNull { range -> axisModifiers[range.axis]?.let { getAxisName(range.axis) to it } }
                    .toMap()

                val params = mutableMapOf<String, Any?>(
                    "action" to getIntConstantName(MotionEvent::class.java, event.action),
                    "modifiers" to activeModifiers,
                )
                params.putAll(lastAxisValues)
                if(reactReady) {
                    sendEvent("onJoyStick", params)
                }

                if (!isPolling && lastAxisValues.values.any { it.absoluteValue > defaultDeadzone }) {
                    startJoystickPolling(event.device)
                }

                true
            } else {
                false
            }
        }
    }

    private fun startJoystickPolling(device: InputDevice) {
        if (isPolling) return
        isPolling = true
        lastSent = System.currentTimeMillis()
        handler.post(pollRunnable)
    }

    private fun stopJoystickPolling() {
        isPolling = false
        sendLabelPayloads(delta = 0)
        handler.removeCallbacks(pollRunnable)
    }

    fun handleKeyEvent(event: KeyEvent): Boolean {
        if (event.source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
            event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK ||
            event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD) {

            if (event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD && !validKeyCodes.contains(event.keyCode)) {
                return false
            }
            //Log.d("expo-joystick", "Key Event: ${getIntConstantName(KeyEvent::class.java, event.keyCode)}")
            // Update our internal state tracker
            currentButtonStates[event.keyCode] = event.action == KeyEvent.ACTION_DOWN

            val params = mapOf(
                "action" to getIntConstantName(KeyEvent::class.java, event.action),
                "keyCode" to event.keyCode,
                "keyName" to getIntConstantName(KeyEvent::class.java, event.keyCode),
                "modifiers" to (buttonModifiers[event.keyCode] ?: emptyMap<String, Any>())
            )
            if(reactReady) {
                sendEvent(
                    "onButtonPress",
                    params
                )
            }
            if(sendOverWsEnabled[event.keyCode] == true) {
                val eventName = buttonEventName[event.keyCode]
                if (eventName != null) {
                    val data = mutableMapOf<String, Any?>(
                        "pressed" to (event.action == KeyEvent.ACTION_DOWN)
                    )
                    val modifiers = buttonModifiers[event.keyCode]
                    if (modifiers != null) data["modifiers"] = modifiers
                    sendJsonOverWebSocket(mapOf("method" to eventName, "data" to data))
                } else {
                    // Old way
                    sendJsonOverWebSocket(mapOf("method" to "onButtonPress", "data" to params))
                }
            }
            return true
        }
        return false
    }

    private val retryRunnable = object : Runnable {
        override fun run() {
            connectWebSocket(lastIp!!, lastPort!!)
        }
    }

    private fun connectWebSocket(ip: String, port: Int) {
        lastIp = ip
        lastPort = port

        val url = "ws://$ip:$port"
        val request = Request.Builder().url(url).build()

        socketState = WebSocketState.CONNECTING
        sendEvent("websocketStatus", mapOf("status" to "connecting"))
        Log.d("expo-joystick", "Sending websocketStatus: ${socketState.name.lowercase()}")

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.d("expo-joystick", "WebSocket connected to $url")
                retryAttempts = 0
                handler.removeCallbacks(retryRunnable)
                socketState = WebSocketState.CONNECTED
                sendEvent("websocketStatus", mapOf("status" to socketState.name.lowercase()))
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e("expo-joystick", "WebSocket error: ${t.message}")
                attemptReconnect()
                socketState = WebSocketState.ERROR
                sendEvent("websocketStatus", mapOf(
                    "status" to socketState.name.lowercase(),
                    "error" to t.message
                ))

            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.w("expo-joystick", "WebSocket closed: $reason")
                if(code != 1000) {  // Only attemptReconnect if not manually disconnected
                    attemptReconnect()
                }
                socketState = WebSocketState.DISCONNECTED
                sendEvent("websocketStatus", mapOf("status" to socketState.name.lowercase()))

            }
        })
    }

    private fun attemptReconnect() {
        if (lastIp != null && lastPort != null) {
            val delay = (1000L * Math.pow(2.0, retryAttempts.coerceAtMost(5).toDouble())).toLong()
            retryAttempts++
            handler.removeCallbacks(retryRunnable)  // clear any pending retries
            handler.postDelayed(retryRunnable, delay)
            Log.d("expo-joystick", "Retrying in ${delay / 1000}s...")
        }
    }

    private fun sendJsonOverWebSocket(map: Map<String, Any?>) {
        try {
            if(socketState !== WebSocketState.CONNECTED) return;

            val json = JSONObject(map).toString()
            webSocket?.send(json)
        } catch (e: Exception) {
            Log.e("expo-joystick", "Failed to send JSON over WebSocket: ${e.message}")
        }
    }

    private fun disconnectWebSocket() {
        handler.removeCallbacks(retryRunnable)
        webSocket?.close(1000, "Manual disconnect")
        webSocket = null
    }

    private fun unregisterInputListeners(activity: Activity) {
        activity.window?.decorView?.setOnKeyListener(null)
        activity.window?.decorView?.setOnGenericMotionListener(null)

        if (originalCallback != null) {
            activity.window.callback = originalCallback
        }
        //activity = null
    }

}
