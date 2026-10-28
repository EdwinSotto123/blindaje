# Evaluación de Blindaje

Generado el 28 de octubre de 2026, 2:34 a. m. (hora de Lima) con `pnpm eval -- --voz-backend ml` en el commit `9c66fe5`.
Estructura de los datos: `eval/report.json` (schema 1.0, ver `eval/README.md`).

> Todos los datos de esta evaluación son ficticios (guiones, números, cuentas, grupos, imágenes y audios sintéticos) o públicos con licencia abierta (voces de OpenSLR SLR73, CC BY-SA 4.0). No se usaron datos de víctimas reales.

## Resumen

| Métrica | Resultado | Meta | Cumple | Nota |
|---|---|---|---|---|
| Vinculación por voz: caso correcto en primer lugar | 100.0 % | ≥ 80 % | sí | SLR73, 28 hablantes, backend ml |
| Vinculación por voz: caso correcto entre los 3 primeros | 100.0 % | ≥ 90 % | sí | SLR73, 28 hablantes, backend ml |
| Falsos vínculos por cada 100 comparaciones sobre el umbral de revisión | 0.19 | ≤ 2 | sí | Señal de voz sola con la calibración propuesta (umbral 0.60); SLR73, 28 hablantes, backend ml |
| Coincidencias exactas de identificadores detectadas | 100.0 % | 100 % | sí | 9/9 pares, 0 falsos; normalización y HMAC de packages/shared |
| Campos de la ficha correctos frente a la etiqueta manual | 93.8 % | ≥ 90 % | sí | 20 guiones, 12 campos, muse-spark-1.3 (reasoning low) |
| Afirmaciones de los agentes con evidencia citada y verificable | pendiente | 100 % | pendiente | Todavía no hay salidas de los agentes (Vinculador, Cartógrafo, Vigía) en el entorno del demo. Vigía: 0 borradores de alerta. |
| Estadísticas mostradas con menos de 5 casos | pendiente | 0 | pendiente | Todavía no hay perfiles de red del Cartógrafo para revisar. |
| Prueba del infiltrado: no recibe vínculos ni datos de otros casos | pasa | pasa | sí | 8/8 chequeos; pipeline sin vínculos todavía, repetir |

Las metas son objetivos de trabajo de la sección 16.2 del documento de diseño, no garantías. Los resultados son los reales de esta corrida.

## Vinculación por voz

- **Datos:** OpenSLR SLR73 (español de Perú) (CC BY-SA 4.0), 28 hablantes de prueba y 10 de cohorte (nunca en la prueba). 242 notas de voz simuladas; duración media 13.0 s (condición corta: 6.9 s).
- **Modelo:** `speechbrain/spkrec-ecapa-voxceleb` por el backend **ml** (contenedor ML, `/voice/embed`).
- **Protocolo:** Por hablante: inscripción = centroide de 2 notas de voz (~16 s) por el canal 1; pruebas = 2 notas por el canal 2, comparadas contra todos los inscritos. Condición corta: 2 notas de ~7 s por el canal 2.
- **Canales:** canal 1 = celular 1 (gama media), Opus 16k; canal 2 = celular 2 (gama baja, banda telefónica), Opus 10k. Ida y vuelta Opus → WAV 16 kHz con ffmpeg.

| | Primer lugar | Entre los 3 primeros | Con s-norm (1.º / top 3) |
|---|---|---|---|
| Notas de ~16 s (56 pruebas contra 28 inscritos) | 100.0 % | 100.0 % | 100.0 % / 100.0 % |
| Notas cortas de ~7 s (56 pruebas) | 100.0 % | 100.0 % | 100.0 % / 100.0 % |

Similitud coseno entre centroides: misma persona 0.768 ± 0.049 (mín. 0.657), personas distintas 0.222 ± 0.120 (p99 0.538, máx. 0.643). EER 0.00 % con coseno, 3.21 % con s-norm y 1.62 % en la condición corta.

**Falsos vínculos.** Pares de personas distintas cuya probabilidad de voz calibrada (con p_max) alcanza el umbral de revisión, por cada 100 comparaciones (todas: misma persona y distintas). La voz sola nunca supera p_max = 0.85: no llega a 'probable' (0.90) y siempre pasa por revisión humana.

| | Falsos por 100 comparaciones | Falsos por 100 pares distintos | Pares de la misma persona sobre el umbral |
|---|---|---|---|
| Todas las pruebas (~16 s) | 0.19 | 0.20 | 100.0 % |
| Validación cruzada por hablante (promedio de 2 particiones) | 0.00 | — | 100.0 % |
| Notas cortas (~7 s) | 0.06 | 0.07 | 91.1 % |

### Calibración de la voz y razonamiento

