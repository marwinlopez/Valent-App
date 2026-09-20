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
- [ ] Sub-proyecto 2: Auth + vinculación de dispositivo (pantallas Home, Hardware ID vía
      expo-application/expo-device, flujo de token de invitación). Al empezar, cerrar estos
      3 pendientes que la revisión final dejó parqueados:
      - `client.ts`: el `await signOut()` del path 401 no está protegido — si
        `SecureStore.deleteItemAsync` falla, `apiFetch` rechaza con un error de almacenamiento
        en vez de `ApiRequestError` (una línea: `.catch(() => undefined)`).
      - `client.ts`: `readJsonBody` se traga cualquier fallo de parseo en respuestas exitosas, así
        que `apiFetch<T>` puede resolver a `null` mientras su tipo promete `T`. Limitarlo a 204.
      - Una sesión no-ACTIVE guardada en disco no tiene hoy camino de limpieza (`app/index.tsx` la
        redirige a Home antes de que monte `(app)/`, y `useRevocationGuard` solo vive bajo `(app)/`).
        Hoy es inalcanzable, pero se vuelve real en cuanto este sub-proyecto persista una sesión
        PENDING tras vincular un dispositivo.
      - Además: `useRevocationGuard` ni adopta ni *detecta* un cambio de `accountId` al refrescar.
        Se vuelve importante en cuanto algo lea `session.accountId`, porque las query keys no
        llevan el tenant.
- [ ] Sub-proyecto 3: Inventario (lista, escáner de código de barras, detalle/nuevo producto)
      — nota: el backend hoy solo expone GET/POST /products y PATCH stock; faltan
      `GET /products/search?q=` y `PUT /products/:barcode` del spec original, no
      implementados en ningún task del plan del backend (defecto del plan, detectado en la
      revisión final) — implementar en el backend antes o junto con este sub-proyecto.
- [ ] Sub-proyecto 4: POS/PostVenta (checkout, métodos de pago, validación de crédito en vivo)
      — nota: las ventas hoy no ajustan stock automáticamente; el cliente debe llamar
      PATCH /products/:barcode/stock por separado, no atómico con la venta.
- [ ] Sub-proyecto 5: Crédito y Fidelidad (UI en Configuración sobre los endpoints ya
      existentes en el backend)
- [ ] Sub-proyecto 6: QR de cliente (generación con react-native-qrcode-svg, escaneo con
      expo-camera, catálogo de autoservicio y pedidos)
- [ ] Sub-proyecto 7: Dashboard y Configuración
- [ ] Backend: endpoint de listado/revocación de invite tokens pendientes (hoy solo se
      pueden crear, no listar ni cancelar antes de que expiren en 24h)
- [ ] Backend: la caché de estado de dispositivo en `authGuard.ts` es por proceso — si se
      despliega en más de una instancia, la revocación tarda hasta 30s en propagarse a las
      otras instancias. Necesita invalidación compartida (pub/sub o caché externo) antes de
      escalar horizontalmente.
- [ ] Backend: la compensación de saldo cuando falla la escritura a Sheets en una venta a
      crédito es best-effort (si el proceso muere entre el commit y la compensación, el
      saldo del cliente queda sin la venta correspondiente en el ledger). Falta un job
      periódico de reconciliación.
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
