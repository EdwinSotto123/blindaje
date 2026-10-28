# Devlog: API (`services/api`)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 01:10 · Configuración y decisiones de base

- `wrangler.jsonc` con D1 `DB`, R2 `EVIDENCE` e `INDICES`, KV `CONFIG`, colas `INGESTA` y
  `VINCULACION` (productor y consumidor, DLQ `blindaje-dlq`), Durable Objects `RateLimiter` y
  `AuditChain` (SQLite), Workflow `procesar-caso` (`ProcesarCaso`) y dos crons (13:00 UTC = 08:00 en
  Lima, y cada 6 horas) que llaman a `runVigia`.
- `compatibility_date` = 2026-08-01: `@cloudflare/vitest-pool-workers` 0.23.0 trae workerd
  1.20260815 y no acepta fechas posteriores. El paquete está marcado como renombrado a
  `@cloudflare/vitest-plugin`; funciona igual con Vitest 4.1 (`cloudflareTest()` como plugin).
- **PBKDF2 en Workers tiene un máximo de 100,000 iteraciones**: usamos exactamente 100,000 (el
  mínimo pedido). Formato `pbkdf2-sha256$100000$salt$hash`.
- JWT HS256 propio con WebCrypto (unas 40 líneas) en vez de `hono/jwt`, para controlar claims y
  errores. Refresh tokens rotativos: si alguien presenta uno ya rotado se revocan todas las sesiones
  de ese sujeto (detección de robo).
- Cifrado de evidencia: `iv || ciphertext` escrito a R2 con `FixedLengthStream`, sin concatenar en
  memoria (50 MB de archivo con 128 MB por isolate). AAD = id de la evidencia (o del derivado), así
  un objeto copiado a otra fila no descifra.
- Auditoría: el Durable Object `AuditChain` serializa con un mutex de promesas, porque las esperas a
  D1 abren la compuerta de entrada y dos peticiones podrían leer la misma cabeza. Además guarda la
  última cabeza como ancla: la verificación detecta también el borrado de las filas finales.
- Seudónimos `V-XXXX` con al menos una letra: un seudónimo solo con dígitos (`V-7234`) coincidiría
  con el formato de cita de huella de voz (`V-<n>`) del validador de citas.

## 2026-10-28 01:30 · Rutas y reglas de privacidad

- Todas las respuestas para el rol `victim` pasan por `victimJson`: se validan con el esquema del
  contrato (que descarta claves desconocidas) y fallan cerradas si aparece una clave de
  `VICTIM_FORBIDDEN_KEYS`. Un caso ajeno responde 404 igual que uno inexistente.
- Consola: un caso solo es visible con consentimiento comunitario ("solo mi denuncia" significa que
  nada sale de su caso). Los revisores solo ven casos, vínculos y alertas de su organización; los
  vínculos entre organizaciones los ven analistas (sala limpia, sección 11.3).
- Retirar el consentimiento comunitario (`deindexCase`) quita los vectores de FAISS (mejor esfuerzo),
  marca el caso y sus identificadores como no indexados, borra sus vínculos (en cualquier estado) y
  recalcula las redes. Los vectores siguen en D1 para no reprocesar si vuelve a dar consentimiento;
  la reconstrucción de índices solo usa casos indexados.
- Borrado de caso: R2 (evidencia, derivados y la caché de resultados de Meta de ese caso), D1 en
  cascada, identificadores huérfanos, `api_costs.case_id` a NULL y recálculo de redes.
- Aprobar una alerta con un número de 8 dígitos o más responde 400 (sección 10.4).
- Subida idempotente por (caso, SHA-256): reintento = `200` con la evidencia existente. Pensado para
  la cola sin conexión del celular.
- Demo: `x-demo-case-code: A` en `POST /v1/cases` (solo `DEMO_MODE=true` y dispositivos de una
  organización demo) para que el script de los casos A, B y C obtenga las etiquetas EV-A1, EV-B1…
- Presupuesto: además del bloqueo de no esenciales al 80 %, al 100 % se bloquea todo (el crédito es
  el límite real). La caché de resultados se guarda cifrada en R2 (`cache/<key>`), no en KV, porque
  contiene transcripciones.

## 2026-10-28 01:45 · Tests

- 44 tests en 10 archivos con `@cloudflare/vitest-pool-workers` (workerd real, una D1 por archivo).
- Ruido conocido del harness, no del código: (1) el test que corre el Workflow con
  `introspectWorkflow` imprime "Worker's code had hung" al desechar la introspección; verificado
  quitando las llamadas a la auditoría del Workflow, el mensaje sigue, y el test pasa. (2) En Windows,
  "Timeout terminating cloudflare-pool worker" al cerrar los miniflare en paralelo; el código de
  salida es 0.
- Con la sección `containers` activada en una copia del `wrangler.jsonc`, los tests siguen pasando:
  el pool no construye la imagen.

## 2026-10-28 01:55 · Despliegue

- `wrangler d1 migrations apply blindaje --remote`: `0001_init.sql` aplicada (48 comandos).
- `wrangler deploy`: https://blindaje-api.vigiaperu.workers.dev (colas, Workflow y crons enlazados).
- Secretos cargados con `wrangler secret put` leyendo `.dev.vars` por stdin, sin imprimirlos.
  `TURNSTILE_SECRET` es por ahora la clave de prueba que siempre aprueba: hay que reemplazarla por la
  del widget real cuando la landing tenga su site key.
- Prueba de humo contra producción: health, seed, registro con llave P-256, caso, evidencia (201),
  SHA distinto (422), submit (Workflow completo → `listo`, ficha null hasta que exista el pipeline),
  reporte sin claves prohibidas, `report.pdf` → 503 claro sin ML, víctima en consola → 403, refresh
  con firma, login de admin de demo, verificación de auditoría ok, costos. Después: borrado del caso,
  reset y seed otra vez (la demo queda lista y vacía).

## 2026-10-28 02:05 · Integración con `packages/meta-client`

- `createMetaHooks(env)` adopta la forma de los hooks del cliente: `CallInfo { model, operation,
  essential, context }` y `UsageEvent { status: ok | error | blocked, units, cost_usd, … }`.
  `case_id` y `cache_key` viajan en `context`. `beforeCall` no registra el bloqueo: el cliente emite
  el evento `blocked` por `onUsage`, así queda una sola fila por intento.
- Test de integración con el cliente real y un `fetch` falso: registra tokens y costo, y con el
  presupuesto al 80 % bloquea Muse Wonder sin llamar a la red.
