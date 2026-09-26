# Configuración: tasa BCV y márgenes — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para el seguimiento.

**Objetivo:** Que un ADMIN pueda cargar la tasa BCV del día y el margen de cada departamento desde la pestaña Configuración, para que la caja pueda cobrar. Según `docs/superpowers/specs/2026-09-26-configuracion-design.md`.

**Arquitectura:** Solo móvil — cero backend nuevo, porque `GET/PUT /bcv-rate` y `GET/POST /margins` ya existen. La pestaña `configuracion` pasa de archivo a directorio con su propio Stack, como `producto/`. Toda la lógica vive en funciones puras y hooks; las pantallas solo pintan.

**Stack técnico:** Existente — Expo SDK 57, Expo Router (rutas tipadas activas), React Native Paper, TanStack Query v5, Jest + `jest-expo` + `@testing-library/react-native` v14.

## Restricciones globales

- **El código, sus comentarios y los mensajes de commit van en inglés**, igual que el resto del repositorio. Este plan está en español porque es un documento que aprueba el usuario; el código no.
- TypeScript `strict: true`, **sin `any`**, y **sin casts `as` para silenciar un error de tipos**.
- **La lógica de negocio vive en `src/hooks/` o `src/services/`, nunca en `app/`.** `app/` contiene solo rutas.
- Los tests móviles cubren **solo lógica pura** — sin tests de render de componentes. (Un `renderHook` sobre un hook de estado o de mutación cuenta como lógica pura.)
- El dinero son números redondeados a 2 decimales en el borde — nunca strings, **nunca `NaN`**.
- Verde en cada commit: `cd mobile && npx tsc --noEmit && npx jest --forceExit`.
- **Pasar siempre `--forceExit` a jest.** Este proyecto tiene una fuga preexistente en el teardown: un `npx jest` simple termina la corrida y después nunca sale, y se ve exactamente como un cuelgue. Un subagente anterior perdió ocho minutos con esto.
- **Rutas tipadas:** `mobile/app.json` tiene `experiments.typedRoutes: true`. Los tipos se generan en `mobile/.expo/types/router.d.ts` recién cuando corre `npx expo start`, y ese archivo está en `.gitignore`. En un worktree limpio no existe, así que `tsc` acepta cualquier ruta; después de verificar en el navegador existe, y `tsc` pasa a rechazar rutas inexistentes. **Nunca enlazar a una pantalla que todavía no existe**, y volver a correr `tsc` después de levantar el servidor de desarrollo.
- Las pantallas se verifican corriendo `npx expo start --web` **desde el worktree, con Bash**. No usar la herramienta de preview: resuelve contra el checkout principal y ya desvió el servidor de desarrollo varias veces en este proyecto. **Detener el servidor al terminar** — la verificación del sub-proyecto 4 dejó dos procesos `expo start` vivos que después bloquearon el borrado del worktree.
- `node_modules` puede no existir en un worktree nuevo — correr `npm install` en `mobile/` primero.
- Base al empezar el plan: móvil **167 tests** pasando, `tsc` limpio. Backend no se toca (108 pasando / 1 saltado).

---

## Estructura de archivos

```
mobile/
  app/(app)/configuracion.tsx                 # SE BORRA — pasa a ser el directorio de abajo
  app/(app)/configuracion/_layout.tsx         # NUEVO — Stack, igual que producto/_layout.tsx
  app/(app)/configuracion/index.tsx           # NUEVO — menú de secciones
  app/(app)/configuracion/tasa.tsx            # NUEVO — tasa BCV del día
  app/(app)/configuracion/margenes.tsx        # NUEVO — márgenes por departamento
  app/(app)/producto/[barcode].tsx            # MODIFICADO — parseDecimal en costo y ajuste
  app/(app)/producto/nuevo.tsx                # MODIFICADO — parseDecimal en costo y existencia
  src/services/parseDecimal.ts                # NUEVO — decimal escrito en teclado en español
  src/services/departmentMargins.ts           # NUEVO — qué departamentos del catálogo tienen margen
  src/services/api/config.ts                  # MODIFICADO — putBcvRate, upsertMargin, todayRateDate
  src/hooks/useConfigMutations.ts             # NUEVO — useSetBcvRate, useSaveMargin
  test/services/parseDecimal.test.ts          # NUEVO
  test/services/departmentMargins.test.ts     # NUEVO
  test/services/api/config.test.ts            # MODIFICADO
  test/hooks/useConfigMutations.test.tsx      # NUEVO
```

---

### Tarea 1: `parseDecimal`, y adoptarlo donde ya se tipean números

**Archivos:**
- Crear: `mobile/src/services/parseDecimal.ts`
- Crear: `mobile/test/services/parseDecimal.test.ts`
- Modificar: `mobile/app/(app)/producto/[barcode].tsx` (líneas ~108 y ~133)
- Modificar: `mobile/app/(app)/producto/nuevo.tsx` (líneas ~35 y ~39)

