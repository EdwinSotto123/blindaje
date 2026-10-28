# Contrato de la API (`services/api`)

Worker `blindaje-api` (Hono). Base `/v1`. JSON salvo donde se indica. Los esquemas Zod viven en
`packages/shared/src/api.ts`; este documento es el índice. Errores siempre como
`{ "error": { "code": ErrorCode, "message": string, "details"?: unknown } }`.

Autenticación: `Authorization: Bearer <access_token>` (JWT HS256 firmado con `JWT_SECRET`,
15 minutos). Refresh tokens rotativos de 30 días. Rate limiting por dispositivo/usuario y por IP con un
Durable Object (`RateLimiter`).

## Principio: todo vive en la nube

La evidencia se sube a Cloudflare apenas se captura (o apenas hay conexión). El Worker calcula el
SHA-256, cifra el original con AES-256-GCM (`EVIDENCE_ENCRYPTION_KEY`) y lo guarda en R2
`blindaje-evidencia`. Una cola (`blindaje-ingesta`) procesa cada pieza al llegar: normaliza,
transcribe, segmenta y extrae datos para "Lo que encontramos". "Preparar mi denuncia" dispara el
Workflow `procesar-caso`, que consolida la ficha, cifra identificadores, indexa (solo con
consentimiento comunitario) y busca vínculos. El celular no conserva la evidencia después de una
subida confirmada.

Acceso: la víctima ve solo su caso; revisores y analistas ven lo que su rol permite; nada es
público.

## Salud y público

| Método | Ruta | Rol | Cuerpo / respuesta |
|---|---|---|---|
| GET | `/v1/health` | público | `{ ok, env, version }` |
| POST | `/v1/public/pilot-requests` | público + Turnstile | `PilotRequest` → `{ id }` |

## Autenticación

| Método | Ruta | Rol | Cuerpo → respuesta |
|---|---|---|---|
| POST | `/v1/auth/device/register` | público | `DeviceRegisterRequest` → `DeviceRegisterResponse` |
| POST | `/v1/auth/device/refresh` | público | `DeviceRefreshRequest` → `TokenPair` |
| POST | `/v1/auth/console/login` | público | `ConsoleLoginRequest` → `ConsoleLoginResponse` |
| POST | `/v1/auth/console/refresh` | público | `{ refresh_token }` → `TokenPair` |
| POST | `/v1/auth/logout` | cualquiera | `{ refresh_token }` → `204` |

## Víctima (rol `victim`)

Ninguna respuesta de este grupo incluye vínculos, redes, coincidencias, puntajes, HMAC ni datos de
otros casos (`VICTIM_FORBIDDEN_KEYS` en `packages/shared/src/safety.ts`). Una víctima que pide un
caso ajeno recibe `404`, nunca `403`, para no confirmar que existe.

| Método | Ruta | Cuerpo → respuesta |
|---|---|---|
| POST | `/v1/me/voice-sample` | WAV/Opus/M4A crudo (10 s) → `{ ok: true }`. Solo se guarda el vector cifrado. |
| POST | `/v1/cases` | `CreateCaseRequest` → `CaseSummary` |
| GET | `/v1/cases` | → `{ cases: CaseSummary[] }` |
| POST | `/v1/cases/:id/evidence` | archivo crudo + headers (`EvidenceUploadHeaders`) → `EvidenceItem` (`201`). `422 integrity_mismatch` si el SHA-256 no coincide. Límite 50 MB. |
| POST | `/v1/cases/:id/submit` | `SubmitCaseRequest` → `SubmitCaseResponse` (`202`) |
| GET | `/v1/cases/:id/report` | → `VictimReport` |
| GET | `/v1/cases/:id/report.pdf` | → `application/pdf` (denuncia para la comisaría) |
| PUT | `/v1/cases/:id/consent` | `{ mode }` → `CaseSummary`. Pasar a `solo_denuncia` saca el caso de los índices. |
| DELETE | `/v1/cases/:id` | → `204`. Borra R2, D1, vectores FAISS y nodos del grafo; recalcula redes. |
| GET | `/v1/alerts` | → `{ alerts: VictimAlert[] }` (solo aprobadas de su organización) |
| GET | `/v1/recommendations` | → `{ recommendations: BusinessRecommendationView[] }` (recomendaciones del Asesor aprobadas por el gremio de su organización; sin citas internas ni números) |

