import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, Searchbar, List, Divider, SegmentedButtons, Menu } from 'react-native-paper';
import { useProducts } from '../../src/hooks/useProducts';
import { usePricingInputs } from '../../src/hooks/usePricingInputs';
import { useCart } from '../../src/hooks/useCart';
import { useSale } from '../../src/hooks/useSale';
import { useCustomers, useCreditCheck } from '../../src/hooks/useCustomers';
import { priceCart } from '../../src/services/cart';
import { filterProducts } from '../../src/services/productSearch';
import { Button } from '../../src/components/ui/Button';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { useToast } from '../../src/feedback/ToastProvider';
import { ApiRequestError } from '../../src/services/api/client';
import type { PaymentMethod } from '../../src/types/api';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'EFECTIVO_USD', label: 'USD' },
  { value: 'EFECTIVO_VES', label: 'Bs' },
  { value: 'PAGO_MOVIL', label: 'Pago móvil' },
  { value: 'PUNTO_DE_VENTA', label: 'Punto' },
  { value: 'CREDITO', label: 'Crédito' },
];

const MISSING_MESSAGE = {
  bcvRate: 'Falta la tasa BCV del día. No se puede cobrar sin ella.',
  margin: 'Un producto del carrito pertenece a un departamento sin margen configurado.',
  cost: 'Un producto del carrito no tiene un costo válido.',
} as const;

const SALE_MESSAGE_BY_CODE: Record<string, string> = {
  INSUFFICIENT_STOCK: 'No hay existencia suficiente para una de las líneas. Ajusta la cantidad.',
  PRODUCT_NOT_FOUND: 'Un producto del carrito ya no está en el inventario.',
  CREDIT_DENIED: 'El crédito fue rechazado.',
  CUSTOMER_REQUIRED: 'Selecciona un cliente para cobrar a crédito.',
  DUPLICATE_LINE: 'Hay una línea repetida en el carrito.',
  INVALID_STOCK_VALUE: 'La existencia de un producto no es un número válido en la hoja.',
};

