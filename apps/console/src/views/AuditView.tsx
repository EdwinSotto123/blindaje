import { useState } from "react";
import { errorMessage } from "../api/client";
import type { AuditEntry, AuditVerifyResponse } from "../api/types";
import { useApi } from "../app/context";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, Loading, Notice, PageHead } from "../components/ui";
import { ROLE_LABEL, fmtInt, fmtStamp, shortHash } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { brokenLinks } from "../mock/audit";
import { MockApi } from "../mock/mockApi";

const PAGE = 50;

/** Nombres de acción que registra la API (services/api) y su lectura en español. */
const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Inicio de sesión",
  "auth.logout": "Cierre de sesión",
  "auth.refresh_reuse_detected": "Reuso de refresh token detectado",
  "device.register": "Celular registrado",
  "voice_sample.enroll": "Muestra de voz de la víctima",
  "case.create": "Caso creado",
  "case.submit": "Caso enviado a procesar",
  "case.consent": "Cambio de consentimiento",
  "case.delete": "Caso borrado",
  "case.report_pdf": "Denuncia descargada",
  "case.view": "Caso consultado",
  "evidence.upload": "Subida de evidencia",
  "evidence.media": "Acceso a un medio",
  "workflow.start": "Procesamiento iniciado",
  "workflow.complete": "Procesamiento terminado",
  "workflow.error": "Error de procesamiento",
  "link.propose": "Vínculo propuesto",
  "link.view": "Vínculo consultado",
  "link.decision": "Decisión sobre un vínculo",
  "network.view": "Red consultada",
  "network.recompute": "Redes recalculadas",
  "agent.cartografo.run": "Cartógrafo ejecutado",
  "cartografo.invalid_citations": "Citas inválidas del Cartógrafo",
  "hypothesis.decision": "Decisión sobre una hipótesis",
  "agent.vigia.run": "Vigía ejecutado",
  "alert.decision": "Decisión sobre una alerta",
  "agent.redactor.run": "Expediente solicitado",
  "expediente.ready": "Expediente listo",
  "expediente.download": "Expediente descargado",
  "org.create": "Organización creada",
  "invites.create": "Invitaciones generadas",
  "user.create": "Usuario creado",
  "demo.seed": "Datos de demo sembrados",
  "demo.reset": "Datos de demo borrados",
};

