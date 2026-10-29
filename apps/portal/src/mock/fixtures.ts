/**
 * Datos ficticios del modo simulado del portal público. Cuentan esta historia:
 *
 *   Desde inicios de octubre, personas de Ate, San Juan de Lurigancho y Santa Anita registran en
 *   Blindaje audios de alguien que dice ser de "Los X". Piden un pago por Yape, dan 48 horas de plazo
 *   y repiten la frase "habla con el jefe". En La Victoria circulan llamadas de un supuesto "cobro de
 *   seguridad". El equipo de Blindaje aprobó avisos y consejos para esos distritos.
 *
 *   Otros distritos tienen casos, pero no llegan al umbral de 5 casos de 3 personas (Lurigancho,
 *   Breña, Los Olivos...): en el mapa se ven "sin datos", igual que los distritos sin casos.
 *
 * Los nombres de los distritos son reales; los casos, las cifras, "Los X" y los negocios son
 * ficticios. Las cifras exactas de abajo existen solo dentro del modo simulado: lo que sale hacia las
 * vistas pasa por las mismas reglas que la API (umbral, rangos, sin totales, sin cubo de "otros").
 */
import {
  countBand,
  DISTRICTS,
  type BusinessRecommendationView,
  type CountBand,
  type NivelRiesgo,
  type PublicRiskOverview,
  type PublicZoneCell,
  type PublicZoneMap,
  type Sector,
  type VictimAlert,
} from "@blindaje/shared";
import { SESGO_FALLBACK } from "../config";

/** [casos, víctimas distintas] */
type Pair = readonly [number, number];

interface Modalidad {
  /** Para la celda del mapa (hasta 80 caracteres). */
  corta: string;
  descripcion: string;
  senales_de_alerta: string[];
  desde: string;
}

interface RawZone {
  total: Pair;
  /** Casos del periodo anterior, para la tendencia del mapa. */
  previos: number;
  semanas: readonly Pair[];
  rubros: Partial<Record<Sector, { total: Pair; semanas?: readonly Pair[] }>>;
  escalamiento: string | null;
  modalidades: Modalidad[];
}

export const PERIODO_DIAS = 28;
export const UPDATED = "2026-10-28T11:00:00Z";
/** Como la API: cuatro semanas móviles que terminan hoy; cada una con rango solo si cumple el umbral por sí sola. */
const WEEKS = ["2026-09-30", "2026-10-07", "2026-10-14", "2026-10-21"];

/** Mismos textos que la API (services/api/src/business/risk.ts). */
export const SESGO = SESGO_FALLBACK;
export const AVISO_UMBRAL = "Aún no hay suficientes casos para mostrar cifras: hacen falta al menos 5 casos de 3 personas distintas en la zona.";
export const AVISO_RUBRO = "Aún no hay suficientes casos de tu rubro en esta zona para mostrar cifras propias: las cifras son de toda la zona.";

const LOS_X: Modalidad = {
  corta: "Audios de “Los X”: piden pago por Yape en 48 horas",
  descripcion: "Audios de alguien que dice ser de “Los X”. Piden un pago por Yape y dan 48 horas de plazo.",
  senales_de_alerta: ["“Habla con el jefe”", "Plazo de 48 horas", "Piden el pago por Yape", "Mandan una foto de tu local"],
  desde: "2026-10-12",
};

const COBRO_SEGURIDAD: Modalidad = {
  corta: "Llamadas de un “cobro de seguridad” semanal",
  descripcion: "Llamadas que se presentan como un “cobro de seguridad” del barrio y piden un pago semanal en efectivo.",
  senales_de_alerta: ["“Es por tu seguridad”", "Cobro cada semana", "Preguntan a qué hora cierras"],
  desde: "2026-10-02",
};

const ESCALAMIENTO =
  "Si el plazo vence sin respuesta, suelen mandar una foto del local. La intimidación en persona llega entre 3 y 9 días después del plazo vencido.";

/**
 * Casos ficticios por distrito. Solo existen aquí: nunca salen tal cual del modo simulado.
 * Los distritos que no aparecen no tienen casos.
 */
