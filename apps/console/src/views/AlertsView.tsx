import { useMemo, useState } from "react";
import { DISGUISE_FORBIDDEN_WORDS, LINEA_DENUNCIAS, LINEA_EMERGENCIAS } from "@blindaje/shared";
import { errorMessage } from "../api/client";
import type { AlertStatus, AlertView } from "../api/types";
import { useApi, useUser } from "../app/context";
import { CiteList, CitationProvider } from "../components/Citations";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, Loading, Notice, PageHead, StatusBadge, useFlash } from "../components/ui";
import type { CitationIndex } from "../lib/citations";
import { fmtDateTime } from "../lib/format";
import { can } from "../lib/permissions";
import { useAsync } from "../lib/useAsync";

type Filter = AlertStatus | "todas";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "borrador", label: "Borradores" },
  { id: "aprobada", label: "Aprobadas" },
  { id: "rechazada", label: "Rechazadas" },
  { id: "todas", label: "Todas" },
];

/** Palabras que delatan el propósito de la app si alguien revisa el celular de la persona. */
export function revealingWords(text: string): string[] {
  const t = text.toLowerCase();
  return DISGUISE_FORBIDDEN_WORDS.filter((w) => t.includes(w));
}

/** Números de 7 o más dígitos seguidos: una alerta nunca lleva números ni cuentas completas. */
export function looksLikeFullNumber(text: string): boolean {
  return /\d[\d\s-]{6,}\d/.test(text.replace(/S\/\s?[\d,.]+/g, ""));
}

export function AlertsView() {
  const api = useApi();
  const user = useUser();
  const [filter, setFilter] = useState<Filter>("borrador");
  const alerts = useAsync(() => api.listAlerts(filter === "todas" ? undefined : filter), `alerts:${filter}`);
  const orgs = useAsync(() => (can(user.role, "admin.orgs") ? api.listOrgs() : Promise.resolve([])), "orgs:alerts");
  const orgName = useMemo(() => {
    const m = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));
    m.set(user.org.id, user.org.name);
    return (id: string) => m.get(id) ?? id;
  }, [orgs.data, user.org]);
  const [running, setRunning] = useState(false);
  const [flash, showFlash] = useFlash();

  const runVigia = async () => {
    setRunning(true);
    try {
      const created = await api.runVigia();
      showFlash(
        created.length
          ? `El Vigía redactó ${created.length} ${created.length === 1 ? "borrador" : "borradores"} de alerta.`
          : "El Vigía no encontró modalidades nuevas que cumplan el umbral.",
        created.length ? "success-box" : "notice",
      );
      if (filter === "borrador" || filter === "todas") alerts.reload();
      else setFilter("borrador");
    } catch (e) {
      showFlash(errorMessage(e), "error-box");
    } finally {
      setRunning(false);
    }
  };

  const onDecided = (a: AlertView) => {
    showFlash(a.status === "aprobada" ? "Alerta aprobada. Ya aparece en los Avisos del proveedor de la organización." : "Alerta rechazada.");
    alerts.setData((prev) => (prev ?? []).map((x) => (x.id === a.id ? a : x)).filter((x) => filter === "todas" || x.status === filter));
  };

  return (
    <>
      <PageHead
        title="Alertas comunitarias"
        actions={
          can(user.role, "vigia.run") ? (
            <button type="button" className="btn btn-primary" disabled={running} onClick={() => void runVigia()}>
              <Icon name="eye" size={16} />
              {running ? "El Vigía está revisando…" : "Correr el Vigía ahora"}
            </button>
          ) : null
        }
      >
        El Vigía redacta borradores cuando un patrón aparece en al menos 5 casos de 3 víctimas distintas en una zona en 14 días. Cada organización aprueba
        las suyas antes de enviarlas.
      </PageHead>
      {flash}
      <div className="segmented" role="group" aria-label="Filtrar alertas">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {alerts.error ? <ErrorBox error={alerts.error} onRetry={alerts.reload} /> : null}
      {alerts.loading && !alerts.data ? <Loading /> : null}
      {alerts.data && alerts.data.length === 0 ? (
        <Empty title={filter === "borrador" ? "No hay borradores pendientes" : "No hay alertas en este estado"}>
          {filter === "borrador" && can(user.role, "vigia.run") ? "Puedes correr el Vigía a mano para buscar modalidades nuevas." : null}
        </Empty>
      ) : null}
      <div className="stack">
        {alerts.data?.map((a) => (
          <AlertCard key={a.id} alert={a} orgName={orgName(a.org_id)} canDecide={can(user.role, "alerts.decide")} onDecided={onDecided} />
        ))}
      </div>
    </>
  );
}

