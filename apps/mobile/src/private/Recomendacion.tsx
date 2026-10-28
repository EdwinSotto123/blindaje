import { View } from "react-native";

import { Card, T } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { capitalizar, porPrioridad, PRIORIDAD, riesgoEnPalabras } from "@/private/recomendaciones";
import type { BusinessRecommendationView } from "@/shared";

/**
 * Una recomendación de prevención aprobada por el gremio. El nivel de riesgo va en palabras y en
 * texto secundario: informa, no alarma. Las advertencias (sesgo de los datos) cierran la tarjeta.
 */
export function RecomendacionCard({ r }: { r: BusinessRecommendationView }) {
  const recs = porPrioridad(r.recomendaciones);
  const fecha = shortDate(r.approved_at);
  return (
    <Card>
      <View style={{ gap: 2 }}>
        <T variant="h2" accessibilityRole="header">
          {capitalizar(r.sector)} · {r.zona}
        </T>
        {fecha ? <T variant="small">Aprobada por tu asociación el {fecha}</T> : null}
        <T variant="small">{riesgoEnPalabras(r.nivel_riesgo)}</T>
      </View>

      <T variant="body">{r.resumen}</T>

      {recs.length ? (
        <View style={{ gap: 10 }}>
          <T variant="bodyBold" accessibilityRole="header">
            Para prevenir
          </T>
          {recs.map((x, i) => (
            <View key={`${i}-${x.titulo}`} style={{ gap: 2 }}>
              <T variant="small">{PRIORIDAD[x.prioridad]}</T>
              <T variant="bodyBold">{x.titulo}</T>
              <T variant="body">{x.detalle}</T>
            </View>
          ))}
        </View>
      ) : null}

      {r.modalidades.length ? (
        <View style={{ gap: 4 }}>
          <T variant="bodyBold" accessibilityRole="header">
            Cómo reconocerlo
          </T>
          {r.modalidades.map((m, i) => (
            <View key={`${i}-${m.descripcion}`} style={{ gap: 2 }}>
              <T variant="body">{m.descripcion}</T>
              {m.senales_de_alerta.map((s, j) => (
                <T key={`${j}-${s}`} variant="body">
                  — {s}
                </T>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {r.que_hacer_si_te_pasa.length ? (
        <View style={{ gap: 4 }}>
          <T variant="bodyBold" accessibilityRole="header">
            Si te pasa
          </T>
          {r.que_hacer_si_te_pasa.map((q, i) => (
            <T key={`${i}-${q}`} variant="body">
              — {q}
            </T>
          ))}
        </View>
      ) : null}

      {r.advertencias.length ? (
        <View style={{ gap: 2 }}>
          {r.advertencias.map((a, i) => (
            <T key={`${i}-${a}`} variant="small">
              {a}
            </T>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
