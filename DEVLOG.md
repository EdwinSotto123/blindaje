# DEVLOG

Bitácora del proyecto. Horas en hora de Lima (UTC−5). Las entradas más nuevas van abajo.

## 2026-10-28 00:30 · M0: arranque

- Leído completo el documento de diseño y las tres pantallas de `design/cuaderno/`.
- Herramientas: Node 22.18, pnpm 9.15, Python 3.13, uv, Docker 29, ffmpeg 7.1, gh (sesión
  activa), wrangler 4.154 (sesión activa; la cuenta ya tiene Containers, así que tiene Workers Paid).
  Android SDK con emulador `Medium_Phone_2` y JDK 21 de Android Studio. Sin sesión de Expo/EAS.
- Meta Model API verificada con la key del equipo: `GET /v1/models` lista `muse-spark-1.3`,
  `muse-spark-1.2`, `muse-wonder-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1`, `muse-image-1.0`
  (y las variantes contributor, que no usamos).
- Llamada real a `POST /v1/responses` con `text.format` `json_schema` strict: devuelve un ítem
  `reasoning` (contenido cifrado) y un `message` con el JSON en `output_text`.

### Lo que dice la documentación oficial (y difiere o precisa el prompt)

- **Muse Glimmer** es un modelo denso de **30B parámetros** (texto + imagen, Apache-2.0). No es
  viable en un celular: incluso a 4 bits pesa unos 17 GB. Decisión D6: se documenta la
  evaluación, queda detrás de un flag y la ficha se arma en el servidor.
- **Tool calling**: solo `tool_choice: "auto"`; `none`, `required` o una función específica dan
  HTTP 400. El modelo puede responder texto sin llamar herramientas: el bucle lo maneja.
- **Responses API**: `truncation` solo `"disabled"`; cuerpo máximo 1 MiB; `reasoning.effort` no
  acepta `none` en Muse Spark; `include` no se combina con `previous_response_id`.
- **Voice Transcribe por archivo**: `multipart/form-data` con partes `request` (JSON con `model`,
  `mode`, `audioEncoding: "WAV"`, `languageBias`, `keywords`) y `audio` (WAV mono PCM16 de 16 o
  24 kHz). Máximo 32 MB y 10 minutos. Modo `DIARIZATION` devuelve `turns[]` con `speaker`,
  `startMs`, `endMs`.
- **SAM 3.1**: por la Responses API con `stream: true`. Un concepto por petición (frase nominal
  corta). Salida en tokens: `<0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|><|mask;x=..;y=..;data=H,W,~…|>`,
  máscaras en base85. Parsers oficiales `@meta-sam/parser` (npm) y `meta-sam-parser` (pip).
  Confianza con `metadata.include_confidence: "true"` (string). Video: MP4/MOV H.264, subir con
  Files API (`purpose=user_data`), mínimo 50 frames facturados por petición.
- **Precios** confirmados: Spark 1.25/4.25 USD por millón (cache 0.15), Wonder 4/20, SAM 2.50 por
  1,000 imágenes y 0.20 por 1,000 frames, Transcribe 0.18 USD por hora, Image 0.01.
- **Límites**: Spark 3,000 RPM; Image 150 RPM; Transcribe 256 streams concurrentes.

### Decisión del equipo: todo vive en la nube

A pedido del equipo, la evidencia ya no se queda solo en el celular: se sube a Cloudflare al
capturarla, se guarda cifrada (AES-256-GCM) en R2 y se procesa al llegar. Interpretamos
"accesible a todos" como accesible para todos los actores **autorizados** (la víctima y, según su
rol, revisores y analistas), no como público: exponer evidencia pondría en riesgo a las víctimas
y contradice la sección 5 del documento de diseño. Sin conexión, la evidencia espera cifrada en
el celular y se borra de ahí al confirmar la subida. Ver D1 en `PLAN.md`.

### Esqueleto

- Monorepo pnpm, TypeScript 5.9 estricto (TypeScript 7 todavía no es compatible con
  typescript-eslint), Vitest 4.1 (lo exige `@cloudflare/vitest-pool-workers`), Zod 4.
- `packages/shared`: enums, etiquetas citables, ficha, salidas de agentes, motor de vinculación,
  contrato de la API y reglas de seguridad. 12 tests, incluido uno que verifica que los esquemas
  de salida cumplen el subconjunto strict de Meta.
