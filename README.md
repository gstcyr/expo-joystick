# expo-joystick

HID Joystick support for React-Native Android

### Usage:

```javascript
import {onJoyStick, onButtonPress} from "expo-joystick";

onJoyStick((data) => {
    console.log(data);
    // LEFT, RIGHT, DPAD, TRIGGER_L, TRIGGER_R, 
})

onButtonPress((event) => {
    console.log(event);
})
```


### Build
If making changes to any `.ts` files, run `tsc` in console to recompile build folder




### Notes:
We need to include the `./build` directory since the `expo-module prepare` command is broken on Windows, and thus
when someone `yarn install`'s this repository, it doesn't build properly. 