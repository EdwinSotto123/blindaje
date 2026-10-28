import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { combineSignals, signalProbabilities } from "@blindaje/shared";
import { errorMessage } from "../api/client";
import type { AudioFragment, CaseSide, LinkStatus, LinkView, Signals } from "../api/types";
import { useApi, useUser } from "../app/context";
import { AuthenticityBadge, AuthenticityPanel } from "../components/Authenticity";
import { CiteChip, CiteList, CitationProvider, CitedText } from "../components/Citations";
import { Icon, type IconName } from "../components/Icons";
import { AudioClip } from "../components/Media";
import { Empty, ErrorBox, InlineConfirm, Loading, Meter, Notice, PageHead, StatusBadge, useFlash } from "../components/ui";
import { flaggedInLink, isStrong, NOTA_AUSENCIA, type FlaggedEvidence } from "../lib/authenticity";
import { indexFromLink } from "../lib/citations";
import { CANAL_LABEL, SECTOR_LABEL, fmtDateTime, fmtScore } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const PENDING: LinkStatus[] = ["probable", "por_revisar"];
const REVIEWED: LinkStatus[] = ["confirmado", "descartado"];

/** `peso`: cuánto puede pesar ese tipo de señal en un vínculo (no dice si esta vez coincide). */
const SIGNAL_META: Record<keyof Signals, { label: string; short: string; peso: string; icon: IconName }> = {
  identificador: { label: "Identificador igual", short: "identificador igual", peso: "fuerte", icon: "key" },
  voz: { label: "Voz", short: "voz", peso: "media", icon: "mic" },
  imagen: { label: "Imagen reutilizada", short: "imagen reutilizada", peso: "media", icon: "image" },
  modus_operandi: { label: "Modus operandi", short: "modus operandi", peso: "débil", icon: "message" },
};
const SIGNAL_ORDER: (keyof Signals)[] = ["identificador", "voz", "imagen", "modus_operandi"];

/** Lo que dice la consola al confirmar: el vínculo sigue siendo una hipótesis y nadie recibe aviso. */
const CONFIRM_CONSEQUENCE = "Confirmar suma el vínculo al grafo y recalcula las redes; sigue siendo una hipótesis. Ninguna víctima recibe aviso.";

export type Verdict = { text: string; tone: "si" | "parcial" | "no" };

/**
 * Lectura en palabras de la probabilidad calibrada de una señal. Son bandas de presentación para
 * leer rápido, no umbrales del motor (los del puntaje del vínculo son 0.60 y 0.90).
 */
export function signalVerdict(p: number): Verdict {
  if (p >= 0.75) return { text: "Sostiene el vínculo", tone: "si" };
  if (p >= 0.35) return { text: "Lo sostiene en parte", tone: "parcial" };
  return { text: "No lo sostiene", tone: "no" };
}

/** Señales agrupadas por lo que dicen, con el detalle que una persona necesita para decidir. */
export function signalSummary(s: Signals): Record<Verdict["tone"], string[]> {
  const out: Record<Verdict["tone"], string[]> = { si: [], parcial: [], no: [] };
  for (const k of SIGNAL_ORDER) {
    const sig = s[k];
    if (!sig) continue;
    let name = SIGNAL_META[k].short;
    if (k === "voz" && s.voz) name += ` (${s.voz.segmentos} de ${s.voz.segmentos_total} segmentos coinciden)`;
    out[signalVerdict(sig.p).tone].push(name);
  }
  return out;
}

/** Prioriza los "probable" y, dentro de cada estado, el puntaje más alto. */
export function sortQueue(links: LinkView[]): LinkView[] {
  const rank = (s: LinkStatus) => (s === "probable" ? 0 : s === "por_revisar" ? 1 : 2);
  return [...links].sort((a, b) => rank(a.status) - rank(b.status) || b.score - a.score);
}

