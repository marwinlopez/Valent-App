import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { SegmentedButtons, Text } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { createInvite } from '../../src/services/api/auth';
import { Button } from '../../src/components/ui/Button';
import type { DeviceRole } from '../../src/types/api';

const ROLE_OPTIONS: { value: DeviceRole; label: string }[] = [
  { value: 'INVENTARIO', label: 'Inventario' },
  { value: 'POST_VENTA', label: 'Post-Venta' },
  { value: 'ADMIN', label: 'Admin' },
];

export default function Invitar() {
  const [role, setRole] = useState<DeviceRole>('INVENTARIO');
  const mutation = useMutation({ mutationFn: () => createInvite(role) });

  return (
    <View style={styles.container}>
      <Text variant="headlineSmall">Invitar un dispositivo</Text>

      <SegmentedButtons
        value={role}
        onValueChange={(value) => {
          setRole(value as DeviceRole);
          // Without this the previous role's QR would sit under the new
          // selection, and the admin would hand out the wrong role.
          mutation.reset();
        }}
        buttons={ROLE_OPTIONS}
      />

      <Button loading={mutation.isPending} disabled={mutation.isPending} onPress={() => mutation.mutate()}>
        Generar invitación
      </Button>

      {mutation.isError ? (
        <Text variant="bodyMedium">No se pudo generar la invitación. Inténtalo de nuevo.</Text>
      ) : null}

      {mutation.data ? (
        <View style={styles.result}>
          <QRCode value={mutation.data.inviteToken} size={220} />
          <Text variant="bodyMedium">Rol: {mutation.data.role}</Text>
          <Text variant="bodySmall" selectable>
            {mutation.data.inviteToken}
          </Text>
          <Text variant="bodySmall">
            Válido hasta {new Date(mutation.data.expiresAt).toLocaleString()} · un solo uso
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  result: { alignItems: 'center', gap: 8 },
});
