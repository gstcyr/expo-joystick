export const MotionEvent = {
  AXIS_HAT_X: 15,
  AXIS_HAT_Y: 16,
  AXIS_X: 0,
  AXIS_Y: 1,
  AXIS_Z: 11,
  AXIS_RZ: 14,
  AXIS_RX: 12,
  AXIS_RY: 13,
  AXIS_SCROLL: 8,
  ACTION_MOVE: 2,
} as const;

export const KeyEvent = {
  BUTTON_A: 96,
  BUTTON_B: 97,
  BUTTON_L1: 102,
  BUTTON_L2: 104,
  BUTTON_THUMBL: 106,
  BUTTON_R1: 103,
  BUTTON_R2: 105,
  ACTION_UP: 1,
  ACTION_DOWN: 0,
} as const;

export const WebSocketStatus = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    ERROR: 'error'
}