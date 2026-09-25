import { useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Searchbar, Text, FAB, List } from 'react-native-paper';
import { useProducts } from '../../src/hooks/useProducts';
import { filterProducts } from '../../src/hooks/useProductSearch';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { Button } from '../../src/components/ui/Button';

export default function Inventario() {
  const { data, isLoading, isError } = useProducts();
  const [query, setQuery] = useState('');

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Skeleton height={48} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="No se pudo cargar el inventario"
        message="Revisa tu conexión e inténtalo de nuevo."
      />
    );
  }

  const products = filterProducts(data ?? [], query);

  return (
    <View style={styles.container}>
      <Searchbar placeholder="Buscar por nombre, marca o código" value={query} onChangeText={setQuery} />
      <Button mode="outlined" onPress={() => router.push('/(app)/escanear')}>
        Escanear código
      </Button>

      {products.length === 0 ? (
        <EmptyState
          title={query ? 'Sin resultados' : 'Inventario vacío'}
          message={
            query ? 'Ningún producto coincide con la búsqueda.' : 'Agrega tu primer producto con el botón +.'
          }
        />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.barcode}
          renderItem={({ item }) => (
            <List.Item
              title={item.name}
              description={`${item.brand} · ${item.barcode}`}
              right={() => <Text variant="bodyMedium">{item.stock}</Text>}
              onPress={() => router.push(`/(app)/producto/${encodeURIComponent(item.barcode)}`)}
            />
          )}
        />
      )}

      <FAB icon="plus" style={styles.fab} onPress={() => router.push('/(app)/producto/nuevo')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
