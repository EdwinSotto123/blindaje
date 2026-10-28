/**
 * Datos ficticios del modo simulado. Cuentan la historia de la sección 3 del documento de diseño:
 *
 *   Caso A (bodega, Lima Este): dos audios de voz masculina (V-3), mensaje que exige S/ 2,000 por
 *          Yape en 48 horas y foto del local con una bala.
 *   Caso B (mototaxi, otro distrito): audio desde OTRO número. La huella V-7 coincide con V-3 y el
 *          guion se repite: vínculo VIN-1 (A–B) por voz.
 *   Caso C (mercado): le piden pagar a la MISMA cuenta de Yape que a B (ID-3fa9c1, "…488"):
 *          vínculo VIN-2 (B–C). Al confirmar ambos aparece la red R-001 de tres casos.
 *
 * D y E forman una red previa (R-002, placa repetida) y F es un candidato débil con A (VIN-3),
 * con contradicciones. Todo es ficticio: no hay personas, números ni cuentas reales.
 *
 * Autenticidad (¿hecho con IA?): el audio EV-C2 tiene indicios fuertes de voz sintética (la voz de
 * VIN-2 pesa la mitad) y la foto de la bala EV-F2 tiene indicios fuertes de estar generada con IA
 * (VIN-3). EV-B3 tiene indicios débiles; el resto, sin señales.
 *
 * Prompt Guard: el mensaje pegado EV-C1 trae una instrucción plantada para los modelos (marcado como
 * posible inyección); EV-D1 quedó sin revisar.
 */
import type {
  AlertView,
  AudioFragment,
  CaseSide,
  FichaStored,
  GraphEdge,
  GraphNode,
  LinkView,
  OrgView,
  ProfileView,
  PromptGuardResult,
  ResultadoAutenticidad,
  TimelineEvent,
  UserView,
} from "../api/types";

