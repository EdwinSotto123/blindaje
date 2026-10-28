import { useCallback, useEffect, useRef } from "react";

import type { AppConfig } from "@/state/config";

/**
 * Entradas secretas (configurables):
 * 1. Mantener presionado el título del disfraz 2 segundos.
 * 2. Anotar una venta (o un producto, o un total) con el monto secreto, por defecto S/ 18.18.
 * Las dos abren el teclado de la calculadora de vuelto, donde se ingresa el PIN.
 */
export const HOLD_MS = 2000;

export function isSecretAmount(cents: number | null | undefined, cfg: Pick<AppConfig, "secretAmountCents">): boolean {
  return cents != null && cfg.secretAmountCents != null && cents === cfg.secretAmountCents;
}

export function holdReached(startedAt: number | null, now: number, ms = HOLD_MS): boolean {
  return startedAt !== null && now - startedAt >= ms;
}

/**
 * Detector de "mantener presionado". Dispara al cumplirse el tiempo aunque el dedo siga
 * apoyado; soltar antes no hace nada visible.
 */
export function useHoldToOpen(onOpen: () => void, enabled: boolean, ms = HOLD_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onOpen);
  cb.current = onOpen;

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onPressIn = useCallback(() => {
    if (!enabled) return;
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      cb.current();
    }, ms);
  }, [enabled, ms, clear]);

  useEffect(() => clear, [clear]);

  return { onPressIn, onPressOut: clear };
}
