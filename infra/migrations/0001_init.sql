-- Blindaje: esquema inicial de D1.
-- Modelo de datos de la sección 8 del documento de diseño, más alertas, consentimientos,
-- auditoría encadenada, organizaciones, usuarios, dispositivos, invitaciones,
-- solicitudes de piloto y registro de costos.
-- Fechas en ISO 8601 UTC (TEXT). IDs en UUID v4 o con prefijo legible.

PRAGMA foreign_keys = ON;

-- Organizaciones: gremios, asociaciones de mercado, juntas vecinales (nodos de confianza, 11.1)
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'gremio',          -- gremio | asociacion_mercado | junta_vecinal | alianza
  district TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Usuarios de consola: reviewer, analyst, admin
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,                  -- pbkdf2-sha256$iter$salt_b64$hash_b64
  role TEXT NOT NULL CHECK (role IN ('reviewer','analyst','admin')),
  disabled INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('device','user')),
  subject_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,              -- SHA-256 del refresh token
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_refresh_subject ON refresh_tokens(subject_type, subject_id);

-- Códigos de invitación que entrega cada organización a sus miembros verificados
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0
);

-- Dispositivos de víctimas (rol victim). Seudónimo, nunca nombre.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  pseudonym TEXT NOT NULL UNIQUE,               -- V-7F3K
  public_key_jwk TEXT NOT NULL,
  platform TEXT NOT NULL,
  invite_code TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,           -- monitoreo de cuentas sospechosas (12.3)
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

-- Muestra de voz de la víctima para excluirla (7.2.3). Solo el vector, cifrado. El audio no se guarda.
CREATE TABLE victim_voice_samples (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  vector_enc TEXT NOT NULL,                     -- base64(iv || ciphertext) con EVIDENCE_ENCRYPTION_KEY
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- CASO
CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                    -- A, B, C en el demo; 4 caracteres en general
  org_id TEXT NOT NULL REFERENCES organizations(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  seudonimo_victima TEXT NOT NULL,
  sector TEXT,
  zona_cuadricula TEXT,                         -- distrito o cuadrícula, nunca dirección
  primer_contacto TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','procesando','listo','error')),
  consent_mode TEXT NOT NULL DEFAULT 'solo_denuncia' CHECK (consent_mode IN ('solo_denuncia','comunitario')),
  ficha_json TEXT,                              -- FichaStored (sin identificadores en claro)
  identifiers_enc TEXT,                         -- identificadores en claro, cifrados, solo para la denuncia de la víctima
  narrative_enc TEXT,                           -- "cuéntanos qué pasó", cifrado
  indexed INTEGER NOT NULL DEFAULT 0,           -- 1 si sus señales están en los índices de comparación
  workflow_id TEXT,
  error TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT
);
CREATE INDEX idx_cases_device ON cases(device_id);
CREATE INDEX idx_cases_org ON cases(org_id);

-- EVIDENCIA
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  label TEXT NOT NULL UNIQUE,                   -- EV-A1
  seq INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('audio','imagen','video','texto')),
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,                         -- calculado en el servidor sobre el original
  sha256_client TEXT NOT NULL,
  received_utc TEXT NOT NULL,
  captured_at TEXT,
  source TEXT,
  duration_ms INTEGER,
  r2_key TEXT NOT NULL,                         -- original cifrado en blindaje-evidencia
  uploader_pseudonym TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'recibido' CHECK (status IN ('recibido','procesando','procesado','error')),
  error TEXT,
  UNIQUE (case_id, seq)
);
CREATE INDEX idx_evidence_case ON evidence(case_id);
CREATE INDEX idx_evidence_sha ON evidence(sha256);

