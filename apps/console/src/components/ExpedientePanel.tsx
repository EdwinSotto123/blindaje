import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import type { ExpedienteView, ReviewStatus } from "../api/types";
import { useApi } from "../app/context";
import { fmtDateTime } from "../lib/format";
import { Icon } from "./Icons";
import { CopyButton, Notice, StatusBadge } from "./ui";

/**
 * La API no lista expedientes (solo POST para generar y GET por id), así que la consola recuerda
 * en la pestaña los que generó y consulta su estado.
 */
const KEY = "blindaje.console.expedientes";

function remembered(networkId: string): string[] {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, string[]>;
    return all[networkId] ?? [];
  } catch {
    return [];
  }
}

function remember(networkId: string, id: string): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, string[]>;
    all[networkId] = [id, ...(all[networkId] ?? []).filter((x) => x !== id)];
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // sin almacenamiento
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ExpedientePanel({
  networkId,
  networkLabel,
  profileStatus,
}: {
  networkId: string;
  networkLabel: string;
  profileStatus: ReviewStatus | null;
}) {
  const api = useApi();
  const [ids, setIds] = useState<string[]>(() => remembered(networkId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const e = await api.createExpediente(networkId);
      remember(networkId, e.id);
      setIds((prev) => [e.id, ...prev.filter((x) => x !== e.id)]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" aria-labelledby={`exp-${networkId}`}>
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h2 id={`exp-${networkId}`}>
          <Icon name="file" /> Expediente de {networkLabel}
        </h2>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void generate()}>
          <Icon name="file" size={15} />
          {busy ? "Solicitando…" : "Generar expediente PDF"}
        </button>
      </div>
      <p className="small muted">
        El Redactor arma el resumen de la red, la cronología unificada, la tabla de vínculos, las huellas SHA-256 de la evidencia y la cadena de custodia. Solo se
        entrega a la autoridad por un canal formal.
      </p>
      {profileStatus !== "aprobado" ? (
        <Notice kind="warn">El perfil de esta red aún no está aprobado. Revisa sus hipótesis antes de entregar el expediente.</Notice>
      ) : null}
      {error ? <Notice kind="error-box">{error}</Notice> : null}
      {ids.length ? (
        <ul className="list-plain stack-sm">
          {ids.map((id) => (
            <li key={id}>
              <ExpedienteRow id={id} networkLabel={networkLabel} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Todavía no generaste expedientes de esta red en esta sesión.</p>
      )}
    </section>
  );
}

function ExpedienteRow({ id, networkLabel }: { id: string; networkLabel: string }) {
  const api = useApi();
  const [exp, setExp] = useState<ExpedienteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; hash: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Consulta el estado hasta que el PDF esté listo (o falle).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const e = await api.getExpediente(id);
        if (!alive) return;
        setExp(e);
        if (e.status === "generando") timer = setTimeout(() => void poll(), 1000);
      } catch (err) {
        if (alive) setError(errorMessage(err));
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, id]);

  const download = async () => {
    if (!exp) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await api.downloadExpediente(exp.id);
      const hash = await sha256Hex(blob);
      setVerify({ ok: !exp.sha256 || hash === exp.sha256, hash });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expediente-${networkLabel}-${exp.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="panel flat stack-sm">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row">
          <span className="strong">{id}</span>
          {exp ? <StatusBadge status={exp.status} /> : null}
          {exp ? <span className="small muted">{fmtDateTime(exp.created_at)}</span> : null}
        </span>
        {exp?.status === "listo" ? (
          <button type="button" className="btn btn-sm btn-primary" disabled={downloading} onClick={() => void download()}>
            <Icon name="download" size={15} />
            {downloading ? "Descargando…" : "Descargar PDF"}
          </button>
        ) : null}
      </div>
      {exp?.status === "generando" ? <span className="small muted" role="status">El Redactor está generando el PDF…</span> : null}
      {exp?.sha256 ? (
        <div className="stack-sm">
          <span className="small strong">SHA-256 del PDF</span>
          <span className="hash">{exp.sha256}</span>
          <span>
            <CopyButton text={exp.sha256} label="Copiar SHA-256" />
          </span>
        </div>
      ) : null}
      {verify ? (
        <Notice kind={verify.ok ? "success-box" : "error-box"}>
          {verify.ok
            ? "Verificado: el SHA-256 del archivo descargado coincide con el que registró la API."
            : `El archivo descargado no coincide: su SHA-256 es ${verify.hash}.`}
        </Notice>
      ) : null}
      {exp?.status === "error" ? <Notice kind="error-box">El Redactor no pudo generar el PDF. Intenta de nuevo.</Notice> : null}
      {error ? <Notice kind="error-box">{error}</Notice> : null}
    </div>
  );
}
