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
    // Each module class must implement the definition function. The definition consists of components
    // that describes the module's functionality and behavior.
    // See https://docs.expo.dev/modules/module-api for more details about available components.

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
                "ACTION_MOVE" to MotionEvent.ACTION_MOVE
            ),
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
        }

        OnDestroy {
            // Clean up listeners when the module is destroyed
            appContext.currentActivity?.let { activity ->
                unregisterInputListeners(activity)
            }
        }

        Function("connectWebSocket") { ip: String, port: Int ->
            connectWebSocket(ip, port)
        }
        Function("disconnectWebSocket") {
            disconnectWebSocket()
        }
        Function("sendButtonPressOverWebSocket") { keyCode: Int, send: Boolean ->
            sendOverWsEnabled[keyCode] = send;
        }
        Function("setButtonModifiers") { keyCode: Int, modifiers: Map<String, Any> ->
            buttonModifiers[keyCode] = modifiers.toMutableMap();
        }
        Function("setAxisModifiers") { motionEvent: Int, modifiers: Map<String, Any> ->
            axisModifiers[motionEvent] = modifiers.toMutableMap();
        }
        Function("setAxisDeadzone") { motionEvent: Int, deadZone: Float ->
            val axisName = getAxisName(motionEvent)
            deadzoneOverrides[axisName] = deadZone;
        }
        Function("getWebSocketStatus") {
            socketState.name.lowercase()
        }
    }

    private var lastJoystickDevice: InputDevice? = null
    private var lastSentPayload: MutableMap<String, Any?>? = null
    // Tracks previous value for each AXIS_* to suppress unchanged or zero-state repeats
    private val lastAxisValues = mutableMapOf<String, Float>()

    // Optional per-axis deadzone overrides (default = 0.01f)
    private val deadzoneOverrides = mutableMapOf<String, Float>()

    // Default deadzone fallback
    private val defaultDeadzone = 0.01f

    private var lastSent: Long = System.currentTimeMillis()
    private val pollThread = HandlerThread("JoystickPoller").apply {start() } //Handler(Looper.getMainLooper())
    private val handler = Handler(pollThread.looper)
    private var isPolling = false
    private val pollIntervalMs = 16L  // 62.5 FPS

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

    private val validKeyCodes = listOf(
        KeyEvent.KEYCODE_F1, KeyEvent.KEYCODE_F2, KeyEvent.KEYCODE_F3, KeyEvent.KEYCODE_F4,
        KeyEvent.KEYCODE_F5, KeyEvent.KEYCODE_F6, KeyEvent.KEYCODE_F7, KeyEvent.KEYCODE_F8,
        KeyEvent.KEYCODE_F9, KeyEvent.KEYCODE_F10, KeyEvent.KEYCODE_Z,
        KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_BUTTON_Z,
        KeyEvent.KEYCODE_BUTTON_R1, KeyEvent.KEYCODE_BUTTON_L1, KeyEvent.KEYCODE_BUTTON_THUMBL,
        KeyEvent.KEYCODE_BUTTON_R2, KeyEvent.KEYCODE_BUTTON_L2, KeyEvent.KEYCODE_BACK
    )

    private val sendOverWsEnabled: MutableMap<Int, Boolean> = validKeyCodes.associateWith { true }.toMutableMap()
    private val buttonModifiers: MutableMap<Int, MutableMap<String, Any>> = mutableMapOf()
    private val axisModifiers: MutableMap<Int, MutableMap<String, Any>> = mutableMapOf()


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
            val payload = lastSentPayload ?: return

            val now = System.currentTimeMillis()
            val delta = now - lastSent

            payload.put("delta", delta)

            sendJsonOverWebSocket(mapOf(
                "method" to "onJoystick",
                "data" to payload
            ))

            lastSent = System.currentTimeMillis()
            val nonZero = payload.filterValues { it is Float }.values.any { (it as Float).absoluteValue >= 0.01f }
            if (!nonZero) {
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

                val axisValuesToSend = mutableMapOf<String, Float>()
                val axisModifiersToSend = mutableMapOf<String, Map<String, Any>>()

                for (range in event.device.motionRanges) {
                    if (!range.isFromSource(InputDevice.SOURCE_JOYSTICK)) continue
                    val axisCode = range.axis
                    val axisName = getAxisName(axisCode)

                    val currentValue = event.getAxisValue(axisCode)
                    val previousValue = lastAxisValues[axisName]

                    if (shouldIncludeAxis(axisName, currentValue, previousValue)) {
                        axisValuesToSend[axisName] = currentValue
                        axisModifiers[axisCode]?.let { props ->
                            axisModifiersToSend[axisName] = props
                        }
                    }
                    lastAxisValues[axisName] = currentValue
                }

                val params = mutableMapOf<String, Any?>(
                    "action" to getIntConstantName(MotionEvent::class.java, event.action),
                    "modifiers" to axisModifiersToSend,
                )
                params.putAll(axisValuesToSend);

                lastSentPayload = HashMap(params)
                sendEvent(
                    "onJoyStick",
                    params
                )
                if (!isPolling && params.values.any { it is Float && (it as Float).absoluteValue > defaultDeadzone}) {
                    startJoystickPolling(event.device)
                }

                true // Event handled
            } else {
                false
            }
        }
    }

    private fun startJoystickPolling(device: InputDevice) {
        if (isPolling) return
        isPolling = true
        lastSent = System.currentTimeMillis()
        lastJoystickDevice = device
        handler.post(pollRunnable)
    }

    private fun stopJoystickPolling() {
        isPolling = false
        handler.removeCallbacks(pollRunnable)
    }

    fun handleKeyEvent(event: KeyEvent): Boolean {

        if (event.source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
            event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK ||
            event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD) {

            if (event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD && !validKeyCodes.contains(event.keyCode)) {
                return false
            }
            //Log.d("expo-joystick", "handleKeyEvent: " + event)
            val params = mapOf(
                "action" to getIntConstantName(KeyEvent::class.java, event.action),
                "keyCode" to event.keyCode,
                "keyName" to getIntConstantName(KeyEvent::class.java, event.keyCode),
                "modifiers" to (buttonModifiers[event.keyCode] ?: emptyMap<String, Any>())
            )
            sendEvent(
                "onButtonPress",
                params
            )
            if(sendOverWsEnabled[event.keyCode] == true) {
                sendJsonOverWebSocket(
                    mapOf(
                        "method" to "onButtonPress",
                        "data" to params
                    )
                )
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
