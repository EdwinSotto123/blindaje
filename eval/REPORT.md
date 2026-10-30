# Evaluación de Blindaje

Generado el 28 de octubre de 2026, 4:06 a. m. (hora de Lima) con `pnpm eval -- --voz-backend ml ; pnpm --filter @blindaje/eval eval:agentes (agentes y estadísticas, 30 oct. 2026)` en el commit `9a6e67f`.
Estructura de los datos: `eval/report.json` (schema 1.1, ver `eval/README.md`).

> Todos los datos de esta evaluación son ficticios (guiones, números, cuentas, grupos, imágenes y audios sintéticos) o públicos con licencia abierta (voces de OpenSLR SLR73, CC BY-SA 4.0). No se usaron datos de víctimas reales.

## Resumen

| Métrica | Resultado | Meta | Cumple | Nota |
|---|---|---|---|---|
| Vinculación por voz: caso correcto en primer lugar | 100.0 % | ≥ 80 % | sí | SLR73, 28 hablantes, backend ml |
| Vinculación por voz: caso correcto entre los 3 primeros | 100.0 % | ≥ 90 % | sí | SLR73, 28 hablantes, backend ml |
| Falsos vínculos por cada 100 comparaciones sobre el umbral de revisión | 0.19 | ≤ 2 | sí | Señal de voz sola con la calibración propuesta (umbral 0.60); SLR73, 28 hablantes, backend ml |
| Coincidencias exactas de identificadores detectadas | 100.0 % | 100 % | sí | 9/9 pares, 0 falsos; normalización y HMAC de packages/shared |
| Campos de la ficha correctos frente a la etiqueta manual | 98.3 % | ≥ 90 % | sí | 20 guiones, 12 campos, muse-spark-1.3 (reasoning low) |
| Afirmaciones de los agentes con evidencia citada y verificable | 100.0 % | 100 % | sí | 49/49 afirmaciones |
| Estadísticas mostradas con menos de 5 casos | pendiente | 0 | pendiente | Todavía no hay perfiles de red del Cartógrafo para revisar. Sin redes para el Cartógrafo: se forman cuando una persona aprueba los vínculos en la consola. |
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

`muse-spark-1.3`, prompt `FICHA_SYSTEM` (versión 2026-10-28.2), salida estructurada strict de `FichaExtraction` y `reasoning.effort: "low"`, sobre 20 guiones ficticios. Se puntúan 12 campos estructurados; amenaza, plazo, resumen_mo son texto libre y no se puntúan.

**Exactitud global: 98.3 %** (16 de 20 fichas sin errores). Frases firma encontradas: 94.2 %. Identificadores: precisión 100.0 %, recall 100.0 %. Fichas sin datos de la víctima: 20/20.

| Campo | Correctos |
|---|---|
| sector | 100.0 % |
| primer_contacto | 100.0 % |
| tipo_amenaza | 100.0 % |
| monto_soles | 100.0 % |
| periodicidad | 100.0 % |
| plazo_horas | 100.0 % |
| canal_pago | 95.0 % |
| identificadores | 100.0 % |
| grupo_que_dice_ser | 100.0 % |
| frases_firma | 85.0 % |
| escalamiento | 100.0 % |
| fuentes | 100.0 % |

<details><summary>Errores por guion</summary>

| Guion | Campo | Esperado | Obtenido |
|---|---|---|---|
| G07 | frases_firma | ["esto no es juego","ya sabemos dónde trabajas","pagas o cierras"] | ["Somos Los del Norte","Esto no es juego","Pagas o cierras"] |
| G09 | frases_firma | ["esto no es juego","ya sabemos dónde trabajas","pagas o cierras"] | ["Esto no es juego","Pagas o cierras"] |
| G27 | frases_firma | ["mandamos tu foto a todos tus contactos","nosotros no perdonamos"] | ["Ya tenemos tus contactos.","Nosotros no perdonamos."] |
| G31 | canal_pago | "transferencia" | null |

