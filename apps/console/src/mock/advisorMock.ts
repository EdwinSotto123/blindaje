/**
 * Asesor simulado: recomendaciones de prevención por distrito y rubro con la historia ficticia de
 * San Juan de Lurigancho y Ate ("Los X" cobra por Yape, da 48 horas de plazo y dice "habla con el
 * jefe"). Aplica los mismos permisos y la misma barrera que la API: corre el análisis o la
 * administración, aprueba cualquiera del equipo y no se aprueba lo que no pasó el validador de citas.
 * Todo es ficticio: no hay negocios, números ni cuentas reales.
 */
import { CENTRAL_ORG_ID, districtOfZone, type AsesorOutput, type ConsoleRecommendationView } from "@blindaje/shared";
import type { AdvisorActor, AdvisorApi, AsesorRunInput, RecommendationStatus } from "../api/advisor";
import { ApiRequestError } from "../api/client";
import { R001_DISTRICTS } from "./fixtures";

const STATE_KEY = "blindaje.console.mock.asesor";
const MODEL = "muse-spark-1.3";
/** Sube cuando cambian los datos ficticios (2: rediseño del 28/10, sin cuentas de negocio). */
const STATE_VERSION = 2;

interface AdvisorState {
  version: typeof STATE_VERSION;
  seq: number;
  recommendations: ConsoleRecommendationView[];
}

const QUE_HACER = [
  "No pagues ni negocies. No respondas los mensajes.",
  "Guarda en Blindaje los audios, las capturas y el número que te escribió. No borres el chat.",
  "Si estás en peligro inmediato, llama al 105.",
  "Denuncia en la Línea 1818 o en tu comisaría.",
];

const SESGO = "Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.";

export function losXContent(zona: string, sector: string): AsesorOutput {
  return {
    sector,
    zona,
    nivel_riesgo: "medio",
    resumen: `En ${zona} circulan audios de alguien que dice ser de “Los X”. Piden un pago por Yape, dan 48 horas de plazo y repiten “habla con el jefe”. No pagues ni negocies: guarda todo y denuncia en la Línea 1818.`,
    modalidades: [
      {
        descripcion: "Audios de alguien que dice ser de “Los X”. Piden un pago por Yape y dan 48 horas de plazo.",
        senales_de_alerta: ["“Habla con el jefe”", "Plazo de 48 horas", "Piden el pago por Yape", "Mandan una foto de tu local"],
        evidencia: ["R-001", "FICHA-A", "FICHA-B", "FICHA-C"],
      },
    ],
    recomendaciones: [
      {
        titulo: "No respondas ni negocies",
        detalle: "Si te llega un audio o un mensaje, no contestes ni discutas el monto. Cualquier respuesta les dice que pueden presionarte.",
        prioridad: "alta",
      },
      {
        titulo: "Guarda cada audio y cada captura",
        detalle: "Guárdalos en Blindaje apenas te lleguen y no borres el chat. Sirven para tu denuncia y para que el equipo de Blindaje vea si los casos se repiten en tu distrito.",
        prioridad: "alta",
      },
      {
        titulo: "Aprende a reconocer el guion",
        detalle: "Si escuchas “habla con el jefe” o te dan 48 horas, es la modalidad de “Los X”. No respondas, guarda el audio y denuncia en la Línea 1818.",
        prioridad: "media",
      },
      {
        titulo: "Cuida lo que publicas del negocio",
        detalle: "No publiques horarios de caja, montos ni fotos del interior en redes.",
        prioridad: "baja",
      },
    ],
    que_hacer_si_te_pasa: QUE_HACER,
    advertencias: [SESGO, "Todos los datos de esta demostración son ficticios."],
  };
}

function sinDatosContent(zona: string, sector: string): AsesorOutput {
  return {
    sector,
    zona,
    nivel_riesgo: "sin_datos",
    resumen: `Aún no hay suficientes casos para mostrar cifras de este rubro en ${zona}. Estas son recomendaciones generales de prevención.`,
    modalidades: [],
    recomendaciones: [
      {
        titulo: "Acuerda un protocolo con tu personal",
        detalle: "Que todos sepan que nadie paga ni negocia, y que cualquier mensaje raro te lo pasan a ti.",
        prioridad: "alta",
      },
      {
        titulo: "Cuida lo que publicas del negocio",
        detalle: "No publiques horarios de caja, montos ni fotos del interior en redes.",
        prioridad: "media",
      },
    ],
    que_hacer_si_te_pasa: QUE_HACER,
    advertencias: [SESGO, "Con menos de 5 casos de 3 personas distintas no mostramos cifras."],
  };
}

