import * as S from "@blindaje/shared";
import type { ConsoleMonitor } from "@blindaje/shared";
import { MockMonitorApi } from "../mock/monitorMock";
import type { BlindajeApi } from "./api";
import type { HttpClient } from "./client";
import { HttpApi } from "./httpApi";

/**
 * Monitoreo (docs/API.md, /v1/console/monitoreo, solo admin). Como el motor vectorial, vive aparte
 * de `BlindajeApi`: con la API real usa el mismo `HttpClient` y en modo simulado arma el panel con
 * las colas del `MockApi`.
 */
export interface MonitorApi {
  monitor(): Promise<ConsoleMonitor>;
}

export class HttpMonitorApi implements MonitorApi {
  constructor(private readonly client: HttpClient) {}

  monitor(): Promise<ConsoleMonitor> {
    return this.client.json<ConsoleMonitor>("GET", "/v1/console/monitoreo", { validate: S.ConsoleMonitor });
  }
}

export function monitorFor(api: BlindajeApi): MonitorApi {
  return api instanceof HttpApi ? new HttpMonitorApi(api.client) : new MockMonitorApi(api);
}
