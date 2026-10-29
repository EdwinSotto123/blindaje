import * as S from "@blindaje/shared";
import type { ConsoleRecommendationView, ConsoleRole } from "@blindaje/shared";
import type { BlindajeApi } from "./api";
import type { HttpClient, Validator } from "./client";
import { MockAdvisorApi } from "../mock/advisorMock";
import { HttpApi } from "./httpApi";

/**
 * Asesor en la consola (docs/API.md, sección Negocios; docs/rediseno.md). Vive aparte de
 * `BlindajeApi` para no tocar el contrato que comparten las demás vistas: con la API real usa el
 * mismo `HttpClient` (con su refresh), y en modo simulado, `MockAdvisorApi`.
 *
 * Desde el rediseño no hay cuentas de negocio: el portal es público y cada recomendación va a un
 * distrito y un rubro, no a las cuentas de un gremio.
 */
export type RecommendationStatus = ConsoleRecommendationView["status"];

export interface AsesorRunInput {
  /** Id del distrito (DISTRICTS), por ejemplo "san-juan-de-lurigancho". La API acepta también el nombre. */
  zona: string;
  sector: string;
}

export interface AdvisorApi {
  listRecommendations(status?: RecommendationStatus): Promise<ConsoleRecommendationView[]>;
  runAsesor(req: AsesorRunInput): Promise<ConsoleRecommendationView[]>;
  decideRecommendation(id: string, decision: "aprobar" | "rechazar"): Promise<ConsoleRecommendationView>;
}

/** Valida `{ [key]: T[] }` elemento por elemento con un esquema de shared. */
function listOf(key: string, schema: Validator): Validator {
  return {
    safeParse(value: unknown) {
      const arr = (value as Record<string, unknown> | undefined)?.[key];
      if (!Array.isArray(arr)) return { success: false, error: `Falta el arreglo "${key}"` };
      for (const [i, item] of arr.entries()) {
        const r = schema.safeParse(item);
        if (!r.success) return { success: false, error: { index: i, error: r.error } };
      }
      return { success: true };
    },
  };
}

/** Quita los campos vacíos: la API trata "sin zona" distinto de una zona en blanco. */
function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v !== "string" || v.trim() !== "")) as Partial<T>;
}

export class HttpAdvisorApi implements AdvisorApi {
  constructor(private readonly client: HttpClient) {}

  async listRecommendations(status?: RecommendationStatus): Promise<ConsoleRecommendationView[]> {
    const res = await this.client.json<{ recommendations: ConsoleRecommendationView[] }>("GET", "/v1/console/recommendations", {
      query: { status },
      validate: listOf("recommendations", S.ConsoleRecommendationView),
    });
    return res.recommendations;
  }

  async runAsesor(req: AsesorRunInput): Promise<ConsoleRecommendationView[]> {
    const res = await this.client.json<{ recommendations: ConsoleRecommendationView[] }>("POST", "/v1/console/asesor/run", {
      body: compact(req),
      validate: listOf("recommendations", S.ConsoleRecommendationView),
    });
    return res.recommendations;
  }

  decideRecommendation(id: string, decision: "aprobar" | "rechazar"): Promise<ConsoleRecommendationView> {
    return this.client.json<ConsoleRecommendationView>("POST", `/v1/console/recommendations/${encodeURIComponent(id)}/decision`, {
      body: { decision },
      validate: S.ConsoleRecommendationView,
    });
  }
}

/** Quién pide, para que el modo simulado aplique los mismos permisos que la API. */
export interface AdvisorActor {
  id: string;
  role: ConsoleRole;
  display_name: string;
  org: { id: string; name: string };
}

export function advisorFor(api: BlindajeApi, actor: AdvisorActor): AdvisorApi {
  return api instanceof HttpApi ? new HttpAdvisorApi(api.client) : new MockAdvisorApi(actor);
}
