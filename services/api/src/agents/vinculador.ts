import type { VinculadorOutput } from "@blindaje/shared";
import type { Env } from "../env";
import type { CandidatePair } from "../linking";

/** Vinculador (10.2): ajusta el puntaje y explica un par candidato. STUB: devuelve null (sin ajuste). */
export async function runVinculador(_env: Env, _pair: CandidatePair): Promise<{ output: VinculadorOutput; valid: boolean } | null> {
  return null;
}
