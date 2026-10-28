/**
 * Datos ficticios del modo simulado del portal. Cuentan la historia de "Lima Este":
 *
 *   Desde inicios de octubre circulan audios de alguien que dice ser de "Los X". Piden un pago por
 *   Yape, dan 48 horas de plazo y repiten la frase "habla con el jefe". La Asociación de Bodegueros
 *   de Lima Este (ficticia) aprobó una recomendación del Asesor y una alerta del Vigía.
 *
 *   Una segunda cuenta (transporte en Lima Sur) no alcanza el umbral de 5 casos y 3 víctimas: sirve
 *   para ver "Aún no hay suficientes casos para mostrar cifras" y los estados vacíos.
 *
 * Todo es ficticio: no hay negocios, personas, números ni cuentas reales. Nunca se muestran
 * números, cuentas ni placas completos, ni citas internas (VIN-…, R-…, FICHA-…).
 */
import type { BusinessMe, BusinessRecommendationView, RiskOverview, VictimAlert } from "@blindaje/shared";

export interface DemoAccount {
  me: BusinessMe;
  /** Una línea para el botón de demostración del login. */
  hint: string;
}

const ORG_BODEGAS = { id: "org-bodegas", name: "Asociación de Bodegueros de Lima Este (ficticia)" };
const ORG_TRANSPORTE = { id: "org-transporte-sur", name: "Asociación de Transportistas del Sur (ficticia)" };

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    me: {
      id: "biz-santa-rosa",
      email: "bodega@demo.blindaje.pe",
      business_name: "Bodega Santa Rosa (ficticia)",
      sector: "bodegas",
      zona: "Lima Este",
      org: ORG_BODEGAS,
    },
    hint: "Bodega en Lima Este, con casos recientes",
  },
  {
    me: {
      id: "biz-huascar",
      email: "transporte@demo.blindaje.pe",
      business_name: "Transportes Huáscar (ficticio)",
      sector: "transporte",
      zona: "Lima Sur",
      org: ORG_TRANSPORTE,
    },
    hint: "Transporte en Lima Sur, todavía sin cifras",
  },
];

/** Contraseña de las cuentas de demostración (solo en modo simulado). */
export const DEMO_PASSWORD = "demo-negocios";

const UPDATED = "2026-10-28T11:00:00Z";
const WEEKS = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];

const SESGO =
  "Más casos en una zona o un sector puede significar que ahí se denuncia más, no que sea más peligroso. Usa estas cifras para prevenir, no para comparar barrios.";

const AVISO_UMBRAL =
  "Aún no hay suficientes casos para mostrar cifras. Solo las mostramos cuando hay al menos 5 casos de 3 personas distintas, para que nadie pueda ser reconocido.";

const LOS_X = {
  descripcion: "Audios de alguien que dice ser de “Los X”. Piden un pago por Yape y dan 48 horas de plazo.",
  senales_de_alerta: ["“Habla con el jefe”", "Plazo de 48 horas", "Piden el pago por Yape", "Mandan una foto de tu local"],
};

const COBRO_SEGURIDAD = {
  descripcion: "Llamadas que se presentan como un “cobro de seguridad” del barrio y piden un pago semanal en efectivo.",
  senales_de_alerta: ["“Es por tu seguridad”", "Cobro cada semana", "Preguntan a qué hora cierras"],
};

function weeks(values: (number | null)[]): RiskOverview["tendencia"] {
  return WEEKS.map((semana, i) => ({ semana, casos: values[i] ?? null }));
}

/** Panorama de bodegas en Lima Este: cumple el umbral. */
export function riskBodegasLimaEste(): RiskOverview {
  return {
    zona: "Lima Este",
    sector: "bodegas",
    periodo_dias: 28,
    nivel_riesgo: "medio",
    casos_periodo: 14,
    tendencia: weeks([null, null, 2, 2, 2, 3, 4, 5]),
    modalidades_activas: [
      { ...LOS_X, desde: "2026-10-05" },
      { ...COBRO_SEGURIDAD, desde: "2026-09-21" },
    ],
    escalamiento:
      "Si el plazo vence sin pago, suelen mandar una foto del local. La intimidación en persona llega entre 3 y 9 días después del plazo vencido.",
    sectores_afectados: [
      { sector: "bodegas", casos: 14 },
      { sector: "mototaxis", casos: 6 },
      { sector: "mercados", casos: 5 },
      { sector: "restaurantes", casos: null },
      { sector: "transporte", casos: null },
    ],
    sesgo: SESGO,
    aviso_umbral: null,
    actualizado_at: UPDATED,
  };
}

/** Panorama de toda la zona de Lima Este (todos los sectores). */
export function riskLimaEste(): RiskOverview {
  return {
    ...riskBodegasLimaEste(),
    sector: null,
    casos_periodo: 25,
    tendencia: weeks([null, 3, 4, 4, 5, 6, 7, 7]),
  };
}