## Consola (roles `reviewer`, `analyst`, `admin`)

| Método | Ruta | Roles | Cuerpo → respuesta |
|---|---|---|---|
| GET | `/v1/console/me` | todos | → `ConsoleUser` |
| GET | `/v1/console/links?status=` | reviewer, analyst | → `{ links: LinkView[] }` (por defecto `probable` y `por_revisar`, ordenados por puntaje) |
| GET | `/v1/console/links/:id` | reviewer, analyst | → `LinkView` |
| POST | `/v1/console/links/:id/decision` | reviewer, analyst | `LinkDecisionRequest` → `LinkView` (confirmar recalcula redes) |
| GET | `/v1/console/evidence/:id/media?start_ms=&end_ms=` | reviewer, analyst | → medio descifrado (audio recortado si hay rango; imagen redactada), **marcado para quien lo pide** (ver "Rastreo de filtraciones"). Headers `x-blindaje-variant`, `x-blindaje-marca: aplicada \| no_aplicada` y, si no se aplicó, `x-blindaje-marca-motivo`. Auditado. |
| GET | `/v1/console/cases/:id` | reviewer, analyst | → `CaseSide` + transcripciones (cada evidencia trae `autenticidad` y `prompt_guard`) |
| GET | `/v1/console/networks` | analyst, admin | → `{ networks: NetworkSummary[] }` |
| GET | `/v1/console/networks/:id` | analyst, admin | → `NetworkView` |
| POST | `/v1/console/networks/:id/cartografo` | analyst | `{ model?: "muse-spark-1.3" \| "muse-wonder-1.0" }` → `ProfileView` |
| GET | `/v1/console/networks/:id/profiles` | analyst, admin | → `{ profiles: ProfileView[] }` |
| POST | `/v1/console/hypotheses/:id/decision` | analyst | `HypothesisDecisionRequest` → `HypothesisView` |
| POST | `/v1/console/profiles/:id/decision` | analyst | `{ decision: "aprobar" \| "rechazar" }` → `ProfileView` (`409` si el perfil es `invalido`) |
| POST | `/v1/console/vigia/run` | analyst, admin | → `{ alerts: AlertView[] }` (lo mismo que hace el cron) |
| GET | `/v1/console/alerts?status=` | reviewer, analyst, admin | → `{ alerts: AlertView[] }` (reviewer: solo su organización) |
| POST | `/v1/console/alerts/:id/decision` | reviewer, admin | `AlertDecisionRequest` → `AlertView` |
| POST | `/v1/console/networks/:id/expediente` | analyst | → `ExpedienteView` |
| GET | `/v1/console/networks/:id/expedientes` | analyst, admin | → `{ expedientes: ExpedienteView[] }` (más recientes primero) |
| GET | `/v1/console/expedientes/:id` | analyst | → `ExpedienteView` |
| GET | `/v1/console/expedientes/:id/pdf` | analyst | → `application/pdf` |
| GET | `/v1/console/audit?before_seq=&limit=` | admin, analyst | → `{ entries: AuditEntry[] }` |
| GET | `/v1/console/audit/verify` | admin, analyst | → `AuditVerifyResponse` |
| GET | `/v1/console/costs` | admin, analyst | → `CostsResponse` |
| GET/POST | `/v1/console/orgs` | admin | organizaciones |
| POST | `/v1/console/invites` | admin, reviewer | `{ org_id?, count }` → `{ codes: string[] }` |
| GET/POST | `/v1/console/users` | admin | usuarios de consola |
| POST | `/v1/console/leaks/trace?kind=audio\|imagen` | admin | copia sospechosa cruda (audio o imagen, límite 50 MB; `kind` opcional, si no se deduce del content-type o de los bytes) → `LeakTraceResult`. El archivo nunca se guarda; queda en la auditoría (`leak.trace`) con su SHA-256. |

### Rastreo de filtraciones (marcas de agua por persona)

Esquemas en `packages/shared/src/leaks.ts`; tablas en `infra/migrations/0003_leak_tracing.sql`. Usa
AudioSeal y Video Seal del contenedor ML (`/watermark/{audio,image}/{embed,detect}`, ver
`docs/ML_API.md`).

