/**
 * Cargadores de las vistas con carga diferida. Viven aparte para que el menú pueda precargarlas
 * (al pasar el puntero y, en segundo plano, apenas se entra) sin depender de App.
 */
export const VIEW_LOADERS = {
  admin: () => import("./AdminView"),
  alerts: () => import("./AlertsView"),
  audit: () => import("./AuditView"),
  costs: () => import("./CostsView"),
  expedientes: () => import("./ExpedientesView"),
  leaks: () => import("./LeaksView"),
  monitor: () => import("./MonitorView"),
  networkDetail: () => import("./NetworkDetailView"),
  networks: () => import("./NetworksView"),
  recommendations: () => import("./RecommendationsView"),
  vectors: () => import("./VectorsView"),
  zones: () => import("./ZonesView"),
};

export type ViewName = keyof typeof VIEW_LOADERS;

/** Descarga el código de las vistas sin bloquear: el navegador lo guarda y navegar ya no espera. */
export function preloadViews(names: ViewName[] = Object.keys(VIEW_LOADERS) as ViewName[]): void {
  for (const n of names) void VIEW_LOADERS[n]().catch(() => undefined);
}
