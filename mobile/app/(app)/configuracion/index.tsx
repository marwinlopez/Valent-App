import { ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { List, Text } from 'react-native-paper';

export default function Configuracion() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">Configuración</Text>
      <List.Item
        title="Tasa BCV"
        description="La tasa del día con la que se calculan todos los precios"
        left={(props) => <List.Icon {...props} icon="currency-usd" />}
        onPress={() => router.push('/(app)/configuracion/tasa')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
});
