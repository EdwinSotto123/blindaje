# Devlog: contenedor de ML (`services/ml`)

Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 01:15 · Arranque y licencias

- Contrato: `docs/ML_API.md`. Leídas las secciones 3.3, 5.4, 5.6 y 6.5 del prompt y 7, 9 y 10.3
  del documento de diseño.
- **Licencias verificadas** en la API de Hugging Face (`/api/models/<repo>`, campo `cardData.license`
  y etiqueta `license:`), con la revisión fijada en `scripts/download_models.py`:

  | Modelo | Revisión | Licencia | Tamaño en disco |
  |---|---|---|---|
  | `speechbrain/spkrec-ecapa-voxceleb` | `0f99f2d0` | Apache-2.0 | 85 MB (ckpt) |
  | `intfloat/multilingual-e5-small` | `614241f6` | MIT | 471 MB (safetensors fp32) |
  | `facebook/dinov2-small` | `ed25f3a3` | Apache-2.0 | 85 MB |

  Librerías: SpeechBrain Apache-2.0, FAISS MIT, networkx BSD-3, WeasyPrint BSD-3, imagehash
  BSD-2, torch BSD-3. ECAPA se entrenó con VoxCeleb 1+2; la licencia de los pesos publicada es
  Apache-2.0.
- **Fuente**: Atkinson Hyperlegible (Braille Institute) desde el repo de Google Fonts, fijada al
  commit `95f4904f` y con SHA-256 por archivo. Licencia SIL OFL 1.1 (se copia `OFL.txt` junto a
  los TTF).
- Cloudflare Containers (documentación oficial, límites): `lite` 1/16 vCPU y 256 MiB, `basic`
  1/4 y 1 GiB, `standard-1` 1/2 y 4 GiB, `standard-2` 1 y 6 GiB, `standard-3` 2 y 8 GiB,
  `standard-4` 4 y 12 GiB. El tamaño de imagen se limita al disco de la instancia (8 GB en
  `standard-1`); 50 GB de imágenes por cuenta.

## 2026-10-28 01:40 · Decisiones

- **Python 3.11 en la imagen, compatible 3.11–3.13**. `.python-version` fija 3.11 para que local,
  CI e imagen coincidan.
- **torch 2.11 CPU** desde `download.pytorch.org/whl/cpu` (fuente explícita en `pyproject.toml`).
  El último torchaudio publicado es 2.11 y su extensión nativa depende de la ABI de torch, así que
  torch queda en el mismo minor (2.11.*) aunque exista 2.14. SpeechBrain 1.1.2 exige torchaudio.
- **Extras**: `models` (torch, torchaudio, speechbrain, transformers) y `dev`. CI corre
  `uv sync --extra dev` sin modelos: los tests livianos usan embebedores falsos.
- **Sin sentence-transformers ni torchvision**: e5 con mean pooling propio (máscara de atención)
  y prefijos `query: `/`passage: `; DINOv2 con preprocesamiento propio (relleno a cuadrado, 224 px,
  media y desviación de ImageNet) y `pooler_output` (CLS tras la layernorm). El relleno evita
  recortar placas y notas alargadas, que el center-crop estándar cortaría.
- **Voz**: ventanas de 3 a 6 s del mismo largo; turnos consecutivos del mismo hablante a menos de
  1 s se unen; VAD de energía simple para descartar ventanas de silencio (al final de los audios
  de WhatsApp suele haber silencio que ensucia el centroide). Exclusión de la víctima en dos
  niveles: hablante completo por centroide y, en hablantes no excluidos, segmentos sueltos (caso
  sin diarización donde la víctima habla en el mismo audio). Detalle en `docs/ML_API.md`.
- **s-norm adaptativa** (top-200 de la cohorte por lado). La cohorte se lee de
  `/models/cohort.npy`, se recarga si cambia y además se puede subir con `POST /voice/cohort`
  (extensión del contrato) y viaja en los snapshots, porque el contenedor no tiene disco
  persistente.
- **FAISS**: `IndexIDMap2(IndexFlatIP)`; `add` es upsert para que los reintentos del Workflow sean
  idempotentes. Snapshot zip con manifiesto y SHA-256 por índice; `load` es todo o nada.
  `index_version` la fija el Worker (campo opcional `version` en las escrituras).