**Interfaces:**
- Produce: `parseDecimal(input: string): number | null` en `mobile/src/services/parseDecimal.ts`. Las Tareas 3 y 4 lo consumen.

> **Agregado más allá del spec, marcado para que el usuario pueda vetarlo.** El spec pide `parseDecimal` para las dos pantallas nuevas. Pero las dos pantallas de producto del sub-proyecto 3 ya tienen el mismo bug: cuatro llamadas a `Number()` sobre lo que tipea el usuario, así que un ADMIN que escribe el costo `2,50` recibe "El costo debe ser un número válido" — falso en su teclado. Es el mismo usuario, el mismo teclado y la misma causa, así que se arregla en el mismo lugar. Los pasos 5 a 7 son ese agregado.

- [ ] **Paso 1: Escribir el test que falla**

```ts
// mobile/test/services/parseDecimal.test.ts
import { parseDecimal } from '../../src/services/parseDecimal';

describe('parseDecimal', () => {
  it('accepts a comma as the decimal separator (Spanish keyboard)', () => {
    expect(parseDecimal('36,50')).toBe(36.5);
  });

  it('accepts a period as the decimal separator', () => {
    expect(parseDecimal('36.50')).toBe(36.5);
  });

  it('accepts a whole number', () => {
    expect(parseDecimal('40')).toBe(40);
  });

  it('accepts a leading minus, since a stock adjustment can be negative', () => {
    expect(parseDecimal('-3')).toBe(-3);
    expect(parseDecimal('-2,5')).toBe(-2.5);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseDecimal('  36,5  ')).toBe(36.5);
  });

  it('returns null, never NaN, for an empty or blank string', () => {
    // Number('') is 0, which is how an empty stock field used to become a
    // real stock of zero.
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
  });

  it('returns null for a bare separator or sign', () => {
    expect(parseDecimal(',')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('-')).toBeNull();
  });

  it('returns null for more than one separator rather than guessing a thousands grouping', () => {
    // "1.234,56" is 1234.56 in es-VE and garbage in en-US. Guessing wrong by a
    // factor of a thousand in an exchange rate is not recoverable, so both
    // full-form groupings are refused outright.
    expect(parseDecimal('1.234,56')).toBeNull();
    expect(parseDecimal('1,234.56')).toBeNull();
    expect(parseDecimal('1,2,3')).toBeNull();
  });

  it('treats a single separator as decimal, even before exactly three digits', () => {
    // The one ambiguity parsing cannot resolve: "1.234" is 1.234 or 1234
    // depending on locale. The rule is fixed and documented — a single
    // separator is always the decimal one — and the screens show the saved
    // value back, so a thousandfold mistake is visible immediately.
    expect(parseDecimal('1.234')).toBe(1.234);
    expect(parseDecimal('1,234')).toBe(1.234);
  });

  it('returns null for anything that is not a plain decimal', () => {
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('12abc')).toBeNull();
    expect(parseDecimal('1e5')).toBeNull();
    expect(parseDecimal('Infinity')).toBeNull();
    expect(parseDecimal('+5')).toBeNull();
    expect(parseDecimal('5.')).toBeNull();
    expect(parseDecimal('.5')).toBeNull();
  });
});
```

- [ ] **Paso 2: Correrlo y confirmar que falla**

Correr: `cd mobile && npx jest test/services/parseDecimal.test.ts --forceExit`
Esperado: FALLA — `Cannot find module '../../src/services/parseDecimal'`.

- [ ] **Paso 3: Implementar `mobile/src/services/parseDecimal.ts`**

```ts
/**
 * Parses a decimal as typed on a Spanish keyboard, where the separator is a
 * comma: `Number('36,50')` is `NaN`, and a `NaN` fails every comparison
 * silently — which is how this codebase once approved credit it should have
 * denied.
 *
 * Accepts an optional leading minus, digits, and at most one separator (comma
 * or period) followed by digits. Everything else is `null`, never `NaN`.
 *
 * A single separator is always read as the decimal one, so "1.234" is 1.234,
 * never 1234. That is the one ambiguity parsing cannot resolve; the screens
 * that use this show the saved value back so a thousandfold slip is visible.
 * Two separators ("1.234,56") are refused rather than guessed at.
 */
export function parseDecimal(input: string): number | null {
  const trimmed = input.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
```

- [ ] **Paso 4: Correrlo y confirmar que pasa**

Correr: `cd mobile && npx jest test/services/parseDecimal.test.ts --forceExit`
Esperado: PASA (10 tests).

- [ ] **Paso 5: Adoptarlo en `mobile/app/(app)/producto/[barcode].tsx`**

