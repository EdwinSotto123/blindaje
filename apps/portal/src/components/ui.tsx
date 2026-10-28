import type { ReactNode } from "react";
import { errorMessage } from "../api/client";
import { THRESHOLD_TEXT } from "../config";
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

/** Estado vacío: se dibuja la ausencia (hoja punteada), nunca un hueco. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="strong">{title}</p>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

/** Nota sobre hoja blanca con un ícono de trazo. */
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
 * Encabezado de página: título de cuaderno (Kalam) y una entrada corta. La nota del margen es una
 * anotación a la izquierda de la línea roja; repite la idea del título, así que no se lee dos veces.
 */
export function PageHead({ title, margin, children }: { title: string; margin: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <span className="mnote" aria-hidden="true">
        {margin}
      </span>
      <h1>{title}</h1>
      {children ? <div className="lead">{children}</div> : null}
    </header>
  );
}

/** Sección de una página: renglón nuevo con su nota del margen y su título. */
export function Section({ id, title, margin, children, intro }: { id: string; title: string; margin: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={id}>
      <span className="mnote" aria-hidden="true">
        {margin}
      </span>
      <h2 id={id}>{title}</h2>
      {intro ? <p className="section-intro">{intro}</p> : null}
      {children}
    </section>
  );
}

/**
 * Aviso de umbral: sin al menos 5 casos de 3 víctimas no hay cifras. Nunca muestra un número; la
 * ausencia se dibuja con borde punteado.
 */
export function Threshold({ detail }: { detail?: string | null }) {
  // El aviso de la API suele empezar con la misma frase: se muestra una sola vez.
  const rest = (detail ?? "").replace(THRESHOLD_TEXT, "").replace(/^[.\s]+/, "").trim();
  return (
    <div className="threshold" role="note">
      <p className="strong">{THRESHOLD_TEXT}</p>
      <p>{rest || "Solo mostramos cifras cuando hay al menos 5 casos de 3 personas distintas, para que nadie pueda ser reconocido."}</p>
    </div>
  );
}

/** Cifra o, si no se cumple el umbral, la frase en lugar del número. */
export function Figure({ value, unit }: { value: number | null; unit: (n: number) => string }) {
  if (value === null) return <span className="pencil">sin cifra</span>;
  return <span className="num strong">{unit(value)}</span>;
}
