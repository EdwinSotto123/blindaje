import "../styles/leaks.css";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { LeakTraceKind, LeakTraceResult } from "@blindaje/shared";
import { errorMessage } from "../api/client";
import { leaksFor, MAX_LEAK_BYTES } from "../api/leaks";
import { useApi, useUser } from "../app/context";
import { Icon } from "../components/Icons";
import { Notice, PageHead } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { pctBits, ROL_CUENTA } from "../lib/leaks";

/**
 * Rastrear filtración (solo administración, PLAN D14). Si un audio o una imagen de la evidencia
 * aparece afuera, se sube aquí: Blindaje busca la marca invisible de la copia y dice desde qué cuenta
 * salió. Son indicios, nunca una acusación: el archivo no se guarda y el rastreo queda en la auditoría.
 */
export function LeaksView() {
  const api = useApi();
  const user = useUser();
  const leaks = useMemo(() => leaksFor(api, { id: user.id, role: user.role }), [api, user.id, user.role]);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"auto" | LeakTraceKind>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; data: LeakTraceResult } | null>(null);
  const fileId = useId();
  const kindId = useId();

  const tooBig = file ? file.size > MAX_LEAK_BYTES : false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || tooBig) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await leaks.trace(file, kind === "auto" ? undefined : kind);
      setResult({ name: file.name, data });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Rastrear filtración">
        Cada audio o imagen que sale de la consola lleva una marca invisible con la cuenta que lo pidió. Si encuentras una copia afuera (reenviada por
        WhatsApp, publicada en redes), súbela aquí para ver desde qué cuenta salió.
      </PageHead>

      <section className="panel stack" aria-labelledby="rastreo-form">
        <h2 id="rastreo-form" className="sr-only">
          Subir la copia
        </h2>
        <form className="leak-form" onSubmit={(e) => void submit(e)}>
          <div className="leak-drop">
            <label htmlFor={fileId} className="strong">
              Copia sospechosa (audio o imagen)
            </label>
            <input
              id={fileId}
              type="file"
              accept="audio/*,image/*"
              onChange={(e) => {
                setFile(e.currentTarget.files?.[0] ?? null);
                setResult(null);
                setError(null);
              }}
            />
            <span className="small muted">Hasta 50 MB. Los videos todavía no llevan marca.</span>
            {tooBig ? <span className="small strong">El archivo supera 50 MB.</span> : null}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <label htmlFor={kindId} className="small strong">
              Tipo
            </label>
            <select id={kindId} value={kind} onChange={(e) => setKind(e.currentTarget.value as "auto" | LeakTraceKind)}>
              <option value="auto">Detectar por el archivo</option>
              <option value="audio">Audio</option>
              <option value="imagen">Imagen</option>
            </select>
          </div>
          <span>
            <button type="submit" className="btn btn-primary" disabled={!file || tooBig || busy}>
              <Icon name="search" size={16} />
              {busy ? "Buscando la marca…" : "Rastrear"}
            </button>
          </span>
          <p className="small muted">
            <Icon name="lock" size={13} /> El archivo no se guarda: solo su huella SHA-256 y el resultado quedan en la auditoría, con tu cuenta.
          </p>
        </form>
      </section>

      <div aria-live="polite" className="stack">
        {error ? <Notice kind="error-box">{error}</Notice> : null}
        {result ? <LeakResult name={result.name} result={result.data} /> : null}
      </div>
    </>
  );
}

/** Resultado del rastreo, con lenguaje de indicios. Exportado para los tests. */
export function LeakResult({ name, result }: { name: string; result: LeakTraceResult }) {
  const found = result.candidates.length > 0;
  const what = result.kind === "audio" ? "audio" : "imagen";
  return (
    <section className="panel leak-result" aria-labelledby="rastreo-resultado">
      <div className="panel-head">
        <h2 id="rastreo-resultado">{found ? (result.ambiguo ? "Indicios de origen (ambiguos)" : "Indicios de origen") : "Sin coincidencias"}</h2>
        <span className="small muted">
          {name} · {what} · marca {result.detected ? "detectada" : "no detectada"} (puntaje {result.score.toFixed(2)}
          {result.model ? `, ${result.model}` : ""})
        </span>
      </div>

      {found ? (
        <ul className="list-plain leak-candidates">
          {result.candidates.map((c) => (
            <li key={`${c.user_id}-${c.issued_at ?? ""}`} className="leak-candidate">
              <span className="stack-sm" style={{ gap: 2 }}>
                <span className="strong">{c.display_name ?? c.email_or_name}</span>
                <span className="small muted">
                  {c.email_or_name}
                  {c.role ? ` · ${ROL_CUENTA[c.role] ?? c.role}` : ""}
                </span>
              </span>
              <span className="leak-accuracy" aria-label={`${pctBits(c.bit_accuracy)} de los bits coinciden`}>
                {pctBits(c.bit_accuracy)} de bits
              </span>
              <dl className="dl small">
                {result.kind === "imagen" ? (
                  <>
                    <dt>Evidencia</dt>
                    <dd>{c.evidence_label ?? "El caso ya se borró"}</dd>
                    <dt>Copia entregada</dt>
                    <dd>{c.issued_at ? `${fmtDateTime(c.issued_at)} (hora de Lima)` : "—"}</dd>
                  </>
                ) : (
                  <>
                    <dt>Último audio marcado</dt>
                    <dd>{c.issued_at ? `${fmtDateTime(c.issued_at)} (hora de Lima)` : "Esta cuenta no recibió audios marcados"}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p>{result.detected ? "Hay una marca, pero no coincide con ninguna copia que haya salido de la consola." : "No encontramos una marca de Blindaje en este archivo."}</p>
      )}

      {result.ambiguo ? (
        <Notice kind="warn">
          <span>
            <strong>Más de una cuenta podría explicar esta marca.</strong> No atribuyas la filtración a nadie con este resultado.
          </span>
        </Notice>
      ) : null}

      <p className="small">{result.nota}</p>
      <p className="small muted">
        Antes de actuar, revisa en la auditoría los accesos de esa cuenta y habla con su organización. Este resultado no basta para señalar a nadie.
      </p>
    </section>
  );
}
