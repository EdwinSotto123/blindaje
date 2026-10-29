import "../styles/vectors.css";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  VectorCandidate,
  VectorCaseSummary,
  VectorCollection,
  VectorIndexName,
  VectorNeighbor,
  VectorOverview,
  VectorPoint,
  VectorQuery,
  VectorStoreStatus,
  VectorSyncResult,
  VectorTrace,
} from "@blindaje/shared";
import { errorMessage } from "../api/client";
import { vectorsFor, type VectorsApi } from "../api/vectors";
import { useApi, useUser } from "../app/context";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, Loading, Notice, PageHead, StatusBadge } from "../components/ui";
import { fmtDateTime, fmtScore } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import {
  aggregateNeighbors,
  bestPerCase,
  buildSteps,
  caseLanes,
  casePoints,
  combineFormula,
  divergingColor,
  DIVERGING,
  ESTADO_DESTINO,
  fmtMs,
  fmtVarianza,
  INDEX_META,
  INDEX_ORDER,
  indexKind,
  latencyText,
  MAP,
  modelInfo,
  placeLabels,
  pointsOf,
  PROVIDER_LABEL,
  queriesOf,
  SIGNAL_META,
  SIGNAL_ORDER,
  SOURCE_LABEL,
  stepDescription,
  stepDuration,
  toSvg,
  type Lane,
  type SignalKey,
  type Step,
} from "../lib/vectors";

/**
 * Motor vectorial (solo administración). Muestra, con los datos de verdad, cómo cada evidencia se
 * vuelve un vector, dónde se guarda (Chroma Cloud o FAISS) y cómo la búsqueda de vecinos encuentra
 * casos parecidos, hasta el puntaje que manda un vínculo a la cola de revisión humana.
 *
 * El recorrido es una máquina de pasos: cada elemento aparece en su paso, se anima solo mientras
 * ese paso es el actual y después queda quieto en su estado final. Con movimiento reducido no hay
 * animación y se avanza con "Paso siguiente". La búsqueda se pide a la API de verdad al llegar a
 * ese paso: mientras responde, el recorrido espera.
 */
export function VectorsView() {
  const api = useApi();
  const user = useUser();
  const vectors = useMemo(() => vectorsFor(api, { id: user.id, role: user.role }), [api, user.id, user.role]);
  const ov = useAsync(() => vectors.overview(), "vectores");

  return (
    <>
      <PageHead title="Motor vectorial">
        Así se vuelve números cada evidencia, así se guarda en la base vectorial y así se buscan casos parecidos. Nada se vincula solo: todo
        termina en la cola de revisión.
      </PageHead>
      {ov.error && !ov.data ? (
        <ErrorBox error={ov.error} onRetry={ov.reload} />
      ) : !ov.data ? (
        <Loading label="Leyendo la base vectorial…" />
      ) : (
        <VectorsBody overview={ov.data} vectors={vectors} onSynced={ov.reload} />
      )}
    </>
  );
}