export const CASOS_FICTICIOS: Record<string, RawZone> = {
  ate: {
    total: [16, 11],
    previos: 9,
    semanas: [
      [3, 3],
      [2, 2],
      [5, 4],
      [6, 5],
    ],
    rubros: {
      bodega: {
        total: [10, 7],
        semanas: [
          [1, 1],
          [2, 2],
          [2, 2],
          [5, 4],
        ],
      },
      mototaxi: { total: [5, 3] },
      mercado: { total: [1, 1] },
    },
    escalamiento: ESCALAMIENTO,
    modalidades: [LOS_X, COBRO_SEGURIDAD],
  },
  "san-juan-de-lurigancho": {
    total: [24, 15],
    previos: 20,
    semanas: [
      [5, 4],
      [4, 3],
      [5, 4],
      [10, 7],
    ],
    rubros: { bodega: { total: [9, 6] }, transporte: { total: [8, 5] }, mototaxi: { total: [5, 3] }, restaurante: { total: [2, 2] } },
    escalamiento: ESCALAMIENTO,
    modalidades: [LOS_X],
  },
  "santa-anita": {
    total: [9, 6],
    previos: 8,
    semanas: [
      [2, 2],
      [2, 2],
      [2, 2],
      [3, 3],
    ],
    rubros: { bodega: { total: [5, 4] }, mercado: { total: [3, 2] } },
    escalamiento: null,
    modalidades: [LOS_X],
  },
  "la-victoria": {
    total: [12, 8],
    previos: 15,
    semanas: [
      [3, 3],
      [4, 3],
      [3, 2],
      [2, 2],
    ],
    rubros: { mercado: { total: [7, 5] }, restaurante: { total: [3, 3] } },
    escalamiento: null,
    modalidades: [COBRO_SEGURIDAD],
  },
  "san-martin-de-porres": {
    total: [11, 7],
    previos: 10,
    semanas: [
      [3, 2],
      [3, 2],
      [2, 2],
      [3, 3],
    ],
    rubros: { mototaxi: { total: [6, 4] }, bodega: { total: [3, 2] } },
    escalamiento: null,
    modalidades: [],
  },
  "el-agustino": { total: [6, 4], previos: 3, semanas: [[1, 1], [1, 1], [2, 2], [2, 2]], rubros: { bodega: { total: [4, 3] } }, escalamiento: null, modalidades: [] },
  comas: { total: [7, 5], previos: 7, semanas: [[2, 2], [2, 2], [1, 1], [2, 2]], rubros: { transporte: { total: [5, 3] } }, escalamiento: null, modalidades: [] },
  "villa-el-salvador": { total: [5, 3], previos: 6, semanas: [[1, 1], [2, 1], [1, 1], [1, 1]], rubros: {}, escalamiento: null, modalidades: [] },
  callao: { total: [6, 4], previos: 6, semanas: [[2, 2], [1, 1], [2, 2], [1, 1]], rubros: { transporte: { total: [3, 2] } }, escalamiento: null, modalidades: [] },
  // Con casos, pero bajo el umbral: en lo público se ven igual que un distrito sin casos.
  lurigancho: { total: [4, 3], previos: 2, semanas: [[1, 1], [1, 1], [1, 1], [1, 1]], rubros: { transporte: { total: [4, 3] } }, escalamiento: null, modalidades: [LOS_X] },
  brena: { total: [6, 2], previos: 1, semanas: [[1, 1], [2, 1], [1, 1], [2, 1]], rubros: { bodega: { total: [6, 2] } }, escalamiento: null, modalidades: [COBRO_SEGURIDAD] },
  "los-olivos": { total: [3, 3], previos: 4, semanas: [[1, 1], [0, 0], [1, 1], [1, 1]], rubros: {}, escalamiento: null, modalidades: [] },
  chorrillos: { total: [2, 2], previos: 0, semanas: [[0, 0], [1, 1], [0, 0], [1, 1]], rubros: {}, escalamiento: null, modalidades: [] },
  independencia: { total: [1, 1], previos: 0, semanas: [[0, 0], [0, 0], [1, 1], [0, 0]], rubros: {}, escalamiento: null, modalidades: [] },
};

const band = ([c, v]: Pair): CountBand | null => countBand(c, v);

/**
 * El mismo nivel que la API (services/api/src/business/risk.ts, riskLevel): sin_datos bajo el umbral;
 * si no, un punto por 8 o más casos, otro por 15 o más, uno por intimidación física y uno por una
 * modalidad activa. 0 = bajo, 1-2 = medio, 3 o más = alto.
 */
