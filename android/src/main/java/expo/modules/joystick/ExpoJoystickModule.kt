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
            appContext.currentActivity?.let {
                activity -> unregisterInputListeners(activity)
            }
        }

        // Required to silence NativeEventEmitter warning
        Function("addListener") { eventName: String ->
          return@Function
        }
        // Required to silence NativeEventEmitter warning
        Function("removeListeners") { count: Int ->
          return@Function
        }

    }

//    private var activity: Activity? = null

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
            Log.d("JOYSTICK", "sendJoystickEvent: " + event)

            if (event != null && event.source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK) {
                val xAxis = event.getAxisValue(MotionEvent.AXIS_X)
                val yAxis = event.getAxisValue(MotionEvent.AXIS_Y)

                val params = mapOf(
                    "action" to getIntConstantName(MotionEvent::class.java, event.action),
                    "AXIS_X" to xAxis,
                    "AXIS_Y" to yAxis,
                    "AXIS_Z" to event.getAxisValue(MotionEvent.AXIS_Z),
                    "AXIS_RZ" to event.getAxisValue(MotionEvent.AXIS_RZ),
                    "AXIS_RX" to event.getAxisValue(MotionEvent.AXIS_RX), // Right Shoulder Axis
                    "AXIS_RY" to event.getAxisValue(MotionEvent.AXIS_RY), // Left Shoulder Axis
                    "AXIS_HAT_X" to event.getAxisValue(MotionEvent.AXIS_HAT_X),
                    "AXIS_HAT_Y" to event.getAxisValue(MotionEvent.AXIS_HAT_Y)
                 )
                this@ExpoJoystickModule.sendEvent(
                    "onJoyStick",
                    params
                )

                true // Event handled
            } else {
                false
            }
        }
    }

    fun handleKeyEvent(event: KeyEvent) : Boolean {
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

            if(event.source and InputDevice.SOURCE_KEYBOARD == InputDevice.SOURCE_KEYBOARD && !validKeyCodes.contains(event.keyCode)){
                return false
            }
            Log.d("expo-joystick", "handleKeyEvent: "+event)
            val params = mapOf(
                    "action" to getIntConstantName(KeyEvent::class.java, event.action),
                    "keyCode" to event.keyCode,
                    "keyName" to getIntConstantName(KeyEvent::class.java, event.keyCode)
            )
            this@ExpoJoystickModule.sendEvent(
                "onButtonPress",
                params
            )
            return true
        }
        return false
    }

    private fun unregisterInputListeners(activity: Activity) {
        activity.window?.decorView?.setOnKeyListener(null)
        activity.window?.decorView?.setOnGenericMotionListener(null)

        if(activity != null && originalCallback != null) {
            activity.window.callback = originalCallback
        }
        //activity = null
    }

    private fun getCenteredAxis(
        event: MotionEvent,
        device: InputDevice,
        axis: Int,
        historyPos: Int
    ) : Float {
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
