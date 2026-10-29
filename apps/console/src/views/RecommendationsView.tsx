import "../styles/recommendations.css";

import { districtOfZone, type AsesorOutput, type ConsoleRecommendationView } from "@blindaje/shared";
import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { advisorFor, type AdvisorApi, type RecommendationStatus } from "../api/advisor";
import { errorMessage } from "../api/client";
import { useApi, useUser } from "../app/context";
import { CiteList, CitationProvider } from "../components/Citations";
import { DistrictSelect } from "../components/DistrictSelect";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, InlineConfirm, Loading, Notice, PageHead, StatusBadge, useFlash } from "../components/ui";
import { fmtDateTime, SECTOR_LABEL, zoneName } from "../lib/format";
import { can } from "../lib/permissions";
import { useAsync } from "../lib/useAsync";
import { looksLikeFullNumber } from "./AlertsView";

type Filter = RecommendationStatus | "todas";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "borrador", label: "Borradores" },
  { id: "aprobada", label: "Aprobadas" },
  { id: "rechazada", label: "Rechazadas" },
  { id: "todas", label: "Todas" },
];

const NIVEL: Record<AsesorOutput["nivel_riesgo"], string> = { sin_datos: "sin datos suficientes", bajo: "bajo", medio: "medio", alto: "alto" };
const PRIORIDADES = ["alta", "media", "baja"] as const;
const PRIORIDAD_TITULO: Record<(typeof PRIORIDADES)[number], string> = { alta: "Haz esto primero", media: "Después", baja: "Cuando puedas" };

/** Rubro de la API (singular) en una frase: "bodega" → "bodegas". */
const SECTOR_PLURAL: Record<string, string> = {
  bodega: "bodegas",
  mototaxi: "mototaxis",
  transporte: "transporte",
  mercado: "mercados",
  restaurante: "restaurantes",
  construccion: "construcción",
  otro: "otros rubros",
};
export function sectorPhrase(sector: string): string {
  const k = sector.trim().toLowerCase();
  return SECTOR_PLURAL[k] ?? SECTOR_PLURAL[k.replace(/s$/, "")] ?? k;
}

/** Todo el texto que verá el negocio. */
export function visibleTexts(c: AsesorOutput): string[] {
  return [
    c.resumen,
    ...c.modalidades.flatMap((m) => [m.descripcion, ...m.senales_de_alerta]),
    ...c.recomendaciones.flatMap((r) => [r.titulo, r.detalle]),
    ...c.que_hacer_si_te_pasa,
    ...c.advertencias,
  ];
}

/** Frases que aconsejan pagar o negociar (lo negado, como "No pagues ni negocies", está bien). */
export function unsafeAdvice(texts: string[]): string[] {
  const re = /(?:(\p{L}+)\s+)?(?<!\p{L})(paga|pagues|pague|pagar|págales|negocia|negocies|negocie|negociar)(?!\p{L})/giu;
  return texts.filter((t) => [...t.matchAll(re)].some((m) => !["no", "ni", "nadie", "nunca"].includes((m[1] ?? "").toLowerCase())));
}

/** Revisión automática de las reglas de producto antes de aprobar. */
export function ruleChecks(r: ConsoleRecommendationView): { ok: boolean; label: string }[] {
  const texts = visibleTexts(r.contenido);
  return [
    { ok: r.citation_check.ok, label: r.citation_check.ok ? "Cada modalidad cita evidencia que existe" : "El validador de citas encontró problemas" },
    { ok: !texts.some((t) => looksLikeFullNumber(t) || /\bID-/.test(t)), label: "Sin números, cuentas ni identificadores completos" },
    { ok: unsafeAdvice(texts).length === 0, label: "No aconseja pagar ni negociar" },
    { ok: texts.some((t) => /se denuncia más/i.test(t)), label: "Advierte el sesgo (más casos puede ser más denuncia)" },
    { ok: texts.some((t) => /\b105\b/.test(t)) && texts.some((t) => /1818/.test(t)), label: "Deriva al 105 y a la Línea 1818" },
  ];
}

