import { identifierGroup, normalizeIdentifier, type FichaExtraction, type IdentifierType } from "@blindaje/shared";

/**
 * Salvaguardas de la ficha (sección 7.3: "la ficha no incluye datos personales de la víctima").
 * El prompt ya lo pide; esto es la segunda barrera, determinista:
 *  - los turnos de la víctima nunca entran al modelo (ver ficha.ts);
 *  - los teléfonos tienen que parecer celulares peruanos (9 dígitos que empiezan en 9) o números
 *    internacionales escritos con "+": un DNI de 8 dígitos nunca pasa como "teléfono";
 *  - los textos libres pierden cualquier número largo y correos.
 */

/** Normalización estricta: como `normalizeIdentifier`, pero sin aceptar números que parecen DNI o fijos. */
export function normalizeIdentifierStrict(tipo: IdentifierType, raw: string): string | null {
  const n = normalizeIdentifier(tipo, raw);
  if (!n) return null;
  if (identifierGroup(tipo) !== "tel") return n;
  if (n.startsWith("+51")) return /^\+519\d{8}$/.test(n) ? n : null;
  return raw.trim().startsWith("+") && n.length >= 11 ? n : null;
}

const LONG_NUMBER = /\+?\d[\d\s().-]{5,}\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

/** Reemplaza números de 7 dígitos o más (teléfonos, DNI, cuentas) y correos por marcadores. */
export function scrubPersonalData(text: string): string {
  return text
    .replace(LONG_NUMBER, (m) => (m.replace(/\D/g, "").length >= 7 && !ISO_DATE.test(m.trim()) ? "[número]" : m))
    .replace(EMAIL, "[correo]");
}

/** Limpia la salida del modelo: citas solo a etiquetas conocidas y textos libres sin datos personales. */
export function sanitizeFichaText(f: FichaExtraction, known: Set<string>): FichaExtraction {
  const cites = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter((x) => known.has(x)))];
  const s = (t: string | null) => (t == null ? null : scrubPersonalData(t));
  return {
    ...f,
    amenaza: s(f.amenaza),
    plazo: s(f.plazo),
    grupo_que_dice_ser: s(f.grupo_que_dice_ser),
    frases_firma: [...new Set(f.frases_firma.map((x) => scrubPersonalData(x).trim()).filter(Boolean))].slice(0, 6),
    escalamiento: f.escalamiento.map((e) => ({ ...e, tipo: scrubPersonalData(e.tipo), evidencia: cites(e.evidencia) })),
    identificadores: f.identificadores.map((i) => ({ ...i, evidencia: cites(i.evidencia) })),
    resumen_mo: scrubPersonalData(f.resumen_mo),
    fuentes: cites(f.fuentes),
  };
}
