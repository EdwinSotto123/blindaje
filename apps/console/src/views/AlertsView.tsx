import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { DISGUISE_FORBIDDEN_WORDS, districtOfZone } from "@blindaje/shared";
import { errorMessage } from "../api/client";
import type { AlertStatus, AlertView } from "../api/types";
import { useApi, useUser } from "../app/context";
import { CiteList, CitationProvider } from "../components/Citations";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, InlineConfirm, Loading, Notice, PageHead, StatusBadge, useFlash } from "../components/ui";
import type { CitationIndex } from "../lib/citations";
import { fmtDateTime, zoneName } from "../lib/format";
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

/**
 * La zona de una alerta: el campo `zona` si la API lo manda (rediseño del 28/10) o la del borrador.
 * Una alerta es de un distrito, nunca de una organización.
 */
export function alertZone(a: AlertView): string {
  return (a as AlertView & { zona?: string | null }).zona ?? a.borrador.zona;
}

/** "las personas que eligieron Comas en la app", o "de esa zona" si no es un distrito de la lista. */
function audience(zona: string): string {
  const d = districtOfZone(zona);
  return d ? `las personas que eligieron ${d.name} en la app` : `las personas de ${zona} en la app`;
}

export function AlertsView() {
  const api = useApi();
  const user = useUser();
  // El filtro vive en la URL (?estado=aprobada).
  const [params, setParams] = useSearchParams();
  const filter: Filter = FILTERS.find((f) => f.id === params.get("estado"))?.id ?? "borrador";
  const setFilter = (f: Filter) => setParams(f === "borrador" ? {} : { estado: f }, { replace: true });
  const alerts = useAsync(() => api.listAlerts(filter === "todas" ? undefined : filter), `alerts:${filter}`);
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
    showFlash(a.status === "aprobada" ? `Alerta aprobada. Ya la ven ${audience(alertZone(a))}.` : "Alerta rechazada. No llega a nadie.");
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
        El Vigía redacta un borrador por modalidad y distrito cuando un patrón aparece en al menos 5 casos de 3 víctimas distintas en 14 días. Alguien del
        equipo lo revisa y lo aprueba antes de que llegue a la app de las personas de ese distrito.
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
          {filter !== "borrador"
            ? null
            : can(user.role, "vigia.run")
              ? "Puedes correr el Vigía a mano para buscar modalidades nuevas."
              : "Aparecerán aquí cuando el Vigía detecte una modalidad nueva en algún distrito. Nada se envía sin la aprobación del equipo."}
        </Empty>
      ) : null}
      <div className="stack">
        {alerts.data?.map((a) => (
          <AlertCard key={a.id} alert={a} canDecide={can(user.role, "alerts.decide")} onDecided={onDecided} />
        ))}
      </div>
    </>
  );
}

function AlertCard({
  alert,
  canDecide,
  onDecided,
}: {
  alert: AlertView;
  canDecide: boolean;
  onDecided: (a: AlertView) => void;
}) {
  const api = useApi();
  const editable = canDecide && alert.status === "borrador";
  const [titulo, setTitulo] = useState(alert.borrador.titulo);
  const [cuerpo, setCuerpo] = useState(alert.borrador.cuerpo);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<"aprobar" | "rechazar" | null>(null);
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
      setAsk(null);
    }
  };

  const tid = `alerta-${alert.id}`;
  const zona = alertZone(alert);
  const district = districtOfZone(zona);
  return (
    <CitationProvider index={index}>
      <article className="panel" aria-labelledby={tid}>
        <div className="panel-head">
          <h2 id={tid}>
            {zoneName(zona)} <StatusBadge status={alert.status} />
          </h2>
          <span className="small muted">
            {district ? `${district.area} · ` : ""}creada {fmtDateTime(alert.created_at)}
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
            {editable && ask === "aprobar" ? (
              <InlineConfirm
                id={`${tid}-aprobar`}
                question={`¿Aprobar y enviar esta alerta a ${zoneName(zona)}?`}
                detail={`La verán ${audience(zona)}, en “Avisos del proveedor”, dentro de sus notas privadas y detrás de su PIN; nunca llega como notificación. Una alerta aprobada no se puede retirar desde la consola.`}
                confirmLabel={edited ? "Sí, aprobar con cambios" : "Sí, aprobar y enviar"}
                busyLabel="Aprobando…"
                busy={busy}
                onConfirm={() => void decide("aprobar")}
                onCancel={() => setAsk(null)}
              />
            ) : editable && ask === "rechazar" ? (
              <InlineConfirm
                id={`${tid}-rechazar`}
                question="¿Rechazar esta alerta?"
                detail="No llegará a nadie. Queda registrada en la auditoría."
                confirmLabel="Sí, rechazar"
                busyLabel="Rechazando…"
                icon="x"
                tone="danger"
                busy={busy}
                onConfirm={() => void decide("rechazar")}
                onCancel={() => setAsk(null)}
              />
            ) : editable ? (
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={!titulo.trim() || !cuerpo.trim()} onClick={() => setAsk("aprobar")}>
                  <Icon name="check" size={16} />
                  {edited ? "Aprobar con cambios" : "Aprobar alerta"}
                </button>
                <button type="button" className="btn btn-danger" onClick={() => setAsk("rechazar")}>
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
            <span className="small muted">
              Así la verán {audience(zona)}, dentro de sus notas privadas y detrás de su PIN. Nunca llega como notificación.
            </span>
          </div>
        </div>
      </article>
    </CitationProvider>
  );
}

/**
 * Cómo verá la víctima la alerta: la pantalla "Avisos del proveedor" de la app
 * (apps/mobile/src/app/privado/avisos.tsx), con su texto de cabecera y la tarjeta. Desde el
 * rediseño, los avisos son de su distrito, no de una organización.
 */
export function AlertPreview({ titulo, cuerpo, queHacer }: { titulo: string; cuerpo: string; queHacer: string[] }) {
  return (
    <div className="phone" role="img" aria-label={`Vista previa: Avisos del proveedor. ${titulo}. ${cuerpo}`}>
      <div className="phone-screen" aria-hidden="true">
        <div className="phone-title">Avisos del proveedor</div>
        <div className="phone-lead">Avisos de tu zona, revisados antes de llegar aquí. Nunca te llegan como notificación.</div>
        <div className="phone-card">
          <strong>{titulo || "Sin título"}</strong>
          <span style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>{cuerpo || "Sin texto"}</span>
          {queHacer.length ? (
            <>
              <strong style={{ fontSize: "0.92rem" }}>Qué hacer</strong>
              <ul style={{ fontSize: "0.92rem" }}>
                {queHacer.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
