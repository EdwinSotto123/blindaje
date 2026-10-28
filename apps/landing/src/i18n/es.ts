import type { Dict } from "./types";
import { SOURCES } from "./sources";

export const es: Dict = {
  lang: "es",
  htmlLang: "es-PE",
  meta: {
    title: "Blindaje: inteligencia comunitaria contra la extorsión",
    description:
      "Una app que se ve como una app común de tu negocio y por dentro guarda las pruebas de una extorsión, arma tu denuncia y, si quieres, une tu caso al de tu gremio.",
    ogLocale: "es_PE",
  },
  skip: "Saltar al contenido",
  help: {
    ariaLabel: "Ayuda inmediata",
    danger: "Si estás en peligro ahora, llama al",
    dangerCta: "105",
    report: "Para denunciar: Línea",
    reportCta: "1818",
  },
  nav: {
    ariaLabel: "Secciones",
    how: "Cómo funciona",
    commitments: "Compromisos",
    tech: "Tecnología",
    results: "Resultados",
    pilot: "Piloto",
    switchLabel: "Read in English",
    switchName: "English",
    switchHref: "/en/",
    switchLang: "en",
  },
  hero: {
    outside: "Por fuera, una app común de tu negocio.",
    inside: "Por dentro, tu caso contra la extorsión.",
    lead:
      "Blindaje es para bodegueros, mototaxistas, transportistas y comerciantes que reciben amenazas. Guarda audios, mensajes y fotos sin que se note, arma una denuncia sólida y, si tú quieres, une tu caso al de tu gremio para que se vea la red que está detrás.",
    ledgerLabel: "Qué recibe cada uno",
    actors: [
      {
        id: "victima",
        actor: "Víctima",
        text: "Guarda la evidencia sin que se note y arma su denuncia.",
        total: "Denuncia lista",
      },
      {
        id: "comunidad",
        actor: "Comunidad",
        text: "Con consentimiento, su caso se compara con otros del gremio.",
        total: "Alertas anónimas",
      },
      {
        id: "autoridad",
        actor: "Autoridad",
        text: "Recibe casos ya vinculados, con cronología y cadena de custodia.",
        total: "Expediente de red",
      },
    ],
    formIntro: "Blindaje llega a través de gremios y asociaciones. ¿Diriges una?",
    formLabel: "Nombre de tu asociación",
    formPlaceholder: "Asociación de mototaxistas…",
    formCta: "Solicitar un piloto",
    shotCaption: "Se ve como una app común de tu negocio, y tú eliges cuál.",
    shotAlt: "Captura de la app de Blindaje: notas privadas con la evidencia guardada",
  },
  problem: {
    label: "El problema",
    title: "Miles de denuncias, y cada víctima enfrenta sola a una red.",
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
  victim: {
    label: "Víctima",
    title: "Guarda la evidencia sin que nadie lo note.",
    lead:
      "En el celular, Blindaje se ve como una app común de tu negocio, y tú eliges cuál. Funciona de verdad. Las notas privadas se abren con una entrada secreta y tu PIN.",
    features: [
      {
        title: "Entrada secreta y PIN",
        text: "Un gesto o un monto secreto abre las notas privadas. Un PIN señuelo abre unas notas vacías y creíbles.",
      },
      {
        title: "Salir rápido",
        text: "Un toque vuelve a la app de siempre y la bloquea. Al pasar a segundo plano, se bloquea sola.",
      },
      {
        title: "Sin rastros",
        text: "Cero notificaciones. La evidencia no queda en la galería ni en archivos recientes.",
      },
      {
        title: "Graba, toma una foto o pega",
        text: "Los audios de WhatsApp, los mensajes y las fotos entran directo a tus notas privadas.",
      },
      {
        title: "Lo que encontramos",
        text: "Blindaje transcribe y resalta los datos: el canal de pago, el plazo, el grupo que dice ser.",
      },
      {
        title: "Preparar mi denuncia",
        text: "Cuatro pasos y queda lista, con cronología y huella de integridad, para llevarla a la comisaría.",
      },
    ],
    consentTitle: "Tú decides qué se comparte.",
    consent: [
      {
        title: "Solo mi denuncia",
        tag: "Viene así",
        text: "Blindaje te ayuda a ordenar tu evidencia y armar tu denuncia. Nada sale de tu caso.",
      },
      {
        title: "Modo comunitario",
        tag: "Lo activas tú",
        text: "Tus señales seudonimizadas se comparan con las de otros casos. Lo puedes retirar cuando quieras.",
      },
    ],
    cloud:
      "La evidencia se sube cifrada apenas la guardas y solo la ven las personas autorizadas. Si no hay señal, espera cifrada en el celular y se borra de ahí cuando la subida se confirma.",
    shotOutside: "Por fuera: una de las apps que puedes elegir.",
    shotOutsideAlt: "Captura de la app por fuera: se ve como una app común de un negocio",
    shotReport: "Por dentro: tu denuncia, lista para la comisaría.",
    shotReportAlt: "Captura de la denuncia lista en Blindaje, con cronología y evidencia",
  },
  community: {
    label: "Comunidad",
    title: "Cambiaron de número, pero no de voz.",
    lead:
      "Cada víctima tiene una pieza: un audio, un número, una cuenta de Yape, una foto. Sola, casi no sirve. Unidas con consentimiento, muestran la red que está detrás.",
    method:
      "Blindaje no compara datos crudos: compara huellas de voz cifradas, identificadores protegidos con HMAC y fichas sin datos de la víctima. Cuando varias piezas coinciden, propone un vínculo, y una persona lo revisa antes de que exista.",
    demoTitle: "Un caso en cuatro semanas",
    fictitious: "Datos ficticios",
    tablistLabel: "Semanas del caso",
    weekWord: "Semana",
    next: "Siguiente",
    restart: "Volver a la semana 1",
    legend: { voice: "Misma voz", account: "Misma cuenta", phone: "Número distinto" },
    happensLabel: "Qué pasa",
    detectsLabel: "Qué detecta Blindaje",
    weeks: [
      {
        label: "Semana 1",
        happens:
          "La Persona A, bodeguera, recibe dos audios de voz masculina, un mensaje que exige 2,000 soles por Yape en 48 horas y una foto de su tienda con una bala encima.",
        detects: "Se crea el caso A con su ficha, su huella de voz, sus identificadores y sus imágenes.",
      },
      {
        label: "Semana 2",
        happens: "La Persona B, mototaxista en otro distrito, recibe un audio desde otro número.",
        detects:
          "La huella de voz coincide con la del caso A y el guion se repite: “habla con el jefe”, “no llames a la policía”. Blindaje propone el vínculo A–B y un revisor lo confirma.",
      },
      {
        label: "Semana 3",
        happens: "La Persona C, comerciante de mercado, recibe la orden de pagar a la misma cuenta de Yape que le dieron a B.",
        detects: "El identificador cifrado coincide. C se vincula a B y aparece una red de tres casos.",
      },
      {
        label: "Semana 4",
        happens: "Un agente analiza la red y un analista autorizado revisa el perfil.",
        detects:
          "Una voz que llama, una cuenta que cobra, un guion común y amenazas físicas a los pocos días del plazo vencido. La autoridad recibe el expediente y el gremio, una alerta.",
      },
    ],
    table: {
      caption: "Señales de los tres casos",
      cols: {
        case: "Caso",
        who: "Quién",
        phone: "Número",
        voice: "Voz",
        account: "Cuenta Yape",
        note: "Nota del revisor",
      },
      rows: [
        { id: "A", who: "Bodeguera", phone: "···204", voice: "V-3", account: "···117", note: "", week: 1 },
        {
          id: "B",
          who: "Mototaxista",
          phone: "···951",
          voice: "V-3",
          account: "···488",
          note: "Misma voz que A. Confirmado.",
          week: 2,
        },
        {
          id: "C",
          who: "Comerciante",
          phone: "···630",
          voice: "",
          account: "···488",
          note: "Misma cuenta que B. Confirmado.",
          week: 3,
        },
      ],
      noAudio: "sin audio",
    },
    alertTitle: "Alerta aprobada por el gremio",
    alert:
      "Circulan audios que dicen ser de “Los X” y piden pago por Yape. No negocies solo: denuncia en la Línea 1818 o en tu comisaría.",
    gate: "Ningún vínculo existe hasta que una persona lo confirma. A la víctima nunca se le muestran datos de otros casos.",
  },
  authority: {
    label: "Autoridad",
    title: "Expedientes de red para la policía y la fiscalía.",
    lead:
      "Cuando un analista autorizado aprueba una red, Blindaje arma el expediente y lo exporta en PDF. Se envía solo cuando existe un canal formal con la autoridad.",
    dossierTitle: "Qué trae el expediente",
    dossier: [
      { title: "Resumen de la red", text: "Tamaño, periodo, sectores, territorio agregado y modus operandi común." },
      { title: "Cronología unificada", text: "Los hechos de todos los casos, en orden." },
      { title: "Vínculos y su explicación", text: "Cada vínculo con su puntaje, sus señales y la evidencia citada." },
      { title: "Evidencia con huella SHA-256", text: "Cada archivo original con su huella de integridad y hora UTC." },
      { title: "Cadena de custodia", text: "Quién subió qué y cuándo, en un registro encadenado." },
    ],
    channel:
      "Las cuentas que aparecen en varios casos quedan señaladas para que la autoridad las pida por los canales legales. Blindaje no comparte datos con bancos ni fintechs.",
  },
  commitments: {
    label: "Compromisos",
    title: "Lo que Blindaje no hace.",
    lead: "Estos límites son parte del diseño, no una nota al pie. Protegen a las víctimas y evitan errores graves.",
    items: [
      { title: "No identifica personas por nombre.", text: "Vincula casos y señales. Nunca le pone nombre a una voz ni busca a nadie en redes sociales." },
      { title: "No investiga a individuos en internet.", text: "Los agentes de análisis no tienen búsqueda web." },
      { title: "No le muestra a una víctima datos de otras.", text: "Tampoco le avisa que su caso fue vinculado." },
      { title: "No decide culpabilidad.", text: "Cada vínculo es una hipótesis con su nivel de confianza y su evidencia, y pasa por revisión humana." },
      { title: "No reemplaza a la policía ni a la fiscalía.", text: "Siempre deriva a los canales oficiales." },
      { title: "No aconseja pagar ni negociar con extorsionadores.", text: "" },
      { title: "No publica mapas ni datos abiertos.", text: "Lo que ve la comunidad es agregado y necesita un mínimo de 5 casos." },
      { title: "No tiene contenido político.", text: "" },
    ],
    honestyTitle: "Y te lo decimos claro",
    honesty:
      "El servidor procesa la evidencia para transcribirla y compararla, así que no es cifrado de extremo a extremo. Viaja cifrada, se guarda cifrada y solo la ven los roles autorizados, con un registro de auditoría encadenado.",
    legal: "Antes de un piloto con víctimas reales hace falta una revisión legal bajo la",
    legalLink: SOURCES.ley29733,
  },
  tech: {
    label: "Tecnología",
    title: "Modelos de Meta, cada uno con un trabajo concreto.",
    lead: "La evidencia pasa por un pipeline en Cloudflare: cada pieza se transcribe, se segmenta, se resume en una ficha y se convierte en señales comparables.",
    states: { pipeline: "En el pipeline", optional: "Opcional", evaluated: "Evaluado" },
    rows: [
      {
        name: "Muse Voice Transcribe",
        id: "muse-voice-transcribe-1.0",
        role: "Transcribe los audios separando quién habla, con marcas de tiempo por turno y un vocabulario propio: Yape, Plin, cupo, derecho de piso.",
        state: "pipeline",
      },
      {
        name: "Muse Spark 1.3",
        id: "muse-spark-1.3",
        role: "Arma la ficha del caso con salida estructurada y mueve a los cuatro agentes con tool calling por la Responses API.",
        state: "pipeline",
      },
      {
        name: "Muse Spark 1.2",
        id: "muse-spark-1.2",
        role: "Escucha el audio directamente cuando hace falta, porque la 1.3 no tiene soporte completo de audio.",
        state: "pipeline",
      },
      {
        name: "SAM 3.1",
        id: "sam-3.1",
        role: "Encuentra balas, notas escritas a mano y placas en fotos y videos, tapa rostros de terceros y sigue vehículos entre cuadros.",
        state: "pipeline",
      },
      {
        name: "FAISS",
        id: "librería abierta de Meta",
        role: "Tres índices de búsqueda: voz, texto e imagen.",
        state: "pipeline",
      },
      {
        name: "DINOv2",
        id: "modelo abierto de Meta",
        role: "Convierte cada recorte en un vector para encontrar imágenes reutilizadas aunque no sean idénticas.",
        state: "pipeline",
      },
      {
        name: "Muse Wonder",
        id: "muse-wonder-1.0",
        role: "Para analizar redes muy grandes, cuando el contexto lo pide.",
        state: "optional",
      },
      {
        name: "Muse Image",
        id: "muse-image-1.0",
        role: "Tarjetas sobrias para que el gremio comparta sus alertas.",
        state: "optional",
      },
      {
        name: "Muse Glimmer",
        id: "open weights",
        role: "Lo evaluamos para armar la ficha en el celular, sin conexión. Es un modelo denso de 30B parámetros, unos 17 GB incluso a 4 bits: no cabe en un celular. La ficha se arma en el servidor, con consentimiento.",
        state: "evaluated",
      },
    ],
    agentsTitle: "Cuatro agentes, y siempre una persona que aprueba.",
    agentsLead: "No hay un agente que decida solo. Cada salida es un borrador hasta que alguien autorizado la aprueba.",
    approvesLabel: "Aprueba",
    agents: [
      {
        name: "Vinculador",
        text: "Evalúa cada par de casos candidatos, ajusta el puntaje si ve contradicciones y explica el posible vínculo citando la evidencia.",
        approves: "Un revisor del gremio",
      },
      {
        name: "Cartógrafo",
        text: "Analiza una red: periodo, modus operandi, roles que sugiere la estructura del grafo y la evidencia que falta. Separa hechos de hipótesis.",
        approves: "Un analista autorizado",
      },
      {
        name: "Vigía",
        text: "Detecta una modalidad que se repite en al menos 5 casos de 3 víctimas distintas en 14 días y redacta la alerta.",
        approves: "El gremio",
      },
      {
        name: "Redactor",
        text: "Convierte una red aprobada en un expediente PDF con cronología, vínculos y cadena de custodia.",
        approves: "Un analista autorizado",
      },
    ],
    rules: "Toda afirmación cita evidencia: sin cita, la salida no vale. Nunca nombres de personas. Búsqueda web desactivada.",
    thirdParty:
      "La huella de voz y los vectores de texto usan modelos abiertos de terceros, porque la Meta Model API no tiene un endpoint de embeddings.",
  },
  results: {
    label: "Resultados",
    title: "Lo que medimos, con datos ficticios.",
    lead:
      "La evaluación usa guiones de amenaza escritos para el proyecto y voces de un corpus abierto de español de Perú (OpenSLR SLR73), comprimidas como en WhatsApp. Publicamos los resultados reales, sean los que sean.",
    placeholder: "[resultados de la evaluación]",
    pendingNote: "La evaluación todavía no ha publicado su reporte. Las metas son objetivos de trabajo, no resultados.",
    cols: { what: "Qué se mide", target: "Meta", result: "Resultado" },
    pending: "pendiente",
    metrics: [
      { id: "voice_top1", label: "Vinculación por voz: el caso correcto aparece primero", target: "80% o más" },
      { id: "voice_top3", label: "Vinculación por voz: el caso correcto está entre los 3 primeros", target: "90% o más" },
      { id: "false_links_per_100", label: "Vínculos incorrectos por cada 100 comparaciones sobre el umbral de revisión", target: "2 como máximo" },
      { id: "identifier_match", label: "Coincidencias exactas de identificadores detectadas", target: "100%" },
      { id: "ficha_accuracy", label: "Campos de la ficha correctos frente a la etiqueta manual", target: "90% o más" },
      { id: "citation_fidelity", label: "Afirmaciones de los agentes con evidencia citada y verificable", target: "100%" },
      { id: "small_stats", label: "Estadísticas territoriales mostradas con menos de 5 casos", target: "0" },
      { id: "infiltrator", label: "Prueba del infiltrado: no recibe ningún vínculo", target: "Pasa" },
    ],
    generatedAt: "Reporte generado el",
    passed: "Pasa",
    failed: "No pasa",
    sample: "muestras",
  },
  pilot: {
    label: "Piloto",
    title: "Solicita un piloto para tu asociación.",
    lead:
      "Blindaje no es una app abierta a cualquiera: llega a las víctimas a través de organizaciones que ya existen y verifican a sus miembros.",
    who: "Gremios de transporte, asociaciones de mototaxistas y de mercados, juntas vecinales y cámaras de comercio distritales. Un piloto empieza con un grupo pequeño de miembros verificados y, antes de tratar datos reales, una revisión legal.",
    fields: {
      org: "Nombre de tu asociación o gremio",
      name: "Tu nombre",
      contact: "Correo o teléfono",
      contactHint: "Para responderte. No lo compartimos.",
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
    },
    errors: {
      org: "Escribe el nombre de tu asociación (al menos 2 letras).",
      name: "Escribe tu nombre (al menos 2 letras).",
      contact: "Escribe un correo o un teléfono para responderte.",
      members: "Escribe solo un número, sin puntos ni comas.",
      summary: "Revisa los campos marcados.",
    },
    verifying: "Verificación anti-spam de Cloudflare",
    verifyingWait: "Aparece cuando empiezas a llenar el formulario.",
    submit: "Enviar solicitud",
    sending: "Enviando…",
    successTitle: "Recibimos tu solicitud.",
    success: "Te escribiremos al contacto que dejaste. Gracias por pensar en tus asociados.",
    fail: "No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo.",
    rateLimited: "Llegaron muchas solicitudes desde tu conexión. Espera unos minutos e inténtalo de nuevo.",
    captcha: "Falta la verificación anti-spam. Espera a que termine de cargar e inténtalo de nuevo.",
    unavailable: "El formulario no está disponible en este momento. Escríbenos desde el repositorio en GitHub.",
    privacy:
      "Usamos estos datos solo para responder tu solicitud. Este formulario no es para denunciar: si estás en peligro, llama al 105.",
  },
  helpSection: {
    label: "Ayuda",
    title: "Si estás en peligro ahora, llama al 105.",
    lines: [
      { number: "105", name: "Policía Nacional del Perú, emergencias", cta: "Llamar al 105" },
      { number: "1818", name: "Línea 1818, Central Única de Denuncias del Mininter", cta: "Llamar a la Línea 1818" },
    ],
    station: "También puedes denunciar en tu comisaría más cercana.",
    note: "No negocies solo. Guarda los audios y los mensajes, y denuncia.",
  },
  footer: {
    hackathon: "Proyecto para el Meta Global AI Developer Hackathon, construido del 26 de octubre al 4 de noviembre de 2026.",
    repo: "Código en GitHub",
    fictitious: "Los datos del demo y de la evaluación son ficticios. Nada de esta página viene de víctimas reales.",
    license: "Código abierto bajo licencia Apache-2.0.",
  },
  notFound: {
    title: "Esta página no está en el cuaderno.",
    text: "Puede que el enlace esté mal escrito.",
    home: "Volver al inicio",
  },
};
