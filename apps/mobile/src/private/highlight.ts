/**
 * Resalta en una transcripción los datos que importan para la denuncia: montos, plazos,
 * medios de pago, números de teléfono o cuenta y el nombre del grupo que dicen ser.
 * Es solo presentación: los datos los detecta el servidor.
 */
export type Segment = { text: string; hl: boolean };

const PATTERNS: RegExp[] = [
  /S\/\s?[\d.,]+/gi,
  /\b[\d.,]+\s*soles\b/gi,
  /\b(?:dos|tres|cinco|diez)\s+mil(?:\s+soles)?\b/gi,
  /\b\d+\s*(?:horas|días|dias)\b/gi,
  /\b(?:yape|yapea[rs]?|yapeas|plin)\b/gi,
  /\b9\d{2}\s?\d{3}\s?\d{3}\b/g,
  /\b[Ll]os\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]*/g,
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlight(text: string, extraTerms: string[] = []): Segment[] {
  const ranges: [number, number][] = [];
  const pats = [...PATTERNS, ...extraTerms.filter((t) => t.trim().length >= 3).map((t) => new RegExp(escapeRe(t.trim()), "gi"))];
  for (const re of pats) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || !m[0].trim()) continue;
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: Segment[] = [];
  let i = 0;
  for (const [a, b] of merged) {
    if (a > i) out.push({ text: text.slice(i, a), hl: false });
    out.push({ text: text.slice(a, b), hl: true });
    i = b;
  }
  if (i < text.length) out.push({ text: text.slice(i), hl: false });
  return out;
}