/** Huella SHA-256 ficticia y estable (64 hex) a partir de una etiqueta. */
export function fakeSha256(seed: string): string {
  let h1 = 0x811c9dc5;
  let out = "";
  for (let round = 0; out.length < 64; round++) {
    for (const ch of `${seed}#${round}`) {
      h1 ^= ch.charCodeAt(0);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    out += h1.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

// ---------------------------------------------------------------------------
// Organizaciones y usuarios
// ---------------------------------------------------------------------------

export const ORGS: OrgView[] = [
  { id: "org-bodegas", name: "Asociación de Bodegueros de Lima Este (ficticia)", kind: "gremio", district: "Lima Este", created_at: "2026-10-26T15:00:00Z", is_demo: true, devices: 3, users: 1 },
  { id: "org-mototaxi", name: "Gremio de Mototaxistas Unidos (ficticio)", kind: "gremio", district: "Lima Este", created_at: "2026-10-26T15:05:00Z", is_demo: true, devices: 1, users: 0 },
  { id: "org-mercado", name: "Asociación del Mercado Central (ficticia)", kind: "asociacion_mercado", district: "Lima Centro", created_at: "2026-10-26T15:10:00Z", is_demo: true, devices: 2, users: 0 },
  { id: "org-alianza", name: "Alianza Blindaje (demo)", kind: "alianza", district: null, created_at: "2026-10-26T14:50:00Z", is_demo: true, devices: 0, users: 2 },
];

export const DEMO_PASSWORD = "demo-blindaje";

export const USERS: UserView[] = [
  {
    id: "usr-revisora",
    email: "revisora@demo.blindaje.pe",
    display_name: "Revisora Demo",
    role: "reviewer",
    org: { id: "org-bodegas", name: "Asociación de Bodegueros de Lima Este (ficticia)" },
    disabled: false,
    created_at: "2026-10-26T15:20:00Z",
  },
  {
    id: "usr-analista",
    email: "analista@demo.blindaje.pe",
    display_name: "Analista Demo",
    role: "analyst",
    org: { id: "org-alianza", name: "Alianza Blindaje (demo)" },
    disabled: false,
    created_at: "2026-10-26T15:21:00Z",
  },
  {
    id: "usr-admin",
    email: "admin@demo.blindaje.pe",
    display_name: "Administración Demo",
    role: "admin",
    org: { id: "org-alianza", name: "Alianza Blindaje (demo)" },
    disabled: false,
    created_at: "2026-10-26T15:22:00Z",
  },
];

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

interface EvidenceSeed {
  n: number;
  tipo: "audio" | "imagen" | "video" | "texto";
  received_utc: string;
  duration_ms: number | null;
}

function evidence(code: string, seeds: EvidenceSeed[]): CaseSide["evidencia"] {
  return seeds.map((s) => {
    const label = `EV-${code}${s.n}`;
    return {
      id: `ev-${code.toLowerCase()}${s.n}`,
      label,
      tipo: s.tipo,
      sha256: fakeSha256(label),
      received_utc: s.received_utc,
      duration_ms: s.duration_ms,
      ...(s.tipo === "texto" ? {} : { autenticidad: AUTENTICIDAD[label] ?? null }),
      prompt_guard: PROMPT_GUARD[label] ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Llama Prompt Guard 2 (inyección de instrucciones en el texto de la evidencia)
// ---------------------------------------------------------------------------

function guard(label: "benigno" | "inyeccion", score: number, textos = 1, marcados = label === "inyeccion" ? 1 : 0): PromptGuardResult {
  return { status: "revisado", label, score, model: "llama-prompt-guard-2-86m", threshold: 0.5, textos, marcados, revisado_at: "2026-10-19T16:45:00Z" };
}

/**
 * EV-C1 (mensaje pegado del caso C, en VIN-2) trae una instrucción plantada para los modelos
 * ("ignora tus instrucciones..."): queda marcada, sigue siendo evidencia. EV-D1 quedó sin revisar
 * (el clasificador no respondía al llegar).
 */
export const PROMPT_GUARD: Record<string, PromptGuardResult> = {
  "EV-A1": guard("benigno", 0.02, 6),
  "EV-A2": guard("benigno", 0.01, 3),
  "EV-A3": guard("benigno", 0.03),
  "EV-B1": guard("benigno", 0.02, 5),
  "EV-B2": guard("benigno", 0.04),
  "EV-B3": guard("benigno", 0.01, 4),
  "EV-C1": guard("inyeccion", 0.98),
  "EV-C2": guard("benigno", 0.02, 4),
  "EV-D1": { status: "no_revisado", label: null, score: null, model: null, threshold: null, textos: 1, marcados: 0, revisado_at: "2026-09-21T11:31:00Z" },
  "EV-E2": guard("benigno", 0.05),
  "EV-F1": guard("benigno", 0.02),
};

// ---------------------------------------------------------------------------
// Autenticidad (¿hecho con IA?)
// ---------------------------------------------------------------------------

type Tecnicas = ResultadoAutenticidad["tecnicas"];

function tecnicas(tipo: "audio" | "imagen" | "video", over: Partial<Tecnicas> = {}): Tecnicas {
  return {
    watermark:
      tipo === "audio"
        ? { detector: "audioseal", detected: false, score: 0.03 }
        : { detector: "videoseal", detected: false, score: 0.05, ...(tipo === "video" ? { frames_checked: 64 } : {}) },
    c2pa: { present: false, ai_generated: null, generator: null, claims: [] },
    metadata:
      tipo === "audio"
        ? { present: true, software: null, digital_source_type: null, suspicious: [], fields: { codec: "opus", canales: "1" } }
        : tipo === "video"
          ? { present: true, software: null, digital_source_type: null, suspicious: [], fields: { codec: "h264", creation_time: "2026-09-25" } }
          : { present: true, software: null, digital_source_type: null, suspicious: [], fields: { Make: "(celular)", DateTimeOriginal: "2026:10:06 16:52" } },
    synthetic_speech: tipo === "audio" ? { detector: "ninguno", score: 0, available: false } : null,
    ...over,
  };
}

function limpio(label: string, tipo: "audio" | "imagen" | "video", explicacion: string, analizado_at: string): ResultadoAutenticidad {
  return {
    evidence_label: label,
    tipo,
    nivel: "sin_senales",
    tecnicas: tecnicas(tipo),
    forense: {
      nivel: "sin_senales",
      senales: [],
      explicacion,
      limitaciones:
        tipo === "audio"
          ? "El audio llegó comprimido por WhatsApp: este análisis no descarta una voz sintética de buena calidad."
          : "La compresión al reenviar borra rastros finos; este análisis no descarta una edición cuidadosa.",
    },
    model: tipo === "audio" ? "muse-spark-1.2" : "muse-spark-1.3",
    analizado_at,
  };
}

export const AUTENTICIDAD: Record<string, ResultadoAutenticidad> = {
  "EV-A1": limpio("EV-A1", "audio", "La voz tiene respiración, pausas y ruido de calle coherentes entre sí. No se oyen señales de una voz generada.", "2026-10-04T00:41:30Z"),
  "EV-A2": limpio("EV-A2", "audio", "Voz con respiración y fondo continuo; no se observan cortes ni un timbre metálico.", "2026-10-06T22:06:20Z"),
  "EV-A4": limpio("EV-A4", "imagen", "Sombras, reflejos y el texto de la nota son coherentes con una foto tomada con celular.", "2026-10-06T21:59:10Z"),
  "EV-B1": limpio("EV-B1", "audio", "La voz y el ruido de fondo son continuos; no hay señales de generación.", "2026-10-11T13:16:40Z"),
  "EV-B3": {
    evidence_label: "EV-B3",
    tipo: "audio",
    nivel: "indicios_debiles",
    tecnicas: tecnicas("audio"),
    forense: {
      nivel: "indicios_debiles",
      senales: [{ fuente: "analisis_audio", descripcion: "Un corte abrupto a los 14 segundos, podría ser un empalme", peso: "debil" }],
      explicacion: "Hay un corte abrupto que podría ser un empalme o una pausa de la grabación. El resto de la voz suena natural.",
      limitaciones: "Un corte también aparece al pausar la grabación en WhatsApp; no basta para decir que el audio fue editado.",
    },
    model: "muse-spark-1.2",
    analizado_at: "2026-10-13T15:03:10Z",
  },
  "EV-C2": {
    evidence_label: "EV-C2",
    tipo: "audio",
    nivel: "indicios_fuertes",
    tecnicas: tecnicas("audio", {
      watermark: { detector: "audioseal", detected: false, score: 0.11 },
      metadata: { present: false, software: null, digital_source_type: null, suspicious: [], fields: {} },
    }),
    forense: {
      nivel: "indicios_fuertes",
      senales: [
        { fuente: "analisis_audio", descripcion: "Entonación demasiado uniforme y sin respiración entre frases", peso: "fuerte" },
        { fuente: "analisis_audio", descripcion: "El ruido de fondo desaparece en seco entre palabras", peso: "fuerte" },
        { fuente: "metadatos", descripcion: "El archivo no trae datos de la grabación", peso: "debil" },
      ],
      explicacion:
        "La voz podría ser sintética: la entonación es plana, no se oye respiración y el fondo se corta entre palabras, lo que sugiere un texto leído por un generador de voz.",
      limitaciones: "Sin marca de agua no se puede confirmar que sea una voz hecha con IA; una grabación muy limpia o procesada podría sonar parecido.",
    },
    model: "muse-spark-1.2",
    analizado_at: "2026-10-19T16:41:50Z",
  },
  "EV-D2": limpio("EV-D2", "video", "Movimiento, sombras y desenfoque coherentes entre cuadros; la placa se lee igual en todo el recorrido.", "2026-09-25T12:02:00Z"),
  "EV-E1": limpio("EV-E1", "video", "La moto y el fondo se mueven de forma coherente; no se observan empalmes.", "2026-09-30T12:11:30Z"),
  "EV-F2": {
    evidence_label: "EV-F2",
    tipo: "imagen",
    nivel: "indicios_fuertes",
    tecnicas: tecnicas("imagen", {
      metadata: { present: false, software: null, digital_source_type: null, suspicious: ["sin datos de cámara ni fecha de captura"], fields: {} },
    }),
    forense: {
      nivel: "indicios_fuertes",
      senales: [
        { fuente: "analisis_visual", descripcion: "La sombra de la bala va en otra dirección que la del resto de la mesa", peso: "fuerte" },
        { fuente: "analisis_visual", descripcion: "Textura del metal demasiado lisa y bordes que se funden con el fondo", peso: "fuerte" },
        { fuente: "metadatos", descripcion: "Sin datos de cámara ni fecha de captura", peso: "debil" },
      ],
      explicacion:
        "La foto podría estar generada con IA: la sombra de la bala no coincide con la luz de la escena y la textura del metal es demasiado uniforme.",
      limitaciones: "Sin marca de agua ni C2PA no se puede confirmar. Una foto reenviada por WhatsApp también pierde los datos de cámara.",
    },
    model: "muse-spark-1.3",
    analizado_at: "2026-10-16T01:03:40Z",
  },
};

const FICHA_A: FichaStored = {
  caso: "A",
  sector: "bodega",
  zona: "Lima Este - E12",
  primer_contacto: "2026-10-03T19:40:00-05:00",
  tipo_amenaza: "dano_local",
  amenaza: "Daño al local si no paga",
  monto_soles: 2000,
  periodicidad: "unico",
  plazo: "48 horas",
  plazo_horas: 48,
  canal_pago: "yape",
  identificadores: [
    { ref: "ID-7c41e2", tipo: "telefono", rol: "contacto", ultimos_3: "131", evidencia: ["EV-A1", "EV-A3"] },
    { ref: "ID-5d0a77", tipo: "cuenta_yape", rol: "cobro", ultimos_3: "215", evidencia: ["EV-A3"] },
  ],
  grupo_que_dice_ser: "Los X",
  frases_firma: ["habla con el jefe", "no llames a la policía", "tienes 48 horas"],
  escalamiento: [{ fecha: "2026-10-06", tipo: "foto del local con bala", evidencia: ["EV-A4"] }],
  resumen_mo: "Voz masculina por audio, foto del local como intimidación, pago por Yape con plazo de 48 horas.",
  fuentes: ["EV-A1", "EV-A2", "EV-A3", "EV-A4"],
};

const FICHA_B: FichaStored = {
  caso: "B",
  sector: "mototaxi",
  zona: "Lima Este - E19",
  primer_contacto: "2026-10-11T08:15:00-05:00",
  tipo_amenaza: "dano_vehiculo",
  amenaza: "Daño a la mototaxi y al conductor",
  monto_soles: 500,
  periodicidad: "semanal",
  plazo: "48 horas",
  plazo_horas: 48,
  canal_pago: "yape",
  identificadores: [
    { ref: "ID-b20d5f", tipo: "telefono", rol: "contacto", ultimos_3: "904", evidencia: ["EV-B1"] },
    { ref: "ID-3fa9c1", tipo: "cuenta_yape", rol: "cobro", ultimos_3: "488", evidencia: ["EV-B2"] },
  ],
  grupo_que_dice_ser: "Los X",
  frases_firma: ["habla con el jefe", "no llames a la policía"],
  escalamiento: [],
  resumen_mo: "Audio de voz masculina desde un número nuevo, cupo semanal por Yape con plazo de 48 horas.",
  fuentes: ["EV-B1", "EV-B2", "EV-B3"],
};

const FICHA_C: FichaStored = {
  caso: "C",
  sector: "mercado",
  zona: "Lima Centro - C04",
  primer_contacto: "2026-10-18T10:05:00-05:00",
  tipo_amenaza: "dano_local",
  amenaza: "Daño al puesto del mercado",
  monto_soles: 3000,
  periodicidad: "unico",
  plazo: "72 horas",
  plazo_horas: 72,
  canal_pago: "yape",
  identificadores: [
    { ref: "ID-e81c40", tipo: "telefono", rol: "contacto", ultimos_3: "377", evidencia: ["EV-C1"] },
    { ref: "ID-3fa9c1", tipo: "cuenta_yape", rol: "cobro", ultimos_3: "488", evidencia: ["EV-C1"] },
  ],
  grupo_que_dice_ser: "Los X",
  frases_firma: ["habla con el jefe", "ya sabemos dónde trabajas"],
  escalamiento: [],
  resumen_mo: "Mensaje con cuenta de Yape para el pago y audio de seguimiento; dice ser de \"Los X\".",
  fuentes: ["EV-C1", "EV-C2"],
};

const FICHA_D: FichaStored = {
  caso: "D",
  sector: "transporte",
  zona: "Lima Norte - N03",
  primer_contacto: "2026-09-21T06:30:00-05:00",
  tipo_amenaza: "dano_vehiculo",
  amenaza: "Daño a la unidad de transporte",
  monto_soles: 800,
  periodicidad: "semanal",
  plazo: "una semana",
  plazo_horas: 168,
  canal_pago: "efectivo",
  identificadores: [{ ref: "ID-a4419b", tipo: "placa", rol: "vehiculo", ultimos_3: "947", evidencia: ["EV-D2"] }],
  grupo_que_dice_ser: null,
  frases_firma: ["te estamos siguiendo"],
  escalamiento: [{ fecha: "2026-09-25", tipo: "seguimiento en moto", evidencia: ["EV-D2"] }],
  resumen_mo: "Seguimiento en moto y cobro semanal en efectivo a conductores de transporte.",
  fuentes: ["EV-D1", "EV-D2"],
};

const FICHA_E: FichaStored = {
  caso: "E",
  sector: "transporte",
  zona: "Lima Norte - N05",
  primer_contacto: "2026-09-29T07:10:00-05:00",
  tipo_amenaza: "dano_fisico",
  amenaza: "Daño físico al conductor",
  monto_soles: 800,
  periodicidad: "semanal",
  plazo: "una semana",
  plazo_horas: 168,
  canal_pago: "efectivo",
  identificadores: [{ ref: "ID-a4419b", tipo: "placa", rol: "vehiculo", ultimos_3: "947", evidencia: ["EV-E1"] }],
  grupo_que_dice_ser: null,
  frases_firma: ["te estamos siguiendo"],
  escalamiento: [{ fecha: "2026-09-30", tipo: "seguimiento en moto", evidencia: ["EV-E1"] }],
  resumen_mo: "Video de una moto que sigue la unidad; cobro semanal en efectivo.",
  fuentes: ["EV-E1", "EV-E2"],
};

const FICHA_F: FichaStored = {
  caso: "F",
  sector: "bodega",
  zona: "Lima Este - E14",
  primer_contacto: "2026-10-15T20:00:00-05:00",
  tipo_amenaza: "dano_local",
  amenaza: "Daño al local",
  monto_soles: 1000,
  periodicidad: "unico",
  plazo: "24 horas",
  plazo_horas: 24,
  canal_pago: "efectivo",
  identificadores: [],
  grupo_que_dice_ser: null,
  frases_firma: ["paga o atente a las consecuencias"],
  escalamiento: [{ fecha: "2026-10-15", tipo: "foto de una bala", evidencia: ["EV-F2"] }],
  resumen_mo: "Mensaje escrito con foto de una bala; pide pago en efectivo en 24 horas.",
  fuentes: ["EV-F1", "EV-F2"],
};

export const CASES: Record<string, CaseSide> = {
  A: {
    id: "case-a",
    code: "A",
    sector: "bodega",
    zona: "Lima Este - E12",
    primer_contacto: FICHA_A.primer_contacto,
    ficha: FICHA_A,
    evidencia: evidence("A", [
      { n: 1, tipo: "audio", received_utc: "2026-10-04T00:40:00Z", duration_ms: 42_000 },
      { n: 2, tipo: "audio", received_utc: "2026-10-06T22:05:00Z", duration_ms: 18_000 },
      { n: 3, tipo: "texto", received_utc: "2026-10-04T14:12:00Z", duration_ms: null },
      { n: 4, tipo: "imagen", received_utc: "2026-10-06T21:58:00Z", duration_ms: null },
    ]),
  },
  B: {
    id: "case-b",
    code: "B",
    sector: "mototaxi",
    zona: "Lima Este - E19",
    primer_contacto: FICHA_B.primer_contacto,
    ficha: FICHA_B,
    evidencia: evidence("B", [
      { n: 1, tipo: "audio", received_utc: "2026-10-11T13:15:00Z", duration_ms: 35_000 },
      { n: 2, tipo: "texto", received_utc: "2026-10-11T13:20:00Z", duration_ms: null },
      { n: 3, tipo: "audio", received_utc: "2026-10-13T15:02:00Z", duration_ms: 22_000 },
    ]),
  },
  C: {
    id: "case-c",
    code: "C",
    sector: "mercado",
    zona: "Lima Centro - C04",
    primer_contacto: FICHA_C.primer_contacto,
    ficha: FICHA_C,
    evidencia: evidence("C", [
      { n: 1, tipo: "texto", received_utc: "2026-10-18T15:05:00Z", duration_ms: null },
      { n: 2, tipo: "audio", received_utc: "2026-10-19T16:40:00Z", duration_ms: 27_000 },
    ]),
  },
  D: {
    id: "case-d",
    code: "D",
    sector: "transporte",
    zona: "Lima Norte - N03",
    primer_contacto: FICHA_D.primer_contacto,
    ficha: FICHA_D,
    evidencia: evidence("D", [
      { n: 1, tipo: "texto", received_utc: "2026-09-21T11:30:00Z", duration_ms: null },
      { n: 2, tipo: "video", received_utc: "2026-09-25T12:00:00Z", duration_ms: 14_000 },
    ]),
  },
  E: {
    id: "case-e",
    code: "E",
    sector: "transporte",
    zona: "Lima Norte - N05",
    primer_contacto: FICHA_E.primer_contacto,
    ficha: FICHA_E,
    evidencia: evidence("E", [
      { n: 1, tipo: "video", received_utc: "2026-09-30T12:10:00Z", duration_ms: 11_000 },
      { n: 2, tipo: "texto", received_utc: "2026-09-29T12:10:00Z", duration_ms: null },
    ]),
  },
  F: {
    id: "case-f",
    code: "F",
    sector: "bodega",
    zona: "Lima Este - E14",
    primer_contacto: FICHA_F.primer_contacto,
    ficha: FICHA_F,
    evidencia: evidence("F", [
      { n: 1, tipo: "texto", received_utc: "2026-10-16T01:00:00Z", duration_ms: null },
      { n: 2, tipo: "imagen", received_utc: "2026-10-16T01:02:00Z", duration_ms: null },
    ]),
  },
};

/** Transcripciones (ficticias) de los fragmentos relevantes. */
function fragment(
  evidenceLabel: string,
  voice: string,
  start_ms: number,
  end_ms: number,
  text: string,
): AudioFragment {
  const id = `ev-${evidenceLabel.slice(3).toLowerCase()}`;
  return {
    evidence_label: evidenceLabel,
    evidence_id: id,
    voice_label: voice,
    start_ms,
    end_ms,
    text,
    media_url: `/v1/console/evidence/${id}/media?start_ms=${start_ms}&end_ms=${end_ms}`,
  };
}

export const FRAGMENTS = {
  A1: fragment("EV-A1", "V-3", 3_200, 9_800, "Habla con el jefe, ¿ya? Y no llames a la policía."),
  A2: fragment("EV-A2", "V-3", 1_000, 6_500, "Tienes 48 horas. No te hagas el que no sabe."),
  B1: fragment("EV-B1", "V-7", 2_500, 9_000, "Habla con el jefe nomás. Y no llames a la policía, ¿me escuchas?"),
  B3: fragment("EV-B3", "V-7", 4_000, 8_200, "El jefe dice que el plazo ya corre."),
  C2: fragment("EV-C2", "V-9", 1_200, 7_400, "Habla con el jefe. El depósito va a la cuenta que te mandamos."),
};

// ---------------------------------------------------------------------------
// Vínculos
// ---------------------------------------------------------------------------

export function initialLinks(): LinkView[] {
  return [
    {
      id: "link-1",
      label: "VIN-1",
      status: "probable",
      score: 0.91,
      score_raw: 0.904,
      signals: {
        voz: {
          p: 0.84,
          similitud: 0.74,
          z: 3.6,
          segmentos: 4,
          segmentos_total: 5,
          huellas: ["V-3", "V-7"],
          evidencia: ["EV-A1", "EV-A2", "EV-B1"],
        },
        modus_operandi: {
          p: 0.4,
          similitud_texto: 0.89,
          frases_comunes: ["habla con el jefe", "no llames a la policía"],
          mismo_canal_pago: true,
          mismo_grupo: true,
        },
      },
      vinculador: {
        puntaje_ajustado: 0.91,
        recomendacion: "probable",
        explicacion:
          "Posible vínculo A–B (0.91). La voz de EV-B1 se parece a la de EV-A1 y EV-A2 en 4 de 5 segmentos (V-3, V-7). Ambas fichas repiten \"habla con el jefe\" y \"no llames a la policía\" y piden pago por Yape con plazo de 48 horas (FICHA-A, FICHA-B). Los números de contacto son distintos (ID-7c41e2, ID-b20d5f).",
        afirmaciones: [
          { texto: "La voz del audio B1 coincide con la de A1 y A2 en 4 de 5 segmentos de al menos 3 segundos.", evidencia: ["V-3", "V-7", "EV-A1", "EV-A2", "EV-B1"] },
          { texto: "Los dos guiones repiten \"habla con el jefe\" y \"no llames a la policía\".", evidencia: ["FICHA-A", "FICHA-B", "EV-A1", "EV-B1"] },
          { texto: "Ambos casos piden pago por Yape con plazo de 48 horas y dicen ser de \"Los X\".", evidencia: ["EV-A3", "EV-B2"] },
        ],
        contradicciones: [
          { texto: "Los números de contacto son distintos.", evidencia: ["ID-7c41e2", "ID-b20d5f"] },
          { texto: "Las cuentas de cobro también son distintas.", evidencia: ["ID-5d0a77", "ID-3fa9c1"] },
        ],
      },
      vinculador_valid: true,
      case_a: CASES.A!,
      case_b: CASES.B!,
      fragments: [FRAGMENTS.A1, FRAGMENTS.A2, FRAGMENTS.B1, FRAGMENTS.B3],
      created_at: "2026-10-13T16:10:00Z",
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
    },
    {
      id: "link-2",
      label: "VIN-2",
      status: "probable",
      score: 0.95,
      score_raw: 0.966,
      signals: {
        identificador: {
          p: 0.95,
          compartidos: [{ ref: "ID-3fa9c1", tipo: "cuenta_yape", ultimos_3: "488", evidencia: ["EV-B2", "EV-C1"] }],
        },
        voz: {
          p: 0.08,
          similitud: 0.31,
          z: 0.4,
          segmentos: 0,
          segmentos_total: 4,
          huellas: ["V-7", "V-9"],
          evidencia: ["EV-B1", "EV-C2"],
          voz_sintetica: { evidencia: ["EV-C2"], factor: 0.5, p_sin_ajuste: 0.16 },
        },
        modus_operandi: {
          p: 0.25,
          similitud_texto: 0.81,
          frases_comunes: ["habla con el jefe"],
          mismo_canal_pago: true,
          mismo_grupo: true,
        },
      },
      vinculador: {
        puntaje_ajustado: 0.95,
        recomendacion: "probable",
        explicacion:
          "La cuenta de Yape ID-3fa9c1 aparece como cuenta de cobro en EV-B2 y EV-C1. Ambos casos dicen ser de \"Los X\" y repiten \"habla con el jefe\" (FICHA-B, FICHA-C). La voz de EV-C2 no se parece a la de B (V-7, V-9): podría hablar otra persona de la misma estructura, o una voz sintética, porque EV-C2 tiene indicios de haber sido generado con IA.",
        afirmaciones: [
          { texto: "La misma cuenta de Yape recibe los pagos en los dos casos.", evidencia: ["ID-3fa9c1", "EV-B2", "EV-C1"] },
          { texto: "Los dos casos dicen ser de \"Los X\" y repiten \"habla con el jefe\".", evidencia: ["FICHA-B", "FICHA-C", "EV-B1", "EV-C2"] },
        ],
        contradicciones: [{ texto: "Las voces de B y C no coinciden.", evidencia: ["V-7", "V-9", "EV-C2"] }],
      },
      vinculador_valid: true,
      case_a: CASES.B!,
      case_b: CASES.C!,
      fragments: [FRAGMENTS.B1, FRAGMENTS.C2],
      created_at: "2026-10-19T17:02:00Z",
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
    },
    {
      id: "link-3",
      label: "VIN-3",
      status: "por_revisar",
      score: 0.62,
      score_raw: 0.663,
      signals: {
        imagen: {
          p: 0.55,
          hamming_min: 14,
          dino_max: 0.83,
          recortes: ["IMG-1", "IMG-5"],
          evidencia: ["EV-A4", "EV-F2"],
        },
        modus_operandi: {
          p: 0.25,
          similitud_texto: 0.71,
          frases_comunes: [],
          mismo_canal_pago: false,
          mismo_grupo: false,
        },
      },
      vinculador: {
        puntaje_ajustado: 0.62,
        recomendacion: "por_revisar",
        explicacion:
          "Las fotos de una bala de EV-A4 y EV-F2 son parecidas (IMG-1, IMG-5), pero no idénticas. F pide pago en efectivo y no dice ser de \"Los X\" (FICHA-F). La similitud visual sola no basta: revisa si es la misma plantilla. EV-F2 tiene indicios de haber sido generada con IA.",
        afirmaciones: [{ texto: "Los recortes de la bala tienen similitud visual alta (DINOv2 0.83).", evidencia: ["IMG-1", "IMG-5", "EV-A4", "EV-F2"] }],
        contradicciones: [
          { texto: "F pide pago en efectivo y no dice ser de \"Los X\".", evidencia: ["FICHA-F", "EV-F1"] },
          { texto: "Las fotos no son idénticas: distancia de Hamming 14.", evidencia: ["IMG-1", "IMG-5"] },
        ],
      },
      vinculador_valid: true,
      case_a: CASES.A!,
      case_b: CASES.F!,
      fragments: [],
      created_at: "2026-10-16T02:30:00Z",
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
    },
    {
      id: "link-4",
      label: "VIN-4",
      status: "confirmado",
      score: 0.95,
      score_raw: 0.95,
      signals: {
        identificador: {
          p: 0.95,
          compartidos: [{ ref: "ID-a4419b", tipo: "placa", ultimos_3: "947", evidencia: ["EV-D2", "EV-E1"] }],
        },
      },
      vinculador: {
        puntaje_ajustado: 0.95,
        recomendacion: "probable",
        explicacion: "La misma placa ID-a4419b aparece en los videos de seguimiento EV-D2 y EV-E1. Ambos casos usan la frase \"te estamos siguiendo\" (FICHA-D, FICHA-E).",
        afirmaciones: [{ texto: "La misma placa aparece en los dos videos.", evidencia: ["ID-a4419b", "EV-D2", "EV-E1"] }],
        contradicciones: [],
      },
      vinculador_valid: true,
      case_a: CASES.D!,
      case_b: CASES.E!,
      fragments: [],
      created_at: "2026-09-30T13:00:00Z",
      reviewed_by: "Analista Demo",
      reviewed_at: "2026-10-01T15:30:00Z",
      review_note: "Placa legible en ambos videos.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Redes (grafo)
// ---------------------------------------------------------------------------

interface CaseGraphSeed {
  code: string;
  voices: { label: string; huellas: string[]; segmentos: number; evidencia: string[] }[];
  phrases: string[];
  images: { label: string; evidencia: string; descripcion: string }[];
}

const GRAPH_SEEDS: Record<string, CaseGraphSeed> = {
  A: {
    code: "A",
    voices: [{ label: "V-3", huellas: ["V-3"], segmentos: 6, evidencia: ["EV-A1", "EV-A2"] }],
    phrases: ["habla con el jefe", "no llames a la policía"],
    images: [{ label: "IMG-1", evidencia: "EV-A4", descripcion: "Recorte: bala sobre el mostrador" }],
  },
  B: {
    code: "B",
    voices: [{ label: "V-3", huellas: ["V-7"], segmentos: 5, evidencia: ["EV-B1", "EV-B3"] }],
    phrases: ["habla con el jefe", "no llames a la policía"],
    images: [],
  },
  C: {
    code: "C",
    voices: [{ label: "V-9", huellas: ["V-9"], segmentos: 3, evidencia: ["EV-C2"] }],
    phrases: ["habla con el jefe"],
    images: [],
  },
  D: {
    code: "D",
    voices: [],
    phrases: ["te estamos siguiendo"],
    images: [{ label: "IMG-8", evidencia: "EV-D2", descripcion: "Recorte: moto de seguimiento" }],
  },
  E: {
    code: "E",
    voices: [],
    phrases: ["te estamos siguiendo"],
    images: [],
  },
};

export interface GraphBuild {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timeline: (TimelineEvent & { caso: string })[];
}

/** Construye nodos, aristas y línea de tiempo para un conjunto de casos y vínculos confirmados. */
export function buildGraph(caseCodes: string[], links: LinkView[]): GraphBuild {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addEdge = (source: string, target: string, label?: string) => {
    const id = `e-${source}-${target}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, type: "senal", ...(label ? { label } : {}) });
  };

  for (const code of caseCodes) {
    const c = CASES[code];
    if (!c) continue;
    const caseNode = `case-${code.toLowerCase()}`;
    nodes.set(caseNode, {
      id: caseNode,
      type: "caso",
      label: `Caso ${code}`,
      data: { code, sector: c.sector, zona: c.zona, primer_contacto: c.primer_contacto, evidencia: c.evidencia.map((e) => e.label) },
    });
    const seed = GRAPH_SEEDS[code];
    for (const v of seed?.voices ?? []) {
      const id = `voz-${v.label}`;
      const prev = nodes.get(id);
      const huellas = new Set([...((prev?.data?.huellas as string[] | undefined) ?? []), ...v.huellas]);
      const casos = new Set([...((prev?.data?.casos as string[] | undefined) ?? []), code]);
      const ev = new Set([...((prev?.data?.evidencia as string[] | undefined) ?? []), ...v.evidencia]);
      const segs = ((prev?.data?.segmentos as number | undefined) ?? 0) + v.segmentos;
      nodes.set(id, { id, type: "voz", label: v.label, data: { huellas: [...huellas], casos: [...casos], segmentos: segs, evidencia: [...ev] } });
      addEdge(caseNode, id, "voz");
    }
    for (const ident of c.ficha?.identificadores ?? []) {
      const id = `ident-${ident.ref}`;
      const prev = nodes.get(id);
      const casos = new Set([...((prev?.data?.casos as string[] | undefined) ?? []), code]);
      const ev = new Set([...((prev?.data?.evidencia as string[] | undefined) ?? []), ...ident.evidencia]);
      nodes.set(id, {
        id,
        type: "identificador",
        label: ident.ref,
        data: { tipo: ident.tipo, rol: ident.rol, ultimos_3: ident.ultimos_3, casos: [...casos], evidencia: [...ev] },
      });
      addEdge(caseNode, id, ident.rol);
    }
    for (const phrase of seed?.phrases ?? []) {
      const id = `frase-${phrase.replace(/\s+/g, "-")}`;
      const prev = nodes.get(id);
      const casos = new Set([...((prev?.data?.casos as string[] | undefined) ?? []), code]);
      nodes.set(id, { id, type: "frase", label: phrase, data: { texto: phrase, casos: [...casos] } });
      addEdge(caseNode, id, "frase");
    }
    for (const img of seed?.images ?? []) {
      const id = `img-${img.label}`;
      nodes.set(id, { id, type: "imagen", label: img.label, data: { evidencia: [img.evidencia], descripcion: img.descripcion, casos: [code] } });
      addEdge(caseNode, id, "imagen");
    }
  }

  for (const l of links) {
    const a = `case-${l.case_a.code.toLowerCase()}`;
    const b = `case-${l.case_b.code.toLowerCase()}`;
    if (nodes.has(a) && nodes.has(b)) {
      edges.push({ id: `e-${l.label}`, source: a, target: b, type: "vinculo", label: l.label, weight: l.score });
    }
  }

  const timeline = TIMELINE.filter((t) => caseCodes.includes(t.caso)).sort((x, y) => x.fecha.localeCompare(y.fecha));
  return { nodes: [...nodes.values()], edges, timeline };
}

export const TIMELINE: (TimelineEvent & { caso: string })[] = [
  { fecha: "2026-10-03T19:40:00-05:00", caso: "A", texto: "Primer audio: voz masculina dice ser de \"Los X\".", evidencia: ["EV-A1"] },
  { fecha: "2026-10-04T09:12:00-05:00", caso: "A", texto: "Mensaje: exige S/ 2,000 por Yape en 48 horas.", evidencia: ["EV-A3"] },
  { fecha: "2026-10-06T16:58:00-05:00", caso: "A", texto: "Foto del local con una bala encima.", evidencia: ["EV-A4"] },
  { fecha: "2026-10-06T17:05:00-05:00", caso: "A", texto: "Segundo audio: \"tienes 48 horas\".", evidencia: ["EV-A2"] },
  { fecha: "2026-10-11T08:15:00-05:00", caso: "B", texto: "Audio desde otro número con la misma voz.", evidencia: ["EV-B1"] },
  { fecha: "2026-10-11T08:20:00-05:00", caso: "B", texto: "Mensaje con la cuenta de Yape para el cupo semanal.", evidencia: ["EV-B2"] },
  { fecha: "2026-10-13T10:02:00-05:00", caso: "B", texto: "Segundo audio: el plazo ya corre.", evidencia: ["EV-B3"] },
  { fecha: "2026-10-18T10:05:00-05:00", caso: "C", texto: "Mensaje con la misma cuenta de Yape que en B.", evidencia: ["EV-C1"] },
  { fecha: "2026-10-19T11:40:00-05:00", caso: "C", texto: "Audio de seguimiento con otra voz.", evidencia: ["EV-C2"] },
  { fecha: "2026-09-21T06:30:00-05:00", caso: "D", texto: "Mensaje: cobro semanal en efectivo.", evidencia: ["EV-D1"] },
  { fecha: "2026-09-25T07:00:00-05:00", caso: "D", texto: "Video: una moto sigue la unidad.", evidencia: ["EV-D2"] },
  { fecha: "2026-09-29T07:10:00-05:00", caso: "E", texto: "Mensaje: \"te estamos siguiendo\".", evidencia: ["EV-E2"] },
  { fecha: "2026-09-30T07:10:00-05:00", caso: "E", texto: "Video: la misma moto, placa legible.", evidencia: ["EV-E1"] },
];

// ---------------------------------------------------------------------------
// Perfiles del Cartógrafo
// ---------------------------------------------------------------------------

export function profileForR001(id: string, model: string, createdAt: string, nCases: number): ProfileView {
  const threeCases = nCases >= 3;
  const hechos = [
    { texto: "La huella V-3 aparece en los casos A y B, con números de contacto distintos.", evidencia: ["V-3", "VIN-1", "EV-A1", "EV-B1"] },
    ...(threeCases
      ? [
          { texto: "La cuenta ID-3fa9c1 aparece como cuenta de cobro en los casos B y C.", evidencia: ["ID-3fa9c1", "VIN-2", "EV-B2", "EV-C1"] },
          { texto: "Los tres casos repiten la frase \"habla con el jefe\" y dicen ser de \"Los X\".", evidencia: ["FICHA-A", "FICHA-B", "FICHA-C"] },
          { texto: "La voz del caso C (V-9) no coincide con V-3.", evidencia: ["V-9", "EV-C2"] },
        ]
      : []),
    { texto: "En el caso A, la foto del local con una bala llegó 3 días después del primer contacto.", evidencia: ["EV-A1", "EV-A4"] },
  ];
  const hipotesis = [
    { texto: "V-3 podría ser la voz de quien realiza las llamadas de la red.", confianza: "alta" as const, evidencia: ["V-3", "EV-A1", "EV-A2", "EV-B1"] },
    { texto: "La red parece cambiar de número de contacto entre víctimas para evitar bloqueos.", confianza: "media" as const, evidencia: ["ID-7c41e2", "ID-b20d5f", "VIN-1"] },
    ...(threeCases
      ? [
          { texto: "ID-3fa9c1 podría ser una cuenta recaudadora de la red.", confianza: "media" as const, evidencia: ["ID-3fa9c1", "EV-B2", "EV-C1"] },
          { texto: "Más de una persona hace las llamadas: V-9 podría ser un segundo llamador.", confianza: "baja" as const, evidencia: ["V-9", "EV-C2", "VIN-2"] },
        ]
      : []),
  ];
  return {
    id,
    network_id: "net-1",
    status: "borrador",
    model,
    perfil: {
      red: "R-001",
      casos: nCases,
      periodo: threeCases ? "2026-10-03 a 2026-10-19" : "2026-10-03 a 2026-10-13",
      sectores: [
        { sector: "bodega", casos: 1 },
        { sector: "mototaxi", casos: 1 },
        ...(threeCases ? [{ sector: "mercado", casos: 1 }] : []),
      ],
      territorio: [],
      modus_operandi:
        "Audio de voz masculina que dice ser de \"Los X\", pago por Yape con plazo de 48 a 72 horas y foto del local como intimidación.",
      hechos,
      hipotesis,
      escalamiento: "En el caso A hubo intimidación física (foto con bala) 3 días después del primer contacto, dentro del plazo de pago.",
      brechas: [
        "Falta el audio del primer contacto del caso C.",
        "No hay comprobantes de pago para confirmar el uso de ID-3fa9c1.",
      ],
      recomendaciones_autoridad: [
        "Solicitar por requerimiento fiscal la información de la cuenta ID-3fa9c1.",
        "Comparar V-3 con audios de otras denuncias de Lima Este.",
      ],
    },
    hypotheses: hipotesis.map((h, i) => ({
      id: `${id}-h${i + 1}`,
      texto: h.texto,
      confianza: h.confianza,
      evidencia: h.evidencia,
      status: "borrador" as const,
      reviewed_by: null,
    })),
    citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] },
    created_at: createdAt,
  };
}

/** Perfil de R-002 que no pasó el validador de citas (muestra el estado "inválido"). */
export function profileR002Invalid(): ProfileView {
  return {
    id: "prof-r002-1",
    network_id: "net-2",
    status: "invalido",
    model: "muse-spark-1.3",
    perfil: {
      red: "R-002",
      casos: 2,
      periodo: "2026-09-21 a 2026-09-30",
      sectores: [{ sector: "transporte", casos: 2 }],
      territorio: [],
      modus_operandi: "Seguimiento en moto y cobro semanal en efectivo a conductores.",
      hechos: [
        { texto: "La placa ID-a4419b aparece en los videos de los casos D y E.", evidencia: ["ID-a4419b", "EV-D2", "EV-E1"] },
        { texto: "El cobro se hace siempre los lunes.", evidencia: [] },
      ],
      hipotesis: [{ texto: "La moto de ID-a4419b hace el seguimiento físico.", confianza: "media", evidencia: ["ID-a4419b", "EV-D9"] }],
      escalamiento: null,
      brechas: ["Faltan audios de los dos casos."],
      recomendaciones_autoridad: ["Pedir los registros de la placa por los canales formales."],
    },
    hypotheses: [
      { id: "prof-r002-1-h1", texto: "La moto de ID-a4419b hace el seguimiento físico.", confianza: "media", evidencia: ["ID-a4419b", "EV-D9"], status: "borrador", reviewed_by: null },
    ],
    citation_check: { ok: false, sin_cita: ["El cobro se hace siempre los lunes."], citas_inexistentes: ["EV-D9"] },
    created_at: "2026-10-02T16:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Alertas del Vigía
// ---------------------------------------------------------------------------

export function approvedAlertR002(): AlertView {
  return {
    id: "alert-0",
    org_id: "org-mototaxi",
    status: "aprobada",
    borrador: {
      titulo: "Aviso para asociados - zona Lima Norte",
      cuerpo:
        "En las últimas semanas, conductores de la zona notaron una moto que sigue a las unidades antes de pedir un cobro semanal en efectivo. No pagues ni negocies. Guarda lo que recibas y denuncia en la Línea 1818 o en tu comisaría. Si estás en peligro inmediato, llama al 105.",
      zona: "Lima Norte",
      modalidad: "Seguimiento en moto y cobro semanal en efectivo",
      que_hacer: ["No pagues ni negocies.", "Guarda los mensajes y videos.", "Denuncia en la Línea 1818 o en tu comisaría.", "Si estás en peligro inmediato, llama al 105."],
      evidencia: ["R-002", "FICHA-D", "FICHA-E"],
    },
    network_id: "net-2",
    created_at: "2026-10-02T12:00:00Z",
    approved_by: "Revisor del gremio (demo)",
    approved_at: "2026-10-02T18:30:00Z",
    image_url: null,
  };
}

export function vigiaDrafts(now: string, seq: number): AlertView[] {
  const borrador = (zona: string) => ({
    titulo: `Aviso para asociados - zona ${zona}`,
    cuerpo:
      "En las últimas dos semanas varios comerciantes recibieron audios de una persona que dice ser de \"Los X\" y exige pagos por Yape con plazo de 48 horas. No pagues ni negocies. Guarda los audios y mensajes en tus notas y denuncia en la Línea 1818 o en tu comisaría. Si estás en peligro inmediato, llama al 105.",
    zona,
    modalidad: "Audios que dicen ser de \"Los X\" y piden pago por Yape con plazo de 48 horas",
    que_hacer: [
      "No pagues ni negocies.",
      "Guarda los audios y mensajes.",
      "Denuncia en la Línea 1818 o en tu comisaría.",
      "Si estás en peligro inmediato, llama al 105.",
    ],
    evidencia: ["R-001", "FICHA-A", "FICHA-B", "FICHA-C"],
  });
  return [
    {
      id: `alert-${seq}`,
      org_id: "org-bodegas",
      status: "borrador",
      borrador: borrador("Lima Este"),
      network_id: "net-1",
      created_at: now,
      approved_by: null,
      approved_at: null,
      image_url: null,
    },
    {
      id: `alert-${seq + 1}`,
      org_id: "org-mototaxi",
      status: "borrador",
      borrador: borrador("Lima Este"),
      network_id: "net-1",
      created_at: now,
      approved_by: null,
      approved_at: null,
      image_url: null,
    },
  ];
}