- `infra/migrations/0001_init.sql`: modelo de datos completo.

## 2026-10-28 02:00–04:30 · M1 a M7 en paralelo

Seis frentes trabajaron en paralelo, cada uno en su carpeta y con su bitácora en `docs/devlog/`
(`api.md`, `meta-client.md`, `ml.md`, `mobile.md`, `console.md`, `landing.md`, `eval.md`,
`pipeline.md`, `agentes.md`, `ux.md`). Resumen de lo que importa:

- **API** desplegada en `https://blindaje-api.vigiaperu.workers.dev`: auth con JWT y refresh firmado
  por la llave P-256 del dispositivo, evidencia cifrada con AES-256-GCM en R2, auditoría encadenada
  serializada por un Durable Object, registro de costos con bloqueo de no esenciales al 80 %, rate
  limiting y aislamiento de víctima probado con un infiltrado. 90 tests.
- **Cliente de Meta**: Responses con salida estructurada strict, bucle de agente, Voice Transcribe,
  SAM 3.1 en imagen y video, Files e Images. Hallazgos frente a la documentación:
  - Transcribe no manda `x-request-id` y a veces devuelve un primer turno vacío sin hablante.
  - SAM en video factura 50 frames aunque no encuentre nada; la máscara es un recorte del tamaño
    de la caja, anclado en (x1, y1).
  - **SAM 3.1 no entiende conceptos en español**: "bala" o "nota escrita a mano" dan cero
    coincidencias; "handwritten note" (0.72), "storefront" (0.75) y "bullet casing" (0.57) sí.
    El pipeline consulta en inglés y etiqueta en español.
  - Encadenar con `previous_response_id` dio 400 tres veces seguidas en una corrida real del
    Cartógrafo. El bucle ahora sigue **sin estado** (historia completa, `store: false`,
    `reasoning.encrypted_content`) si el encadenamiento falla; verificado contra la API real
    forzando el error.
- **Pipeline y vinculación** con la API real de Meta y el contenedor ML local, casos A, B y C del
  demo: A–B se vincula **por voz con números distintos** (coseno 0.79, 4 de 4 segmentos, puntaje
  0.90, `probable`); B–C por la **misma cuenta de Yape** (0.93, `probable`). En la primera corrida
  el Vinculador bajó A–B a 0.65 porque "los números son distintos": se le pasaron los criterios
  del diseño (cambiar de número no es contradicción) y se sostuvo en 0.90.
- **Agentes de red**: Cartógrafo real con Muse Spark 1.3 sobre una red ficticia de 6 casos: 10
  hechos y 4 hipótesis citadas (cuenta recaudadora, seguimiento con placa, escalamiento entre 3.5 y
  8.5 días). Vigía con umbral de 5 casos y 3 víctimas por zona exacta. Redactor con PDF de 5 páginas
  y cadena de custodia; el SHA-256 de la descarga coincide.
- **Evaluación** (`eval/REPORT.md`): voz en primer lugar 100 % (SLR73, 28 hablantes), 0.19 falsos
  vínculos por cada 100 comparaciones, identificadores 100 %, ficha 93.8 % (casi todo el error en
  `periodicidad`; el prompt se corrigió), infiltrado sin fugas. Calibración real cargada en KV
  (`calibration:v1`). Pendiente: el MO satura (coseno de e5-small entre resúmenes cualesquiera de
  0.92 a 0.96) y se recalibra con datos.
- **Landing** en `https://blindaje-landing.vigiaperu.workers.dev`, bilingüe, construida y pulida con
  Impeccable (dos críticas, una auditoría, pulido). Lighthouse móvil en producción: 98/100/100/100
  (ES) y 99/100/100/100 (EN). Turnstile real.
- **Consola** en `https://blindaje-console.vigiaperu.workers.dev` (modo simulado hasta la
  integración), recorrida de punta a punta con Chrome headless sin errores.
- **App móvil** escrita completa y probada con 91 tests; el build nativo y las capturas se hacen una
  sola vez al final, para no gastar memoria con el emulador durante el desarrollo.

### Decisiones de hoy

- **Repositorio limpio**: herramientas de desarrollo local (skills de diseño, su configuración y el
  prompt de trabajo) fuera del control de versiones.
