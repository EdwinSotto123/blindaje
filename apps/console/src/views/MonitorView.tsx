import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Link } from "react-router";
import type { ConsoleMonitor, MonitorService } from "@blindaje/shared";
import { monitorFor } from "../api/monitor";
import { requestLog, type RequestRecord } from "../api/requestLog";
import { useApi } from "../app/context";
import { Icon, type IconName } from "../components/Icons";
import { ErrorBox, Loading, Meter, PageHead } from "../components/ui";
import { fmtInt, fmtPct, fmtStamp, fmtUsd, ROLE_LABEL } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import "../styles/monitor.css";

/** Cada cuánto se vuelve a leer el panel mientras la pestaña está a la vista. */
export const MONITOR_REFRESH_MS = 30_000;

export const SERVICE_LABEL: Record<MonitorService["servicio"], string> = {
  d1: "Base de datos (D1)",
  chroma: "Base vectorial (Chroma Cloud)",
  ml: "Contenedor ML",
  meta: "API de Meta",
  auditoria: "Auditoría encadenada",
};

/** El estado siempre con ícono y texto: el color nunca va solo. */
export const STATE_CHIP: Record<MonitorService["estado"], { label: string; cls: string; icon: IconName }> = {
  ok: { label: "Responde", cls: "chip chip-mint", icon: "check" },
  lento: { label: "Lento", cls: "chip", icon: "alert" },
  caido: { label: "Sin respuesta", cls: "chip chip-danger", icon: "x" },
  apagado: { label: "Apagado", cls: "chip chip-grid", icon: "pause" },
};

const AGENT_LABEL: Record<string, string> = {
  ficha: "Ficha",
  vinculador: "Vinculador",
  cartografo: "Cartógrafo",
  vigia: "Vigía",
  redactor: "Redactor",
  asesor: "Asesor",
};

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Entró a la consola",
  "auth.logout": "Salió de la consola",
  "link.view": "Abrió un vínculo",
  "link.decision": "Decidió un vínculo",
  "evidence.media": "Escuchó o vio evidencia",
  "alert.decision": "Decidió una alerta",
  "recommendation.decision": "Decidió un consejo",
  "hypothesis.decision": "Decidió una hipótesis",
  "vectors.query": "Consultó el motor vectorial",
  "vectors.sync": "Sincronizó la base vectorial",
  "leak.trace": "Rastreó una filtración",
  "expediente.create": "Generó un expediente",
  "case.create": "Se creó un caso",
  "case.submit": "Se envió un caso",
};

const ACTOR_LABEL: Record<string, string> = { ...ROLE_LABEL, victim: "Víctima", system: "Sistema", business: "Negocio" };

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const fmtMs = (ms: number | null | undefined) => (ms == null ? "—" : `${fmtInt(ms)} ms`);

/** "medido hace 40 s" si la medición es de antes de esta lectura (Meta y Chroma se guardan 30 s). */
export function measuredAgo(medido: string, generado: string): string | null {
  const s = Math.round((Date.parse(generado) - Date.parse(medido)) / 1000);
  if (!Number.isFinite(s) || s < 5) return null;
  return s < 120 ? `medido hace ${s} s` : `medido hace ${Math.round(s / 60)} min`;
}

export function MonitorView() {
  const api = useApi();
  const monitorApi = useMemo(() => monitorFor(api), [api]);
  const mon = useAsync(() => monitorApi.monitor(), "monitoreo");
  const { reload } = mon;

  // Se actualiza solo mientras la pestaña está a la vista; al volver, lee de inmediato.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") reload();
    };
    const id = window.setInterval(tick, MONITOR_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  return (
    <>
      <PageHead
        title="Monitoreo"
        actions={
          <>
            {mon.data ? <span className="small muted">Leído a las {fmtStamp(mon.data.generado_en).slice(-8)}</span> : null}
            <button type="button" className="btn btn-sm" onClick={reload} disabled={mon.loading}>
              <Icon name="refresh" size={15} /> {mon.loading && mon.data ? "Actualizando…" : "Actualizar"}
            </button>
          </>
        }
      >
        Blindaje en vivo: lo que espera al equipo, cada servicio medido ahora y la velocidad de esta consola. Se actualiza cada 30 segundos.
      </PageHead>
      {mon.error ? <ErrorBox error={mon.error} onRetry={reload} /> : null}
      {!mon.data && mon.loading ? <Loading label="Midiendo los servicios…" /> : null}
      {mon.data ? <MonitorBody m={mon.data} /> : null}
    </>
  );
}

export function MonitorBody({ m }: { m: ConsoleMonitor }) {
  return (
    <div className="mon-grid">
      <div className="stack">
        <Queues m={m} />
        <Services m={m} />
        <Speed m={m} />
      </div>
      <div className="stack">
        <Cases m={m} />
        <Budget m={m} />
        <Agents m={m} />
        <Activity m={m} />
      </div>
    </div>
  );
}

