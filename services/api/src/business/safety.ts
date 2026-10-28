import { humanizeIsoDates, mapStrings, stripCitations } from "../agents/tools/safety";

/**
 * Salvaguardas de todo lo que llega a un negocio (portal) o a una víctima como recomendación:
 * - ningún número largo (6 dígitos o más, sueltos o separados por espacios, puntos, comas o guiones)
 *   ni referencia "ID-…": el portal no puede servir para saber si un número está marcado;
 * - ninguna cita interna (EV-, FICHA-, VIN-, R-…);
 * - ningún consejo de pagar o negociar, ni consejos tácticos sobre personas (seguir, enfrentar,
 *   identificar a alguien): eso es solo para la autoridad.
 */

export const NUMERO_OMITIDO = "[número omitido]";

const SIX_DIGITS_RE = /\+?\d(?:[\s.,-]?\d){5,}/g;

/** Texto apto para un negocio: sin citas internas, sin "ID-…" y sin números de 6 dígitos o más. */
export function sanitizePublicText(text: string): string {
  let s = stripCitations(text);
  s = s.replace(/\bID-[\w…-]*/g, "").replace(/ID-/g, "ID ");
  s = humanizeIsoDates(s);
  s = s.replace(SIX_DIGITS_RE, NUMERO_OMITIDO);
  return s
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** Igual, pero conserva las citas internas (contenido guardado que ve la consola). */
export function sanitizeStoredText(text: string): string {
  return humanizeIsoDates(text.replace(/\bID-[\w…-]*/g, "").replace(/ID-/g, "ID "))
    .replace(SIX_DIGITS_RE, NUMERO_OMITIDO)
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** ¿Hay un número de 6 dígitos o más? Las fechas ISO (2026-10-12) no cuentan. */
export function hasLongDigits(text: string): boolean {
  SIX_DIGITS_RE.lastIndex = 0;
  const found = SIX_DIGITS_RE.test(humanizeIsoDates(text));
  SIX_DIGITS_RE.lastIndex = 0;
  return found;
}

/** Claves cuyo valor no es texto libre (identificadores de fila, correos y fechas ISO). */
const RAW_KEYS = new Set(["id", "org_id", "email", "approved_at", "actualizado_at", "created_at", "semana", "desde"]);

/** Aplica `sanitizePublicText` a todos los textos de una respuesta para negocios. */
export function sanitizeDeep<T>(value: T): T {
  return mapStrings(value, (s, key) => (key && RAW_KEYS.has(key) ? s : sanitizePublicText(s)));
}

// ---------------------------------------------------------------------------
// Consejos inseguros: pagar, negociar o actuar contra personas
// ---------------------------------------------------------------------------

const PAGAR = /^(?:pag(?:a|ar|ue|ues|uen|ad|ando|arles?|arlos?|arla|ale|ales|alo|uele|ueles)|pág(?:a|ale|ales|alo|uele|ueles|ales)|yape(?:a|ar|e|es|en|ales?|arles?)|yapé(?:ale|ales)|deposit(?:a|ar|e|es|en|ales?|arles?)|depósit(?:ale|ales)|transfi(?:ere|eras|eran|érele|éreles)|transferir(?:le|les)?|abon(?:a|ar|e|es|ales?))$/;
const NEGOCIAR = /^(?:negoci(?:a|ar|e|es|en|ad|ando|arlo|arla|ales?|arles?|ación|aciones)|negocí(?:a|ale|ales)|regate(?:a|ar|e|es)|transa|transar|transes)$/;
const TACTICO = /^(?:sigue|seguir|sigas|siguen|persigue|perseguir|persigas|enfrent\p{L}*|confront\p{L}*|encar(?:a|ar|es|alo|alos)|identific\p{L}*|ubic(?:a|ar|es|alo|alos)|rastre\p{L}*|captur\p{L}*|atrap\p{L}*|vigil(?:a|ar|es|alo|alos)|fotografí\p{L}*|fotografi\p{L}*|investig\p{L}*|desenmascar\p{L}*|busc(?:a|ar|es)|averigu\p{L}*)$/u;
/** Objeto de un verbo táctico que es una persona: "enfrenta al cobrador", "identifica a quien llama". */
const OBJ_PERSONA = /^(?:quien|quién|quienes|quiénes|extorsionador\p{L}*|cobrador\p{L}*|delincuente\p{L}*|criminal\p{L}*|sospechos\p{L}*|cabecilla\p{L}*|llamante\p{L}*|persona\p{L}*|responsable\p{L}*|miembro\p{L}*|integrante\p{L}*|jefe\p{L}*|ell[oa]s|él|ella|aquel\p{L}*|tipo|sujeto\p{L}*|cómplice\p{L}*|complice\p{L}*)$/u;
const ARTICULO = /^(?:a|al|los|las|el|la|del|de|un|una|unos|unas|esos?|esas?|estos?|estas?|aquellos?|aquellas?|tu|tus|su|sus)$/;
const FRASE_NEGOCIACION =
  /\b(?:(?:lleg(?:a|ar|ues|uen)|busc(?:a|ar|ues)|intent(?:a|ar|es)|haz|hacer|cierr(?:a|as)|cerrar)\s+(?:a\s+)?(?:un\s+)?(?:acuerdo|arreglo|trato)|(?:pid(?:e|as|an)|pedir|solicit(?:a|ar|es))\s+(?:una?\s+|más\s+)?(?:rebaja|descuento|prórroga|prorroga|plazo|tiempo)|(?:ofrec(?:e|er|es|eles|ele)|entreg(?:a|ar|ues|ales?))\s+(?:un\s+|una\s+|el\s+|la\s+|algo\s+de\s+|parte\s+del?\s+)?(?:monto|parte|pago|cuota|cupo|dinero|plata|colaboración)|(?:da|dar|dales|dale)\s+(?:un\s+|una\s+|el\s+|la\s+|algo\s+de\s+)?(?:monto|pago|cuota|cupo|dinero|plata|colaboración)|(?:tend(?:er|ió|iendo)|tiende)\s+una\s+trampa|tom(?:a|ar)\s+represalias|justicia\s+por\s+(?:tu|su|sus|tus)\s+propia)/giu;

const NEGACION = new Set(["no", "nunca", "jamás", "jamas", "ni", "sin", "evita", "evites", "evitar", "eviten", "tampoco", "ningún", "ningun", "ninguna", "nadie", "nada", "rechaza", "rechazar", "niégate", "negarte"]);
/** Tras una negación invierten el sentido: "no dudes en pagar", "no dejes de pagar". */
const INVIERTE = new Set(["dudes", "duden", "dudar", "temas", "teman", "olvides", "olviden", "dejes", "dejen"]);
/** Verbos que describen la exigencia del extorsionador, no un consejo: "si te exigen pagar…". */
const EXIGENCIA = new Set([
  "exigen", "exige", "exijan", "exija", "exigir", "exigiendo", "piden", "pide", "pidan", "pida", "pedir", "pidiendo", "obligan", "obliga",
  "obliguen", "obligar", "cobran", "cobrar", "presionan", "presionar", "quieren", "quiere", "dicen", "insisten", "amenazan", "intimidan",
  "ordenan", "ordena", "reclaman", "exigía", "pedía", "pidieron", "exigieron",
]);
const CONJUNCION = new Set(["y", "e", "o", "u", "pero", "sino", "luego", "después", "mejor"]);

const WORD_RE = /\p{L}+/gu;
const WINDOW = 4;

interface Token {
  w: string;
  start: number;
}

function tokens(clause: string): Token[] {
  return [...clause.toLowerCase().matchAll(WORD_RE)].map((m) => ({ w: m[0], start: m.index }));
}

/** ¿El verbo en la posición i está negado ("no pagues", "evita pagar o negociar")? */
function negated(toks: Token[], i: number): boolean {
  const prev = toks.slice(Math.max(0, i - WINDOW), i).map((t) => t.w);
  if (prev.some((w) => EXIGENCIA.has(w))) return true;
  let neg = -1;
  for (let j = prev.length - 1; j >= 0; j--) {
    if (NEGACION.has(prev[j]!)) {
      neg = j;
      break;
    }
  }
  if (neg === -1) return false;
  const after = prev.slice(neg + 1);
  if (after.some((w) => INVIERTE.has(w))) return false;
  // Una conjunción vuelve a empezar la oración, salvo que una dos verbos negados ("evita pagar o negociar").
  for (let j = 0; j < after.length; j++) {
    if (!CONJUNCION.has(after[j]!)) continue;
    const before = j === 0 ? prev[neg]! : after[j - 1]!;
    if (!(PAGAR.test(before) || NEGOCIAR.test(before) || NEGACION.has(before))) return false;
  }
  return true;
}

/** Cláusulas: lo que separan los signos de puntuación (una coma también corta: "no respondas, mejor paga"). */
function clauses(text: string): string[] {
  return text.split(/[.;:!?¡¿,()\n"“”«»]+/).filter((c) => c.trim());
}

function objectIsPerson(toks: Token[], i: number): boolean {
  for (let j = i + 1; j < Math.min(toks.length, i + 4); j++) {
    const w = toks[j]!.w;
    if (ARTICULO.test(w)) continue;
    return OBJ_PERSONA.test(w);
  }
  return false;
}

function clauseIsUnsafe(clause: string): boolean {
  const toks = tokens(clause);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]!.w;
    if ((PAGAR.test(w) || NEGOCIAR.test(w)) && !negated(toks, i)) return true;
    if (TACTICO.test(w) && objectIsPerson(toks, i) && !negated(toks, i)) return true;
  }
  const lower = clause.toLowerCase();
  for (const m of lower.matchAll(FRASE_NEGOCIACION)) {
    const i = toks.findIndex((t) => t.start >= m.index);
    if (i === -1 || !negated(toks, i)) return true;
  }
  return false;
}

/**
 * ¿El texto aconseja pagar, negociar o actuar contra personas? Prefiere los falsos positivos: un
 * consejo bueno descartado se repone con los consejos fijos; uno malo nunca debe pasar.
 */
export function isUnsafeAdvice(text: string): boolean {
  return clauses(text).some(clauseIsUnsafe);
}

/** Quita las oraciones inseguras de un texto corrido (resumen). */
export function dropUnsafeSentences(text: string): { text: string; removed: string[] } {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [];
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of sentences) (isUnsafeAdvice(s) ? removed : kept).push(s);
  return { text: kept.join("").replace(/\s{2,}/g, " ").trim(), removed: removed.map((s) => s.trim()) };
}