/** Transporte en Lima Sur: no alcanza el umbral. */
export function riskTransporteLimaSur(sector: string | null = "transporte"): RiskOverview {
  return {
    zona: "Lima Sur",
    sector,
    periodo_dias: 28,
    nivel_riesgo: "sin_datos",
    casos_periodo: null,
    tendencia: weeks([null, null, null, null, null, null, null, null]),
    modalidades_activas: [],
    escalamiento: null,
    sectores_afectados: [
      { sector: "transporte", casos: null },
      { sector: "bodegas", casos: null },
    ],
    sesgo: SESGO,
    aviso_umbral: AVISO_UMBRAL,
    actualizado_at: UPDATED,
  };
}

const QUE_HACER = [
  "No pagues ni negocies. No respondas los mensajes.",
  "Guarda los audios, las capturas y el número que te escribió. No borres el chat.",
  "Si estás en peligro inmediato, llama al 105.",
  "Denuncia en la Línea 1818 o en tu comisaría.",
  "Avisa a tu gremio.",
];

const ADVERTENCIAS = [
  "Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.",
  "Las cifras cuentan solo los casos que los gremios afiliados registraron en Blindaje.",
  "Todos los datos de esta demostración son ficticios.",
];

export function recommendationsBodegas(): BusinessRecommendationView[] {
  return [
    {
      id: "rec-002",
      sector: "bodegas",
      zona: "Lima Este",
      nivel_riesgo: "medio",
      resumen:
        "En Lima Este circulan audios de alguien que dice ser de “Los X”. Piden un pago por Yape, dan 48 horas de plazo y repiten “habla con el jefe”. No pagues ni negocies: guarda todo y avisa.",
      modalidades: [LOS_X],
      recomendaciones: [
        {
          titulo: "Aprende a reconocer el guion",
          detalle: "Si escuchas “habla con el jefe” o te dan 48 horas, es la modalidad de “Los X”. No respondas, guarda el audio y avisa a tu gremio.",
          prioridad: "media",
        },
        {
          titulo: "No respondas ni negocies",
          detalle: "Si te llega un audio o un mensaje, no contestes ni discutas el monto. Cualquier respuesta les dice que pueden presionarte.",
          prioridad: "alta",
        },
        {
          titulo: "Guarda cada audio y cada captura",
          detalle: "Guárdalos en Blindaje apenas te lleguen y no borres el chat. Sirven para tu denuncia y para que tu gremio vea si los casos se repiten.",
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
          titulo: "Avisa a tu gremio aunque no pase a más",
          detalle: "Cuéntale a tu dirigente lo que recibiste. Juntar los casos ayuda a que la autoridad vea si están relacionados.",
          prioridad: "baja",
        },
      ],
      que_hacer_si_te_pasa: QUE_HACER,
      advertencias: ADVERTENCIAS,
      approved_at: "2026-10-27T21:10:00Z",
    },
    {
      id: "rec-001",
      sector: "bodegas",
      zona: "Lima Este",
      nivel_riesgo: "bajo",
      resumen:
        "Algunas bodegas recibieron llamadas de un supuesto “cobro de seguridad” del barrio. Nadie del barrio cobra por seguridad: no pagues y avisa a tu gremio.",
      modalidades: [COBRO_SEGURIDAD],
      recomendaciones: [
        {
          titulo: "Nadie cobra por la seguridad del barrio",
          detalle: "Si alguien te pide un pago semanal “por tu seguridad”, no pagues. Anota la hora de la llamada y avisa a tu gremio.",
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
  ];
}

export function alertsBodegas(): VictimAlert[] {
  return [
    {
      id: "alert-1",
      titulo: "Aviso para asociados - zona Lima Este",
      cuerpo:
        "En las últimas dos semanas varios comerciantes recibieron audios de una persona que dice ser de “Los X” y exige pagos por Yape con plazo de 48 horas. No pagues ni negocies. Guarda los audios y mensajes y denuncia en la Línea 1818 o en tu comisaría. Si estás en peligro inmediato, llama al 105.",
      zona: "Lima Este",
      que_hacer: ["No pagues ni negocies.", "Guarda los audios y mensajes.", "Denuncia en la Línea 1818 o en tu comisaría.", "Si estás en peligro inmediato, llama al 105."],
      approved_at: "2026-10-27T18:30:00Z",
    },
    {
      id: "alert-0",
      titulo: "Aviso para asociados - llamadas de “cobro de seguridad”",
      cuerpo:
        "Algunas bodegas de la zona recibieron llamadas que piden un pago semanal “por seguridad”. Nadie del barrio cobra por eso. No pagues, no des datos del negocio y avisa a tu gremio.",
      zona: "Lima Este",
      que_hacer: ["No pagues ni negocies.", "No des datos del negocio por teléfono.", "Avisa a tu gremio."],
      approved_at: "2026-10-12T15:00:00Z",
    },
  ];
}
