/**
 * Asesor simulado: recomendaciones de prevención para negocios con la historia ficticia de Lima Este
 * ("Los X" cobra por Yape, da 48 horas de plazo y dice "habla con el jefe"). Aplica los mismos
 * permisos y la misma barrera que la API: no se aprueba lo que no pasó el validador de citas.
 * Todo es ficticio: no hay negocios, números ni cuentas reales.
 */
import type { AsesorOutput, BusinessMe, ConsoleRecommendationView } from "@blindaje/shared";
import type { AdvisorActor, AdvisorApi, AsesorRunInput, CreateBusinessAccountInput, RecommendationStatus } from "../api/advisor";
import { ApiRequestError } from "../api/client";
import { ORGS } from "./fixtures";

const STATE_KEY = "blindaje.console.mock.asesor";
const MODEL = "muse-spark-1.3";

interface AdvisorState {
  version: 1;
  seq: number;
  recommendations: ConsoleRecommendationView[];
  accounts: BusinessMe[];
}

const QUE_HACER = [
  "No pagues ni negocies. No respondas los mensajes.",
  "Guarda los audios, las capturas y el número que te escribió. No borres el chat.",
  "Si estás en peligro inmediato, llama al 105.",
  "Denuncia en la Línea 1818 o en tu comisaría.",
  "Avisa a tu gremio.",
];

const SESGO = "Más casos en una zona puede significar que ahí se denuncia más, no que sea más peligrosa.";

