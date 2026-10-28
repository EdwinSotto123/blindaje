import type { Context } from "hono";
import type { Role } from "@blindaje/shared";
import type { Env } from "./env";

export interface AuthContext {
  /** device_id (víctima), user_id (consola) o id de la cuenta de negocio (business). */
  sub: string;
  role: Role;
  org: string;
  /** Seudónimo de la víctima (V-7F3K). */
  pse?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    reqId: string;
    auth: AuthContext;
  };
};

export type AppContext = Context<AppEnv>;

/** Tipo de actor para la auditoría. */
export type ActorType = "victim" | "reviewer" | "analyst" | "admin" | "business" | "system";

export interface Actor {
  actor_type: ActorType;
  actor_id: string;
}

export const SYSTEM_ACTOR: Actor = { actor_type: "system", actor_id: "system" };

export function actorOf(auth: AuthContext): Actor {
  return { actor_type: auth.role, actor_id: auth.role === "victim" ? (auth.pse ?? auth.sub) : auth.sub };
}
