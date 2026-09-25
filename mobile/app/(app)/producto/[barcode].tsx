import { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, Divider } from 'react-native-paper';
import { useProducts } from '../../../src/hooks/useProducts';
import { usePricingInputs } from '../../../src/hooks/usePricingInputs';
import { useProductMutations } from '../../../src/hooks/useProductMutations';
import { calculatePriceVes } from '../../../src/services/pricing';
import { Button } from '../../../src/components/ui/Button';
import { TextInput } from '../../../src/components/ui/TextInput';
import { EmptyState } from '../../../src/components/ui/EmptyState';
import { useToast } from '../../../src/feedback/ToastProvider';
import { ApiRequestError } from '../../../src/services/api/client';

const MISSING_INPUT_MESSAGE = {
  bcvRate: 'Falta la tasa BCV del día para calcular el precio.',
  margin: 'Este departamento no tiene un margen configurado.',
  cost: 'El costo del producto no es válido.',
} as const;

// Messages are chosen per backend error code, same pattern as useDeviceLinking's
// MESSAGE_BY_CODE: a dropped connection and "your number would take stock below
// zero" are different problems and deserve different toasts.
const STOCK_MESSAGE_BY_CODE: Record<string, string> = {
  INSUFFICIENT_STOCK: 'No hay suficiente existencia para ese ajuste.',
};
const STOCK_FALLBACK_MESSAGE = 'No se pudo ajustar el stock.';

export default function ProductoDetalle() {
  const { barcode } = useLocalSearchParams<{ barcode: string }>();
  const { data } = useProducts();
  const { bcvRate, marginFor } = usePricingInputs();
  const { update, adjust } = useProductMutations();
  const { showToast } = useToast();

  const product = data?.find((p) => p.barcode === barcode);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', brand: '', department: '', unit: '', costUsd: '' });
  const [delta, setDelta] = useState('');

  if (!product) {
    return (
      <EmptyState
        title="Producto no encontrado"
        message="Puede que otro dispositivo lo haya modificado."
      />
    );
  }

  const price = calculatePriceVes(product.costUsd, marginFor(product.department), bcvRate);

  const startEditing = () => {
    setForm({
      name: product.name,
      brand: product.brand,
      department: product.department,
      unit: product.unit,
      costUsd: String(product.costUsd),
    });
    setEditing(true);
  };

  const save = async () => {
    const costUsd = Number(form.costUsd);
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      showToast('El costo debe ser un número válido.');
      return;
    }
    try {
      await update.mutateAsync({
        barcode: product.barcode,
        body: {
          name: form.name.trim(),
          brand: form.brand.trim(),
          department: form.department.trim(),
          unit: form.unit.trim(),
          costUsd,
        },
      });
      setEditing(false);
      showToast('Producto actualizado.');
    } catch {
      showToast('No se pudo guardar el producto.');
    }
  };

  const applyDelta = async () => {
    const value = Number(delta);
    if (!Number.isFinite(value) || value === 0) {
      showToast('Indica cuántas unidades entraron o salieron.');
      return;
    }
    try {
      await adjust.mutateAsync({ barcode: product.barcode, delta: value });
      setDelta('');
      showToast('Stock actualizado.');
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : null;
      showToast((code && STOCK_MESSAGE_BY_CODE[code]) ?? STOCK_FALLBACK_MESSAGE);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">{product.name}</Text>
      <Text variant="bodySmall">{product.barcode}</Text>

      <Divider />

      <Text variant="bodyMedium">Costo: {product.costUsd} USD</Text>
      <Text variant="bodyMedium">
        {price.ok ? `Precio: ${price.priceVes} Bs` : MISSING_INPUT_MESSAGE[price.missing]}
      </Text>
      <Text variant="bodyMedium">
        Existencia: {product.stock} {product.unit}
      </Text>

      <Divider />

      {editing ? (
        <View style={styles.section}>
          <TextInput label="Nombre" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
          <TextInput label="Marca" value={form.brand} onChangeText={(v) => setForm({ ...form, brand: v })} />
          <TextInput
            label="Departamento"
            value={form.department}
            onChangeText={(v) => setForm({ ...form, department: v })}
          />
          <TextInput label="Unidad" value={form.unit} onChangeText={(v) => setForm({ ...form, unit: v })} />
          <TextInput
            label="Costo USD"
            value={form.costUsd}
            keyboardType="decimal-pad"
            onChangeText={(v) => setForm({ ...form, costUsd: v })}
          />
          <Button loading={update.isPending} disabled={update.isPending} onPress={save}>
            Guardar
          </Button>
          <Button mode="text" disabled={update.isPending} onPress={() => setEditing(false)}>
            Cancelar
          </Button>
        </View>
      ) : (
        <View style={styles.section}>
          <Text variant="bodyMedium">Marca: {product.brand}</Text>
          <Text variant="bodyMedium">Departamento: {product.department}</Text>
          <Button mode="outlined" onPress={startEditing}>
            Editar
          </Button>
        </View>
      )}

      <Divider />

      <View style={styles.section}>
        <Text variant="titleSmall">Ajustar existencia</Text>
        <TextInput
          label="Unidades (negativo para salida)"
          value={delta}
          keyboardType="numbers-and-punctuation"
          onChangeText={setDelta}
        />
        <Button loading={adjust.isPending} disabled={adjust.isPending} onPress={applyDelta}>
          Aplicar ajuste
        </Button>
      </View>

      <Button mode="text" onPress={() => router.back()}>
        Volver
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  section: { gap: 8 },
});