- Método: Gaussiana: cada distribución (misma persona, distintas) como normal; b = similitud donde el cociente de verosimilitud vale 1 y a = pendiente de su logaritmo en ese punto. Luego b sube si hace falta para dejar como máximo 1 falso por cada 100 pares distintos sobre el umbral de revisión.
- Con las dos distribuciones de arriba, el cociente de verosimilitud vale 1 en s = 0.6006 y la pendiente de su logaritmo ahí es 96.7. El percentil 99 de los pares distintos es 0.5382, que con esa pendiente pide b ≥ 0.5340 para no pasar de 1 falso por cada 100 pares distintos en el umbral 0.60. Propuesta: **a = 96.66, b = 0.6006**, p_max = 0.85 (la voz sola nunca llega a "probable").
- La regresión logística por máxima verosimilitud da a = 1311.5, b = 0.6491: con clases casi separadas la pendiente crece sin límite y las probabilidades quedan sobreconfiadas, así que no se usa.
- Validación cruzada (se ajusta con la mitad de los hablantes y se mide en la otra mitad): a = 108.7, b = 0.600 → 0.00 falsos por 100 y 100.0 % de pares correctos sobre el umbral; a = 91.5, b = 0.592 → 0.00 falsos por 100 y 100.0 % de pares correctos sobre el umbral.
- Límite honesto: SLR73 es habla leída y grabada con buena calidad; la compresión de WhatsApp y los dos celulares son simulados. Con grabaciones reales de voluntarios (eval/audio/raw/) las distribuciones se van a abrir y hay que recalibrar. Por eso la voz nunca vincula sola y todo vínculo pasa por revisión humana.
- Cohorte de referencia para s-norm: `eval/cohort.npy`, 60 vectores de 192 dimensiones (10 hablantes x 6 audios, ambos canales), backend ml. Se carga en el contenedor con `POST /voice/cohort`.

## Ficha del caso (Muse Spark)

`muse-spark-1.3`, prompt `FICHA_SYSTEM` (versión 2026-10-28.1), salida estructurada strict de `FichaExtraction` y `reasoning.effort: "low"`, sobre 20 guiones ficticios. Se puntúan 12 campos estructurados; amenaza, plazo, resumen_mo son texto libre y no se puntúan.

**Exactitud global: 93.8 %** (8 de 20 fichas sin errores). Frases firma encontradas: 95.0 %. Identificadores: precisión 100.0 %, recall 100.0 %. Fichas sin datos de la víctima: 20/20.

| Campo | Correctos |
|---|---|
| sector | 100.0 % |
| primer_contacto | 100.0 % |
| tipo_amenaza | 100.0 % |
| monto_soles | 100.0 % |
| periodicidad | 45.0 % |
| plazo_horas | 100.0 % |
| canal_pago | 100.0 % |
| identificadores | 100.0 % |
| grupo_que_dice_ser | 100.0 % |
| frases_firma | 85.0 % |
| escalamiento | 95.0 % |
| fuentes | 100.0 % |

<details><summary>Errores por guion</summary>

| Guion | Campo | Esperado | Obtenido |
|---|---|---|---|
| G01 | periodicidad | "unico" | null |
| G05 | periodicidad | "unico" | null |
| G07 | periodicidad | "unico" | null |
| G07 | frases_firma | ["esto no es juego","ya sabemos dónde trabajas","pagas o cierras"] | ["Esto no es juego","Pagas o cierras"] |
| G09 | periodicidad | "unico" | null |
| G11 | periodicidad | "unico" | null |
| G11 | frases_firma | ["esto no es juego","ya sabemos dónde trabajas","pagas o cierras"] | ["Somos Los del Norte","Esto no es juego","Pagas o cierras","Y piensa en tus hijos"] |
| G12 | periodicidad | "unico" | null |
| G15 | periodicidad | "unico" | null |
| G17 | periodicidad | "unico" | null |
| G17 | frases_firma | ["último aviso","no te hagas el loco","la próxima no es advertencia"] | ["Habla Los Y","Esto es un último aviso","No te hagas el loco"] |
| G19 | escalamiento | [] | [{"fecha":"2026-10-14","tipo":"amenaza a hijos tras vencimiento del plazo"}] |
| G22 | periodicidad | "unico" | null |
| G25 | periodicidad | "unico" | null |
| G31 | periodicidad | "unico" | null |

</details>

Costo de esta corrida: 0.0000 USD en 0 llamadas nuevas (las demás salieron de la caché; costo total de las respuestas cacheadas: 0.1331 USD).

## Identificadores

54 identificadores de los escenarios en 13 formatos de escritura distintos, normalizados (E.164, dígitos, placas) y cifrados con HMAC-SHA256 con el código de `packages/shared` y una clave aleatoria de evaluación. **9 de 9 pares esperados detectados (100.0 %)**, 0 pares falsos, 0 identificadores inválidos. La cuenta que difiere en un dígito no produjo un falso positivo. Solo HMAC-SHA256 (referencia ID-xxxxxx) y los últimos 3 dígitos; nunca el valor legible.

## Imágenes reutilizadas

Fuentes ficticias: foto del demo y una foto parecida (Muse Image) y 12 notas manuscritas generadas. Transformaciones: original, whatsapp, captura, doble_reenvio. DINOv2 por el backend ml.

| Transformación | Distancia de Hamming del phash frente al original | DINOv2 mínimo |
|---|---|---|
| whatsapp | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | 0.995 |
| captura | 10, 12, 10, 16, 14, 8, 18, 16, 18, 18, 12, 16, 12, 16 | 0.833 |
| doble_reenvio | 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0 | 0.990 |

