/**
 * Vista de zonas simulada (GET /v1/console/zones). Cifras FICTICIAS repartidas en distritos reales
 * para que la grilla tenga distritos sobre y bajo el umbral de 5 casos de 3 víctimas:
 *
 *   - San Juan de Lurigancho, Ate y La Victoria: la modalidad de "Los X" (red R-001, casos A, B y C).
 *   - Comas y Los Olivos: seguimiento en moto y cobro semanal (red R-002, casos D y E).
 *   - Carabayllo tiene 6 casos pero de solo 2 víctimas: queda bajo el umbral.
 *
 * Como la API, un distrito bajo el umbral no trae redes ni modalidades. Nunca hay direcciones,
 * coordenadas ni nada más fino que el distrito.
 */
import { canShowTerritorialStats, type ConsoleZoneRow, type ConsoleZones } from "@blindaje/shared";

interface Seed {
  distrito: string;
  casos: number;
  victimas: number;
  previos: number;
  redes: string[];
  modalidades: string[];
}

const LOS_X = "Audios que dicen ser de “Los X” y piden pago por Yape en 48 horas";
const MOTO = "Una moto sigue la unidad y luego cobran cada semana en efectivo";

/** Base: los últimos 28 días. */
const BASE: Seed[] = [
  { distrito: "san-juan-de-lurigancho", casos: 14, victimas: 11, previos: 8, redes: ["R-001"], modalidades: [LOS_X, "Foto del local con una bala"] },
  { distrito: "san-martin-de-porres", casos: 12, victimas: 9, previos: 11, redes: [], modalidades: ["Cupo a transportistas por mensaje", "Fotos de la unidad para intimidar"] },
  { distrito: "ate", casos: 9, victimas: 7, previos: 4, redes: ["R-001"], modalidades: [LOS_X, "Cupo semanal a mototaxis"] },
  { distrito: "comas", casos: 7, victimas: 5, previos: 10, redes: ["R-002"], modalidades: [MOTO] },
  { distrito: "la-victoria", casos: 6, victimas: 4, previos: 6, redes: ["R-001"], modalidades: ["Mensajes con una cuenta de Yape a puestos de mercado"] },
  { distrito: "villa-el-salvador", casos: 6, victimas: 4, previos: 2, redes: [], modalidades: ["Mensajes que exigen un pago semanal a bodegas"] },
  { distrito: "los-olivos", casos: 5, victimas: 3, previos: 5, redes: ["R-002"], modalidades: [MOTO] },
  { distrito: "carabayllo", casos: 6, victimas: 2, previos: 3, redes: [], modalidades: [] },
  { distrito: "independencia", casos: 4, victimas: 3, previos: 2, redes: [], modalidades: [] },
  { distrito: "callao", casos: 4, victimas: 4, previos: 1, redes: [], modalidades: [] },
  { distrito: "lima", casos: 3, victimas: 3, previos: 4, redes: [], modalidades: [] },
  { distrito: "puente-piedra", casos: 3, victimas: 2, previos: 1, redes: [], modalidades: [] },
  { distrito: "santa-anita", casos: 2, victimas: 2, previos: 0, redes: [], modalidades: [] },
  { distrito: "chorrillos", casos: 1, victimas: 1, previos: 1, redes: [], modalidades: [] },
];

/** Cuánto crece cada cifra respecto de 28 días, por periodo. */
const FACTOR: Record<number, { casos: number; victimas: number }> = {
  14: { casos: 0.5, victimas: 0.6 },
  28: { casos: 1, victimas: 1 },
  90: { casos: 2.8, victimas: 2.4 },
};

export const ZONE_PERIODS = [14, 28, 90] as const;

/**
 * Filas del periodo. `redesExistentes` son las redes que existen en el estado simulado: R-001 solo
 * aparece cuando se confirmaron sus vínculos.
 */
export function mockConsoleZones(dias: number, now: Date, redesExistentes: string[]): ConsoleZones {
  const f = FACTOR[dias] ?? FACTOR[28]!;
  const periodo = FACTOR[dias] ? dias : 28;
  const filas: ConsoleZoneRow[] = BASE.map((s) => {
    const casos = Math.round(s.casos * f.casos);
    const victimas = Math.min(casos, Math.round(s.victimas * f.victimas));
    const sobre = canShowTerritorialStats(casos, victimas);
    return {
      distrito: s.distrito,
      casos,
      victimas,
      casos_previos: Math.round(s.previos * f.casos),
      redes: sobre ? s.redes.filter((r) => redesExistentes.includes(r)) : [],
      modalidades: sobre ? s.modalidades : [],
      sobre_umbral: sobre,
    };
  }).filter((r) => r.casos > 0);
  return {
    periodo_dias: periodo,
    actualizado: now.toISOString(),
    filas,
    sin_distrito: Math.round(3 * f.casos),
  };
}
