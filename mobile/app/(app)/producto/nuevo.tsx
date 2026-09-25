import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text } from 'react-native-paper';
import { useProductMutations } from '../../../src/hooks/useProductMutations';
import { usePricingInputs } from '../../../src/hooks/usePricingInputs';
import { calculatePriceVes } from '../../../src/services/pricing';
import { Button } from '../../../src/components/ui/Button';
import { TextInput } from '../../../src/components/ui/TextInput';
import { useToast } from '../../../src/feedback/ToastProvider';
import { ApiRequestError } from '../../../src/services/api/client';

export default function NuevoProducto() {
  // Pre-filled when arriving from a scan of a code that isn't in the catalog.
  const { barcode: scannedBarcode } = useLocalSearchParams<{ barcode?: string }>();
  const { create } = useProductMutations();
  const { bcvRate, marginFor } = usePricingInputs();
  const { showToast } = useToast();

  const [form, setForm] = useState({
    barcode: scannedBarcode ?? '',
    name: '',
    brand: '',
    department: '',
    unit: '',
    costUsd: '',
    stock: '',
  });

  const costUsd = Number(form.costUsd);
  const preview = calculatePriceVes(costUsd, marginFor(form.department), bcvRate);

  const submit = async () => {
    const stock = Number(form.stock);
    if (!Number.isFinite(costUsd) || costUsd < 0 || !Number.isFinite(stock) || stock < 0) {
      showToast('El costo y la existencia deben ser números válidos.');
      return;
    }
    try {
      await create.mutateAsync({
        barcode: form.barcode.trim(),
        name: form.name.trim(),
        brand: form.brand.trim(),
        department: form.department.trim(),
        unit: form.unit.trim(),
        costUsd,
        stock,
      });
      showToast('Producto creado.');
      router.replace('/(app)/inventario');
    } catch (err) {
      // The catalog cache can be stale, so a scan can land here for a barcode
      // another device just created. This is that case, named.
      if (err instanceof ApiRequestError && err.code === 'DUPLICATE_BARCODE') {
        showToast('Ese código ya existe en el inventario.');
        return;
      }
      showToast('No se pudo crear el producto.');
    }
  };

  const complete =
    form.barcode.trim() && form.name.trim() && form.brand.trim() && form.department.trim() && form.unit.trim();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">Nuevo producto</Text>

      <TextInput label="Código de barras" value={form.barcode} onChangeText={(v) => setForm({ ...form, barcode: v })} />
      <TextInput label="Nombre" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
      <TextInput label="Marca" value={form.brand} onChangeText={(v) => setForm({ ...form, brand: v })} />
      <TextInput label="Departamento" value={form.department} onChangeText={(v) => setForm({ ...form, department: v })} />
      <TextInput label="Unidad de medida" value={form.unit} onChangeText={(v) => setForm({ ...form, unit: v })} />
      <TextInput label="Costo USD" value={form.costUsd} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, costUsd: v })} />
      <TextInput label="Existencia inicial" value={form.stock} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, stock: v })} />

      {preview.ok ? <Text variant="bodyMedium">Precio estimado: {preview.priceVes} Bs</Text> : null}

      <Button loading={create.isPending} disabled={create.isPending || !complete} onPress={submit}>
        Crear producto
      </Button>
      <Button mode="text" onPress={() => router.back()}>
        Cancelar
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
});
