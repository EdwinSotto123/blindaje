import type { BusinessRecommendationView } from "@blindaje/shared";
import { useApi, useMe } from "../app/context";
import { CallButtons } from "../components/CallButtons";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, Loading, PageHead } from "../components/ui";
import { fmtDate } from "../lib/format";
import { byPriority, NIVEL_LABEL, PRIORIDAD_LABEL, PRIORIDAD_TITULO } from "../lib/risk";
import { useAsync } from "../lib/useAsync";

export function RecommendationsView() {
  const api = useApi();
  const me = useMe();
  const recs = useAsync(() => api.recommendations(), `recs:${me.id}`);
  const sorted = [...(recs.data ?? [])].sort((a, b) => b.approved_at.localeCompare(a.approved_at));
  const [latest, ...older] = sorted;

  return (
    <>
      <PageHead title="Recomendaciones" margin="Tu gremio">
        <p>
          Lo que {me.org.name} te recomienda para tu zona y tu sector. Las escribe un asistente de Blindaje con datos agregados, y una persona de tu
          gremio las revisa antes de que lleguen aquí.
        </p>
      </PageHead>
      {recs.error ? <ErrorBox error={recs.error} onRetry={recs.reload} /> : null}
      {recs.loading && !recs.data ? <Loading label="Cargando las recomendaciones…" /> : null}
      {recs.data && !latest ? (
        <Empty title="Tu gremio todavía no ha aprobado recomendaciones">
          Cuando apruebe una para tu zona y tu sector, la verás aquí. Mientras tanto, revisa qué hacer si te pasa.
        </Empty>
      ) : null}
      {latest ? <RecommendationSheet rec={latest} /> : null}
      {older.length ? (
        <details className="older">
          <summary>
            Recomendaciones anteriores ({older.length})
          </summary>
          <div className="stack">
            {older.map((r) => (
              <RecommendationSheet key={r.id} rec={r} compact />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

/** Una recomendación aprobada, con lo urgente primero. */
export function RecommendationSheet({ rec, compact = false }: { rec: BusinessRecommendationView; compact?: boolean }) {
  const groups = byPriority(rec.recomendaciones);
  const tid = `rec-${rec.id}`;
  // Numeración continua entre grupos: el orden de la lista es el orden en que conviene hacerlo.
  const starts = groups.map((_, gi) => 1 + groups.slice(0, gi).reduce((sum, g) => sum + g.items.length, 0));
  return (
    <article className="rec" aria-labelledby={tid}>
      <header className="rec-head">
        <h2 id={tid}>
          Para {rec.sector} de {rec.zona}
        </h2>
        <p className="pencil">
          Aprobada por tu gremio el {fmtDate(rec.approved_at)}
          {rec.nivel_riesgo !== "sin_datos" ? ` · Riesgo ${NIVEL_LABEL[rec.nivel_riesgo]}` : ""}
        </p>
      </header>
      <p className="body-l measure">{rec.resumen}</p>

      {groups.map((g, gi) => {
        return (
          <div key={g.prioridad} className="rec-group">
            <h3 id={`${tid}-${g.prioridad}`}>
              {PRIORIDAD_TITULO[g.prioridad]} <span className={`tag tag-${g.prioridad}`}>{PRIORIDAD_LABEL[g.prioridad]}</span>
            </h3>
            <ol className="todo" start={starts[gi]}>
              {g.items.map((i) => (
                <li key={i.titulo}>
                  <p className="strong">{i.titulo}</p>
                  <p>{i.detalle}</p>
                </li>
              ))}
            </ol>
          </div>
        );
      })}

      {rec.modalidades.length ? (
        <div className="rec-group">
          <h3 id={`${tid}-mod`}>Cómo reconocerla</h3>
          <ul className="plain stack-sm">
            {rec.modalidades.map((m) => (
              <li key={m.descripcion} className="stack-xs">
                <p>{m.descripcion}</p>
                {m.senales_de_alerta.length ? (
                  <ul className="signals" aria-label="Señales de alerta">
                    {m.senales_de_alerta.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rec.que_hacer_si_te_pasa.length ? (
        <div className="rec-group">
          <h3 id={`${tid}-pasa`}>Si te pasa</h3>
          <ol className="steps-plain">
            {rec.que_hacer_si_te_pasa.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          {compact ? null : <CallButtons />}
        </div>
      ) : null}

      {rec.advertencias.length ? (
        <div className="caveats">
          <h3 id={`${tid}-adv`}>
            <Icon name="eye" size={18} />
            Ten en cuenta
          </h3>
          <ul>
            {rec.advertencias.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
