import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Text, Banner } from 'react-native-paper';
import { useDeviceLinking } from '../../src/hooks/useDeviceLinking';
import { useSessionStore } from '../../src/state/sessionStore';
import { Button } from '../../src/components/ui/Button';
import { TextInput } from '../../src/components/ui/TextInput';

const ENDED_REASON_MESSAGE = {
  REVOKED: 'Este dispositivo fue revocado por el administrador y ya no tiene acceso.',
  PENDING: 'Este dispositivo está pendiente de aprobación del administrador.',
  EXPIRED: 'Tu sesión expiró. Vincula el dispositivo de nuevo para continuar.',
} as const;

export default function Home() {
  const { state, error, suggestedName, startManual, submitToken, confirmName, reset } = useDeviceLinking();
  const endedReason = useSessionStore((store) => store.endedReason);
  const [tokenInput, setTokenInput] = useState('');
  const [nameInput, setNameInput] = useState(suggestedName);

  return (
    <View style={styles.container}>
      {endedReason ? <Banner visible>{ENDED_REASON_MESSAGE[endedReason]}</Banner> : null}

      <Text variant="headlineSmall">Vincular dispositivo</Text>

      {state === 'error' && error ? (
        <Text variant="bodyMedium" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {state === 'confirming' || state === 'submitting' ? (
        <>
          <Text variant="bodyMedium">Ponle un nombre para reconocerlo en la lista de dispositivos.</Text>
          <TextInput label="Nombre del dispositivo" value={nameInput} onChangeText={setNameInput} />
          <Button loading={state === 'submitting'} disabled={state === 'submitting' || nameInput.trim().length === 0} onPress={() => confirmName(nameInput)}>
            Vincular
          </Button>
          <Button mode="text" onPress={reset}>
            Cancelar
          </Button>
        </>
      ) : state === 'manual' ? (
        <>
          <TextInput label="Código de invitación" value={tokenInput} onChangeText={setTokenInput} autoCapitalize="none" />
          <Button disabled={tokenInput.trim().length === 0} onPress={() => submitToken(tokenInput)}>
            Continuar
          </Button>
          <Button mode="text" onPress={reset}>
            Volver
          </Button>
        </>
      ) : (
        <>
          <Button onPress={() => router.push('/(auth)/scan')}>Escanear código QR</Button>
          <Button mode="outlined" onPress={startManual}>
            Ingresar código manualmente
          </Button>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  error: { textAlign: 'center' },
});