- **Recursos de la máquina**: WSL limitado a 4 GB y 4 CPUs; contenedor ML con `-m 3g`; sin
  emulador durante el desarrollo.
- **Skills de diseño** encontrados con `npx skills find` y revisados antes de usarlos. Se descartó
  `design-mobile-apps`: es un cliente de un servicio externo de pago que recibe la descripción del
  proyecto.
- **Demo**: casos de fondo D a G (solo texto) para que la red llegue a 5 casos y 3 víctimas y el
  Vigía dispare como en el documento de diseño.

## 2026-10-28 05:00–11:00 · Integración, visión ampliada, APK y marcas de agua

### Hecho

- **Integración en producción**: API con el contenedor ML en Cloudflare Containers (standard-2,
  hasta 3 instancias), consola y portal contra la API real, y el demo sembrado de nuevo (casos A a G,
  7 casos procesados entre 15 y 34 s cada uno).
- **Visión ampliada (D11–D13)**: autenticidad de la evidencia (AudioSeal, Video Seal, C2PA,
  metadatos y análisis forense con Muse Spark), agente **Asesor** y portal de negocios
  (`blindaje-negocios`) con panorama de riesgo agregado.
- **APK de demo**: GitHub Actions está bloqueado por un problema de facturación de la cuenta, así
  que el APK se compiló en local con límites de memoria (D16) y un vigilante que corta Gradle si la
  RAM libre baja de 2 GB (cortó el primer intento; el segundo, incremental, terminó en 14 min 45 s).
  Publicado como pre-release `apk-demo-1` (arm64, 58 MB). El workflow `android.yml` queda listo.
- **Landing rediseñada** con Impeccable: dirección "el quipu del gremio" (cada caso es un cordón y
  cada señal un nudo), diagrama animado de los casos A, B y C, capturas reales de la consola y del
  portal en modo simulado, sección "Hecho con Meta AI". Lighthouse móvil 98/100/100/100 (ES) y
  99/100/100/100 (EN).
- **Rastreo de filtraciones (D14)**: cada audio e imagen que sirve la consola lleva una marca
  invisible de quien la abre (AudioSeal 16 bits por cuenta, Video Seal 256 bits por entrega); el
  admin sube una copia filtrada y ve desde qué cuenta salió. Robustez medida
  (`eval/results/watermark.json`): audio reenviado por WhatsApp (Opus 16 kbps) e imágenes
  recomprimidas, recortadas o capturadas se atribuyen bien el 100 % de las veces, con 0 % de falsos
  positivos; un recorte de audio cortado en un punto arbitrario casi siempre pierde el mensaje.
- **Llama Prompt Guard 2 (D15)**: todo texto de evidencia se revisa antes de los agentes, va
  delimitado como dato y los prompts prohíben seguir instrucciones que vengan dentro de la
  evidencia (`PROMPT_VERSION` 2026-10-28.4). Los pesos están pendientes: el acceso en Hugging Face
  es manual.

### Decisiones de hoy

- **Falla abierta auditada** al marcar copias: si el contenedor no responde en 20 s, la copia sale
  sin marca y la auditoría lo registra. El rastreo es solo para admin (no recibe copias).
- **Chequeo de ida y vuelta de Video Seal en el build** a 0.90 de los bits: en Docker dio 0.949
  sobre una imagen de ruido difuminado; es un chequeo de cordura (la API atribuye desde 0.85).

## 2026-10-28 13:00–14:00 · Landing rediseñada: el informe impreso

- La landing anterior tenía titulares de hasta 96 px partidos en 3 y 4 líneas, 16 tamaños de letra,
  68 líneas finas y ninguna foto real. Se rehízo con la skill `design-taste-frontend` (instalada en
  local, fuera del repo), que sortea una dirección de arte y mide la página en Chrome.
- Dirección "informe anual impreso": dos tintas (algodón crudo y rojo cochinilla), EB Garamond, un
  eje a 5/12 del ancho, cinco tamaños de letra (titular principal de 68 px como máximo). Detalle en
  `apps/landing/DESIGN.md`.
- Fotos reales con crédito: quipus de museo (CC0), una lámina de nudos de 1912 y calles del Perú con
  mototaxis. Las capturas de la consola se recortan a proporción fija.
- Entradas por sección ligadas al scroll (`animation-timeline: view()`): nada queda oculto antes de
  entrar a la pantalla, así se ve igual en capturas, al imprimir y sin soporte.