export function losXContent(zona: string, sector: string): AsesorOutput {
  return {
    sector,
    zona,
    nivel_riesgo: "medio",
    resumen: `En ${zona} circulan audios de alguien que dice ser de “Los X”. Piden un pago por Yape, dan 48 horas de plazo y repiten “habla con el jefe”. No pagues ni negocies: guarda todo y avisa.`,
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
        detalle: "Guárdalos en Blindaje apenas te lleguen y no borres el chat. Sirven para tu denuncia y para que tu gremio vea si los casos se repiten.",
        prioridad: "alta",
      },
      {
        titulo: "Aprende a reconocer el guion",
        detalle: "Si escuchas “habla con el jefe” o te dan 48 horas, es la modalidad de “Los X”. No respondas, guarda el audio y avisa a tu gremio.",
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
    resumen: `Aún no hay suficientes casos para mostrar cifras de ${sector} en ${zona}. Estas son recomendaciones generales de prevención.`,
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
    org_id: "org-bodegas",
    status: "borrador",
    contenido: losXContent("Lima Este", "bodega"),
    citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] },
    model: MODEL,
    created_at: "2026-10-28T13:40:00Z",
    approved_by: null,
    approved_at: null,
  };
  const mototaxis = losXContent("Lima Este", "mototaxi");
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
    org_id: "org-mototaxi",
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
    org_id: "org-bodegas",
    status: "aprobada",
    contenido: {
      sector: "bodega",
      zona: "Lima Este",
      nivel_riesgo: "bajo",
      resumen: "Algunas bodegas recibieron llamadas de un supuesto “cobro de seguridad” del barrio. Nadie del barrio cobra por seguridad: no pagues y avisa a tu gremio.",
      modalidades: [
        {
          descripcion: "Llamadas que se presentan como un “cobro de seguridad” del barrio y piden un pago semanal en efectivo.",
          senales_de_alerta: ["“Es por tu seguridad”", "Cobro cada semana"],
          evidencia: ["FICHA-D", "FICHA-E"],
        },
      ],
      recomendaciones: [
        {
          titulo: "Nadie cobra por la seguridad del barrio",
          detalle: "Si alguien te pide un pago semanal “por tu seguridad”, no pagues. Anota la hora de la llamada y avisa a tu gremio.",
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
  return {
    version: 1,
    seq: 5,
    recommendations: [draftOk, draftBad, approved],
    accounts: [
      {
        id: "biz-santa-rosa",
        email: "bodega@demo.blindaje.pe",
        business_name: "Bodega Santa Rosa (ficticia)",
        sector: "bodega",
        zona: "Lima Este",
        org: { id: "org-bodegas", name: orgName("org-bodegas") },
      },
    ],
  };
}

function orgName(id: string): string {
  return ORGS.find((o) => o.id === id)?.name ?? id;
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
        if (parsed.version === 1) return (this.memory = parsed);
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

  private visible(r: ConsoleRecommendationView): boolean {
    return this.actor.role !== "reviewer" || r.org_id === this.actor.org.id;
  }

  async listRecommendations(status?: RecommendationStatus): Promise<ConsoleRecommendationView[]> {
    await this.wait();
    return this.load()
      .recommendations.filter((r) => this.visible(r) && (!status || r.status === status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async runAsesor(req: AsesorRunInput): Promise<ConsoleRecommendationView[]> {
    if (this.actor.role !== "analyst" && this.actor.role !== "admin") forbidden();
    await this.wait(this.latency * 4);
    const state = this.load();
    const orgId = req.org_id || this.actor.org.id;
    const zona = req.zona?.trim() || null;
    const sector = req.sector?.trim() || null;
    let targets: { zona: string; sector: string }[];
    if (zona && sector) targets = [{ zona, sector }];
    else {
      targets = state.accounts
        .filter((a) => a.org.id === orgId && (!zona || a.zona.toLowerCase() === zona.toLowerCase()) && (!sector || a.sector.toLowerCase() === sector.toLowerCase()))
        .map((a) => ({ zona: a.zona, sector: a.sector }));
      if (!targets.length) {
        throw new ApiRequestError(400, "bad_request", "Indica la zona (y el rubro), o crea primero cuentas de negocio en la organización");
      }
    }
    const created = targets.map((t) => {
      const id = `rec-${String(state.seq++).padStart(3, "0")}`;
      const contenido = t.zona.toLowerCase() === "lima este" ? losXContent(t.zona, t.sector) : sinDatosContent(t.zona, t.sector);
      return {
        id,
        org_id: orgId,
        status: "borrador" as const,
        contenido,
        citation_check: { ok: true, sin_cita: [], citas_inexistentes: [] },
        model: MODEL,
        created_at: this.now().toISOString(),
        approved_by: null,
        approved_at: null,
      };
    });
    this.save({ ...state, recommendations: [...created, ...state.recommendations] });
    return created;
  }

  async decideRecommendation(id: string, decision: "aprobar" | "rechazar"): Promise<ConsoleRecommendationView> {
    if (this.actor.role !== "reviewer" && this.actor.role !== "admin") forbidden();
    await this.wait();
    const state = this.load();
    const r = state.recommendations.find((x) => x.id === id && this.visible(x));
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

  async createBusinessAccount(req: CreateBusinessAccountInput): Promise<BusinessMe> {
    if (this.actor.role !== "admin" && this.actor.role !== "reviewer") forbidden();
    const orgId = req.org_id || this.actor.org.id;
    if (this.actor.role === "reviewer" && orgId !== this.actor.org.id) forbidden("Solo puedes crear cuentas de negocio de tu organización");
    if (req.password.length < 12) throw new ApiRequestError(400, "bad_request", "La contraseña debe tener al menos 12 caracteres.");
    await this.wait();
    const state = this.load();
    const email = req.email.trim().toLowerCase();
    if (state.accounts.some((a) => a.email === email)) throw new ApiRequestError(409, "conflict", "Ya existe una cuenta de negocio con ese correo");
    const account: BusinessMe = {
      id: `biz-${state.seq++}`,
      email,
      business_name: req.business_name.trim(),
      sector: req.sector.trim(),
      zona: req.zona.trim(),
      org: { id: orgId, name: orgName(orgId) },
    };
    this.save({ ...state, accounts: [...state.accounts, account] });
    return account;
  }
}