function AlertCard({
  alert,
  orgName,
  canDecide,
  onDecided,
}: {
  alert: AlertView;
  orgName: string;
  canDecide: boolean;
  onDecided: (a: AlertView) => void;
}) {
  const api = useApi();
  const editable = canDecide && alert.status === "borrador";
  const [titulo, setTitulo] = useState(alert.borrador.titulo);
  const [cuerpo, setCuerpo] = useState(alert.borrador.cuerpo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index: CitationIndex = useMemo(() => {
    const m: CitationIndex = new Map();
    for (const r of alert.borrador.evidencia) {
      if (r.startsWith("R-")) m.set(r, { kind: "red", ref: r, networkId: alert.network_id });
    }
    return m;
  }, [alert]);

  const titleWords = revealingWords(titulo);
  const fullNumber = looksLikeFullNumber(`${titulo} ${cuerpo}`);
  const edited = titulo !== alert.borrador.titulo || cuerpo !== alert.borrador.cuerpo;

  const decide = async (decision: "aprobar" | "rechazar") => {
    setBusy(true);
    setError(null);
    try {
      const req = decision === "aprobar" && edited ? { decision, titulo: titulo.trim(), cuerpo: cuerpo.trim() } : { decision };
      onDecided(await api.decideAlert(alert.id, req));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const tid = `alerta-${alert.id}`;
  return (
    <CitationProvider index={index}>
      <article className="panel" aria-labelledby={tid}>
        <div className="panel-head">
          <h2 id={tid}>
            {alert.borrador.zona} <StatusBadge status={alert.status} />
          </h2>
          <span className="small muted">
            {orgName} · creada {fmtDateTime(alert.created_at)}
            {alert.approved_at ? ` · ${alert.status === "aprobada" ? "aprobada" : "revisada"} por ${alert.approved_by ?? "—"} el ${fmtDateTime(alert.approved_at)}` : ""}
          </span>
        </div>
        <div className="grid-2">
          <div className="stack-sm">
            <dl className="dl">
              <dt>Modalidad</dt>
              <dd>{alert.borrador.modalidad}</dd>
              <dt>Basada en</dt>
              <dd>
                <CiteList refs={alert.borrador.evidencia} />
              </dd>
            </dl>
            <div className="field">
              <label htmlFor={`${tid}-t`}>Título</label>
              <input id={`${tid}-t`} type="text" value={titulo} readOnly={!editable} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${tid}-c`}>Texto</label>
              <textarea id={`${tid}-c`} rows={6} value={cuerpo} readOnly={!editable} onChange={(e) => setCuerpo(e.target.value)} />
              {editable ? <span className="hint">Puedes editar el texto antes de aprobar. Sin datos de víctimas, números completos ni ubicaciones exactas.</span> : null}
            </div>
            {titleWords.length ? (
              <Notice kind="warn">
                El título incluye {titleWords.map((w) => `“${w}”`).join(", ")}. En el celular de la persona, la app parece una app común: usa un título neutro.
              </Notice>
            ) : null}
            {fullNumber ? <Notice kind="warn">El texto parece incluir un número o una cuenta completa. Las alertas nunca los llevan.</Notice> : null}
            {editable ? (
              <div className="row">
                <button type="button" className="btn btn-ok" disabled={busy || !titulo.trim() || !cuerpo.trim()} onClick={() => void decide("aprobar")}>
                  <Icon name="check" size={16} />
                  {edited ? "Aprobar con cambios" : "Aprobar alerta"}
                </button>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void decide("rechazar")}>
                  <Icon name="x" size={16} />
                  Rechazar
                </button>
              </div>
            ) : null}
            {error ? <Notice kind="error-box">{error}</Notice> : null}
          </div>
          <div className="stack-sm">
            <span className="small strong">Vista previa en la app de la persona</span>
            <AlertPreview titulo={titulo} cuerpo={cuerpo} queHacer={alert.borrador.que_hacer} />
          </div>
        </div>
      </article>
    </CitationProvider>
  );
}

/** Cómo verá la víctima la alerta: dentro del cuaderno, como "Avisos del proveedor". */
export function AlertPreview({ titulo, cuerpo, queHacer }: { titulo: string; cuerpo: string; queHacer: string[] }) {
  return (
    <div className="phone" role="img" aria-label={`Vista previa: Avisos del proveedor. ${titulo}. ${cuerpo}`}>
      <div className="phone-screen" aria-hidden="true">
        <div className="phone-title">Avisos del proveedor</div>
        <div className="phone-card">
          <strong>{titulo || "Sin título"}</strong>
          <span style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>{cuerpo || "Sin texto"}</span>
          {queHacer.length ? (
            <ul style={{ fontSize: "0.92rem" }}>
              {queHacer.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="phone-help">
          Si estás en peligro ahora, llama al {LINEA_EMERGENCIAS}. Denuncias: Línea {LINEA_DENUNCIAS}.
        </div>
      </div>
    </div>
  );
}
