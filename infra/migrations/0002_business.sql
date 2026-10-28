-- Blindaje: inteligencia para negocios (rol business y agente Asesor).
-- Solo tablas nuevas: no se reconstruye ninguna tabla existente. Los CHECK de users.role y de
-- refresh_tokens.subject_type siguen igual; las cuentas de negocio y sus sesiones viven aparte.
-- Fechas en ISO 8601 UTC (TEXT).

-- Cuentas del portal de negocios: dueños y gerentes de negocios afiliados a una organización.
-- Nunca guardan datos de casos: solo ven información agregada.
CREATE TABLE business_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                  -- pbkdf2-sha256$iter$salt_b64$hash_b64
  business_name TEXT NOT NULL,
  sector TEXT NOT NULL,                         -- rubro: bodega, mototaxi, mercado…
  zona TEXT NOT NULL,                           -- distrito, nunca dirección
  disabled INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX idx_business_accounts_org ON business_accounts(org_id);

-- Refresh tokens rotativos del rol business (misma forma que refresh_tokens, tabla propia para no
-- reconstruir la de dispositivos y usuarios).
CREATE TABLE business_refresh_tokens (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL DEFAULT 'business' CHECK (subject_type = 'business'),
  subject_id TEXT NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,              -- SHA-256 del refresh token
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_business_refresh_subject ON business_refresh_tokens(subject_id);

-- Recomendaciones del Asesor: nacen en borrador y las aprueba el gremio de la organización.
CREATE TABLE business_recommendations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  sector TEXT NOT NULL,
  zona TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','aprobada','rechazada')),
  content_json TEXT NOT NULL,                   -- AsesorOutput (con citas internas en modalidades[].evidencia)
  citation_check_json TEXT NOT NULL,
  model TEXT NOT NULL,
  agent_run_id TEXT,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_business_recs_org ON business_recommendations(org_id, status);