Importar al principio del archivo, junto a los otros imports de `src/services`:

```ts
import { parseDecimal } from '../../../src/services/parseDecimal';
```

En `save`, reemplazar:

```ts
    const costUsd = Number(form.costUsd);
    if (!Number.isFinite(costUsd) || costUsd < 0) {
```

por:

```ts
    const costUsd = parseDecimal(form.costUsd);
    // `=== null` first so TypeScript narrows `number | null` to `number` for
    // the mutation below — `Number.isFinite` is not a type guard.
    if (costUsd === null || costUsd < 0) {
```

En `applyDelta`, reemplazar:

```ts
    const value = Number(delta);
    if (!Number.isFinite(value) || value === 0) {
```

por:

```ts
    const value = parseDecimal(delta);
    if (value === null || value === 0) {
```

- [ ] **Paso 6: Adoptarlo en `mobile/app/(app)/producto/nuevo.tsx`**

Importar:

```ts
import { parseDecimal } from '../../../src/services/parseDecimal';
```

Reemplazar:

```ts
  const costEntered = form.costUsd.trim() !== '';
  const costUsd = Number(form.costUsd);
  const preview = calculatePriceVes(costUsd, marginFor(form.department), bcvRate);

  const submit = async () => {
    const stock = Number(form.stock);
    if (!Number.isFinite(costUsd) || costUsd < 0 || !Number.isFinite(stock) || stock < 0) {
```

por:

```ts
  const costEntered = form.costUsd.trim() !== '';
  const costUsd = parseDecimal(form.costUsd);
  // calculatePriceVes takes `number | null` and reports a null cost as
  // missing, so an unparseable cost previews as "cost invalid", not as a price.
  const preview = calculatePriceVes(costUsd, marginFor(form.department), bcvRate);

  const submit = async () => {
    const stock = parseDecimal(form.stock);
    if (costUsd === null || costUsd < 0 || stock === null || stock < 0) {
```

**Cambio de comportamiento, deliberado:** antes, un campo de existencia vacío se guardaba como existencia `0`, porque `Number('')` es `0`. Ahora se rechaza con el mensaje que ya existe ("El costo y la existencia deben ser números válidos."). Un producto creado sin que nadie haya escrito su existencia no tiene existencia cero: no tiene existencia conocida. Es la regla del proyecto de decir lo que falta y no inventarlo.

Los dos valores quedan narrowed a `number` por las comprobaciones `=== null`, así que la llamada a `create.mutateAsync` que sigue no necesita cambios.

- [ ] **Paso 7: Correr tipos y el suite completo**

Correr: `cd mobile && npx tsc --noEmit && npx jest --forceExit`
Esperado: cero errores de tipos; 177 tests pasando (167 de base + 10 nuevos).

- [ ] **Paso 8: Commit**

```bash
git add mobile/src/services/parseDecimal.ts mobile/test/services/parseDecimal.test.ts "mobile/app/(app)/producto"
git commit -m "feat(mobile): parse decimals typed with a comma, everywhere a number is typed"
```

---

### Tarea 2: Escrituras de configuración — API y hooks de mutación

**Archivos:**
- Modificar: `mobile/src/services/api/config.ts`
- Modificar: `mobile/test/services/api/config.test.ts`
- Crear: `mobile/src/hooks/useConfigMutations.ts`
- Crear: `mobile/test/hooks/useConfigMutations.test.tsx`

**Interfaces:**
- Consume: `apiFetch<T>(path, init?)` de `mobile/src/services/api/client.ts`; los tipos `BcvRateResponse` y `MarginRule` de `mobile/src/types/api.ts`.
- Produce, en `mobile/src/services/api/config.ts`:
  - `todayRateDate(now?: Date): string`
  - `putBcvRate(rateDate: string, rate: number): Promise<BcvRateResponse>`
  - `upsertMargin(levelName: string, percentage: number): Promise<MarginRule>`
- Produce, en `mobile/src/hooks/useConfigMutations.ts`: `useConfigMutations()` que devuelve `{ setBcvRate, saveMargin }`, dos mutaciones de TanStack. `setBcvRate.mutateAsync(rate: number)` y `saveMargin.mutateAsync({ department: string, percentage: number })`. Las Tareas 3 y 4 los consumen.

`upsertMargin` fija `level: 'DEPARTAMENTO'` adentro y no lo recibe como parámetro: es el único nivel al que algo le puede hacer match (ver el spec), así que no tiene que ser posible pedir otro desde la app.

- [ ] **Paso 1: Escribir los tests que fallan en `mobile/test/services/api/config.test.ts`**

Cambiar la línea del import para incluir las funciones nuevas:

```ts
import { getBcvRate, getMargins, putBcvRate, upsertMargin, todayRateDate } from '../../../src/services/api/config';
```

