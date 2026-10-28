import type { ProfileView } from "@blindaje/shared";
import type { Env } from "../env";
import { NotImplementedError } from "../lib/errors";
import type { Actor } from "../types";

export interface CartografoOptions {
  model: "muse-spark-1.3" | "muse-wonder-1.0";
  actor: Actor;
}

/** Cartógrafo (10.3): perfil de red con hechos e hipótesis citados. STUB. */
export async function runCartografo(_env: Env, _networkId: string, _opts: CartografoOptions): Promise<ProfileView> {
  throw new NotImplementedError("Cartógrafo");
}
