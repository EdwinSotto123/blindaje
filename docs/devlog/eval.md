# Devlog: evaluación y datos del demo (`eval/`)

Horas en hora de Lima. Las entradas más nuevas van abajo.

## 2026-10-28 01:10 · Arranque y licencias

- Leídas las secciones 10, 11, 2.4 y 4 del prompt; 3, 7.3, 9 y 16 del documento de diseño; los
  contratos de `packages/shared`, `docs/ML_API.md` y `docs/API.md`, y `docs/VIDEO.md`.
- **OpenSLR SLR73** verificado en https://www.openslr.org/73/: licencia CC BY-SA 4.0 (archivo
  `LICENSE` descargado), (c) 2018, 2019 Google; `es_pe_female.zip` (913 MB) y `es_pe_male.zip`
  (1.0 GB), WAV mono de 48 kHz. 38 hablantes (18 mujeres, 20 hombres), unas 150 frases cada uno.
  Partición fija: 10 hablantes para la cohorte de s-norm (nunca en la prueba) y 28 para la prueba.
- **MMS-TTS** (`facebook/mms-tts-spa`) verificado en Hugging Face: licencia `cc-by-nc-4.0`. Sirve
  para el demo no comercial; documentado en `eval/README.md` y `eval/demo/README.md`.

## 2026-10-28 01:30 · Guiones, escenarios y ficha

- 32 guiones ficticios en 7 familias (Los X, Los del Norte, Los del Sur, Los Y, Los Z, Los del
  Cerro y sin grupo), con montos de 10 a 20,000 soles, plazos de 12 a 168 horas, Yape, Plin,
  transferencia y efectivo, cupos diarios, semanales y mensuales, escalamiento con fechas, placas,
  llamadas grabadas donde habla la víctima y datos de la víctima que nunca deben salir en la ficha.
  Rangos: contactos `900 000 4xx`, cobro `5xx`, víctimas `9xx`; el demo usa `1xx` a `3xx`.
- Test de consistencia (230 casos): cada identificador y frase etiquetada aparece en la evidencia,
  la etiqueta perfecta obtiene todos los campos. Encontró una etiqueta inconsistente en G25.
- `packages/meta-client` ya exporta `responses.parse` (strict) e `images.generate`: se usa en vez de
  un wrapper propio. Primera llamada real: 0.006 USD y 3.6 s por ficha.
- Hallazgo temprano: en un pago único implícito Muse Spark deja `periodicidad: null` en vez de
  `"unico"`. No cambio la etiqueta; lo reporto (ver la tabla de errores de `REPORT.md`).

## 2026-10-28 01:40 · Fotos del demo

- 2 imágenes con Muse Image (0.02 USD) en una sola petición: fachada ficticia de bodega con una bala
  sobre el mostrador y una nota "LOS X. 48 HORAS". Nada gráfico. Recomprimidas a 1600 px. La segunda
  sirve como "foto parecida pero distinta" en el escenario de imágenes reutilizadas.

## 2026-10-28 01:55 · Voz y calibración

- Simulación de WhatsApp con ffmpeg: Opus mono 16 kHz, canal 1 (16 kbps, 120 Hz–7 kHz, ruido leve)
  y canal 2 (10 kbps, banda telefónica, más ruido).
- Backend local con el mismo modelo, la misma segmentación (ventanas de 3 s, sobrante a la última) y
  el mismo VAD de energía que `services/ml`, para medir mientras el contenedor no responde.
- Primera calibración por máxima verosimilitud: a = 168 (y hasta 2,957 en una partición). Las clases
  están casi separadas y la pendiente diverge. Cambio a una calibración gaussiana con las dos
  distribuciones (b = punto donde el cociente de verosimilitud vale 1, a = pendiente de su
  logaritmo) y una restricción explícita de falsos vínculos. Resultado local: a = 96.7, b = 0.601.
- Resultados locales: 100 % primer lugar y top 3 (56 pruebas contra 28 inscritos), también con notas
  cortas de 7 s; 0.19 falsos vínculos por cada 100 comparaciones. Es habla leída de buena calidad:
  hay que recalibrar con grabaciones reales.

## 2026-10-28 02:10 · Contenedor ML, imágenes, demo:seed