- Medido: 0 FAIL del inspector en español e inglés; Lighthouse 98, 100, 100 y 100 (LCP 2.3 s).

## 2026-10-28 17:00–17:40 · Landing: tintes del quipu, quipu animado y diagrama del pipeline

- Con la skill `impeccable` (crítica, colorize, animate). La paleta de cochinilla y beige leía como
  vino y sangre, y el quipu blanco sobre rojo perdía la información de cada nudo. El dueño eligió
  "Tintes del quipu": añil para los campos fuertes, papel de algodón para leer, y tres tintes que solo
  marcan señales, como en la consola (voz en ocre, número en menta, cuenta en celeste). El rojo
  cochinilla queda solo para la emergencia (105).
- Portada en añil con un quipu en SVG: trece casos del gremio; las cuerdas caen, aparecen los nudos y
  los amarres de A y B (misma voz) y de B y C (misma cuenta) llegan punteados antes de que una persona
  los vuelva sólidos. Los casos sueltos se mecen un rato; los amarrados se quedan quietos.
- Meta AI: diagrama "Del archivo a la decisión" (evidencia, modelos de Meta, señales, agentes,
  revisión humana) que se traza al entrar a la vista y deja pasar pulsos solo mientras se ve. La huella
  de voz va punteada porque usa ECAPA, que no es de Meta. En el celular es una lista colgada de una
  cuerda.
- Revisión: el amarre entre los casos es una cuerda que se cierra de punteada a sólida al confirmar y
  se corta al descartar. Favicon nuevo con el quipu. Selección de texto en el ocre del resaltador.
- Medido: inspector 0 FAIL en español e inglés (queda el aviso defendido de no tener video);
  Lighthouse 99, 100, 100 y 100 (LCP 1.8 s, CLS 0). Con movimiento reducido todo aparece completo.

## 2026-10-28 18:00–20:10 · Landing de producto: beneficios, cómo funciona y Meta AI, sin quipu

- El dueño: "lo del quipu no es necesario, parece un blog más que una landing; que exprese, que esté
  ordenado, que diga beneficios y tecnología". Con la skill `impeccable` la página pasó de ensayo
  editorial a landing de producto, en el idioma visual de la propia app: Atkinson Hyperlegible, el
  logo escrito a mano (Kalam) y el resaltador amarillo de la consola. Se mantienen el añil y los
  tintes de señal.
- Portada: titular de dos líneas con "voz" resaltado, frase de valor, dos botones y tres vistos; a la
  derecha la consola real (grafo de la red R-001) y el portal en un celular, con una nota a mano que
  señala la voz compartida. Debajo, la fila "Hecho con Meta AI".
- Orden nuevo: problema con fuentes, beneficios por actor (víctima, gremio y negocios, policía y
  fiscalía), cómo funciona en cuatro pasos con la demo de revisión, recorrido del producto en seis
  pestañas con capturas reales, Meta AI (diagrama, modelos, agentes), límites, resultados, piloto y
  pie con el 105.
- Fuera: el quipu de la portada, el quipu de la red, las fotos de quipus y de calles y EB Garamond.
  Favicon nuevo: una onda de voz sobre el resaltador.
- Medido: detector de `impeccable` 0 hallazgos a 1440, 1100 y 390 px en español e inglés; Lighthouse
  móvil 100, 100, 100 y 100 (LCP 1.7 s, CLS 0); prueba funcional en Chrome (demo de revisión,
  pestañas con teclado, formulario, anclas, sin scroll lateral) y movimiento reducido en estado final.

## 2026-10-28 20:30–21:15 · Landing: menú en celular, resultados en una mirada, preguntas y notas a mano

- Revisión independiente (finish review de `impeccable`): titular de dos líneas también en el celular
  con la consola visible en la primera pantalla; la franja del 105 y "Salir rápido" fija arriba; Meta AI
  sin tarjetas (lista de modelos y tabla de agentes); tarjetas superpuestas que ya no tapan capturas.
- Menú desplegable nativo en celular y tableta (secciones, preguntas e idioma).
- Resultados: cuatro cifras medidas arriba de las tablas (voz al primer intento, vínculos incorrectos
  por cada 100, campos de la ficha, audios reenviados por WhatsApp rastreados), leídas del mismo reporte.
