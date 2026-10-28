# Devlog: autenticidad de la evidencia (API, consola, expediente y víctima)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo. Contrato en
`packages/shared/src/authenticity.ts`; los detectores técnicos (AudioSeal, Video Seal, C2PA y
metadatos) los agrega el frente de ML en `services/ml`.

## 2026-10-28 05:05 · Documentación leída y decisiones

Leídas: `https://dev.meta.ai/docs/file-handling.md`, `video-understanding.md` (video y audio),
`image-understanding.md`, `models.md`, `reasoning.md` y el límite de 1 MiB de `protocols/responses.md`.

- **Modelos.** Imagen y video con `muse-spark-1.3`. Audio con `muse-spark-1.2`: la página de video
  y audio dice que la comprensión de audio de la 1.3 "no tiene soporte completo y la calidad puede
  degradarse" y sus ejemplos usan la 1.2 (también lo repite `models.md`).
- **Cómo va el archivo.**
  - Audio: parte `input_audio` `{ data, format: "wav" }` (solo MP3 y WAV). Se usa el WAV mono de
    16 kHz que el pipeline ya guarda (los originales suelen ser Opus), recortado a 90 s.
    `max_output_tokens: 4000`, porque el razonamiento comparte ese presupuesto (lo pide la doc).
  - Imagen: `input_image`, como data URL si pesa hasta 700 KB y si no por la Files API (igual que SAM).
  - Video: `input_video` con `file_id` (Files API, expira en 1 h y se borra al terminar).
  - `input_audio` no está en los tipos de `@blindaje/meta-client`: se manda con un cast y el
    cliente lo pasa tal cual.
  - El límite de 1 MiB es solo para `background: true`; en llamadas síncronas el límite en línea es de 50 MB.
- **Privacidad.** A Meta va lo mismo que ya ve el resto del pipeline, nunca los metadatos:
  - imagen como JPEG normalizado sin EXIF (`/image/redact` sin regiones);
  - video re-codificado a 5 fps sin audio ni metadatos (`/video/sample`);
  - audio como el WAV ya derivado.
  Al contenedor ML sí va el ORIGINAL (marca de agua, C2PA y metadatos viven ahí). De los
  metadatos, en el texto del modelo solo viajan el software, el tipo de fuente digital, las
  alertas y los NOMBRES de los campos. `sanitizeTecnicas` además descarta del derivado los campos
  con GPS, ubicación, autor, serie, dueño o contacto (segunda barrera: el ML ya los quita).
- **Nivel final por reglas (`nivelFinal`).**
  - "generado_ia_confirmado" si y solo si la marca de agua fue detectada o C2PA declara IA.
  - Si el modelo dice "confirmado" sin eso, queda en "indicios_fuertes" (también dentro de `forense`).
  - Piso técnico: el tipo de fuente IPTC que declara IA o un detector de voz con 0.8 o más dan
    "indicios_fuertes"; alertas de metadatos o un detector entre 0.5 y 0.8 dan "indicios_debiles".
  - Resultado: el mayor entre el nivel del modelo y ese piso.
- **Caché.** `withCostCache` con la clave SHA-256(original) + `autenticidad` + variante (prompt,
  modelo, esfuerzo y hash de las señales técnicas en texto). Reprocesar no paga; si cambian las
  señales técnicas (por ejemplo, cuando el contenedor ya tenga los detectores), se analiza de nuevo.
- **Fallas.** El paso nunca lanza.
  - Si falla el ML, se guarda solo el análisis forense, con las fuentes en null ("no se pudo revisar").
  - Si falla Meta, se guardan solo las señales técnicas.
  - Si fallan los dos, no hay derivado: la evidencia queda "no analizada".
  - La evidencia se marca `procesado` igual.
- **Dónde corre.** En `processEvidence`, después del procesador (cola INGESTA y Workflow). El
  derivado `autenticidad` lo reemplaza su propio paso en una transacción; `previousOutputs` ya no
  lo borra al reprocesar.
- **Contrato con el ML** (coincide con `services/ml/blindaje_ml/routers/authenticity.py`):
  `POST /authenticity/{audio,image,video}` con el original como cuerpo crudo y la respuesta
  `SenalesTecnicas`. Las claves que falten cuentan como no revisadas (`parseSenalesTecnicas`).

## 2026-10-28 05:15 · Vinculación, Vinculador, expediente y víctima

- **Voz.** Si un audio comparado en la señal de voz tiene "indicios_fuertes" o
  "generado_ia_confirmado", `p × 0.5`, una sola vez por par. Queda en
  `signals.voz.voz_sintetica = { evidencia, factor, p_sin_ajuste }`, un campo opcional nuevo en
  `packages/shared/src/linking.ts`. Función pura: `syntheticVoiceAdjust`.
