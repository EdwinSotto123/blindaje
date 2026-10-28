import { z } from "zod";

import { ApiError, type Fetcher, type HttpResponse, NetworkError } from "@/api/http";
import {
  BusinessRecommendationView,
  CaseSummary,
  type ConsentMode,
  type CreateCaseRequest,
  DeviceRegisterResponse,
  type EvidenceType,
  EvidenceItem,
  SubmitCaseResponse,
  TokenPair,
  VictimAlert,
  VictimReport,
} from "@/shared";
import type { DevicePublicJwk } from "@/security/device";

/** Sesión del dispositivo guardada en el almacenamiento seguro. */
export type AuthState = {
  device_id: string;
  access_token: string;
  refresh_token: string;
  /** Unix ms en que vence el access token. */
  expires_at: number;
  pseudonym: string;
  org: { id: string; name: string };
};

export interface AuthStore {
  get(): Promise<AuthState | null>;
  set(a: AuthState): Promise<void>;
  clear(): Promise<void>;
}

export type EvidenceUpload = {
  tipo: EvidenceType;
  mime: string;
  sha256: string;
  capturedAt?: string | null;
  source?: "grabacion" | "compartido" | "camara" | "galeria" | "pegado" | "relato";
  durationMs?: number | null;
};

type Opts = {
  baseUrl: string;
  fetcher: Fetcher;
  auth: AuthStore;
  /** Firma `refresh:${device_id}:${timestamp}` con la llave privada del dispositivo. */
  sign: (deviceId: string, timestamp: number) => Promise<string>;
  now?: () => number;
};

const SKEW_MS = 30_000;

/**
 * Reporte de la víctima con `consejos` (consejos de prevención según su propio caso, nunca de
 * otros casos). La API lo va a agregar, pero todavía no está en el contrato de shared y
 * VictimReport es strict: sin esta extensión el cliente rechazaría el reporte entero. Si el campo
 * falta o viene mal formado, se lee como []. Funciona igual cuando shared ya lo tenga
 * (`consejos: string[]`, por defecto []); entonces basta con volver a VictimReport.
 */
export const VictimReportConConsejos = VictimReport.extend({
  consejos: z.array(z.string()).catch([]),
});
export type VictimReportConConsejos = z.infer<typeof VictimReportConConsejos>;

/** GET /v1/recommendations: mismo estilo que { alerts }. También se acepta un arreglo directo. */
const RecommendationsResponse = z.union([
  z.object({ recommendations: z.array(BusinessRecommendationView) }).transform((r) => r.recommendations),
  z.array(BusinessRecommendationView),
]);

/** Cliente tipado de la API de víctima. Valida cada respuesta con los esquemas compartidos. */
export class BlindajeApi {
  private refreshing: Promise<AuthState> | null = null;

  constructor(private readonly o: Opts) {}

  private now() {
    return this.o.now ? this.o.now() : Date.now();
  }

  private async send(path: string, init: { method: "GET" | "POST" | "PUT" | "DELETE"; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<HttpResponse> {
    try {
      return await this.o.fetcher(`${this.o.baseUrl}/v1${path}`, { method: init.method, headers: init.headers ?? {}, body: init.body });
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : "Sin conexión");
    }
  }

  private async fail(res: HttpResponse): Promise<never> {
    let code = "internal";
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // cuerpo vacío o no JSON
    }
    throw new ApiError(res.status, code, message);
  }

  private async token(): Promise<AuthState> {
    const a = await this.o.auth.get();
    if (!a) throw new ApiError(401, "unauthorized", "Dispositivo sin registrar");
    if (a.expires_at - SKEW_MS > this.now()) return a;
    return this.refresh();
  }