- **Grafo**: Louvain con semilla 42 sobre la proyección en casos (como dice 10.3), centralidad de
  intermediación y grado sobre el grafo completo; extra `membership` para ubicar cada señal en
  su red.
- **ffmpeg estático** (`mwader/static-ffmpeg:9.0.2-1`, solo el binario `ffmpeg`, 144 MB) en vez del
  paquete de Debian, que arrastra 205 paquetes y unos 420 MB de librerías. Sin ffprobe: las
  dimensiones y la cantidad de cuadros salen del filtro `showinfo`, y el tope de cuadros va dentro
  del grafo de filtros (`trim`) para que el conteo sea exacto.
- **Privacidad en logs**: un evento JSON por petición con ruta, estado, duración y tamaño. Nunca
  cuerpos, vectores, textos ni el stderr de ffmpeg (puede traer metadatos del archivo). Los
  errores de validación tampoco devuelven el contenido enviado. Los JPEG de salida van sin EXIF.

## 2026-10-28 02:05 · Tests

- 61 tests livianos (rutas, token, límites, ffmpeg con tonos y video `testsrc`, FAISS, snapshot
  con verificación de checksum, grafo, imagen, PDF a nivel HTML) y 5 pesados con los modelos
  reales. Ruff limpio.
- Para la huella de voz real no hay audios con licencia en el repo: `scripts/make_test_audio.ps1`
  genera voces sintéticas con SAPI de Windows (Sabina es-MX y Zira en-US leyendo el mismo guion
  en español). Resultados con ECAPA (coseno entre centroides):
  - misma voz, distinto texto: **0.957**; otra voz, mismo texto: **0.312**;
  - tras Opus a 16 kbps (simulación de WhatsApp) y `/audio/normalize`: **0.948** contra **0.270**;
  - exclusión con turnos: el hablante de la víctima da 0.957 contra su muestra y se excluye; el
    otro da 0.325 y queda.

  Son voces sintéticas, más fáciles que voces reales; la medición de verdad es la de la
  evaluación con SLR73.
EOF

## 2026-10-28 02:55 · Imagen de Docker

- `python:3.11-slim` (Debian 13), multi-stage: builder con uv 0.11.12, etapa `models` que descarga
  y **verifica sin red** los tres modelos, runtime con pango (18 MB de apt), ffmpeg estático, el
  venv y `/models`. Usuario sin privilegios (uid 10001), `HF_HUB_OFFLINE=1`.
- **Tamaño**: 916 MB comprimida, 3.16 GB descomprimida. Por capa: venv 1.27 GB (torch 605 MB, de
  los cuales `libtorch_cpu.so` son 426 MB; transformers 123 MB; scipy 111 MB), modelos 671 MB (e5
  471 MB en fp32), ffmpeg 144 MB. Se recortaron `torch/include`, `torch/share`, carpetas `tests` y
  `.pyi`. Se descartó guardar e5 en fp16 (ahorraría ~235 MB) para no alterar los vectores.
- Etapa `test` aparte (`--target test`): corre pytest dentro de Linux con pango y ffmpeg.

## 2026-10-28 03:20 · Mediciones y correcciones

Docker con WSL limitado a 4 GB y 4 CPUs; contenedor con `-m 3g --cpus 2` salvo donde se indica.
Ojo: el host estaba compartido con otros frentes (el contenedor de 8080 llegó a 200 % de CPU), así
que los tiempos de reloj tienen ruido.

- **Arranque**: `/health` responde en 1.4 a 2.9 s con la caché de disco caliente y en 5.2 a 8.6 s
  en el primer arranque tras cambiar la imagen. La precarga de ECAPA termina 2 a 8 s después.
- **Carga de modelos**: ECAPA 1.5 a 2.5 s, e5 4.2 s (1 a 2 vCPU) y 8.9 s (0.5 vCPU), DINOv2
  0.1 a 0.35 s.
- **Memoria**: 63 a 90 MiB en reposo; con los tres modelos y uso secuencial, pico de 1.1 a 1.3 GiB.
  Estrés combinado (12 clientes, 140 trabajos de voz, texto, imagen y PDF): **pico de 2057 MiB**,
  sin OOM.
