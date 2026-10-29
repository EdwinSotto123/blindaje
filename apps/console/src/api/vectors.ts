import * as S from "@blindaje/shared";
import type { ConsoleRole, VectorOverview, VectorSyncResult, VectorTrace } from "@blindaje/shared";
import { MockVectorsApi } from "../mock/vectorsMock";
import type { BlindajeApi } from "./api";
import type { HttpClient } from "./client";
import { HttpApi } from "./httpApi";

/**
 * Motor vectorial (docs/API.md, /v1/console/vectores, solo admin). Vive aparte de `BlindajeApi`,
 * como el rastreo de filtraciones: con la API real usa el mismo `HttpClient` (con su refresh) y en
 * modo simulado, `MockVectorsApi`.
 */
export interface VectorsApi {
  /** Estado de la base vectorial, colecciones, casos indexados y el mapa de cada colección. */
  overview(): Promise<VectorOverview>;
  /** Corre de verdad las búsquedas de un caso en la base vectorial y calcula sus candidatos. */
  trace(caseId: string): Promise<VectorTrace>;
  /** Copia a la base vectorial los vectores de D1 (la fuente de verdad). */
  sync(): Promise<VectorSyncResult>;
}

export class HttpVectorsApi implements VectorsApi {
  constructor(private readonly client: HttpClient) {}

  overview(): Promise<VectorOverview> {
    return this.client.json<VectorOverview>("GET", "/v1/console/vectores", { validate: S.VectorOverview });
  }

  trace(caseId: string): Promise<VectorTrace> {
    return this.client.json<VectorTrace>("POST", "/v1/console/vectores/consulta", { body: { case_id: caseId }, validate: S.VectorTrace });
  }

  sync(): Promise<VectorSyncResult> {
    return this.client.json<VectorSyncResult>("POST", "/v1/console/vectores/sincronizar", { validate: S.VectorSyncResult });
  }
}

export interface VectorsActor {
  id: string;
  role: ConsoleRole;
}

export function vectorsFor(api: BlindajeApi, actor: VectorsActor): VectorsApi {
  return api instanceof HttpApi ? new HttpVectorsApi(api.client) : new MockVectorsApi(actor);
}
