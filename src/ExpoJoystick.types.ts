export type MotionEventPayload2 = {
  action: string;
  AXIS_HAT_X: number;
  AXIS_HAT_Y: number;
  AXIS_RX: number;
  AXIS_RY: number;
  AXIS_RZ: number;
  AXIS_X: number;
  AXIS_Y: number;
  AXIS_Z: number;
}

export type MotionEventPayload = {
  LEFT: number[];
  RIGHT: number[];
  TRIGGER_L: number;
  TRIGGER_R: number;
  DPAD: number[];
}

export type KeyEventPayload = {
  action: string,
  keyCode: number;
  keyName: string;

}