Y agregar dentro del `describe('config api', ...)` existente, después del último `it`:

```ts
  it('putBcvRate sends the date and rate the backend requires', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ rateDate: '2026-09-26', rate: 36.5 });

    await expect(putBcvRate('2026-09-26', 36.5)).resolves.toEqual({ rateDate: '2026-09-26', rate: 36.5 });
    expect(apiFetch).toHaveBeenCalledWith('/bcv-rate', {
      method: 'PUT',
      body: JSON.stringify({ rateDate: '2026-09-26', rate: 36.5 }),
    });
  });

  it('upsertMargin always creates a DEPARTAMENTO rule, the only level anything can match', async () => {
    const rule = { id: '1', level: 'DEPARTAMENTO', level_name: 'Lacteos', percentage: 30 };
    (apiFetch as jest.Mock).mockResolvedValue(rule);

    await expect(upsertMargin('Lacteos', 30)).resolves.toEqual(rule);
    expect(apiFetch).toHaveBeenCalledWith('/margins', {
      method: 'POST',
      body: JSON.stringify({ level: 'DEPARTAMENTO', levelName: 'Lacteos', percentage: 30 }),
    });
  });

  it('todayRateDate derives the date in UTC, exactly as GET /bcv-rate does', () => {
    // 21:00 on the 26th in Caracas (UTC-4) is 01:00 on the 27th in UTC. The
    // backend reads "today" as the 27th, so the rate has to be written for the
    // 27th too — a local-time date would write it for the 26th and the
    // register would report that no rate is set.
    expect(todayRateDate(new Date('2026-09-27T01:00:00Z'))).toBe('2026-09-27');
    expect(todayRateDate(new Date('2026-09-26T12:00:00Z'))).toBe('2026-09-26');
  });
```

- [ ] **Paso 2: Correrlos y confirmar que fallan**

Correr: `cd mobile && npx jest test/services/api/config.test.ts --forceExit`
Esperado: FALLA — `putBcvRate`, `upsertMargin` y `todayRateDate` no están exportados.

- [ ] **Paso 3: Implementarlos en `mobile/src/services/api/config.ts`**

Agregar al final del archivo, después de `getMargins`:

```ts
/**
 * The date a rate is saved for. It MUST be derived exactly as the backend
 * derives "today" in GET /bcv-rate (and in the sale audit): the UTC date.
 *
 * Do not "fix" this to local time. From 20:00 to midnight in Caracas (UTC-4)
 * the local date is one day behind the UTC one, so a local-time date would
 * write the rate for yesterday-in-UTC while the register reads today-in-UTC —
 * four hours every evening in which the register reports no rate set.
 *
 * `now` is a parameter only so a test can pin the rollover.
 */
export function todayRateDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function putBcvRate(rateDate: string, rate: number): Promise<BcvRateResponse> {
  return apiFetch<BcvRateResponse>('/bcv-rate', {
    method: 'PUT',
    body: JSON.stringify({ rateDate, rate }),
  });
}

/**
 * Always a DEPARTAMENTO rule. The endpoint also accepts CATEGORIA and
 * SUBCATEGORIA, but a product row carries a department and nothing else a rule
 * could match on, so any other level would be configuration that silently does
 * nothing. POST /margins upserts, so this both creates and updates.
 */
export async function upsertMargin(levelName: string, percentage: number): Promise<MarginRule> {
  return apiFetch<MarginRule>('/margins', {
    method: 'POST',
    body: JSON.stringify({ level: 'DEPARTAMENTO', levelName, percentage }),
  });
}
```

- [ ] **Paso 4: Correrlos y confirmar que pasan**

Correr: `cd mobile && npx jest test/services/api/config.test.ts --forceExit`
Esperado: PASA (8 tests: los 5 existentes y 3 nuevos).

- [ ] **Paso 5: Escribir el test que falla para los hooks**

```tsx
// mobile/test/hooks/useConfigMutations.test.tsx
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../../src/services/api/config', () => ({
  ...jest.requireActual('../../src/services/api/config'),
  putBcvRate: jest.fn(),
  upsertMargin: jest.fn(),
}));

import { putBcvRate, upsertMargin, todayRateDate } from '../../src/services/api/config';
import { useConfigMutations } from '../../src/hooks/useConfigMutations';

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useConfigMutations', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (putBcvRate as jest.Mock).mockReset().mockResolvedValue({ rateDate: '2026-09-26', rate: 36.5 });
    (upsertMargin as jest.Mock).mockReset().mockResolvedValue({});
  });

  it('saves the rate for the UTC date the backend reads, so the caller cannot pick another', async () => {
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.setBcvRate.mutateAsync(36.5);
    });

    expect(putBcvRate).toHaveBeenCalledWith(todayRateDate(), 36.5);
  });

  it('invalidates the rate after saving it', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.setBcvRate.mutateAsync(36.5);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['bcv-rate'] }));
  });

  it('saves a margin for the department and invalidates the margins', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.saveMargin.mutateAsync({ department: 'Lacteos', percentage: 30 });
    });

    expect(upsertMargin).toHaveBeenCalledWith('Lacteos', 30);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['margins'] }));
  });

  it('does not invalidate when saving fails', async () => {
    (putBcvRate as jest.Mock).mockRejectedValue(new Error('nope'));
    (upsertMargin as jest.Mock).mockRejectedValue(new Error('nope'));
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.setBcvRate.mutateAsync(36.5).catch(() => undefined);
      await result.current.saveMargin
        .mutateAsync({ department: 'Lacteos', percentage: 30 })
        .catch(() => undefined);
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
```

