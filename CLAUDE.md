# Valent-App

Inventario + POS híbrido: app móvil Expo/React Native (TypeScript) + backend API propio +
Neon (Postgres, multi-tenant) + Google Sheets (catálogo/stock/ventas).

## Por qué existe un backend intermedio

La app móvil **nunca** tiene credenciales de Neon ni del Service Account de Google Sheets.
Un APK/IPA se puede descompilar, así que cualquier secreto embebido quedaría expuesto a
cualquiera que instale la app. El backend (`backend/`) es lo único que habla con Neon y
Sheets directamente; la app habla HTTPS con el backend usando un JWT por dispositivo.

Specs y planes completos en `docs/superpowers/specs/` y `docs/superpowers/plans/`.

## Arquitectura

```
backend/                      Node.js + TypeScript (ESM) + Fastify
  src/
    config/env.ts             Carga/valida variables de entorno (zod)
    db/                       Cliente Neon (pg) + migration runner propio
    sheets/
      client.ts               Wrapper delgado sobre Google Sheets API v4
      queue.ts                Cola por-cuenta (p-queue, concurrency:1) con
                               reintentos 429/5xx — serializa TODAS las
                               escrituras a Sheets de una cuenta
    modules/
      auth/                   JWT de dispositivo, POST /auth/link-device,
                               GET /auth/me
      devices/                Administración de dispositivos + POST /devices/invite
      bcv/                    Tasa oficial del día
      margins/                Márgenes por categoría/subcategoría/departamento
      customers/               CRUD clientes, credit-check, QR linking
      inventory/               Productos/stock (vía Sheets, siempre a través de sheetsQueue)
      sales/                   Ventas (vía Sheets, re-valida crédito server-side)
    plugins/
      errorHandler.ts         ApiError + forma uniforme { error: { code, message } }
      authGuard.ts             requireAuth / requireRole / requireAuthAllowRevoked,
                               chequea devices.status en vivo (cache 30s)
  migrations/                 SQL plano, aplicado por src/db/migrate.ts
  test/                       Vitest; pg-mem para Postgres, googleapis mockeado para Sheets

mobile/                       Expo SDK 57 + React Native + TypeScript (strict, sin `any`)
  app/                        SOLO rutas (Expo Router, file-based). Cero lógica de negocio aquí.
    _layout.tsx               Providers: ErrorBoundary > Paper > QueryClient > Toast > Stack
    index.tsx                 Gate de redirección según sesión y rol
    (auth)/home.tsx           Home / vinculación (placeholder hasta sub-proyecto 2)
    (app)/                    Tabs con visibilidad por rol + 4 pantallas placeholder
  src/
    components/ui/            Atomic Design: Button, TextInput, Card, Skeleton, EmptyState
    hooks/                    useSession, useAuthStatus, useSessionHydration, useRevocationGuard
    services/
      api/client.ts           apiFetch tipado: adjunta el JWT, signOut() en 401
      api/auth.ts             getAuthMe + readDeviceIdFromJwt (hint local NO confiable)
      session.ts              signIn/signOut: memoria + disco + caché de queries, siempre juntos
      storage/secureStore.ts  Adaptador por plataforma (expo-secure-store nativo / memoria en web)
      storage/secureSession.ts  Persistencia del JWT, valida al leer y borra lo corrupto
      queryClient.ts          Singleton de TanStack Query (se limpia en signOut)
    state/sessionStore.ts     Zustand: sesión + flag de hidratación
    theme/                    Tema M3 (Paper) + tema de navegación derivado
  test/                       Jest (jest-expo); solo lógica pura, sin tests de render
```

**Web es target de desarrollo/verificación, NO de publicación.** El escáner de códigos de barras,
el Hardware ID y el almacenamiento cifrado no funcionan de verdad en navegador. En web el JWT vive
en memoria (se pierde al recargar) — **nunca** usar `localStorage`/`AsyncStorage` para el JWT, eso
violaría la regla de no persistir credenciales sin cifrar. Ver `mobile/AGENTS.md`.

Reglas de oro del lado móvil:
- La lógica de negocio vive en `src/hooks/` o `src/services/`, **nunca** dentro de `app/`.
- Sesión: usar siempre `signIn()`/`signOut()` — nunca `setSession`/`saveSession` por separado
  (memoria y disco se desincronizan y la sesión se evapora al reiniciar).