- Preguntas frecuentes de un dirigente (quién ve la evidencia, cifrado, celular revisado, sin señal,
  acusaciones, policía, piloto), con respuestas tomadas de lo que la página ya afirma.
- La nota a mano de la portada se repite en cuatro capturas del recorrido.
- Medido: detector 0 hallazgos a 1440, 1100, 768 y 390 px (ES y EN); Lighthouse móvil 100, 100, 100 y
  100 (LCP 1.7 s, CLS 0); prueba funcional en Chrome sin fallas.

## 2026-10-28 21:30–22:00 · Landing: no es solo la voz

- El dueño: "no es solo voz, son fotos, patrones de habla, ubicaciones". Revisado contra el motor
  (`services/api/src/linking`): vinculan la voz, los identificadores con HMAC (teléfonos, cuentas y
  placas), las imágenes (hash perceptual y DINOv2 sobre recortes de SAM) y el modus operandi (guion,
  frases firma, canal de pago, grupo que dice ser). La zona y las fechas no vinculan solas: las usan el
  Vigía (misma modalidad en la misma zona) y el Cartógrafo (la red en el tiempo). La página lo dice así.
- Titular nuevo: "Otro número. La misma ___." con el resaltador pasando por voz, foto, frase, cuenta y
  zona; el nombre accesible del titular dice todas.
- Sección nueva "Las huellas que deja una banda": seis señales con los glifos y colores del grafo de la
  consola, un ejemplo del caso ficticio y el modelo que produce cada una.
- Frase de la portada, problema, pasos y descripción para buscadores con todas las señales.
- Medido: detector 0 hallazgos a 1440, 1100, 768 y 390 px (ES y EN); Lighthouse móvil 100, 100, 100 y
  100 (LCP 1.7 s, CLS 0); prueba funcional sin fallas; con movimiento reducido el titular queda quieto.

## 2026-10-28 22:30 – 2026-10-29 01:00 · Rediseño del producto: recolectar, hacer inteligencia, saber dónde pasa

- El dueño: la propuesta con gremios era "demasiado idealista"; lo ideal es "simplemente recolectar,
  hacer inteligencia, saber dónde sucede, o sea zona, ni siquiera vivienda". Decidió en una pregunta
  estructurada: la víctima reporta directo, la inteligencia la usan analistas y policía, la comunidad ve
  un mapa por zona y los negocios reciben alertas y consejos sin gremio; rediseño completo. Especificación
  en `docs/rediseno.md`.
- Contrato: `packages/shared/src/zones.ts` con los 50 distritos de Lima Metropolitana y el Callao (ubigeo,
  área y posición en una grilla esquemática 9 × 14 derivada de centroides de polígonos abiertos),
  `districtOfZone`, rangos `countBand` y los esquemas del mapa público y de la vista de zonas.
- API: migración `0004` con la organización central; registro sin código; el equipo central aprueba;
  Vigía y Asesor por distrito; públicos `/v1/public/zones|risk|alerts|recommendations` con rangos, sin
  totales y con límite por IP; `/v1/console/zones`; se cerró la fuga por resta de `/v1/business/risk`;
  semilla de demo con 126 casos ficticios por distrito. 162 pruebas.
- App: sin pantalla de código (registro en "Empezar", también sin señal), distrito de una lista con
  búsqueda y cambiable en Ajustes, textos del equipo y "de tu zona". 141 pruebas.
- Consola: equipo central, alertas y consejos por distrito, canales de difusión, vista Zonas. 111 pruebas.
- Portal: público y sin cuenta, distrito y rubro en la URL, mapa por distrito, Mi zona con rangos. 49 pruebas.
- Landing: relato nuevo, sección "Dónde pasa" con el mapa, capturas nuevas de Zonas, del mapa y de Mi zona,
  formulario "Solicitar acceso" para instituciones. `PRODUCT.md` y `PRIVACY.md` al día.
- Desplegado: migración remota aplicada, API, consola (API real), portal (modo simulado) y landing. Los
  casos A–G de demo pasaron de "Lima Este" y "Lima Norte" a San Juan de Lurigancho y Comas.
- Pendiente: un APK nuevo con la app sin código (Gradle al final, con límites de memoria).

## 2026-10-29 08:00 – 09:30 · El mapa primero

