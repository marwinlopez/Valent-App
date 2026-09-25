import { useState } from 'react';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text } from 'react-native-paper';
import { Button } from '../../src/components/ui/Button';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  // Without this, a QR held in frame fires onBarcodeScanned on every frame and
  // pushes a stack of Home screens.
  const [handled, setHandled] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <Message text="El escáner solo está disponible en la app móvil. Usa el ingreso manual del código." />
    );
  }

  if (!permission) {
    return <Message text="Preparando la cámara…" />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text variant="bodyMedium" style={styles.text}>
          Necesitamos permiso para usar la cámara y escanear el código QR.
        </Text>
        {permission.canAskAgain ? (
          <Button onPress={requestPermission}>Dar permiso</Button>
        ) : (
          <Button onPress={() => Linking.openSettings()}>Abrir ajustes</Button>
        )}
        <Button mode="text" onPress={() => router.back()}>
          Ingresar el código manualmente
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled) {
            return;
          }
          setHandled(true);
          router.replace({ pathname: '/(auth)/home', params: { token: data } });
        }}
      />
      <View style={styles.overlay}>
        <Button mode="contained" onPress={() => router.back()}>
          Cancelar
        </Button>
      </View>
    </View>
  );
}

function Message({ text }: { text: string }) {
  return (
    <View style={styles.centered}>
      <Text variant="bodyMedium" style={styles.text}>
        {text}
      </Text>
      <Button mode="text" onPress={() => router.back()}>
        Volver
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  text: { textAlign: 'center' },
  overlay: { position: 'absolute', bottom: 48, left: 24, right: 24 },
});
