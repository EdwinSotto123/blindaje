import { z } from "zod";

import { ApiError, type Fetcher, type HttpResponse, NetworkError } from "@/api/http";
import {
  BusinessRecommendationView,
  CaseSummary,
  type ConsentMode,
  type CreateCaseRequest,
  DeviceRegisterResponse,
  districtOfZone,
  type EvidenceType,
  EvidenceItem,
  type Sector,
  SubmitCaseResponse,
  TokenPair,
  VictimAlert,
  VictimReport,
} from "@/shared";
import type { DevicePublicJwk } from "@/security/device";

/**
 * Sesión del dispositivo guardada en el almacenamiento seguro. Desde el rediseño del 28/10 no guarda
 * la organización: la víctima reporta directo al equipo central y la app no muestra ningún gremio.
 */
export type AuthState = {
  device_id: string;
  access_token: string;
  refresh_token: string;
  /** Unix ms en que vence el access token. */
  expires_at: number;
  pseudonym: string;
};

export type DevicePlatform = "android" | "ios" | "web";

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
  /**
   * Llave pública y plataforma para registrar este celular sin código (`ensureRegistered`). Si está
   * y `autoRegister` lo permite, una llamada sin sesión registra primero: así la primera subida
   * conecta el celular cuando "Empezar" no tuvo internet. Sin esto, una llamada sin sesión falla con 401.
   */
  device?: () => Promise<{ publicKey: DevicePublicJwk; platform: DevicePlatform }>;
  /**
   * Si una llamada sin sesión puede registrar el celular por su cuenta (por defecto, sí). La app solo
   * lo permite con la configuración terminada: después de un borrado de emergencia, una subida que
   * quedó en curso no debe crear una sesión nueva.
   */
  autoRegister?: () => boolean;
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

/**
 * La respuesta del registro todavía trae `org`, pero el API la va a quitar: se acepta que falte. La
 * app no la usa.
 */
const RegisterResponse = DeviceRegisterResponse.extend({ org: z.object({ id: z.string(), name: z.string() }).nullish() });

/**
 * Pedido para crear un caso con lo que eligió la persona. La zona va solo como id de distrito
 * (DISTRICTS); el texto libre de versiones anteriores se traduce a su distrito o no se manda, porque
 * podría traer una dirección.
 */
export function caseRequestFrom(cfg: { consent: ConsentMode; sector: Sector | null; zona: string | null }): Partial<CreateCaseRequest> {
  const distrito = districtOfZone(cfg.zona);
  return {
    consent_mode: cfg.consent,
    ...(cfg.sector ? { sector: cfg.sector } : {}),
    ...(distrito ? { zona: distrito.id } : {}),
  };
}

/** "?zona=ate&sector=bodega" con lo que haya; vacío si no hay nada. */
function query(params: Record<string, string | null | undefined>): string {
  const parts = Object.entries(params)
    .filter((e): e is [string, string] => !!e[1])
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** GET /v1/recommendations: mismo estilo que { alerts }. También se acepta un arreglo directo. */
const RecommendationsResponse = z.union([
  z.object({ recommendations: z.array(BusinessRecommendationView) }).transform((r) => r.recommendations),
  z.array(BusinessRecommendationView),
]);

/** Cliente tipado de la API de víctima. Valida cada respuesta con los esquemas compartidos. */
export class BlindajeApi {
  private refreshing: Promise<AuthState> | null = null;
  private registering: Promise<AuthState> | null = null;

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
    const auto = this.o.device && (this.o.autoRegister?.() ?? true);
    const a = (await this.o.auth.get()) ?? (auto ? await this.ensureRegistered() : null);
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

  /**
   * Registra este celular con su llave P-256 (la privada no sale del celular). Sin código de
   * invitación: el API lo deja en la organización central y la víctima reporta directo.
   */
  async registerDevice(publicKey: DevicePublicJwk, platform: DevicePlatform): Promise<AuthState> {
    const res = await this.send("/auth/device/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ public_key: publicKey, platform }),
    });
    if (!res.ok) await this.fail(res);
    const r = RegisterResponse.parse(await res.json());
    const state: AuthState = {
      device_id: r.device_id,
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: this.now() + r.expires_in * 1000,
      pseudonym: r.pseudonym,
    };
    await this.o.auth.set(state);
    return state;
  }

  /**
   * La sesión de este celular; si todavía no tiene, lo registra. Una sola petición a la vez:
   * "Empezar", la muestra de voz y la primera subida pueden pedirlo al mismo tiempo.
   */
  async ensureRegistered(): Promise<AuthState> {
    const a = await this.o.auth.get();
    if (a) return a;
    const device = this.o.device;
    if (!device) throw new ApiError(401, "unauthorized", "Dispositivo sin registrar");
    if (!this.registering) {
      this.registering = (async () => {
        const { publicKey, platform } = await device();
        return this.registerDevice(publicKey, platform);
      })().finally(() => {
        this.registering = null;
      });
    }
    return this.registering;
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

  /**
   * Avisos aprobados por el equipo central para la zona de la persona. `zona` es el id del distrito
   * que eligió en la app; sin distrito, el API decide (por ejemplo, el de su último caso).
   */
  async alerts(zona?: string | null) {
    return (await this.json(z.object({ alerts: z.array(VictimAlert) }), `/alerts${query({ zona })}`)).alerts;
  }

  /**
   * Recomendaciones de prevención aprobadas por el equipo central para su distrito y su rubro. Un
   * 404 (la API todavía no tiene la ruta) se lee como lista vacía: la pantalla no se rompe.
   */
  async recommendations(f: { zona?: string | null; sector?: string | null } = {}): Promise<BusinessRecommendationView[]> {
    try {
      return await this.json(RecommendationsResponse, `/recommendations${query({ zona: f.zona, sector: f.sector })}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }
  }
}
