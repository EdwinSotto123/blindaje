import { Container } from "@cloudflare/containers";
import type { Env } from "../env";

/**
 * Contenedor ML (services/ml, FastAPI en el puerto 8080). Se usa con el binding `ML`, que se
 * activa en wrangler.jsonc cuando la imagen está lista (ver README.md).
 *
 * - Sin salida a internet: los modelos van horneados en la imagen y el contenedor procesa
 *   evidencia sensible. Si la imagen necesitara descargar algo al arrancar, cambiar a `true`.
 * - `sleepAfter` largo para evitar arranques en frío durante el demo.
 */
export class MlContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "30m";
  override enableInternet = false;
  override pingEndpoint = "container/health";

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    this.envVars = env.ML_TOKEN ? { ML_TOKEN: env.ML_TOKEN } : {};
  }
}