- El dueño: "Pero mejora". Revisión en vivo de la landing y del portal: el mapa del portal quedaba debajo de
  dos cajas de texto, el detalle aparecía fuera de la vista al pasar el puntero y los 41 cuadros punteados
  de "sin datos" se leían como un boceto.
- Portal: el mapa va primero; en pantallas de 1360 px o más sale de la columna de lectura y lleva al costado,
  fijo, el detalle del distrito y la lista nueva "Dónde hay datos" (solo los distritos sobre el umbral, del
  riesgo más alto al más bajo; pasar por la lista marca el cuadro). Debajo de 1360 px el costado va abajo
  para no partir los nombres. "Sin datos" es un gris sin tinte: dibuja la silueta de la ciudad. Las notas de
  lectura van después del mapa. Ate (bodegas) ahora tiene dos semanas sobre el mínimo en la tendencia.
  Prueba nueva: la lista no nombra distritos bajo el umbral. 50 pruebas.
- Landing: el mismo tratamiento de "sin datos" y cuadros más bajos en "Dónde pasa" (la sección ocupa menos
  de dos pantallas); pasar por la lista marca el distrito en el mapa. Títulos de sección alineados por la
  primera línea. El formulario ya no repite a quién va dirigido: dice qué recibe cada institución.
  Capturas nuevas del mapa del portal (escritorio y celular).

## 2026-10-29 10:00 – 15:00 · Humano y cálido: landing, portal y consola

- El dueño: "Sigue estando hasta la mierda el diseño :,/". En una pregunta estructurada eligió rehacer
  **todo** (landing, portal público y consola) con la dirección "Humano y cálido": crema, terracota y
  fotos reales de Lima, tono cercano, las víctimas al centro.
- Tema compartido `packages/shared/theme/calido.css` (exportado como `@blindaje/shared/theme.css`): crema,
  papel, tinta café, terracota para la acción, ocre para marcar, verde para lo confirmado, alerta para el
  105, la escala del mapa en terracota. Contrastes medidos (texto secundario 6.3:1, blanco sobre terracota
  5.5:1). Titulares en Bricolage Grotesque (variable), texto en Atkinson Hyperlegible; fuera Kalam.
- Fotos de Wikimedia Commons con licencia abierta y crédito (`docs/fotos.md`): mototaxis en el centro de
  Lima, un cerro poblado y una bodega por dentro. Se evitaron fotos con negocios reconocibles o caras.
- Landing: portada con la foto de la calle y el portal real en un celular, "Nadie debería enfrentar la
  extorsión solo."; cabecera crema con wordmark "blindaje."; señales en filas; mapa en terracota con la
  banda del cerro; la bodega junto a la app disfrazada; "Solicita acceso" en un campo terracota; crédito
  de fotos en el pie. Detector: solo `cream-palette`, aceptado por ser la paleta elegida.
- Portal (agente): sin cuadriculado, margen rojo ni Kalam; respuesta de Mi zona como protagonista; foto
  del cerro en el selector; mapa en la escala nueva sin partir nombres. 50 pruebas.
- Consola (agente): paneles de papel, barra lateral crema-2, glifos del grafo en una paleta categórica
  cálida validada con el script de dataviz (peor par con daltonismo 15.6); foto en el inicio de sesión.
  111 pruebas.
- Documentado en `apps/landing/DESIGN.md` (sistema web); el `DESIGN.md` de la raíz queda para el
  camuflaje de cuaderno de la app móvil.

## 2026-10-29 15:30 – 18:00 · Motor vectorial: Chroma Cloud y la vista animada del admin

- El dueño: "de lado mío como admin debo ver las animaciones de cómo se procesa las bases vectoriales…
  ¿Meta tiene bases vectoriales? Tengo Chroma DB en cloud, puedes usar el CLI".
- Meta no ofrece una base vectorial administrada ni embeddings en su API: `GET /v1/models` solo lista
  Muse Spark, Wonder, Voice Transcribe, Image y SAM 3.1, y `POST /v1/embeddings` responde 404. Lo que
  Meta publica es FAISS (biblioteca, ya la usamos en el contenedor ML) y modelos abiertos como DINOv2
  (nuestros vectores de imagen). Chroma también es proveedor de `vector_io` en Llama Stack.
