# Devlog: pipeline y vinculación (`services/api`, M2 y M3)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 02:25 · SAM 3.1 no entiende conceptos en español

Prueba con la foto del caso A (`eval/demo/foto-A.jpg`, 1600×1066), un concepto por petición:

| Concepto | Objetos | Confianza |
|---|---|---|
| bala / nota escrita a mano / fachada de tienda | 0 / 0 / 0 | |
| bullet | 0 | |
| bullet casing | 1 (caja 695,880–786,932) | 0.57 |
| handwritten note | 1 (caja 806,828–1161,1021) | 0.72 |
| storefront | 1 (caja 53,5–1580,849) | 0.75 |
| cartridge | 0 | |

Decisión: los conceptos van **en inglés por dentro y se etiquetan en español** (`SAM_LANG = "en"` en
`src/pipeline/image.ts`). "bala" usa dos prompts (`bullet` y `bullet casing`, unidos por IoU > 0.5);
el resto: `firearm`, `handwritten note`, `license plate`, `storefront`, `face`, `child`. Son 8
peticiones por imagen (0.02 USD). Costo de la prueba: 0.02 USD.

## 2026-10-28 02:45 · Decisiones de implementación

- **Cola y Workflow sobre la misma evidencia**: el primero la toma (`status = 'procesando'` con un
  `UPDATE … WHERE status IN ('recibido','error')`); el otro recibe `skipped: en_proceso`. La cola
  reintenta en 30 s y toma la evidencia después de 3 intentos; el Workflow espera hasta 6 min
  (sondeo cada 3 s) y luego la toma. Un error permanente (archivo ilegible, 4xx de Meta, presupuesto)
  deja la evidencia en `error` sin tumbar el caso.
- **Idempotencia**: cada procesador hace primero las llamadas externas y los objetos cifrados de R2,
  y al final un solo `DB.batch` que borra lo de la corrida anterior de esa evidencia e inserta lo
  nuevo. Reprocesar no duplica filas ni paga dos veces (`withCostCache` por SHA-256 del original:
  transcripción, cada concepto de SAM, lectura; ficha y Vinculador por SHA-256 de su entrada).
- **Audio**: el WAV de 16 kHz se reutiliza si ya existe. Los turnos de la víctima se marcan
  `es_victima` (hablante excluido por la muestra, o al menos la mitad del turno en segmentos
  excluidos). Sus segmentos nunca se guardan. Vocabulario de Transcribe: `TRANSCRIBE_KEYWORDS_BASE`
  + `grupo_que_dice_ser` de otros casos con consentimiento comunitario (máx. 40).
- **Imagen**: primero un JPEG normalizado en el contenedor (`/image/redact` sin regiones: aplica la
  orientación EXIF y quita metadatos), así SAM, el tapado y los recortes usan las mismas
  coordenadas. Imágenes de más de 700 KB van a SAM por la Files API (la Responses API acepta 1 MiB
  por cuerpo). Recortes (máx. 2 por concepto) sobre la imagen ya tapada, más la imagen completa
  (detecta fotos reenviadas). Notas y placas: Muse Spark 1.3 lee los recortes (`reasoning: minimal`).
- **Video**: `/video/sample` a 5 fps (máx. 300 cuadros), Files API, SAM en video solo para
  `license plate` y `face`; mejor cuadro = confianza × área; cuadro con rostros tapados.
- **Texto**: derivado de texto plano normalizado, cifrado en R2. El relato nunca entra en claro a D1.
- **Ficha**: entrada con el mismo formato que `eval/src/ficha-input.ts` (etiquetas y tipos
  idénticos). Barreras deterministas además del prompt: teléfonos solo si parecen celulares
  peruanos o internacionales escritos con "+" (un DNI de 8 dígitos nunca pasa), se descartan los
  números que dijo la víctima en sus turnos, los textos libres pierden números de 7+ dígitos y
  correos, y las citas a etiquetas inexistentes se limpian. Las placas leídas entran como
  identificadores aunque el modelo no las liste.
- **Motor**: FAISS da candidatos (voz por centroide y por segmento, texto, imagen); D1 da los que
  comparten HMAC o un hash perceptual cercano. Las señales se calculan exactas con los vectores de
  D1. Filtro siempre en D1: indexado, otro dispositivo, existe. Antes de buscar se compara el tamaño
  de cada índice con D1 y se reconstruye si no coincide (contenedor reiniciado).
