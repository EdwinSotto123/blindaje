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

## Consola (roles `reviewer`, `analyst`, `admin`)

| Método | Ruta | Roles | Cuerpo → respuesta |
|---|---|---|---|
| GET | `/v1/console/me` | todos | → `ConsoleUser` |
| GET | `/v1/console/links?status=` | reviewer, analyst | → `{ links: LinkView[] }` (por defecto `probable` y `por_revisar`, ordenados por puntaje) |
| GET | `/v1/console/links/:id` | reviewer, analyst | → `LinkView` |
| POST | `/v1/console/links/:id/decision` | reviewer, analyst | `LinkDecisionRequest` → `LinkView` (confirmar recalcula redes) |
| GET | `/v1/console/evidence/:id/media?start_ms=&end_ms=` | reviewer, analyst | → medio descifrado (audio recortado si hay rango; imagen redactada). Auditado. |
| GET | `/v1/console/cases/:id` | reviewer, analyst | → `CaseSide` + transcripciones |
| GET | `/v1/console/networks` | analyst, admin | → `{ networks: NetworkSummary[] }` |
| GET | `/v1/console/networks/:id` | analyst, admin | → `NetworkView` |
| POST | `/v1/console/networks/:id/cartografo` | analyst | `{ model?: "muse-spark-1.3" \| "muse-wonder-1.0" }` → `ProfileView` |
| GET | `/v1/console/networks/:id/profiles` | analyst, admin | → `{ profiles: ProfileView[] }` |
| POST | `/v1/console/hypotheses/:id/decision` | analyst | `HypothesisDecisionRequest` → `HypothesisView` |
| POST | `/v1/console/vigia/run` | analyst, admin | → `{ alerts: AlertView[] }` (lo mismo que hace el cron) |
| GET | `/v1/console/alerts?status=` | reviewer, analyst, admin | → `{ alerts: AlertView[] }` (reviewer: solo su organización) |
| POST | `/v1/console/alerts/:id/decision` | reviewer, admin | `AlertDecisionRequest` → `AlertView` |
| POST | `/v1/console/networks/:id/expediente` | analyst | → `ExpedienteView` |
| GET | `/v1/console/expedientes/:id` | analyst | → `ExpedienteView` |
| GET | `/v1/console/expedientes/:id/pdf` | analyst | → `application/pdf` |
| GET | `/v1/console/audit?before_seq=&limit=` | admin, analyst | → `{ entries: AuditEntry[] }` |
| GET | `/v1/console/audit/verify` | admin, analyst | → `AuditVerifyResponse` |
| GET | `/v1/console/costs` | admin, analyst | → `CostsResponse` |
| GET/POST | `/v1/console/orgs` | admin | organizaciones |
| POST | `/v1/console/invites` | admin, reviewer | `{ org_id?, count }` → `{ codes: string[] }` |
| GET/POST | `/v1/console/users` | admin | usuarios de consola |

## Demo (solo con `DEMO_MODE=true`)

| Método | Ruta | Cuerpo |
|---|---|---|
| POST | `/v1/demo/reset` | header `x-demo-secret` → borra todo lo marcado `is_demo` |
| POST | `/v1/demo/seed` | header `x-demo-secret` → crea organización, usuarios y los casos A, B y C |

Fuera del entorno de demo responden `404 demo_disabled`.

## Contenedor de ML

El Worker habla con el contenedor `blindaje-ml` por el binding de Containers. Contrato en
`docs/ML_API.md`.
