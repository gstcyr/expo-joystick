import { AnalogInput, KeyEvent, MotionEvent } from "./ExpoJoystick.constants";
export declare type MotionEventPayload2 = {
    action: string;
    AXIS_HAT_X: number;
    AXIS_HAT_Y: number;
    AXIS_RX: number;
    AXIS_RY: number;
    AXIS_RZ: number;
    AXIS_X: number;
    AXIS_Y: number;
    AXIS_Z: number;
};
export declare type MotionEventPayload = {
    LEFT: number[];
    RIGHT: number[];
    TRIGGER_L: number;
    TRIGGER_R: number;
    DPAD: number[];
};
export declare type KeyEventPayload = {
    action: string;
    keyCode: number;
    keyName: string;
};
export declare type MotionEventLabel = typeof MotionEvent[keyof typeof MotionEvent];
export declare type AnalogInputLabel = typeof AnalogInput[keyof typeof AnalogInput];
export declare type KeyEventLabel = typeof KeyEvent[keyof typeof KeyEvent];
//# sourceMappingURL=ExpoJoystick.types.d.ts.map