Las query keys `['bcv-rate']` y `['margins']` son las que ya usa `mobile/src/hooks/usePricingInputs.ts`; hay que invalidar exactamente esas para que la caja vea el valor nuevo.

- [ ] **Paso 6: Correrlo y confirmar que falla**

Correr: `cd mobile && npx jest test/hooks/useConfigMutations.test.tsx --forceExit`
Esperado: FALLA — `Cannot find module '../../src/hooks/useConfigMutations'`.

- [ ] **Paso 7: Implementar `mobile/src/hooks/useConfigMutations.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { putBcvRate, todayRateDate, upsertMargin } from '../services/api/config';

/**
 * Saving the day's rate and a department's margin. Each invalidates the exact
 * query key `usePricingInputs` reads, so the register and the product screens
 * price with the new value without anyone refreshing by hand.
 */
export function useConfigMutations() {
  const queryClient = useQueryClient();

  // The date is minted here, not taken from the caller: it has to be the UTC
  // date the backend reads "today" as, and a caller that could pass its own
  // could pass a local-time one. See `todayRateDate`.
  const setBcvRate = useMutation({
    mutationFn: (rate: number) => putBcvRate(todayRateDate(), rate),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bcv-rate'] }),
  });

  const saveMargin = useMutation({
    mutationFn: ({ department, percentage }: { department: string; percentage: number }) =>
      upsertMargin(department, percentage),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['margins'] }),
  });

  return { setBcvRate, saveMargin };
}
```

- [ ] **Paso 8: Correr tipos y el suite completo**

Correr: `cd mobile && npx tsc --noEmit && npx jest --forceExit`
Esperado: cero errores de tipos; 184 tests pasando (177 + 3 de API + 4 de hooks).

- [ ] **Paso 9: Commit**

```bash
git add mobile/src/services/api/config.ts mobile/test/services/api/config.test.ts mobile/src/hooks/useConfigMutations.ts mobile/test/hooks/useConfigMutations.test.tsx
git commit -m "feat(mobile): add the rate and margin writes, pinned to the backend's UTC date"
```

---

### Tarea 3: Navegación de Configuración y la pantalla de tasa

**Archivos:**
- Borrar: `mobile/app/(app)/configuracion.tsx`
- Crear: `mobile/app/(app)/configuracion/_layout.tsx`
- Crear: `mobile/app/(app)/configuracion/index.tsx`
- Crear: `mobile/app/(app)/configuracion/tasa.tsx`

**Interfaces:**
- Consume: `parseDecimal` (Tarea 1); `useConfigMutations().setBcvRate` (Tarea 2); `usePricingInputs()` (existente, devuelve `{ bcvRate, isLoading, isError, ... }`); `getBcvRate` vía la query `['bcv-rate']`.
- Produce: la ruta `/(app)/configuracion/tasa` y el menú en `/(app)/configuracion`. La Tarea 4 agrega su entrada al menú.

Sin test unitario: son pantallas, y la lógica que pintan está cubierta en las Tareas 1 y 2.

- [ ] **Paso 1: Borrar el placeholder y crear el layout**