function VectorsBody({ overview, vectors, onSynced }: { overview: VectorOverview; vectors: VectorsApi; onSynced: () => void }) {
  return (
    <>
      <StoreStrip store={overview.almacen} vectors={vectors} onSynced={onSynced} />
      {overview.casos.length ? (
        <Walkthrough overview={overview} vectors={vectors} />
      ) : (
        <Empty title="Todavía no hay casos indexados">Cuando un caso con consentimiento comunitario termine de procesarse, sus vectores aparecerán aquí.</Empty>
      )}
      <CollectionsTable overview={overview} />
      <MapNote overview={overview} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Estado de la base
// ---------------------------------------------------------------------------

/** Franja de estado: proveedor, conexión, qué datos llegan y la sincronización. Exportada para los tests. */
export function StoreStrip({ store, vectors, onSynced }: { store: VectorStoreStatus; vectors?: VectorsApi; onSynced?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VectorSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = async () => {
    if (!vectors) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await vectors.sync());
      onSynced?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const none = store.proveedor === "ninguno";
  return (
    <section className="panel vx-store" aria-labelledby="vx-store-title">
      <div className="vx-store-main">
        <span className="vx-store-icon" aria-hidden="true">
          <Icon name="database" size={22} />
        </span>
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 id="vx-store-title" className="vx-store-name">
            {PROVIDER_LABEL[store.proveedor]}
            {store.base ? (
              <span className="vx-store-base">
                {" "}
                · base <code>{store.base}</code>
              </span>
            ) : null}
          </h2>
          <span className="vx-conn-state" data-ok={store.conectado}>
            <i aria-hidden="true" />
            {none ? "Sin búsqueda por vectores: solo identificadores y hash de imagen" : store.conectado ? "Conectada" : "No responde"}
            {store.conectado && store.latencia_ms !== null ? ` · respondió en ${fmtMs(store.latencia_ms)}` : ""}
            {!none ? ` · ${indexKind(store.proveedor)}` : ""}
          </span>
        </div>
      </div>
      <p className="vx-store-note small">
        <Icon name="lock" size={14} />
        <span>
          {store.solo_demo
            ? "Solo casos ficticios del demo, con ids numéricos y sin texto ni datos personales. D1 es la fuente de verdad: la base es la copia de búsqueda."
            : "D1 es la fuente de verdad: la base es la copia de búsqueda."}
        </span>
      </p>
      <div className="vx-store-sync">
        <span className="small muted">
          Última sincronización: {store.sincronizado_en ? `${fmtDateTime(store.sincronizado_en)} (hora de Lima)` : "nunca"}
        </span>
        {vectors && !none ? (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void sync()}>
            <Icon name="refresh" size={15} />
            {busy ? "Sincronizando…" : "Sincronizar desde D1"}
          </button>
        ) : null}
      </div>
      <div aria-live="polite" className="vx-store-result">
        {result ? <Notice kind="success-box">{syncText(result)}</Notice> : null}
        {error ? <Notice kind="error-box">{error}</Notice> : null}
      </div>
    </section>
  );
}

export function syncText(r: VectorSyncResult): string {
  const total = INDEX_ORDER.reduce((s, i) => s + (r.sincronizados[i] ?? 0), 0);
  const parts = INDEX_ORDER.filter((i) => r.sincronizados[i] !== undefined).map((i) => `${INDEX_META[i].corto} ${r.sincronizados[i]}`);
  const secs = (r.ms / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 });
  return `Listo: ${total} vectores copiados a ${PROVIDER_LABEL[r.proveedor]} (${parts.join(", ")}), ${r.borrados} ${r.borrados === 1 ? "borrado" : "borrados"}, en ${secs} s.`;
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

type TraceState = { caseId: string; status: "loading" | "ready" | "error"; data?: VectorTrace; error?: unknown } | null;

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function Walkthrough({ overview, vectors }: { overview: VectorOverview; vectors: VectorsApi }) {
  const reduced = useReducedMotion();
  // Empieza por el caso con más vectores: el recorrido más completo.
  const firstCase = useMemo(
    () => [...overview.casos].sort((a, b) => sumVectors(b) - sumVectors(a))[0]!.case_id,
    // Solo al montar: una sincronización no cambia el caso elegido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [caseId, setCaseId] = useState(firstCase);
  const c = overview.casos.find((x) => x.case_id === caseId) ?? overview.casos[0]!;
  const steps = useMemo(() => buildSteps(c), [c]);
  const [stepIdx, setStepIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  // Pausa pedida a mitad de un paso: congela las animaciones. Avanzar a mano no las congela.
  const [held, setHeld] = useState(false);
  const [slow, setSlow] = useState(false);
  const [trace, setTrace] = useState<TraceState>(null);
  const clock = useRef({ step: -1, used: 0 });

  const firstSearch = steps.findIndex((s) => s.kind === "busqueda" || s.kind === "senales");
  const traceForCase = trace && trace.caseId === c.case_id ? trace : null;
  const traceData = traceForCase?.status === "ready" ? traceForCase.data! : null;
  const loading = traceForCase?.status === "loading" || (!traceForCase && stepIdx >= firstSearch);
  const vel = slow ? 2 : 1;
  const step = stepIdx >= 0 ? steps[stepIdx]! : null;
  const atEnd = stepIdx === steps.length - 1;
  // Al final, o si la búsqueda falló, el recorrido se detiene solo.
  const running = playing && !atEnd && traceForCase?.status !== "error";

  // La búsqueda se pide de verdad al llegar a su paso (o al saltar más allá), una vez por caso.
  const requested = useRef<string | null>(null);
  const requestTrace = useCallback(
    (id: string) => {
      if (requested.current === id) return;
      requested.current = id;
      setTrace({ caseId: id, status: "loading" });
      vectors.trace(id).then(
        (data) => setTrace((t) => (t?.caseId === id ? { caseId: id, status: "ready", data } : t)),
        (error: unknown) => {
          if (requested.current === id) requested.current = null;
          setTrace((t) => (t?.caseId === id ? { caseId: id, status: "error", error } : t));
        },
      );
    },
    [vectors],
  );
  const lastStep = steps.length - 1;
  const caseKey = c.case_id;
  const goTo = useCallback(
    (i: number) => {
      const n = Math.max(-1, Math.min(i, lastStep));
      setStepIdx(n);
      // La búsqueda tarda unos segundos en vivo: se pide al empezar y corre mientras se ven los
      // primeros pasos; el recorrido solo la espera si llega a la búsqueda antes que la respuesta.
      if (n >= 0) requestTrace(caseKey);
    },
    [lastStep, requestTrace, caseKey],
  );

  // Reloj del recorrido: cuenta el tiempo usado del paso, para que pausar y seguir no lo reinicie.
  const waiting = step?.kind === "busqueda" || step?.kind === "senales" ? !traceData : false;
  useEffect(() => {
    if (!running || !step || waiting) return;
    if (clock.current.step !== stepIdx) clock.current = { step: stepIdx, used: 0 };
    const total = stepDuration(step, traceData) * vel;
    const started = Date.now();
    const t = setTimeout(() => goTo(stepIdx + 1), Math.max(0, total - clock.current.used));
    return () => {
      clearTimeout(t);
      clock.current.used += Date.now() - started;
    };
  }, [running, step, stepIdx, waiting, traceData, vel, goTo]);

  const pickCase = (id: string) => {
    setCaseId(id);
    setStepIdx(-1);
    setPlaying(false);
    setHeld(false);
    clock.current = { step: -1, used: 0 };
  };
  const play = () => {
    setHeld(false);
    if (reduced) {
      if (stepIdx < 0 || atEnd) goTo(0);
      return;
    }
    if (stepIdx < 0 || atEnd) {
      clock.current = { step: -1, used: 0 };
      goTo(0);
    }
    setPlaying(true);
  };
  const next = () => {
    setHeld(false);
    goTo(stepIdx + 1);
  };
  const restart = () => {
    setPlaying(false);
    setHeld(false);
    setStepIdx(-1);
    clock.current = { step: -1, used: 0 };
  };
  const jump = (i: number) => {
    setPlaying(false);
    setHeld(false);
    goTo(i);
  };
  const retry = () => {
    requested.current = null;
    requestTrace(c.case_id);
  };

  const caption = step
    ? stepDescription(step, c, overview, traceData, loading)
    : `Elige un caso y pulsa ${reduced ? "Empezar" : "Reproducir"}: verás cómo se procesó, paso a paso.`;

  return (
    <section className="panel vx-walk" aria-labelledby="vx-walk-title">
      <div className="panel-head">
        <h2 id="vx-walk-title">Recorrido de un caso</h2>
        <span className="small muted">Los vectores, las consultas y los tiempos son los de la base; los casos son ficticios.</span>
      </div>

      <div className="vx-controls">
        <div className="vx-cases" role="group" aria-label="Caso">
          {overview.casos.map((x) => (
            <button
              key={x.case_id}
              type="button"
              className="vx-case"
              aria-pressed={x.case_id === c.case_id}
              aria-label={`Caso ${x.caso}: ${sumVectors(x)} vectores`}
              onClick={() => pickCase(x.case_id)}
            >
              {x.caso}
            </button>
          ))}
        </div>
        <div className="row vx-play">
          {running ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setPlaying(false);
                setHeld(true);
              }}
            >
              <Icon name="pause" size={16} />
              Pausar
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={play}>
              <Icon name="play" size={16} />
              {reduced ? "Empezar" : stepIdx >= 0 && !atEnd ? "Seguir" : atEnd ? "Ver de nuevo" : "Reproducir"}
            </button>
          )}
          <button type="button" className="btn" onClick={next} disabled={atEnd}>
            <Icon name="skip" size={15} />
            Paso siguiente
          </button>
          <button type="button" className="btn btn-quiet" onClick={restart} disabled={stepIdx < 0}>
            Reiniciar
          </button>
          {!reduced ? (
            <div className="segmented" role="group" aria-label="Velocidad">
              <button type="button" aria-pressed={!slow} onClick={() => setSlow(false)}>
                1x
              </button>
              <button type="button" aria-pressed={slow} onClick={() => setSlow(true)}>
                0.5x
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <ol className="vx-steps">
        {steps.map((s, i) => (
          <li key={`${s.kind}-${s.indice ?? ""}`}>
            <button
              type="button"
              aria-current={i === stepIdx ? "step" : undefined}
              data-done={i < stepIdx}
              onClick={() => jump(i)}
            >
              <span className="vx-step-n" aria-hidden="true">
                {i + 1}
              </span>
              {s.corto ? (
                <>
                  <Icon name="search" size={13} />
                  <span className="sr-only">Buscar </span>
                  {s.corto}
                </>
              ) : (
                s.titulo
              )}
            </button>
          </li>
        ))}
      </ol>

      <p className="vx-caption" aria-live="polite">
        <span className="vx-caption-case case-letter" aria-hidden="true">
          {c.caso}
        </span>
        <span>{caption}</span>
      </p>

      {traceForCase?.status === "error" ? (
        <ErrorBox error={traceForCase.error} onRetry={retry} />
      ) : null}

      <WalkStage overview={overview} c={c} steps={steps} stepIdx={stepIdx} trace={traceData} loading={loading} paused={held} vel={vel} />
    </section>
  );
}

function sumVectors(c: VectorCaseSummary): number {
  return INDEX_ORDER.reduce((s, i) => s + (c.vectores[i] ?? 0), 0);
}

/** En qué paso aparece algo: oculto antes, animado durante, quieto después. */
type Phase = "later" | "now" | "done";

function phaseOf(steps: Step[], stepIdx: number, match: (s: Step) => boolean): Phase {
  const at = steps.findIndex(match);
  if (at < 0 || stepIdx < at) return "later";
  return stepIdx === at ? "now" : "done";
}

interface StageProps {
  overview: VectorOverview;
  c: VectorCaseSummary;
  steps: Step[];
  stepIdx: number;
  trace: VectorTrace | null;
  loading: boolean;
  paused?: boolean;
  vel?: number;
}

/** El escenario del recorrido en un paso dado. Exportado para los tests (se dibuja sin DOM). */
export function WalkStage({ overview, c, steps, stepIdx, trace, loading, paused = false, vel = 1 }: StageProps) {
  const ph = (kind: Step["kind"], indice?: VectorIndexName) => phaseOf(steps, stepIdx, (s) => s.kind === kind && (!indice || s.indice === indice));
  const provider = trace?.proveedor ?? overview.almacen.proveedor;
  return (
    <div className="vx-stage" data-paused={paused} style={{ "--vel": vel } as CSSProperties}>
      <Lanes overview={overview} c={c} ph={ph} />
      <div className="vx-maps-head">
        <h3>Dentro de {PROVIDER_LABEL[provider]}</h3>
        <MapLegend caso={c.caso} />
      </div>
      <div className="vx-maps">
        {INDEX_ORDER.map((i) => (
          <MapCard key={i} overview={overview} c={c} indice={i} land={ph("base")} search={ph("busqueda", i)} trace={trace} loading={loading} />
        ))}
      </div>
      <Candidates c={c} overview={overview} trace={trace} loading={loading} senales={ph("senales")} revision={ph("revision")} />
      {trace && ph("busqueda") !== "later" ? <TraceTable trace={trace} /> : null}
    </div>
  );
}

// --- Carriles: evidencia → modelo → vector → colección -----------------------------------------

const LANE_META: Record<Lane, { label: string; icon: "mic" | "message" | "image" | "key" }> = {
  voz: { label: "Voz", icon: "mic" },
  texto: { label: "Texto", icon: "message" },
  imagen: { label: "Imagen", icon: "image" },
  identificadores: { label: "Identificadores", icon: "key" },
};

const LANE_INDICES: Record<Lane, VectorIndexName[]> = {
  voz: ["voz", "voz_segmento"],
  texto: ["texto"],
  imagen: ["imagen"],
  identificadores: [],
};

function Lanes({ overview, c, ph }: { overview: VectorOverview; c: VectorCaseSummary; ph: (k: Step["kind"]) => Phase }) {
  const lanes = caseLanes(c);
  const pEv = ph("evidencia");
  const pMod = ph("modelos");
  const pVec = ph("vectores");
  const pBase = ph("base");
  return (
    <div className="vx-lanes" role="list" aria-label={`Cómo se procesó el caso ${c.caso}`}>
      <div className="vx-lane vx-lane-head" aria-hidden="true">
        <span>Evidencia</span>
        <span />
        <span>Modelo</span>
        <span />
        <span>Vector</span>
        <span />
        <span>Dónde se guarda</span>
      </div>
      {lanes.map((lane, li) => {
        const col = (i: VectorIndexName) => overview.colecciones.find((k) => k.indice === i);
        const idx = LANE_INDICES[lane];
        const model = modelInfo(idx.length ? col(idx[0]!)?.modelo : null, lane);
        const evidence = laneEvidence(c, lane);
        return (
          <div key={lane} className="vx-lane" role="listitem" style={{ "--li": li } as CSSProperties}>
            <div className="vx-cell vx-ev" data-phase={pEv}>
              <span className="vx-lane-name">
                <Icon name={LANE_META[lane].icon} size={15} />
                {LANE_META[lane].label}
              </span>
              <span className="vx-chips">
                {lane === "identificadores" ? (
                  <span className="vx-chip" style={{ "--i": 0 } as CSSProperties}>
                    {c.identificadores} {c.identificadores === 1 ? "número o cuenta" : "números o cuentas"}
                  </span>
                ) : (
                  evidence.map((e, i) => (
                    <span key={e} className="vx-chip" style={{ "--i": i } as CSSProperties}>
                      {e}
                    </span>
                  ))
                )}
                {lane === "texto" && c.evidencia.some((e) => e.tipo === "audio") ? <span className="vx-chip-note small muted">y lo transcrito</span> : null}
              </span>
            </div>
            <Connector phase={pMod} />
            <div className="vx-cell vx-model" data-phase={pMod} data-label="Modelo">
              {model.previo ? <span className="vx-model-prev small">{model.previo}</span> : null}
              <strong>{model.nombre}</strong>
              <span className="small muted">{model.detalle}</span>
            </div>
            <Connector phase={pVec} />
            <div className="vx-cell vx-vecs" data-phase={pVec} data-label="Vector">
              {lane === "identificadores" ? (
                <span className="small muted">Sin vector: se compara el HMAC exacto, nunca el número en claro.</span>
              ) : (
                <LaneVectors overview={overview} c={c} indices={idx} />
              )}
            </div>
            <Connector phase={pBase} />
            <div className="vx-cell vx-dest" data-phase={pBase} data-label="Dónde se guarda">
              {lane === "identificadores" ? (
                <span className="vx-col">
                  <strong>D1</strong>
                  <span className="small muted">comparación exacta</span>
                </span>
              ) : (
                idx
                  .filter((i) => (c.vectores[i] ?? 0) > 0)
                  .map((i) => (
                    <span key={i} className="vx-col">
                      <code>{col(i)?.coleccion ?? INDEX_META[i].coleccion}</code>
                      <span className="small muted">
                        {c.vectores[i]} {c.vectores[i] === 1 ? "vector" : "vectores"} de {col(i)?.dim ?? "?"}
                      </span>
                    </span>
                  ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function laneEvidence(c: VectorCaseSummary, lane: Lane): string[] {
  const tipo = lane === "voz" ? ["audio", "video"] : lane === "imagen" ? ["imagen", "video"] : ["texto"];
  return c.evidencia.filter((e) => tipo.includes(e.tipo)).map((e) => e.label);
}

/** Línea entre columnas con un pulso que viaja de izquierda a derecha en su paso. */
function Connector({ phase }: { phase: Phase }) {
  return (
    <span className="vx-connector" data-phase={phase} aria-hidden="true">
      <span className="vx-run">
        <i />
      </span>
    </span>
  );
}

/** Tiras de números de un carril: las huellas, la ficha o los recortes; los segmentos se resumen. */
function LaneVectors({ overview, c, indices }: { overview: VectorOverview; c: VectorCaseSummary; indices: VectorIndexName[] }) {
  const main = indices[0]!;
  const pts = casePoints(overview, c.case_id, main);
  const dim = overview.colecciones.find((k) => k.indice === main)?.dim ?? 0;
  const shown = pts.slice(0, 3);
  const segs = indices.includes("voz_segmento") ? casePoints(overview, c.case_id, "voz_segmento") : [];
  return (
    <div className="vx-strips">
      {shown.map((p, i) => (
        <div key={p.id} className="vx-strip-row">
          <VectorStrip point={p} delay={i} />
          <span className="vx-strip-label small">
            <strong>{p.ref}</strong>
            {p.evidencia ? <span className="muted"> · {p.evidencia}</span> : null}
          </span>
        </div>
      ))}
      <span className="small muted">
        {dim ? `32 de los ${dim} números de cada vector` : null}
        {pts.length > shown.length ? ` · y ${pts.length - shown.length} más` : ""}
        {segs.length ? ` · más ${segs.length} ${segs.length === 1 ? "segmento" : "segmentos"} de 3 s, uno por vector` : ""}
      </span>
    </div>
  );
}

const CELL = 8;
const GAP = 1.5;

export function VectorStrip({ point, delay = 0 }: { point: VectorPoint; delay?: number }) {
  const w = point.muestra.length * (CELL + GAP) - GAP;
  return (
    <svg className="vx-strip" width={w} height={18} viewBox={`0 0 ${w} 18`} aria-hidden="true" style={{ "--d": delay } as CSSProperties}>
      {point.muestra.map((v, i) => (
        <rect key={i} x={i * (CELL + GAP)} y={0} width={CELL} height={18} rx={1.5} fill={divergingColor(v)} style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}

// --- Mapas de las colecciones -------------------------------------------------------------------

function MapLegend({ caso }: { caso: string }) {
  return (
    <ul className="legend vx-legend" aria-label="Leyenda de los mapas">
      <li>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="var(--terracota)" stroke="var(--papel)" strokeWidth="1.5" />
        </svg>
        Caso {caso}
      </li>
      <li>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="3.6" fill="var(--tinta-3)" opacity="0.55" />
        </svg>
        Otros casos
      </li>
      <li>
        <svg aria-hidden="true" width="34" height="14" viewBox="0 0 34 14">
          <path d="M2 7h22" stroke="var(--tinta)" strokeWidth="1.6" />
          <circle cx="27" cy="7" r="4.5" fill="var(--tinta)" stroke="var(--papel)" strokeWidth="1.5" />
        </svg>
        Vecino que cuenta
      </li>
      <li>
        <svg aria-hidden="true" width="34" height="14" viewBox="0 0 34 14">
          <path d="M2 7h22" stroke="var(--tinta-3)" strokeWidth="1.4" strokeDasharray="3 3" />
          <circle cx="27" cy="7" r="4" fill="var(--papel)" stroke="var(--tinta-3)" strokeWidth="1.4" />
        </svg>
        No pasa el umbral
      </li>
      <li className="vx-legend-scale">
        <span className="vx-scale" aria-hidden="true" style={{ "--neg": DIVERGING.neg, "--mid": DIVERGING.mid, "--pos": DIVERGING.pos } as CSSProperties} />
        <span>Tira: negativo, cero, positivo</span>
      </li>
    </ul>
  );
}

interface Hover {
  point: VectorPoint;
  score: number | null;
}

function MapCard({
  overview,
  c,
  indice,
  land,
  search,
  trace,
  loading,
}: {
  overview: VectorOverview;
  c: VectorCaseSummary;
  indice: VectorIndexName;
  land: Phase;
  search: Phase;
  trace: VectorTrace | null;
  loading: boolean;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const map = overview.mapas.find((m) => m.indice === indice);
  const col = overview.colecciones.find((k) => k.indice === indice);
  const all = pointsOf(overview, indice);
  const mine = all.filter((p) => p.case_id === c.case_id);
  const others = all.filter((p) => p.case_id !== c.case_id);
  const has = mine.length > 0;
  const qs = queriesOf(trace, indice);
  const showSearch = has && search !== "later" && trace !== null;
  const scanning = has && search === "now" && !trace && loading;
  const neighbors = showSearch ? aggregateNeighbors(qs) : [];
  const nbById = new Map(neighbors.map((n) => [n.id, n]));
  const byId = new Map(all.map((p) => [p.id, p]));
  const anim = search === "now";

  const labels = placeLabels(
    bestPerCase(neighbors.filter((n) => n.pasa))
      .map((n) => {
        const p = byId.get(n.id);
        return p ? { id: n.id, text: `${n.caso} · ${fmtScore(n.score)}`, ...toSvg(p) } : null;
      })
      .filter((x): x is { id: number; text: string; cx: number; cy: number } => Boolean(x)),
    3,
    [...(land !== "later" ? mine : []), ...neighbors.map((n) => byId.get(n.id)).filter((p): p is VectorPoint => Boolean(p))].map(toSvg),
  );

  const status = !has
    ? `El caso ${c.caso} no tiene vectores aquí.`
    : scanning
      ? `Consultando ${PROVIDER_LABEL[overview.almacen.proveedor]}…`
      : showSearch
        ? qs.length
          ? `${qs.length} ${qs.length === 1 ? "consulta" : "consultas"} · ${latencyText(qs)} · ${neighbors.filter((n) => n.pasa).length} ${neighbors.filter((n) => n.pasa).length === 1 ? "vecino cuenta" : "vecinos cuentan"}`
          : "Sin consultas"
        : land !== "later"
          ? `${mine.length} ${mine.length === 1 ? "vector guardado" : "vectores guardados"}`
          : `${all.length} vectores en la colección`;

  const title = col?.coleccion ?? INDEX_META[indice].coleccion;
  return (
    <figure className="vx-map" data-has={has} aria-labelledby={`vx-map-${indice}`}>
      <figcaption id={`vx-map-${indice}`} className="vx-map-head">
        <code>{title}</code>
        <span className="small muted">
          {INDEX_META[indice].label} · {col?.dim ?? "?"} números
        </span>
      </figcaption>
      <div className="vx-map-box" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${MAP.w} ${MAP.h}`}
          role="img"
          aria-label={`Mapa de ${title}: ${all.length} vectores${has ? `, ${mine.length} del caso ${c.caso}` : ""}. La tabla de consultas trae los mismos datos.`}
        >
          <rect className="vx-map-frame" x="0.5" y="0.5" width={MAP.w - 1} height={MAP.h - 1} rx="8" />
          <path className="vx-map-axis" d={`M${MAP.w / 2} ${MAP.pad}V${MAP.h - MAP.pad}M${MAP.pad} ${MAP.h / 2}H${MAP.w - MAP.pad}`} />
          {others.map((p) => {
            const { cx, cy } = toSvg(p);
            const nb = nbById.get(p.id);
            return <circle key={p.id} className="vx-pt-other" data-nb={nb ? (nb.pasa ? "pasa" : "no") : undefined} cx={cx} cy={cy} r={4.2} />;
          })}
          {/* Líneas de cada vecino a la consulta que más se le parece. */}
          {neighbors.map((n, i) => {
            const a = byId.get(n.desde);
            const b = byId.get(n.id);
            if (!a || !b) return null;
            const pa = toSvg(a);
            const pb = toSvg(b);
            return (
              <line
                key={`l-${n.id}`}
                className={`vx-line${n.pasa ? "" : " vx-line-no"}${anim ? " vx-in" : ""}`}
                x1={pa.cx}
                y1={pa.cy}
                x2={pb.cx}
                y2={pb.cy}
                pathLength={n.pasa ? 1 : undefined}
                style={{ "--i": i } as CSSProperties}
              />
            );
          })}
          {neighbors.map((n, i) => {
            const b = byId.get(n.id);
            if (!b) return null;
            const { cx, cy } = toSvg(b);
            return (
              <circle
                key={`n-${n.id}`}
                className={`vx-nb${n.pasa ? "" : " vx-nb-no"}${anim ? " vx-in" : ""}`}
                cx={cx}
                cy={cy}
                r={n.pasa ? 5.4 : 4.6}
                style={{ "--i": i } as CSSProperties}
              />
            );
          })}
          {land !== "later"
            ? mine.map((p, i) => {
                const { cx, cy } = toSvg(p);
                return (
                  <g key={`m-${p.id}`} className={`vx-mine${land === "now" ? " vx-in" : ""}`} style={{ "--i": i } as CSSProperties}>
                    {land === "now" ? <circle className="vx-drop-ring" cx={cx} cy={cy} r={7} /> : null}
                    <circle className="vx-pt-mine" cx={cx} cy={cy} r={6} />
                  </g>
                );
              })
            : null}
          {(scanning || (anim && showSearch)) && land !== "later"
            ? mine.slice(0, 8).map((p, i) => {
                const { cx, cy } = toSvg(p);
                return <circle key={`r-${p.id}`} className={`vx-ring${scanning ? " vx-ring-wait" : ""}`} cx={cx} cy={cy} r={9} style={{ "--i": i } as CSSProperties} />;
              })
            : null}
          {labels.map((l) => (
            <text
              key={`t-${l.id}`}
              className={`vx-label${anim ? " vx-in" : ""}`}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              style={{ "--i": neighbors.findIndex((n) => n.id === l.id) } as CSSProperties}
            >
              {l.text}
            </text>
          ))}
          {/* Zonas de puntería más grandes que el punto, para el detalle al pasar el mouse. */}
          {all.map((p) => {
            if (p.case_id === c.case_id && land === "later") return null;
            const { cx, cy } = toSvg(p);
            const nb = nbById.get(p.id);
            return (
              <circle
                key={`h-${p.id}`}
                className="vx-hit"
                cx={cx}
                cy={cy}
                r={11}
                onMouseEnter={() => setHover({ point: p, score: nb?.score ?? null })}
              />
            );
          })}
        </svg>
        {hover ? <MapTooltip hover={hover} c={c} /> : null}
        {!has ? <span className="vx-map-empty small">Sin vectores del caso {c.caso}</span> : null}
      </div>
      <p className="vx-map-status small" data-wait={scanning}>
        {scanning ? <span className="spinner" aria-hidden="true" /> : null}
        {status}
      </p>
      {map ? <p className="vx-map-var small muted">Los dos ejes explican {fmtVarianza(map.varianza)} de la varianza</p> : null}
    </figure>
  );
}

function MapTooltip({ hover, c }: { hover: Hover; c: VectorCaseSummary }) {
  const { cx, cy } = toSvg(hover.point);
  const left = (cx / MAP.w) * 100;
  const top = (cy / MAP.h) * 100;
  const mine = hover.point.case_id === c.case_id;
  return (
    <div className="vx-tip" style={{ left: `${left}%`, top: `${top}%` }} data-flip={left > 60} role="presentation">
      <strong>
        Caso {hover.point.caso}
        {mine ? " (este caso)" : ""}
      </strong>
      <span>
        {hover.point.ref}
        {hover.point.evidencia ? ` · ${hover.point.evidencia}` : ""}
      </span>
      {hover.score !== null ? <span>Coseno con el caso {c.caso}: {fmtScore(hover.score)}</span> : null}
      <span className="muted">Vector #{hover.point.id}</span>
    </div>
  );
}

// --- Candidatos, señales y revisión -------------------------------------------------------------

function SignalGlyph({ k, size = 14 }: { k: SignalKey; size?: number }) {
  const m = SIGNAL_META[k];
  const common = { fill: m.color, stroke: m.borde, strokeWidth: 1.6 };
  const shape = (() => {
    switch (m.forma) {
      case "circulo":
        return <circle cx="8" cy="8" r="6" {...common} />;
      case "rombo":
        return <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" {...common} />;
      case "hexagono":
        return <path d="M4.8 2h6.4l3.3 6-3.3 6H4.8L1.5 8z" {...common} />;
      case "etiqueta":
        return <path d="M1.5 4h8.5l4.5 4-4.5 4H1.5z" strokeLinejoin="round" {...common} />;
    }
  })();
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16">
      {shape}
    </svg>
  );
}

function Candidates({
  c,
  overview,
  trace,
  loading,
  senales,
  revision,
}: {
  c: VectorCaseSummary;
  overview: VectorOverview;
  trace: VectorTrace | null;
  loading: boolean;
  senales: Phase;
  revision: Phase;
}) {
  if (senales === "later") return null;
  const head = (
    <div className="vx-cands-head">
      <h3>Señales y puntaje</h3>
      {trace ? (
        <span className="small muted">
          Revisión desde {fmtScore(trace.umbrales.revisar)} · probable desde {fmtScore(trace.umbrales.probable)}
        </span>
      ) : null}
    </div>
  );
  if (!trace) {
    return (
      <section className="vx-cands" aria-label="Candidatos">
        {head}
        {loading ? <Loading label="Consultando la base vectorial…" /> : null}
      </section>
    );
  }
  const distrito = (id: string) => overview.casos.find((x) => x.case_id === id)?.distrito ?? null;
  const showScore = revision !== "later";
  return (
    <section className="vx-cands" aria-label="Candidatos">
      {head}
      {trace.candidatos.length ? (
        <ul className="list-plain vx-cand-list">
          {trace.candidatos.map((k, i) => (
            <CandidateRow key={k.case_id} k={k} i={i} distrito={distrito(k.case_id)} showScore={showScore} animScore={revision === "now"} animBars={senales === "now"} />
          ))}
        </ul>
      ) : (
        <p className="muted">Ningún caso parecido al {c.caso} pasó los filtros.</p>
      )}
      {showScore ? (
        <Notice kind="notice">
          <span>
            <strong>Ningún vínculo se crea solo.</strong> Los que pasan el umbral esperan en la cola de vínculos a que una persona del equipo los revise; los
            demás se guardan para recalibrar y no se muestran.
          </span>
        </Notice>
      ) : null}
    </section>
  );
}

function CandidateRow({
  k,
  i,
  distrito,
  showScore,
  animScore,
  animBars,
}: {
  k: VectorCandidate;
  i: number;
  distrito: string | null;
  showScore: boolean;
  animScore: boolean;
  animBars: boolean;
}) {
  const sigs = SIGNAL_ORDER.filter((s) => typeof k.senales[s] === "number");
  return (
    <li className="vx-cand" data-estado={k.estado} style={{ "--i": i } as CSSProperties}>
      <div className="vx-cand-who">
        <span className="case-letter" aria-hidden="true">
          {k.caso}
        </span>
        <span className="stack-sm" style={{ gap: 0 }}>
          <span className="strong">Caso {k.caso}</span>
          {distrito ? <span className="small muted">{distrito}</span> : null}
          <span className="small muted">Llegó por: {k.fuentes.map((f) => SOURCE_LABEL[f]).join(", ")}</span>
        </span>
      </div>
      <ul className="list-plain vx-sigs" aria-label={`Señales del caso ${k.caso}`}>
        {sigs.map((s, j) => {
          const p = k.senales[s]!;
          return (
            <li key={s} className="vx-sig">
              <SignalGlyph k={s} />
              <span className="vx-sig-name small">{SIGNAL_META[s].label}</span>
              <span className="vx-sig-track" aria-hidden="true">
                <span
                  className={animBars ? "vx-in" : undefined}
                  style={{ width: `${Math.round(p * 100)}%`, background: SIGNAL_META[s].color, "--i": i * 2 + j } as CSSProperties}
                />
              </span>
              <span className="vx-sig-p small strong">{fmtScore(p)}</span>
            </li>
          );
        })}
        {!sigs.length ? <li className="small muted">Sin señales</li> : null}
      </ul>
      <div className={`vx-cand-score${animScore ? " vx-in" : ""}`} data-show={showScore} style={{ "--i": i } as CSSProperties}>
        {showScore ? (
          <>
            <span className="vx-score">{fmtScore(k.puntaje)}</span>
            <span className="vx-formula small muted">{combineFormula(k)}</span>
            <span className="row" style={{ gap: 6 }}>
              <StatusBadge status={k.estado} />
            </span>
            <span className="small">{ESTADO_DESTINO[k.estado]}</span>
          </>
        ) : (
          <span className="small muted">El puntaje sale en el paso siguiente</span>
        )}
      </div>
    </li>
  );
}

/** Las consultas como tabla: la alternativa de los mapas para lectores de pantalla y para revisar números. */
function TraceTable({ trace }: { trace: VectorTrace }) {
  type Row = { q: VectorQuery; n: VectorNeighbor | null; first: boolean };
  const rows = trace.consultas.flatMap<Row>((q) =>
    q.vecinos.length ? q.vecinos.map((n, j) => ({ q, n, first: j === 0 })) : [{ q, n: null, first: true }],
  );
  return (
    <details className="vx-table">
      <summary>Ver las {trace.consultas.length} consultas como tabla</summary>
      <p className="small muted">
        {PROVIDER_LABEL[trace.proveedor]} · {fmtMs(trace.total_ms)} en total, contando el cálculo de las señales.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Colección</th>
              <th>Consulta</th>
              <th>Vecino</th>
              <th className="num">Coseno</th>
              <th>¿Cuenta?</th>
              <th className="num">Tiempo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ q, n, first }, i) => (
              <tr key={`${q.consulta}-${n?.id ?? "none"}-${i}`}>
                <td>{first ? <code>{INDEX_META[q.indice].coleccion}</code> : null}</td>
                <td>{first ? q.ref : null}</td>
                <td>{n ? `Caso ${n.caso} · ${n.ref}` : <span className="muted">Sin vecinos de otros casos</span>}</td>
                <td className="num">{n ? fmtScore(n.score) : "—"}</td>
                <td>{n ? (n.pasa ? "Sí" : `No (umbral ${fmtScore(q.umbral ?? 0)})`) : "—"}</td>
                <td className="num">{first ? fmtMs(q.latencia_ms) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Inventario de colecciones y nota del mapa
// ---------------------------------------------------------------------------

/** Qué hay en cada colección y si la base está al día con D1. Exportada para los tests. */
export function CollectionsTable({ overview }: { overview: VectorOverview }) {
  const ids = overview.casos.reduce((s, x) => s + x.identificadores, 0);
  const providerName = PROVIDER_LABEL[overview.almacen.proveedor];
  return (
    <section className="panel vx-cols" aria-labelledby="vx-cols-title">
      <div className="panel-head">
        <h2 id="vx-cols-title">Colecciones</h2>
        <span className="small muted">Una por tipo de vector. Las cifras de D1 son de casos indexados con consentimiento comunitario.</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Colección</th>
              <th>Qué guarda</th>
              <th>Modelo</th>
              <th className="num">Números por vector</th>
              <th className="num">En D1</th>
              <th className="num">En {providerName}</th>
            </tr>
          </thead>
          <tbody>
            {INDEX_ORDER.map((i) => {
              const k = overview.colecciones.find((x) => x.indice === i);
              if (!k) return null;
              const m = modelInfo(k.modelo, INDEX_META[i].lane);
              return (
                <tr key={i}>
                  <td>
                    <code>{k.coleccion ?? INDEX_META[i].coleccion}</code>
                  </td>
                  <td>{INDEX_META[i].label}</td>
                  <td>
                    <span className="strong">{m.nombre}</span>
                    {m.previo ? <span className="small muted"> · {m.previo}</span> : null}
                  </td>
                  <td className="num">{k.dim}</td>
                  <td className="num">{k.en_d1}</td>
                  <td className="num">
                    <BaseCount k={k} />
                  </td>
                </tr>
              );
            })}
            <tr>
              <td>
                <span className="muted">no aplica</span>
              </td>
              <td>Identificadores (números y cuentas)</td>
              <td>
                <span className="strong">HMAC-SHA256</span>
                <span className="small muted"> · comparación exacta en D1</span>
              </td>
              <td className="num">sin vector</td>
              <td className="num">{ids}</td>
              <td className="num">
                <span className="muted">no se guardan</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BaseCount({ k }: { k: VectorCollection }): ReactNode {
  if (k.en_base === null) return <span className="vx-mismatch">Sin respuesta</span>;
  if (k.en_base === k.en_d1)
    return (
      <span className="vx-ok">
        <Icon name="check" size={14} />
        {k.en_base}
      </span>
    );
  const diff = k.en_d1 - k.en_base;
  return (
    <span className="vx-mismatch">
      {k.en_base} · {diff > 0 ? `faltan ${diff}` : `sobran ${-diff}`}, sincroniza
    </span>
  );
}

function MapNote({ overview }: { overview: VectorOverview }) {
  const vs = overview.mapas.map((m) => `${INDEX_META[m.indice].corto}: ${fmtVarianza(m.varianza)}`);
  return (
    <section className="vx-note small" aria-label="Cómo leer los mapas">
      <p>
        <strong>Cómo leer los mapas.</strong> Cada punto es un vector. El mapa es una proyección (PCA) de 192 o 384 números a dos ejes, que explican
        una parte de la varianza ({vs.join("; ")}): ayuda a ver, no decide. La comparación real es el coseno con todos los números, por eso dos puntos
        cercanos en el mapa pueden no pasar el umbral.
      </p>
      <p>
        {overview.almacen.solo_demo
          ? "La base en la nube solo guarda casos ficticios del demo, con ids numéricos: sin texto, sin audio y sin datos personales. "
          : ""}
        Si un caso deja de estar indexado, sus vectores salen de la base; y aunque quedara alguno, la búsqueda siempre vuelve a filtrar contra D1.
      </p>
    </section>
  );
}