- **Latencias en caliente** (2 vCPU): `/voice/embed` 40 s de audio 3.2 s y 17 s de audio 1.6 s;
  `/text/embed` 8 textos 0.07 s; `/image/crops` imagen + 2 recortes 0.35 a 0.8 s; PDF 0.2 a 0.4 s
  (el primero 0.9 a 1.4 s); `/video/sample` 4 s a 720p 0.4 s; `/audio/normalize` 0.1 s.
- **ECAPA es caro en CPU**: con C=1024 son ~3.7 GFLOP por segundo de audio. Dos mejoras medidas:
  flush de denormales (3.67 s a 2.30 s por 13 ventanas de 3 s con 1 hilo; coseno contra el
  resultado sin flush ≥ 0.9999999) y lotes agrupados por largo para no rellenar con ceros.
- **e5**: las similitudes de multilingual-e5 se concentran en 0.7 a 1.0 (MO parecido 0.872 contra
  texto sin relación 0.856). El orden es correcto, pero los umbrales hay que calibrarlos.

Correcciones:

1. **Caída reportada por la evaluación en la primera petición a `/voice/embed`**. No se reprodujo
   como OOM (`OOMKilled=false`, 0 reinicios, `oom_kill 0`). La evaluación usó el backend ML entre
   02:11 y 02:33 y el reinicio de WSL fue a las 02:10; el contenedor recién se levantó a las 02:16.
   Igual se endureció: `ML_PRELOAD=voice` (ECAPA se carga en segundo plano al arrancar),
   `MALLOC_ARENA_MAX=2` (ráfaga de 8 concurrentes en frío: pico de 1718 MiB a 1275 MiB) y
   `XDG_CACHE_HOME=/tmp/.cache` (fontconfig no tenía caché escribible).
2. **503 en la primera carga simultánea de e5 y DINOv2** (reproducible 3 de 3): los imports
   perezosos de transformers no son seguros entre hilos y daban `ImportError`, reportado como
   `transformers_not_installed`. Ahora las cargas de modelos se serializan con un lock global
   (test `test_models.py`). Verificado 3 de 3 sin errores.
3. **Imagen con código viejo**: la caché de uv del build reutilizaba la rueda de `blindaje-ml`
   porque por defecto solo invalida con cambios en `pyproject.toml`. Se agregó `cache-keys` en
   `pyproject.toml` y `--reinstall-package blindaje-ml` en el Dockerfile; se verificó dentro de la
   imagen que el código nuevo está.

- **Cohorte de s-norm**: `eval/cohort.npy` (60 × 192, SLR73, CC BY-SA 4.0) copiada a
  `services/ml/assets/cohort.npy` y horneada como `/models/cohort.npy`; `/health` reporta
  `cohort.size = 60` desde el arranque. Atribución en `services/ml/assets/README.md`.

### Recomendación para Cloudflare Containers

- `instance_type: "standard-2"` (1 vCPU, 6 GiB, 12 GB de disco). La memoria pica en ~2 GiB bajo
  estrés; `basic` (1 GiB) no alcanza. `standard-1` (1/2 vCPU, 4 GiB) entra en memoria pero duplica
  latencias (carga de e5 ~9 s; voz ~2x).
- `max_instances: 1`: los índices FAISS viven en memoria de la instancia y el cliente del Worker
  usa una sola instancia con nombre (`ml-0`); más instancias no compartirían índices.
- `sleepAfter: "30m"` durante el demo y la evaluación (es lo que ya tiene `MlContainer`). Tras
  dormir, `index_version` vuelve a `null` y el Worker reconstruye desde D1 o carga el snapshot de R2.

## 2026-10-28 06:05 · Autenticidad: marcas de agua de Meta, C2PA y metadatos

Tres endpoints nuevos, `POST /authenticity/{audio,image,video}`, que devuelven `SenalesTecnicas`
(`packages/shared/src/authenticity.ts`). Contrato y umbrales en `docs/ML_API.md`.

**Licencias verificadas hoy** (API de GitHub, README y API de Hugging Face):

