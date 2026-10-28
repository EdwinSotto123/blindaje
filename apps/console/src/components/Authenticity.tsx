import { useId } from "react";
import type { NivelAutenticidad, ResultadoAutenticidad } from "../api/types";
import { FUENTE_LABEL, NIVEL_META, NOTA_AUSENCIA, sourceLines } from "../lib/authenticity";
import { fmtDateTime } from "../lib/format";
import { Icon } from "./Icons";

/** Indicador corto del nivel (en la tarjeta del caso y en las listas). */
export function AuthenticityBadge({ nivel, compact = false }: { nivel: NivelAutenticidad | null | undefined; compact?: boolean }) {
  if (nivel === undefined) return null;
  if (nivel === null) {
    return <span className={`chip chip-auth${compact ? " chip-auth-sm" : ""}`} data-tone="none">Sin analizar</span>;
  }
  const meta = NIVEL_META[nivel];
  const strong = meta.tone === "fuerte" || meta.tone === "confirmado";
  return (
    <span className={`chip chip-auth${compact ? " chip-auth-sm" : ""}`} data-tone={meta.tone}>
      {strong ? <Icon name="alert" size={compact ? 12 : 13} /> : null}
      {meta.label}
    </span>
  );
}

/**
 * Detalle del análisis de autenticidad de una evidencia: nivel, señales por fuente, explicación,
 * limitaciones y siempre la nota de que la ausencia de marca de agua no prueba nada.
 */
export function AuthenticityPanel({ result, tipo }: { result: ResultadoAutenticidad | null; tipo: string }) {
  const titleId = useId();
  const tone = result ? NIVEL_META[result.nivel].tone : "none";
  return (
    <section className="auth-panel stack-sm" data-tone={tone} aria-labelledby={titleId}>
      <div className="row" style={{ gap: 8 }}>
        <h3 id={titleId} className="auth-title">
          <Icon name="shield" size={16} /> ¿Hecho con IA o manipulado?
        </h3>
        <AuthenticityBadge nivel={result?.nivel ?? null} />
      </div>
      {!result ? (
        <p className="small">
          {tipo === "texto" ? "Los mensajes de texto no se analizan." : "Todavía no se analizó, o el análisis no estuvo disponible cuando llegó la evidencia."}
        </p>
      ) : (
        <>
          <p>{NIVEL_META[result.nivel].sentence}</p>
          {result.tipo === "audio" && (result.nivel === "indicios_fuertes" || result.nivel === "generado_ia_confirmado") ? (
            <p className="small">
              <strong>Al vincular, la voz de este audio pesa la mitad:</strong> una voz sintética podría imitar a otra.
            </p>
          ) : null}
          <div className="stack-sm" style={{ gap: 4 }}>
            <span className="small muted">Señales por fuente</span>
            <ul className="list-plain auth-sources">
              {sourceLines(result).map((s) => (
                <li key={s.fuente} data-alerta={s.alerta ? "si" : undefined}>
                  <span className="auth-source">{s.fuente}</span>
                  <span>
                    {s.alerta ? <span className="sr-only">Alerta: </span> : null}
                    {s.estado}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {result.forense?.senales.length ? (
            <div className="stack-sm" style={{ gap: 4 }}>
              <span className="small muted">Lo que observó el análisis</span>
              <ul className="list-plain list-lines">
                {result.forense.senales.map((s, i) => (
                  <li key={i}>
                    <span className="chip chip-grid chip-auth-sm">
                      {FUENTE_LABEL[s.fuente] ?? s.fuente} · {s.peso === "fuerte" ? "fuerte" : "débil"}
                    </span>{" "}
                    {s.descripcion}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.forense ? (
            <>
              <p>{result.forense.explicacion}</p>
              <p className="small">
                <strong>Limitaciones:</strong> {result.forense.limitaciones}
              </p>
            </>
          ) : null}
          <details className="tech">
            <summary>Detalle técnico</summary>
            <TechDetail result={result} />
          </details>
        </>
      )}
      <p className="auth-note">
        <Icon name="info" size={14} /> {NOTA_AUSENCIA} La mayoría de generadores no la ponen.
      </p>
    </section>
  );
}

function TechDetail({ result }: { result: ResultadoAutenticidad }) {
  const t = result.tecnicas;
  const fields = Object.entries(t.metadata?.fields ?? {});
  return (
    <dl className="dl small">
      {t.watermark ? (
        <>
          <dt>Marca de agua</dt>
          <dd>
            {t.watermark.detector}: puntaje {t.watermark.score.toFixed(3)}
            {t.watermark.frames_checked != null ? `, ${t.watermark.frames_checked} cuadros` : ""}
          </dd>
        </>
      ) : null}
      {t.c2pa?.claims.length ? (
        <>
          <dt>Afirmaciones C2PA</dt>
          <dd>{t.c2pa.claims.join("; ")}</dd>
        </>
      ) : null}
      {t.metadata?.digital_source_type ? (
        <>
          <dt>Tipo de fuente digital</dt>
          <dd>{t.metadata.digital_source_type}</dd>
        </>
      ) : null}
      {fields.length ? (
        <>
          <dt>Metadatos</dt>
          <dd>{fields.map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd>
        </>
      ) : null}
      <dt>Modelo</dt>
      <dd>{result.model ?? "—"}</dd>
      <dt>Analizado</dt>
      <dd>{fmtDateTime(result.analizado_at)}</dd>
    </dl>
  );
}