export function LinksView() {
  const api = useApi();
  const navigate = useNavigate();
  const { id } = useParams();
  // El filtro vive en la URL (?ver=revisados) para poder compartir o recargar la vista.
  const [params, setParams] = useSearchParams();
  const tab: "pendientes" | "revisados" = params.get("ver") === "revisados" ? "revisados" : "pendientes";
  const setTab = (t: "pendientes" | "revisados") => setParams(t === "revisados" ? { ver: "revisados" } : {}, { replace: true });
  const suffix = tab === "revisados" ? "?ver=revisados" : "";
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
                <Link to={`/vinculos/${encodeURIComponent(l.id)}${suffix}`} className="queue-item" aria-current={l.id === id ? "page" : undefined}>
                  <span className="top">
                    <span className="strong">
                      Caso {l.case_a.code} y Caso {l.case_b.code}
                    </span>
                    <span className="score" aria-label={`Puntaje ${fmtScore(l.score)}`}>
                      {fmtScore(l.score)}
                    </span>
                  </span>
                  <span className="small muted">{l.label}</span>
                  <span className="kinds">
                    <StatusBadge status={l.status} />
                    <AuthenticityWarningChip flagged={flaggedInLink(l)} />
                    <ContradictionChip n={l.vinculador?.contradicciones.length ?? 0} />
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
          {id ? (
            <LinkDetail key={id} id={id} onDecided={onDecided} />
          ) : queue.data?.length === 0 ? null : tab === "revisados" && queue.data ? (
            <Empty title="Elige un vínculo de la lista">Verás la decisión, quién la tomó y su nota.</Empty>
          ) : (
            <Loading />
          )}
        </section>
      </div>
    </>
  );
}

function LinkDetail({ id, onDecided }: { id: string; onDecided: (l: LinkView) => void }) {
  const api = useApi();
  const link = useAsync(() => api.getLink(id), `link:${id}`);
  const index = useMemo(() => (link.data ? indexFromLink(link.data) : null), [link.data]);
  // Fragmentos que la persona ya escuchó: la confirmación avisa si falta alguno.
  const [heard, setHeard] = useState<ReadonlySet<string>>(() => new Set());
  const markHeard = useCallback((key: string) => setHeard((prev) => (prev.has(key) ? prev : new Set(prev).add(key))), []);

  if (link.error) return <ErrorBox error={link.error} onRetry={link.reload} />;
  if (!link.data || !index) return <Loading label="Cargando el vínculo…" />;
  const l = link.data;
  const shared = new Set(l.signals.modus_operandi?.frases_comunes ?? []);
  const fragsA = l.fragments.filter((f) => l.case_a.evidencia.some((e) => e.id === f.evidence_id));
  const fragsB = l.fragments.filter((f) => l.case_b.evidencia.some((e) => e.id === f.evidence_id));
  const pending = l.status !== "confirmado" && l.status !== "descartado";
  const flagged = flaggedInLink(l);

  return (
    <CitationProvider index={index}>
      <article className="stack" aria-labelledby="vinculo-titulo">
        <header className="panel">
          <div className="panel-head" style={{ marginBottom: 6 }}>
            <h2 id="vinculo-titulo">
              <span>
                Caso {l.case_a.code} y Caso {l.case_b.code}
              </span>
              <StatusBadge status={l.status} />
            </h2>
            <span className="small muted">
              Vínculo {l.label} · propuesto {fmtDateTime(l.created_at)}
            </span>
          </div>
          {pending ? (
            <button type="button" className="skip-inline" onClick={() => document.getElementById("nota")?.focus()}>
              Ir a la decisión
            </button>
          ) : null}
          <SignalSummary signals={l.signals} />
          {flagged.length ? <AuthenticityNotice flagged={flagged} link={l} /> : null}
          <Explanation link={l} />
        </header>

        {l.fragments.length > 0 ? (
          <section className="panel" aria-labelledby="frag-titulo">
            <div className="panel-head">
              <h3 id="frag-titulo">
                <Icon name="mic" /> Comparar las voces
              </h3>
              <span className="small muted">Se descargan al pedirlos; cada acceso queda en la auditoría.</span>
            </div>
            {l.signals.voz ? (
              <p className="voice-verdict">
                <strong>Voz: {signalVerdict(l.signals.voz.p).text.toLowerCase()}.</strong> {l.signals.voz.segmentos} de {l.signals.voz.segmentos_total}{" "}
                segmentos coinciden sobre el umbral (p {fmtScore(l.signals.voz.p)}).
                {l.signals.voz.voz_sintetica ? (
                  <>
                    {" "}
                    <strong>Pesa la mitad</strong> porque {l.signals.voz.voz_sintetica.evidencia.join(", ")} tiene indicios de voz sintética: una voz hecha con IA
                    podría imitar a otra.
                  </>
                ) : null}
              </p>
            ) : null}
            <div className="grid-2">
              <FragmentColumn code={l.case_a.code} frags={fragsA} onListened={markHeard} />
              <FragmentColumn code={l.case_b.code} frags={fragsB} onListened={markHeard} />
            </div>
          </section>
        ) : null}

        <div className="versus">
          <CaseCard side={l.case_a} shared={shared} />
          <div className="versus-mid" aria-label="Puntaje del vínculo">
            <span className="small muted">Puntaje</span>
            <span className="big">{fmtScore(l.score)}</span>
            <Meter value={l.score} label={`Puntaje ${fmtScore(l.score)}`} ticks={[0.6, 0.9]} />
            <span className="small muted">Umbrales: 0.60 por revisar, 0.90 probable</span>
          </div>
          <CaseCard side={l.case_b} shared={shared} />
        </div>

        <SignalsPanel link={l} />

        <AuthenticitySection link={l} />

        {l.status === "confirmado" || l.status === "descartado" ? (
          <Notice kind={l.status === "confirmado" ? "success-box" : "notice"}>
            {l.status === "confirmado" ? "Confirmado" : "Descartado"} por {l.reviewed_by ?? "—"} el {fmtDateTime(l.reviewed_at)}.
            {l.review_note ? ` Nota: “${l.review_note}”` : ""}
          </Notice>
        ) : (
          <DecisionBar link={l} unheard={l.fragments.length - heard.size} totalFragments={l.fragments.length} onDecided={onDecided} />
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
            <Icon name="alert" size={16} /> Contradicciones{v.contradicciones.length ? ` (${v.contradicciones.length})` : ""}
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
          <span key={e.id} className="ev-auth">
            <Icon name={EV_ICON[e.tipo] ?? "file"} size={14} />
            <CiteChip refId={e.label} />
            {e.tipo === "texto" ? null : <AuthenticityBadge nivel={e.autenticidad?.nivel ?? null} compact />}
          </span>
        ))}
        <CiteChip refId={`FICHA-${side.code}`} />
      </div>
    </section>
  );
}

