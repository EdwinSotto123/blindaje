/**
 * Configuración de la consola en tiempo de build.
 *
 *  - VITE_API_URL: base de la API real. "self" es el mismo origen de la consola (su Worker pasa /v1/*
 *    a blindaje-api); también acepta una URL absoluta (https://blindaje-api.<cuenta>.workers.dev).
 *    No "/": Git Bash en Windows lo convierte en "C:/Program Files/Git/".
 *  - VITE_MOCK=1 (o `--mode mock`): modo simulado con datos ficticios, sin backend.
 *
 * Sin VITE_API_URL la consola arranca en modo simulado: nunca intenta adivinar una API.
 */
const env = import.meta.env;

const RAW_API_URL = (env.VITE_API_URL ?? "").trim();

export const API_URL: string =
  RAW_API_URL === "self" ? (typeof window === "undefined" ? "" : window.location.origin) : RAW_API_URL.replace(/\/+$/, "");

export const MOCK: boolean = env.VITE_MOCK === "1" || env.MODE === "mock" || RAW_API_URL === "";

/** Presupuesto por defecto si la API no lo informa (META_BUDGET_USD). */
export const DEFAULT_BUDGET_USD = 150;

/** Al 80% del presupuesto se bloquean las llamadas no esenciales (Muse Wonder, Muse Image). */
export const NONESSENTIAL_BLOCK_PCT = 80;