function nivelDe(total: Pair, escalamiento: boolean, modalidadActiva: boolean): NivelRiesgo {
  if (band(total) === null) return "sin_datos";
  const [c] = total;
  const puntos = (c >= 8 ? 1 : 0) + (c >= 15 ? 1 : 0) + (escalamiento ? 1 : 0) + (modalidadActiva ? 1 : 0);
  return puntos === 0 ? "bajo" : puntos <= 2 ? "medio" : "alto";
}

function tendenciaDe(z: RawZone): "sube" | "estable" | "baja" {
  const [c] = z.total;
  if (c > z.previos * 1.15) return "sube";
  if (c < z.previos * 0.85) return "baja";
  return "estable";
}

/** GET /v1/public/zones: los 50 distritos; bajo el umbral, "sin datos" sin nada más. */
export function publicZones(): PublicZoneMap {
  return {
    periodo_dias: PERIODO_DIAS,
    actualizado: UPDATED,
    celdas: DISTRICTS.map((d): PublicZoneCell => {
      const z = CASOS_FICTICIOS[d.id];
      const casos = z ? band(z.total) : null;
      if (!z || casos === null) return { distrito: d.id, nivel: "sin_datos", casos: null, tendencia: null, modalidades: [] };
      return {
        distrito: d.id,
        nivel: nivelDe(z.total, z.escalamiento !== null, z.modalidades.length > 0),
        casos,
        tendencia: tendenciaDe(z),
        modalidades: z.modalidades.slice(0, 3).map((m) => m.corta),
      };
    }),
    umbral: { casos: 5, victimas: 3 },
    nota_sesgo: SESGO,
    demo: true,
  };
}

function weeks(values: readonly Pair[] | undefined): PublicRiskOverview["tendencia"] {
  return WEEKS.map((semana, i) => {
    const w = values?.[i];
    return { semana, casos: w ? band(w) : null };
  });
}

/** Panorama sin datos: ni modalidades ni rubros ni semanas (nombrarlos ya diría que alguien denunció). */
function sinDatos(zona: string, sector: string | null): PublicRiskOverview {
  return {
    zona,
    sector,
    periodo_dias: PERIODO_DIAS,
    nivel_riesgo: "sin_datos",
    casos_periodo: null,
    tendencia: weeks(undefined),
    modalidades_activas: [],
    escalamiento: null,
    sectores_afectados: [],
    sesgo: SESGO,
    aviso_umbral: AVISO_UMBRAL,
    actualizado_at: UPDATED,
    demo: true,
  };
}

/**
 * GET /v1/public/risk?zona=&sector=. Como la API: si el rubro no llega al umbral en el distrito, las
 * cifras son de todo el distrito (sector = null) con un aviso. Cada parte (semana, rubro) se publica
 * solo si pasa el umbral por sí misma, en rangos y sin total ni cubo de "otros".
 */
export function publicRisk(zona: string, sector: string | null = null): PublicRiskOverview {
  const z = CASOS_FICTICIOS[zona];
  if (!z || band(z.total) === null) return sinDatos(zona, sector);
  const rubro = sector ? z.rubros[sector as Sector] : undefined;
  const useRubro = rubro !== undefined && band(rubro.total) !== null;
  const scope = useRubro ? rubro.total : z.total;
  const modalidadActiva = z.modalidades.length > 0;
  const sectores = Object.entries(z.rubros)
    .flatMap(([s, r]) => {
      const b = r ? band(r.total) : null;
      return b ? [{ sector: s, casos: b }] : [];
    })
    .sort((a, b) => b.casos.localeCompare(a.casos, "es", { numeric: true }) || a.sector.localeCompare(b.sector));
  return {
    zona,
    sector: useRubro ? (sector as string) : null,
    periodo_dias: PERIODO_DIAS,
    nivel_riesgo: nivelDe(scope, z.escalamiento !== null, modalidadActiva),
    casos_periodo: band(scope),
    tendencia: weeks(useRubro ? rubro.semanas : z.semanas),
    modalidades_activas: z.modalidades.map(({ descripcion, senales_de_alerta, desde }) => ({ descripcion, senales_de_alerta, desde })),
    escalamiento: z.escalamiento,
    sectores_afectados: sectores,
    sesgo: SESGO,
    aviso_umbral: sector && !useRubro ? AVISO_RUBRO : null,
    actualizado_at: UPDATED,
    demo: true,
  };
}