export function RecommendationsView() {
  const api = useApi();
  const user = useUser();
  const advisor = useMemo(() => advisorFor(api, user), [api, user]);
  const [params, setParams] = useSearchParams();
  const filter: Filter = FILTERS.find((f) => f.id === params.get("estado"))?.id ?? "borrador";
  const setFilter = (f: Filter) => setParams(f === "borrador" ? {} : { estado: f }, { replace: true });
  const recs = useAsync(() => advisor.listRecommendations(filter === "todas" ? undefined : filter), `recs:${filter}`);
  const [flash, showFlash] = useFlash();

  const onCreated = (created: ConsoleRecommendationView[]) => {
    showFlash(
      created.length === 1
        ? `El Asesor redactó un borrador para ${sectorPhrase(created[0]!.contenido.sector)} de ${zoneName(created[0]!.contenido.zona)}.`
        : `El Asesor redactó ${created.length} borradores.`,
    );
    if (filter === "borrador" || filter === "todas") recs.setData((prev) => [...created, ...(prev ?? [])]);
    else setFilter("borrador");
  };

  const onDecided = (r: ConsoleRecommendationView) => {
    showFlash(
      r.status === "aprobada"
        ? `Recomendación aprobada. Ya se ve en el portal público para ${sectorPhrase(r.contenido.sector)} de ${zoneName(r.contenido.zona)} y, en la app, para quien eligió ese distrito.`
        : "Recomendación rechazada. No se publica.",
    );
    recs.setData((prev) => (prev ?? []).map((x) => (x.id === r.id ? r : x)).filter((x) => filter === "todas" || x.status === filter));
  };

  return (
    <>
      <PageHead title="Recomendaciones para negocios">
        El Asesor redacta recomendaciones de prevención por distrito y rubro con datos agregados: cifras solo con 5 casos de 3 víctimas distintas. Nada se
        publica en el portal ni en la app sin que alguien del equipo lo apruebe.
      </PageHead>
      {flash}
      {can(user.role, "asesor.run") ? (
        <RunPanel advisor={advisor} onCreated={onCreated} />
      ) : (
        <Notice>El Asesor lo corre análisis o administración. Tú revisas los borradores de cualquier distrito y decides si se publican.</Notice>
      )}
      <div className="segmented" role="group" aria-label="Filtrar recomendaciones">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {recs.error ? <ErrorBox error={recs.error} onRetry={recs.reload} /> : null}
      {recs.loading && !recs.data ? <Loading /> : null}
      {recs.data && recs.data.length === 0 ? (
        <Empty title={filter === "borrador" ? "No hay borradores pendientes" : "No hay recomendaciones en este estado"}>
          {filter === "borrador" ? (can(user.role, "asesor.run") ? "Corre el Asesor para un distrito y un rubro." : "Aparecerán aquí cuando el equipo de análisis corra el Asesor.") : null}
        </Empty>
      ) : null}
      <div className="stack">
        {recs.data?.map((r) => (
          <RecommendationCard
            key={r.id}
            rec={r}
            advisor={advisor}
            canDecide={can(user.role, "recommendations.decide")}
            canRun={can(user.role, "asesor.run")}
            onDecided={onDecided}
            onCreated={onCreated}
          />
        ))}
      </div>
    </>
  );
}

/** Qué falta para correr el Asesor; null si se puede. */
export function asesorProblem(zona: string, sector: string): string | null {
  if (!districtOfZone(zona)) return "Elige el distrito.";
  if (!sector.trim()) return "Elige el rubro.";
  return null;
}

