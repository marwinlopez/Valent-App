import { useEffect, useRef, useState } from 'react';
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
import {
  saleErrorMessage,
  SALE_ERROR_PREFIX,
  SALE_UNKNOWN_OUTCOME_MESSAGE,
  translateCreditDenialReason,
} from '../../src/services/saleErrors';
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

export default function PostVenta() {
  const { barcode: scannedBarcode, scanId } = useLocalSearchParams<{ barcode?: string; scanId?: string }>();
  const { data: products, isLoading, isError } = useProducts();
  const { bcvRate, marginFor, isLoading: pricingLoading, isError: pricingError } = usePricingInputs();
  const { lines, add, setQuantity, remove, clear } = useCart();
  const { data: customers, isLoading: customersLoading, isError: customersError } = useCustomers();
  const sale = useSale();
  const { showToast } = useToast();

  // Which scan (barcode + scanId pair) was last consumed. A ref, not a
  // dependence on the router ever clearing `barcode` back to undefined
  // (mobile/post-venta previously assumed `router.setParams({barcode:
  // undefined})` did that -- never verified, and on web `undefined` may just
  // be dropped, leaving the old value in place). `products` getting a fresh
  // identity from a background refetch (no staleTime is set on useProducts,
  // so this happens on every focus/reconnect on web) re-runs the effect
  // below without a new scan; comparing against this ref is what makes that
  // a no-op while a genuinely new scan (new scanId, from vender-escanear.tsx)
  // still always goes through -- including re-scanning the same barcode.
  // escanear.tsx (sub-project 3) doesn't need this: it routes a scan to an
  // idempotent destination (open/create a product screen), it doesn't have a
  // side effect like "add one unit" to guard.
  const consumedScanRef = useRef<string | null>(null);

  // `sale.isPending` only flips after React commits a render following
  // `mutateAsync`'s dispatch, so two taps close enough together both read it
  // as `false`. This ref is written synchronously, before any `await`, so
  // the second tap's `charge()` call sees the first one's write regardless of
  // whether a render has happened yet — it's the actual guard; `isPending`
  // stays on `disabled` for the visual state only.
  const chargingRef = useRef(false);

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
    const scanKey = `${scannedBarcode}:${scanId ?? ''}`;
    if (consumedScanRef.current === scanKey) return;
    consumedScanRef.current = scanKey;

    const product = products.find((p) => p.barcode === scannedBarcode);
    if (product) {
      add(product);
    } else {
      showToast('Ese código no está en el inventario.');
    }
  }, [scannedBarcode, scanId, products, add, showToast]);

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

  // Checked before `bcvRate === null`: that check can't otherwise tell "the
  // rate genuinely isn't configured" apart from "the request for it just
  // failed", and would send someone to Configuración to fix a rate that
  // already exists. Same misdiagnosis family as the inventory `isError`
  // above; matches how producto/[barcode].tsx and producto/nuevo.tsx already
  // handle `usePricingInputs().isError`.
  if (pricingError) {
    return (
      <EmptyState
        title="No se pudo cargar la tasa o los márgenes"
        message="Revisa tu conexión e inténtalo de nuevo."
      />
    );
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
  // say which of those three states applies. `credit.isError` is checked
  // explicitly (not just folded into the `credit.data` ternary): the total is
  // part of the query key, so a *stale* approved result for the current key
  // can still be sitting in cache while the latest request for that same key
  // just errored — the ternary alone would keep trusting the stale data.
  const creditBlocked =
    method === 'CREDITO' && (credit.isError || (credit.data ? !credit.data.approved : true));
  const canCharge =
    priced.ok &&
    lines.length > 0 &&
    !sale.isPending &&
    !creditBlocked &&
    (method !== 'CREDITO' || Boolean(customerId));

  const charge = async () => {
    if (!priced.ok || chargingRef.current) return;
    chargingRef.current = true;
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
        showToast(saleErrorMessage(err));
        return;
      }
      // Not an ApiRequestError: the request may or may not have landed, and
      // POST /sales is not idempotent, so we must not retry silently.
      showToast(SALE_UNKNOWN_OUTCOME_MESSAGE);
    } finally {
      // Reset even on failure/unknown-outcome: a locked button after a failed
      // sale would be its own counter emergency. Whether the operator SHOULD
      // charge again is a judgment call the toast above hands to them, not
      // something this ref should decide by staying locked.
      chargingRef.current = false;
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
          description={`${product.brand} · ${product.stock ?? '—'} ${product.unit}`}
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

      {/* `isError` checked first and the three states below chained as a single
          if/else-if (not four independent ifs): the previous version could
          show credit.isError's message and a *stale* cached credit.data
          side by side in TanStack's isRefetchError state (a failed refetch
          with a still-cached successful result) -- two contradictory
          statements about money at once. The charge gate (`creditBlocked`
          above) was already safe; only the display wasn't. */}
      {method === 'CREDITO' && customerId ? (
        credit.isError ? (
          <Text variant="bodyMedium">No se pudo verificar el crédito. Revisa tu conexión.</Text>
        ) : credit.data ? (
          <Text variant="bodyMedium">
            {credit.data.approved
              ? `Crédito disponible: ${credit.data.availableCredit} USD`
              : `${SALE_ERROR_PREFIX.CREDIT_DENIED}: ${
                  credit.data.reason ? translateCreditDenialReason(credit.data.reason) : 'sin cupo disponible'
                }`}
          </Text>
        ) : credit.isLoading ? (
          <Text variant="bodyMedium">Verificando crédito…</Text>
        ) : null
      ) : null}

      {/* Same misdiagnosis family as the pricing-inputs isError above: a
          failed GET /customers leaves the picker silently offering only "Sin
          cliente", and telling the cashier to "select a customer" then points
          at nothing they can act on. */}
      {method === 'CREDITO' && !customerId ? (
        <Text variant="bodyMedium">
          {customersError
            ? 'No se pudieron cargar los clientes. Revisa tu conexión.'
            : customersLoading
              ? 'Cargando clientes…'
              : 'Selecciona un cliente para cobrar a crédito.'}
        </Text>
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
