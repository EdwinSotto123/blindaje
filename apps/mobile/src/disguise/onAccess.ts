import type { useRouter } from "expo-router";

import type { AccessResult } from "@/security/access";
import { unlock } from "@/state/session";

type R = ReturnType<typeof useRouter>;

/** Después de un PIN correcto: abre las notas (reales o señuelo) o la configuración inicial. */
export function onAccess(router: R, r: Exclude<AccessResult, null>): void {
  if (r === "onboarding") {
    router.replace("/bienvenida");
    return;
  }
  unlock(r);
  router.replace("/privado");
}
