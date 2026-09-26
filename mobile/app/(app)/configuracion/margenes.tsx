import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Divider, List, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { getMargins } from '../../../src/services/api/config';
import { useProducts } from '../../../src/hooks/useProducts';
import { useConfigMutations } from '../../../src/hooks/useConfigMutations';
import { departmentMargins } from '../../../src/services/departmentMargins';
import { parseDecimal } from '../../../src/services/parseDecimal';
import { ApiRequestError } from '../../../src/services/api/client';
import { Button } from '../../../src/components/ui/Button';
import { TextInput } from '../../../src/components/ui/TextInput';
import { EmptyState } from '../../../src/components/ui/EmptyState';
import { Skeleton } from '../../../src/components/ui/Skeleton';
import { useToast } from '../../../src/feedback/ToastProvider';

const SAVE_MESSAGE_BY_CODE: Record<string, string> = {
  FORBIDDEN: 'Solo un dispositivo administrador puede cambiar los márgenes.',
  VALIDATION_ERROR: 'El servidor rechazó el margen. Revisa el valor.',
};
const SAVE_FALLBACK_MESSAGE = 'No se pudo guardar el margen.';

const LEVEL_LABEL = {
  CATEGORIA: 'Categoría',
  SUBCATEGORIA: 'Subcategoría',
  DEPARTAMENTO: 'Departamento',
} as const;

export default function Margenes() {
  const products = useProducts();
  // The same query key usePricingInputs reads.
  const margins = useQuery({ queryKey: ['margins'], queryFn: getMargins });
  const { saveMargin } = useConfigMutations();
  const { showToast } = useToast();

  const [editing, setEditing] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | undefined>(undefined);

  if (products.isLoading || margins.isLoading) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Skeleton height={32} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </ScrollView>
    );
  }

  // Either query failing means the list below would be wrong: without the
  // catalog there are no departments to show, and without the rules every
  // department would read as "sin margen" — a false diagnosis.
  if (products.isError || margins.isError) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <EmptyState
          title="No se pudieron cargar los márgenes"
          message="Revisa tu conexión e inténtalo de nuevo."
        />
        <Button
          mode="outlined"
          onPress={() => {
            void products.refetch();
            void margins.refetch();
          }}
        >
          Reintentar
        </Button>
        <Button mode="text" onPress={() => router.back()}>
          Volver
        </Button>
      </ScrollView>
    );
  }

  const { departments, unmatchedRules } = departmentMargins(products.data ?? [], margins.data ?? []);

  const startEditing = (department: string, percentage: number | null) => {
    setEditing(department);
    setInput(percentage === null ? '' : String(percentage));
    setInputError(undefined);
  };

  const save = async (department: string) => {
    const percentage = parseDecimal(input);
    if (percentage === null) {
      setInputError('Escribe un número, por ejemplo 30 o 12,5.');
      return;
    }
    // The backend's contract is min(0).max(1000). Zero is allowed and means
    // selling at cost; negative is not.
    if (percentage < 0 || percentage > 1000) {
      setInputError('El margen tiene que estar entre 0 y 1000.');
      return;
    }
    try {
      await saveMargin.mutateAsync({ department, percentage });
      // The mutation can resolve after the user has already moved on to
      // editing a different department — only close the editor if it is
      // still showing the one that was just saved.
      setEditing((current) => (current === department ? null : current));
      showToast(`Margen de ${department} guardado.`);
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : null;
      showToast((code && SAVE_MESSAGE_BY_CODE[code]) ?? SAVE_FALLBACK_MESSAGE);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">Márgenes</Text>
      <Text variant="bodyMedium">
        Los departamentos salen del inventario. Un departamento sin margen no se puede vender en la caja.
      </Text>

      {departments.length === 0 ? (
        <Text variant="bodyMedium">
          Todavía no hay productos en el inventario, así que no hay departamentos que configurar.
        </Text>
      ) : (
        departments.map(({ department, percentage }) =>
          editing === department ? (
            <View key={department} style={styles.editor}>
              <Text variant="titleSmall">{department}</Text>
              <TextInput
                label="Margen (%)"
                value={input}
                onChangeText={(value) => {
                  setInput(value);
                  setInputError(undefined);
                }}
                keyboardType="decimal-pad"
                errorText={inputError}
              />
              <Button loading={saveMargin.isPending} disabled={saveMargin.isPending} onPress={() => save(department)}>
                Guardar
              </Button>
              <Button mode="text" disabled={saveMargin.isPending} onPress={() => setEditing(null)}>
                Cancelar
              </Button>
            </View>
          ) : (
            <List.Item
              key={department}
              title={department}
              description={percentage === null ? 'Sin margen — no se puede vender' : `${percentage}%`}
              onPress={() => startEditing(department, percentage)}
            />
          )
        )
      )}

      {/* Shown read-only rather than hidden: a tenant provisioned by raw SQL
          may carry rules nothing can match, and hiding them would make a
          percentage in the database invisible. */}
      {unmatchedRules.length > 0 ? (
        <View style={styles.section}>
          <Divider />
          <Text variant="titleSmall">Reglas que no se aplican</Text>
          <Text variant="bodySmall">
            Ningún producto del inventario coincide con estas reglas, así que no afectan ningún precio.
          </Text>
          {unmatchedRules.map((rule) => (
            <List.Item
              key={rule.id}
              title={rule.level_name}
              description={`${LEVEL_LABEL[rule.level]} · ${rule.percentage}%`}
            />
          ))}
        </View>
      ) : null}

      <Button mode="text" onPress={() => router.back()}>
        Volver
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  editor: { gap: 8, paddingVertical: 8 },
  section: { gap: 8 },
});
