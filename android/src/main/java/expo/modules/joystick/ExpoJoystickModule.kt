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
import android.os.Looper
import okhttp3.*
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.*
import kotlin.math.absoluteValue
import java.util.Timer
import java.util.TimerTask


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
        Events("onButtonPress", "onJoyStick")

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
                setupInputManager(it)
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

    }
    //    private var activity: Activity? = null

    private var lastJoystickDevice: InputDevice? = null
    private var lastSentPayload: Map<String, Any?>? = null

    private val handler = Handler(Looper.getMainLooper())
    private var isPolling = false
    private val pollIntervalMs = 40L  // 25 FPS

    // --- WebSocket Support ---
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient()
    private var wsRetryTimer: Timer? = null
    private var retryAttempts = 0
    private var lastIp: String? = null
    private var lastPort: Int? = null

    private var inputManager: InputManager? = null
    private var originalCallback: android.view.Window.Callback? = null

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

            //sendEvent("onJoyStick", payload)

            sendJsonOverWebSocket(mapOf(
                    "method" to "onJoystick",
                    "data" to payload
            ))

            val nonZero = payload.filterValues { it is Float }.values.any { (it as Float).absoluteValue >= 0.01f }
            if (!nonZero) {
                stopJoystickPolling()
            } else {
                handler.postDelayed(this, pollIntervalMs)
            }
        }
    }

    private fun setupInputManager(activity: Activity) {
        inputManager = activity.getSystemService(Activity.INPUT_SERVICE) as InputManager
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
            Log.d("expo-joystick", "sendJoystickEvent: " + event)

            if (event != null && event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK) {
                val params = mapOf(
                    "action" to getIntConstantName(MotionEvent::class.java, event.action),
                    "AXIS_X" to event.getAxisValue(MotionEvent.AXIS_X),
                    "AXIS_Y" to event.getAxisValue(MotionEvent.AXIS_Y),
                    "AXIS_Z" to event.getAxisValue(MotionEvent.AXIS_Z),
                    "AXIS_RZ" to event.getAxisValue(MotionEvent.AXIS_RZ),
                    "AXIS_RX" to event.getAxisValue(MotionEvent.AXIS_RX), // Right Shoulder Axis
                    "AXIS_RY" to event.getAxisValue(MotionEvent.AXIS_RY), // Left Shoulder Axis
                    "AXIS_HAT_X" to event.getAxisValue(MotionEvent.AXIS_HAT_X),
                    "AXIS_HAT_Y" to event.getAxisValue(MotionEvent.AXIS_HAT_Y)
                )

                lastSentPayload = params

                sendEvent(
                    "onJoyStick",
                    params
                )
                sendJsonOverWebSocket(mapOf(
                    "method" to "onJoystick",
                    "data" to params
                ))

                if (!isPolling && params.values.any { it is Float && (it as Float).absoluteValue > 0.01f }) {
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
        lastJoystickDevice = device
        handler.post(pollRunnable)
    }

    private fun stopJoystickPolling() {
        isPolling = false
        handler.removeCallbacks(pollRunnable)
    }

    fun handleKeyEvent(event: KeyEvent): Boolean {
        val validKeyCodes = listOf(
                KeyEvent.KEYCODE_F1, KeyEvent.KEYCODE_F2, KeyEvent.KEYCODE_F3, KeyEvent.KEYCODE_F4,
                KeyEvent.KEYCODE_F5, KeyEvent.KEYCODE_F6, KeyEvent.KEYCODE_F7, KeyEvent.KEYCODE_F8,
                KeyEvent.KEYCODE_F9, KeyEvent.KEYCODE_F10, KeyEvent.KEYCODE_Z,
                KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_BUTTON_Z,
                KeyEvent.KEYCODE_BUTTON_R1, KeyEvent.KEYCODE_BUTTON_L1, KeyEvent.KEYCODE_BUTTON_THUMBL,
                KeyEvent.KEYCODE_BUTTON_R2, KeyEvent.KEYCODE_BUTTON_L2, KeyEvent.KEYCODE_BACK
        )

        if (event.source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
                event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK ||
                event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD) {

            if (event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD && !validKeyCodes.contains(event.keyCode)) {
                return false
            }
            Log.d("expo-joystick", "handleKeyEvent: " + event)
            val params = mapOf(
                "action" to getIntConstantName(KeyEvent::class.java, event.action),
                "keyCode" to event.keyCode,
                "keyName" to getIntConstantName(KeyEvent::class.java, event.keyCode)
            )
            sendEvent(
                "onButtonPress",
                params
            )
            sendJsonOverWebSocket(mapOf(
                "method" to "onButtonPress",
                "data" to params
            ))
            return true
        }
        return false
    }

    private fun connectWebSocket(ip: String, port: Int) {
        lastIp = ip
        lastPort = port

        val url = "ws://$ip:$port"
        val request = Request.Builder().url(url).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.d("expo-joystick", "WebSocket connected to $url")
                retryAttempts = 0
                wsRetryTimer?.cancel()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e("expo-joystick", "WebSocket error: ${t.message}")
                attemptReconnect()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.w("expo-joystick", "⚠WebSocket closed: $reason")
                attemptReconnect()
            }
        })
    }

    private fun attemptReconnect() {
        if (lastIp != null && lastPort != null) {
            val delay = (1000L * Math.pow(2.0, retryAttempts.coerceAtMost(5).toDouble())).toLong()
            retryAttempts++
            wsRetryTimer?.cancel()
            wsRetryTimer = Timer()
            wsRetryTimer?.schedule(object : TimerTask() {
                override fun run() {
                    connectWebSocket(lastIp!!, lastPort!!)
                }
            }, delay)
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
        wsRetryTimer?.cancel()
        webSocket?.close(1000, "Manual disconnect")
        webSocket = null
    }

    private fun unregisterInputListeners(activity: Activity) {
        activity.window?.decorView?.setOnKeyListener(null)
        activity.window?.decorView?.setOnGenericMotionListener(null)

        if (activity != null && originalCallback != null) {
            activity.window.callback = originalCallback
        }
        //activity = null
    }

    private fun getCenteredAxis(
            event: MotionEvent,
            device: InputDevice,
            axis: Int,
            historyPos: Int
    ): Float {
        val range: InputDevice.MotionRange? = device.getMotionRange(axis, event.source)

        // A joystick at rest does not always report an absolute position of
        // (0,0). Use the getFlat() method to determine the range of values
        // bounding the joystick axis center.
        range?.apply {
            val value: Float = if (historyPos < 0) {
                event.getAxisValue(axis)
            } else {
                event.getHistoricalAxisValue(axis, historyPos)
            }

            // Ignore axis values that are within the 'flat' region of the
            // joystick axis center.
            if (Math.abs(value) > flat) {
                return value
            }
        }
        return 0f
    }

    private fun processJoystickInput(event: MotionEvent, historyPos: Int) {

        val inputDevice = event.device

        // Calculate the horizontal distance to move by
        // using the input value from one of these physical controls:
        // the left control stick, hat axis, or the right control stick.
        var x: Float = getCenteredAxis(event, inputDevice, MotionEvent.AXIS_X, historyPos)
        if (x == 0f) {
            x = getCenteredAxis(event, inputDevice, MotionEvent.AXIS_HAT_X, historyPos)
        }
        if (x == 0f) {
            x = getCenteredAxis(event, inputDevice, MotionEvent.AXIS_Z, historyPos)
        }

        // Calculate the vertical distance to move by
        // using the input value from one of these physical controls:
        // the left control stick, hat switch, or the right control stick.
        var y: Float = getCenteredAxis(event, inputDevice, MotionEvent.AXIS_Y, historyPos)
        if (y == 0f) {
            y = getCenteredAxis(event, inputDevice, MotionEvent.AXIS_HAT_Y, historyPos)
        }
        if (y == 0f) {
            y = getCenteredAxis(event, inputDevice, MotionEvent.AXIS_RZ, historyPos)
        }

        // Update the ship object based on the new x and y values
    }

}
