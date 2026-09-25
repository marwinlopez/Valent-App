import { router } from 'expo-router';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';
import { useProducts } from '../../src/hooks/useProducts';

export default function Escanear() {
  const { data } = useProducts();

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
        const known = data?.some((p) => p.barcode === barcode);
        router.replace(
          known
            ? `/(app)/producto/${encodeURIComponent(barcode)}`
            : { pathname: '/(app)/producto/nuevo', params: { barcode } }
        );
      }}
      onCancel={() => router.back()}
    />
  );
}