- **Vinculador.**
  - En la señal de voz recibe "Ojo: EV-… tiene indicios fuertes de voz sintética… una voz sintética
    podría imitar a otra".
  - Recibe una sección "Autenticidad de la evidencia" con la evidencia de ambos casos que tiene indicios.
  - Recibe un criterio nuevo: una imagen hecha con IA repetida en dos casos sigue siendo una
    plantilla común.
- **Expediente.** El Redactor agrega `autenticidad: { titulo, nota, items[] }` a los datos del PDF.
  Lo arma el servidor, no el agente, así que no hay citas que validar. Cada item trae `label`,
  `caso`, `tipo`, `nivel`, `nivel_texto`, `tecnicas[]`, `senales[]`, `explicacion`,
  `limitaciones`, `modelo` y `analizado_utc`. La plantilla actual del ML todavía no lo muestra
  (propuesta abajo).
- **Víctima.**
  - `VictimReport.evidencia[].autenticidad` es `string | null` con `textoAutenticidadVictima(nivel)`,
    aditivo con `.default(null)` para respuestas viejas.
  - `victimJson` valida con el esquema, así que las señales técnicas y el análisis nunca salen.
  - La app lo muestra en el detalle de la nota ("¿Fue hecho con IA?").
- **Consola (API).** `CaseSide.evidencia[].autenticidad` lleva el `ResultadoAutenticidad`
  completo, o null si no se analizó. No aparece para texto.

### Propuesta para la plantilla `expediente.html` (frente de ML)

Antes de "Evidencia":

```jinja
{% set au = d.autenticidad %}
{% if au and (au.items | lista) %}
<h2>{{ au.titulo }}</h2>
<p class="small muted">{{ au.nota }}</p>
<table>
  <thead><tr><th style="width:12%">Etiqueta</th><th style="width:8%">Caso</th><th style="width:16%">Nivel</th><th>Señales, explicación y limitaciones</th></tr></thead>
  <tbody>
  {% for a in au.items | lista %}
  <tr>
    <td><strong>{{ a.label }}</strong><div class="small muted">{{ a.tipo | etiqueta }}</div></td>
    <td>{{ a.caso }}</td>
    <td>{{ a.nivel_texto }}</td>
    <td>
      {% for t in a.tecnicas | lista %}<div class="small">{{ t }}</div>{% endfor %}
      {% for s in a.senales | lista %}<div class="small">{{ s }}</div>{% endfor %}
      {% if a.explicacion %}<p>{{ a.explicacion }}</p>{% endif %}
      {% if a.limitaciones %}<p class="small muted">Limitaciones: {{ a.limitaciones }}</p>{% endif %}
    </td>
  </tr>
  {% endfor %}
  </tbody>
</table>
{% endif %}
```

## 2026-10-28 05:30 · Consola

- **En cada evidencia.**
  - En la tarjeta del caso (vista de vínculo), un indicador corto: "Sin señales de IA",
    "Indicios débiles de IA", "Indicios fuertes de IA", "Generado con IA" o "Sin analizar".
  - En el cajón de la cita, que comparten la vista de vínculo y la de red o caso, el panel
    completo: nivel, señales por fuente, lo que observó el análisis, explicación, limitaciones y
    detalle técnico plegado.
  - Siempre aparece la nota "La ausencia de marca de agua no prueba que sea real".
  - Para un audio con indicios fuertes, el panel dice que al vincular su voz pesa la mitad.
- **Vista de vínculo.**
  - Un aviso arriba, "Revisa la autenticidad antes de decidir", con las citas de la evidencia marcada.
  - En la señal de voz: "Reducida a la mitad (era 0.16)".
  - En "Comparar las voces": "Pesa la mitad porque…".
  - Una sección "Autenticidad de la evidencia" con cada audio, imagen y video del par; los que
    tienen indicios fuertes vienen abiertos.
- **Cola.** El chip "EV-C2: indicios de IA" va junto al estado. Las indicaciones débiles no lo disparan.
- **Lenguaje visual.**
  - Los chips y avisos existentes: rosa para indicios fuertes, aviso para débiles, tinta para
    confirmado y cuadrícula para sin señales.
  - "Sin señales" no lleva verde ni check, porque no es un sello de "real".
- **Modo simulado.**
  - EV-C2 tiene voz sintética con indicios fuertes, así que la voz de VIN-2 pesa la mitad
    (`p_sin_ajuste` 0.16, p 0.08).
  - EV-F2, la foto de la bala de F, tiene indicios fuertes y avisa en VIN-3.
  - EV-B3 tiene indicios débiles; el resto, sin señales.
