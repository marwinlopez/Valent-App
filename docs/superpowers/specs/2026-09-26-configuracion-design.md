# Configuración: tasa BCV y márgenes — Spec de diseño

Fecha: 2026-09-26
Sub-proyecto: 5A de 8 (el sub-proyecto 5 se partió en dos; 5B es Crédito y Fidelidad)
Estado: Aprobado para planificar

## Contexto

Los sub-proyectos 0 a 4 están integrados en `master`. La pestaña `Configuración`
sigue siendo `<EmptyState title="Configuración" message="Próximamente" />`.

El sub-proyecto 3 dejó explícito que editar márgenes y la tasa BCV era "trabajo
de Configuración", y el sub-proyecto 4 hizo que la caja **se niegue a cobrar**
sin la tasa del día y sin un margen para el departamento del producto. Ninguno de
los dos editores se construyó nunca. Así que hoy, en `master`, nadie puede
registrar una sola venta desde la app — no porque algo esté roto, sino porque los
dos valores de los que depende todo precio no tienen por dónde entrar.

Eso convierte a este sub-proyecto en el que desbloquea la verificación en vivo,
que es el riesgo pendiente más grande de todo el proyecto: nada de los
sub-proyectos 2, 3 y 4 corrió nunca contra Postgres real, una hoja de Google real
o una cámara real.

## Por qué se partió el sub-proyecto 5

El pendiente original decía "UI en Configuración sobre los endpoints ya
existentes en el backend". Esa premisa es falsa. Leyendo el backend:

- **No existe ningún endpoint de `loyalty_levels`** — ni listar, ni crear, ni
  actualizar. Toda la mitad de "Fidelidad" no tiene backend.
- **No hay forma de editar un cliente.** `loyalty_level_id` solo se asigna al
  crearlo, así que no se puede promover a un cliente ni corregir un teléfono mal
  escrito.
- **No hay forma de registrar un pago.** `customers.current_debt_balance` solo
  sube (una venta a crédito) y solo baja por el camino de compensación cuando
  falla una escritura a Sheets. La deuda es de solo-escritura: después de unas
  cuantas ventas, todos los clientes quedan topados para siempre.
- `GET /customers` y `POST /customers` están protegidos solo con `requireAuth`,
  así que un dispositivo `CLIENTE_PEDIDOS` puede listar a todos los clientes con
  su saldo de deuda, y crear clientes. Es la misma clase de fuga que el gate de
  `GET /products` que se corrigió en el sub-proyecto 3.

Cerrar todo eso necesita una migración, unos seis endpoints nuevos y cuatro
pantallas más. Juntarlo con dos pantallas sobre endpoints que ya funcionan
produciría una sola rama larga y mantendría bloqueada la verificación en vivo
hasta el final. Por eso:

- **5A (este spec):** los editores de tasa BCV y de márgenes. Dos pantallas, cero
  backend nuevo. Desbloquea la caja.
- **5B:** niveles de fidelidad, edición de clientes y el registro de pagos, con
  todo el backend nuevo. Ya decidido y trasladado a ese spec: los pagos se
  registran en USD contra una tabla nueva `payments` de solo-agregado, un
  sobrepago se rechaza con un error que indica cuánto se debe en vez de dejar un
  saldo negativo, y los gates de rol de clientes se corrigen ahí.

## El backend tal como está (leído, no supuesto)

Los dos módulos están completos y no necesitan cambios.

`backend/src/modules/bcv/routes.ts`:
- `GET /bcv-rate?date=` — `requireAuth`. Por defecto usa hoy, calculado como
  `new Date().toISOString().slice(0, 10)`. **404 `RATE_NOT_FOUND`** cuando no hay
  ninguna cargada.
- `PUT /bcv-rate` — `requireRole(['ADMIN'])`. Body
  `{ rateDate: /^\d{4}-\d{2}-\d{2}$/, rate: number().positive() }`. Hace upsert
  sobre `(account_id, rate_date)`, así que guardar dos veces es seguro.

