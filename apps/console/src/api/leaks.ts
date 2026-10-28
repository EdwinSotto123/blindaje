import * as S from "@blindaje/shared";
import type { ConsoleRole, LeakTraceKind, LeakTraceResult } from "@blindaje/shared";
import { MockLeaksApi } from "../mock/leaksMock";
import type { BlindajeApi } from "./api";
import type { HttpClient } from "./client";
import { HttpApi } from "./httpApi";

/**
 * Rastreo de filtraciones (docs/API.md, POST /v1/console/leaks/trace, solo admin). Vive aparte de
 * `BlindajeApi`, como el Asesor: con la API real usa el mismo `HttpClient` (con su refresh) y en
 * modo simulado, `MockLeaksApi`.
 */

/** Mismo límite que las subidas de evidencia. */
export const MAX_LEAK_BYTES = 50 * 1024 * 1024;

export interface LeaksApi {
  /** Sube la copia sospechosa (no se guarda) y devuelve los indicios de origen. */
  trace(file: Blob, kind?: LeakTraceKind): Promise<LeakTraceResult>;
}

export class HttpLeaksApi implements LeaksApi {
  constructor(private readonly client: HttpClient) {}

  trace(file: Blob, kind?: LeakTraceKind): Promise<LeakTraceResult> {
    return this.client.json<LeakTraceResult>("POST", "/v1/console/leaks/trace", {
      query: { kind },
      raw: { data: file, contentType: file.type || "application/octet-stream" },
      validate: S.LeakTraceResult,
    });
  }
}

export interface LeaksActor {
  id: string;
  role: ConsoleRole;
}

export function leaksFor(api: BlindajeApi, actor: LeaksActor): LeaksApi {
  return api instanceof HttpApi ? new HttpLeaksApi(api.client) : new MockLeaksApi(actor);
}