- **Marcado** (`GET /v1/console/evidence/:id/media`): después de elegir la variante (recorte del
  WAV, imagen redactada u original), la API marca la copia con la identidad de quien la pide:
  - audio: AudioSeal con la marca de 16 bits de la cuenta (`user_leak_tags`; cada marca nueva queda a
    distancia de Hamming >= 5 de las demás y de `0x0000`/`0xFFFF`, comprobado en la misma sentencia
    de D1; si ya no queda espacio, la asignación falla y la copia sale con `marcas_agotadas`). La
    respuesta es WAV mono PCM16 de 16 kHz;
  - imagen: Video Seal con un mensaje aleatorio nuevo por entrega (`nbits` informado por el
    contenedor en `x-watermark-nbits`, 256 por defecto) → JPEG;
  - cada entrega queda en `watermark_issues` (cuenta, evidencia, variante, mensaje, hora) y la copia
    marcada se guarda cifrada en R2 (`cases/<case_id>/marked/<issue_id>`, AAD `marked:<issue_id>`),
    así reproducir el mismo recorte no vuelve a marcar. Se borra con el caso;
  - video y texto: `no_aplicada` con `tipo_no_soportado` (fuera de alcance);
  - **falla abierta**: si el contenedor no responde en 20 s o falla, se sirve sin marca con
    `no_aplicada` y `servicio_no_disponible`. La auditoría (`evidence.media`) guarda siempre `marca`,
    `marca_motivo`, `marca_tipo`, `marca_entrega`, `marca_cache`, `marca_modelo`, `marca_error` y
    `marca_ms`.
- **Rastreo** (`POST /v1/console/leaks/trace`, solo admin: la analista es quien más evidencia
  escucha y el rastreo le serviría para probar si una edición borra su marca; la administración no
  recibe copias). Respuesta `LeakTraceResult`: `{ detected, kind, score, candidates: [{ user_id,
  email_or_name, display_name, role, evidence_label, case_id, issued_at, bit_accuracy }], ambiguo,
  nota, model }`.
  - audio: solo si el detector dice que hay marca; candidatas las cuentas a distancia de Hamming
    <= 2 en bits duros. `ambiguo` si hay más de una o si los bits dudosos (lectura entre 0.35 y 0.65)
    acercan otra cuenta. `evidence_label` y `case_id` van en null (la marca es de la cuenta);
    `issued_at` es el último audio marcado que recibió;
  - imagen: exactitud de bits contra el mensaje de cada entrega con los mismos nbits; atribuye con
    >= 0.85 y al menos 0.10 de ventaja sobre la segunda (si no, `ambiguo` con las más cercanas);
  - `nota` siempre dice que son indicios: una edición fuerte puede borrar la marca y que no aparezca
    no prueba que el archivo no salió de Blindaje. Sin contenedor: `503`.
  - Orden de bits (contrato con el ML): audio `bits[i]` = bit (15 − i) del mensaje; imagen `bits[i]` =
    bit i del mensaje en hex, el más significativo primero en cada dígito.

### Inyección de instrucciones (Llama Prompt Guard 2)

Esquemas en `packages/shared/src/injection.ts`. Paso `prompt_guard` de la ingesta (después del
procesador y antes de la autenticidad): `/safety/prompt-guard` del contenedor revisa, en lotes de 64,
el texto de cada evidencia que llega a un modelo (mensaje o relato; turnos de la transcripción que
van a la ficha, nunca los de la víctima; lectura de notas de imágenes y videos). Resultado en el
derivado `prompt_guard` (`PromptGuardResult`: `status` `revisado | no_revisado`, `label`
`benigno | inyeccion`, `score` máximo, `model`, `threshold`, `textos`, `marcados`), visible en la
consola como `CaseSide.evidencia[].prompt_guard` y nunca en las respuestas de la víctima.

- Sin clasificador (503 `prompt_guard_unavailable` o contenedor caído): `no_revisado`, se registra y
  nada se detiene. Antes de la ficha se revisa en un lote lo que quedó sin revisar.
