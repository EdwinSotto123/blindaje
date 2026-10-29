import { districtOfZone, type BusinessRecommendationView, type District } from "@blindaje/shared";
import { Link } from "react-router";
import { useApi } from "../app/context";
import { CallButtons } from "../components/CallButtons";
import { ChooseZone } from "../components/ChooseZone";
import { Icon } from "../components/Icons";
import { Empty, ErrorBox, Loading, PageHead } from "../components/ui";
import { choiceSearch, useChoice, type Rubro } from "../lib/choice";
import { fmtDate, sectorLabel } from "../lib/format";
import { byPriority, NIVEL_LABEL, PRIORIDAD_LABEL, PRIORIDAD_TITULO } from "../lib/risk";
import { useAsync } from "../lib/useAsync";

export function RecommendationsView() {
  const { distrito, rubro } = useChoice();
  return (
    <>
      <PageHead title="Consejos para tu zona">
        <p>
          Qué hacer para prevenir en {distrito ? distrito.name : "tu distrito"}
          {rubro ? `, para ${sectorLabel(rubro)}` : ""}. Los escribe un asistente de Blindaje con datos agregados, y el equipo de Blindaje los revisa y
          aprueba antes de publicarlos aquí.
        </p>
      </PageHead>
      {distrito ? <Recommendations distrito={distrito} rubro={rubro} /> : <ChooseZone what="consejos" rubro={rubro} />}
    </>
  );
}

function Recommendations({ distrito, rubro }: { distrito: District; rubro: Rubro | null }) {
  const api = useApi();
  const recs = useAsync(() => api.recommendations({ zona: distrito.id, sector: rubro }), `recs:${distrito.id}:${rubro ?? ""}`);
  const [latest, ...older] = recs.data ?? [];
  const search = choiceSearch({ distrito: distrito.id, rubro });

  return (
    <>
      {recs.error ? <ErrorBox error={recs.error} onRetry={recs.reload} /> : null}
      {recs.loading && !recs.data ? <Loading label="Cargando los consejos…" /> : null}
      {recs.data && !latest ? (
        <Empty title={`Todavía no hay consejos aprobados para ${distrito.name}${rubro ? ` y ${sectorLabel(rubro)}` : ""}`}>
          Cuando el equipo de Blindaje apruebe uno, lo verás aquí. Mientras tanto, revisa{" "}
          <Link to={{ pathname: "/si-te-pasa", search }}>qué hacer si te pasa</Link>
          {rubro ? (
            <>
              {" "}
              o <Link to={{ pathname: "/recomendaciones", search: choiceSearch({ distrito: distrito.id }) }}>los consejos de todos los rubros</Link>
            </>
          ) : null}
          .
        </Empty>
      ) : null}
      {latest ? <p className="answer-line">{urgentAnswer(latest)}</p> : null}
      {latest ? <RecommendationSheet rec={latest} /> : null}
      {older.length ? (
        <details className="older">
          <summary>Consejos anteriores ({older.length})</summary>
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

/** "Ate" para "ate", "Ate - Celda 3" o "Ate"; el texto tal cual si no es un distrito. */
function zoneName(zona: string): string {
  return districtOfZone(zona)?.name ?? zona;
}

/** Un consejo aprobado, con lo urgente primero. */
export function RecommendationSheet({ rec, compact = false }: { rec: BusinessRecommendationView; compact?: boolean }) {
  const groups = byPriority(rec.recomendaciones);
  const tid = `rec-${rec.id}`;
  // Numeración continua entre grupos: el orden de la lista es el orden en que conviene hacerlo.
  const starts = groups.map((_, gi) => 1 + groups.slice(0, gi).reduce((sum, g) => sum + g.items.length, 0));
  return (
    <article className="rec" aria-labelledby={tid}>
      <header className="rec-head">
        <h2 id={tid}>
          Para {sectorLabel(rec.sector)} de {zoneName(rec.zona)}
        </h2>
        <p className="muted">
          Aprobado por el equipo de Blindaje el {fmtDate(rec.approved_at)}
          {rec.nivel_riesgo !== "sin_datos" ? ` · Riesgo ${NIVEL_LABEL[rec.nivel_riesgo]}` : ""}
        </p>
      </header>
      <p className="body-l measure">{rec.resumen}</p>

      {groups.map((g, gi) => (
        <div key={g.prioridad} className="rec-group">
          <h3 id={`${tid}-${g.prioridad}`}>
            {PRIORIDAD_TITULO[g.prioridad]}
            <span className="sr-only"> ({PRIORIDAD_LABEL[g.prioridad].toLowerCase()})</span>
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
      ))}

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

/** Lo más urgente en una frase: el primer consejo de la prioridad más alta. */
export function urgentAnswer(rec: BusinessRecommendationView): string {
  const first = byPriority(rec.recomendaciones)[0]?.items[0];
  return first ? `Lo más urgente: ${first.titulo.replace(/\.$/, "")}.` : rec.resumen;
}