| Componente | Versión fijada | Licencia |
|---|---|---|
| AudioSeal (`audioseal` en PyPI, pesos `facebook/audioseal`) | 0.2.0, revisión HF `3c19eba5`, SHA-256 por archivo | MIT, código y pesos (el README lo aclara desde 2024-04-02) |
| Video Seal 1.0 (`y_256b_img.jit` de `dl.fbaipublicfiles.com`) | sin revisiones en esa URL: SHA-256 fijado | MIT (repo y README: "The model is licensed under an MIT license") |
| `c2pa-python` (SDK c2pa-rs 0.91) | 0.38.0 | MIT o Apache-2.0 |
| ffprobe | el mismo `mwader/static-ffmpeg:9.0.2-1` | el mismo de ffmpeg |

`c2pa-python` va en 0.38.0: 0.38.1 no publicó rueda de Windows y 0.38.2 solo trae ruedas de macOS.

**Decisiones**
- **Video Seal en TorchScript, sin el paquete `videoseal`**, que arrastra timm, lpips, OpenCV,
  pandas y scikit-image. En el build se guarda solo el extractor (`torch.jit.save(full.detector)`):
  134 MB en lugar de 228 MB. El modelo completo y el generador de AudioSeal solo van a la etapa de
  test (`--test-dest`). El preprocesamiento (PIL bilineal a 256 × 256) reproduce el `detect` del
  modelo: correlación de logits 0.998.
- **Puntajes.** Video Seal no tiene canal de presencia; sin el mensaje esperado, el puntaje es la
  confianza media de los 256 bits, `mean(|2·sigmoid(logit) − 1|)`. En video se promedian los logits
  de los cuadros antes de medir: el mensaje es el mismo en todos y el contenido cambia. AudioSeal:
  fracción de muestras con probabilidad > 0.5, en ventanas de 10 s (hasta 120 s, repartidas por
  todo el audio).
- **`NO_TORCH_COMPILE=1`**: audioseal envuelve capas en `torch.compile`; sin compilador de C (la
  imagen no tiene) falla, y en Windows tardaba 45 s antes de fallar.
- **C2PA sin red**: `remote_manifest_fetch` y `ocsp_fetch` apagados (la URL vendría del archivo, que
  no es de fiar). Se leen las acciones de todos los manifiestos, también de los ingredientes. Un
  manifiesto dañado da `present: true` con `ai_generated: null`, nunca "no es IA".
- **Privacidad**: GPS, ubicación, autor, copyright, números de serie y contactos salen como
  `"presente"`, sin valor; los logs solo llevan banderas y conteos.
- **Sin detector de voz sintética** (`available: false`). Se revisaron AASIST y AASIST-L (MIT,
  livianos, entrenados con ASVspoof 2019) y los wav2vec2 afinados de Hugging Face (Apache-2.0 o MIT,
  de 95 M a 300 M parámetros). Los primeros generalizan mal a voz real y comprimida; los segundos no
  documentan datos ni calibración. Un falso "voz sintética" sobre la voz real de un extorsionador
  bajaría el peso del vínculo de voz, así que es peor que no tener la señal.

**Calibración** (fotos de Wikimedia Commons, audios del demo y voces de `test-audio`, todo fuera del repo):

| Caso | Puntaje |
|---|---|
| AudioSeal, 12 audios sin marca, también tras Opus | 0.000 a 0.015 |
| AudioSeal con marca / tras Opus 16 kbps / tras Opus 8 kbps | ≥ 0.99 / 0.49 a 1.0 / 0 a 0.33 |
| Video Seal, 26 fotos sin marca (también tras simular WhatsApp) | 0.09 a 0.50 |
| Video Seal con marca: original / JPEG 60 al 50 % / recorte y captura / doble reenvío | ≥ 0.99 / ≥ 0.83 / ≥ 0.93 / ≥ 0.98 |
| Video Seal en video real 960 × 544: sin marca / con marca, sin comprimir / H.264 CRF 18 / 23 / 28 | 0.06 / 0.97 / 0.96 / 0.90 / 0.64 |

Umbrales: AudioSeal ≥ 0.3 y Video Seal ≥ 0.8. Un falso positivo pondría "generado con IA
confirmado" sobre evidencia real, así que se prefiere perder marcas muy comprimidas (H.264 CRF 28,
Opus 8 kbps); el puntaje se devuelve igual para el análisis forense.

