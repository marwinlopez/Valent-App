import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { getBcvRate } from '../../../src/services/api/config';
import { useConfigMutations } from '../../../src/hooks/useConfigMutations';
import { parseDecimal } from '../../../src/services/parseDecimal';
import { ApiRequestError } from '../../../src/services/api/client';
import { Button } from '../../../src/components/ui/Button';
import { TextInput } from '../../../src/components/ui/TextInput';
import { EmptyState } from '../../../src/components/ui/EmptyState';
import { Skeleton } from '../../../src/components/ui/Skeleton';
import { useToast } from '../../../src/feedback/ToastProvider';

const SAVE_MESSAGE_BY_CODE: Record<string, string> = {
  // The tab is ADMIN-only already; this is the second layer, and it should
  // say what is actually wrong rather than "could not save".
  FORBIDDEN: 'Solo un dispositivo administrador puede cambiar la tasa.',
  VALIDATION_ERROR: 'El servidor rechazó la tasa. Revisa el valor.',
};
const SAVE_FALLBACK_MESSAGE = 'No se pudo guardar la tasa.';

export default function Tasa() {
  // The same query key usePricingInputs reads, so this screen and the
  // register share one cached rate and one invalidation.
  const rateQuery = useQuery({ queryKey: ['bcv-rate'], queryFn: getBcvRate });
  const { setBcvRate } = useConfigMutations();
  const { showToast } = useToast();
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | undefined>(undefined);

  if (rateQuery.isLoading) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Skeleton height={32} />
        <Skeleton height={56} />
      </ScrollView>
    );
  }

  // A failed request is not "no rate set". Telling someone on a flaky
  // connection to go enter a rate that already exists is the misdiagnosis
  // sub-project 4 fixed on the register; it must not reappear here.
  if (rateQuery.isError) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <EmptyState
          title="No se pudo cargar la tasa"
          message="Revisa tu conexión e inténtalo de nuevo."
        />
        <Button mode="outlined" onPress={() => rateQuery.refetch()}>
          Reintentar
        </Button>
        <Button mode="text" onPress={() => router.back()}>
          Volver
        </Button>
      </ScrollView>
    );
  }

  // getBcvRate resolves to null on a 404: no rate set is an ordinary state.
  const current = rateQuery.data ?? null;

  const save = async () => {
    const rate = parseDecimal(input);
    if (rate === null) {
      setInputError('Escribe un número, por ejemplo 36,50.');
      return;
    }
    // calculatePriceVes refuses a rate at or below zero (a zero rate prices a
    // whole cart at 0 Bs while the USD totals stay correct), and PUT /bcv-rate
    // requires a positive one. Refusing it here too gives a reason instead of
    // a server error.
    if (rate <= 0) {
      setInputError('La tasa tiene que ser mayor que cero.');
      return;
    }
    setInputError(undefined);
    try {
      await setBcvRate.mutateAsync(rate);
      setInput('');
      showToast('Tasa guardada.');
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : null;
      showToast((code && SAVE_MESSAGE_BY_CODE[code]) ?? SAVE_FALLBACK_MESSAGE);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">Tasa BCV</Text>

      {/* Shown with the date it was saved for, so it is visible which day it
          applies to — and so a thousandfold slip ("1.234" read as 1.234) is
          visible the moment it is saved. */}
      {current ? (
        <Text variant="titleMedium">
          Tasa actual: {current.rate} Bs/USD (del {current.rateDate})
        </Text>
      ) : (
        <Text variant="bodyMedium">
          No hay tasa cargada para hoy. Sin ella la caja no puede calcular ningún precio en bolívares.
        </Text>
      )}

      <TextInput
        label="Nueva tasa (Bs por USD)"
        value={input}
        onChangeText={(value) => {
          setInput(value);
          setInputError(undefined);
        }}
        keyboardType="decimal-pad"
        errorText={inputError}
      />
      <Button loading={setBcvRate.isPending} disabled={setBcvRate.isPending} onPress={save}>
        Guardar
      </Button>
      <Button mode="text" disabled={setBcvRate.isPending} onPress={() => router.back()}>
        Volver
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
});
