import { router } from 'expo-router';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';

export default function Scan() {
  return (
    <BarcodeScanner
      barcodeTypes={['qr']}
      prompt="Necesitamos permiso para usar la cámara y escanear el código QR."
      webMessage="El escáner solo está disponible en la app móvil. Usa el ingreso manual del código."
      cancelLabel="Ingresar el código manualmente"
      onScan={(data) => router.replace({ pathname: '/(auth)/home', params: { token: data } })}
      onCancel={() => router.back()}
    />
  );
}
