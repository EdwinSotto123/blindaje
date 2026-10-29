import type { Dict } from "./types";
import { SOURCES } from "./sources";

export const es: Dict = {
  lang: "es",
  htmlLang: "es-PE",
  meta: {
    title: "Blindaje: inteligencia comunitaria contra la extorsión",
    description:
      "Blindaje recolecta la evidencia que guardan las víctimas de extorsión, la convierte en inteligencia y muestra en qué distritos pasa, nunca en qué vivienda. Una persona revisa cada vínculo.",
    ogLocale: "es_PE",
  },
  skip: "Saltar al contenido",
  help: {
    ariaLabel: "Ayuda inmediata",
    danger: "¿Estás en peligro ahora?",
    dangerCta: "Llamar al 105",
    report: "Para denunciar:",
    reportCta: "Línea 1818",
    exit: "Salir rápido",
    exitShort: "Salir",
    exitHint: "Abre una página neutra. Atajo: Esc dos veces.",
  },
  nav: {
    ariaLabel: "Secciones",
    benefits: "Beneficios",
    signals: "Señales",
    map: "Mapa",
    product: "Producto",
    how: "Cómo funciona",
    intelligence: "Inteligencia",
    tech: "Meta AI",
    results: "Resultados",
    pilot: "Solicitar acceso",
    switchLabel: "Read in English",
    switchName: "English",
    switchShort: "EN",
    switchHref: "/en/",
    switchLang: "en",
  },
  hero: {
    ctaPilot: "Solicitar acceso",
    ctaHow: "Ver cómo funciona",
  },
  problem: {
    title: "Miles de denuncias. Cada víctima, sola frente a una red.",
    lead:
      "Las bandas operan en serie: la misma voz llama a varias víctimas, mandan las mismas fotos, repiten el mismo guion y la misma cuenta cobra a distintos comerciantes. Esa información existe, pero está dispersa en celulares de personas que no se conocen.",
    sourcePrefix: "Fuente:",
    figures: [
      {
        value: "13,892",
        text: "denuncias por extorsión registró el Ministerio Público entre enero y julio de 2026.",
        detail:
          "Los distritos fiscales con más casos: Lima Este (1,806), La Libertad (1,625), Lima Sur (1,346), Lima Norte (1,305) y Lima Centro (1,178).",
        source: SOURCES.exitosa,
      },
      {
        value: "27,000",
        text: "denuncias por extorsión, o más, cerraron el año 2025, según datos de la Fiscalía.",
        source: SOURCES.larepublica,
      },
      {
        value: "80",
        text: "por ciento de las empresas de transporte público admitió pagar cupos mensuales a bandas criminales.",
        detail: "Al menos 69 conductores fueron asesinados durante su jornada en 2025, con la extorsión como principal móvil.",
        source: SOURCES.larepublica,
      },
      {
        value: "26,217",
        text: "denuncias por extorsión al cierre del periodo analizado, frente a 4,761 al inicio, mientras los presos sentenciados bajaron de 712 a 650.",
        detail: "El medio aclara que las cifras solas no explican la diferencia: más denuncias no se traducen solas en más condenas.",
        source: SOURCES.elcomercio,
      },
    ],
    gapTitle: "Y las cifras se quedan cortas: muchas víctimas no denuncian por temor a represalias.",
    gapSource: SOURCES.americatv,
    gaps: [
      {
        title: "Evidencia débil",
        text: "Audios de WhatsApp sin transcribir, capturas sin fecha, cronologías armadas de memoria.",
      },
      {
        title: "Casos desconectados",
        text: "Nadie compara la voz del audio de una bodeguera con la de un mototaxista de otro distrito.",
      },
      {
        title: "Miedo a denunciar",
        text: "La víctima no sabe si denunciar sirve, teme que el extorsionador se entere y no tiene a quién recurrir.",
      },
    ],
  },
  actors: {
    title: "Cada uno recibe algo concreto.",
    lead:
      "La víctima documenta sin exponerse, la comunidad sabe dónde pasa y la autoridad recibe casos ya vinculados.",
    victim: {
      name: "Víctima",
      title: "Guarda la evidencia sin que nadie lo note.",
      lead:
        "En el celular, Blindaje se ve como una app común de tu negocio, y tú eliges cuál. Funciona de verdad. Tus notas privadas se abren con una entrada secreta y tu PIN.",
      points: [
        {
          title: "PIN señuelo y salir rápido",
          text: "Un PIN señuelo abre unas notas vacías y creíbles. Un toque vuelve a la app de siempre y la bloquea. Cero notificaciones.",
        },
        {
          title: "Todo se sube cifrado",
          text: "Graba, toma una foto o pega un audio de WhatsApp. Se sube cifrado apenas lo guardas y no queda en tu galería.",
        },
        {
          title: "Lo que encontramos",
          text: "Blindaje transcribe y resalta los datos: cuánto piden, por dónde, en qué plazo y quién dice ser.",
        },
        {
          title: "Tu denuncia, lista",
          text: "Con cronología y huella de integridad, para llevarla a la comisaría.",
        },
      ],
      illo: {
        label: "La misma app, por fuera y por dentro",
        outside: "Por fuera: un cuaderno de ventas que funciona",
        inside: "Por dentro: tus notas privadas",
        key: "Entrada secreta y PIN",
        note: "Ilustración. El disfraz lo eliges tú: este es uno de ellos.",
        ledgerTitle: "Ventas de hoy",
        ledger: [
          { item: "2 leches", amount: "S/ 9.00" },
          { item: "Pan, 10 unidades", amount: "S/ 3.00" },
          { item: "Gaseosa", amount: "S/ 2.50" },
        ],
        totalLabel: "Total",
        total: "S/ 14.50",
        evidence: [
          { kind: "voice", text: "Audio de WhatsApp, 0:24" },
          { kind: "phrase", text: "Mensaje: “2,000 soles por Yape en 48 horas”" },
          { kind: "image", text: "Foto del local con una bala" },
        ],
        foundLabel: "Lo que encontramos",
        found: ["Pide 2,000 soles", "Por Yape", "Plazo de 48 horas", "Dice ser de “Los X”"],
        caseLabel: "Caso A",
      },
      shotOutsideAlt: "Captura de la app por fuera: se ve como una app común de un negocio",
      shotInsideAlt: "Captura de la app por dentro: notas privadas con la evidencia guardada",
      cloud:
        "Sin señal, la evidencia espera cifrada en el celular y se borra de ahí cuando la subida se confirma. Solo la ven las personas autorizadas.",
    },
    community: {
      name: "Comunidad y negocios",
      title: "Ven dónde pasa y saben qué hacer.",
      lead:
        "Con consentimiento, cada caso se compara con los demás. El equipo aprueba alertas anónimas por distrito y cada negocio ve consejos de prevención para su zona y su rubro.",
      points: [
        {
          title: "Solo cifras agregadas",
          text: "Nada se muestra con menos de 5 casos de 3 víctimas distintas. No hay buscador de números ni de cuentas.",
        },
      ],
      consent: [
        {
          title: "Solo mi denuncia",
          tag: "Viene así",
          text: "Blindaje ordena tu evidencia y arma tu denuncia. Nada sale de tu caso.",
        },
        {
          title: "Modo comunitario",
          tag: "Lo activas tú",
          text: "Tus señales seudonimizadas se comparan con las de otros casos. Lo puedes retirar cuando quieras.",
        },
      ],
      shot: {
        alt: "Captura del portal público en un celular: mapa de los distritos de Lima y el Callao con niveles de riesgo en rangos, sin cuenta.",
        caption: "Portal público en el celular, sin cuenta. Modo simulado, datos ficticios.",
      },
    },
    authority: {
      name: "Autoridad",
      title: "Expedientes de red para la policía y la fiscalía.",
      lead:
        "Cuando un analista autorizado aprueba una red, Blindaje arma el expediente en PDF. Se envía solo cuando existe un canal formal con la autoridad.",
      dossier: [
        { title: "Resumen de la red", text: "Tamaño, periodo, sectores y modus operandi común." },
        { title: "Cronología unificada", text: "Los hechos de todos los casos, en orden." },
        { title: "Vínculos explicados", text: "Cada vínculo con su puntaje, sus señales y la evidencia citada." },
        { title: "Huella SHA-256", text: "Cada archivo original con su huella de integridad y hora UTC." },
        { title: "Cadena de custodia", text: "Quién subió qué y cuándo, en un registro encadenado." },
      ],
      channel:
        "Las cuentas que aparecen en varios casos quedan señaladas para que la autoridad las pida por los canales legales. Blindaje no comparte datos con bancos ni fintechs.",
      shot: {
        alt: "Captura de la consola: perfil de la red R-001 hecho por el Cartógrafo, con hechos citados a la izquierda e hipótesis por aprobar a la derecha.",
        caption: "El Cartógrafo separa hechos de hipótesis. Solo lo aprobado entra al expediente. Consola en modo simulado, datos ficticios.",
      },
    },
  },
  intel: {
    title: "Lo que ninguna víctima puede ver sola.",
    lead:
      "Cada audio, mensaje y foto se convierte en señales comparables. Con ellas, los agentes de Blindaje vinculan casos, mapean redes, redactan alertas y consejos, y revisan si la evidencia es real. Ninguno decide solo.",
    link: {
      title: "Vincula casos aunque cambie el número",
      text: "Compara la huella de voz, la cuenta de cobro, las fotos reutilizadas y el guion. El Vinculador explica cada posible vínculo citando la evidencia: lo que lo sostiene y lo que lo contradice. Una revisora del equipo lo confirma o lo descarta.",
      shot: {
        alt: "Captura de la consola: el Vinculador explica el vínculo entre el Caso A y el Caso B. La voz coincide en 4 de 5 segmentos, aunque los números de contacto y las cuentas son distintos.",
        caption: "Misma voz, números distintos. Puntaje 0.91, citas verificadas.",
      },
    },
    network: {
      title: "Mapea la red detrás de los casos",
      text: "Los vínculos confirmados forman redes. El Cartógrafo analiza cada una: periodo, modus operandi, escalamiento y la evidencia que falta.",
      shot: {
        alt: "Grafo de la red R-001: tres casos unidos por la huella de voz V-3 y la cuenta Yape ···488, con sus números, frases firma e imagen.",
        caption: "Red R-001: tres casos, una voz, una cuenta.",
        mobileCaption: "Detalle de la red R-001: la voz V-3 une los casos A y B, aunque sus números son distintos.",
      },
    },
    alert: {
      title: "Avisa a la zona antes del próximo caso",
      text: "El Vigía detecta una modalidad que se repite en al menos 5 casos de 3 víctimas distintas en 14 días y redacta la alerta. Una persona del equipo la aprueba y se publica para ese distrito.",
      cardTitle: "Alerta aprobada por el equipo de Blindaje",
      card: "Circulan audios que dicen ser de “Los X” y piden pago por Yape. No pagues ni negocies: denuncia en la Línea 1818 o en tu comisaría.",
      cardMeta: "Ejemplo ficticio",
    },
    advice: {
      title: "Aconseja a los negocios cómo prevenir",
      text: "El Asesor redacta consejos por zona y rubro con datos agregados. Un validador revisa que cada afirmación cite evidencia, que no aparezcan números ni cuentas y que nunca aconseje pagar ni negociar. Una persona del equipo aprueba antes de que el negocio lo vea.",
      shot: {
        alt: "Captura de la consola: consejo del Asesor para mototaxis de Ate, en borrador. El validador encontró una afirmación sin cita y una cita que no existe.",
        caption: "El validador atrapa una afirmación sin cita antes de que llegue al portal.",
      },
    },
    agentsTitle: "Seis agentes, y siempre una persona que aprueba.",
    agentsLead:
      "Corren con Muse Spark por la Responses API, con salida JSON de esquema estricto. Los que investigan usan llamadas a herramientas. Además de los cuatro de arriba:",
    approvesLabel: "Aprueba",
    agents: [
      {
        name: "Vinculador",
        text: "Explica cada posible vínculo entre dos casos y ajusta el puntaje si ve contradicciones.",
        approves: "Una revisora del equipo",
      },
      {
        name: "Cartógrafo",
        text: "Analiza una red: periodo, modus operandi, roles que sugiere el grafo y evidencia que falta.",
        approves: "Un analista autorizado",
      },
      {
        name: "Vigía",
        text: "Detecta modalidades que se repiten en un distrito y redacta la alerta para esa zona.",
        approves: "El equipo",
      },
      {
        name: "Redactor",
        text: "Convierte una red aprobada en un expediente PDF con cronología y cadena de custodia.",
        approves: "Un analista autorizado",
      },
      {
        name: "Asesor",
        text: "Redacta consejos de prevención por zona y rubro, solo con cifras agregadas.",
        approves: "Una persona del equipo",
      },
      {
        name: "Autenticidad",
        text: "Busca indicios de que un audio, una foto o un video fue generado con IA o manipulado.",
        approves: "La revisora, al decidir el vínculo",
      },
    ],
    rules: "Toda afirmación cita evidencia: sin cita, la salida no vale. Nunca nombres de personas. Búsqueda web desactivada.",
  },
  tech: {
    title: "Hecho con Meta AI. Cada modelo, un trabajo concreto.",
    lead:
      "La evidencia pasa por un pipeline en Cloudflare y un contenedor de ML. Cada pieza se transcribe, se segmenta, se resume en una ficha y se convierte en señales que se pueden comparar.",
    pipelineLabel: "Del archivo a la decisión",
    pipeline: [
      { stage: "Evidencia", items: ["Audio de WhatsApp", "Mensaje", "Foto", "Video"] },
      { stage: "Modelos", items: ["Muse Voice Transcribe", "Muse Spark 1.3 y 1.2", "SAM 3.1", "DINOv2", "AudioSeal y Video Seal"] },
      { stage: "Señales", items: ["Huella de voz", "Ficha del caso", "Identificadores con HMAC", "Recortes y vectores", "Autenticidad"] },
      { stage: "Agentes", items: ["Vinculador", "Cartógrafo", "Vigía", "Redactor", "Asesor"] },
      { stage: "Una persona aprueba", items: ["Vínculo", "Alerta", "Consejo", "Expediente"] },
    ],
    modelsTitle: "Qué usamos y para qué",
    groups: [
      {
        title: "Meta Model API",
        rows: [
          {
            name: "Muse Spark 1.3",
            id: "muse-spark-1.3",
            use: "Arma la ficha del caso con JSON de esquema estricto, mueve a los agentes con llamadas a herramientas por la Responses API y busca manipulación en fotos y videos.",
          },
          {
            name: "Muse Spark 1.2",
            id: "muse-spark-1.2",
            use: "Escucha el audio directamente para el análisis forense de la voz, porque la 1.3 no tiene soporte completo de audio.",
          },
          {
            name: "Muse Voice Transcribe 1.0",
            id: "muse-voice-transcribe-1.0",
            use: "Transcribe separando quién habla, con marcas de tiempo por turno y un vocabulario propio: Yape, Plin, cupo, derecho de piso.",
          },
          {
            name: "SAM 3.1",
            id: "sam-3.1",
            use: "Encuentra con texto balas, notas escritas a mano y placas en fotos y cuadros de video, y tapa los rostros de terceros.",
          },
          {
            name: "Muse Image 1.0",
            id: "muse-image-1.0",
            use: "Generó las fotos ficticias del demo y de la evaluación. Ninguna foto es real.",
          },
          {
            name: "Muse Wonder 1.0",
            id: "muse-wonder-1.0",
            use: "Opcional: el Cartógrafo lo usa cuando una red es muy grande.",
          },
        ],
      },
      {
        title: "Modelos y librerías abiertas de Meta",
        rows: [
          {
            name: "AudioSeal",
            id: "facebook/audioseal",
            use: "Detecta marcas de IA en el audio y, al revés, marca cada copia de audio con los 16 bits de la cuenta que la escucha.",
          },
          {
            name: "Video Seal",
            id: "facebookresearch/videoseal",
            use: "Detecta marcas de IA en fotos y videos, y marca cada copia de imagen con un mensaje de 256 bits por entrega.",
          },
          {
            name: "DINOv2",
            id: "dinov2-small",
            use: "Convierte cada recorte en un vector para encontrar imágenes reutilizadas aunque no sean idénticas.",
          },
          { name: "FAISS", id: "faiss", use: "Tres índices de búsqueda: voz, texto e imagen." },
          { name: "PyTorch", id: "torch", use: "Corre los modelos del contenedor de ML." },
          { name: "React Native y Hermes", id: "react-native", use: "La app de la víctima, en Android." },
          { name: "React", id: "react", use: "La consola de revisión y el portal de negocios." },
        ],
      },
    ],
    honestTitle: "Lo que no es de Meta, y lo que descartamos",
    honest: [
      "La huella de voz (ECAPA de SpeechBrain) y los vectores de texto (multilingual-e5-small) usan modelos abiertos de terceros, porque la Meta Model API no tiene un endpoint de embeddings.",
      "Evaluamos Muse Glimmer para armar la ficha en el celular, sin conexión. Es un modelo denso de 30B parámetros, unos 17 GB incluso a 4 bits: no cabe en un celular. La ficha se arma en el servidor, con consentimiento.",
    ],
  },
  commitments: {
    title: "Lo que Blindaje no hace.",
    lead: "Estos límites son parte del diseño, no una nota al pie. Protegen a las víctimas y evitan errores graves.",
    items: [
      {
        title: "No decide nada sin una persona.",
        text: "Todo vínculo, alerta, consejo y expediente es un borrador hasta que alguien autorizado lo aprueba.",
      },
      {
        title: "No identifica personas.",
        text: "Vincula casos y señales. Nunca le pone nombre a una voz ni busca a nadie en internet: los agentes no tienen búsqueda web.",
      },
      { title: "No le muestra a una víctima datos de otras.", text: "Tampoco le avisa que su caso fue vinculado." },
      {
        title: "No aconseja pagar ni negociar.",
        text: "Ni a víctimas ni a negocios. Siempre deriva al 105, a la Línea 1818 y a la comisaría.",
      },
      {
        title: "No publica direcciones, viviendas ni cifras exactas.",
        text: "El mapa es por distrito, en rangos, sin totales, y necesita al menos 5 casos de 3 víctimas distintas.",
      },
      { title: "No decide culpabilidad.", text: "Cada vínculo es una hipótesis con su puntaje y su evidencia." },
      { title: "No usa datos reales en el demo.", text: "Casos, voces, números, cuentas y fotos son ficticios." },
      { title: "No tiene contenido político.", text: "" },
    ],
    honestyTitle: "Y te lo decimos claro",
    honesty:
      "El servidor procesa la evidencia para transcribirla y compararla, así que no es cifrado de extremo a extremo. Viaja cifrada, se guarda cifrada y solo la ven los roles autorizados, con un registro de auditoría encadenado.",
    legal: "Antes de un piloto con víctimas reales hace falta una revisión legal bajo la",
    legalLink: SOURCES.ley29733,
  },
  results: {
    title: "Lo que medimos, con datos ficticios.",
    lead:
      "La evaluación usa guiones de amenaza escritos para el proyecto y voces de un corpus abierto de español de Perú (OpenSLR SLR73), comprimidas como en WhatsApp. Publicamos los resultados reales, sean los que sean.",
    placeholder: "Todavía no hay reporte de la evaluación.",
    pendingNote: "La evaluación todavía no ha publicado su reporte. Las metas son objetivos de trabajo, no resultados.",
    cols: { what: "Qué se mide", target: "Meta", result: "Resultado" },
    pending: "Pendiente",
    metrics: [
      { id: "voice_top1", label: "Vinculación por voz: el caso correcto aparece primero", target: "80% o más" },
      { id: "voice_top3", label: "Vinculación por voz: el caso correcto está entre los 3 primeros", target: "90% o más" },
      { id: "false_links_per_100", label: "Vínculos incorrectos por cada 100 comparaciones sobre el umbral de revisión", target: "2 como máximo" },
      { id: "identifier_match", label: "Coincidencias exactas de identificadores detectadas", target: "100%" },
      { id: "ficha_accuracy", label: "Campos de la ficha correctos frente a la etiqueta manual", target: "90% o más" },
      { id: "citation_fidelity", label: "Afirmaciones de los agentes con evidencia citada y verificable", target: "100%" },
      { id: "small_stats", label: "Estadísticas mostradas con menos de 5 casos", target: "0" },
      { id: "infiltrator", label: "Prueba del infiltrado: no recibe vínculos ni datos de otros casos", target: "Pasa" },
    ],
    generatedAt: "Reporte generado el",
    passed: "Pasa",
    failed: "No pasa",
    sample: "muestras",
    meets: "Cumple la meta",
    misses: "No cumple la meta",
    noTarget: "Sin meta",
    extraTitle: "Otros resultados, sin meta",
    fullReport: "Reporte completo de la evaluación",
    reportedNote: "Resultados reales de una corrida con datos ficticios. Las metas son objetivos de trabajo, no garantías.",
    leak: {
      title: "Rastreo de filtraciones",
      lead: "Copias marcadas que se atribuyeron a la cuenta correcta después de cada cambio, con medios ficticios y 50 destinatarios simulados.",
      rows: {
        "audio.whatsapp_opus_16k": "Audio reenviado por WhatsApp (Opus 16 kbps)",
        "imagen.whatsapp": "Imagen recomprimida por WhatsApp",
        "imagen.recorte_10_whatsapp": "Imagen recortada un 10 % y reenviada por WhatsApp",
        "imagen.captura_png": "Captura de pantalla de la imagen",
        "imagen.captura_whatsapp": "Captura de pantalla reenviada por WhatsApp",
        "audio.fragmento_6s_opus_16k": "Fragmento de audio de 6 s cortado en un punto cualquiera",
        "audio.opus_8k": "Audio comprimido a Opus 8 kbps (caso extremo)",
      },
      limitTag: "Límite conocido",
      falseLabel: "Medios sin marca atribuidos a una cuenta por error",
      falseValue: "{a} de {na} pruebas de audio y {i} de {ni} de imagen",
      source: "Resultados del rastreo (eval/results/watermark.json)",
    },
  },
  pilot: {
    title: "Solicita acceso para tu institución.",
    lead:
      "Blindaje trabaja con instituciones que pueden actuar: comisarías, fiscalías, municipios y ONG. Gremios, iglesias y juntas vecinales pueden ayudar a difundir la app.",
    who: "La policía y la fiscalía reciben el expediente de cada red por un canal formal. Municipios y ONG usan el mapa y las alertas de sus distritos, que ya son públicos.",
    steps: [
      "Conversamos con tu institución.",
      "Hacemos la revisión legal antes de tratar datos reales.",
      "Empezamos en uno o dos distritos.",
    ],
    fields: {
      org: "Nombre de tu institución u organización",
      name: "Tu nombre",
      contact: "WhatsApp, celular o correo",
      contactHint: "Para responderte. No lo compartimos con nadie.",
      sector: "Tipo de institución",
      sectorNone: "Elige uno",
      sectors: [
        { value: "policia", label: "Policía" },
        { value: "fiscalia", label: "Fiscalía" },
        { value: "municipalidad", label: "Municipalidad" },
        { value: "ong", label: "ONG o atención a víctimas" },
        { value: "difusion", label: "Gremio, iglesia o junta (para difundir)" },
        { value: "otro", label: "Otro" },
      ],
      district: "Distrito o provincia",
      members: "Cuántas personas lo usarían",
      message: "¿Algo que debamos saber?",
      optional: "opcional",
      more: "Agregar detalles (opcional)",
    },
    errors: {
      org: "Escribe el nombre de tu institución (al menos 2 letras).",
      name: "Escribe tu nombre (al menos 2 letras).",
      contact: "Escribe un número de celular (6 dígitos o más) o un correo para responderte.",
      members: "Escribe solo un número, sin puntos ni comas.",
      summary: "Revisa los campos marcados.",
    },
    verifying: "Comprobación automática contra el spam",
    verifyingWait: "Se activa sola cuando empiezas a llenar el formulario.",
    captchaLoad: "No pudimos cargar la comprobación automática. Revisa tu conexión y recarga la página.",
    noscript: "Para enviar este formulario, activa JavaScript en tu navegador.",
    submit: "Enviar solicitud",
    sending: "Enviando…",
    successTitle: "Recibimos tu solicitud.",
    success:
      "Te escribiremos al contacto que dejaste para conversar sobre tu institución y los siguientes pasos, empezando por la revisión legal. Gracias por sumarte.",
    fail: "No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo.",
    rateLimited: "Llegaron muchas solicitudes desde tu conexión. Espera unos minutos e inténtalo de nuevo.",
    captcha: "La comprobación automática todavía no termina. Espera unos segundos y vuelve a enviar.",
    unavailable: "El formulario no está disponible ahora. Inténtalo de nuevo en unos minutos.",
    privacy:
      "Usamos estos datos solo para responder tu solicitud. Este formulario no es para denunciar: si estás en peligro, llama al 105.",
  },
  helpSection: {
    title: "Si estás en peligro ahora, llama al 105.",
    lines: [
      { number: "105", name: "Policía Nacional del Perú, emergencias", cta: "Llamar al 105" },
      { number: "1818", name: "Línea 1818, Central Única de Denuncias del Mininter", cta: "Llamar a la Línea 1818" },
    ],
    station: "También puedes denunciar en tu comisaría más cercana.",
    note: "No pagues ni negocies. Guarda los audios y los mensajes, y denuncia.",
  },
  footer: {
    hackathon: "Proyecto para el Meta Global AI Developer Hackathon, construido del 26 de octubre al 4 de noviembre de 2026.",
    repo: "Código en GitHub",
    fictitious: "Los datos del demo y de la evaluación son ficticios. Nada de esta página viene de víctimas reales.",
    license: "Código abierto bajo licencia Apache-2.0.",
    shots: "Las capturas son de la consola y del portal público de Blindaje en modo simulado.",
  },
  notFound: {
    title: "Esta página no existe.",
    text: "Puede que el enlace esté mal escrito.",
    home: "Volver al inicio",
  },
  lp: {
    hero: {
      line1: "Otro número.",
      prefix: "La misma",
      swap: ["voz", "foto", "frase", "cuenta", "zona"],
      srTitle: "Otro número. La misma voz, la misma foto, la misma frase, la misma cuenta, la misma zona.",
      lead:
        "Blindaje recolecta la evidencia que guardan las víctimas de extorsión, la convierte en inteligencia y muestra dónde pasa, por distrito. Compara voces, fotos, frases, números y cuentas para encontrar a la misma banda detrás de casos distintos. Una persona revisa cada vínculo.",
      ctaMap: "Ver el mapa por distrito",
      points: [
        "La víctima reporta directo, sin código ni pertenecer a nada.",
        "Vincula casos por voz, fotos, forma de hablar, números y cuentas.",
        "Muestra dónde pasa por distrito, nunca una vivienda.",
      ],
      stageLabel: "La consola y el portal público de Blindaje en modo simulado",
      consoleTitle: "Red R-001 · 3 casos",
      simulated: "Modo simulado",
      annotation: "misma voz, otro número",
      note: "Capturas reales de la consola y del portal público en modo simulado. Datos ficticios.",
      consoleAlt:
        "Captura de la consola: grafo de la red R-001. Los casos A, B y C quedan unidos por la huella de voz V-3 y la cuenta Yape ···488, aunque sus números de teléfono son distintos.",
      phoneAlt: "Captura del portal público en un celular: en Ate, el riesgo para bodegas es alto, entre 10 y 19 casos.",
    },
    built: {
      label: "Hecho con Meta AI",
      items: ["Muse Spark", "Muse Voice Transcribe", "SAM 3.1", "AudioSeal", "Video Seal", "DINOv2", "FAISS", "PyTorch", "React Native"],
    },
    signals: {
      title: "Las huellas que deja una banda.",
      lead: "Cambiar de chip es fácil. Cambiar de voz, de fotos, de guion y de cuenta de cobro, no. Blindaje compara cada huella entre todos los casos.",
      items: [
        {
          kind: "voz",
          name: "Voz",
          text: "La huella de voz de cada audio, segmento por segmento, aunque llamen desde otro número.",
          example: "V-3 en los casos A y B · 4 de 5 segmentos",
          how: "Muse Voice Transcribe · huella ECAPA · Muse Spark 1.2 revisa si es sintética",
        },
        {
          kind: "imagen",
          name: "Fotos y video",
          text: "Balas, notas escritas y placas recortadas de cada foto o video. Encuentra la misma imagen aunque la reenvíen o la recorten.",
          example: "IMG-1 · foto del local con una bala",
          how: "SAM 3.1 · DINOv2 · hash perceptual",
        },
        {
          kind: "frase",
          name: "Forma de hablar",
          text: "El guion, las frases que repiten y a quién dicen representar.",
          example: "“habla con el jefe” · “no llames a la policía” · “Los X”",
          how: "Muse Spark 1.3 arma la ficha · vectores de texto",
        },
        {
          kind: "id",
          name: "Números, cuentas y placas",
          text: "Teléfonos, cuentas de Yape o Plin y placas, cifrados con HMAC: se comparan sin exponer el dato y sin buscador.",
          example: "Yape ···488 en los casos B y C",
          how: "Muse Spark 1.3 los extrae · HMAC",
        },
        {
          kind: "cobro",
          name: "Cómo cobran",
          text: "Cuánto piden, en qué plazo y por qué canal. Solo, nunca vincula: suma a las demás señales.",
          example: "2,000 soles · Yape · 48 horas",
          how: "Ficha del caso de Muse Spark 1.3",
        },
        {
          kind: "zona",
          name: "Zona y fechas",
          text: "En qué distrito y cuándo pasa, nunca una dirección. El Vigía detecta la misma modalidad en la misma zona y el Cartógrafo ordena la red en el tiempo.",
          example: "5 casos de 3 víctimas en 14 días",
          how: "Vigía y Cartógrafo · Muse Spark 1.3",
        },
      ],
      note: "Ninguna señal decide sola: el motor las combina en un puntaje calibrado y una persona confirma cada vínculo.",
    },
    problem: { gapsTitle: "Por qué no alcanza hoy" },
    benefits: {
      title: "Un beneficio concreto para cada uno.",
      lead:
        "La víctima documenta sin exponerse, la comunidad sabe dónde pasa y qué hacer, y la autoridad recibe casos ya vinculados.",
      illustration: "Ilustración de la app. Por fuera, un cuaderno de ventas que funciona; por dentro, las notas privadas. El disfraz lo eliges tú.",
      audiences: [
        {
          id: "victim",
          name: "Víctimas",
          title: "Reportan directo, sin que nadie lo note.",
          points: [
            "Instalan la app sin código ni pertenecer a un gremio. El disfraz lo eligen ellas.",
            "Entrada secreta, PIN señuelo, salir rápido y cero notificaciones.",
            "Audios, fotos y mensajes se suben cifrados y no quedan en la galería.",
            "La denuncia sale lista, con cronología y huella de integridad.",
          ],
        },
        {
          id: "community",
          name: "Comunidad y negocios",
          title: "Ven dónde pasa y saben qué hacer.",
          points: [
            "Un mapa por distrito, público y sin cuenta.",
            "Alertas y consejos de prevención para su zona y su rubro, aprobados por una persona.",
            "Rangos, no cifras exactas, y nada con menos de 5 casos de 3 víctimas.",
            "Nunca una dirección, un número ni una cuenta.",
          ],
        },
        {
          id: "authority",
          name: "Policía y fiscalía",
          title: "Reciben casos ya vinculados, con la evidencia citada.",
          points: [
            "Expediente en PDF con la cronología de toda la red.",
            "Cada vínculo explicado, con su puntaje y sus señales.",
            "Huella SHA-256 y cadena de custodia de cada archivo.",
            "En qué distritos opera la red y cuentas repetidas para pedirlas por canales legales.",
          ],
        },
      ],
    },
    where: {
      title: "Dónde pasa, por distrito.",
      lead: "Los casos se juntan por distrito, nunca por calle ni vivienda. El mapa es público y no necesita cuenta.",
      rules: [
        "Rangos, no cifras exactas: 5-9, 10-19, 20-49 o 50+.",
        "Nada donde haya menos de 5 casos de 3 víctimas: ese distrito se ve igual que uno sin casos.",
        "Sin totales que permitan restar y sin direcciones ni coordenadas.",
        "Más casos puede significar que ahí se denuncia más, no que sea más peligroso.",
      ],
      cta: "Abrir el mapa",
      label: "Mapa esquemático de los 50 distritos de Lima y Callao con datos ficticios",
      legend: { sin_datos: "Sin datos o pocos casos", bajo: "Bajo", medio: "Medio", alto: "Alto" },
      note: "Datos ficticios. Cada cuadro es un distrito en su posición aproximada.",
    },
    how: {
      title: "Recolectar, hacer inteligencia, ubicar.",
      lead: "Del audio de WhatsApp de una víctima al mapa del distrito y al expediente de la red. Los modelos proponen; las personas deciden.",
      steps: [
        {
          title: "Recolecta",
          text: "Cualquier víctima instala la app disfrazada, elige su distrito y guarda audios, fotos, videos y mensajes. Se suben cifrados.",
          tag: "App Android",
        },
        {
          title: "Analiza",
          text: "Muse Voice Transcribe transcribe por hablante y Muse Spark arma la ficha. Cada pieza se vuelve señales: voz, fotos, frases del guion, números, cuentas, zona y fechas.",
          tag: "Meta AI",
        },
        {
          title: "Vincula",
          text: "El Vinculador compara las señales con todos los casos y explica cada posible vínculo. Una persona del equipo de Blindaje lo confirma o lo descarta.",
          tag: "Agentes y revisión humana",
        },
        {
          title: "Muestra dónde pasa",
          text: "Los casos se juntan por distrito: la comunidad ve el mapa y las alertas de su zona, y la policía y la fiscalía reciben el expediente de la red.",
          tag: "Mapa por distrito",
        },
      ],
      demoTitle: "Pruébalo: tú revisas.",
      demoLead: "Este vínculo acaba de llegar a la consola del equipo. Confírmalo o descártalo.",
    },
    tour: {
      title: "Todo lo que hace Blindaje.",
      lead: "Capturas reales de la consola y del portal en modo simulado, con datos ficticios.",
      tabsLabel: "Funciones de Blindaje",
      items: [
        {
          tab: "Vincula casos",
          title: "Vincula casos aunque cambie el número",
          note: "Vinculador · Muse Spark 1.3",
          text: "Compara la huella de voz, la cuenta de cobro, las fotos reutilizadas y el guion. El Vinculador explica cada posible vínculo citando la evidencia: lo que lo sostiene y lo que lo contradice. Una revisora del equipo lo confirma o lo descarta.",
          shot: "consola-vinculo-misma-voz",
          alt: "Captura de la consola: el Vinculador explica el vínculo entre el Caso A y el Caso B. La voz coincide en 4 de 5 segmentos, aunque los números de contacto y las cuentas son distintos.",
          caption: "Misma voz, números distintos. Puntaje 0.91, citas verificadas. Datos ficticios.",
          pen: "cada cita, comprobada",
        },
        {
          tab: "Mapea la red",
          title: "Mapea la red detrás de los casos",
          note: "Cartógrafo · Muse Spark 1.3 con llamadas a herramientas",
          text: "Los vínculos confirmados forman redes. El Cartógrafo analiza cada una: periodo, modus operandi, escalamiento y la evidencia que falta. Separa los hechos de las hipótesis.",
          shot: "consola-red-grafo",
          alt: "Captura de la consola: grafo de la red R-001, con tres casos unidos por la huella de voz V-3 y la cuenta Yape ···488.",
          caption: "Red R-001: tres casos, una voz, una cuenta. Datos ficticios.",
          pen: "misma cuenta, otro caso",
        },
        {
          tab: "Zonas",
          title: "Ve en qué distritos pasa",
          note: "Vista de zonas · umbral de 5 casos de 3 víctimas",
          text: "La consola junta los casos por distrito, los compara con el periodo anterior y muestra qué redes y modalidades se repiten en cada uno. Un distrito con pocos casos no muestra cifras.",
          shot: "consola-zonas",
          alt: "Captura de la consola: grilla de los distritos de Lima y el Callao con casos por distrito. San Juan de Lurigancho está seleccionado: 14 casos de 11 víctimas en 28 días, en aumento.",
          caption: "Vista de zonas del equipo. Datos ficticios.",
        },
        {
          tab: "Aconseja",
          title: "Aconseja a los negocios cómo prevenir",
          note: "Asesor · Muse Spark 1.3, JSON de esquema estricto",
          text: "El Asesor redacta consejos por zona y rubro con datos agregados. Un validador revisa que cada afirmación cite evidencia, que no aparezcan números ni cuentas y que nunca aconseje pagar ni negociar. Una persona del equipo aprueba antes de que el negocio lo vea.",
          shot: "consola-recomendaciones-asesor",
          alt: "Captura de la consola: consejo del Asesor para mototaxis de Ate, en borrador. El validador encontró una afirmación sin cita y una cita que no existe.",
          caption: "El validador atrapa una afirmación sin cita antes de que llegue al portal. Datos ficticios.",
        },
        {
          tab: "Expediente",
          title: "Arma el expediente para la fiscalía",
          note: "Redactor · PDF con huella SHA-256 y cadena de custodia",
          text: "Cuando un analista aprueba una red, el Redactor arma el expediente en PDF: cronología unificada, vínculos explicados con su evidencia, huella SHA-256 de cada archivo y cadena de custodia. Se envía solo por un canal formal.",
          shot: "consola-perfil-cartografo",
          alt: "Captura de la consola: perfil de la red R-001, con hechos citados a la izquierda e hipótesis por aprobar a la derecha.",
          caption: "Solo lo aprobado entra al expediente. Datos ficticios.",
        },
        {
          tab: "Autenticidad",
          title: "Revisa si la evidencia es real",
          note: "AudioSeal · Video Seal · C2PA · Muse Spark 1.2 escucha el audio",
          text: "Una voz se puede imitar con IA. Blindaje busca marcas de agua con AudioSeal y Video Seal, lee credenciales C2PA y metadatos, y Muse Spark escucha y mira en busca de indicios. Solo se marca como hecho con IA si hay prueba técnica.",
          shot: "consola-autenticidad-evidencia",
          alt: "Captura de la consola: el audio EV-C2 tiene indicios fuertes de IA; sin marca de AudioSeal, sin C2PA, y una entonación uniforme y sin respiración.",
          caption: "Autenticidad de un audio. Datos ficticios.",
          pen: "son indicios, no prueba",
        },
        {
          tab: "Filtraciones",
          title: "Rastrea quién filtró una copia",
          note: "AudioSeal: 16 bits por cuenta · Video Seal: 256 bits por entrega",
          text: "Las marcas de agua de Meta, al revés: cada audio e imagen que sale de la consola lleva escondida la cuenta que la pidió. Si una copia aparece afuera, la administración ve de qué cuenta salió, aunque la hayan reenviado por WhatsApp.",
          shot: "consola-rastreo-filtracion",
          alt: "Captura de la consola: la marca de Video Seal de una foto reenviada por WhatsApp coincide con la copia que recibió la Revisora Demo, con el 98 % de los bits.",
          caption: "Rastrear filtración, solo para administración. Datos ficticios.",
          pen: "la copia salió de esta cuenta",
        },
        {
          tab: "Mapa público",
          title: "Muestra el mapa a la comunidad",
          note: "Portal público · sin cuenta",
          text: "Cualquiera elige su distrito y su rubro y ve el nivel de riesgo, las alertas y los consejos aprobados por el equipo. Solo rangos, nunca cifras exactas ni direcciones.",
          shot: "portal-mapa",
          alt: "Captura del portal público: mapa de los 50 distritos de Lima y el Callao con niveles bajo, medio y alto, y al lado la lista de los distritos con datos, de San Juan de Lurigancho (alto, 20-49) a Villa El Salvador (bajo, 5-9). Ate está marcado como tu distrito.",
          caption: "Portal público en modo simulado. Datos ficticios.",
        },
      ],
    },
    tech: {
      apiLabel: "Meta Model API",
      openLabel: "Modelos y librerías abiertas de Meta",
      agentsTitle: "Seis agentes, y siempre una persona que aprueba.",
      agentsLead:
        "Corren con Muse Spark 1.3 por la Responses API, con salida JSON de esquema estricto. Toda afirmación cita evidencia: sin cita, la salida no vale.",
    },
    trust: {
      title: "Lo que Blindaje no hace.",
      lead: "Estos límites son parte del diseño, no una nota al pie. Protegen a las víctimas y evitan errores graves.",
    },
    menu: { label: "Menú", faq: "Preguntas" },
    results: {
      label: "Resultados medidos",
      highlights: [
        { id: "voice_top1", label: "de las veces, la voz encontró primero el caso correcto" },
        { id: "false_links_per_100", label: "vínculos incorrectos por cada 100 comparaciones" },
        { id: "ficha_accuracy", label: "de los campos de la ficha, correctos frente a la etiqueta manual" },
      ],
      leakId: "audio.whatsapp_opus_16k",
      leakLabel: "de los audios reenviados por WhatsApp, rastreados hasta su cuenta",
      target: "Meta",
    },
    faq: {
      title: "Preguntas frecuentes.",
      lead: "Lo que suelen preguntar las instituciones y quienes difunden la app.",
      items: [
        {
          q: "¿La víctima necesita pertenecer a un gremio?",
          a: "No. Cualquier víctima instala la app y reporta. Gremios, iglesias, juntas o municipios pueden ayudar a difundirla, pero no revisan ni aprueban nada.",
        },
        {
          q: "¿Quién ve la evidencia de una víctima?",
          a: "Solo el equipo de análisis de Blindaje, según lo que la víctima permita. La evidencia viaja cifrada, se guarda cifrada y cada acceso queda en un registro de auditoría encadenado. Una víctima nunca ve datos de otros casos.",
        },
        {
          q: "¿Qué muestra el mapa?",
          a: "Distritos, nunca calles ni viviendas. Muestra rangos y no cifras exactas, y nada donde haya menos de 5 casos de 3 víctimas. Siempre advierte que más casos puede significar que ahí se denuncia más.",
        },
        {
          q: "¿Y si alguien revisa el celular de la víctima?",
          a: "Ve una app de ventas que funciona. Las notas privadas se abren con una entrada secreta y un PIN; un PIN señuelo abre notas vacías y creíbles, y un toque vuelve a la app de siempre. No hay notificaciones.",
        },
        {
          q: "¿Cómo se evitan los reportes falsos sin un gremio que verifique?",
          a: "Una persona del equipo revisa cada vínculo antes de que cuente, ninguna señal decide sola, hay un límite de registros por conexión y los dispositivos sospechosos se pueden marcar.",
        },
        {
          q: "¿Blindaje acusa a alguien o reemplaza a la policía?",
          a: "No. Vincula casos y señales, nunca le pone nombre a una voz ni busca a nadie en internet. Siempre deriva al 105, a la Línea 1818 y a la comisaría, y el expediente llega a la autoridad solo por un canal formal.",
        },
        {
          q: "¿Cómo se suma una institución?",
          a: "Conversamos, hacemos la revisión legal bajo la Ley 29733 antes de tratar datos reales y empezamos en uno o dos distritos.",
        },
      ],
    },
  },
  page: {
    problemTitle: ["Miles de denuncias.", "Cada víctima, sola."],
    review: {
      title: "Una persona confirma cada vínculo.",
      states: ["Propuesto", "En revisión", "Confirmado"],
      caseA: "Caso A · bodeguera",
      caseB: "Caso B · mototaxista",
      tie: "Misma voz",
      score: "0.91",
      detail: "La voz coincide en 4 de 5 segmentos, aunque los números y las cuentas son distintos.",
      proposedBy: "Lo propone el Vinculador, con citas verificadas",
      confirm: "Confirmar vínculo",
      discard: "Descartar",
      confirmed: "Confirmado por la revisora del equipo · 28 oct., 10:42",
      undo: "Deshacer",
      discarded: "Descartado por la revisora. No se usa para vincular.",
    },
    tech: {
      title: ["Hecho con Meta AI,", "pieza por pieza."],
      lead: "Cada audio, mensaje, foto o video pasa por modelos de Meta, se vuelve señales que se pueden comparar y llega a agentes que proponen. Una persona aprueba.",
      modelsLabel: "Modelos",
      groups: [
        {
          kind: "Meta Model API",
          rows: [
            { name: "Muse Spark 1.3", use: "Ficha del caso y agentes" },
            { name: "Muse Spark 1.2", use: "Análisis forense de la voz" },
            { name: "Muse Voice Transcribe", use: "Transcribe por hablante" },
            { name: "SAM 3.1", use: "Balas, notas, placas; tapa rostros" },
            { name: "Muse Image 1.0", use: "Fotos ficticias del demo" },
            { name: "Muse Wonder 1.0", use: "Redes grandes, opcional" },
          ],
        },
        {
          kind: "Abiertos de Meta",
          rows: [
            { name: "AudioSeal", use: "Marcas de IA y rastreo de audio" },
            { name: "Video Seal", use: "Marcas de IA y rastreo de imagen" },
            { name: "DINOv2", use: "Imágenes reutilizadas" },
            { name: "FAISS", use: "Búsqueda de voz, texto e imagen" },
            { name: "PyTorch", use: "El contenedor de ML" },
            { name: "React Native", use: "La app de la víctima" },
            { name: "React", use: "Consola y portal" },
          ],
        },
      ],
      agentsLabel: "Agentes",
      diagramNote:
        "La línea punteada no pasa por un modelo de Meta: la huella de voz usa ECAPA, un modelo abierto de terceros. Las señales se juntan en una sola cuerda y de ahí las leen los agentes.",
      approves: "Aprueba",
      agents: [
        { name: "Vinculador", what: "Explica cada posible vínculo", approves: "Una revisora" },
        { name: "Cartógrafo", what: "Analiza una red", approves: "Un analista" },
        { name: "Vigía", what: "Redacta alertas por distrito", approves: "El equipo" },
        { name: "Redactor", what: "Arma el expediente", approves: "Un analista" },
        { name: "Asesor", what: "Escribe consejos por zona", approves: "El equipo" },
        { name: "Autenticidad", what: "Busca indicios de IA", approves: "La revisora" },
      ],
    },
    results: { title: "Lo que medimos." },
    pilot: {
      title: "Solicita acceso para tu institución.",
      steps: [
        { lead: "Primero,", text: "conversamos con tu institución." },
        { lead: "Luego,", text: "hacemos la revisión legal antes de tratar datos reales." },
        { lead: "Al final,", text: "empezamos en uno o dos distritos." },
      ],
    },
    foot: {
      callLine: "Llama al 105",
      reportLine: "Para denunciar, Línea 1818",
      top: "Volver arriba",
      creditsLabel: "Fotos",
      place: "Lima, 2026",
    },
  },
};