function initialState(): AdvisorState {
  const draftOk: ConsoleRecommendationView = {
    id: "rec-003",
    org_id: CENTRAL_ORG_ID,
    status: "borrador",
    contenido: losXContent("San Juan de Lurigancho", "bodega"),
    citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] },
    model: MODEL,
    created_at: "2026-10-28T13:40:00Z",
    approved_by: null,
    approved_at: null,
  };
  const mototaxis = losXContent("Ate", "mototaxi");
  mototaxis.modalidades = [
    {
      descripcion: "Cobro de “derecho de paradero” en la noche, con amenazas por mensaje.",
      senales_de_alerta: ["“Derecho de paradero”", "Cobro en la noche"],
      evidencia: ["FICHA-Z"],
    },
    ...mototaxis.modalidades,
  ];
  const draftBad: ConsoleRecommendationView = {
    id: "rec-004",
    org_id: CENTRAL_ORG_ID,
    status: "borrador",
    contenido: mototaxis,
    citation_check: { ok: false, sin_cita: ["El cobro se hace siempre en la noche."], citas_inexistentes: ["FICHA-Z"] },
    model: MODEL,
    created_at: "2026-10-28T13:42:00Z",
    approved_by: null,
    approved_at: null,
  };
  const approved: ConsoleRecommendationView = {
    id: "rec-001",
    org_id: CENTRAL_ORG_ID,
    status: "aprobada",
    contenido: {
      sector: "transporte",
      zona: "Comas",
      nivel_riesgo: "bajo",
      resumen:
        "Algunos conductores notaron una moto que sigue la unidad antes de que les pidan un cobro semanal “por su seguridad”. Nadie cobra por la seguridad de una ruta: no pagues y denuncia en la Línea 1818.",
      modalidades: [
        {
          descripcion: "Una moto sigue la unidad varios días y luego piden un pago semanal en efectivo “por tu seguridad”.",
          senales_de_alerta: ["Una moto que se repite en tu ruta", "“Es por tu seguridad”", "Cobro cada semana"],
          evidencia: ["R-002", "FICHA-D", "FICHA-E"],
        },
      ],
      recomendaciones: [
        {
          titulo: "Nadie cobra por la seguridad de la ruta",
          detalle: "Si alguien te pide un pago semanal “por tu seguridad”, no pagues. Guarda los mensajes en Blindaje y anota la hora en que te escribieron.",
          prioridad: "alta",
        },
      ],
      que_hacer_si_te_pasa: QUE_HACER,
      advertencias: [SESGO],
    },
    citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] },
    model: MODEL,
    created_at: "2026-10-13T14:00:00Z",
    approved_by: "Revisora Demo",
    approved_at: "2026-10-13T16:00:00Z",
  };
  return { version: STATE_VERSION, seq: 5, recommendations: [draftOk, draftBad, approved] };
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

const forbidden = (msg = "Tu rol no tiene permiso para esta acción."): never => {
  throw new ApiRequestError(403, "forbidden", msg);
};

export interface MockAdvisorOptions {
  latency?: number;
  persist?: boolean;
  now?: () => Date;
}

export class MockAdvisorApi implements AdvisorApi {
  private readonly latency: number;
  private readonly persist: boolean;
  private readonly now: () => Date;
  private memory: AdvisorState | null = null;

  constructor(
    private readonly actor: AdvisorActor,
    opts: MockAdvisorOptions = {},
  ) {
    this.latency = opts.latency ?? 280;
    this.persist = opts.persist ?? true;
    this.now = opts.now ?? (() => new Date());
  }

  private load(): AdvisorState {
    if (this.memory) return this.memory;
    const raw = this.persist ? storage()?.getItem(STATE_KEY) : null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AdvisorState;
        if (parsed.version === STATE_VERSION) return (this.memory = parsed);
      } catch {
        // estado corrupto: se regenera
      }
    }
    return (this.memory = initialState());
  }

  private save(state: AdvisorState): void {
    this.memory = state;
    if (!this.persist) return;
    try {
      storage()?.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // sin almacenamiento: el estado vive en memoria
    }
  }

  private async wait(ms = this.latency): Promise<void> {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  async listRecommendations(status?: RecommendationStatus): Promise<ConsoleRecommendationView[]> {
    await this.wait();
    return this.load()
      .recommendations.filter((r) => !status || r.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /** Un borrador para un distrito y un rubro. Con "Los X" activo en el distrito, su modalidad; si no, consejos generales. */
  async runAsesor(req: AsesorRunInput): Promise<ConsoleRecommendationView[]> {
    if (this.actor.role !== "analyst" && this.actor.role !== "admin") forbidden();
    const district = districtOfZone(req.zona);
    const sector = req.sector?.trim();
    if (!district) throw new ApiRequestError(400, "bad_request", "Elige un distrito de la lista.");
    if (!sector) throw new ApiRequestError(400, "bad_request", "Elige el rubro.");
    await this.wait(this.latency * 4);
    const state = this.load();
    const active = (R001_DISTRICTS as readonly string[]).includes(district.name);
    const created: ConsoleRecommendationView = {
      id: `rec-${String(state.seq++).padStart(3, "0")}`,
      org_id: CENTRAL_ORG_ID,
      status: "borrador",
      contenido: active ? losXContent(district.name, sector) : sinDatosContent(district.name, sector),
      citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] },
      model: MODEL,
      created_at: this.now().toISOString(),
      approved_by: null,
      approved_at: null,
    };
    this.save({ ...state, recommendations: [created, ...state.recommendations] });
    return [created];
  }

  /** Aprueba o rechaza cualquiera del equipo, para cualquier distrito. */
  async decideRecommendation(id: string, decision: "aprobar" | "rechazar"): Promise<ConsoleRecommendationView> {
    await this.wait();
    const state = this.load();
    const r = state.recommendations.find((x) => x.id === id);
    if (!r) throw new ApiRequestError(404, "not_found", "No se encontró la recomendación.");
    if (decision === "aprobar" && !r.citation_check.ok) {
      throw new ApiRequestError(409, "conflict", "La recomendación no pasó el validador de citas: vuelve a correr el Asesor");
    }
    const now = this.now().toISOString();
    const updated: ConsoleRecommendationView =
      decision === "aprobar"
        ? { ...r, status: "aprobada", approved_by: this.actor.display_name, approved_at: now }
        : { ...r, status: "rechazada", approved_by: null, approved_at: null };
    this.save({ ...state, recommendations: state.recommendations.map((x) => (x.id === id ? updated : x)) });
    return updated;
  }
}
