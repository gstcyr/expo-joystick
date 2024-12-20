import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
const NativeView = requireNativeViewManager('ExpoJoystick');
export default function ExpoJoystickView(props) {
    return <NativeView {...props}/>;
}
//# sourceMappingURL=ExpoJoystickView.js.map