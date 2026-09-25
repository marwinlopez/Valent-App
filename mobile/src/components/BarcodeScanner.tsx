import { useState } from 'react';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text } from 'react-native-paper';
import { Button } from './ui/Button';

type BarcodeType = 'qr' | 'ean13' | 'ean8' | 'upc_a' | 'upc_e' | 'code128';

interface BarcodeScannerProps {
  barcodeTypes: BarcodeType[];
  /** Shown when permission hasn't been granted — say what it's for. */
  prompt: string;
  /** Shown on web, where the camera isn't available. */
  webMessage: string;
  /** Label for the permission-denied state's cancel button — the way out
   *  differs by caller (manual code entry vs. searching the catalog). */
  cancelLabel?: string;
  onScan: (data: string) => void;
  onCancel: () => void;
}

export function BarcodeScanner({
  barcodeTypes,
  prompt,
  webMessage,
  cancelLabel = 'Volver',
  onScan,
  onCancel,
}: BarcodeScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  // Without this, a code held in frame fires onBarcodeScanned on every frame.
  const [handled, setHandled] = useState(false);

  if (Platform.OS === 'web') {
    return <Message text={webMessage} onCancel={onCancel} />;
  }

  if (!permission) {
    return <Message text="Preparando la cámara…" onCancel={onCancel} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text variant="bodyMedium" style={styles.text}>
          {prompt}
        </Text>
        {permission.canAskAgain ? (
          <Button onPress={requestPermission}>Dar permiso</Button>
        ) : (
          <Button onPress={() => Linking.openSettings()}>Abrir ajustes</Button>
        )}
        <Button mode="text" onPress={onCancel}>
          {cancelLabel}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes }}
        onBarcodeScanned={({ data }) => {
          if (handled) {
            return;
          }
          setHandled(true);
          onScan(data);
        }}
      />
      <View style={styles.overlay}>
        <Button mode="contained" onPress={onCancel}>
          Cancelar
        </Button>
      </View>
    </View>
  );
}

function Message({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <View style={styles.centered}>
      <Text variant="bodyMedium" style={styles.text}>
        {text}
      </Text>
      <Button mode="text" onPress={onCancel}>
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
