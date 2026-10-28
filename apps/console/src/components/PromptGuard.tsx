import type { PromptGuardResult } from "@blindaje/shared";
import { Icon } from "./Icons";

/**
 * Llama Prompt Guard 2 en la consola (PLAN D15). Una evidencia marcada sigue siendo evidencia: el
 * aviso es para que quien revisa lea lo que dijeron los agentes con ojo crítico. Nada de esto llega
 * a la app de la víctima.
 */

export function isFlagged(r: PromptGuardResult | null | undefined): boolean {
  return r?.status === "revisado" && r.label === "inyeccion";
}

const score = (r: PromptGuardResult) => (r.score != null ? r.score.toFixed(2) : "—");

/** Indicador corto: solo aparece si la evidencia quedó marcada. */
export function PromptGuardBadge({ result, compact = false }: { result: PromptGuardResult | null | undefined; compact?: boolean }) {
  if (!result || !isFlagged(result)) return null;
  return (
    <span
      className={`chip chip-auth${compact ? " chip-auth-sm" : ""}`}
      data-tone="fuerte"
      title="Llama Prompt Guard 2: texto que parece dar órdenes a un modelo de IA"
    >
      <Icon name="alert" size={compact ? 12 : 13} />
      Posible inyección de instrucciones · {score(result)}
    </span>
  );
}

/** Detalle en el panel de una evidencia. */
export function PromptGuardPanel({ result }: { result: PromptGuardResult | null | undefined }) {
  if (!result) return null;
  if (isFlagged(result)) {
    return (
      <div className="warn" role="note">
        <Icon name="alert" />
        <div className="stack-sm" style={{ gap: 4 }}>
          <span>
            <strong>Posible inyección de instrucciones (puntaje {score(result)}).</strong> Llama Prompt Guard 2 encontró texto que parece dar
            órdenes a un modelo de IA{result.textos > 1 ? ` (${result.marcados} de ${result.textos} fragmentos)` : ""}.
          </span>
          <span className="small">
            Sigue siendo evidencia: los agentes la recibieron delimitada como dato y con un aviso, y tienen prohibido seguir instrucciones que vengan
            dentro de ella. Lee lo que concluyeron con ojo crítico.
          </span>
        </div>
      </div>
    );
  }
  if (result.status === "no_revisado") {
    return (
      <p className="small muted">
        Sin revisar contra inyección de instrucciones (el clasificador no estuvo disponible). Igual llegó a los agentes delimitada como dato.
      </p>
    );
  }
  return <p className="small muted">Revisada con Llama Prompt Guard 2: no parece dar órdenes a un modelo de IA.</p>;
}