**Resultados con curl contra el contenedor** (archivos de prueba en el directorio temporal, no en el repo):

| Archivo | `watermark` | Otras señales |
|---|---|---|
| `A1.ogg` con AudioSeal (generador propio) y Opus 24 kbps | `audioseal-16bits`, **detectada**, 0.9794 | `Lavc61.19.101 libopus` (ffmpeg) |
| `A1.ogg` del demo | no detectada, 0.0 | sin C2PA (OGG no lo admite), `Lavc61.19.101 libopus` |
| `foto-A.jpg` (Muse Image) | `videoseal-1.0`, no detectada, 0.473 | sin C2PA, sin EXIF, XMP ni IPTC; comentario JPEG `Lavc61.19.101` |
| Ejemplo de Video Seal, 2 s a 960 × 544 | no detectada, 0.0768 (16 cuadros) | `Lavf61.7.100`, `Lavc61.19.101 libx264` |
| El mismo con Video Seal (modo video, CRF 20) | **detectada**, 0.9377 (16 cuadros) | ídem |

**Hallazgo sobre Muse Image**: el JPEG que devuelve la API (`muse-image-1.0`, escrito tal cual por
`eval/src/gen-demo-images.ts`) no trae credenciales C2PA, ni `DigitalSourceType` IPTC, ni EXIF; lo
codificó libavcodec (`Lavc61.19.101`). Tampoco trae una marca de Video Seal 1.0: 0.473 está dentro
del rango de fotos reales y los bits de `foto-A` y `foto-alternativa` coinciden en 45 % (azar), sin
un mensaje común. Meta podría usar otra marca (propia o PixelSeal) que este servicio no detecta:
para el demo, la foto queda en manos del análisis forense de Muse Spark.

**Imagen**: 3.78 GB descomprimida (antes 3.16 GB) y 1.15 GB comprimida (antes 916 MB). Lo nuevo:
ffprobe, 144 MB; modelos, +168 MB (Video Seal 128 MiB y AudioSeal 34 MiB); venv, +70 MB (la librería
nativa de `c2pa` pesa 52 MB y `cryptography`, 16 MB).

**Memoria** (`-m 3g --cpus 2`, `memory.peak` del cgroup):
- en reposo, 220 MiB; tras las cinco llamadas de curl, 743 MiB;
- estrés combinado (12 clientes, 140 trabajos de autenticidad de imagen, audio y video, voz, texto,
  recortes y PDF): **pico de 2518 MiB** (antes 2057), sin OOM, todo 200.
- Bajo estrés las latencias suben mucho (mediana de video 53 s), porque cada modelo atiende una
  petición a la vez y hay 2 vCPU. Solas: imagen 1 s, audio de 24 s 2 a 4 s, video de 16 cuadros 6 s.

**Sin red**: `docker run --network none` arranca, `/health` responde en menos de 1 s y
`/authenticity/image` y `/authenticity/audio` funcionan (el DNS falla dentro del contenedor, como en
Cloudflare).

**Tests**: 23 livianos en `test_authenticity.py` y 2 de la sección del expediente en
`test_pdf.py`. Entre los livianos hay un C2PA firmado en el momento con una CA de prueba creada con
`cryptography` (no se guarda ninguna llave en el repo). Los 7 pesados de
`test_authenticity_heavy.py` cubren AudioSeal con y sin marca y tras Opus; Video Seal en imagen,
reducida y en video H.264; y el informe de `foto-A.jpg`. El test de video usa el zoom de Mandelbrot
de ffmpeg: con cuadros que cambian de escena, el modo "repeat" de Video Seal no alcanza a marcar los
intermedios.

**Expediente** (pedido del orquestador): la sección "Autenticidad de la evidencia" va en
`expediente.html` antes de "Evidencia", con la forma que arma el Redactor (`titulo`, `nota`,
`items[]`) y la nota "La ausencia de marca de agua no prueba que el archivo sea real" si la `nota`
del API no la trae. Ojo con la propuesta: en Jinja, `au.items` devuelve el método `dict.items`, no
la clave; la plantilla usa `au["items"]`.