- Chroma Cloud con el CLI (`chroma 1.4.4`): base nueva `blindaje` (las otras bases de la cuenta no se
  tocaron). API REST v2 probada a mano: colecciones con `configuration.spann.space = "cosine"`, la
  distancia vuelve como 1 − coseno; `get` acepta hasta 300 ids por lectura (cuota); `n_results` mayor
  que la colección no falla. Latencia desde Lima ~130–170 ms por consulta.
- `services/api/src/vectors/`: cliente REST sin SDK (`chroma.ts`), `ChromaStore` y `FaissStore` con
  la misma búsqueda (`store.ts`), proyección PCA por iteración de potencia y muestra de 32 números
  (`projection.ts`), y la vista de la consola (`console.ts`). El motor de vinculación busca candidatos
  en Chroma cuando el caso es ficticio y Chroma está configurado; si no, en FAISS como antes. Indexar
  sube los vectores, desindexar los borra; los resultados siempre se filtran contra D1.
- Regla de privacidad (`CHROMA_SOLO_DEMO`, por defecto): Chroma Cloud solo recibe vectores de casos
  ficticios con consentimiento comunitario, con id numérico, tipo y modelo. `SECURITY.md` lo dice.
- Endpoints solo admin: `GET /v1/console/vectores`, `POST /v1/console/vectores/consulta` (corre la
  búsqueda en vivo, sin crear vínculos, auditada) y `POST /v1/console/vectores/sincronizar`.
- En vivo: la sincronización subió 27 vectores (voz 4, segmentos 13, texto 7, imagen 3) en 6.9 s. La
  consulta del caso A (13 búsquedas) da B como probable con 0.91 (voz 0.85 + modus operandi 0.4), igual
  que el vínculo que ya existía. Tardaba 6.7 s en caliente (25 s la primera vez): el Worker corre en
  Buenos Aires y D1 está en Miami. Con 6 búsquedas y 4 candidatos a la vez baja a 3.4 s; la vista
  general, a ~1 s.
- Pruebas: Chroma falso en memoria (`test/fake-chroma.ts`); `setup.ts` apaga Chroma por defecto para que
  ningún test hable con la nube aunque `.dev.vars` tenga la clave. 11 pruebas nuevas; API 173.
- Despliegue con `wrangler deploy --containers-rollout=none` (sin Docker; el contenedor ML sigue sin
  desplegar).
- Consola (agente): vista "Motor vectorial" (`/vectores`, solo admin). Estado de Chroma (latencia,
  última sincronización, botón "Sincronizar desde D1") y un recorrido animado por caso en 10 pasos:
  1. la evidencia;
  2. el modelo que la lee (ECAPA-TDNN, Muse Spark 1.3 + multilingual-e5-small, SAM 3.1 + DINOv2, HMAC);
  3. el vector como tira de 32 números en una escala divergente validada;
  4. el punto que cae en el mapa PCA de su colección;
  5. a 8. una búsqueda por colección, con anillos, vecinos, coseno, umbral y la latencia real;
  9. las señales;
  10. el puntaje 1 − ∏(1 − pᵢ) y la cola de revisión humana.

  La consulta en vivo sale al pulsar Reproducir, mientras corren los primeros pasos. Con movimiento
  reducido, paso a paso a mano. Tabla de consultas como alternativa accesible. 127 pruebas en la consola.
- Probado en vivo (escritorio y celular) contra la API y Chroma Cloud reales: sin errores, A–B 0.91 probable.

## 2026-10-29 19:30 – 21:10 · Velocidad y el panel de monitoreo de la administración

Pedido: "mejora la velocidad" y "que la vista web de monitoreo sea para administradores, o sea para
mí". Se eligió que la administración vea todo y empiece en un panel nuevo de monitoreo.

- Medido antes de tocar nada (desde Lima, API desplegada): la consulta del motor vectorial tardaba de 5
  a 25 s y cada pantalla de 0,5 a 1,7 s. Dos causas: el Worker seguía llamando al contenedor ML (el
  binding existe aunque la imagen nunca se desplegó) y esperaba a que fallara; y el Worker corría en
  Buenos Aires con D1 en Miami, ~130 ms por consulta.
- `ML_CONTAINER: "off"` (el Worker ignora el binding hasta desplegar la imagen) y `placement` fijado en
  `gcp:us-east1`: una consulta a D1 baja a ~22 ms (con `aws:us-east-1`, ~45 ms; probadas las dos).
