import { lock } from "@/state/session";

/** Lo mínimo del router de Expo Router que hace falta (facilita los tests). */
export type ExitRouter = {
  canDismiss: () => boolean;
  dismissAll: () => void;
  replace: (href: "/") => void;
};

/**
 * Salir rápido: bloquea primero (el contenido privado desaparece al instante), limpia la pila
 * y deja solo el disfraz. También se usa al pasar a segundo plano.
 */
export function quickExit(router: ExitRouter): void {
  lock();
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    // sin pila que limpiar
  }
  router.replace("/");
}
