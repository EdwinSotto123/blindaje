import type { Dict } from "./types";
import { SOURCES } from "./sources";

export const es: Dict = {
  lang: "es",
  htmlLang: "es-PE",
  meta: {
    title: "Blindaje: inteligencia comunitaria contra la extorsión",
    description:
      "Blindaje junta la evidencia de las víctimas de un gremio, encuentra a la misma banda detrás de casos distintos y le devuelve a la comunidad alertas y consejos de prevención, siempre con revisión humana.",
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
    how: "Cómo funciona",
    intelligence: "Inteligencia",
    tech: "Meta AI",
    results: "Resultados",
    pilot: "Pedir un piloto",
    switchLabel: "Read in English",
    switchName: "English",
    switchShort: "EN",
    switchHref: "/en/",
    switchLang: "en",
  },
  hero: {
    title: ["Cambiaron de número.", "No cambiaron de voz."],
    voiceWord: "voz",
    lead:
      "Blindaje es inteligencia comunitaria contra la extorsión. Junta la evidencia de las víctimas de tu gremio. Encuentra a la misma banda detrás de casos distintos. Le devuelve a tu comunidad alertas y consejos para prevenir. Y una persona revisa cada vínculo.",
    serves: "Para gremios y asociaciones de mototaxistas, transportistas, mercados y bodegas del Perú.",
    ctaPilot: "Pedir un piloto para mi gremio",
    ctaHow: "Ver cómo funciona",
    repo: "Código en GitHub",
    demo: {
      label: "Un caso en cuatro semanas",
      fictitious: "Datos ficticios",
      stepsLabel: "Semanas del caso",
      weekWord: "Semana",
      caseWord: "Caso",
      guild: "Casos del gremio",
      rows: { phone: "Número", voice: "Voz", account: "Cuenta Yape" },
      cases: [
        { id: "A", who: "bodeguera" },
        { id: "B", who: "mototaxista" },
        { id: "C", who: "comerciante" },
      ],
      tieVoice: "Misma voz · 0.91",
      tieAccount: "Misma cuenta · 0.95",
      reviewer: "confirmó la revisora",
      proposed: "propuesto",
      network: "Red R-001",
      outputs: ["Alerta al gremio", "Consejos a negocios", "Expediente a la fiscalía"],
      weeks: [
        "La Persona A, bodeguera, recibe audios y un mensaje: 2,000 soles por Yape en 48 horas. Su número, su voz y su cuenta de cobro quedan como nudos de su cuerda.",
        "A la Persona B, mototaxista, la llaman desde otro número. La voz coincide con la de A. Blindaje propone el vínculo y una revisora lo confirma.",
        "A la Persona C, comerciante, le piden pagar a la misma cuenta de Yape que a B. El tercer caso se amarra a la red.",
        "Tres casos, una voz, una cuenta. El gremio recibe una alerta anónima, los negocios reciben consejos y la fiscalía, un expediente.",
      ],
    },
  },
  problem: {
    title: "Miles de denuncias. Cada víctima, sola frente a una red.",
    lead:
      "Las bandas operan en serie: la misma voz llama a varias víctimas y la misma cuenta cobra a distintos comerciantes. Esa información existe, pero está dispersa en celulares de personas que no se conocen.",
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
        value: "+27,000",
        text: "denuncias por extorsión cerraron el año 2025, según datos de la Fiscalía.",
        source: SOURCES.larepublica,
      },
      {
        value: "80%",
        text: "de las empresas de transporte público admitió pagar cupos mensuales a bandas criminales.",
        detail: "Al menos 69 conductores fueron asesinados durante su jornada en 2025, con la extorsión como principal móvil.",
        source: SOURCES.larepublica,
      },
      {
        value: "4,761 a 26,217",
        text: "denuncias por extorsión en el periodo analizado, mientras los presos sentenciados bajaron de 712 a 650.",
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
      "Blindaje llega a las víctimas a través de su gremio. La víctima documenta sin exponerse, la comunidad se protege y la autoridad recibe casos ya vinculados.",
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
      name: "Gremio y negocios",
      title: "El gremio ve lo que se repite. Sus negocios saben qué hacer.",
      lead:
        "Con consentimiento, el caso de cada asociado se compara con los demás. El gremio aprueba alertas anónimas y cada negocio recibe consejos de prevención para su zona y su rubro.",
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
        alt: "Captura del portal de negocios en un celular: en Lima Este, el riesgo para bodegas es medio, con 14 casos en los últimos 28 días.",
        caption: "Portal de negocios en el celular. Modo simulado, datos ficticios.",
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
      text: "Compara la huella de voz, la cuenta de cobro, las fotos reutilizadas y el guion. El Vinculador explica cada posible vínculo citando la evidencia: lo que lo sostiene y lo que lo contradice. Una revisora del gremio lo confirma o lo descarta.",
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
      title: "Avisa al gremio antes del próximo caso",
      text: "El Vigía detecta una modalidad que se repite en al menos 5 casos de 3 víctimas distintas en 14 días y redacta la alerta. El gremio la aprueba y la manda por sus canales.",
      cardTitle: "Alerta aprobada por el gremio",
      card: "Circulan audios que dicen ser de “Los X” y piden pago por Yape. No pagues ni negocies: denuncia en la Línea 1818 o en tu comisaría.",
      cardMeta: "Ejemplo ficticio",
    },
    advice: {
      title: "Aconseja a los negocios cómo prevenir",
      text: "El Asesor redacta consejos por zona y rubro con datos agregados. Un validador revisa que cada afirmación cite evidencia, que no aparezcan números ni cuentas y que nunca aconseje pagar ni negociar. Una persona del gremio aprueba antes de que el negocio lo vea.",
      shot: {
        alt: "Captura de la consola: consejo del Asesor para mototaxis de Lima Este, en borrador. El validador encontró una afirmación sin cita y una cita que no existe.",
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
        approves: "Una revisora del gremio",
      },
      {
        name: "Cartógrafo",
        text: "Analiza una red: periodo, modus operandi, roles que sugiere el grafo y evidencia que falta.",
        approves: "Un analista autorizado",
      },
      {
        name: "Vigía",
        text: "Detecta modalidades que se repiten y redacta la alerta para el gremio.",
        approves: "El gremio",
      },
      {
        name: "Redactor",
        text: "Convierte una red aprobada en un expediente PDF con cronología y cadena de custodia.",
        approves: "Un analista autorizado",
      },
      {
        name: "Asesor",
        text: "Redacta consejos de prevención por zona y rubro, solo con cifras agregadas.",
        approves: "Una persona del gremio",
      },
      {
        name: "Autenticidad",
        text: "Busca indicios de que un audio, una foto o un video fue generado con IA o manipulado.",
        approves: "La revisora, al decidir el vínculo",
      },
    ],
    rules: "Toda afirmación cita evidencia: sin cita, la salida no vale. Nunca nombres de personas. Búsqueda web desactivada.",
  },
  authenticity: {
    title: "¿Ese audio es real?",
    lead:
      "Una voz se puede imitar con IA y una foto se puede editar. Por eso Blindaje revisa cada audio, foto y video antes de usarlo para vincular casos, y le dice a la revisora qué encontró.",
    checksTitle: "Qué revisa",
    checks: [
      { name: "Marca de agua en audio", text: "Busca la marca invisible que deja un generador de voz.", by: "AudioSeal" },
      { name: "Marca de agua en imagen y video", text: "La busca en la foto y en los cuadros del video.", by: "Video Seal" },
      { name: "Credenciales de contenido", text: "Lee el manifiesto que declara cómo se hizo el archivo, si lo trae.", by: "C2PA" },
      { name: "Metadatos", text: "Datos de la cámara, del editor y del archivo de audio o video.", by: "EXIF · XMP · IPTC · ffprobe" },
      {
        name: "Análisis forense",
        text: "Mira la foto y el video, escucha el audio y anota indicios: entonación plana, cortes, bordes raros.",
        by: "Muse Spark 1.3 y 1.2",
      },
    ],
    verdictsTitle: "Cómo decide",
    verdicts: [
      {
        title: "Confirmado, solo con prueba técnica.",
        text: "Se marca como hecho con IA solo si hay marca de agua o C2PA que lo declare. Lo demás son indicios.",
      },
      {
        title: "Una voz dudosa pesa la mitad.",
        text: "Si un audio tiene indicios fuertes de ser sintético, su voz pesa la mitad al vincular casos.",
      },
      {
        title: "Una persona decide.",
        text: "La revisora ve las señales y el análisis antes de confirmar un vínculo.",
      },
    ],
    absence: "La ausencia de marca de agua no prueba que algo sea real: la mayoría de generadores no la pone.",
    shot: {
      alt: "Captura de la consola: autenticidad de la evidencia. El audio EV-C2 tiene indicios fuertes de IA: sin marca de agua de AudioSeal, sin C2PA ni metadatos, y el análisis forense de Muse Spark 1.2 nota una entonación uniforme y sin respiración.",
      caption: "Autenticidad de un audio en la consola. Modo simulado, datos ficticios.",
    },
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
          { name: "AudioSeal", id: "facebook/audioseal", use: "Detecta marcas de agua en el audio." },
          { name: "Video Seal", id: "facebookresearch/videoseal", use: "Detecta marcas de agua en fotos y videos." },
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
        title: "No publica cifras chicas, mapas ni datos abiertos.",
        text: "Lo que ve la comunidad es agregado y necesita al menos 5 casos de 3 víctimas distintas.",
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
  },
  pilot: {
    title: "Pide un piloto para tu gremio.",
    lead:
      "Blindaje no es una app abierta a cualquiera. Llega a las víctimas a través de organizaciones que ya existen y verifican a sus miembros.",
    who: "Gremios de transporte, asociaciones de mototaxistas y de mercados, juntas vecinales y cámaras de comercio distritales.",
    steps: [
      "Conversamos con tu directiva.",
      "Hacemos la revisión legal antes de tratar datos reales.",
      "Empezamos con un grupo pequeño de asociados verificados.",
    ],
    fields: {
      org: "Nombre de tu asociación o gremio",
      name: "Tu nombre",
      contact: "WhatsApp, celular o correo",
      contactHint: "Para responderte. No lo compartimos con nadie.",
      sector: "Rubro de tus asociados",
      sectorNone: "Elige uno",
      sectors: [
        { value: "bodega", label: "Bodegas" },
        { value: "mototaxi", label: "Mototaxis" },
        { value: "transporte", label: "Transporte" },
        { value: "mercado", label: "Mercados" },
        { value: "restaurante", label: "Restaurantes" },
        { value: "construccion", label: "Construcción" },
        { value: "otro", label: "Otro" },
      ],
      district: "Distrito o provincia",
      members: "Cuántos asociados son",
      message: "¿Algo que debamos saber?",
      optional: "opcional",
      more: "Agregar detalles (opcional)",
    },
    errors: {
      org: "Escribe el nombre de tu asociación (al menos 2 letras).",
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
      "Te escribiremos al contacto que dejaste para conversar sobre tu asociación y los siguientes pasos, empezando por la revisión legal. Gracias por pensar en tus asociados.",
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
    shots: "Las capturas son de la consola y del portal de Blindaje en modo simulado.",
  },
  notFound: {
    title: "Esta página no existe.",
    text: "Puede que el enlace esté mal escrito.",
    home: "Volver al inicio",
  },
};
