import { StyleSheet, Text, View } from 'react-native';

import * as ExpoJoystick from 'expo-joystick';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>{ExpoJoystick.hello()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