function FragmentColumn({ code, frags, onListened }: { code: string; frags: AudioFragment[]; onListened: (key: string) => void }) {
  return (
    <div className="stack-sm">
      <span className="strong">Caso {code}</span>
      {frags.length ? (
        frags.map((f) => {
          const key = `${f.evidence_id}-${f.start_ms}`;
          return <AudioClip key={key} fragment={f} onListened={() => onListened(key)} />;
        })
      ) : (
        <span className="muted small">Sin fragmentos de audio.</span>
      )}
    </div>
  );
}

const TIPO_LABEL: Record<string, string> = { audio: "audio", imagen: "imagen", video: "video" };

/** Advertencia de la cola: alguna evidencia del par tiene indicios fuertes o marca de IA. */
export function AuthenticityWarningChip({ flagged }: { flagged: FlaggedEvidence[] }) {
  if (!flagged.length) return null;
  return (
    <span className="chip chip-auth" data-tone="fuerte">
      <Icon name="alert" size={13} />
      {flagged.length === 1 ? `${flagged[0]!.label}: indicios de IA` : `${flagged.length} evidencias con indicios de IA`}
    </span>
  );
}

function AuthenticityNotice({ flagged, link }: { flagged: FlaggedEvidence[]; link: LinkView }) {
  const voz = link.signals.voz?.voz_sintetica;
  return (
    <div className="warn">
      <Icon name="alert" />
      <div className="stack-sm" style={{ gap: 4 }}>
        <span>
          <strong>Revisa la autenticidad antes de decidir.</strong>{" "}
          {flagged.map((f, i) => (
            <span key={f.label}>
              {i > 0 ? (i === flagged.length - 1 ? " y " : ", ") : null}
              <CiteChip refId={f.label} /> ({TIPO_LABEL[f.tipo] ?? f.tipo}, caso {f.caseCode})
            </span>
          ))}{" "}
          {flagged.length === 1 ? "tiene" : "tienen"} {flagged.some((f) => f.nivel === "generado_ia_confirmado") ? "marca de IA o indicios fuertes" : "indicios fuertes"} de
          haber sido generada con IA o manipulada.
          {voz ? " Por eso la señal de voz pesa la mitad." : ""}
        </span>
        <span className="small">
          Son indicios, no prueba; una evidencia hecha con IA sigue siendo evidencia. {NOTA_AUSENCIA}{" "}
          <a href="#autenticidad-titulo">Ver el análisis</a>
        </span>
      </div>
    </div>
  );
}