</details>

Costo de esta corrida: 0.0000 USD en 0 llamadas nuevas (las demás salieron de la caché; costo total de las respuestas cacheadas: 0.1249 USD).

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

Señales medidas: identificador, voz, imagen, modus_operandi (el modus operandi sale de la ficha real del guion de cada caso y nunca vincula solo). Combinación 1 − ∏(1 − pᵢ) y umbrales 0.90 / 0.60 de `packages/shared`, con la calibración propuesta. 

**16 de 18 vínculos esperados propuestos (recall 88.9 %), 1 propuestas falsas (precisión 94.1 %), 0.28 falsas por cada 100 de 351 comparaciones.**

| Escenario | Tipo | Esperados | Propuestos correctos | Falsos | Faltantes |
|---|---|---|---|---|---|
| S1 | misma_persona_distintos_numeros | 4 | 4 | 0 | 0 |
| S2 | distintas_personas_mismo_guion | 0 | 0 | 1 | 0 |
| S3 | cuentas_compartidas | 8 | 8 | 1 | 0 |
| S4 | imagenes_reutilizadas | 4 | 2 | 0 | 2 |
| S5 | red_combinada | 2 | 2 | 0 | 0 |

Propuestos como "probable": 10 correctos y 0 falsos; como "por revisar": 6 correctos y 1 falsos.

## Modus operandi

Misma fórmula del pipeline (`moProbability` de `services/api/src/linking/signals.ts`, importada): x = coseno(resumen_mo) + 0.05·min(frases comunes, 3) + 0.03·mismo canal + 0.05·mismo grupo; p = min(logística(x, a, b), p_max). Fichas reales de Muse Spark para los 32 guiones y vectores `intfloat/multilingual-e5-small` del contenedor (`/text/embed`, passage). 47 pares del mismo guion o banda frente a 449 pares distintos.

- **El coseno de texto no separa nada:** mismo guion 0.915 ± 0.019, distintos 0.916 ± 0.023. Lo que separa son las frases firma comunes, el grupo y el canal: x = 1.095 ± 0.042 (mín. 1.005) frente a 0.925 ± 0.033 (p99 0.997, máx. 1.010).
- **Umbral que importa:** con la voz en su tope (0.85), el vínculo llega a "probable" (0.9) si el MO alcanza p_crit = 1 − (1 − 0.9) / (1 − 0.85) = 0.333.
- **Calibración (mismo método que la voz):** gaussiana b = 1.0022, a = 123.6; la restricción "como máximo 1 de cada 100 pares distintos llega a p_crit" pide b ≥ 1.0024. Propuesta: **a = 123.55, b = 1.0024, p_max = 0.4**.

| Calibración de MO | a | b | Pares del mismo guion que llegan a p_crit | Pares distintos que llegan a p_crit (voz sola + guion distinto → probable) |
|---|---|---|---|---|
| Anterior (valores iniciales) | 12.00 | 0.8500 | 100.0 % | 100.0 % |
| Propuesta del pipeline | 40.00 | 1.0000 | 100.0 % | 6.7 % |
| **Propuesta (medida)** | 123.55 | 1.0024 | 100.0 % | 0.9 % |

Verificaciones con la propuesta:

- (a) cumple: A–B del demo (voz coseno 0.786 → p 0.85, MO 0.400) da **0.910** (probable); con la calibración anterior daba 0.910.
- (b) cumple: con la voz en su tope y guion distinto, 4 de 449 pares de guiones llegarían a "probable" (0.9 %); en el demo A–C queda en 0.850 (por_revisar) y B–C queda en 0.851 (por_revisar).
- (c) cumple: el MO solo llega como máximo a 0.40 (descartado_auto).

Límite: los guiones de una misma familia comparten frases casi literales a propósito. Con guiones reales más variados, la señal de frases puede ser más débil; el Vinculador y la revisión humana siguen siendo la última palabra.