export function AuditView() {
  const api = useApi();
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [exhausted, setExhausted] = useState(false);
  const first = useAsync(() => api.listAudit({ limit: PAGE }), "audit");
  const [verify, setVerify] = useState<AuditVerifyResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [tampered, setTampered] = useState<number | null>(null);

  const entries = [...(first.data ?? []), ...older];
  const localBreaks = brokenLinks(entries);
  const minSeq = entries.length ? Math.min(...entries.map((e) => e.seq)) : null;

  const loadMore = async () => {
    if (minSeq == null) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.listAudit({ before_seq: minSeq, limit: PAGE });
      setOlder((prev) => [...prev, ...page]);
      if (page.length < PAGE) setExhausted(true);
    } catch (e) {
      setMoreError(e);
    } finally {
      setLoadingMore(false);
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      setVerify(await api.verifyAudit());
    } catch (e) {
      setVerifyError(errorMessage(e));
    } finally {
      setVerifying(false);
    }
  };

  const mock = api instanceof MockApi ? api : null;

  /** Lleva la vista y el foco a una fila de la tabla (si está cargada). */
  const goToRow = (seq: number) => {
    const row = document.getElementById(`audit-${seq}`);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.focus({ preventScroll: true });
  };

  return (
    <>
      <PageHead
        title="Auditoría encadenada"
        actions={
          <>
            {mock ? (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => {
                  void mock.tamperAudit().then((seq) => {
                    setTampered(seq);
                    setVerify(null);
                    setOlder([]);
                    setExhausted(false);
                    first.reload();
                  });
                }}
              >
                Simular una alteración
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" disabled={verifying} onClick={() => void runVerify()}>
              <Icon name="shield" size={16} />
              {verifying ? "Verificando…" : "Verificar cadena"}
            </button>
          </>
        }
      >
        Cada acción (subidas, accesos a medios, decisiones, exportaciones) guarda el hash de la entrada anterior. Si alguien cambia una fila, la cadena se rompe
        desde ahí.
      </PageHead>

      <div aria-live="polite" className="stack-sm">
        {tampered != null && !verify ? (
          <Notice kind="warn">Modo simulado: se alteró la entrada #{tampered} sin recalcular su hash. Verifica la cadena para ver cómo se detecta.</Notice>
        ) : null}
        {verify ? (
          verify.ok ? (
            <Notice kind="success-box">
              <strong>Cadena íntegra.</strong> {fmtInt(verify.checked)} entradas verificadas. Hash de la última entrada:{" "}
              <code title={verify.head_hash ?? ""}>{shortHash(verify.head_hash, 12, 6)}</code>
            </Notice>
          ) : (
            <Notice kind="error-box">
              <div className="stack-sm">
                <span>
                  <strong>La cadena está rota en la entrada #{verify.broken_at_seq ?? "?"}.</strong> Su contenido no coincide con su hash o con el de la entrada
                  anterior, así que desde ahí las entradas no se pueden dar por verificadas.
                </span>
                <span>Avisa a la administración de la alianza con el número de la entrada. No la corrijas a mano: la fila alterada es la evidencia.</span>
                {verify.broken_at_seq != null ? (
                  <span>
                    <button type="button" className="btn btn-sm" onClick={() => goToRow(verify.broken_at_seq!)}>
                      Ir a la entrada #{verify.broken_at_seq}
                    </button>
                  </span>
                ) : null}
              </div>
            </Notice>
          )
        ) : null}
        {verifyError ? <Notice kind="error-box">{verifyError}</Notice> : null}
        {localBreaks.length ? (
          <Notice kind="warn">En las filas cargadas, el hash anterior no coincide en: {localBreaks.map((s) => `#${s}`).join(", ")}.</Notice>
        ) : null}
      </div>

      {first.error ? <ErrorBox error={first.error} onRetry={first.reload} /> : null}
      {first.loading && !first.data ? <Loading /> : null}
      {first.data && entries.length === 0 ? <Empty title="No hay entradas" /> : null}
      {entries.length ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Registro de auditoría (se desplaza a los lados)">
          <table className="table">
            <caption className="sr-only">Registro de auditoría, de la entrada más reciente a la más antigua</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  Seq
                </th>
                <th scope="col">Hora (Lima)</th>
                <th scope="col">Actor</th>
                <th scope="col">Acción</th>
                <th scope="col">Objetivo</th>
                <th scope="col">Hash anterior</th>
                <th scope="col">Hash</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const broken = verify?.broken_at_seq === e.seq || localBreaks.includes(e.seq);
                return (
                  <tr key={e.seq} id={`audit-${e.seq}`} tabIndex={broken ? -1 : undefined} className={broken ? "row-broken" : undefined}>
                    <td className="num">{e.seq}</td>
                    <td className="nowrap">{fmtStamp(e.ts)}</td>
                    <td>
                      <span className="strong">{ROLE_LABEL[e.actor_type] ?? e.actor_type}</span>
                      <br />
                      <span className="small muted mono">{e.actor_id}</span>
                    </td>
                    <td>
                      {ACTION_LABEL[e.action] ?? e.action}
                      <br />
                      <code className="small muted">{e.action}</code>
                    </td>
                    <td className="small">{e.target_type ? `${e.target_type}${e.target_id ? `: ${e.target_id}` : ""}` : "—"}</td>
                    <td>
                      <code className="small muted" title={e.prev_hash}>
                        {shortHash(e.prev_hash)}
                      </code>
                    </td>
                    <td>
                      <code className="small" title={e.hash}>
                        {shortHash(e.hash)}
                      </code>
                      {broken ? <span className="sr-only"> (cadena rota aquí)</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {moreError ? <ErrorBox error={moreError} onRetry={() => void loadMore()} /> : null}
      {entries.length && !exhausted && (first.data?.length ?? 0) >= PAGE ? (
        <span>
          <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Cargando…" : "Cargar entradas anteriores"}
          </button>
        </span>
      ) : null}
    </>
  );
}