/** Autenticidad de cada audio, imagen y video del par: nivel, señales, explicación y limitaciones. */
function AuthenticitySection({ link }: { link: LinkView }) {
  const items = [link.case_a, link.case_b].flatMap((side) => side.evidencia.filter((e) => e.tipo !== "texto").map((e) => ({ e, code: side.code })));
  if (!items.length) return null;
  const analyzed = items.filter((x) => x.e.autenticidad);
  const withSignals = analyzed.filter((x) => x.e.autenticidad!.nivel !== "sin_senales").length;
  return (
    <section className="panel" aria-labelledby="autenticidad-titulo">
      <div className="panel-head">
        <h3 id="autenticidad-titulo">
          <Icon name="shield" /> Autenticidad de la evidencia
        </h3>
        <span className="small muted">
          {analyzed.length} de {items.length} analizadas · {withSignals ? `${withSignals} con indicios` : "ninguna con indicios"}
        </span>
      </div>
      <div className="auth-list">
        {items.map(({ e, code }) => (
          <details key={e.id} open={isStrong(e.autenticidad?.nivel)}>
            <summary>
              <Icon name={EV_ICON[e.tipo] ?? "file"} size={14} />
              <span className="strong">{e.label}</span>
              <span className="small muted">caso {code}</span>
              <AuthenticityBadge nivel={e.autenticidad?.nivel ?? null} compact />
            </summary>
            <AuthenticityPanel result={e.autenticidad ?? null} tipo={e.tipo} />
          </details>
        ))}
      </div>
    </section>
  );
}

function ContradictionChip({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="chip chip-outline">
      <Icon name="alert" size={13} />
      {n === 1 ? "1 contradicción" : `${n} contradicciones`}
    </span>
  );
}

function SignalSummary({ signals }: { signals: Signals }) {
  const g = signalSummary(signals);
  return (
    <p className="verdicts">
      {g.si.length ? (
        <span>
          <strong>Lo sostiene:</strong> {g.si.join(", ")}.
        </span>
      ) : (
        <strong>Ninguna señal lo sostiene con fuerza.</strong>
      )}
      {g.parcial.length ? (
        <span>
          {" "}
          <strong>En parte:</strong> {g.parcial.join(", ")}.
        </span>
      ) : null}
      {g.no.length ? (
        <span>
          {" "}
          <strong>No lo sostiene:</strong> {g.no.join(", ")}.
        </span>
      ) : null}
    </p>
  );
}

