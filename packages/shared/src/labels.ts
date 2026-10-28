/**
 * Identificadores citables. Todos los agentes citan evidencia con estos formatos y el
 * validador de citas comprueba que cada uno exista (sección 10.1 del documento de diseño).
 *
 *   EV-A1        evidencia 1 del caso A (códigos de 1 letra: demo)
 *   EV-K7Q2-3    evidencia 3 del caso K7Q2 (códigos generados de 4 caracteres)
 *   FICHA-A      ficha del caso A
 *   VIN-12       vínculo 12
 *   V-3          huella de voz 3
 *   ID-3fa9c1    identificador cifrado (primeros 6 hex del HMAC); la UI muestra "…488"
 *   IMG-7        recorte de imagen 7
 *   R-014        red 14
 */

export const CASE_CODE_RE = /^[A-Z0-9]{1,6}$/;

export function evidenceLabel(caseCode: string, n: number): string {
  return caseCode.length === 1 ? `EV-${caseCode}${n}` : `EV-${caseCode}-${n}`;
}

export function fichaLabel(caseCode: string): string {
  return `FICHA-${caseCode}`;
}

export function linkLabel(n: number): string {
  return `VIN-${n}`;
}

export function voiceLabel(n: number): string {
  return `V-${n}`;
}

export function identifierLabel(hmacHex: string): string {
  return `ID-${hmacHex.slice(0, 6).toLowerCase()}`;
}

export function imageLabel(n: number): string {
  return `IMG-${n}`;
}

export function networkLabel(n: number): string {
  return `R-${String(n).padStart(3, "0")}`;
}

/** Reconoce cualquier identificador citable dentro de un texto. */
export const CITATION_RE =
  /\b(EV-[A-Z0-9]{1,6}(?:-\d+|\d+)|FICHA-[A-Z0-9]{1,6}|VIN-\d+|V-\d+|ID-[0-9a-f]{6}|IMG-\d+|R-\d{3,})\b/g;

export function extractCitations(text: string): string[] {
  return [...new Set(text.match(CITATION_RE) ?? [])];
}

export function isCitation(value: string): boolean {
  CITATION_RE.lastIndex = 0;
  const m = value.match(new RegExp(`^${CITATION_RE.source}$`));
  return m !== null;
}