Borrar `mobile/app/(app)/configuracion.tsx`. Crear `mobile/app/(app)/configuracion/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

// Same reason as producto/_layout.tsx: without a nested layout, Expo Router
// flattens every file in this directory into its own entry in the parent Tabs
// navigator. Unlike `producto`, this directory IS a visible tab — the existing
// `<Tabs.Screen name="configuracion">` in app/(app)/_layout.tsx resolves to
// this Stack, and needs no change.
export default function ConfiguracionLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

No tocar `mobile/app/(app)/_layout.tsx`: su entrada `configuracion` sigue siendo la misma pestaña, ADMIN-only vía `TABS_BY_ROLE`.

- [ ] **Paso 2: Crear el menú `mobile/app/(app)/configuracion/index.tsx`**

Solo con la entrada de tasa. **No agregar todavía la de márgenes**: esa pantalla no existe hasta la Tarea 4, y con rutas tipadas un enlace a ella rompería `tsc` en cuanto se generen los tipos (ver Restricciones globales). La Tarea 4 la agrega.

```tsx
import { ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { List, Text } from 'react-native-paper';

export default function Configuracion() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">Configuración</Text>
      <List.Item
        title="Tasa BCV"
        description="La tasa del día con la que se calculan todos los precios"
        left={(props) => <List.Icon {...props} icon="currency-usd" />}
        onPress={() => router.push('/(app)/configuracion/tasa')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
});
```

- [ ] **Paso 3: Crear la pantalla `mobile/app/(app)/configuracion/tasa.tsx`**

```tsx
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
```

Los dos códigos de `SAVE_MESSAGE_BY_CODE` están verificados contra el backend: `FORBIDDEN` es el 403 que lanza `requireRole` (`backend/src/plugins/authGuard.ts:69`) y `VALIDATION_ERROR` es el 422 que produce un `ZodError` (`backend/src/plugins/errorHandler.ts:20`). No inventar otros: un mapa con códigos que el backend nunca envía cae siempre al mensaje genérico, que es justo lo que este mapa existe para evitar.

- [ ] **Paso 4: Verificar tipos y el suite**

Correr: `cd mobile && npx tsc --noEmit && npx jest --forceExit`
Esperado: cero errores de tipos; 184 tests pasando (sin tests nuevos en esta tarea).

- [ ] **Paso 5: Verificar en el navegador**

Desde el worktree, con Bash: `cd mobile && npx expo start --web`. Con el backend caído, confirmar que la pestaña Configuración abre el menú, que "Tasa BCV" navega a la pantalla, y que la pantalla muestra el estado de **error** ("No se pudo cargar la tasa") con Reintentar — no el de "no hay tasa cargada". Si se puede sembrar una sesión y un stub de `fetch` desde la consola (ver `mobile/AGENTS.md`; el sub-proyecto 4 lo hizo así), confirmar además: el estado "no hay tasa", el rechazo de `0` y de `abc` con su razón, y que `36,50` se acepta. **Revertir cualquier sembrado antes del commit.**

Después, **detener el servidor de desarrollo** y volver a correr `npx tsc --noEmit`: ahora existen los tipos de rutas generados y valida el `router.push('/(app)/configuracion/tasa')` de verdad.

Decir en el reporte, sin rodeos, qué no se pudo ejercitar: el guardado real necesita un backend corriendo.

- [ ] **Paso 6: Commit**

```bash
git add "mobile/app/(app)/configuracion.tsx" "mobile/app/(app)/configuracion"
git commit -m "feat(mobile): turn Configuración into a stack and add the BCV rate screen"
```

(`git add` del archivo borrado registra su eliminación.)

---

### Tarea 4: Márgenes por departamento

**Archivos:**
- Crear: `mobile/src/services/departmentMargins.ts`
- Crear: `mobile/test/services/departmentMargins.test.ts`
- Crear: `mobile/app/(app)/configuracion/margenes.tsx`
- Modificar: `mobile/app/(app)/configuracion/index.tsx`

**Interfaces:**
- Consume: `Product` y `MarginRule` de `mobile/src/types/api.ts`; `parseDecimal` (Tarea 1); `useConfigMutations().saveMargin` (Tarea 2); `useProducts()` (existente); `getMargins` vía la query `['margins']`.
- Produce: `departmentMargins(products: Product[], rules: MarginRule[]): DepartmentMargins` en `mobile/src/services/departmentMargins.ts`, con:

```ts
export interface DepartmentMargin {
  department: string;
  percentage: number | null;
}

export interface DepartmentMargins {
  departments: DepartmentMargin[];
  unmatchedRules: MarginRule[];
}
```

Esta es la lógica de la única decisión de diseño real del spec, así que vive en una función pura con tests y no en la pantalla.

- [ ] **Paso 1: Escribir el test que falla**

```ts
// mobile/test/services/departmentMargins.test.ts
import { departmentMargins } from '../../src/services/departmentMargins';
import type { MarginRule, Product } from '../../src/types/api';

function product(barcode: string, department: string): Product {
  return { barcode, name: barcode, brand: 'B', department, unit: 'unidad', costUsd: 1, stock: 1 };
}

function rule(level: MarginRule['level'], levelName: string, percentage: number): MarginRule {
  return { id: `${level}-${levelName}`, level, level_name: levelName, percentage };
}

