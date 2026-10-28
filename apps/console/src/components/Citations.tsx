import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { AudioFragment } from "../api/types";
import {
  ID_TYPE_LABEL,
  citationAriaLabel,
  citationKind,
  citationText,
  parseCitations,
  type CitationIndex,
  type CitationTarget,
} from "../lib/citations";
import { CANAL_LABEL, SECTOR_LABEL, fmtDateTime, fmtDuration, fmtScore } from "../lib/format";
import { AuthenticityPanel } from "./Authenticity";
import { Icon } from "./Icons";
import { AudioClip, EvidenceImage } from "./Media";
import { CopyButton, ErrorBox, Loading } from "./ui";
import { useAsync } from "../lib/useAsync";

interface CitationCtx {
  index: CitationIndex;
  open: (ref: string) => void;
}

/** Busca en la API lo que no está en el índice (por ejemplo, la evidencia de un caso de la red). */
export type CitationResolver = (ref: string) => Promise<CitationTarget | undefined>;

const Ctx = createContext<CitationCtx | null>(null);

/** Hace clicables las citas de sus hijos y abre el detalle en un panel lateral. */
export function CitationProvider({ index, resolve, children }: { index: CitationIndex; resolve?: CitationResolver; children: ReactNode }) {
  const [stack, setStack] = useState<string[]>([]);
  const open = useCallback((ref: string) => setStack((s) => (s[s.length - 1] === ref ? s : [...s, ref])), []);
  const value = useMemo(() => ({ index, open }), [index, open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CitationDrawer
        stack={stack}
        index={index}
        resolve={resolve}
        onBack={() => setStack((s) => s.slice(0, -1))}
        onClose={() => setStack([])}
      />
    </Ctx.Provider>
  );
}

export function CiteChip({ refId, missing = false }: { refId: string; missing?: boolean }) {
  const ctx = useContext(Ctx);
  const kind = citationKind(refId) ?? "evidencia";
  const text = citationText(refId, ctx?.index);
  if (!ctx) {
    return (
      <span className="cite" data-kind={kind}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`cite${missing ? " cite-missing" : ""}`}
      data-kind={kind}
      aria-label={`${citationAriaLabel(refId, ctx.index)}${missing ? " (cita inexistente)" : ""}`}
      title={kind === "identificador" ? undefined : refId}
      onClick={() => ctx.open(refId)}
    >
      {text}
    </button>
  );
}

/** Texto de un agente con sus citas convertidas en botones. */
export function CitedText({ text, missing }: { text: string; missing?: string[] }) {
  const segments = useMemo(() => parseCitations(text), [text]);
  return (
    <>
      {segments.map((s, i) =>
        s.type === "text" ? <span key={i}>{s.text}</span> : <CiteChip key={i} refId={s.ref} missing={missing?.includes(s.ref)} />,
      )}
    </>
  );
}

/** Lista de citas (campo `evidencia` de una afirmación). */
export function CiteList({ refs, missing, label = "Evidencia" }: { refs: string[]; missing?: string[]; label?: string }) {
  if (refs.length === 0) {
    return <span className="chip chip-danger">Sin cita</span>;
  }
  return (
    <span className="cite-list" role="group" aria-label={label}>
      {refs.map((r) => (
        <CiteChip key={r} refId={r} missing={missing?.includes(r)} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Panel lateral
// ---------------------------------------------------------------------------

function CitationDrawer({
  stack,
  index,
  resolve,
  onBack,
  onClose,
}: {
  stack: string[];
  index: CitationIndex;
  resolve: CitationResolver | undefined;
  onBack: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const current = stack[stack.length - 1];
  const isOpen = current !== undefined;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="cita-titulo"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {current ? (
        <div className="drawer-inner">
          <div className="drawer-head">
            <div className="stack-sm">
              {stack.length > 1 ? (
                <span>
                  <button type="button" className="btn btn-sm btn-quiet" onClick={onBack}>
                    <Icon name="arrowLeft" size={14} />
                    Volver a {citationText(stack[stack.length - 2]!, index)}
                  </button>
                </span>
              ) : null}
              <h2 id="cita-titulo">{titleFor(current, index.get(current))}</h2>
            </div>
            <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Cerrar panel">
              <Icon name="x" size={16} />
            </button>
          </div>
          {index.get(current) || !resolve ? (
            <TargetDetail refId={current} target={index.get(current)} onNavigate={onClose} />
          ) : (
            <ResolvedDetail key={current} refId={current} resolve={resolve} onNavigate={onClose} />
          )}
        </div>
      ) : null}
    </dialog>
  );
}

function titleFor(ref: string, t: CitationTarget | undefined): string {
  switch (citationKind(ref)) {
    case "evidencia":
      return `Evidencia ${ref}`;
    case "ficha":
      return `Ficha del caso ${ref.slice(6)}`;
    case "voz":
      return `Huella de voz ${ref}`;
    case "identificador":
      return `Identificador ${citationText(ref, t ? new Map([[ref, t]]) : undefined)}`;
    case "vinculo":
      return `Vínculo ${ref}`;
    case "imagen":
      return `Recorte ${ref}`;
    case "red":
      return `Red ${ref}`;
    default:
      return ref;
  }
}

function ResolvedDetail({ refId, resolve, onNavigate }: { refId: string; resolve: CitationResolver; onNavigate: () => void }) {
  const res = useAsync(() => resolve(refId), `cita:${refId}`);
  if (res.loading) return <Loading label="Buscando la evidencia citada…" />;
  if (res.error) return <ErrorBox error={res.error} onRetry={res.reload} />;
  return <TargetDetail refId={refId} target={res.data} onNavigate={onNavigate} />;
}

const TIPO_EVIDENCIA: Record<string, string> = { audio: "Audio", imagen: "Imagen", video: "Video", texto: "Mensaje de texto" };
const ROL_LABEL: Record<string, string> = { contacto: "Número de contacto", cobro: "Cuenta de cobro", vehiculo: "Vehículo" };

function TargetDetail({ refId, target, onNavigate }: { refId: string; target: CitationTarget | undefined; onNavigate: () => void }) {
  if (!target) {
    return (
      <div className="stack-sm">
        <p>
          La cita <code>{refId}</code> no tiene detalle en esta vista.
        </p>
        <p className="muted small">
          Puede pertenecer a un caso que no está cargado aquí o no existir. El validador de citas de la API marca como inválidas las citas inexistentes.
        </p>
      </div>
    );
  }
  switch (target.kind) {
    case "evidencia": {
      const full: AudioFragment | null =
        target.tipo === "audio" && target.fragments.length === 0
          ? {
              evidence_label: target.ref,
              evidence_id: target.evidenceId,
              voice_label: "audio completo",
              start_ms: 0,
              end_ms: target.duration_ms ?? 0,
              text: null,
              media_url: `/v1/console/evidence/${encodeURIComponent(target.evidenceId)}/media`,
            }
          : null;
      return (
        <div className="stack">
          <dl className="dl">
            <dt>Caso</dt>
            <dd>
              <CiteChip refId={`FICHA-${target.caseCode}`} />
            </dd>
            <dt>Tipo</dt>
            <dd>{TIPO_EVIDENCIA[target.tipo] ?? target.tipo}</dd>
            <dt>Recibido</dt>
            <dd>{fmtDateTime(target.received_utc)} (hora de Lima)</dd>
            {target.duration_ms != null ? (
              <>
                <dt>Duración</dt>
                <dd>{fmtDuration(target.duration_ms)}</dd>
              </>
            ) : null}
          </dl>
          <div className="stack-sm">
            <span className="strong">Huella de integridad (SHA-256)</span>
            <span className="hash">{target.sha256}</span>
            <span>
              <CopyButton text={target.sha256} label="Copiar SHA-256" />
            </span>
          </div>
          {target.fragments.map((f) => (
            <AudioClip key={`${f.evidence_id}-${f.start_ms}`} fragment={f} />
          ))}
          {full ? <AudioClip fragment={full} /> : null}
          {target.tipo === "imagen" || target.tipo === "video" ? <EvidenceImage evidenceId={target.evidenceId} label={target.ref} /> : null}
          {target.tipo === "texto" ? <p className="muted small">El texto del mensaje está resumido en la ficha del caso.</p> : null}
          {target.tipo !== "texto" && target.autenticidad !== undefined ? <AuthenticityPanel result={target.autenticidad} tipo={target.tipo} /> : null}
        </div>
      );
    }
    case "ficha": {
      const f = target.ficha;
      if (!f) {
        return (
          <p className="muted">
            La ficha completa del caso {target.caseCode} se ve en la cola de vínculos y en el expediente de la red.
          </p>
        );
      }
      return (
        <div className="stack">
          <dl className="dl">
            <dt>Sector</dt>
            <dd>{f.sector ? (SECTOR_LABEL[f.sector] ?? f.sector) : "—"}</dd>
            <dt>Zona</dt>
            <dd>{f.zona ?? "—"}</dd>
            <dt>Primer contacto</dt>
            <dd>{fmtDateTime(f.primer_contacto)}</dd>
            <dt>Amenaza</dt>
            <dd>{f.amenaza ?? "—"}</dd>
            <dt>Monto</dt>
            <dd>{f.monto_soles != null ? `S/ ${f.monto_soles.toLocaleString("es-PE")}` : "—"}{f.periodicidad && f.periodicidad !== "unico" ? ` (${f.periodicidad})` : ""}</dd>
            <dt>Plazo</dt>
            <dd>{f.plazo ?? "—"}</dd>
            <dt>Canal de pago</dt>
            <dd>{f.canal_pago ? (CANAL_LABEL[f.canal_pago] ?? f.canal_pago) : "—"}</dd>
            <dt>Dice ser de</dt>
            <dd>{f.grupo_que_dice_ser ? `“${f.grupo_que_dice_ser}”` : "—"}</dd>
          </dl>
          <div className="stack-sm">
            <span className="strong">Frases firma</span>
            <ul>
              {f.frases_firma.map((p) => (
                <li key={p} className="phrase">
                  “{p}”
                </li>
              ))}
            </ul>
          </div>
          <div className="stack-sm">
            <span className="strong">Identificadores cifrados</span>
            {f.identificadores.length ? (
              <ul className="list-plain stack-sm">
                {f.identificadores.map((i) => (
                  <li key={i.ref} className="row">
                    <CiteChip refId={i.ref} /> <span className="small muted">{ROL_LABEL[i.rol] ?? i.rol}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted">Ninguno</span>
            )}
          </div>
          {f.escalamiento.length ? (
            <div className="stack-sm">
              <span className="strong">Escalamiento</span>
              <ul>
                {f.escalamiento.map((e, i) => (
                  <li key={i}>
                    {e.fecha ?? "Sin fecha"}: {e.tipo} <CiteList refs={e.evidencia} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="stack-sm">
            <span className="strong">Modus operandi</span>
            <p>{f.resumen_mo}</p>
          </div>
          <div className="row">
            <span className="small muted">Fuentes:</span>
            <CiteList refs={f.fuentes} />
          </div>
          <p className="small muted">La ficha no incluye datos personales de la víctima.</p>
        </div>
      );
    }
    case "voz":
      return (
        <div className="stack">
          <dl className="dl">
            <dt>Casos</dt>
            <dd>{target.cases.length ? target.cases.map((c) => `Caso ${c}`).join(", ") : "—"}</dd>
            {target.huellas.length > 1 || target.huellas[0] !== target.ref ? (
              <>
                <dt>Huellas agrupadas</dt>
                <dd>{target.huellas.join(", ")}</dd>
              </>
            ) : null}
            {target.segmentos != null ? (
              <>
                <dt>Segmentos</dt>
                <dd>{target.segmentos} de al menos 3 s</dd>
              </>
            ) : null}
          </dl>
          {target.fragments.map((f) => (
            <AudioClip key={`${f.evidence_id}-${f.start_ms}`} fragment={f} />
          ))}
          <p className="small muted">
            Una huella de voz es un vector calculado con un modelo abierto; no identifica a una persona y nunca vincula casos por sí sola.
          </p>
        </div>
      );
    case "identificador":
      return (
        <div className="stack">
          <p style={{ fontSize: "1.6rem", fontWeight: 700 }} aria-label={`Termina en ${target.ultimos_3 ?? "dato no disponible"}`}>
            {target.ultimos_3 ? `…${target.ultimos_3}` : target.ref}
          </p>
          <dl className="dl">
            <dt>Tipo</dt>
            <dd>{target.tipo ? (ID_TYPE_LABEL[target.tipo] ?? target.tipo) : "—"}</dd>
            {target.rol ? (
              <>
                <dt>Uso</dt>
                <dd>{ROL_LABEL[target.rol] ?? target.rol}</dd>
              </>
            ) : null}
            <dt>Referencia</dt>
            <dd>
              <code>{target.ref}</code>
            </dd>
            <dt>Aparece en</dt>
            <dd>{target.cases.length ? target.cases.map((c) => `Caso ${c}`).join(", ") : "—"}</dd>
          </dl>
          {target.evidencia.length ? (
            <div className="row">
              <span className="small muted">Evidencia:</span>
              <CiteList refs={target.evidencia} />
            </div>
          ) : null}
          <p className="small muted">
            El valor está cifrado con HMAC-SHA256 y la clave de la alianza. La consola solo muestra los últimos 3 caracteres.
          </p>
        </div>
      );
    case "vinculo":
      return (
        <div className="stack">
          <dl className="dl">
            <dt>Casos</dt>
            <dd>{target.cases.map((c) => `Caso ${c}`).join(" y ")}</dd>
            {target.score != null ? (
              <>
                <dt>Puntaje</dt>
                <dd>{fmtScore(target.score)}</dd>
              </>
            ) : null}
          </dl>
          {target.linkId ? (
            <span>
              <Link className="btn btn-sm" to={`/vinculos/${encodeURIComponent(target.linkId)}`} onClick={onNavigate}>
                Abrir vínculo
              </Link>
            </span>
          ) : null}
        </div>
      );
    case "imagen":
      return (
        <div className="stack">
          {target.descripcion ? <p>{target.descripcion}</p> : null}
          <dl className="dl">
            <dt>Casos</dt>
            <dd>{target.cases.map((c) => `Caso ${c}`).join(", ") || "—"}</dd>
          </dl>
          {target.evidencia.length ? (
            <div className="row">
              <span className="small muted">De la evidencia:</span>
              <CiteList refs={target.evidencia} />
            </div>
          ) : null}
          <p className="small muted">Recorte de SAM 3.1 comparado con DINOv2 y hash perceptual.</p>
        </div>
      );
    case "red":
      return target.networkId ? (
        <span>
          <Link className="btn btn-sm" to={`/redes/${encodeURIComponent(target.networkId)}`} onClick={onNavigate}>
            Abrir red
          </Link>
        </span>
      ) : (
        <p className="muted">Red {target.ref}.</p>
      );
  }
}
