# Changelog

## Version 1.0.10

### 🎉 New features
- Added web support for joystick/gamepad input using the Web Gamepad API
- Added raw joystick event subscription via `onJoyStickRaw`
- Added gamepad/device state helpers:
    - `getDeviceName`
    - `getGamepadConfiguration`
    - `getGamepadState`
- Added `AnalogInput` constants
- Added support for configuring button event names with `setButtonEventName`
- Added support for configuring analog input event names with `setAnalogInputEventName`
- Added support for axis inversion with `setAxisInverted`
- Added `updateAxisModifiers` function
- Added `updateButtonModifiers` function

### 🐛 Bug fixes
- Always send zeroed payload when polling stops
- Improved type safety for key events, motion events, and analog input labels

### 💡 Others
- Updated generated build files
- Updated package lockfile****

## Version 1.0.9

### 🛠 Breaking changes

### 🎉 New features 

### 🐛 Bug fixes
- Always send zeroed payload went polling stops

### 💡 Others
