import * as S from "@blindaje/shared";
import type { BusinessLoginResponse, BusinessMe, BusinessRecommendationView, RiskOverview, VictimAlert } from "@blindaje/shared";
import type { HealthResponse, PortalApi } from "./api";
import { HttpClient, SessionTokenStore, type TokenStore, type Validator } from "./client";

/** Valida `{ [key]: T[] }` elemento por elemento con un esquema de shared. */
export function listOf(key: string, schema: Validator): Validator {
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

/** Implementación contra la API real (docs/API.md, sección Negocios). */
export class HttpPortalApi implements PortalApi {
  readonly mode = "http" as const;
  readonly client: HttpClient;
  private me: BusinessMe | null = null;

  constructor(baseUrl: string, store: TokenStore = new SessionTokenStore(), fetchImpl?: typeof fetch) {
    this.client = new HttpClient(fetchImpl ? { baseUrl, store, fetch: fetchImpl } : { baseUrl, store });
  }

  onSessionExpired(cb: () => void): void {
    this.client.onSessionExpired = () => {
      this.me = null;
      cb();
    };
  }

  health(): Promise<HealthResponse> {
    return this.client.json<HealthResponse>("GET", "/v1/health", { auth: false });
  }

  async login(email: string, password: string): Promise<BusinessMe> {
    const res = await this.client.json<BusinessLoginResponse>("POST", "/v1/auth/business/login", {
      auth: false,
      body: { email, password },
      validate: S.BusinessLoginResponse,
    });
    this.client.setTokens(res);
    this.me = res.business;
    return res.business;
  }

  async restore(): Promise<BusinessMe | null> {
    if (!this.client.hasSession()) return null;
    try {
      this.me = await this.client.json<BusinessMe>("GET", "/v1/business/me", { validate: S.BusinessMe });
      return this.me;
    } catch {
      this.client.clearSession();
      return null;
    }
  }

  async logout(): Promise<void> {
    const refresh = this.client.getRefreshToken();
    try {
      if (refresh) await this.client.json<void>("POST", "/v1/auth/logout", { body: { refresh_token: refresh } });
    } catch {
      // Cerrar la sesión local aunque la API no responda.
    } finally {
      this.forget();
    }
  }

  forget(): void {
    this.client.clearSession();
    this.me = null;
  }

  risk(opts: { zona?: string; sector?: string } = {}): Promise<RiskOverview> {
    return this.client.json<RiskOverview>("GET", "/v1/business/risk", {
      query: { zona: opts.zona, sector: opts.sector },
      validate: S.RiskOverview,
    });
  }

  async recommendations(): Promise<BusinessRecommendationView[]> {
    const res = await this.client.json<{ recommendations: BusinessRecommendationView[] }>("GET", "/v1/business/recommendations", {
      validate: listOf("recommendations", S.BusinessRecommendationView),
    });
    return res.recommendations;
  }

  async alerts(): Promise<VictimAlert[]> {
    const res = await this.client.json<{ alerts: VictimAlert[] }>("GET", "/v1/business/alerts", {
      validate: listOf("alerts", S.VictimAlert),
    });
    return res.alerts;
  }
}
