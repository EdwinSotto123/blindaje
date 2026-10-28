import { useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../api/client";
import { Icon } from "./Icons";

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <div className="stack-sm">
        <span>{errorMessage(error)}</span>
        {onRetry ? (
          <span>
            <button type="button" className="btn btn-sm btn-danger" onClick={onRetry}>
              Reintentar
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Notice({ kind = "notice", children }: { kind?: "notice" | "warn" | "success-box" | "error-box"; children: ReactNode }) {
  const icon = kind === "warn" || kind === "error-box" ? "alert" : kind === "success-box" ? "check" : "info";
  return (
    <div className={kind} role={kind === "error-box" ? "alert" : undefined}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  probable: "Probable",
  por_revisar: "Por revisar",
  descartado_auto: "Descartado (auto)",
  confirmado: "Confirmado",
  descartado: "Descartado",
  borrador: "Borrador",
  aprobado: "Aprobado",
  aprobada: "Aprobada",
  rechazado: "Rechazado",
  rechazada: "Rechazada",
  descartada: "Descartada",
  invalido: "Inválido",
  generando: "Generando",
  listo: "Listo",
  error: "Error",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{statusLabel(status)}</span>;
}

/** Barra horizontal para una probabilidad entre 0 y 1, con marcas de umbral opcionales. */
export function Meter({ value, label, ticks = [] }: { value: number; label: string; ticks?: number[] }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
      {ticks.map((t) => (
        <i key={t} className="tick" style={{ left: `${t * 100}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}

const CONF_LEVEL: Record<string, number> = { baja: 1, media: 2, alta: 3 };

export function Confidence({ value }: { value: string }) {
  const n = CONF_LEVEL[value] ?? 0;
  return (
    <span className="conf">
      <span className="conf-dots" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= n ? "on" : ""} />
        ))}
      </span>
      Confianza {value}
    </span>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => setDone(false),
        );
      }}
    >
      <Icon name={done ? "check" : "copy"} size={15} />
      <span aria-live="polite">{done ? "Copiado" : label}</span>
    </button>
  );
}

/**
 * Confirmación en línea para una decisión que no se puede deshacer. Dice la consecuencia en
 * texto visible, lleva el foco a "Cancelar" (Enter dos veces no decide nada) y Escape cancela.
 * Es la misma fricción para el "sí" y para el "no".
 */
export function InlineConfirm({
  id,
  question,
  detail,
  confirmLabel,
  busyLabel,
  busy = false,
  icon = "check",
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  id: string;
  question: ReactNode;
  detail?: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
  icon?: "check" | "x";
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      className="confirm-inline"
      role="group"
      aria-labelledby={`${id}-q`}
      aria-describedby={detail ? `${id}-d` : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p id={`${id}-q`} className="strong">
        {question}
      </p>
      {detail ? (
        <p id={`${id}-d`} className="small">
          {detail}
        </p>
      ) : null}
      <div className="row">
        <button type="button" className={`btn btn-lg ${tone === "danger" ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={onConfirm}>
          <Icon name={icon} />
          {busy ? busyLabel : confirmLabel}
        </button>
        <button ref={cancelRef} type="button" className="btn btn-lg btn-quiet" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Diálogo modal nativo (foco atrapado y Escape para cerrar). */
export function Modal({
  open,
  onClose,
  title,
  children,
  labelledBy = "modal-title",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={labelledBy} onClose={onClose} onCancel={onClose}>
      {open ? (
        <div className="modal-inner">
          <h2 id={labelledBy}>{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function PageHead({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {children ? <p>{children}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

/** Mensaje temporal anunciado por lectores de pantalla. */
export function useFlash(): [ReactNode, (msg: string, kind?: "success-box" | "error-box" | "notice") => void] {
  const [flash, setFlash] = useState<{ msg: string; kind: "success-box" | "error-box" | "notice"; id: number } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);
  const node = (
    <div aria-live="polite" role="status">
      {flash ? <Notice kind={flash.kind}>{flash.msg}</Notice> : null}
    </div>
  );
  return [node, (msg, kind = "success-box") => setFlash({ msg, kind, id: Date.now() })];
}