<details><summary>Pares del demo</summary>

| Par | Coseno de texto | Frases comunes | Mismo canal | Mismo grupo | p MO |
|---|---|---|---|---|---|
| A–B | 0.939 | Habla con el jefe | sí | sí | 0.400 |
| A–C | 0.909 | — | sí | no | 0.000 |
| A–D | 0.943 | todos pagan su colaboración; Habla con el jefe | sí | sí | 0.400 |
| A–E | 0.920 | no llames a la policía, porque nos vamos a enterar; Habla con el jefe | sí | sí | 0.400 |
| A–F | 0.893 | Habla con el jefe | sí | sí | 0.400 |
| A–G | 0.912 | Habla con el jefe | sí | sí | 0.400 |
| B–C | 0.930 | — | sí | no | 0.006 |
| B–D | 0.940 | Habla con el jefe | sí | sí | 0.400 |
| B–E | 0.945 | Habla con el jefe; Y no llames a la policía, que tenemos gente en todos lados | sí | sí | 0.400 |
| B–F | 0.915 | Habla con el jefe | sí | sí | 0.400 |
| B–G | 0.908 | Habla con el jefe | sí | sí | 0.400 |
| C–D | 0.939 | — | sí | no | 0.016 |
| C–E | 0.903 | — | sí | no | 0.000 |
| C–F | 0.949 | — | sí | no | 0.049 |
| C–G | 0.915 | — | sí | no | 0.001 |
| D–E | 0.929 | Habla con el jefe. | sí | sí | 0.400 |
| D–F | 0.920 | Habla con el jefe. | sí | sí | 0.400 |
| D–G | 0.916 | Habla con el jefe. | sí | sí | 0.400 |
| E–F | 0.905 | Habla con el jefe | sí | sí | 0.400 |
| E–G | 0.918 | Habla con el jefe | sí | sí | 0.400 |
| F–G | 0.917 | Habla con el jefe si quieres arreglar. | sí | sí | 0.400 |

</details>

## Agentes y privacidad (API desplegada)

- **Fidelidad de citas de los agentes:** 100.0 % (49/49 afirmaciones con cita verificable; 0 sin cita, 0 citas inexistentes)
- **Estadísticas con menos de 5 casos:** pendiente: Todavía no hay perfiles de red del Cartógrafo para revisar. Sin redes para el Cartógrafo: se forman cuando una persona aprueba los vínculos en la consola.
- **Prueba del infiltrado:** pasa
  - ok: Su caso se procesa con normalidad (estado: procesando)
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
  "updated_at": "2026-10-28T09:04:08.158Z",
  "source": "eval/report.json (voz: SLR73 28 hablantes, backend ml; imagen: phash y DINOv2 (backend ml) sobre fotos del demo y notas ficticias); modus operandi: fichas de 32 guiones con e5-small del contenedor; identificador y umbrales sin cambios",
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
    "a": 123.554,
    "b": 1.0024,
    "p_max": 0.4
  },
  "identificador": {
    "p": 0.95
  }
}
```

## Costos de la Meta Model API (evaluación)

0.3963 USD en 60 llamadas, acumulado de todas las corridas de este frente. Solo las llamadas que hace eval/ (ficha y fotos del demo). Lo que gasta el pipeline de la API está en la consola de costos.
- `muse-spark-1.3`: 59 llamadas, 0.3763 USD
- `muse-image-1.0`: 1 llamadas, 0.0200 USD

## Cómo reproducir

```bash
pnpm eval                       # todo; descarga SLR73 si falta y usa la caché de la API
pnpm eval -- --sin-api          # sin las métricas que dependen de la API desplegada
ML_URL=http://localhost:8080 pnpm eval -- --voz-backend ml
```

Atribuciones y licencias de los datos en `eval/README.md`.
