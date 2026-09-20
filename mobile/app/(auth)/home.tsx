import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text variant="headlineSmall">Valent App</Text>
      <Text variant="bodyMedium">Vinculación de dispositivo — próximamente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