const QUE_HACER = [
  "No pagues ni negocies. No respondas los mensajes.",
  "Guarda los audios, las capturas y el número que te escribió. No borres el chat.",
  "Si estás en peligro inmediato, llama al 105.",
  "Denuncia en la Línea 1818 o en tu comisaría.",
  "Guarda tu caso en Blindaje. Si aceptas compartirlo, ayuda a alertar a tu distrito sin decir quién eres.",
];

const ADVERTENCIAS = [
  "Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.",
  "Las cifras cuentan solo los casos que las personas registraron en Blindaje y aceptaron compartir con la comunidad.",
  "Todos los datos de esta demostración son ficticios.",
];

const RECOMENDACIONES: BusinessRecommendationView[] = [
  {
    id: "rec-002",
    sector: "bodega",
    zona: "ate",
    nivel_riesgo: "alto",
    resumen:
      "En Ate circulan audios de alguien que dice ser de “Los X”. Piden un pago por Yape, dan 48 horas de plazo y repiten “habla con el jefe”. No pagues ni negocies: guarda todo y denuncia.",
    modalidades: [{ descripcion: LOS_X.descripcion, senales_de_alerta: LOS_X.senales_de_alerta }],
    recomendaciones: [
      {
        titulo: "Aprende a reconocer el guion",
        detalle: "Si escuchas “habla con el jefe” o te dan 48 horas, es la modalidad de “Los X”. No respondas, guarda el audio y denuncia.",
        prioridad: "media",
      },
      {
        titulo: "No respondas ni negocies",
        detalle: "Si te llega un audio o un mensaje, no contestes ni discutas el monto. Cualquier respuesta les dice que pueden presionarte.",
        prioridad: "alta",
      },
      {
        titulo: "Guarda cada audio y cada captura",
        detalle: "Guárdalos en Blindaje apenas te lleguen y no borres el chat. Sirven para tu denuncia y para ver si los casos se repiten en tu distrito.",
        prioridad: "alta",
      },
      {
        titulo: "Acuerda un protocolo con tu personal",
        detalle: "Que todos sepan que nadie paga ni negocia, y que cualquier mensaje raro te lo pasan a ti. Practiquen qué decir si llaman al local.",
        prioridad: "alta",
      },
      {
        titulo: "Cuida lo que publicas del negocio",
        detalle: "No publiques horarios de caja, montos ni fotos del interior en redes. Revisa quién puede ver tus publicaciones.",
        prioridad: "media",
      },
      {
        titulo: "Registra lo que recibiste aunque no pase a más",
        detalle: "Guárdalo en Blindaje y, si quieres, compártelo con la comunidad. Juntar los casos ayuda a que la autoridad vea si están relacionados, sin decir quién eres.",
        prioridad: "baja",
      },
    ],
    que_hacer_si_te_pasa: QUE_HACER,
    advertencias: ADVERTENCIAS,
    approved_at: "2026-10-27T21:10:00Z",
  },
  {
    id: "rec-001",
    sector: "bodega",
    zona: "ate",
    nivel_riesgo: "bajo",
    resumen:
      "Algunas bodegas de Ate recibieron llamadas de un supuesto “cobro de seguridad” del barrio. Nadie del barrio cobra por seguridad: no pagues y denuncia en la Línea 1818.",
    modalidades: [{ descripcion: COBRO_SEGURIDAD.descripcion, senales_de_alerta: COBRO_SEGURIDAD.senales_de_alerta }],
    recomendaciones: [
      {
        titulo: "Nadie cobra por la seguridad del barrio",
        detalle: "Si alguien te pide un pago semanal “por tu seguridad”, no pagues. Anota la hora de la llamada y guárdala en Blindaje.",
        prioridad: "alta",
      },
      {
        titulo: "No des datos del negocio por teléfono",
        detalle: "No digas a qué hora cierras, cuánto vendes ni quién atiende. Si insisten, corta.",
        prioridad: "media",
      },
    ],
    que_hacer_si_te_pasa: QUE_HACER,
    advertencias: ADVERTENCIAS.slice(0, 2),
    approved_at: "2026-10-13T16:00:00Z",
  },
  {
    id: "rec-003",
    sector: "transporte",
    zona: "san-juan-de-lurigancho",
    nivel_riesgo: "alto",
    resumen:
      "En San Juan de Lurigancho, choferes y dueños de unidades reciben audios de “Los X” con 48 horas de plazo. No pagues ni negocies: guarda los audios y denuncia.",
    modalidades: [{ descripcion: LOS_X.descripcion, senales_de_alerta: LOS_X.senales_de_alerta }],
    recomendaciones: [
      {
        titulo: "No respondas ni negocies",
        detalle: "Si te llega un audio, no contestes ni discutas el monto. Avísale al dueño de la unidad o a quien maneja contigo.",
        prioridad: "alta",
      },
      {
        titulo: "Cuida los datos de tu ruta",
        detalle: "No publiques tu ruta, tus horarios ni la placa de la unidad en redes. Revisa quién ve tus estados.",
        prioridad: "media",
      },
    ],
    que_hacer_si_te_pasa: QUE_HACER,
    advertencias: ADVERTENCIAS,
    approved_at: "2026-10-24T14:00:00Z",
  },
];

