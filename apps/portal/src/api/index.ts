import { API_URL, MOCK } from "../config";
import { MockPortalApi } from "../mock/mockApi";
import type { PortalApi } from "./api";
import { HttpPortalApi } from "./httpApi";

/** Instancia única: API real con VITE_API_URL, o modo simulado. */
export function createApi(): PortalApi {
  return MOCK ? new MockPortalApi() : new HttpPortalApi(API_URL);
}