-- DERIVADO: WAV normalizado, transcripción, segmentación, recortes, lectura de texto, frames
CREATE TABLE derivatives (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                           -- wav | transcripcion | segmentacion | recorte | lectura | redactada | frames
  content_json TEXT,
  r2_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_derivatives_evidence ON derivatives(evidence_id);
CREATE INDEX idx_derivatives_case ON derivatives(case_id, tipo);

-- HUELLA_VOZ: centroide por hablante (excluida la víctima)
CREATE TABLE voice_prints (
  id TEXT PRIMARY KEY,
  num INTEGER NOT NULL UNIQUE,                  -- V-<num>
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(id) ON DELETE CASCADE,
  speaker TEXT,                                 -- etiqueta de diarización: A, B…
  faiss_id INTEGER,
  segmentos INTEGER NOT NULL,
  duracion_seg REAL NOT NULL,
  segments_json TEXT,                           -- [{start_ms, end_ms}] de los segmentos usados
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_voice_case ON voice_prints(case_id);

-- Vectores: fuente de verdad para reconstruir los índices FAISS (voz, texto, imagen)
CREATE TABLE embeddings (
  faiss_id INTEGER PRIMARY KEY,                 -- id en el IndexIDMap correspondiente
  index_name TEXT NOT NULL CHECK (index_name IN ('voz','voz_segmento','texto','imagen')),
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,                       -- voice_print | voice_segment | ficha | image_crop
  ref_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector_b64 TEXT NOT NULL,                     -- Float32 little-endian, normalizado L2
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_embeddings_case ON embeddings(case_id);
CREATE INDEX idx_embeddings_index ON embeddings(index_name);

-- Recortes de imagen (SAM 3.1 + DINOv2 + hash perceptual)
CREATE TABLE image_crops (
  id TEXT PRIMARY KEY,
  num INTEGER NOT NULL UNIQUE,                  -- IMG-<num>
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,                        -- bala, nota escrita a mano, placa de vehículo…
  box_json TEXT NOT NULL,
  score REAL,
  phash TEXT,                                   -- 16 hex (64 bits)
  faiss_id INTEGER,
  r2_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_crops_case ON image_crops(case_id);

-- IDENTIFICADOR cifrado con HMAC-SHA256 (clave de la alianza)
CREATE TABLE identifiers (
  hmac TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,                     -- ID-xxxxxx
  tipo TEXT NOT NULL,
  ultimos_3 TEXT NOT NULL,
  first_seen TEXT NOT NULL
);

CREATE TABLE case_identifiers (
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hmac TEXT NOT NULL REFERENCES identifiers(hmac),
  rol TEXT NOT NULL,
  evidence_json TEXT,
  indexed INTEGER NOT NULL DEFAULT 0,           -- 1 solo si el caso tiene consentimiento comunitario
  created_at TEXT NOT NULL,
  PRIMARY KEY (case_id, hmac, rol)
);
CREATE INDEX idx_case_ident_hmac ON case_identifiers(hmac);

-- VINCULO (siempre case_a < case_b para evitar duplicados)
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  num INTEGER NOT NULL UNIQUE,                  -- VIN-<num>
  case_a TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  case_b TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  score_raw REAL NOT NULL,
  signals_json TEXT NOT NULL,
  vinculador_json TEXT,
  vinculador_valid INTEGER,
  calibration_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('probable','por_revisar','descartado_auto','confirmado','descartado')),
  reviewer_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (case_a, case_b),
  CHECK (case_a < case_b)
);
CREATE INDEX idx_links_status ON links(status);

-- RED: componentes de casos unidos por vínculos confirmados
CREATE TABLE networks (
  id TEXT PRIMARY KEY,
  num INTEGER NOT NULL UNIQUE,                  -- R-<num>
  n_casos INTEGER NOT NULL,
  community_key TEXT,                           -- huella del conjunto de casos para detectar cambios
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE network_cases (
  network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  PRIMARY KEY (network_id, case_id)
);
CREATE INDEX idx_network_cases_case ON network_cases(case_id);

-- PERFIL_RED (Cartógrafo)
CREATE TABLE network_profiles (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL,
  citation_check_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('borrador','aprobado','rechazado','invalido')),
  model TEXT NOT NULL,
  agent_run_id TEXT,
  reviewer_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE hypotheses (
  id TEXT PRIMARY KEY,
  num INTEGER NOT NULL UNIQUE,
  profile_id TEXT REFERENCES network_profiles(id) ON DELETE CASCADE,
  network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  confianza TEXT NOT NULL CHECK (confianza IN ('baja','media','alta')),
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','aprobada','descartada')),
  reviewer_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

-- ALERTA (Vigía): borrador hasta que el gremio la aprueba
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  network_id TEXT REFERENCES networks(id) ON DELETE SET NULL,
  pattern_key TEXT,                             -- evita duplicar alertas del mismo patrón
  draft_json TEXT NOT NULL,                     -- AlertaBorrador
  citation_check_json TEXT,
  status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','aprobada','rechazada')),
  image_r2_key TEXT,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_alerts_org ON alerts(org_id, status);

-- Expedientes (Redactor)
CREATE TABLE expedientes (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('generando','listo','error')),
  content_json TEXT,
  citation_check_json TEXT,
  r2_key TEXT,
  sha256 TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- CONSENTIMIENTO: historial de lo que autorizó cada víctima y cuándo
CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('solo_denuncia','comunitario')),
  text_version TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_consents_case ON consents(case_id);

-- Ejecuciones de agentes (trazabilidad y métrica de fidelidad de citas)
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,                          -- ficha | vinculador | cartografo | vigia | redactor
  target_type TEXT,
  target_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL,                         -- ok | invalido | error
  attempts INTEGER NOT NULL DEFAULT 1,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  output_json TEXT,
  citation_check_json TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- AUDITORIA encadenada: cada fila guarda el hash de la anterior
CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_type TEXT NOT NULL,                     -- victim | reviewer | analyst | admin | system
  actor_id TEXT NOT NULL,                       -- seudónimo o user id, nunca nombre de víctima
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details_json TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);

-- Solicitudes de piloto desde la landing
CREATE TABLE pilot_requests (
  id TEXT PRIMARY KEY,
  org_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  sector TEXT,
  district TEXT,
  members INTEGER,
  message TEXT,
  lang TEXT NOT NULL DEFAULT 'es',
  ip_hash TEXT,
  created_at TEXT NOT NULL
);

-- Registro de costos de la Meta Model API
CREATE TABLE api_costs (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,                      -- ficha | transcribe | sam_image | sam_video | vinculador | cartografo | vigia | redactor | image
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  frames INTEGER NOT NULL DEFAULT 0,
  audio_seconds REAL NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL,
  essential INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,                         -- ok | error | blocked | cached
  case_id TEXT,
  request_id TEXT,
  cache_key TEXT
);
CREATE INDEX idx_costs_ts ON api_costs(ts);
CREATE INDEX idx_costs_cache ON api_costs(cache_key);

-- Contadores para etiquetas legibles (V-n, IMG-n, VIN-n, R-n, HIP-n)
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('voice', 0), ('image', 0), ('link', 0), ('network', 0), ('hypothesis', 0), ('faiss', 0);