- El payload del JWT decodificado en el cliente es una **pista local no confiable**: sirve para
  obtener el `deviceId`, jamás para decidir permisos (eso lo hace el backend en cada request).

## Modelo multi-tenant

Una cuenta (`accounts`) = una empresa cliente = una hoja de Google Sheets propia
(`accounts.spreadsheet_id`). El Service Account de Google es compartido entre cuentas pero
debe tener acceso de editor concedido individualmente a cada hoja (paso manual de
aprovisionamiento, ver "Pendiente" abajo).

## Auth y dispositivos

- Vinculación: un ADMIN genera un **token de invitación** (`POST /devices/invite`,
  de un solo uso, expira en 24h, lleva el rol embebido) → el dispositivo lo consume en
  `POST /auth/link-device` → recibe un JWT firmado (30 días) con `{deviceId, accountId, role}`.
  El rol **nunca** lo elige el cliente — viene del token de invitación.
- Revocación: `PATCH /devices/:id` (ADMIN) marca `REVOKED`. `requireAuth` lo verifica en cada
  request contra Postgres (con caché de 30s por proceso) y rechaza con 401 `DEVICE_REVOKED`.
  `GET /auth/me` es la única ruta que sigue siendo alcanzable para un dispositivo revocado
  (para que el cliente detecte el estado), pero no le renueva el JWT.
- Roles: `ADMIN`, `INVENTARIO`, `POST_VENTA`, `CLIENTE_PEDIDOS`.

## Concurrencia — tres mecanismos, cada uno para una invariante distinta

1. **`SheetsQueue`** (por cuenta, en memoria): serializa todas las escrituras a la hoja de
   una cuenta. Usado para inventario y ventas.
2. **Transacción con cliente reservado** (`pool.connect()` + `BEGIN`/`COMMIT`, nunca
   `pool.query('BEGIN')` suelto): usado en migraciones y en el flujo de venta a crédito.
3. **`SELECT ... FOR UPDATE`**: bloquea la fila del cliente o del invite token mientras dura
   el chequeo+escritura, para que dos requests concurrentes no pasen ambos una validación que
   solo debería aprobar a uno (crédito, invite de un solo uso).

Regla de oro para no reintroducir bugs de concurrencia: **nunca hagas
"leer → decidir → escribir" repartido entre fuera y dentro de un `enqueue`/transacción** —
todo el ciclo leer-decidir-escribir tiene que vivir dentro del mismo bloque serializado.
(Bug real encontrado y corregido tres veces durante la implementación: Tarea 13 - duplicado
de código de barras; Tarea 14 - límite de crédito; y en la revisión final - orden de la
transacción de venta a crédito vs. escritura en Sheets.)

## Pendiente

- [x] Sub-proyecto 1: Fundación móvil — hecho. Expo Router, tema M3 claro/oscuro, Atomic Design
      en `src/components/ui`, hooks de negocio, `src/services/` aislado, tipado estricto sin
      `any`, ErrorBoundary, Toasts y Skeletons. Los hooks `useSheetsSync`/`useCreditValidation`/
      `useBCVRate` NO se construyeron por YAGNI (no tienen consumidor todavía) — se agregan en el
      sub-proyecto que primero los necesite, siguiendo el patrón de `useAuthStatus`.
- [x] Sub-proyecto 2: Auth + vinculación de dispositivo — hecho. Flujo de vinculación por invite
      token (QR con `expo-camera` + entrada manual de respaldo), nombre de dispositivo sugerido y
      editable, errores mapeados por código del backend, pantalla ADMIN para generar invitaciones
      con QR, Hardware ID por plataforma, y el script `npm run create-invite` que resuelve el
      arranque del primer ADMIN de una cuenta. Cerró además los 4 pendientes de sesión que había
      dejado el sub-proyecto 1.
      **PENDIENTE DE VERIFICACIÓN EN VIVO:** el flujo completo nunca se corrió punta a punta (no
      hay `backend/.env`). Sin correr: el round trip real de `POST /devices/invite`, un escaneo de
      cámara real, y la corrección de navegación observada en la app. Tres de los cuatro hallazgos
      de la revisión final eran justo lo que una sola corrida en vivo detecta primero.
