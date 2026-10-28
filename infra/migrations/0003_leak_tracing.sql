-- Blindaje: rastreo de filtraciones (PLAN D14). Solo tablas nuevas.
-- Cada audio o imagen de evidencia que sirve la consola lleva una marca de agua invisible de quien
-- la pidió. Fechas en ISO 8601 UTC (TEXT).

-- Marca de audio de cada cuenta de consola: AudioSeal lleva 16 bits, así que la marca es de la
-- cuenta (no del archivo). Cada marca nueva queda a distancia de Hamming >= 5 de todas las demás
-- (y de 0x0000 y 0xFFFF): con 2 bits errados todavía se atribuye a una sola cuenta. La asigna la API
-- (búsqueda aleatoria) la primera vez que la cuenta pide un audio; si ya no hay espacio, falla.
CREATE TABLE user_leak_tags (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  audio_tag INTEGER NOT NULL UNIQUE CHECK (audio_tag BETWEEN 0 AND 65535),
  created_at TEXT NOT NULL
);

-- Cada copia marcada que salió de la consola. Imagen: un mensaje aleatorio nuevo por entrega
-- (Video Seal, nbits del contenedor, en hex) que atribuye a cuenta + evidencia + hora. Audio: la
-- marca de la cuenta (4 dígitos hex). Sin FK a evidence a propósito: si la víctima borra su caso, la
-- entrega sigue sirviendo para atribuir una filtración (no guarda contenido, solo ids y el mensaje).
-- r2_key: copia marcada cifrada en R2 bajo el prefijo del caso (se borra con el caso), para no volver
-- a marcar el mismo recorte cada vez que se reproduce.
CREATE TABLE watermark_issues (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio','imagen')),
  message TEXT NOT NULL,                        -- hex: 4 dígitos (audio) o nbits/4 (imagen)
  nbits INTEGER NOT NULL,
  variant TEXT NOT NULL,                        -- variante servida + rango (wav_recortado:3200-9800)
  model TEXT,                                   -- detector/embebedor que informó el contenedor
  r2_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_watermark_issues_kind ON watermark_issues(kind, created_at);
CREATE INDEX idx_watermark_issues_lookup ON watermark_issues(evidence_id, user_id, variant);
CREATE INDEX idx_watermark_issues_user ON watermark_issues(user_id, kind);
