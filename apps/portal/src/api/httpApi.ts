import * as S from "@blindaje/shared";
import type { BusinessRecommendationView, PublicRiskOverview, PublicZoneMap, VictimAlert } from "@blindaje/shared";
import { sanitizeAlerts, sanitizeRecommendations, sanitizeRisk, sanitizeZones, unwrapList } from "../lib/publicData";
import type { HealthResponse, PortalApi, ZoneQuery } from "./api";
import { HttpClient, type Validator } from "./client";

/** Valida `[...]` o `{ [key]: [...] }` elemento por elemento con un esquema de shared. */
export function listOf(key: string, schema: Validator): Validator {
  return {
    safeParse(value: unknown) {
      const arr = Array.isArray(value) ? value : (value as Record<string, unknown> | undefined)?.[key];
      if (!Array.isArray(arr)) return { success: false, error: `Falta el arreglo "${key}"` };
      for (const [i, item] of arr.entries()) {
        const r = schema.safeParse(item);
        if (!r.success) return { success: false, error: { index: i, error: r.error } };
      }
      return { success: true };
    },
  };
}

/**
 * Implementación contra la API real: solo rutas públicas (/v1/public), sin credenciales. Todo lo que
 * llega pasa otra vez por las reglas de lo público (lib/publicData) antes de llegar a una vista.
 */
export class HttpPortalApi implements PortalApi {
  readonly mode = "http" as const;
  readonly client: HttpClient;

  constructor(baseUrl: string, fetchImpl?: typeof fetch) {
    this.client = new HttpClient(fetchImpl ? { baseUrl, fetch: fetchImpl } : { baseUrl });
  }

  health(): Promise<HealthResponse> {
    return this.client.json<HealthResponse>("GET", "/v1/health");
  }

  async zones(): Promise<PublicZoneMap> {
    return sanitizeZones(await this.client.json<unknown>("GET", "/v1/public/zones", { validate: S.PublicZoneMap }));
  }

  async risk(q: ZoneQuery): Promise<PublicRiskOverview> {
    const raw = await this.client.json<unknown>("GET", "/v1/public/risk", {
      query: { zona: q.zona, sector: q.sector },
      validate: S.PublicRiskOverview,
    });
    return sanitizeRisk(raw);
  }

  async recommendations(q: ZoneQuery): Promise<BusinessRecommendationView[]> {
    const raw = await this.client.json<unknown>("GET", "/v1/public/recommendations", {
      query: { zona: q.zona, sector: q.sector },
      validate: listOf("recommendations", S.BusinessRecommendationView),
    });
    return sanitizeRecommendations(unwrapList(raw, "recommendations"), q.zona);
  }

  async alerts(q: { zona: string }): Promise<VictimAlert[]> {
    const raw = await this.client.json<unknown>("GET", "/v1/public/alerts", {
      query: { zona: q.zona },
      validate: listOf("alerts", S.VictimAlert),
    });
    return sanitizeAlerts(unwrapList(raw, "alerts"), q.zona);
  }
}
