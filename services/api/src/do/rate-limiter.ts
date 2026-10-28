import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Segundos hasta que vuelva a haber cupo (0 si se permitió). */
  retry_after: number;
}

/**
 * Limitador de ventana deslizante aproximada (ventana actual + fracción de la anterior).
 * Una instancia por clave (`idFromName("<bucket>:<ip|sub>:<valor>")`), así que todo el estado
 * vive en memoria y el Durable Object serializa los accesos. Si se desaloja, la ventana se
 * reinicia: aceptable para un limitador.
 */
export class RateLimiter extends DurableObject<Env> {
  private windowStart = 0;
  private count = 0;
  private prevCount = 0;

  hit(limit: number, windowSec: number, cost = 1): RateLimitResult {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const currentStart = Math.floor(now / windowMs) * windowMs;
    if (currentStart !== this.windowStart) {
      this.prevCount = currentStart - this.windowStart === windowMs ? this.count : 0;
      this.windowStart = currentStart;
      this.count = 0;
    }
    const elapsed = (now - currentStart) / windowMs;
    const estimated = this.prevCount * (1 - elapsed) + this.count;
    if (estimated + cost > limit) {
      const retry = Math.max(1, Math.ceil((currentStart + windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retry_after: retry };
    }
    this.count += cost;
    return { allowed: true, remaining: Math.max(0, Math.floor(limit - estimated - cost)), retry_after: 0 };
  }

  reset(): void {
    this.windowStart = 0;
    this.count = 0;
    this.prevCount = 0;
  }
}