describe('departmentMargins', () => {
  it('lists each catalog department once, with its margin', () => {
    const result = departmentMargins(
      [product('1', 'Lacteos'), product('2', 'Lacteos'), product('3', 'Granos')],
      [rule('DEPARTAMENTO', 'Lacteos', 30), rule('DEPARTAMENTO', 'Granos', 15)]
    );

    expect(result.departments).toEqual([
      { department: 'Granos', percentage: 15 },
      { department: 'Lacteos', percentage: 30 },
    ]);
  });

  it('reports a department with no margin as null, not zero', () => {
    // Zero is a real margin (selling at cost). A department with no rule
    // cannot be priced at all, and the screen must be able to tell them apart.
    const result = departmentMargins([product('1', 'Limpieza')], []);

    expect(result.departments).toEqual([{ department: 'Limpieza', percentage: null }]);
  });

  it('keeps a margin of zero as zero', () => {
    const result = departmentMargins([product('1', 'Granos')], [rule('DEPARTAMENTO', 'Granos', 0)]);

    expect(result.departments).toEqual([{ department: 'Granos', percentage: 0 }]);
  });

  it('matches by exact string, the way marginFor does at the register', () => {
    // usePricingInputs.marginFor compares level_name to the product's
    // department exactly. If this function matched more loosely, the screen
    // would show a margin as set while the register still refused to price.
    const result = departmentMargins(
      [product('1', 'Lácteos')],
      [rule('DEPARTAMENTO', 'Lacteos', 30)]
    );

    expect(result.departments).toEqual([{ department: 'Lácteos', percentage: null }]);
    expect(result.unmatchedRules).toEqual([rule('DEPARTAMENTO', 'Lacteos', 30)]);
  });

  it('reports rules nothing in the catalog matches, instead of hiding them', () => {
    const result = departmentMargins(
      [product('1', 'Granos')],
      [
        rule('DEPARTAMENTO', 'Granos', 15),
        rule('CATEGORIA', 'Bebidas', 20),
        rule('SUBCATEGORIA', 'Refrescos', 25),
        rule('DEPARTAMENTO', 'Descontinuado', 10),
      ]
    );

    expect(result.departments).toEqual([{ department: 'Granos', percentage: 15 }]);
    expect(result.unmatchedRules).toEqual([
      rule('CATEGORIA', 'Bebidas', 20),
      rule('SUBCATEGORIA', 'Refrescos', 25),
      rule('DEPARTAMENTO', 'Descontinuado', 10),
    ]);
  });

  it('ignores a CATEGORIA rule that happens to share a department name', () => {
    // Only DEPARTAMENTO rules price anything, so a CATEGORIA "Granos" must not
    // be shown as the margin of the Granos department.
    const result = departmentMargins([product('1', 'Granos')], [rule('CATEGORIA', 'Granos', 50)]);

    expect(result.departments).toEqual([{ department: 'Granos', percentage: null }]);
    expect(result.unmatchedRules).toEqual([rule('CATEGORIA', 'Granos', 50)]);
  });

  it('skips a product with a blank department rather than listing an empty row', () => {
    const result = departmentMargins([product('1', ''), product('2', '   '), product('3', 'Granos')], []);

    expect(result.departments).toEqual([{ department: 'Granos', percentage: null }]);
  });

  it('returns nothing for an empty catalog and no rules', () => {
    expect(departmentMargins([], [])).toEqual({ departments: [], unmatchedRules: [] });
  });
});
```

- [ ] **Paso 2: Correrlo y confirmar que falla**

Correr: `cd mobile && npx jest test/services/departmentMargins.test.ts --forceExit`
Esperado: FALLA — `Cannot find module '../../src/services/departmentMargins'`.

- [ ] **Paso 3: Implementar `mobile/src/services/departmentMargins.ts`**

```ts
import type { MarginRule, Product } from '../types/api';

export interface DepartmentMargin {
  department: string;
  /** null means no rule: the department cannot be priced. Zero is a real
   *  margin (selling at cost) and is kept as zero. */
  percentage: number | null;
}

export interface DepartmentMargins {
  departments: DepartmentMargin[];
  /** Rules nothing in the catalog matches — any CATEGORIA or SUBCATEGORIA
   *  rule, and any DEPARTAMENTO rule whose name no product carries. Reported
   *  rather than hidden, so a percentage in the database is never invisible. */
  unmatchedRules: MarginRule[];
}

/**
 * Which catalog departments can be priced, and at what margin.
 *
 * Matching is by EXACT string, deliberately identical to `marginFor` in
 * `usePricingInputs`. A looser match here (case, accents, whitespace) would
 * show a margin as set while the register still refused to price the product.
 * The departments come from the catalog rather than from free text so that the
 * margin can never be saved under a name nothing matches.
 */