function RunPanel({ advisor, onCreated }: { advisor: AdvisorApi; onCreated: (r: ConsoleRecommendationView[]) => void }) {
  const [zona, setZona] = useState("");
  const [sector, setSector] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = asesorProblem(zona, sector);
    if (problem) {
      setError(problem);
      document.getElementById(districtOfZone(zona) ? "asesor-sector" : "asesor-zona")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await advisor.runAsesor({ zona, sector }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack-sm" aria-labelledby="asesor-titulo">
      <div className="panel-head">
        <h2 id="asesor-titulo">
          <Icon name="file" /> Correr el Asesor
        </h2>
      </div>
      <form className="asesor-form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="field">
          <label htmlFor="asesor-zona">Distrito</label>
          <DistrictSelect id="asesor-zona" value={zona} onChange={setZona} emptyLabel="Elige un distrito" describedBy="asesor-nota" invalid={error === "Elige el distrito."} />
        </div>
        <div className="field">
          <label htmlFor="asesor-sector">Rubro</label>
          <select id="asesor-sector" value={sector} onChange={(e) => setSector(e.target.value)} aria-invalid={error === "Elige el rubro." || undefined}>
            <option value="">Elige un rubro</option>
            {Object.entries(SECTOR_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Icon name="refresh" size={16} />
          {busy ? "El Asesor está redactando…" : "Correr el Asesor"}
        </button>
      </form>
      <p id="asesor-nota" className="small muted">
        Un borrador por distrito y rubro. Al aprobarlo, lo ve cualquiera que elija ese distrito y ese rubro en el portal público y, en la app, quien eligió
        ese distrito.
      </p>
      {error ? <Notice kind="error-box">{error}</Notice> : null}
    </section>
  );
}

function RecommendationCard({
  rec,
  advisor,
  canDecide,
  canRun,
  onDecided,
  onCreated,
}: {
  rec: ConsoleRecommendationView;
  advisor: AdvisorApi;
  canDecide: boolean;
  canRun: boolean;
  onDecided: (r: ConsoleRecommendationView) => void;
  onCreated: (r: ConsoleRecommendationView[]) => void;
}) {
  const c = rec.contenido;
  const editable = canDecide && rec.status === "borrador";
  const [ask, setAsk] = useState<"aprobar" | "rechazar" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checks = ruleChecks(rec);
  const blocked = !rec.citation_check.ok;
  const failing = checks.filter((x) => !x.ok).length;
  const tid = `rec-${rec.id}`;
  const district = districtOfZone(c.zona);
  const zona = district?.name ?? c.zona;

  const decide = async (decision: "aprobar" | "rechazar") => {
    setBusy(true);
    setError(null);
    try {
      onDecided(await advisor.decideRecommendation(rec.id, decision));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      setAsk(null);
    }
  };

  const rerun = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await advisor.runAsesor({ zona: district?.id ?? c.zona, sector: c.sector }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CitationProvider index={new Map()}>
      <article className="panel" aria-labelledby={tid}>
        <div className="panel-head">
          <h2 id={tid}>
            {zona} · {sectorPhrase(c.sector)} <StatusBadge status={rec.status} />
          </h2>
          <span className="small muted">
            {district ? `${district.area} · ` : ""}
            {rec.model} · creada {fmtDateTime(rec.created_at)}
            {rec.approved_at ? ` · aprobada por ${rec.approved_by ?? "—"} el ${fmtDateTime(rec.approved_at)}` : ""}
          </span>
        </div>
        <div className="grid-2">
          <div className="stack-sm">
            <h3>Revisión antes de aprobar</h3>
            <ul className="list-plain rec-checks">
              {checks.map((x) => (
                <li key={x.label} data-ok={x.ok ? "" : undefined}>
                  <Icon name={x.ok ? "check" : "alert"} size={16} />
                  <span>
                    <span className="sr-only">{x.ok ? "Cumple: " : "Revisar: "}</span>
                    {x.label}
                  </span>
                </li>
              ))}
            </ul>
            {!rec.citation_check.ok ? (
              <Notice kind="warn">
                <p className="strong">Validador de citas</p>
                {rec.citation_check.sin_cita.length ? (
                  <>
                    <p>Afirmaciones sin cita:</p>
                    <ul>
                      {rec.citation_check.sin_cita.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {rec.citation_check.citas_inexistentes.length ? (
                  <p>
                    Citas que no existen: <CiteList refs={rec.citation_check.citas_inexistentes} missing={rec.citation_check.citas_inexistentes} label="Citas inexistentes" />
                  </p>
                ) : null}
              </Notice>
            ) : null}
            <dl className="dl">
              <dt>Nivel de riesgo</dt>
              <dd>{NIVEL[c.nivel_riesgo]}</dd>
              {c.modalidades.map((m, i) => (
                <div key={m.descripcion} className="contents">
                  <dt>Modalidad {i + 1}</dt>
                  <dd className="stack-sm">
                    <span>{m.descripcion}</span>
                    <CiteList refs={m.evidencia} missing={rec.citation_check.citas_inexistentes} label={`Evidencia de la modalidad ${i + 1}`} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="small muted">Las citas internas son solo para la consola: el portal y la app nunca las muestran.</p>

            {editable && ask === "aprobar" ? (
              <InlineConfirm
                id={`${tid}-aprobar`}
                question={`¿Aprobar y publicar esta recomendación para ${sectorPhrase(c.sector)} de ${zona}?`}
                detail={`La verá cualquiera que elija ${zona} y ese rubro en el portal público y, en la app, quien eligió ese distrito, detrás de su PIN. Una recomendación aprobada no se puede retirar desde la consola.`}
                confirmLabel="Sí, aprobar y publicar"
                busyLabel="Aprobando…"
                busy={busy}
                onConfirm={() => void decide("aprobar")}
                onCancel={() => setAsk(null)}
              />
            ) : editable && ask === "rechazar" ? (
              <InlineConfirm
                id={`${tid}-rechazar`}
                question="¿Rechazar esta recomendación?"
                detail="No se publica en el portal ni en la app. Queda registrada en la auditoría."
                confirmLabel="Sí, rechazar"
                busyLabel="Rechazando…"
                icon="x"
                tone="danger"
                busy={busy}
                onConfirm={() => void decide("rechazar")}
                onCancel={() => setAsk(null)}
              />
            ) : editable ? (
              <div className="stack-sm">
                <div className="row">
                  <button type="button" className="btn btn-primary" disabled={blocked || busy} aria-describedby={blocked ? `${tid}-bloq` : undefined} onClick={() => setAsk("aprobar")}>
                    <Icon name="check" size={16} />
                    Aprobar recomendación
                  </button>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setAsk("rechazar")}>
                    <Icon name="x" size={16} />
                    Rechazar
                  </button>
                </div>
                {blocked ? (
                  <p id={`${tid}-bloq`} className="small decision-note">
                    No se puede aprobar: el validador de citas encontró problemas. Rechaza este borrador
                    {canRun ? " o vuelve a correr el Asesor para este distrito y este rubro." : " y pide al equipo de análisis que vuelva a correr el Asesor."}
                  </p>
                ) : failing ? (
                  <p className="small decision-note">Revisa los puntos marcados antes de aprobar.</p>
                ) : null}
                {blocked && canRun ? (
                  <span>
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void rerun()}>
                      <Icon name="refresh" size={15} />
                      Correr el Asesor de nuevo
                    </button>
                  </span>
                ) : null}
              </div>
            ) : null}
            {error ? <Notice kind="error-box">{error}</Notice> : null}
          </div>
          <div className="stack-sm">
            <h3 id={`${tid}-prev`}>Vista previa: así se ve en el portal</h3>
            <BusinessPreview content={c} labelledBy={`${tid}-prev`} />
            <span className="small muted">Es la vista “Mi zona” del portal público, sin cuenta. Sin citas internas, números ni cuentas.</span>
          </div>
        </div>
      </article>
    </CitationProvider>
  );
}

/** Cómo verá la recomendación quien elija el distrito y el rubro en el portal público (apps/portal, vista Mi zona). */
export function BusinessPreview({ content: c, labelledBy }: { content: AsesorOutput; labelledBy?: string }) {
  const groups = PRIORIDADES.map((p) => ({ p, items: c.recomendaciones.filter((r) => r.prioridad === p) })).filter((g) => g.items.length);
  const starts = groups.map((_, gi) => 1 + groups.slice(0, gi).reduce((s, g) => s + g.items.length, 0));
  return (
    <div className="biz-preview" aria-labelledby={labelledBy} role="group">
      <p className="biz-title">Recomendaciones</p>
      <p className="biz-h">
        Para {sectorPhrase(c.sector)} de {zoneName(c.zona)}
      </p>
      {c.nivel_riesgo !== "sin_datos" ? <p className="biz-meta">Riesgo {NIVEL[c.nivel_riesgo]}</p> : null}
      <p>{c.resumen}</p>
      {groups.map((g, gi) => (
        <div key={g.p} className="biz-group">
          <p className="biz-group-h">
            {PRIORIDAD_TITULO[g.p]}
          </p>
          <ol start={starts[gi]}>
            {g.items.map((r) => (
              <li key={r.titulo}>
                <strong>{r.titulo}</strong>
                <span>{r.detalle}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {c.modalidades.length ? (
        <div className="biz-group">
          <p className="biz-group-h">Cómo reconocerla</p>
          {c.modalidades.map((m) => (
            <div key={m.descripcion} className="stack-sm">
              <span>{m.descripcion}</span>
              <span className="biz-signals">
                {m.senales_de_alerta.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {c.que_hacer_si_te_pasa.length ? (
        <div className="biz-group">
          <p className="biz-group-h">Si te pasa</p>
          <ol>
            {c.que_hacer_si_te_pasa.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          <p className="biz-calls">
            <span>105 · peligro ahora</span>
            <span>1818 · denunciar</span>
          </p>
        </div>
      ) : null}
      {c.advertencias.length ? (
        <div className="biz-caveats">
          <p className="strong">Ten en cuenta</p>
          <ul>
            {c.advertencias.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