function SignalsPanel({ link }: { link: LinkView }) {
  const s = link.signals;
  const combined = combineSignals(signalProbabilities(s));
  return (
    <section className="panel" aria-labelledby="senales-titulo">
      <div className="panel-head">
        <h3 id="senales-titulo">Señales</h3>
        <span className="small muted">p: probabilidad calibrada con la evaluación</span>
      </div>
      <div className="signals">
        {SIGNAL_ORDER.map((k) => {
          const sig = s[k];
          if (!sig) return null;
          const meta = SIGNAL_META[k];
          const verdict = signalVerdict(sig.p);
          return (
            <div key={k} className="signal">
              <div className="signal-head">
                <span className="row" style={{ gap: 6 }}>
                  <Icon name={meta.icon} size={16} />
                  <span className="strong">{meta.label}</span>
                </span>
                <span className="signal-p">
                  <span className="sr-only">probabilidad calibrada </span>p {fmtScore(sig.p)}
                </span>
              </div>
              <span className={`verdict verdict-${verdict.tone}`}>
                {verdict.text}
                {k === "voz" && s.voz ? ` · ${s.voz.segmentos} de ${s.voz.segmentos_total} segmentos` : ""}
              </span>
              {k === "voz" && s.voz?.voz_sintetica ? (
                <span className="small">
                  <Icon name="alert" size={13} /> Reducida a la mitad (era {fmtScore(s.voz.voz_sintetica.p_sin_ajuste)}):{" "}
                  <CiteList refs={s.voz.voz_sintetica.evidencia} label="Audios con indicios de voz sintética" /> con indicios de voz sintética.
                </span>
              ) : null}
              <Meter value={sig.p} label={`Probabilidad calibrada de ${meta.label}: ${fmtScore(sig.p)}`} />
              <span className="small muted">Peso de esta señal: {meta.peso}</span>
              {k === "identificador" ? (
                <SignalDetail kind={k} signals={s} />
              ) : (
                <details className="tech">
                  <summary>Detalle técnico</summary>
                  <SignalDetail kind={k} signals={s} />
                </details>
              )}
            </div>
          );
        })}
      </div>
      <details className="tech" style={{ marginTop: 10 }}>
        <summary>Cómo se calcula el puntaje</summary>
        <p className="small">
          Combinación de las señales: 1 − ∏(1 − pᵢ) = <strong>{fmtScore(combined)}</strong>. Puntaje del motor {fmtScore(link.score_raw)}
          {link.vinculador ? `; ajustado por el Vinculador a ${fmtScore(link.vinculador.puntaje_ajustado)}` : ""}.
        </p>
      </details>
      <p className="small muted" style={{ marginTop: 8 }}>
        El modus operandi nunca vincula solo; la voz y la imagen necesitan otra señal o tu revisión explícita.
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

function DecisionBar({
  link,
  unheard,
  totalFragments,
  onDecided,
}: {
  link: LinkView;
  unheard: number;
  totalFragments: number;
  onDecided: (l: LinkView) => void;
}) {
  const api = useApi();
  const user = useUser();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"confirmar" | "descartar" | null>(null);
  const [ask, setAsk] = useState<"confirmar" | "descartar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pair = `el Caso ${link.case_a.code} y el Caso ${link.case_b.code}`;

  const decide = async (decision: "confirmar" | "descartar") => {
    setBusy(decision);
    setError(null);
    try {
      const res = await api.decideLink(link.id, note.trim() ? { decision, note: note.trim() } : { decision });
      onDecided(res);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
      setAsk(null);
    }
  };

  return (
    <div className="decision-bar" role="group" aria-label={`Decisión sobre el vínculo entre ${pair}`}>
      <div className="field">
        <label htmlFor="nota">
          Nota para el registro <span className="muted" style={{ fontWeight: 400 }}>(opcional; decides como {user.display_name})</span>
        </label>
        <textarea
          id="nota"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Por ejemplo: la voz coincide en los dos audios…"
          autoComplete="off"
        />
      </div>
      {ask === "confirmar" ? (
        <InlineConfirm
          id="confirmar-vinculo"
          question={`¿Confirmar el vínculo entre ${pair}?`}
          detail={
            <>
              {unheard > 0 ? (
                <strong>
                  Aún no escuchaste {unheard === totalFragments ? "ninguno de los" : `${unheard} de los`} {totalFragments} fragmentos de audio.{" "}
                </strong>
              ) : null}
              {CONFIRM_CONSEQUENCE}
            </>
          }
          confirmLabel="Sí, confirmar"
          busyLabel="Confirmando…"
          busy={busy !== null}
          onConfirm={() => void decide("confirmar")}
          onCancel={() => setAsk(null)}
        />
      ) : ask === "descartar" ? (
        <InlineConfirm
          id="descartar-vinculo"
          question={`¿Descartar el vínculo entre ${pair}?`}
          detail="No se podrá confirmar después. Queda guardado para recalibrar el motor."
          confirmLabel="Sí, descartar"
          busyLabel="Descartando…"
          icon="x"
          tone="danger"
          busy={busy !== null}
          onConfirm={() => void decide("descartar")}
          onCancel={() => setAsk(null)}
        />
      ) : (
        <div className="decision-actions">
          <div className="row">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setAsk("confirmar")} aria-describedby="decision-nota">
              <Icon name="check" />
              Confirmar vínculo
            </button>
            <button type="button" className="btn btn-danger btn-lg" onClick={() => setAsk("descartar")}>
              <Icon name="x" />
              Descartar
            </button>
          </div>
          <span id="decision-nota" className="decision-note">
            {CONFIRM_CONSEQUENCE}
          </span>
        </div>
      )}
      {error ? (
        <div className="error-box" role="alert" style={{ flexBasis: "100%" }}>
          <Icon name="alert" />
          {error}
        </div>
      ) : null}
    </div>
  );
}