export default function PostVenta() {
  const { barcode: scannedBarcode } = useLocalSearchParams<{ barcode?: string }>();
  const { data: products, isLoading, isError } = useProducts();
  const { bcvRate, marginFor, isLoading: pricingLoading } = usePricingInputs();
  const { lines, add, setQuantity, remove, clear } = useCart();
  const { data: customers } = useCustomers();
  const sale = useSale();
  const { showToast } = useToast();

  const [query, setQuery] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('EFECTIVO_USD');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);

  const priced = priceCart(lines, marginFor, bcvRate);
  // In USD: the backend checks credit against `totalUsd` and stores the debt
  // balance in USD. Passing bolivars here would clear a customer for a sale
  // the charge itself then rejects.
  const totalUsd = priced.ok ? priced.totalUsd : 0;
  const credit = useCreditCheck(method === 'CREDITO' ? customerId : null, totalUsd);

  useEffect(() => {
    if (!scannedBarcode || !products) return;
    const product = products.find((p) => p.barcode === scannedBarcode);
    if (product) {
      add(product);
    } else {
      showToast('Ese código no está en el inventario.');
    }
    // Consumes the scanned barcode so a re-render (or navigating back to this
    // same route without a fresh scan) doesn't add the product again. Passing
    // `undefined` merges into the route's params rather than deleting the key,
    // so the param survives as `{ barcode: undefined }` — that's fine, because
    // the guard above already treats a falsy `scannedBarcode` as "nothing to
    // add", and this effect only re-fires when `scannedBarcode`'s *value*
    // changes, which it won't again until the next real scan replaces it.
    router.setParams({ barcode: undefined });
  }, [scannedBarcode, products, add, showToast]);

  if (isLoading || pricingLoading) {
    return (
      <View style={styles.container}>
        <Skeleton height={48} />
        <Skeleton height={64} />
      </View>
    );
  }

  if (isError) {
    return <EmptyState title="No se pudo cargar el inventario" message="Revisa tu conexión e inténtalo de nuevo." />;
  }

  if (bcvRate === null) {
    return (
      <EmptyState
        title="Falta la tasa BCV del día"
        message="Sin la tasa no se puede calcular ningún precio en bolívares. Cárgala en Configuración."
      />
    );
  }

  const results = query.trim() ? filterProducts(products ?? [], query).slice(0, 20) : [];
  // False while the credit check is loading or errored too, not just when it
  // came back denied — `credit.data` is undefined in both of those cases, so
  // Charge stays disabled until a verdict actually exists. The messages below
  // say which of those three states applies.
  const creditBlocked = method === 'CREDITO' && (credit.data ? !credit.data.approved : true);
  const canCharge =
    priced.ok &&
    lines.length > 0 &&
    !sale.isPending &&
    !creditBlocked &&
    (method !== 'CREDITO' || Boolean(customerId));

  const charge = async () => {
    if (!priced.ok || sale.isPending) return;
    try {
      await sale.mutateAsync({
        customerId: customerId ?? undefined,
        items: priced.lines.map((line) => ({
          barcode: line.product.barcode,
          name: line.product.name,
          quantity: line.quantity,
          unitPriceUsd: line.unitPriceUsd,
        })),
        totalUsd: priced.totalUsd,
        totalVes: priced.totalVes,
        paymentMethod: method,
        bcvRateUsed: bcvRate,
      });
      clear();
      setCustomerId(null);
      showToast('Venta registrada.');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        showToast(SALE_MESSAGE_BY_CODE[err.code] ?? 'No se pudo registrar la venta.');
        return;
      }
      // Not an ApiRequestError: the request may or may not have landed, and
      // POST /sales is not idempotent, so we must not retry silently.
      showToast('No sabemos si la venta se registró. Verifícala antes de cobrar de nuevo.');
    }
  };

  const selectedCustomer = customers?.find((c) => c.id === customerId);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Searchbar placeholder="Buscar producto" value={query} onChangeText={setQuery} />
      <Button mode="outlined" onPress={() => router.push('/(app)/vender-escanear')}>
        Escanear producto
      </Button>

      {results.map((product) => (
        <List.Item
          key={product.barcode}
          title={product.name}
          description={`${product.brand} · ${product.stock} ${product.unit}`}
          onPress={() => {
            add(product);
            setQuery('');
          }}
        />
      ))}

      <Divider />

      {lines.length === 0 ? (
        <Text variant="bodyMedium">El carrito está vacío.</Text>
      ) : !priced.ok ? (
        <Text variant="bodyMedium">{MISSING_MESSAGE[priced.missing]}</Text>
      ) : (
        priced.lines.map((line) => (
          <List.Item
            key={line.product.barcode}
            title={`${line.quantity} × ${line.product.name}`}
            description={`${line.lineTotalVes} Bs`}
            right={() => (
              <View style={styles.row}>
                <Button mode="text" onPress={() => setQuantity(line.product.barcode, line.quantity - 1)}>
                  −
                </Button>
                <Button mode="text" onPress={() => setQuantity(line.product.barcode, line.quantity + 1)}>
                  +
                </Button>
                <Button mode="text" onPress={() => remove(line.product.barcode)}>
                  Quitar
                </Button>
              </View>
            )}
          />
        ))
      )}

      <Divider />

      {priced.ok ? (
        <Text variant="titleMedium">
          Total: {priced.totalVes} Bs ({priced.totalUsd} USD)
        </Text>
      ) : null}

      <SegmentedButtons
        value={method}
        onValueChange={(value) => setMethod(value as PaymentMethod)}
        buttons={METHODS}
      />

      <Menu
        visible={customerMenuOpen}
        onDismiss={() => setCustomerMenuOpen(false)}
        anchor={
          <Button mode="outlined" onPress={() => setCustomerMenuOpen(true)}>
            {selectedCustomer ? selectedCustomer.name : 'Seleccionar cliente'}
          </Button>
        }
      >
        <Menu.Item onPress={() => { setCustomerId(null); setCustomerMenuOpen(false); }} title="Sin cliente" />
        {customers?.map((customer) => (
          <Menu.Item
            key={customer.id}
            onPress={() => { setCustomerId(customer.id); setCustomerMenuOpen(false); }}
            title={customer.name}
          />
        ))}
      </Menu>

      {method === 'CREDITO' && customerId && credit.isError ? (
        <Text variant="bodyMedium">No se pudo verificar el crédito. Revisa tu conexión.</Text>
      ) : null}

      {method === 'CREDITO' && customerId && credit.data ? (
        <Text variant="bodyMedium">
          {credit.data.approved
            ? `Crédito disponible: ${credit.data.availableCredit} USD`
            : `Crédito rechazado: ${credit.data.reason ?? 'sin cupo disponible'}`}
        </Text>
      ) : null}

      {method === 'CREDITO' && !customerId ? (
        <Text variant="bodyMedium">Selecciona un cliente para cobrar a crédito.</Text>
      ) : null}

      {method === 'CREDITO' && customerId && credit.isLoading ? (
        <Text variant="bodyMedium">Verificando crédito…</Text>
      ) : null}

      <Button loading={sale.isPending} disabled={!canCharge} onPress={charge}>
        Cobrar
      </Button>
      {lines.length > 0 ? (
        <Button mode="text" disabled={sale.isPending} onPress={clear}>
          Vaciar carrito
        </Button>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
