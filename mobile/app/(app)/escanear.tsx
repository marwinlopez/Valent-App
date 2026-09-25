import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';
import { useProducts } from '../../src/hooks/useProducts';
import { isKnownBarcode } from '../../src/services/productSearch';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { Button } from '../../src/components/ui/Button';

export default function Escanear() {
  const { data, isLoading, isError } = useProducts();

  // A cold catalog cache (no data yet, e.g. this screen reached before
  // inventario.tsx ever loaded it) must not be treated as "nothing known" —
  // that would route every scan to product creation, including known
  // products. Hold instead of guessing.
  if (isLoading) {
    return (
      <View style={styles.container}>
        <Skeleton height={48} />
      </View>
    );
  }

  // A failed catalog query leaves `data` undefined too. Holding on a spinner
  // for it leaves the user with nothing but the OS back gesture.
  if (isError || !data) {
    return (
      <View style={styles.container}>
        <EmptyState
          title="No se pudo cargar el inventario"
          message="Sin el catálogo no se puede saber si un código ya existe. Revisa tu conexión."
        />
        <Button mode="text" onPress={() => router.back()}>
          Volver
        </Button>
      </View>
    );
  }

  return (
    <BarcodeScanner
      barcodeTypes={['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr']}
      prompt="Necesitamos permiso para usar la cámara y escanear el código del producto."
      webMessage="El escáner solo está disponible en la app móvil. Busca el producto por nombre o código."
      cancelLabel="Buscar por nombre"
      onScan={(barcode) => {
        // Resolved against the cached catalog: known code opens the product,
        // unknown code starts creating it with the code already filled in. A
        // product another device just added may not be in this cache yet — the
        // backend's DUPLICATE_BARCODE is the backstop for that.
        router.replace(
          isKnownBarcode(data, barcode)
            ? `/(app)/producto/${encodeURIComponent(barcode)}`
            : { pathname: '/(app)/producto/nuevo', params: { barcode } }
        );
      }}
      onCancel={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, justifyContent: 'center' },
});
