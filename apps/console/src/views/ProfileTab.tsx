import { useState } from "react";
import { errorMessage } from "../api/client";
import type { CartografoModel, HypothesisView, NetworkView, ProfileView } from "../api/types";
import { useApi, useUser } from "../app/context";
import { CiteList, CitedText } from "../components/Citations";
import { Icon } from "../components/Icons";
import { Confidence, Empty, ErrorBox, Loading, Modal, Notice, StatusBadge, useFlash } from "../components/ui";
import { NONESSENTIAL_BLOCK_PCT } from "../config";
import { SECTOR_LABEL, fmtDateTime, fmtPct, fmtUsd } from "../lib/format";
import { can } from "../lib/permissions";
import { useAsync } from "../lib/useAsync";

const MODELS: { id: CartografoModel; name: string; estimate: number; note: string; essential: boolean }[] = [
  {
    id: "muse-spark-1.3",
    name: "Muse Spark 1.3",
    estimate: 0.3,
    note: "Recomendado. Unos 200,000 tokens de entrada y 10,000 de salida.",
    essential: true,
  },
  {
    id: "muse-wonder-1.0",
    name: "Muse Wonder 1.0",
    estimate: 1.0,
    note: "Para redes muy grandes. Cuesta unas tres veces más y es no esencial: se bloquea al 80% del presupuesto.",
    essential: false,
  },
];

