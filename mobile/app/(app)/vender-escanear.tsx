import { router } from 'expo-router';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';

// A separate route from Inventario's escanear.tsx: that one routes a scan to
// a product screen, this one adds to the cart. Sharing it would mean a mode
// flag threaded through navigation.
export default function VenderEscanear() {
  return (
    <BarcodeScanner
      barcodeTypes={['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr']}
      prompt="Necesitamos permiso para usar la cámara y escanear el producto."
      webMessage="El escáner solo está disponible en la app móvil. Busca el producto por nombre."
      cancelLabel="Buscar por nombre"
      onScan={(barcode) =>
        router.replace({ pathname: '/(app)/post-venta', params: { barcode } })
      }
      onCancel={() => router.back()}
    />
  );
}