Pares de imágenes distintas: Hamming mínimo 12, DINOv2 hasta 0.993. Foto del demo frente a la foto parecida: DINOv2 0.841 a 0.911. Con Hamming ≤ 10 se detecta 60.7 % de las reutilizaciones y se marca 0.0 % de los pares distintos.

Lectura: el hash perceptual reconoce sin error una foto reenviada por WhatsApp, pero falla con capturas de pantalla (recorte y bordes). DINOv2 sobre la imagen completa mide parecido de escena, no identidad: dos notas distintas con el mismo estilo o dos fotos parecidas de una bodega se parecen tanto como una foto y su captura. Por eso la propuesta deja a DINOv2 por debajo del umbral de revisión cuando va solo.

## Motor de vinculación sobre los escenarios

Señales medidas: identificador, voz, imagen (el modus operandi no se mide aquí: nunca vincula solo). Combinación 1 − ∏(1 − pᵢ) y umbrales 0.90 / 0.60 de `packages/shared`, con la calibración propuesta. 

**16 de 18 vínculos esperados propuestos (recall 88.9 %), 1 propuestas falsas (precisión 94.1 %), 0.28 falsas por cada 100 de 351 comparaciones.**

| Escenario | Tipo | Esperados | Propuestos correctos | Falsos | Faltantes |
|---|---|---|---|---|---|
| S1 | misma_persona_distintos_numeros | 4 | 4 | 0 | 0 |
| S2 | distintas_personas_mismo_guion | 0 | 0 | 1 | 0 |
| S3 | cuentas_compartidas | 8 | 8 | 1 | 0 |
| S4 | imagenes_reutilizadas | 4 | 2 | 0 | 2 |
| S5 | red_combinada | 2 | 2 | 0 | 0 |

## Agentes y privacidad (API desplegada)

- **Fidelidad de citas de los agentes:** pendiente: Todavía no hay salidas de los agentes (Vinculador, Cartógrafo, Vigía) en el entorno del demo. Vigía: 0 borradores de alerta.
- **Estadísticas con menos de 5 casos:** pendiente: Todavía no hay perfiles de red del Cartógrafo para revisar.
- **Prueba del infiltrado:** pasa
  - ok: Su caso se procesa con normalidad (estado: listo)
  - ok: Ninguna respuesta trae claves prohibidas (vínculos, redes, puntajes, HMAC…)
  - ok: No aparece ningún caso, evidencia ni ficha de los casos del demo (A, D, E, B, F, C, G)
  - ok: No aparecen números ni cuentas de otros casos
  - ok: No aparecen etiquetas de vínculos ni redes (VIN-, R-)
  - ok: Pedir el reporte de otro caso responde 404 (404)
  - ok: La consola rechaza el token de víctima (403)
  - ok: El infiltrado puede borrar su propio caso (y deja de contar en la red)
  - Advertencia: La API todavía no genera la ficha ni vínculos para este caso (pipeline en construcción): la prueba confirma el aislamiento de las respuestas, pero hay que repetirla cuando el pipeline vincule de verdad.

## Calibración propuesta (`eval/calibration.json`)

Forma de `Calibration` de `packages/shared`. Para cargarla en el Worker: `npx wrangler kv key put --binding CONFIG calibration:v1 --path ../../eval/calibration.json --remote` desde `services/api`.

```json
{
  "version": "v1-eval-2026-10-28",
  "updated_at": "2026-10-28T07:34:11.044Z",
  "source": "eval/report.json (voz: SLR73 28 hablantes, backend ml; imagen: phash y DINOv2 (backend ml) sobre fotos del demo y notas ficticias); modus operandi, identificador y umbrales sin cambios",
  "thresholds": {
    "probable": 0.9,
    "revisar": 0.6
  },
  "voz": {
    "a": 96.663,
    "b": 0.6006,
    "min_segmentos": 2,
    "p_max": 0.85
  },
  "imagen": {
    "hamming_max": 10,
    "p_hamming": 0.8,
    "dino_a": 40,
    "dino_b": 0.959,
    "p_max": 0.5
  },
  "mo": {
    "a": 12,
    "b": 0.85,
    "p_max": 0.4
  },
  "identificador": {
    "p": 0.95
  }
}
```

## Costos de la Meta Model API (evaluación)

0.1531 USD en 21 llamadas, acumulado de todas las corridas de este frente. Solo las llamadas que hace eval/ (ficha y fotos del demo). Lo que gasta el pipeline de la API está en la consola de costos.
- `muse-spark-1.3`: 20 llamadas, 0.1331 USD
- `muse-image-1.0`: 1 llamadas, 0.0200 USD

## Cómo reproducir

```bash
pnpm eval                       # todo; descarga SLR73 si falta y usa la caché de la API
pnpm eval -- --sin-api          # sin las métricas que dependen de la API desplegada
ML_URL=http://localhost:8080 pnpm eval -- --voz-backend ml
```

Atribuciones y licencias de los datos en `eval/README.md`.