function Queues({ m }: { m: ConsoleMonitor }) {
  const rows: Array<{ n: number; one: string; many: string; to: string; action: string }> = [
    { n: m.vinculos.probable + m.vinculos.por_revisar, one: "vínculo por revisar", many: "vínculos por revisar", to: "/vinculos", action: "Abrir la cola" },
    { n: m.pendientes.alertas, one: "alerta por aprobar", many: "alertas por aprobar", to: "/alertas", action: "Ver alertas" },
    { n: m.pendientes.recomendaciones, one: "consejo por aprobar", many: "consejos por aprobar", to: "/recomendaciones", action: "Ver consejos" },
    { n: m.pendientes.hipotesis, one: "hipótesis por decidir", many: "hipótesis por decidir", to: "/redes", action: "Ver redes" },
  ];
  const total = rows.reduce((s, r) => s + r.n, 0);
  return (
    <section className="panel" aria-labelledby="mon-colas">
      <div className="panel-head">
        <h2 id="mon-colas">
          <Icon name="check" /> Para el equipo
        </h2>
        <span className="small muted">{total ? `${fmtInt(total)} pendientes` : "Nada pendiente"}</span>
      </div>
      <ul className="list-plain mon-queues">
        {rows.map((r) => (
          <li key={r.to} className={r.n ? "" : "is-empty"}>
            <span className="mon-queue-n">{fmtInt(r.n)}</span>
            <span className="mon-queue-label">{r.n === 1 ? r.one : r.many}</span>
            {r.n ? (
              <Link to={r.to} className="btn btn-sm">
                {r.action} <Icon name="arrowRight" size={15} />
              </Link>
            ) : (
              <span className="small muted">Al día</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Services({ m }: { m: ConsoleMonitor }) {
  const down = m.servicios.filter((s) => s.estado === "caido").length;
  return (
    <section className="panel" aria-labelledby="mon-servicios">
      <div className="panel-head">
        <h2 id="mon-servicios">
          <Icon name="pulse" /> Servicios
        </h2>
        <span className="small muted">{down ? `${down} sin respuesta` : "Meta y Chroma se miden cada 30 s"}</span>
      </div>
      <div className="table-wrap">
        <table className="table mon-services">
          <thead>
            <tr>
              <th scope="col">Servicio</th>
              <th scope="col">Estado</th>
              <th scope="col" className="num">
                Respuesta
              </th>
            </tr>
          </thead>
          <tbody>
            {m.servicios.map((s) => {
              const chip = STATE_CHIP[s.estado];
              return (
                <tr key={s.servicio}>
                  <th scope="row">
                    <span className="strong">{SERVICE_LABEL[s.servicio]}</span>
                    <span className="small muted mon-detail">{s.detalle}</span>
                  </th>
                  <td>
                    <span className={chip.cls}>
                      <Icon name={chip.icon} size={14} /> {chip.label}
                    </span>
                  </td>
                  <td className="num">
                    {fmtMs(s.latencia_ms)}
                    {measuredAgo(s.medido_en, m.generado_en) ? <span className="small muted mon-detail">{measuredAgo(s.medido_en, m.generado_en)}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted mon-foot">
        API {m.api.version} · {m.api.entorno}
        {m.api.colo ? ` · entró por ${m.api.colo}` : ""}
        {m.api.ubicacion ? ` · corre en ${m.api.ubicacion}, junto a la base` : ""} · esta lectura tardó {fmtMs(m.api.ms)} en el servidor.
      </p>
    </section>
  );
}

function Speed({ m }: { m: ConsoleMonitor }) {
  const entries = useSyncExternalStore(requestLog.subscribe, requestLog.entries, requestLog.entries);
  const shown = entries.slice(0, 12);
  const total = median(entries.map((e) => e.ms));
  const server = median(entries.flatMap((e) => (e.servidor_ms == null ? [] : [e.servidor_ms])));
  return (
    <section className="panel" aria-labelledby="mon-velocidad">
      <div className="panel-head">
        <h2 id="mon-velocidad">
          <Icon name="play" /> Velocidad de esta consola
        </h2>
        {total != null ? (
          <span className="small muted">
            Mediana de {fmtInt(entries.length)}: {fmtMs(total)} en total, {fmtMs(server)} en el servidor
          </span>
        ) : null}
      </div>
      {!entries.length ? (
        <p className="muted">
          {m.api.version === "simulado"
            ? "En modo simulado la consola no habla con la API: no hay tiempos que medir."
            : "Todavía no hay peticiones en esta pestaña."}
        </p>
      ) : (
        <>
          <p className="small muted mon-explain">
            Total es lo que esperaste desde tu navegador; servidor, lo que trabajó la API; la diferencia es el viaje por la red hasta Cloudflare.
          </p>
          <div className="table-wrap">
            <table className="table mon-speed">
              <thead>
                <tr>
                  <th scope="col">Petición</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                  <th scope="col" className="num">
                    Servidor
                  </th>
                  <th scope="col" className="num">
                    Base de datos
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <SpeedRow key={`${e.at}-${e.ruta}-${e.method}`} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function SpeedRow({ e }: { e: RequestRecord }) {
  return (
    <tr>
      <th scope="row">
        <span className="mono small">
          {e.method} {e.ruta.replace(/^\/v1/, "")}
        </span>
        {e.status >= 400 ? <span className="chip chip-danger mon-status">{e.status}</span> : null}
      </th>
      <td className="num">{fmtMs(e.ms)}</td>
      <td className="num">{fmtMs(e.servidor_ms)}</td>
      <td className="num">{e.db_n == null ? "—" : `${fmtInt(e.db_n)} · ${fmtMs(e.db_ms)}`}</td>
    </tr>
  );
}

function Cases({ m }: { m: ConsoleMonitor }) {
  const c = m.casos;
  const v = m.vinculos;
  return (
    <section className="panel" aria-labelledby="mon-casos">
      <div className="panel-head">
        <h2 id="mon-casos">
          <Icon name="file" /> Casos {m.mundo === "demo" ? <span className="chip chip-pink">Ficticios</span> : null}
        </h2>
      </div>
      <dl className="dl mon-dl">
        <dt>En total</dt>
        <dd>{fmtInt(c.total)}</dd>
        <dt>Nuevos</dt>
        <dd>
          {fmtInt(c.nuevos_24h)} en 24 h · {fmtInt(c.nuevos_7d)} en 7 días
        </dd>
        <dt>En los índices</dt>
        <dd>{fmtInt(c.indexados)} con consentimiento comunitario</dd>
        <dt>Procesando</dt>
        <dd>{fmtInt(c.procesando)}</dd>
        <dt>Con error</dt>
        <dd className={c.con_error ? "mon-bad" : ""}>{fmtInt(c.con_error)}</dd>
        <dt>Vínculos</dt>
        <dd>
          {fmtInt(v.confirmado)} confirmados · {fmtInt(v.probable + v.por_revisar)} por revisar · {fmtInt(v.descartado)} descartados
        </dd>
        <dt>Redes</dt>
        <dd>{fmtInt(m.redes)}</dd>
      </dl>
    </section>
  );
}

function Budget({ m }: { m: ConsoleMonitor }) {
  const p = m.presupuesto;
  return (
    <section className="panel" aria-labelledby="mon-presupuesto">
      <div className="panel-head">
        <h2 id="mon-presupuesto">
          <Icon name="coins" /> Presupuesto de Meta
        </h2>
        <Link to="/costos" className="small">
          Ver costos
        </Link>
      </div>
      <Meter value={p.pct} label={`Presupuesto usado: ${fmtPct(p.pct * 100, 1)}`} ticks={[0.8]} />
      <p className="small mon-budget">
        <span className="strong">{fmtUsd(p.gastado_usd)}</span> de {fmtUsd(p.presupuesto_usd, 0)} ({fmtPct(p.pct * 100, 1)}) · hoy {fmtUsd(p.hoy_usd)}
      </p>
    </section>
  );
}

function Agents({ m }: { m: ConsoleMonitor }) {
  return (
    <section className="panel" aria-labelledby="mon-agentes">
      <div className="panel-head">
        <h2 id="mon-agentes">
          <Icon name="message" /> Agentes
        </h2>
        <span className="small muted">Últimos 7 días</span>
      </div>
      {!m.agentes.length ? (
        <p className="muted">Ningún agente corrió todavía.</p>
      ) : (
        <ul className="list-plain mon-agents">
          {m.agentes.map((a) => (
            <li key={a.agente}>
              <span className="strong">{AGENT_LABEL[a.agente] ?? a.agente}</span>
              <span className="small muted">{a.ultima ? `última ${fmtStamp(a.ultima)}` : "sin ejecuciones"}</span>
              <span className="small">
                {fmtInt(a.ok_7d)} bien
                {a.error_7d ? <span className="mon-bad"> · {fmtInt(a.error_7d)} con error</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Activity({ m }: { m: ConsoleMonitor }) {
  return (
    <section className="panel" aria-labelledby="mon-actividad">
      <div className="panel-head">
        <h2 id="mon-actividad">
          <Icon name="chain" /> Actividad reciente
        </h2>
        <Link to="/auditoria" className="small">
          Ver auditoría
        </Link>
      </div>
      {!m.actividad.length ? (
        <p className="muted">Sin actividad registrada.</p>
      ) : (
        <ol className="list-plain mon-activity">
          {m.actividad.map((a) => (
            <li key={a.seq}>
              <span className="small muted mono">{fmtStamp(a.ts)}</span>
              <span>{actionLabel(a.accion)}</span>
              <span className="small muted">{ACTOR_LABEL[a.actor_tipo] ?? a.actor_tipo}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
