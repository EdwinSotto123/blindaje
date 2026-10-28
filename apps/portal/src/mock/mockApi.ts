import type { BusinessMe, BusinessRecommendationView, RiskOverview, VictimAlert } from "@blindaje/shared";
import type { HealthResponse, PortalApi } from "../api/api";
import { ApiRequestError } from "../api/client";
import {
  alertsBodegas,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  recommendationsBodegas,
  riskBodegasLimaEste,
  riskLimaEste,
  riskTransporteLimaSur,
} from "./fixtures";

const SESSION_KEY = "blindaje.portal.mock";

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export interface MockOptions {
  /** Milisegundos de espera simulada por llamada (0 en tests). */
  latency?: number;
  /** Usa sessionStorage para que la sesión sobreviva a una recarga (por defecto, sí). */
  persist?: boolean;
}

/**
 * API simulada con la historia ficticia de Lima Este. Mismo contrato que la API real: el panorama
 * solo trae cifras agregadas, y nunca hay búsqueda por número, cuenta ni placa.
 */
export class MockPortalApi implements PortalApi {
  readonly mode = "mock" as const;
  private me: BusinessMe | null = null;
  private expired: (() => void) | undefined;
  private readonly latency: number;
  private readonly persist: boolean;

  constructor(opts: MockOptions = {}) {
    this.latency = opts.latency ?? 260;
    this.persist = opts.persist ?? true;
  }

  private async wait(): Promise<void> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
  }

  private requireMe(): BusinessMe {
    if (!this.me) {
      this.expired?.();
      throw new ApiRequestError(401, "unauthorized", "Tu sesión terminó. Vuelve a entrar.");
    }
    return this.me;
  }

  onSessionExpired(cb: () => void): void {
    this.expired = cb;
  }

  async health(): Promise<HealthResponse> {
    return { ok: true, env: "demo-simulado", version: "simulado" };
  }

  async login(email: string, password: string): Promise<BusinessMe> {
    await this.wait();
    const account = DEMO_ACCOUNTS.find((a) => a.me.email === email.trim().toLowerCase());
    if (!account || password !== DEMO_PASSWORD) {
      throw new ApiRequestError(401, "unauthorized", "El correo o la contraseña no coinciden.");
    }
    this.me = account.me;
    if (this.persist) storage()?.setItem(SESSION_KEY, account.me.id);
    return account.me;
  }

  async restore(): Promise<BusinessMe | null> {
    const id = this.persist ? storage()?.getItem(SESSION_KEY) : null;
    this.me = DEMO_ACCOUNTS.find((a) => a.me.id === id)?.me ?? null;
    return this.me;
  }

  async logout(): Promise<void> {
    this.forget();
  }

  forget(): void {
    this.me = null;
    if (this.persist) storage()?.removeItem(SESSION_KEY);
  }

  async risk(opts: { zona?: string; sector?: string } = {}): Promise<RiskOverview> {
    const me = this.requireMe();
    await this.wait();
    const zona = opts.zona ?? me.zona;
    // Igual que la API: con zona y sin rubro, el panorama es de todos los rubros de esa zona.
    const sector = opts.sector || (opts.zona ? null : me.sector);
    if (zona === "Lima Este") return sector === null ? riskLimaEste() : sector === "bodega" ? riskBodegasLimaEste() : withSector(riskLimaEste(), sector);
    return riskTransporteLimaSur(sector);
  }

  async recommendations(): Promise<BusinessRecommendationView[]> {
    const me = this.requireMe();
    await this.wait();
    return me.org.id === "org-bodegas" ? recommendationsBodegas() : [];
  }

  async alerts(): Promise<VictimAlert[]> {
    const me = this.requireMe();
    await this.wait();
    return me.org.id === "org-bodegas" ? alertsBodegas() : [];
  }
}

/** Otro rubro de Lima Este: como en la API, si el rubro no alcanza el umbral las cifras son de toda la zona. */
function withSector(zone: RiskOverview, _sector: string): RiskOverview {
  return {
    ...zone,
    sector: null,
    aviso_umbral: "Aún no hay suficientes casos de tu rubro en esta zona para mostrar cifras propias: las cifras son de toda la zona.",
  };
}