`backend/src/modules/margins/routes.ts`:
- `GET /margins` — `requireAuth`. Devuelve `{ id, level, level_name, percentage }`
  ordenado por nivel y después por nombre, con `percentage` convertido a número.
- `POST /margins` — `requireRole(['ADMIN'])`. Body
  `{ level: 'CATEGORIA'|'SUBCATEGORIA'|'DEPARTAMENTO', levelName: string,
  percentage: number().min(0).max(1000) }`. **Hace upsert** sobre
  `(account_id, level, level_name)`, así que crear-o-actualizar es una sola
  llamada.
- `PUT /margins/:id` — `requireRole(['ADMIN'])`. Body `{ percentage }`.
  404 `MARGIN_RULE_NOT_FOUND`.

El lado móvil ya tiene la mitad de lectura: `getBcvRate()` (que devuelve `null`
ante un 404, tratando una tasa faltante como un estado normal) y `getMargins()`
en `mobile/src/services/api/config.ts`, consumidos por `usePricingInputs()`.

Como `POST /margins` hace upsert, este sub-proyecto no necesita
`PUT /margins/:id` para nada — un solo endpoint cubre tanto crear el margen de un
departamento como cambiarlo. `PUT` queda sin usar.

## Objetivos

- Un ADMIN puede cargar la tasa BCV de hoy y ver cuál está cargada.
- Un ADMIN puede ver qué departamentos del catálogo tienen margen y cuáles no, y
  asignarles uno.
- Al terminar este sub-proyecto se puede registrar una venta real de punta a
  punta.

## Fuera de alcance

- **Sin cargar tasas de días pasados.** `PUT /bcv-rate` acepta cualquier
  `rateDate`, pero nada necesita la tasa de un día anterior: la caja usa la de
  hoy, y la auditoría compara contra la de hoy. Solo hoy, hasta que algo necesite
  otra cosa.
- **Sin reglas `CATEGORIA` ni `SUBCATEGORIA`.** Ver más abajo — nada les puede
  hacer match.
- **Sin borrar reglas de margen ni tasas.** No hay endpoint, y borrar un margen
  deja invendibles todos los productos de ese departamento.
- **Sin traer la tasa automáticamente del BCV.** Eso es un scraper contra un
  sitio de terceros, con sus propios modos de falla y su propio sub-proyecto.
- Sin niveles de fidelidad, edición de clientes ni pagos — eso es 5B.
- Sin editar departamentos, marcas ni unidades. La hoja de productos es la fuente
  de verdad de esos datos (el sub-proyecto 3 también lo excluyó).

## Navegación

`mobile/app/(app)/configuracion.tsx` pasa a ser el directorio
`mobile/app/(app)/configuracion/` con su propio `_layout.tsx` con un Stack — la
misma forma que `producto/`, salvo que este sí es una pestaña visible. La entrada
`<Tabs.Screen name="configuracion">` que ya existe en `app/(app)/_layout.tsx`
sigue funcionando sin cambios, porque una pestaña cuya ruta es un directorio se
resuelve al layout de ese directorio.

- `configuracion/index.tsx` — un menú. Dos entradas ahora; 5B y el sub-proyecto 7
  agregan las suyas al lado.
- `configuracion/tasa.tsx` — la tasa del día.
- `configuracion/margenes.tsx` — márgenes por departamento.

## La pantalla de márgenes no es un CRUD genérico

Esta es la única decisión de diseño real de este sub-proyecto.

`marginFor(department)` en `usePricingInputs` compara el `level_name` de la regla
de margen contra la columna `department` de la fila del producto por **string
exacto**. Una regla escrita a mano con un typo, un acento distinto o un espacio
al final no le hace match a nada. El síntoma que ve el usuario es que la caja se
niega a ponerle precio a un producto, sin ninguna pista de por qué — y la causa
está tres pantallas más allá.