export function departmentMargins(products: Product[], rules: MarginRule[]): DepartmentMargins {
  const departmentRules = new Map<string, number>();
  for (const rule of rules) {
    if (rule.level === 'DEPARTAMENTO') {
      departmentRules.set(rule.level_name, rule.percentage);
    }
  }

  const catalogDepartments = new Set<string>();
  for (const product of products) {
    if (product.department.trim() !== '') {
      catalogDepartments.add(product.department);
    }
  }

  const departments = [...catalogDepartments]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((department) => ({ department, percentage: departmentRules.get(department) ?? null }));

  const unmatchedRules = rules.filter(
    (rule) => rule.level !== 'DEPARTAMENTO' || !catalogDepartments.has(rule.level_name)
  );

  return { departments, unmatchedRules };
}
```

`departmentRules.get(department) ?? null` conserva un margen `0`: `??` solo reemplaza `undefined` y `null`, no `0`. Usar `||` acá convertiría un margen de cero en "sin margen" — no hacerlo.

- [ ] **Paso 4: Correrlo y confirmar que pasa**

Correr: `cd mobile && npx jest test/services/departmentMargins.test.ts --forceExit`
Esperado: PASA (8 tests).

- [ ] **Paso 5: Crear la pantalla `mobile/app/(app)/configuracion/margenes.tsx`**

```tsx
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
      setEditing(null);
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
```

`FORBIDDEN` y `VALIDATION_ERROR` son los mismos códigos verificados de la Tarea 3 (`authGuard.ts:69`, `errorHandler.ts:20`).

- [ ] **Paso 6: Agregar la entrada al menú en `mobile/app/(app)/configuracion/index.tsx`**

Ahora que `margenes.tsx` existe, el enlace es válido. Agregar después del `List.Item` de "Tasa BCV":

```tsx
      <List.Item
        title="Márgenes"
        description="El margen de cada departamento del inventario"
        left={(props) => <List.Icon {...props} icon="percent" />}
        onPress={() => router.push('/(app)/configuracion/margenes')}
      />
```

- [ ] **Paso 7: Verificar tipos y el suite**

Correr: `cd mobile && npx tsc --noEmit && npx jest --forceExit`
Esperado: cero errores de tipos; 192 tests pasando (184 + 8).

- [ ] **Paso 8: Verificar en el navegador**

Desde el worktree, con Bash: `cd mobile && npx expo start --web`. Con el backend caído, confirmar que el menú muestra las dos entradas, que "Márgenes" navega, y que la pantalla muestra el estado de **error** — no una lista de departamentos "sin margen". Si se siembra una sesión y un stub de `fetch` (ver `mobile/AGENTS.md`), confirmar además: los departamentos salen del catálogo, uno sin regla dice "Sin margen — no se puede vender", tocar uno abre el editor, `12,5` se acepta, `-5` y `abc` se rechazan con su razón, y una regla `CATEGORIA` sembrada aparece bajo "Reglas que no se aplican". **Revertir cualquier sembrado antes del commit.**

Después, **detener el servidor de desarrollo** y volver a correr `npx tsc --noEmit` con los tipos de rutas ya generados.

Decir en el reporte qué no se pudo ejercitar.

- [ ] **Paso 9: Commit**

```bash
git add mobile/src/services/departmentMargins.ts mobile/test/services/departmentMargins.test.ts "mobile/app/(app)/configuracion"
git commit -m "feat(mobile): add margins by catalog department, with unmatched rules shown"
```

---

## Notas de auto-revisión

- **Cobertura del spec:** navegación como Stack sin tocar el layout de pestañas (Tarea 3); tasa con los cuatro estados, rechazo de `<= 0`, y fecha UTC fijada en un solo lugar (Tareas 2 y 3); márgenes derivados del catálogo, solo `DEPARTAMENTO`, match exacto, y reglas sin match visibles en solo lectura (Tarea 4); `parseDecimal` con los casos del spec — coma, vacío, separador solo, varios separadores, espacios (Tarea 1); mutaciones que invalidan las mismas keys que lee `usePricingInputs` (Tarea 2). `PUT /margins/:id` no se usa, como dice el spec.
- **Agregados más allá del spec, marcados:** adoptar `parseDecimal` en las dos pantallas de producto (Tarea 1, pasos 5–7), con su cambio de comportamiento documentado: una existencia vacía ya no se guarda como 0.
- **Consistencia de tipos:** `parseDecimal` devuelve `number | null` y cada consumidor compara con `=== null` antes de usar el valor, que es lo que hace que TypeScript lo acote a `number`. `upsertMargin(levelName, percentage)` y `saveMargin.mutateAsync({ department, percentage })` usan el mismo par en el mismo orden. `MarginRule` es el tipo existente, con `level_name` en snake_case porque es lo que devuelve el backend.
- **Rutas tipadas:** cada tarea enlaza solo a pantallas que ya existen al momento de su commit — la Tarea 3 enlaza solo `tasa`, la Tarea 4 agrega `margenes` al crear la pantalla.
- **Códigos de error verificados:** `FORBIDDEN` (`authGuard.ts:69`) y `VALIDATION_ERROR` (`errorHandler.ts:20`) se leyeron del backend al escribir el plan, no se supusieron.
