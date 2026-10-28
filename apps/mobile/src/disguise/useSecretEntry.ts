import { useRouter } from "expo-router";
import { useCallback } from "react";

import { isSecretAmount, useHoldToOpen } from "@/disguise/secret";
import { configStore, useConfig } from "@/state/config";

/** Conecta las dos entradas secretas con el teclado de la calculadora de vuelto. */
export function useSecretEntry() {
  const router = useRouter();
  const holdTitle = useConfig((c) => c.holdTitle);

  const openPad = useCallback(
    (ventaCents?: number) => {
      router.push({ pathname: "/calculadora", params: ventaCents != null ? { e: "1", venta: String(ventaCents) } : { e: "1" } });
    },
    [router],
  );

  const hold = useHoldToOpen(() => openPad(), holdTitle);

  /** Devuelve true si el monto es el secreto (y abre el teclado en lugar de guardar). */
  const checkAmount = useCallback(
    (cents: number | null, replace = false) => {
      if (!isSecretAmount(cents, configStore.get())) return false;
      if (replace) router.replace({ pathname: "/calculadora", params: { e: "1", venta: String(cents) } });
      else openPad(cents ?? undefined);
      return true;
    },
    [openPad, router],
  );

  return { hold, checkAmount, openPad };
}