Así que la pantalla no pide texto libre. Lista **los departamentos que realmente
existen en el catálogo** — derivados de `useProducts()`, que ya está en caché — y
muestra, para cada uno, si tiene margen y cuál es. La pregunta que responde es
"qué departamentos puedo vender", no "administrar mis reglas". El departamento
sin margen es la fila que importa, y se ve sin tener que buscarla.

Consecuencia, aceptada: un departamento que no tiene productos en la hoja no se
puede configurar acá. Está bien — un margen que no le hace match a ningún
producto es configuración muerta, y en cuanto un producto cae en ese
departamento, la fila aparece.

Solo se crean reglas `DEPARTAMENTO`. El endpoint acepta los otros dos niveles,
pero una fila de producto trae un departamento y nada más sobre lo que una regla
pueda hacer match, así que ofrecerlos dejaría a un ADMIN crear configuración que
silenciosamente no hace nada. Las reglas `CATEGORIA`/`SUBCATEGORIA` que ya
existan — si un tenant se aprovisionó con alguna vía SQL directo — **se muestran
en solo lectura con una nota de que nada les hace match**, en vez de esconderse:
esconderlas haría invisible un porcentaje que está en la base de datos sin
explicación.

## El separador decimal es un bug de dinero esperando a pasar

En un teclado en español la tasa se escribe `36,50`, y `Number('36,50')` es
`NaN`. Ese `NaN` viajaría directo a `PUT /bcv-rate` (donde zod lo rechaza, así
que la falla al menos es ruidosa) — pero la misma entrada pasa primero por la
validación de la propia UI, y `NaN` falla todas las comparaciones en silencio,
que es exactamente como este código una vez aprobó crédito que debía negar.

Por eso: una función pura `parseDecimal(input: string): number | null` en
`mobile/src/services/` que acepta coma o punto como separador decimal, rechaza
cualquier otra cosa, y devuelve `null` en vez de `NaN` para lo que no puede
interpretar. Es la única lógica real de este sub-proyecto y lleva tests
unitarios, incluyendo el caso de la coma, un string vacío, un separador solo,
varios separadores, y un valor con espacios alrededor.

Las dos pantallas validan antes de enviar:

- **Tasa:** tiene que interpretarse, ser finita y ser **mayor que cero**.
  `calculatePriceVes` rechaza `bcvRate <= 0` (una tasa en cero le pondría precio
  0 Bs a todo un carrito mientras los totales en USD seguían correctos — se
  agregó como guarda en el sub-proyecto 4), y `PUT /bcv-rate` exige
  `positive()`. La UI también la rechaza, con una razón. Tres capas, a propósito.
- **Porcentaje:** tiene que interpretarse, ser finito, y estar dentro del
  `0 … 1000` del backend. Cero está permitido y significa vender al costo.
  Negativo no: la columna lo aceptaría y `calculatePriceVes` rechaza cualquier
  cosa en −100% o menos, pero el `min(0)` del backend es el contrato, así que la
  UI se ajusta a él.

## Para qué "hoy" se guarda la tasa

`PUT /bcv-rate` exige un `rateDate`; no pone uno por defecto. `GET /bcv-rate`
calcula hoy como `new Date().toISOString().slice(0, 10)` — **en UTC**. La
auditoría de ventas del sub-proyecto 4 lo calcula igual.

Si la app calculara la fecha en hora local, entonces entre las 20:00 y la
medianoche en Caracas (UTC−4) las dos no coincidirían: a las 21:00 del 26 hora
local son las 01:00 del 27 en UTC, así que el ADMIN guardaría una tasa para el 26
mientras la caja pediría la del 27 y diría que no hay tasa. Durante cuatro horas
cada noche, la tasa que se escribe y la que se lee serían filas distintas.

Por eso la app manda `rateDate` calculado con **la expresión idéntica**, no con un
equivalente en hora local, y la regla queda escrita en un comentario en el lugar
de la llamada para que nadie la "arregle" a hora local. La pantalla muestra la
tasa con la fecha para la que se guardó, así el ADMIN ve a qué día aplica.

