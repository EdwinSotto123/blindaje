# eval/: evaluación y datos del demo

Mide lo que promete la sección 16 del documento de diseño y deja listos los datos de la historia
A, B y C. **Todo es ficticio o público con licencia abierta**: guiones, números (`+51 900 000 xxx`),
cuentas (`000-…`), placas (`0000-ZZ`), grupos ("Los X", "Los del Norte"…), fotos y audios sintéticos.
Nunca se usan datos de víctimas reales.

## Cómo correr

```bash
pnpm install
pnpm eval                          # todo: voz, imágenes, ficha, identificadores, escenarios y API
pnpm eval -- --sin-api             # sin las métricas que dependen de la API desplegada
pnpm eval -- --voz-backend ml      # exige el contenedor ML (ML_URL, por defecto http://localhost:8080)
pnpm eval -- --todos               # ficha sobre los 32 guiones en vez de 20
pnpm eval -- --sin-mo              # sin calibrar el modus operandi (necesita /text/embed del contenedor)
pnpm demo:reset && pnpm demo:seed  # historia A, B y C en la API (API_URL, DEMO_SECRET)
```

Requisitos: Node 22, pnpm, [uv](https://docs.astral.sh/uv/) y ffmpeg con libopus. La primera corrida
descarga SLR73 (1.9 GB) en `eval/data/downloads/` y los modelos abiertos (ECAPA, DINOv2, MMS-TTS)
en `eval/data/downloads/models/`. Nada de eso se sube al repo.

Secretos (nunca se imprimen ni se suben): `MODEL_API_KEY` y `DEMO_SECRET` se leen del entorno o de
`services/api/.dev.vars`. `API_URL` sale del entorno o de `services/api/README.md`.

Salidas: `eval/report.json` (datos), `eval/REPORT.md` (lectura), `eval/calibration.json` (forma
`Calibration` de `packages/shared`) y `eval/cohort.npy` (cohorte de s-norm).

## Qué se mide

| Métrica (`resumen[].id`) | Cómo | Meta |
|---|---|---|
| `voz_top1`, `voz_top3` | SLR73: por hablante, inscripción con 2 notas de voz por el canal 1 y 2 pruebas por el canal 2 contra todos los inscritos | ≥ 80 % / ≥ 90 % |
| `falsos_vinculos_100` | Pares de personas distintas cuya probabilidad de voz calibrada llega a 0.60, por cada 100 comparaciones | ≤ 2 |
| `identificadores` | Escenarios con números escritos en formatos distintos: normalización + HMAC de `packages/shared` | 100 % |
| `ficha_campos` | Muse Spark 1.3 con `FICHA_SYSTEM`, salida strict de `FichaExtraction` y `reasoning.effort: "low"` sobre 20 guiones; 12 campos estructurados contra la etiqueta manual | ≥ 90 % |
| `agentes_citas` | Afirmaciones del Vinculador, el Cartógrafo y el Vigía en la API desplegada: toda cita existe en el material de la consola | 100 % |
| `estadisticas_menos_5` | Perfiles de red con menos de 5 casos que muestran territorio | 0 |
| `infiltrado` | Un dispositivo nuevo sube la voz de A y B y la cuenta de B y C; ninguna respuesta de víctima trae vínculos ni datos de otros casos | pasa |

Además: motor de vinculación sobre los escenarios (identificador, voz e imagen combinados con
`combineSignals` y los umbrales de `packages/shared`) e imágenes reutilizadas (phash y DINOv2).
Las métricas que dependen de la API quedan **pendientes** con su motivo si la API, el demo o los
agentes todavía no están listos: nunca se inventan.

## Estructura de `report.json` (schema 1.1)

El README del repo y la landing leen solo `resumen`. Cambios que rompan la forma suben
`schema_version`.

```ts
{
  schema_version: "1.0",
  generado: string,              // ISO 8601 UTC
  ficticio: true,
  aviso: string,
  git_commit: string | null,
  comando: string,
  resumen: Array<{
    id: "voz_top1" | "voz_top3" | "falsos_vinculos_100" | "identificadores"
      | "ficha_campos" | "agentes_citas" | "estadisticas_menos_5" | "infiltrado",
    nombre: string, nombre_en: string,
    valor: number | null,        // proporción 0–1, tasa por 100, conteo o 1/0 (pasa); null = pendiente
    unidad: "proporcion" | "por_100" | "conteo" | "pasa",
    meta: { op: ">=" | "<=" | "==", valor: number, texto: string },
    cumple: boolean | null,      // null si está pendiente
    estado: "ok" | "pendiente" | "error",
    nota: string                 // de dónde sale o por qué está pendiente
  }>,
  voz: { estado, backend, modelo, dataset, canales, protocolo, identificacion, identificacion_corta,
         verificacion, calibracion, falsos_vinculos, cohorte },
  ficha: { estado, modelo, reasoning_effort, prompt_version, guiones, exactitud_global,
           exactitud_por_campo, fichas_perfectas, frases_firma_recall, identificadores, privacidad,
           costo_usd_corrida, casos: [...] },
  identificadores: { exactitud, pares_esperados, verdaderos, falsos, faltantes, formatos_probados, ... },
  imagenes: { estado, backend_dino, distribuciones, por_transformacion, con_hamming_max_10 },
  escenarios: { estado, senales_medidas, precision, recall, falsos_por_100_comparaciones, por_escenario,
                propuestos_por_estado, pares },
  modus_operandi: { estado, formula, pares, distribuciones, coseno_texto, calibracion, comparacion,
                    verificaciones: { a_demo_AB, b_voz_sola_guion_distinto, c_mo_solo }, demo_pares },  // desde 1.1
  agentes: { estado, motivo?, fidelidad, afirmaciones, verificadas, sin_cita, citas_inexistentes, por_agente },
  privacidad: { estadisticas_menos_5: {...}, infiltrado: { estado, pasa, chequeos: [{ nombre, ok, detalle? }] } },
  calibracion: Calibration,      // igual a eval/calibration.json
  costos: { meta_api_usd_total, llamadas, por_modelo, nota }
}
```

## Calibración

`eval/calibration.json` tiene la forma de `Calibration` (`packages/shared/src/linking.ts`) y se carga
en KV `calibration:v1`:

```bash
cd services/api && npx wrangler kv key put --binding CONFIG calibration:v1 --path ../../eval/calibration.json --remote
```

- **Voz:** `p = 1 / (1 + e^-(a·(s − b)))` sobre el coseno entre centroides. `a` y `b` salen de las
  dos distribuciones (misma persona y distintas) modeladas como normales: `b` es la similitud donde el
  cociente de verosimilitud vale 1 y `a` la pendiente de su logaritmo ahí. Después `b` sube si hace
  falta para no pasar de 1 falso por cada 100 pares distintos en el umbral de revisión. La regresión
  logística por máxima verosimilitud se reporta como referencia pero no se usa: con clases casi
  separadas su pendiente crece sin límite. `p_max = 0.85`: la voz sola nunca llega a "probable".
- **Imagen** (cómo debe leerla el motor): si la distancia de Hamming del phash es ≤ `hamming_max`,
  `p = p_hamming`; si no, `p = min(logística(DINOv2, dino_a, dino_b), p_max)`. Con `p_max = 0.5`,
  DINOv2 solo suma a otras señales: en la medición no distingue notas distintas del mismo estilo.
- **Modus operandi:** la misma fórmula del pipeline (`moProbability` de `services/api/src/linking/signals.ts`,
  importada): `x = coseno(resumen_mo) + 0.05·min(frases comunes, 3) + 0.03·mismo canal + 0.05·mismo grupo`.
  Con fichas reales de Muse Spark de los 32 guiones y vectores `multilingual-e5-small` del contenedor,
  `a` y `b` salen igual que en la voz (gaussiana sobre pares del mismo guion o banda frente a pares
  distintos) con una restricción: como máximo 1 de cada 100 pares distintos llega a `p_crit`, la
  probabilidad de MO que con la voz en su tope (0.85) haría "probable" el vínculo: `1 − 0.10/0.15 = 1/3`.
  Se verifica que A–B del demo siga en ≥ 0.90, que una voz sola con guion distinto quede bajo 0.90 y
  que el MO solo nunca pase de `descartado_auto` (`p_max = 0.4`).
- **Identificador y umbrales:** sin cambios respecto de `DEFAULT_CALIBRATION`.
- **Cohorte:** `eval/cohort.npy` (N × 192, float32, normalizada) con centroides de los hablantes de
  SLR73 que no entran a la prueba. Se carga en el contenedor con `POST /voice/cohort`.

## Datos

| Archivo | Qué es |
|---|---|
| `data/guiones.json` | 32 guiones de amenaza ficticios con su etiqueta manual (valores esperados de cada campo de la ficha y datos de la víctima que nunca deben salir). `subconjunto_ficha` lista los 20 de la métrica. |
| `data/escenarios.json` | 27 casos en 5 escenarios: misma voz con otros números, mismo guion con otras voces, cuentas compartidas (y una cuenta que difiere en un dígito), imágenes reutilizadas y la red A-B-C en versión de evaluación. `pares_vinculados` es la verdad de referencia. |
| `audio/raw/` | Grabaciones de voluntarios (no se suben; ver `audio/raw/README.md`). |
| `demo/` | Datos del demo: `demo.json` (historia A, B y C), audios, foto y manifiestos. Ver `demo/README.md`. |
| `py/` | Proyecto Python (uv): SLR73, simulación de WhatsApp, huella de voz, calibración, imágenes y MMS-TTS. |
| `src/` | Runner (`run.ts`), ficha, identificadores, escenarios, métricas de la API, `demo:seed` y `demo:reset`. |

Simulación de WhatsApp (`py/blindaje_eval/whatsapp.py`, también como comando): Opus mono de 16 kHz,
ida y vuelta a WAV, con dos "celulares": canal 1 (pasa altos 120 Hz, pasa bajos 7 kHz, ruido rosa
leve, 16 kbps) y canal 2 (banda telefónica 300–3400 Hz, −3 dB, más ruido, 10 kbps).

```bash
cd eval/py && uv run python -I -m blindaje_eval.whatsapp entrada.wav salida.ogg --canal 2 --wav salida.wav
```

## Atribuciones y licencias

- **Voces: OpenSLR SLR73**, "Crowdsourced high-quality Peruvian Spanish speech data set",
  https://www.openslr.org/73/. Copyright 2018, 2019 Google, Inc. Licencia **Creative Commons
  Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**, https://creativecommons.org/licenses/by-sa/4.0/.
  Cita: Guevara-Rukoz, A., Demirsahin, I., He, F., Chu, S.-H. C., Sarin, S., Pipatsrisawat, K.,
  Gutkin, A., Butryna, A. y Kjartansson, O. (2020). *Crowdsourcing Latin American Spanish for
  Low-Resource Text-to-Speech*. Proceedings of LREC 2020, pp. 6504–6513. Los audios no se
  redistribuyen. `eval/cohort.npy` contiene vectores derivados de esas grabaciones (huellas de voz de
  192 números por audio, procesadas con la simulación de WhatsApp) y se comparte bajo la misma
  licencia CC BY-SA 4.0, con esta atribución.
- **Audios sintéticos del demo: MMS-TTS de Meta** (`facebook/mms-tts-spa`), Pratap et al. (2023),
  *Scaling Speech Technology to 1,000+ Languages*. Licencia **CC-BY-NC-4.0** (uso no comercial),
  verificada en https://huggingface.co/facebook/mms-tts-spa: aceptable para este demo de hackathon,
  no para un uso comercial. Si el equipo graba los audios, reemplazan a los sintéticos.
- **Huella de voz:** SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`, Apache-2.0).
  **Imágenes:** DINOv2 ViT-S/14 (`facebook/dinov2-small`, Apache-2.0) e `imagehash` (BSD-2).
- **Fotos del demo:** generadas con Muse Image (`muse-image-1.0`) para este proyecto. No retratan un
  lugar ni un hecho real.