/** Consejos aprobados del distrito; con rubro, solo los de ese rubro. */
export function publicRecommendations(zona: string, sector: string | null = null): BusinessRecommendationView[] {
  return structuredClone(RECOMENDACIONES.filter((r) => r.zona === zona && (!sector || r.sector === sector)));
}

const AVISOS: VictimAlert[] = [
  {
    id: "alert-ate-2",
    titulo: "Ate: audios de “Los X” que piden pagos por Yape",
    cuerpo:
      "En las últimas dos semanas, varias personas de Ate registraron audios de alguien que dice ser de “Los X” y exige pagos por Yape con 48 horas de plazo. No pagues ni negocies. Guarda los audios y mensajes y denuncia en la Línea 1818 o en tu comisaría. Si estás en peligro inmediato, llama al 105.",
    zona: "ate",
    que_hacer: ["No pagues ni negocies.", "Guarda los audios y mensajes.", "Denuncia en la Línea 1818 o en tu comisaría.", "Si estás en peligro inmediato, llama al 105."],
    approved_at: "2026-10-27T18:30:00Z",
  },
  {
    id: "alert-ate-1",
    titulo: "Ate: llamadas de un “cobro de seguridad”",
    cuerpo:
      "Algunas bodegas de Ate recibieron llamadas que piden un pago semanal “por seguridad”. Nadie del barrio cobra por eso. No pagues, no des datos del negocio y denuncia en la Línea 1818.",
    zona: "ate",
    que_hacer: ["No pagues ni negocies.", "No des datos del negocio por teléfono.", "Denuncia en la Línea 1818 o en tu comisaría."],
    approved_at: "2026-10-12T15:00:00Z",
  },
  {
    id: "alert-sjl-1",
    titulo: "San Juan de Lurigancho: audios de “Los X”",
    cuerpo:
      "Personas de San Juan de Lurigancho registraron audios de “Los X” que piden pagos por Yape con 48 horas de plazo. No pagues ni negocies. Guarda todo y denuncia en la Línea 1818. Si estás en peligro inmediato, llama al 105.",
    zona: "san-juan-de-lurigancho",
    que_hacer: ["No pagues ni negocies.", "Guarda los audios y mensajes.", "Denuncia en la Línea 1818 o en tu comisaría."],
    approved_at: "2026-10-25T13:00:00Z",
  },
  {
    id: "alert-sa-1",
    titulo: "Santa Anita: el mismo guion de “Los X”",
    cuerpo:
      "En Santa Anita también llegan audios que repiten “habla con el jefe” y dan 48 horas de plazo. No pagues ni negocies. Guarda los audios y denuncia en la Línea 1818.",
    zona: "santa-anita",
    que_hacer: ["No pagues ni negocies.", "Guarda los audios y mensajes.", "Denuncia en la Línea 1818 o en tu comisaría."],
    approved_at: "2026-10-20T16:00:00Z",
  },
];

/** Avisos aprobados del distrito. */
export function publicAlerts(zona: string): VictimAlert[] {
  return structuredClone(AVISOS.filter((a) => a.zona === zona));
}