La consecuencia — que "la tasa de hoy" cambia a las 20:00 de Caracas y no a
medianoche — es anterior a este sub-proyecto, es consistente entre todos los que
escriben y leen, y ya está registrada en el ledger del sub-proyecto 4. Pasar todo
el sistema a una fecha comercial local toca el cálculo de fechas del backend en
todas partes, incluida la auditoría de ventas, y queda fuera de alcance. Lo que
este sub-proyecto no puede hacer es introducir una *segunda* definición de "hoy".

## Manejo de errores

Las dos pantallas distinguen los cuatro estados que este proyecto ya confundió
antes — cargando, request fallido, "configurado y acá está", y "todavía no
configurado":

- **Cargando:** un `Skeleton`, como en el resto de la app.
- **Request fallido:** lo dice y ofrece reintentar. Nunca se informa como "no
  configurado" — ese es exactamente el diagnóstico equivocado que se corrigió en
  la caja en el sub-proyecto 4, donde un `GET /bcv-rate` fallido le decía a un
  cajero con conexión inestable que fuera a cargar una tasa que ya existía.
- **Sin tasa cargada:** un estado normal, dicho claramente, con el campo listo
  para escribir.
- **Falla al guardar:** el error del backend se muestra según su código, no un
  mensaje genérico. Un dispositivo que no sea ADMIN y llegue a cualquiera de las
  dos pantallas recibe un 403 del backend; la pestaña ya es solo para ADMIN vía
  `TABS_BY_ROLE`, así que esa es la segunda capa.

Al guardar con éxito se invalida la query correspondiente, para que la caja y las
pantallas de producto vean el valor nuevo sin refrescar a mano — por la misma
razón por la que `useSale` invalida el catálogo.

## Capa de datos

Siguiendo el patrón ya establecido (`useProductMutations`, que empareja cada
mutación con la query key que invalida):

- `putBcvRate(rateDate, rate)` y `upsertMargin(level, levelName, percentage)`
  agregados a `mobile/src/services/api/config.ts`, junto a los getters que ya
  existen.
- `useSetBcvRate()` que invalida `['bcv-rate']`, y `useSaveMargin()` que invalida
  `['margins']`, en `mobile/src/hooks/`.

La lógica de negocio queda fuera de `app/`, según la regla del proyecto.

## Pruebas

- `parseDecimal` — Jest, pura, como se describió arriba.
- Las dos mutaciones — tests de hook siguiendo
  `mobile/test/hooks/useProductMutations.test.tsx`: invalidación al tener éxito,
  sin invalidación al fallar.
- Las pantallas se verifican corriendo la app (`npx expo start --web` desde el
  worktree, con Bash — no con la herramienta de preview, que resuelve contra el
  checkout principal).
- Correr jest con `--forceExit`: este proyecto tiene una fuga preexistente en el
  teardown por la que un `npx jest` simple termina la corrida y después nunca
  sale.

Sin tests de backend, porque no cambia código de backend.

## Criterio de terminado

Además de los suites: una tasa y al menos un margen de departamento cargados
desde estas pantallas, y una venta registrada en la caja contra ellos. Esa única
corrida es además la que primero sacaría a la luz los cuatro riesgos de
verificación en vivo listados bajo el sub-proyecto 4 en `CLAUDE.md` — sobre todo,
si un escaneo real de cámara agrega exactamente una unidad.

## Trabajo futuro

- [ ] Cargar o corregir la tasa de un día pasado, si la reconciliación alguna vez
      lo necesita.
- [ ] Una vista del historial de tasas (la tabla guarda todos los días; nada lee
      más que el de hoy).
- [ ] Traer la tasa del BCV automáticamente.
- [ ] Márgenes `CATEGORIA`/`SUBCATEGORIA`, que primero necesitan que las filas de
      producto lleven una categoría.
