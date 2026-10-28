import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { combineSignals, signalProbabilities } from "@blindaje/shared";
import { errorMessage } from "../api/client";
import type { AudioFragment, CaseSide, LinkStatus, LinkView, Signals } from "../api/types";
import { useApi, useUser } from "../app/context";
import { CiteChip, CiteList, CitationProvider, CitedText } from "../components/Citations";
import { Icon, type IconName } from "../components/Icons";
import { AudioClip } from "../components/Media";
import { Empty, ErrorBox, Loading, Meter, Notice, PageHead, StatusBadge, useFlash } from "../components/ui";
import { indexFromLink } from "../lib/citations";
import { CANAL_LABEL, SECTOR_LABEL, fmtDateTime, fmtScore } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const PENDING: LinkStatus[] = ["probable", "por_revisar"];
const REVIEWED: LinkStatus[] = ["confirmado", "descartado"];

const SIGNAL_META: Record<keyof Signals, { label: string; fuerza: string; icon: IconName }> = {
  identificador: { label: "Identificador igual", fuerza: "Fuerte", icon: "key" },
  voz: { label: "Voz", fuerza: "Media", icon: "mic" },
  imagen: { label: "Imagen reutilizada", fuerza: "Media", icon: "image" },
  modus_operandi: { label: "Modus operandi", fuerza: "Débil", icon: "message" },
};
const SIGNAL_ORDER: (keyof Signals)[] = ["identificador", "voz", "imagen", "modus_operandi"];

/** Prioriza los "probable" y, dentro de cada estado, el puntaje más alto. */
export function sortQueue(links: LinkView[]): LinkView[] {
  const rank = (s: LinkStatus) => (s === "probable" ? 0 : s === "por_revisar" ? 1 : 2);
  return [...links].sort((a, b) => rank(a.status) - rank(b.status) || b.score - a.score);
}