- El contenedor ML estuvo arriba un rato (modelos cargados, cohorte de 400): las imágenes se
  midieron con su DINOv2. Se cayó en la primera petición de voz de la corrida oficial; quedó con
  reintentos y vuelve a intentarse.
- Imágenes: el phash reconoce reenvíos por WhatsApp (Hamming 0) pero no capturas de pantalla
  (Hamming 8–18); DINOv2 no separa notas distintas del mismo estilo (hasta 0.99). Propuesta: DINOv2
  con `p_max` 0.5 (solo suma).
- `demo:seed` contra la API desplegada: tres dispositivos P-256, casos A, B y C con sus códigos,
  evidencia EV-A1…EV-C2 con SHA-256 y submit. Idempotente (refresh firmado, sin duplicados). El
  pipeline de la API todavía es stub: el caso queda "listo" sin ficha. La muestra de voz responde
  503 porque el contenedor no está enlazado en producción.

## 2026-10-28 02:18 · Primera corrida completa de `pnpm eval`

- 161 s con la caché. Voz (backend local): 100 % primer lugar y top 3; 0.19 falsos vínculos por
  cada 100 comparaciones. Identificadores: 9/9 pares, 0 falsos (la cuenta que difiere en un dígito no
  coincide). Ficha: 93.8 % de campos (20 guiones, 0.13 USD). Infiltrado: pasa 7/7, con la
  advertencia de que el pipeline todavía no vincula.
- La ficha falla casi solo en `periodicidad` (45 %): Muse Spark deja `null` cuando el pago único
  está implícito. Sin ese campo la exactitud sería 98 %. Propuesta para el frente de la API (dueño de
  `FICHA_SYSTEM`): agregar "periodicidad: 'unico' si piden un solo pago". Las otras fallas: frases
  firma acortadas o fusionadas (85 %) y una amenaza contada como escalamiento (G19).
- Motor sobre escenarios: 16/18 vínculos, 1 falso (dos voces distintas con coseno 0.605, apenas
  sobre b; va a revisión, nunca a "probable") y 2 faltantes (la captura de pantalla de la foto del
  demo: Hamming 12).
- Agentes y estadísticas con menos de 5 casos: pendientes. El Vinculador, el Cartógrafo y el Vigía
  de la API todavía son stubs. El runner pide el perfil y corre el Vigía si faltan.

## 2026-10-28 02:25 · Casos de fondo D a G

- A pedido del orquestador: D, E, F y G, de solo texto, en "Lima Este", con "Los X", Yape y
  "habla con el jefe"; D, E y G pagan a la cuenta recaudadora 900 000 202. Con A y C suman 6 casos
  de 6 víctimas en la zona. Fechas relativas al día del seed (todo dentro de 14 días el día que se
  grabe). El infiltrado borra su caso al terminar para no contaminar la red ni el Vigía.
- Sembrados en la API. A y C conservan la zona anterior ("Lima Este - cuadrícula E12/E09") hasta el
  próximo `demo:reset && demo:seed`; no lo hice ahora porque el registro de dispositivos tiene un
  límite de 10 por hora por IP y un seed desde cero usa 7 (8 con el infiltrado).

## 2026-10-28 02:35 · Corrida oficial contra el contenedor ML

- El contenedor volvió: las 242 notas de voz se midieron con `/voice/embed`. Las huellas son
  idénticas a las del backend local (coseno 1.000000 en los 242 audios, mismos segmentos), así que
  el backend local es un sustituto exacto cuando el contenedor no está.
- Resultados oficiales (backend ml) iguales a los locales: 100 % / 100 %, 0.19 falsos vínculos por
  100 comparaciones, calibración a = 96.66, b = 0.6006. Cohorte de 60 vectores en `eval/cohort.npy`.
- Verificación de los audios del demo con el contenedor: A1~B1 0.78 y A2~B1 0.75 (vínculo por voz),
  la muestra de la víctima a 0.34 o menos de A (no se confunde con quien llama) y C1 a 0.49 o menos
  de A y B (otra voz).
- Gasto acumulado del frente en la Meta Model API: 0.153 USD (20 fichas y 2 imágenes).