- **Verificación.**
  - `typecheck`, `lint`, `test` (62; antes 54) y `build:mock` limpios.
  - `vite preview` en `127.0.0.1:4178` y un solo Chrome headless propio en `127.0.0.1:9333`, con
    perfil temporal. El driver rechaza cualquier navegador cuyo agente no diga `HeadlessChrome`.
  - 16 de 16 comprobaciones:
    - avisos en la cola;
    - aviso y sección en VIN-2;
    - cajón de EV-C2;
    - VIN-1 sin aviso;
    - 390 px sin desborde;
    - cita EV-C2 resuelta en la red R-001 (escenario "Red armada");
    - cero errores en la consola del navegador.
  - Chrome y `vite preview` cerrados al terminar.

## 2026-10-28 05:50 · Prueba real

`wrangler dev` local con el contenedor ML de `localhost:8080`, que todavía no tiene
`/authenticity/*` (404): el frente de ML aún no lo reconstruye. El análisis forense con Meta sí corrió.

- **`eval/demo/foto-A.jpg`** (generada con Muse Image).
  - `muse-spark-1.3`, 2,855 tokens de entrada y 826 de salida, 0.0071 USD, 7.7 s.
  - **Indicios fuertes**, sin conocer el origen. El modelo vio etiquetas con texto erróneo
    ("ADEOS" por "FIDEOS", "GALLETAS 1L", "ACEITE 500g"), rótulos que no corresponden al producto
    y "DETERGENTE 1L" sobre rollos de papel.
  - Limitaciones: sin marca de agua, C2PA ni metadatos, y la recompresión puede haber borrado rastros.
  - Texto para la víctima: "Revisamos si fue hecho con IA: hay señales de que podría estar
    alterado. Una persona lo revisará."
- **`eval/demo/audio/A1.ogg`** (24 s, voz de TTS).
  - `muse-spark-1.2`, 781 de entrada y 1,580 de salida (casi todo razonamiento), 0.0074 USD.
  - **Sin señales**. El modelo advierte que el WAV de 16 kHz quita las frecuencias altas donde se
    notan los artefactos de síntesis.
  - Texto para la víctima: "Revisamos si fue hecho con IA: no encontramos señales. Eso no lo
    prueba al 100 %."
- **Comprobación de `input_audio`.** Con 781 tokens dudé de que el audio llegara, así que hice una
  llamada aparte (0.0043 USD) que le pidió transcribir el mismo WAV. Lo transcribió casi palabra
  por palabra contra `guiones-audio.json`. El audio llega y es barato: unos 330 tokens de entrada
  para 24 s con el texto incluido.
- **Hallazgos.**
  - `wrangler dev` recarga cuando otros frentes guardan archivos de `services/api` y corta el
    trabajo de la cola. La primera llamada de audio murió así y la evidencia quedó en
    `procesando`. Para la segunda corrida serví un bundle fijo: `wrangler deploy --dry-run --outdir`
    y una config temporal con `no_bundle`.
  - En Windows, `wrangler dev` necesita `dev.enable_containers: false`. Además, `deploy --dry-run`
    intenta construir la imagen Docker del ML; lo corté.
  - Muse Spark 1.2 listaba como "señales" las fuentes que no se pudieron revisar y empezaba la
    explicación con el aviso de contenido ficticio. Ajusté el prompt (variante `v2`) y agregué un
    filtro determinista (`soloObservaciones`) con su test. **El prompt v2 no se volvió a probar con
    Meta**: la prueba real era una sola.
- **Gasto del frente: ≈ 0.019 USD** facturados (0.0071 + 0.0074 + 0.0043), más a lo sumo ≈ 0.0075
  si Meta facturó la llamada cortada por la recarga. SAM, la lectura y la transcripción salieron
  de la caché.

## Pendiente

- Repetir la prueba real cuando el contenedor tenga `/authenticity/*`. Con señales técnicas
  nuevas, la caché vuelve a pagar unos 0.015 USD. Interesa ver si Muse Image deja C2PA o una
  marca en `foto-A.jpg`.
- Bloque de autenticidad en `expediente.html` (frente de ML, propuesta arriba).
- Mock de la app (`apps/mobile/src/api/mock.ts`): hoy manda `autenticidad: null`. Ese archivo lo
  está editando el frente de negocios; conviene que el mock devuelva
  `textoAutenticidadVictima("sin_senales")` para audio, imagen y video procesados.

## Cómo correr

```bash
pnpm --filter @blindaje/api test        # incluye test/authenticity.test.ts
pnpm --filter @blindaje/console test    # incluye src/lib/authenticity.test.tsx
cd apps/mobile && npx jest test/nota-autenticidad.test.tsx
```
