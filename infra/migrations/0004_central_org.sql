-- Blindaje: rediseño del 28 de octubre (docs/rediseno.md). Solo datos: sin cambios de columnas ni CHECK.
-- La organización central es el equipo de análisis de Blindaje (CENTRAL_ORG_ID en packages/shared).
-- Las víctimas que se registran sin código, el equipo (revisión, análisis, administración), las
-- alertas del Vigía y los consejos del Asesor quedan en ella. Las demás organizaciones siguen como
-- canales de difusión: su código de invitación funciona, pero ya no filtra lo que ve el equipo.
INSERT OR IGNORE INTO organizations (id, name, kind, district, is_demo, created_at)
VALUES ('org-central', 'Equipo Blindaje', 'alianza', NULL, 0, '2026-10-28T00:00:00.000Z');