- **Señales**: voz = logística del coseno con tope (con menos de `min_segmentos` segmentos ≥ b que
  coinciden, `p × 0.5 × n/min`); s-norm de `/voice/compare` se guarda en `z` si hay cohorte. Modus
  operandi = logística de (coseno + 0.05 × frases comunes [máx. 3] + 0.03 canal + 0.05 grupo) con
  tope `p_max`; frases con coincidencia difusa (sin tildes, mayúsculas ni puntuación; contención,
  Jaccard o edición ≥ 0.8). Imagen como en `eval/README.md`: Hamming ≤ `hamming_max` → `p_hamming`;
  si no, DINOv2 con tope `p_max` (solo recortes del mismo concepto). Identificador: `p` fijo.
- **Vinculador**: solo si `score_raw ≥ revisar`. Final = `min(ajustado, raw + 0.05)` en [0, 1];
  salida inválida → se guarda con `vinculador_valid = 0` y el puntaje del motor. Cada vínculo
  queda en la auditoría (`link.propose`). Los segmentos que coinciden van en
  `signals.voz.segmentos_coincidentes` y la consola arma los fragmentos con ellos.

## 2026-10-28 03:35 · Tests (Vitest en workerd, ML y Meta simulados)

22 tests nuevos (`pipeline.test.ts`, `linking.test.ts`, `victim-app.test.ts`); suite completa
89/89. Ningún test llega a la Meta API real: `setup.ts` instala un `fetch` que responde 401.
Escenarios con la calibración de la evaluación (`v1-eval-2026-10-28`):

| Par | Señales | score_raw | Estado |
|---|---|---|---|
| A–B (misma voz, números distintos, mismo guion) | voz 0.85, MO 0.40 | 0.91 | probable |
| B–C (misma cuenta de Yape, otra voz) | identificador 0.95, voz 0.00 | 0.9504 | probable |
| A–D (misma voz, guion distinto) | voz 0.85, MO < 0.05 | 0.85 | por_revisar |
| A–E (solo modus operandi) | MO 0.40 | 0.40 | descartado_auto (sin Vinculador) |

## 2026-10-28 03:50 · Prueba real (wrangler dev + contenedor ML local + Meta real)

Casos A, B y C del demo con los audios y la foto de `eval/demo`, consentimiento comunitario.

- A listo en 33 s, B en 16 s, C en 12 s. Reporte de A con ficha, hallazgos en vivo ("La nota de
  EV-A4 dice: «LOS X. 48 HORAS»", "En EV-A4 encontramos: bala, nota escrita a mano, fachada de
  tienda") y transcripciones; `report.pdf` de 20 KB.
- **A–B**: voz 0.85 (coseno 0.79, s-norm 5.0, 4/4 segmentos), MO 0.40 (texto 0.92, frases "habla
  con el jefe" y "no llames a la policía", Yape) → raw 0.91; Vinculador 0.90 → **probable**.
- **B–C**: identificador 0.95 (Yape …202), voz 0.00 (coseno 0.50) → raw 0.97; Vinculador 0.93 →
  **probable**. A–C quedó en `descartado_auto`.
- En la primera corrida el Vinculador bajó A–B a 0.65 porque "los números son distintos". Se le
  agregaron a la entrada los criterios del motor (números distintos no contradicen; sí lo hacen
  guiones, montos o canales incompatibles) y en la segunda corrida lo sostuvo.
- Gasto de este frente: 0.02 (prueba de SAM) + 0.132 (dos corridas completas y una cortada) ≈
  **0.15 USD**.

### Hallazgos y pendientes

- **El coseno de e5-small entre resúmenes es siempre alto** (0.92 a 0.96, también entre casos sin
  relación de guion), así que con `mo = {a: 12, b: 0.85}` el modus operandi llega casi siempre al
  tope 0.40. Con datos reales, "voz sola" daría 1 − 0.15 × 0.6 = 0.91 (probable) y quedaría en
  manos del Vinculador. Propuesta para que la evaluación la valide: `mo = {a: 40, b: 1.0}` (A–B
  sigue en 0.91; voz sola con otro guion baja a ~0.87).
- `demo:seed` debe mandar `x-demo-secret` también en `POST /v1/auth/device/register` para quedar
  exento del cupo de 10 registros por hora por IP.
- Transcribe no reconoció "Los X" en B1 (voz sintética) aunque iba en el vocabulario; la ficha de
  B quedó sin grupo.
- `wrangler dev` recarga con cada cambio de archivo (también los commits de otros frentes) y corta
  el trabajo de colas y Workflows en curso; las evidencias quedan `procesando` hasta que la cola o
  el Workflow las retoman.
- `ensureIndices` reconstruye FAISS desde la D1 que lo llama: la prueba local dejó en el
  contenedor de `localhost:8080` los vectores de los casos A, B y C locales.
