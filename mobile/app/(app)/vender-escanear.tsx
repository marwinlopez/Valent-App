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
        // `scanId` is an opaque per-scan token, not business data: post-venta.tsx
        // uses it (paired with the barcode) to tell "a genuinely new scan" apart
        // from "the same route params observed again" (a background refetch, or
        // scanning the same barcode a second time), without depending on the
        // router ever clearing `barcode` back to undefined in between.
        router.replace({
          pathname: '/(app)/post-venta',
          params: { barcode, scanId: globalThis.crypto.randomUUID() },
        })
      }
      onCancel={() => router.back()}
    />
  );
}