  /** Refresh firmado con la llave del dispositivo. Una sola petición a la vez. */
  async refresh(): Promise<AuthState> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const a = await this.o.auth.get();
        if (!a) throw new ApiError(401, "unauthorized", "Dispositivo sin registrar");
        const timestamp = this.now();
        const signature = await this.o.sign(a.device_id, timestamp);
        const res = await this.send("/auth/device/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device_id: a.device_id, refresh_token: a.refresh_token, timestamp, signature }),
        });
        if (!res.ok) await this.fail(res);
        const t = TokenPair.parse(await res.json());
        const next: AuthState = {
          ...a,
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: this.now() + t.expires_in * 1000,
        };
        await this.o.auth.set(next);
        return next;
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async authed(path: string, init: { method: "GET" | "POST" | "PUT" | "DELETE"; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<HttpResponse> {
    let a = await this.token();
    let res = await this.send(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${a.access_token}` } });
    if (res.status === 401) {
      a = await this.refresh();
      res = await this.send(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${a.access_token}` } });
    }
    if (!res.ok) await this.fail(res);
    return res;
  }

  private async json<S extends z.ZodType>(schema: S, path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown): Promise<z.infer<S>> {
    const res = await this.authed(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return schema.parse(await res.json());
  }

  // -------------------------------------------------------------------------
  // Autenticación
  // -------------------------------------------------------------------------

  async registerDevice(inviteCode: string, publicKey: DevicePublicJwk, platform: "android" | "ios" | "web"): Promise<AuthState> {
    const res = await this.send("/auth/device/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite_code: inviteCode, public_key: publicKey, platform }),
    });
    if (!res.ok) await this.fail(res);
    const r = DeviceRegisterResponse.parse(await res.json());
    const state: AuthState = {
      device_id: r.device_id,
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: this.now() + r.expires_in * 1000,
      pseudonym: r.pseudonym,
      org: r.org,
    };
    await this.o.auth.set(state);
    return state;
  }

  async logout(): Promise<void> {
    const a = await this.o.auth.get();
    if (!a) return;
    const res = await this.send("/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${a.access_token}` },
      body: JSON.stringify({ refresh_token: a.refresh_token }),
    });
    if (!res.ok && res.status !== 401) await this.fail(res);
  }

  // -------------------------------------------------------------------------
  // Víctima
  // -------------------------------------------------------------------------

  async uploadVoiceSample(bytes: Uint8Array, mime: string): Promise<void> {
    await this.authed("/me/voice-sample", { method: "POST", headers: { "content-type": mime }, body: bytes });
  }

  createCase(req: Partial<CreateCaseRequest>) {
    return this.json(CaseSummary, "/cases", "POST", req);
  }

  async listCases() {
    return (await this.json(z.object({ cases: z.array(CaseSummary) }), "/cases")).cases;
  }

  async uploadEvidence(caseId: string, body: Uint8Array, u: EvidenceUpload) {
    const headers: Record<string, string> = {
      "content-type": u.mime,
      "x-evidence-type": u.tipo,
      "x-content-sha256": u.sha256,
    };
    if (u.capturedAt) headers["x-captured-at"] = u.capturedAt;
    if (u.source) headers["x-source"] = u.source;
    if (u.durationMs != null) headers["x-duration-ms"] = String(Math.round(u.durationMs));
    const res = await this.authed(`/cases/${encodeURIComponent(caseId)}/evidence`, { method: "POST", headers, body });
    return EvidenceItem.parse(await res.json());
  }

  submitCase(caseId: string, narrative?: string) {
    return this.json(SubmitCaseResponse, `/cases/${encodeURIComponent(caseId)}/submit`, "POST", narrative ? { narrative } : {});
  }

  getReport(caseId: string): Promise<VictimReportConConsejos> {
    return this.json(VictimReportConConsejos, `/cases/${encodeURIComponent(caseId)}/report`);
  }

  async getReportPdf(caseId: string): Promise<Uint8Array> {
    const res = await this.authed(`/cases/${encodeURIComponent(caseId)}/report.pdf`, { method: "GET", headers: { accept: "application/pdf" } });
    return res.bytes();
  }

  setConsent(caseId: string, mode: ConsentMode) {
    return this.json(CaseSummary, `/cases/${encodeURIComponent(caseId)}/consent`, "PUT", { mode });
  }

  async deleteCase(caseId: string): Promise<void> {
    await this.authed(`/cases/${encodeURIComponent(caseId)}`, { method: "DELETE" });
  }

  async alerts() {
    return (await this.json(z.object({ alerts: z.array(VictimAlert) }), "/alerts")).alerts;
  }

  /**
   * Recomendaciones de prevención aprobadas por el gremio. Un 404 (la API todavía no tiene la
   * ruta) se lee como lista vacía: la pantalla no se rompe.
   */
  async recommendations(): Promise<BusinessRecommendationView[]> {
    try {
      return await this.json(RecommendationsResponse, "/recommendations");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }
  }
}