export function ProfileTab({ net, onChanged }: { net: NetworkView; onChanged: () => void }) {
  const api = useApi();
  const user = useUser();
  const profiles = useAsync(() => api.listProfiles(net.id), `profiles:${net.id}`);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [flash, showFlash] = useFlash();

  const list = profiles.data ?? [];
  const current = list.find((p) => p.id === pickedId) ?? list[0];

  const onRun = (p: ProfileView) => {
    profiles.setData((prev) => [p, ...(prev ?? [])]);
    setPickedId(p.id);
    onChanged();
    showFlash(
      p.citation_check.ok
        ? `El Cartógrafo terminó con ${p.model}. El validador de citas no encontró problemas.`
        : `El Cartógrafo terminó, pero el validador de citas marcó el perfil como inválido.`,
      p.citation_check.ok ? "success-box" : "error-box",
    );
  };

  const onHypothesis = (h: HypothesisView) => {
    profiles.setData((prev) =>
      (prev ?? []).map((p) => {
        if (!p.hypotheses.some((x) => x.id === h.id)) return p;
        const hypotheses = p.hypotheses.map((x) => (x.id === h.id ? h : x));
        const allDone = hypotheses.every((x) => x.status !== "borrador");
        return { ...p, hypotheses, status: allDone ? (hypotheses.some((x) => x.status === "aprobada") ? "aprobado" : "rechazado") : p.status };
      }),
    );
    onChanged();
  };

  return (
    <div className="stack">
      {flash}
      {can(user.role, "cartografo.run") ? <CartografoRunner net={net} onDone={onRun} /> : null}
      {profiles.error ? <ErrorBox error={profiles.error} onRetry={profiles.reload} /> : null}
      {profiles.loading && !profiles.data ? <Loading label="Cargando perfiles…" /> : null}
      {profiles.data && list.length === 0 ? (
        <Empty title="Esta red aún no tiene perfil">
          {can(user.role, "cartografo.run") ? "Ejecuta el Cartógrafo para generar hechos e hipótesis citados." : "Un analista debe ejecutar el Cartógrafo."}
        </Empty>
      ) : null}
      {list.length > 1 ? (
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="perfil-version">Versión del perfil</label>
          <select id="perfil-version" value={current?.id ?? ""} onChange={(e) => setPickedId(e.target.value)}>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {fmtDateTime(p.created_at)} · {p.model} · {p.status}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {current ? <ProfileBody profile={current} canDecide={can(user.role, "hypotheses.decide")} onHypothesis={onHypothesis} /> : null}
    </div>
  );
}

function CartografoRunner({ net, onDone }: { net: NetworkView; onDone: (p: ProfileView) => void }) {
  const api = useApi();
  const costs = useAsync(() => api.costs(), "costs:cartografo");
  const [model, setModel] = useState<CartografoModel>("muse-spark-1.3");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = costs.data?.nonessential_blocked ?? false;
  const chosen = MODELS.find((m) => m.id === model)!;

  const run = async () => {
    setConfirming(false);
    setRunning(true);
    setError(null);
    try {
      const p = await api.runCartografo(net.id, model);
      onDone(p);
      costs.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="carto-titulo">
      <div className="panel-head">
        <h2 id="carto-titulo">
          <Icon name="map" /> Cartógrafo
        </h2>
        {costs.data ? (
          <span className="small muted">
            Gasto acumulado {fmtUsd(costs.data.total_usd)} de {fmtUsd(costs.data.budget_usd, 0)} ({fmtPct(costs.data.pct)})
          </span>
        ) : null}
      </div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        Analiza la red con las herramientas de la base de casos (sin búsqueda web) y propone hechos e hipótesis citados. Nada sale sin tu aprobación.
      </p>
      <fieldset>
        <legend>Modelo</legend>
        <div className="stack-sm">
          {MODELS.map((m) => {
            const disabled = !m.essential && blocked;
            return (
              <label key={m.id} className="row" style={{ alignItems: "flex-start", gap: 10, cursor: disabled ? "not-allowed" : "pointer" }}>
                <input
                  type="radio"
                  name="modelo"
                  value={m.id}
                  checked={model === m.id}
                  disabled={disabled || running}
                  onChange={() => setModel(m.id)}
                  style={{ marginTop: 4, width: 18, height: 18 }}
                />
                <span className="stack-sm" style={{ gap: 0 }}>
                  <span>
                    <span className="strong">{m.name}</span> <code>{m.id}</code> · costo estimado <strong>{fmtUsd(m.estimate)}</strong>
                    {!m.essential ? <span className="chip chip-outline" style={{ marginLeft: 6 }}>No esencial</span> : null}
                  </span>
                  <span className="small muted">{disabled ? `Bloqueado: el gasto superó el ${NONESSENTIAL_BLOCK_PCT}% del presupuesto.` : m.note}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary" disabled={running} onClick={() => setConfirming(true)}>
          <Icon name="play" size={15} />
          Ejecutar Cartógrafo
        </button>
        {running ? <Loading label={`El Cartógrafo está analizando ${net.label} con ${chosen.name}…`} /> : null}
      </div>
      {error ? (
        <div style={{ marginTop: 10 }}>
          <Notice kind="error-box">{error}</Notice>
        </div>
      ) : null}
      <Modal open={confirming} onClose={() => setConfirming(false)} title="¿Ejecutar el Cartógrafo?" labelledBy="carto-confirm">
        <p>
          Se analizará la red <strong>{net.label}</strong> ({net.n_cases} casos) con <strong>{chosen.name}</strong>.
        </p>
        <Notice kind="warn">
          Esta ejecución usa la Meta Model API. Costo estimado: <strong>{fmtUsd(chosen.estimate)}</strong>
          {costs.data ? ` (llevas ${fmtUsd(costs.data.total_usd)} de ${fmtUsd(costs.data.budget_usd, 0)}).` : "."}
        </Notice>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void run()} autoFocus>
            Ejecutar
          </button>
        </div>
      </Modal>
    </section>
  );
}

function ProfileBody({
  profile,
  canDecide,
  onHypothesis,
}: {
  profile: ProfileView;
  canDecide: boolean;
  onHypothesis: (h: HypothesisView) => void;
}) {
  const p = profile.perfil;
  const check = profile.citation_check;
  const missing = check.citas_inexistentes;
  const hypotheses: HypothesisView[] =
    profile.hypotheses.length > 0
      ? profile.hypotheses
      : p.hipotesis.map((h, i) => ({ id: `${profile.id}-h${i}`, texto: h.texto, confianza: h.confianza, evidencia: h.evidencia, status: "borrador", reviewed_by: null }));
  const decidable = canDecide && profile.hypotheses.length > 0 && profile.status !== "invalido";

  return (
    <article className="stack" aria-labelledby="perfil-titulo">
      <section className="panel">
        <div className="panel-head">
          <h2 id="perfil-titulo">
            Perfil de {p.red} <StatusBadge status={profile.status} />
          </h2>
          <span className="small muted">
            {profile.model} · {fmtDateTime(profile.created_at)}
          </span>
        </div>
        {check.ok ? (
          <Notice kind="success-box">
            <strong>Validador de citas: correcto.</strong> Cada afirmación cita evidencia que existe en la base de casos.
          </Notice>
        ) : (
          <Notice kind="error-box">
            <div className="stack-sm">
              <strong>Validador de citas: el perfil no es válido.</strong>
              {check.sin_cita.length ? (
                <div>
                  Afirmaciones sin cita:
                  <ul>
                    {check.sin_cita.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {missing.length ? (
                <div className="row">
                  Citas inexistentes: <CiteList refs={missing} missing={missing} label="Citas inexistentes" />
                </div>
              ) : null}
              <span className="small">Las hipótesis de un perfil inválido no se pueden aprobar. Vuelve a ejecutar el Cartógrafo.</span>
            </div>
          </Notice>
        )}
        <dl className="dl" style={{ marginTop: 12 }}>
          <dt>Casos</dt>
          <dd>{p.casos}</dd>
          <dt>Periodo</dt>
          <dd>{p.periodo ?? "—"}</dd>
          <dt>Sectores</dt>
          <dd className="row" style={{ gap: 4 }}>
            {p.sectores.map((s) => (
              <span key={s.sector} className="chip chip-grid">
                {SECTOR_LABEL[s.sector] ?? s.sector}: {s.casos}
              </span>
            ))}
          </dd>
          <dt>Territorio</dt>
          <dd>
            {p.territorio.length ? (
              p.territorio.map((t) => `${t.zona} (${t.casos})`).join(", ")
            ) : (
              <span className="muted">Oculto por el umbral de agregación: hacen falta al menos 5 casos y 3 víctimas distintas.</span>
            )}
          </dd>
          <dt>Modus operandi</dt>
          <dd>
            <CitedText text={p.modus_operandi} missing={missing} />
          </dd>
        </dl>
      </section>

      <div className="grid-2">
        <section className="panel stack-sm" aria-labelledby="hechos-titulo">
          <h2 id="hechos-titulo">Hechos</h2>
          <p className="small muted">Lo que muestran los datos, con su evidencia.</p>
          {p.hechos.length ? (
            p.hechos.map((h, i) => (
              <div key={i} className="fact">
                <span>
                  <CitedText text={h.texto} missing={missing} />
                </span>
                <CiteList refs={h.evidencia} missing={missing} />
              </div>
            ))
          ) : (
            <span className="muted">Sin hechos.</span>
          )}
        </section>
        <section className="panel stack-sm" aria-labelledby="hipo-titulo">
          <h2 id="hipo-titulo">Hipótesis</h2>
          <p className="small muted">Interpretaciones con confianza. Cada una necesita tu aprobación.</p>
          {hypotheses.length ? (
            hypotheses.map((h) => <HypothesisCard key={h.id} h={h} missing={missing} decidable={decidable} onDecided={onHypothesis} />)
          ) : (
            <span className="muted">Sin hipótesis.</span>
          )}
        </section>
      </div>

      <div className="grid-3">
        <section className="panel stack-sm">
          <h3>Escalamiento</h3>
          <p>{p.escalamiento ? <CitedText text={p.escalamiento} missing={missing} /> : <span className="muted">Sin datos.</span>}</p>
        </section>
        <section className="panel stack-sm">
          <h3>Brechas de información</h3>
          {p.brechas.length ? (
            <ul>
              {p.brechas.map((b) => (
                <li key={b}>
                  <CitedText text={b} missing={missing} />
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">Ninguna.</span>
          )}
        </section>
        <section className="panel stack-sm">
          <h3>Recomendaciones para la autoridad</h3>
          {p.recomendaciones_autoridad.length ? (
            <ul>
              {p.recomendaciones_autoridad.map((r) => (
                <li key={r}>
                  <CitedText text={r} missing={missing} />
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">Ninguna.</span>
          )}
          <span className="small muted">Nunca son para las víctimas.</span>
        </section>
      </div>
    </article>
  );
}

function HypothesisCard({
  h,
  missing,
  decidable,
  onDecided,
}: {
  h: HypothesisView;
  missing: string[];
  decidable: boolean;
  onDecided: (h: HypothesisView) => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "aprobar" | "descartar") => {
    setBusy(true);
    setError(null);
    try {
      onDecided(await api.decideHypothesis(h.id, decision));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`hypo ${h.status}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Confidence value={h.confianza} />
        <StatusBadge status={h.status} />
      </div>
      <span>
        <CitedText text={h.texto} missing={missing} />
      </span>
      <CiteList refs={h.evidencia} missing={missing} />
      {h.status === "borrador" && decidable ? (
        <div className="row">
          <button type="button" className="btn btn-sm btn-ok" disabled={busy} onClick={() => void decide("aprobar")}>
            <Icon name="check" size={14} /> Aprobar
          </button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void decide("descartar")}>
            <Icon name="x" size={14} /> Descartar
          </button>
        </div>
      ) : h.reviewed_by ? (
        <span className="small muted">Revisada por {h.reviewed_by}</span>
      ) : null}
      {error ? <span className="small" style={{ color: "var(--peligro)" }} role="alert">{error}</span> : null}
    </div>
  );
}
