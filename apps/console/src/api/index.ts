import { API_URL, MOCK } from "../config";
import { MockApi } from "../mock/mockApi";
import type { BlindajeApi } from "./api";
import { HttpApi } from "./httpApi";

/** Instancia única: API real con VITE_API_URL, o modo simulado. */
export function createApi(): BlindajeApi {
  return MOCK ? new MockApi() : new HttpApi(API_URL);
}
