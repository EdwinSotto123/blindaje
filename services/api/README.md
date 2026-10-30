# blindaje-api

Worker de Cloudflare (Hono) con la API de Blindaje: autenticación, casos, evidencia cifrada en R2,
auditoría encadenada, registro de costos de la Meta Model API, rate limiting, consola, modo demo y
la plomería del pipeline (cola de ingesta, Workflow `procesar-caso`, cola de vinculación y cron del
Vigía). Contrato de rutas en [`docs/API.md`](../../docs/API.md); esquemas en `packages/shared`.

Despliegue del hackathon: **https://blindaje-api.vigiaperu.workers.dev** (`/v1/health`).

## Correr en local

```bash
pnpm install
cp services/api/.dev.vars.example services/api/.dev.vars   # completar valores
pnpm --filter @blindaje/api db:migrate:local
pnpm --filter @blindaje/api dev                             # http://localhost:8787
```

Para usar el contenedor ML en local, levantarlo (`docker run -p 8080:8080 …` o `uvicorn`) y poner
`ML_URL=http://localhost:8080` en `.dev.vars`. Sin ML, las rutas que lo necesitan responden
`503 upstream_error` con un mensaje claro.

## Verificación

```bash
pnpm --filter @blindaje/api typecheck
pnpm --filter @blindaje/api lint
pnpm --filter @blindaje/api test      # vitest 4 + @cloudflare/vitest-pool-workers (workerd real)
```

Los tests usan claves de prueba propias (`vitest.config.ts`), una base D1 por archivo y cubren:
auth (JWT, refresh rotativo con firma ECDSA, PBKDF2), guardas por rol, aislamiento de víctima
(recorre todas sus respuestas buscando `VICTIM_FORBIDDEN_KEYS`, caso ajeno = 404, infiltrado con
vínculos y red en la base), integridad (SHA-256 distinto = 422), cadena de auditoría (concurrencia,
alteración, truncamiento), presupuesto al 80 % y al 100 %, caché por hash, rate limit, Turnstile,
CORS, consentimiento → desindexado, borrado completo, redes por union-find, Workflow y demo.

## Desplegar

```bash
cd services/api
npx wrangler d1 migrations apply blindaje --remote
# Sin Docker: despliega el Worker sin construir ni tocar el contenedor ML
npx wrangler deploy --containers-rollout=none
# Secretos: leídos de .dev.vars y pasados por stdin, sin imprimirlos
for k in JWT_SECRET EVIDENCE_ENCRYPTION_KEY HMAC_ALLIANCE_KEY DEMO_SECRET TURNSTILE_SECRET MODEL_API_KEY CHROMA_API_KEY CHROMA_TENANT; do
  node -e 'const k=process.argv[1];const l=require("fs").readFileSync(".dev.vars","utf8").split(/\r?\n/).find(x=>x.startsWith(k+"="));process.stdout.write(l.slice(k.length+1))' "$k" \
    | npx wrangler secret put "$k"
done
```

| Secreto | Formato |
|---|---|
| `JWT_SECRET` | 32 caracteres o más |
| `EVIDENCE_ENCRYPTION_KEY` | 32 bytes en base64url (AES-256-GCM) |
| `HMAC_ALLIANCE_KEY` | 32 bytes en base64url |
| `DEMO_SECRET` | cadena aleatoria; header `x-demo-secret` |
| `TURNSTILE_SECRET` | clave secreta del widget de la landing (en local, la de prueba `1x000…AA`) |
| `MODEL_API_KEY` | key de la Meta Model API (la usa el pipeline) |
| `ML_TOKEN` | opcional; si existe, el contenedor exige `x-ml-token` |
| `CHROMA_API_KEY`, `CHROMA_TENANT` | opcionales; con ellos (y la variable `CHROMA_DATABASE`) la búsqueda vectorial de los casos del demo usa Chroma Cloud. Se obtienen con `chroma db connect blindaje --env-vars` |

Después de configurar Chroma, una sincronización completa desde D1 (o el botón "Sincronizar desde D1"
de la consola, en Motor vectorial): `POST /v1/console/vectores/sincronizar` como admin.

### Velocidad (medida el 29/10 desde Lima)

- **Ubicación fijada** (`placement` en `wrangler.jsonc`, región `gcp:us-east1`): la primaria de D1
  está en Miami y, sin esto, el Worker corría en Buenos Aires (donde entra la petición desde Lima):
  cada consulta cruzaba el continente. Una consulta a D1 bajó de ~130 ms a ~22 ms (desde
  `aws:us-east-1` eran ~45 ms). `WORKER_REGION` repite la región para el panel de Monitoreo.
- **`ML_CONTAINER: "off"`** mientras la imagen de `services/ml` no esté desplegada: el Worker ignora
  el binding `ML`. Sin esto cada búsqueda esperaba a que el contenedor inexistente fallara (de 5 a
  25 s en la consulta del motor vectorial). Al activar el contenedor, cambiarlo a `"on"`.