- [x] Sub-proyecto 3: Inventario — hecho. Lista con búsqueda en el dispositivo, escáner de código
      de barras (componente `BarcodeScanner` reutilizable), ficha con edición y ajuste de stock,
      y alta de productos. Agregó al backend la rama de lista de `GET /products` y
      `PUT /products/:barcode`, y cerró los 3 pendientes del sub-proyecto 2.
      **PENDIENTE DE VERIFICACIÓN EN VIVO** (igual que el sub-proyecto 2, no hay `backend/.env`):
      la migración `003_stock_adjustments.sql` nunca corrió contra Postgres real, y ni los 409 ni
      el registro de idempotencia ni el round trip `NUMERIC`→string se ejercitaron fuera de pg-mem.
- [x] Sub-proyecto 4: POS/PostVenta — hecho. Caja con búsqueda y escáner, carrito, los cinco
      métodos de pago, chequeo de crédito en vivo, y `POST /sales` descontando stock **dentro
      del mismo callback de la cola** que graba la venta. Agregó la auditoría server-side del
      total y `backend/src/modules/inventory/products.ts` (los helpers de fila de producto,
      extraídos para que ventas los reuse).
      **PENDIENTE DE VERIFICACIÓN EN VIVO** (igual que los sub-proyectos 2 y 3, no hay
      `backend/.env`). Lo que una sola corrida detectaría primero, en orden:
      1. Que un escaneo real agregue **exactamente una** unidad. `BarcodeScanner` dispara
         `onBarcodeScanned` en cada frame; el guard es un ref (no `useState`), pero eso nunca
         corrió contra una cámara. Es lo único no verificado que puede sobrecobrar a un cliente.
      2. `valueInputOption: 'USER_ENTERED'` contra una hoja en locale es-VE. Ahora **cada** venta
         reescribe el `costUsd` de cada línea, así que si Sheets reinterpreta el número, corrompe
         la columna de costo — y con ella todo precio futuro.
      3. La forma real de la pestaña `Ventas`: se mandan 9 valores a `Ventas!A:I`.
      4. `SELECT ... FOR UPDATE` sobre la fila del cliente. `backend/test/sales.test.ts` lo tiene
         como `it.skip` porque pg-mem no implementa row locking: la garantía de concurrencia más
         load-bearing de la ruta de crédito tiene cero cobertura ejecutada. Dos cajas, un cliente
         a crédito, cobros simultáneos, contra una rama real de Neon.
      Decisiones de dinero que conviene no reabrir sin leer esto:
      - **USD es la fuente de verdad; los bolívares se derivan.** `totalVes = round2(totalUsd ×
        tasa)`. Todo lo durable del sistema ya está en USD (el costo en la hoja, `credit_limit`,
        `current_debt_balance`), y el bolívar es la presentación del día. Antes eran dos redondeos
        independientes y los dos ledgers no cuadraban línea por línea.
      - La tolerancia de la auditoría está **denominada en bolívares**: el cliente redondea el
        precio unitario a centavos de dólar y después convierte, así que el residuo por unidad es
        `0,005 × tasa`, no `0,005`. Sin ese factor, el 86% de las ventas correctas dispara una
        advertencia falsa (medido sobre 200.000 carritos).
      - El `appendRow` de la venta está **deliberadamente excluido** de los reintentos de
        `SheetsQueue`: no se puede distinguir "grabó y después falló" de "nunca grabó", y
        reintentar duplicaría la fila con el mismo `saleId`.
- [x] Sub-proyecto 5A: Configuración — tasa BCV y márgenes — hecho. Sin backend nuevo.
      Desbloquea la caja, que se niega a cobrar sin tasa del día ni margen del departamento.
      Márgenes siempre a nivel `DEPARTAMENTO` y por coincidencia de string **exacta**, igual
      que `marginFor` (las reglas que no coinciden con nada se muestran, no se ocultan).
      `parseDecimal` acepta la coma decimal en todo campo numérico.
      **No reabrir:** la fecha de la tasa es la fecha **UTC** (`todayRateDate`), igual que el
      "hoy" del backend. En hora local, de 20:00 a medianoche en Caracas la tasa se grabaría
      para el día equivocado y la caja diría que no hay tasa.
      **PENDIENTE DE VERIFICACIÓN EN VIVO** (igual que 2–4): ninguna de las dos pantallas se
      vio contra un backend real. La revisión final encontró que `GET /bcv-rate` devolvía la
      fecha como `Date` serializado (corregido) — justo la clase de bug que pg-mem no delata.