- Con o sin clasificador, la evidencia llega a los modelos **delimitada como dato**
  (`<<<EVIDENCIA EV-…>>>` … `<<<FIN EV-…>>>`, sin que el texto pueda cerrar el bloque) y, si está
  marcada, con un aviso delante (fuera del bloque): ficha, fragmentos y fichas del Vinculador, rasgos
  del Vigía, salidas de las herramientas del Cartógrafo y del Redactor (`evidencia_marcada`,
  `aviso_seguridad`) y el análisis de autenticidad. Todos los prompts de sistema (`PROMPT_VERSION`
  2026-10-28.4) prohíben seguir instrucciones que vengan dentro de la evidencia. Lo marcado nunca se
  descarta: sigue siendo evidencia.

## Demo (solo con `DEMO_MODE=true`)

| Método | Ruta | Cuerpo |
|---|---|---|
| POST | `/v1/demo/reset` | header `x-demo-secret` → borra todo lo marcado `is_demo` |
| POST | `/v1/demo/seed` | header `x-demo-secret` → crea organización, usuarios y los casos A, B y C |

Fuera del entorno de demo responden `404 demo_disabled`.

## Contenedor de ML

El Worker habla con el contenedor `blindaje-ml` por el binding de Containers. Contrato en
`docs/ML_API.md`.

## Negocios (rol `business`)

Portal para dueños y gerentes de negocios afiliados a una organización. Esquemas en
`packages/shared/src/business.ts`. **Solo información agregada**: no hay buscador de números,
cuentas ni placas (un extorsionador infiltrado lo usaría para saber si está marcado). Cifras por zona o
sector solo con ≥ 5 casos y ≥ 3 víctimas; si no, `null` y `aviso_umbral`. Nunca se aconseja pagar ni negociar.

| Método | Ruta | Rol | Cuerpo → respuesta |
|---|---|---|---|
| POST | `/v1/auth/business/login` | público | `BusinessLoginRequest` → `BusinessLoginResponse` |
| POST | `/v1/auth/business/refresh` | público | `{ refresh_token }` → `TokenPair` |
| GET | `/v1/business/me` | business | → `BusinessMe` |
| GET | `/v1/business/risk?zona=&sector=` | business | → `RiskOverview` (por defecto, su zona y su sector) |
| GET | `/v1/business/recommendations` | business | → `{ recommendations: BusinessRecommendationView[] }` (solo aprobadas de su organización) |
| GET | `/v1/business/alerts` | business | → `{ alerts: VictimAlert[] }` (aprobadas de su organización) |

Detalles del panorama de riesgo: periodo de 28 días; solo casos con consentimiento `comunitario` y
ficha (del demo solo para cuentas del demo). Si el rubro pedido no llega al umbral en la zona, las cifras
son de toda la zona y `sector` viene `null` (con `aviso_umbral`). `sectores_afectados` solo nombra los
rubros que llegan al umbral; el resto va en "Otros rubros (agregado)" (o "Varios rubros (agregado)" si ninguno llega). Cada rasgo de una modalidad
(grupo que dice ser, canal, frase, plazo, tipo de amenaza) también cumple el umbral. Ningún texto lleva
6 dígitos seguidos o más ni `ID-…`. El rol `business` recibe `403` en las rutas de consola y de víctima.

Consola, para el agente Asesor:

| Método | Ruta | Roles | Cuerpo → respuesta |
|---|---|---|---|
| POST | `/v1/console/asesor/run` | analyst, admin | `AsesorRunRequest` → `{ recommendations: ConsoleRecommendationView[] }` (borradores; sin zona ni rubro, una por cada zona y rubro de las cuentas de negocio de la organización, máximo 5) |
| GET | `/v1/console/recommendations?status=` | reviewer, analyst, admin | → `{ recommendations: ConsoleRecommendationView[] }` |
| POST | `/v1/console/recommendations/:id/decision` | reviewer, admin | `RecommendationDecisionRequest` → `ConsoleRecommendationView` (`409` si no pasó el validador de citas; reviewer: solo su organización) |
| POST | `/v1/console/business-accounts` | admin, reviewer | `CreateBusinessAccountRequest` → `BusinessMe` |

Víctima: `VictimReport` agrega `consejos: string[]`, consejos de prevención según **su propio caso**
(nunca menciona otros casos ni vínculos), y en `evidencia[]` el campo `autenticidad: string | null`.
