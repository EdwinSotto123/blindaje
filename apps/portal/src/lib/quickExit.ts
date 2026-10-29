import { QUICK_EXIT_URL } from "../config";

/**
 * Salir rápido: abre una página neutra en otra pestaña y reemplaza esta entrada del historial, sin
 * esperar a la red. El portal no tiene sesión ni guarda nada en el aparato, así que no hay nada más
 * que borrar: la zona elegida vive solo en la URL que se reemplaza.
 */
export function quickExit(win: Pick<Window, "open"> & { location: Pick<Location, "replace"> } = window): void {
  win.open(QUICK_EXIT_URL, "_blank", "noopener,noreferrer");
  win.location.replace(QUICK_EXIT_URL);
}
