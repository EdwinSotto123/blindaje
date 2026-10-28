import { Text, View } from "react-native";

import { T } from "@/components/ui";
import { highlight } from "@/private/highlight";
import type { VictimReport } from "@/shared";
import { colors, fonts, MAX_FONT_SCALE } from "@/theme/tokens";

type Turns = NonNullable<VictimReport["evidencia"][number]["transcripcion"]>;

/** Transcripción con los datos detectados resaltados (siempre texto Tinta sobre resaltador). */
export function Transcript({ turns, terms = [] }: { turns: Turns; terms?: string[] }) {
  return (
    <View style={{ gap: 10 }} testID="transcripcion">
      {turns.map((t, i) => (
        <View key={i} style={{ gap: 2 }}>
          {t.speaker ? <T variant="small">{t.es_victima ? "Tú" : t.speaker}</T> : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontFamily: fonts.texto, fontSize: 17, lineHeight: 27, color: colors.tinta }}>
            {highlight(t.text, terms).map((sgm, j) =>
              sgm.hl ? (
                <Text key={j} style={{ backgroundColor: colors.resaltador, fontFamily: fonts.textoBold }}>
                  {sgm.text}
                </Text>
              ) : (
                <Text key={j}>{sgm.text}</Text>
              ),
            )}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Términos extra para resaltar, tomados de la ficha del propio caso. */
export function termsFromReport(r: VictimReport | null): string[] {
  if (!r?.ficha) return [];
  return [...r.ficha.frases_firma, ...r.ficha.identificadores.map((i) => i.valor), r.ficha.grupo_que_dice_ser ?? ""].filter(Boolean);
}