- `Server-Timing` en cada respuesta, con D1, Durable Objects y llamadas externas medidos por petición
  (`src/lib/timing.ts`, con AsyncLocalStorage). Con eso se vio el resto: la cola de vínculos hacía 56
  consultas (bajó a 27, una por fragmento pasó a una por lote); el caso A hacía 23 llamadas a Chroma
  (ahora una por colección, con `query_embeddings` en lote); hash perceptual, identificadores y Chroma
  van en paralelo; los ids de las colecciones de Chroma se guardan en KV.
- En el navegador cada petición nueva costaba ~500 ms más que en el servidor: preflight CORS por ruta y
  una segunda conexión TLS. La consola ahora pasa `/v1/*` a la API por un service binding
  (`apps/console/worker/index.ts`, mismo origen). Se despliega con `VITE_API_URL=self`: con `/`, Git
  Bash lo convirtió en `C:/Program Files/Git/` y la consola desplegada quedó sin API unos minutos
  (detectado en la verificación en vivo y corregido).
- Consola: lo último que se vio de cada vista aparece al instante mientras se recarga (`useAsync`, se
  vacía al entrar y al salir), el código de las vistas se precarga al entrar y `/assets/*` se guarda
  un año en el navegador.
- Resultado en el navegador: mediana de la consola de 1,0 s a 0,4 s; entrar y ver la primera pantalla,
  de 6,7 s a 1,4 s; la consulta del motor vectorial, ~1 s.
- La administración entra a todo (API y consola): cola de vínculos, evidencia, expedientes,
  Cartógrafo e hipótesis. Su copia de la evidencia lleva su marca como cualquiera; `SECURITY.md` dice
  el riesgo aceptado (el rastreo sigue siendo solo de administración).
- Panel "Monitoreo" (`/monitoreo`, inicio de la administración; `GET /v1/console/monitoreo`): lo que
  espera al equipo, servicios medidos (D1, Chroma, contenedor ML, API de Meta, auditoría; Meta y
  Chroma con la última medición de hasta 30 s, renovada en segundo plano), casos y vínculos, presupuesto
  de Meta, agentes, actividad reciente (solo la acción, sin detalles) y la velocidad de las últimas
  peticiones de la pestaña. Se actualiza cada 30 s mientras está a la vista.
- Pruebas: API 176 (3 nuevas de monitoreo y la matriz de roles al día), consola 133, compartido 23.

## 2026-10-29 22:00 – 23:30 · Llamadas y widget en la app

- Pedido del usuario: un widget de la app y un "interceptor de llamadas" que la persona configure, con
  números desconocidos que ella clasifique a mano como extorsión.
- Lo que Android permite (verificado): ninguna app de terceros graba el audio de una llamada desde
  Android 10, y Google Play lo prohíbe por accesibilidad desde mayo de 2022. Sí se puede filtrar
  llamadas con `CallScreeningService` y el rol `ROLE_CALL_SCREENING`: Android le pasa las llamadas de
  números que no están en los contactos, sin pedir permiso de contactos. El usuario aceptó que, al
  activarlo, "Cuaderno" se vea en Ajustes del teléfono como app de identificación de llamadas.
- `apps/mobile/modules/cuaderno-nativo` (módulo Expo local en Kotlin, sin permisos nuevos): el filtro
  anota hora y número cifrados con una llave del Keystore (30 días, máximo 300) y, con los números que
  la persona marcó, hace lo que ella eligió (que suene, silenciar o rechazar). El widget 4×1 sigue al
  disfraz y abre `cuaderno://anotar`; `anotar` vuelve al cuaderno si se llegó sin nada detrás.
- Pantalla `/privado/llamadas`: activar con la advertencia, revisar ("Fue extorsión" con nota y
  grabación adjunta, o "No era", que la borra), elegir qué anotar y qué hacer con los marcados, marcar
  números a mano y una guía para grabar con el teléfono de Samsung, Xiaomi o Google. Aviso de
  "llamadas por revisar" en las notas privadas. Nada en modo señuelo; el borrado de emergencia apaga el
  filtro y borra todo.
- API: `x-source: llamada` y `origen` en la evidencia del reporte de la víctima (la app titula
  "Llamada" o "Grabación de llamada"; la cronología dice "Llamada recibida").
- Pruebas: móvil 156 (14 de llamadas y 1 de los textos del widget), API 177, compartido 23. El Kotlin
  todavía no se compiló: queda para el build final del APK.