export function LinksView() {
  const api = useApi();
  const navigate = useNavigate();
  const { id } = useParams();
  const [tab, setTab] = useState<"pendientes" | "revisados">("pendientes");
  const queue = useAsync(() => api.listLinks(tab === "pendientes" ? PENDING : REVIEWED).then(sortQueue), `links:${tab}`);
  const [flash, showFlash] = useFlash();

  // Sin vínculo elegido: abrir el primero de la cola.
  const first = queue.data?.[0]?.id;
  useEffect(() => {
    if (!id && first && tab === "pendientes") navigate(`/vinculos/${encodeURIComponent(first)}`, { replace: true });
  }, [id, first, tab, navigate]);

  const onDecided = (link: LinkView) => {
    showFlash(
      link.status === "confirmado"
        ? `${link.label} confirmado. Entró al grafo y las redes se recalcularon.`
        : `${link.label} descartado. Queda guardado para recalibrar el motor.`,
    );
    const rest = (queue.data ?? []).filter((l) => l.id !== link.id);
    queue.setData(rest);
    const next = rest[0];
    navigate(next ? `/vinculos/${encodeURIComponent(next.id)}` : "/vinculos", { replace: true });
  };

  return (
    <>
      <PageHead title="Cola de vínculos">
        Cada vínculo es una hipótesis: solo entra al grafo cuando una persona lo confirma. Primero los probables (0.90 o más), luego los que están por
        revisar (0.60 a 0.90).
      </PageHead>
      {flash}
      <div className="queue-layout">
        <section className="stack-sm" aria-labelledby="cola-titulo">
          <h2 id="cola-titulo" className="sr-only">
            Vínculos
          </h2>
          <div className="segmented" role="group" aria-label="Filtrar la cola">
            <button type="button" aria-pressed={tab === "pendientes"} onClick={() => setTab("pendientes")}>
              Por revisar
            </button>
            <button type="button" aria-pressed={tab === "revisados"} onClick={() => setTab("revisados")}>
              Revisados
            </button>
          </div>
          {queue.error ? <ErrorBox error={queue.error} onRetry={queue.reload} /> : null}
          {queue.loading && !queue.data ? <Loading /> : null}
          {queue.data && queue.data.length === 0 ? (
            <Empty title={tab === "pendientes" ? "La cola está vacía" : "Aún no hay vínculos revisados"}>
              {tab === "pendientes" ? "No hay pares candidatos sobre el umbral de 0.60." : null}
            </Empty>
          ) : null}
          <ul className="list-plain queue-list">
            {queue.data?.map((l) => (
              <li key={l.id}>
                <Link to={`/vinculos/${encodeURIComponent(l.id)}`} className="queue-item" aria-current={l.id === id ? "page" : undefined}>
                  <span className="top">
                    <span className="strong">
                      {l.label} · Caso {l.case_a.code} y Caso {l.case_b.code}
                    </span>
                    <span className="score" aria-label={`Puntaje ${fmtScore(l.score)}`}>
                      {fmtScore(l.score)}
                    </span>
                  </span>
                  <span className="kinds">
                    <StatusBadge status={l.status} />
                    {SIGNAL_ORDER.filter((k) => l.signals[k] && (l.signals[k]?.p ?? 0) >= 0.15).map((k) => (
                      <span key={k} className="chip chip-grid">
                        {SIGNAL_META[k].label}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Detalle del vínculo" className="stack">
          {id ? <LinkDetail key={id} id={id} onDecided={onDecided} /> : queue.data?.length === 0 ? null : <Loading />}
        </section>
      </div>
    </>
  );
}

function LinkDetail({ id, onDecided }: { id: string; onDecided: (l: LinkView) => void }) {
  const api = useApi();
  const link = useAsync(() => api.getLink(id), `link:${id}`);
  const index = useMemo(() => (link.data ? indexFromLink(link.data) : null), [link.data]);

  if (link.error) return <ErrorBox error={link.error} onRetry={link.reload} />;
  if (!link.data || !index) return <Loading label="Cargando el vínculo…" />;
  const l = link.data;
  const shared = new Set(l.signals.modus_operandi?.frases_comunes ?? []);
  const fragsA = l.fragments.filter((f) => l.case_a.evidencia.some((e) => e.id === f.evidence_id));
  const fragsB = l.fragments.filter((f) => l.case_b.evidencia.some((e) => e.id === f.evidence_id));

  return (
    <CitationProvider index={index}>
      <article className="stack" aria-labelledby="vinculo-titulo">
        <header className="panel">
          <div className="panel-head" style={{ marginBottom: 6 }}>
            <h2 id="vinculo-titulo">
              <span>
                {l.label}: Caso {l.case_a.code} y Caso {l.case_b.code}
              </span>
              <StatusBadge status={l.status} />
            </h2>
            <span className="small muted">Propuesto {fmtDateTime(l.created_at)}</span>
          </div>
          <Explanation link={l} />
        </header>

        <div className="versus">
          <CaseCard side={l.case_a} shared={shared} />
          <div className="versus-mid" aria-label="Puntaje del vínculo">
            <span className="small muted">Puntaje</span>
            <span className="big">{fmtScore(l.score)}</span>
            <Meter value={l.score} label={`Puntaje ${fmtScore(l.score)}`} ticks={[0.6, 0.9]} />
            <span className="small muted">
              Motor {fmtScore(l.score_raw)}
              {l.vinculador ? ` · Vinculador ${fmtScore(l.vinculador.puntaje_ajustado)}` : ""}
            </span>
          </div>
          <CaseCard side={l.case_b} shared={shared} />
        </div>

        {l.fragments.length > 0 ? (
          <section className="panel" aria-labelledby="frag-titulo">
            <div className="panel-head">
              <h3 id="frag-titulo">
                <Icon name="mic" /> Fragmentos de audio relevantes
              </h3>
              <span className="small muted">Se descargan al pedirlos; cada acceso queda en la auditoría.</span>
            </div>
            <div className="grid-2">
              <FragmentColumn code={l.case_a.code} frags={fragsA} />
              <FragmentColumn code={l.case_b.code} frags={fragsB} />
            </div>
          </section>
        ) : null}

        <SignalsPanel link={l} />

        {l.status === "confirmado" || l.status === "descartado" ? (
          <Notice kind={l.status === "confirmado" ? "success-box" : "notice"}>
            {l.status === "confirmado" ? "Confirmado" : "Descartado"} por {l.reviewed_by ?? "—"} el {fmtDateTime(l.reviewed_at)}.
            {l.review_note ? ` Nota: “${l.review_note}”` : ""}
          </Notice>
        ) : (
          <DecisionBar link={l} onDecided={onDecided} />
        )}
      </article>
    </CitationProvider>
  );
}

function Explanation({ link }: { link: LinkView }) {
  const v = link.vinculador;
  if (!v) {
    return <Notice kind="warn">El Vinculador aún no redactó la explicación. Revisa las señales y la evidencia.</Notice>;
  }
  return (
    <div className="stack-sm">
      <div className="row">
        <span className="strong">Explicación del Vinculador</span>
        {link.vinculador_valid === false ? (
          <span className="chip chip-danger">Citas no válidas</span>
        ) : link.vinculador_valid ? (
          <span className="chip chip-mint">Citas verificadas</span>
        ) : null}
      </div>
      <p style={{ fontSize: "1.03rem", lineHeight: 1.6 }}>
        <CitedText text={v.explicacion} />
      </p>
      {link.vinculador_valid === false ? (
        <Notice kind="error-box">El validador de citas encontró afirmaciones sin evidencia o con citas inexistentes. No te apoyes en esta explicación.</Notice>
      ) : null}
      <div className="grid-2">
        <div className="stack-sm">
          <h3>A favor</h3>
          {v.afirmaciones.length ? (
            <ul className="list-plain list-lines">
              {v.afirmaciones.map((a, i) => (
                <li key={i} className="stack-sm" style={{ gap: 4 }}>
                  <span>{a.texto}</span>
                  <CiteList refs={a.evidencia} />
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">Sin afirmaciones.</span>
          )}
        </div>
        <div className="stack-sm">
          <h3 className="row" style={{ gap: 6 }}>
            <Icon name="alert" size={16} /> Contradicciones
          </h3>
          {v.contradicciones.length ? (
            <ul className="list-plain list-lines">
              {v.contradicciones.map((a, i) => (
                <li key={i} className="stack-sm" style={{ gap: 4 }}>
                  <span>{a.texto}</span>
                  <CiteList refs={a.evidencia} />
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">El Vinculador no encontró contradicciones.</span>
          )}
        </div>
      </div>
    </div>
  );
}

const EV_ICON: Record<string, IconName> = { audio: "mic", imagen: "image", video: "video", texto: "message" };

function CaseCard({ side, shared }: { side: CaseSide; shared: Set<string> }) {
  const f = side.ficha;
  return (
    <section className="panel case-card stack-sm" aria-label={`Caso ${side.code}`}>
      <h3>
        <span className="case-letter" aria-hidden="true">
          {side.code}
        </span>
        Caso {side.code}
        <span className="muted small" style={{ fontWeight: 400 }}>
          {side.sector ? (SECTOR_LABEL[side.sector] ?? side.sector) : "Sector sin dato"} · {side.zona ?? "zona sin dato"}
        </span>
      </h3>
      <dl className="dl">
        <dt>Primer contacto</dt>
        <dd>{fmtDateTime(side.primer_contacto)}</dd>
        {f ? (
          <>
            <dt>Exige</dt>
            <dd>
              {f.monto_soles != null ? `S/ ${f.monto_soles.toLocaleString("es-PE")}` : "Monto sin dato"}
              {f.periodicidad && f.periodicidad !== "unico" ? ` ${f.periodicidad}` : ""}
              {f.canal_pago ? ` por ${CANAL_LABEL[f.canal_pago] ?? f.canal_pago}` : ""}
              {f.plazo ? `, plazo de ${f.plazo}` : ""}
            </dd>
            <dt>Dice ser de</dt>
            <dd>{f.grupo_que_dice_ser ? `“${f.grupo_que_dice_ser}”` : "—"}</dd>
            <dt>Amenaza</dt>
            <dd>{f.amenaza ?? "—"}</dd>
          </>
        ) : null}
      </dl>
      {f ? (
        <>
          <div>
            <span className="small muted">Frases firma</span>
            <ul className="list-plain">
              {f.frases_firma.map((p) => (
                <li key={p}>
                  <span className={`phrase${shared.has(p) ? " shared" : ""}`}>“{p}”</span>
                  {shared.has(p) ? <span className="sr-only"> (frase en común)</span> : null}
                </li>
              ))}
            </ul>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="small muted">Identificadores</span>
            {f.identificadores.length ? f.identificadores.map((i) => <CiteChip key={i.ref} refId={i.ref} />) : <span className="muted">ninguno</span>}
          </div>
        </>
      ) : (
        <p className="muted">La ficha aún no está lista.</p>
      )}
      <div className="row" style={{ gap: 6 }}>
        <span className="small muted">Evidencia</span>
        {side.evidencia.map((e) => (
          <span key={e.id} className="row" style={{ gap: 2 }}>
            <Icon name={EV_ICON[e.tipo] ?? "file"} size={14} />
            <CiteChip refId={e.label} />
          </span>
        ))}
        <CiteChip refId={`FICHA-${side.code}`} />
      </div>
    </section>
  );
}

function FragmentColumn({ code, frags }: { code: string; frags: AudioFragment[] }) {
  return (
    <div className="stack-sm">
      <span className="strong">Caso {code}</span>
      {frags.length ? frags.map((f) => <AudioClip key={`${f.evidence_id}-${f.start_ms}`} fragment={f} />) : <span className="muted small">Sin fragmentos de audio.</span>}
    </div>
  );
}

function SignalsPanel({ link }: { link: LinkView }) {
  const s = link.signals;
  const combined = combineSignals(signalProbabilities(s));
  return (
    <section className="panel" aria-labelledby="senales-titulo">
      <div className="panel-head">
        <h3 id="senales-titulo">Señales</h3>
        <span className="small muted">
          Combinación 1 − ∏(1 − pᵢ) = <strong>{fmtScore(combined)}</strong>
        </span>
      </div>
      <div className="signals">
        {SIGNAL_ORDER.map((k) => {
          const sig = s[k];
          if (!sig) return null;
          const meta = SIGNAL_META[k];
          return (
            <div key={k} className="signal">
              <div className="signal-head">
                <span className="row" style={{ gap: 6 }}>
                  <Icon name={meta.icon} size={16} />
                  <span className="strong">{meta.label}</span>
                  <span className="chip chip-outline">{meta.fuerza}</span>
                </span>
                <span className="signal-p" title="Probabilidad calibrada">
                  p {fmtScore(sig.p)}
                </span>
              </div>
              <Meter value={sig.p} label={`Probabilidad calibrada de ${meta.label}: ${fmtScore(sig.p)}`} />
              <SignalDetail kind={k} signals={s} />
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        p es la probabilidad calibrada con la evaluación. El modus operandi nunca vincula solo; voz e imagen necesitan otra señal o tu revisión explícita.
      </p>
    </section>
  );
}

function SignalDetail({ kind, signals }: { kind: keyof Signals; signals: Signals }) {
  switch (kind) {
    case "identificador": {
      const sig = signals.identificador!;
      return (
        <div className="stack-sm">
          {sig.compartidos.map((c) => (
            <span key={c.ref} className="row" style={{ gap: 6 }}>
              <span className="small">Compartido:</span>
              <CiteChip refId={c.ref} />
              <CiteList refs={c.evidencia} />
            </span>
          ))}
        </div>
      );
    }
    case "voz": {
      const sig = signals.voz!;
      return (
        <dl className="dl small">
          <dt>Similitud coseno</dt>
          <dd>{fmtScore(sig.similitud)}</dd>
          <dt>Puntaje normalizado</dt>
          <dd>{sig.z != null ? `z = ${sig.z.toFixed(1)}` : "—"}</dd>
          <dt>Segmentos</dt>
          <dd>
            {sig.segmentos} de {sig.segmentos_total} sobre el umbral
          </dd>
          <dt>Huellas</dt>
          <dd>
            <CiteList refs={sig.huellas} label="Huellas comparadas" />
          </dd>
        </dl>
      );
    }
    case "imagen": {
      const sig = signals.imagen!;
      return (
        <dl className="dl small">
          <dt>Hamming mínimo</dt>
          <dd>{sig.hamming_min ?? "—"}</dd>
          <dt>DINOv2 máximo</dt>
          <dd>{sig.dino_max != null ? fmtScore(sig.dino_max) : "—"}</dd>
          <dt>Recortes</dt>
          <dd>
            <CiteList refs={sig.recortes} label="Recortes comparados" />
          </dd>
        </dl>
      );
    }
    case "modus_operandi": {
      const sig = signals.modus_operandi!;
      return (
        <dl className="dl small">
          <dt>Similitud de texto</dt>
          <dd>{fmtScore(sig.similitud_texto)}</dd>
          <dt>Mismo canal de pago</dt>
          <dd>{sig.mismo_canal_pago ? "Sí" : "No"}</dd>
          <dt>Mismo grupo</dt>
          <dd>{sig.mismo_grupo ? "Sí" : "No"}</dd>
          <dt>Frases en común</dt>
          <dd>{sig.frases_comunes.length ? sig.frases_comunes.map((p) => `“${p}”`).join(", ") : "ninguna"}</dd>
        </dl>
      );
    }
  }
}

function DecisionBar({ link, onDecided }: { link: LinkView; onDecided: (l: LinkView) => void }) {
  const api = useApi();
  const user = useUser();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"confirmar" | "descartar" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "confirmar" | "descartar") => {
    setBusy(decision);
    setError(null);
    try {
      const res = await api.decideLink(link.id, note.trim() ? { decision, note: note.trim() } : { decision });
      onDecided(res);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="decision-bar" role="group" aria-label={`Decisión sobre ${link.label}`}>
      <div className="field">
        <label htmlFor="nota">
          Nota para el registro <span className="muted" style={{ fontWeight: 400 }}>(opcional; decides como {user.display_name})</span>
        </label>
        <textarea id="nota" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: la voz coincide en los dos audios." />
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-ok btn-lg"
          disabled={busy !== null}
          onClick={() => void decide("confirmar")}
          aria-describedby="decision-nota"
        >
          <Icon name="check" />
          {busy === "confirmar" ? "Confirmando…" : "Confirmar vínculo"}
        </button>
        <button type="button" className="btn btn-danger btn-lg" disabled={busy !== null} onClick={() => void decide("descartar")}>
          <Icon name="x" />
          {busy === "descartar" ? "Descartando…" : "Descartar"}
        </button>
      </div>
      <span id="decision-nota" className="sr-only">
        Confirmar suma el vínculo al grafo y recalcula las redes. Ninguna víctima recibe aviso.
      </span>
      {error ? (
        <div className="error-box" role="alert" style={{ flexBasis: "100%" }}>
          <Icon name="alert" />
          {error}
        </div>
      ) : null}
    </div>
  );
}
