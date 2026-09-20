import { View, Text, StyleSheet } from 'react-native';

export default function TemporaryIndex() {
  return (
    <View style={styles.container}>
      <Text>Valent App</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