- **Consola en el mismo origen**: `blindaje-console` pasa `/v1/*` a esta API por un service binding
  (`apps/console/worker/index.ts`), así el navegador no hace un preflight CORS por cada ruta nueva
  ni abre una segunda conexión. Se despliega con `VITE_API_URL=self` (no `/`: Git Bash lo convierte
  en `C:/Program Files/Git/`).
- **`Server-Timing`** en cada respuesta (`app`, `db`, `do`, `ext`): ver dónde se va el tiempo sin
  abrir los logs. La consola lo muestra en Monitoreo, "Velocidad de esta consola".

| Pantalla | Antes | Después |
|---|---|---|
| Consulta del motor vectorial (caso A) | 5 a 25 s | ~1 s |
| Cola de vínculos (API) | 1,6 s | 0,6 s |
| Mediana de la consola en el navegador | 1,0 s | 0,4 s |
| Entrar y ver la primera pantalla | 6,7 s | 1,4 s |

## Activar el contenedor ML

Cuando `services/ml/Dockerfile` esté listo, agregar en `wrangler.jsonc` (con Docker corriendo para
el `wrangler deploy`):

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "RATE_LIMITER", "class_name": "RateLimiter" },
    { "name": "AUDIT_CHAIN", "class_name": "AuditChain" },
    { "name": "ML", "class_name": "MlContainer" }
  ]
},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["RateLimiter", "AuditChain"] },
  { "tag": "v2", "new_sqlite_classes": ["MlContainer"] }
],
"containers": [
  { "class_name": "MlContainer", "image": "../ml/Dockerfile", "max_instances": 2, "instance_type": "standard-2" }
]
```

- `ML_URL` debe quedar vacío en producción: si tiene valor, el Worker usa HTTP en vez del binding.
- `MlContainer` (`src/ml/container.ts`): puerto 8080, `sleepAfter: "30m"`, ping a `/health`,
  **sin salida a internet** (`enableInternet = false`: los modelos van horneados en la imagen). Si la
  imagen descarga algo al arrancar, cambiarlo a `true`.
- Con esta sección activada los tests siguen pasando (verificado: el pool no construye la imagen).
- Si `standard-2` (1 vCPU, 6 GiB) se queda corto para ECAPA + DINOv2 + e5 + FAISS, subir a `standard-3`.

## Demo

`DEMO_MODE=true` en `wrangler.jsonc`. Ambas rutas exigen el header `x-demo-secret: $DEMO_SECRET`.

```bash
curl -X POST https://blindaje-api.vigiaperu.workers.dev/v1/demo/seed  -H "x-demo-secret: $DEMO_SECRET"
curl -X POST https://blindaje-api.vigiaperu.workers.dev/v1/demo/reset -H "x-demo-secret: $DEMO_SECRET"
```

`seed` (idempotente) asegura la organización central (`org-central`, "Equipo Blindaje", la crea la
migración 0004), crea el equipo central del demo (tres usuarios de consola en `org-central`), el
canal de difusión **"Asociación de Bodegueros de Lima Este (datos ficticios)"**
(`org-demo-bodegueros-lima-este`) con sus códigos de invitación, una cuenta del portal de negocios y
126 casos agregados ficticios (fichas sin evidencia, `is_demo`) en 10 distritos reales: seis pasan el
umbral (San Juan de Lurigancho, Villa El Salvador, Ate, Comas, Lima y La Victoria) y cuatro no (San
Martín de Porres, Los Olivos, Callao y Puente Piedra). Se ven en `GET /v1/public/zones?demo=1`.
`reset` borra todo lo `is_demo`: casos (R2, D1, índices y vínculos; los agregados, en bloque), dispositivos, usuarios, cuentas de
negocio y sus sesiones, recomendaciones del Asesor, invitaciones, alertas del demo (`pattern_key` con prefijo `demo:`) y la organización demo; recalcula redes y reinicia los contadores de etiquetas. La organización central se queda.
La auditoría no se borra (es de solo escritura): `reset` deja una entrada `demo.reset`.

Credenciales de demo (datos ficticios; solo existen después de `seed`):

| Rol | Correo | Contraseña |
|---|---|---|
| reviewer | `revisora@demo.blindaje.test` | secreto `DEMO_REVIEWER_PASSWORD` |
| analyst | `analista@demo.blindaje.test` | secreto `DEMO_ANALYST_PASSWORD` |
| admin | `admin@demo.blindaje.test` | secreto `DEMO_ADMIN_PASSWORD` |
| admin, **solo lectura** (para el jurado) | `jurado@demo.blindaje.test` | `Jurado-Demo-2026` |

Las contraseñas de las cuentas que deciden nunca están en el repo: sin su secreto, el seed no crea la
cuenta. La del jurado es pública porque la API le rechaza todo lo que no sea leer (403), salvo consultar
el motor vectorial: ve lo mismo que la administración, pero no aprueba, no edita ni corre agentes.
| business (portal de negocios) | `negocio@demo.blindaje.test` | `Negocio-Demo-2026` |

La cuenta de negocio es "Bodega Don Lucho (ficticia)", rubro `bodega`, zona `san-juan-de-lurigancho`, de la
organización demo. Entra por `POST /v1/auth/business/login` y solo ve información agregada.

Invitaciones: `DEMO-CASO-A`, `DEMO-CASO-B`, `DEMO-CASO-C` (5 usos cada una) y `DEMO-LIMA-ESTE` (100).

Para que los casos del demo tengan los códigos A, B y C (y la evidencia se llame EV-A1, EV-B1…), el
script que los crea registra un dispositivo con la invitación correspondiente y manda
`x-demo-case-code: A` en `POST /v1/cases`. El header solo se respeta con `DEMO_MODE=true` y un
dispositivo de una organización demo; si el código ya existe responde `409 conflict`.

## Detalles del contrato que conviene saber

- Errores: `{ "error": { "code", "message", "details"? } }`. Estados: `bad_request` 400,
  `unauthorized` 401, `budget_exceeded` 402, `forbidden` 403, `not_found` 404, `demo_disabled` 404,
  `conflict` 409, `payload_too_large` 413, `integrity_mismatch` 422, `rate_limited` 429 (con
  `retry-after`), `internal` 500, `not_implemented` 501 (stubs del pipeline), `upstream_error` 503
  (ML o Turnstile no disponibles; 502 si el ML rechaza la petición).
- Subida de evidencia idempotente por (caso, SHA-256): reintentar la misma subida devuelve `200` con
  la evidencia existente en vez de `201`. Útil para la cola sin conexión del celular.
- `POST /v1/cases/:id/submit` es idempotente mientras el caso está `procesando` (devuelve `202`).
- Consola: un caso solo es visible si tiene consentimiento comunitario; los revisores solo ven
  casos, vínculos y alertas de su organización (los vínculos entre organizaciones los ven analistas).
  `GET /v1/console/links?status=todos` lista también confirmados y descartados.
- `GET /v1/console/alerts/:id/image` sirve la tarjeta de Muse Image si existe (`image_url`).
- `CostsResponse.pct` va en porcentaje (0–100).
- Aprobar una alerta con un número de 8 dígitos o más en el título o el cuerpo responde `400`.

## Rate limiting (Durable Object `RateLimiter`)

| Bucket | Por IP | Por dispositivo o usuario |
|---|---|---|
| global (todo `/v1/*`) | 600/min | |
| login de consola | 10/min | |
| registro de dispositivo | 10/hora | |
| refresh | 20/min | |
| solicitud de piloto | 5/hora | |
| víctima (todas sus rutas) | | 120/min |
| subida de evidencia y muestra de voz | 200/hora | 60/hora |
| submit | | 20/hora |
| consola | | 600/min |
| agentes (Cartógrafo, Vigía, Redactor) | | 20/hora |

Si el Durable Object falla, el limitador deja pasar y lo registra (preferimos no impedir que una
víctima suba evidencia).

## Estructura

```
src/
  index.ts            fetch (Hono), queue (INGESTA, VINCULACION), scheduled (Vigía); exporta DOs, Workflow y MlContainer
  app.ts              middlewares (logs, cabeceras, CORS, rate limit) y rutas
  routes/             auth, victim, console, public, demo
  auth/tokens.ts      access/refresh tokens, rotación y detección de reutilización
  audit/              hash encadenado, verificación; do/audit-chain.ts serializa las escrituras
  costs/              recordCost, budgetGuard, caché por hash, hooks para meta-client
  evidence/           subida, cifrado y lectura de evidencia y derivados
  cases/              reporte de víctima, consentimiento, borrado completo
  networks/           union-find y recálculo de redes
  console/views.ts    vistas de la consola (LinkView, NetworkView, ProfileView, AlertView…)
  ml/                 MlClient (Containers o HTTP) y MlContainer
  pipeline/           audio, imagen, video y texto; ficha e identificadores; colas y Workflow (docs/devlog/pipeline.md)
  linking/            indexación, candidatos en los cuatro índices, señales calibradas, vínculos, snapshots
  agents/             Vinculador, Cartógrafo, Vigía, Redactor
  lib/                crypto, JWT, PBKDF2, firma ECDSA, WAV, logs, errores
```

## Seguridad: qué hace y qué no

- Evidencia: SHA-256 calculado en el servidor, AES-256-GCM en R2 con IV aleatorio y AAD = id de la
  evidencia (`iv || ciphertext`). El servidor procesa la evidencia: no es cifrado de extremo a extremo.
- Identificadores en claro solo cifrados en `cases.identifiers_enc` (para la denuncia de la propia
  víctima); para comparar se usa HMAC con la clave de la alianza.
- Auditoría encadenada con verificación (`/v1/console/audit/verify`) que detecta alteraciones,
  reordenamientos y borrado de las últimas filas (ancla en el Durable Object). No protege contra
  alguien con acceso total a D1 y al Durable Object a la vez.
- Logs JSON sin contenido de evidencia, transcripciones, identificadores, tokens ni IPs.
- Las contraseñas de demo son públicas a propósito y solo dan acceso a datos ficticios. Antes de
  cualquier piloto real: `DEMO_MODE=false`, rotar todos los secretos y crear usuarios reales.