- [ ] Sub-proyecto 5B: Crédito y Fidelidad. La premisa original ("UI sobre endpoints ya
      existentes") era falsa: no hay endpoints de `loyalty_levels`, no se puede editar un
      cliente, y **no hay forma de registrar un pago** (la deuda solo sube). Ya decidido (ver
      spec 5A): pagos en USD en una tabla nueva `payments` de solo-agregado, sobrepago
      rechazado con el monto adeudado, y corregir los gates de rol de `GET/POST /customers`
      (hoy `CLIENTE_PEDIDOS` puede listar saldos de deuda).
- [ ] Sub-proyecto 6: QR de cliente (generación con react-native-qrcode-svg, escaneo con
      expo-camera, catálogo de autoservicio y pedidos)
- [ ] Sub-proyecto 7: Dashboard y Configuración
- [ ] Backend: endpoint de listado/revocación de invite tokens pendientes (hoy solo se
      pueden crear, no listar ni cancelar antes de que expiren en 24h)
- [ ] Backend: la caché de estado de dispositivo en `authGuard.ts` es por proceso — si se
      despliega en más de una instancia, la revocación tarda hasta 30s en propagarse a las
      otras instancias. Necesita invalidación compartida (pub/sub o caché externo) antes de
      escalar horizontalmente.
- [ ] Backend: la compensación de saldo en una venta a crédito es best-effort (si el proceso
      muere entre el commit y la compensación, el saldo del cliente queda sin la venta
      correspondiente en el ledger). Falta un job periódico de reconciliación.
      **El sub-proyecto 4 ensanchó esta ventana y la decisión fue aceptarla y documentarla.**
      Antes solo entraba un fallo de infraestructura. Ahora que el descuento de stock vive en
      el mismo callback, también entran los rechazos de negocio del día a día:
      `INSUFFICIENT_STOCK` y `PRODUCT_NOT_FOUND` se lanzan *después* de que la deuda ya se
      comprometió. La frecuencia con que se entra a la ventana pasó de "casi nunca" a "a
      diario" — un error de tipeo del cajero ahora es un camino a un saldo incorrecto. Si la
      compensación falla, el cliente queda debiendo por una venta que la caja le dijo que fue
      rechazada, y el cajero va a corregir la cantidad y cobrar de nuevo: doble débito. El
      job de reconciliación es el arreglo real; hasta entonces esto es riesgo aceptado.
- [ ] Backend: `POST /sales` sigue sin registro de idempotencia. El `appendRow` ya no se
      reintenta (ver sub-proyecto 4), lo que cierra el camino silencioso, pero un humano que
      cobra de nuevo tras una respuesta perdida sí duplica la venta. El arreglo completo es un
      ledger por `saleId` leído dentro del callback, igual que `stock_adjustments`.
- [ ] Backend: aprovisionamiento de nuevas cuentas (tenants) sigue siendo un paso manual
      (insert SQL directo). Si se necesita alta de empresas por self-service, diseñar ese
      flujo como su propio sub-proyecto.
- [ ] Backend: `docs/superpowers/specs/2026-09-19-backend-api-design.md` y el plan de
      implementación todavía describen la forma antigua (e insegura) del body de
      `POST /auth/link-device` (con `role` elegido por el cliente) — actualizar la
      documentación para reflejar el sistema de invite tokens real.
- [ ] Backend: considerar mover la escala de la cola de Sheets a Redis si se despliega en
      múltiples instancias (hoy es una cola en memoria por proceso, ver spec original).

## Dependencias instaladas (backend/package.json)

fastify, pg, googleapis, google-auth-library, jsonwebtoken, zod, p-queue, fastify-plugin —
más tsx/typescript/vitest/pg-mem como dev dependencies.
