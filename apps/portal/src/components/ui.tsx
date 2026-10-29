import type { ReactNode } from "react";
import { errorMessage } from "../api/client";
import { MIN_CASES, MIN_VICTIMS, THRESHOLD_TEXT } from "../config";
import { Icon } from "./Icons";

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <p className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="note note-error" role="alert">
      <Icon name="alert" />
      <div className="stack-xs">
        <p>{errorMessage(error)}</p>
        {onRetry ? (
          <p>
            <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
              <Icon name="refresh" size={18} />
              Intentar otra vez
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Estado vacío: se dibuja la ausencia (borde punteado), nunca un hueco. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="strong">{title}</p>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

/** Nota en una banda hundida, con un ícono de trazo. */
export function Note({ icon = "info", title, children }: { icon?: "info" | "alert" | "shield" | "lock" | "eye"; title?: string; children: ReactNode }) {
  return (
    <div className="note">
      <Icon name={icon} />
      <div className="stack-xs">
        {title ? <p className="strong">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

/**
 * Encabezado de página: el título y una entrada corta. `compact` baja el título cuando la protagonista
 * de la página es otra frase (en Mi zona, la respuesta sobre el riesgo).
 */
export function PageHead({ title, compact = false, children }: { title: string; compact?: boolean; children?: ReactNode }) {
  return (
    <header className={compact ? "page-head page-head-compact" : "page-head"}>
      <h1>{title}</h1>
      {children ? <div className="lead">{children}</div> : null}
    </header>
  );
}

/** Sección de una página, con su título. */
export function Section({ id, title, children, intro }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {intro ? <p className="section-intro">{intro}</p> : null}
      {children}
    </section>
  );
}

/**
 * Aviso de umbral: sin al menos 5 casos de 3 víctimas no hay cifras ni rangos. Nunca muestra un
 * número; la ausencia se dibuja con borde punteado.
 */
export function Threshold({ detail }: { detail?: string | null }) {
  // El aviso de la API suele empezar con la misma frase: se muestra una sola vez.
  const rest = capitalizeFirst((detail ?? "").replace(THRESHOLD_TEXT, "").replace(/^[.:,;\s]+/, "").trim());
  return (
    <div className="threshold" role="note">
      <p className="strong">{THRESHOLD_TEXT}</p>
      <p>{rest || `Solo mostramos cifras cuando hay al menos ${MIN_CASES} casos de ${MIN_VICTIMS} personas distintas, para que nadie pueda ser reconocido.`}</p>
    </div>
  );
}

function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("es-PE") + s.slice(1) : s;
}
