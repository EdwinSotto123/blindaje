import { CITATION_RE } from "@blindaje/shared";
import type { AudioFragment, CaseSide, FichaStored, LinkView, NetworkView } from "../api/types";

/**
 * Citas de los agentes (packages/shared/src/labels.ts):
 *   EV-A1 · EV-K7Q2-3 · FICHA-A · VIN-12 · V-3 · ID-3fa9c1 · IMG-7 · R-014
 * Además se acepta la forma de presentación "ID-…488" (como en el ejemplo del documento de diseño).
 */
export type CitationKind = "evidencia" | "ficha" | "vinculo" | "voz" | "identificador" | "imagen" | "red";

export type Segment = { type: "text"; text: string } | { type: "cite"; ref: string; kind: CitationKind };

const DISPLAY_ID_RE = /\bID-(?:…|\.\.\.)(\d{3}|[A-Z0-9]{3})\b/;
const ALL_RE = new RegExp(`${CITATION_RE.source}|${DISPLAY_ID_RE.source}`, "g");

export function citationKind(ref: string): CitationKind | null {
  if (ref.startsWith("EV-")) return "evidencia";
  if (ref.startsWith("FICHA-")) return "ficha";
  if (ref.startsWith("VIN-")) return "vinculo";
  if (ref.startsWith("V-")) return "voz";
  if (ref.startsWith("ID-")) return "identificador";
  if (ref.startsWith("IMG-")) return "imagen";
  if (ref.startsWith("R-")) return "red";
  return null;
}

/** Divide un texto en trozos de texto y citas, en orden. */
export function parseCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  ALL_RE.lastIndex = 0;
  for (let m = ALL_RE.exec(text); m !== null; m = ALL_RE.exec(text)) {
    const ref = m[0];
    const kind = citationKind(ref);
    if (!kind) continue;
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: "cite", ref, kind });
    last = m.index + ref.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function isKnownCitation(ref: string): boolean {
  return parseCitations(ref).some((s) => s.type === "cite" && s.ref === ref);
}

// ---------------------------------------------------------------------------
// Índice de lo que se puede abrir desde una cita
// ---------------------------------------------------------------------------

export type CitationTarget =
  | {
      kind: "evidencia";
      ref: string;
      evidenceId: string;
      caseCode: string;
      tipo: string;
      sha256: string;
      received_utc: string;
      duration_ms: number | null;
      fragments: AudioFragment[];
    }
  | { kind: "ficha"; ref: string; caseCode: string; ficha: FichaStored | null }
  | { kind: "voz"; ref: string; cases: string[]; huellas: string[]; fragments: AudioFragment[]; segmentos: number | null }
  | { kind: "identificador"; ref: string; tipo: string | null; rol: string | null; ultimos_3: string | null; cases: string[]; evidencia: string[] }
  | { kind: "vinculo"; ref: string; linkId: string | null; cases: string[]; score: number | null }
  | { kind: "imagen"; ref: string; evidencia: string[]; cases: string[]; descripcion: string | null }
  | { kind: "red"; ref: string; networkId: string | null };

export type CitationIndex = Map<string, CitationTarget>;

function addCase(index: CitationIndex, c: CaseSide, fragments: AudioFragment[]): void {
  for (const ev of c.evidencia) {
    index.set(ev.label, {
      kind: "evidencia",
      ref: ev.label,
      evidenceId: ev.id,
      caseCode: c.code,
      tipo: ev.tipo,
      sha256: ev.sha256,
      received_utc: ev.received_utc,
      duration_ms: ev.duration_ms,
      fragments: fragments.filter((f) => f.evidence_id === ev.id || f.evidence_label === ev.label),
    });
  }
  index.set(`FICHA-${c.code}`, { kind: "ficha", ref: `FICHA-${c.code}`, caseCode: c.code, ficha: c.ficha });
  for (const id of c.ficha?.identificadores ?? []) {
    const prev = index.get(id.ref);
    const prevCases = prev?.kind === "identificador" ? prev.cases : [];
    const prevEv = prev?.kind === "identificador" ? prev.evidencia : [];
    index.set(id.ref, {
      kind: "identificador",
      ref: id.ref,
      tipo: id.tipo,
      rol: id.rol,
      ultimos_3: id.ultimos_3,
      cases: [...new Set([...prevCases, c.code])],
      evidencia: [...new Set([...prevEv, ...id.evidencia])],
    });
  }
}

/** Índice para la vista de un vínculo: evidencia de ambos casos, fichas, huellas e identificadores. */
export function indexFromLink(link: LinkView): CitationIndex {
  const index: CitationIndex = new Map();
  addCase(index, link.case_a, link.fragments);
  addCase(index, link.case_b, link.fragments);
  const voices = new Map<string, AudioFragment[]>();
  for (const f of link.fragments) voices.set(f.voice_label, [...(voices.get(f.voice_label) ?? []), f]);
  for (const h of link.signals.voz?.huellas ?? []) if (!voices.has(h)) voices.set(h, []);
  for (const [label, frags] of voices) {
    const cases = [
      ...new Set(
        frags
          .map((f) => (link.case_a.evidencia.some((e) => e.id === f.evidence_id) ? link.case_a.code : link.case_b.code))
          .filter(Boolean),
      ),
    ];
    index.set(label, { kind: "voz", ref: label, cases, huellas: [label], fragments: frags, segmentos: null });
  }
  for (const s of link.signals.identificador?.compartidos ?? []) {
    const prev = index.get(s.ref);
    index.set(s.ref, {
      kind: "identificador",
      ref: s.ref,
      tipo: s.tipo,
      rol: prev?.kind === "identificador" ? prev.rol : null,
      ultimos_3: s.ultimos_3,
      cases: [link.case_a.code, link.case_b.code],
      evidencia: s.evidencia,
    });
  }
  for (const r of link.signals.imagen?.recortes ?? []) {
    index.set(r, {
      kind: "imagen",
      ref: r,
      evidencia: link.signals.imagen?.evidencia ?? [],
      cases: [link.case_a.code, link.case_b.code],
      descripcion: null,
    });
  }
  index.set(link.label, {
    kind: "vinculo",
    ref: link.label,
    linkId: link.id,
    cases: [link.case_a.code, link.case_b.code],
    score: link.score,
  });
  return index;
}

/** Índice a partir de casos completos (GET /v1/console/cases/:id). */
export function indexFromCases(cases: CaseSide[]): CitationIndex {
  const index: CitationIndex = new Map();
  for (const c of cases) addCase(index, c, []);
  return index;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Índice para la vista de una red, a partir de los datos de cada nodo. */
export function indexFromNetwork(net: NetworkView): CitationIndex {
  const index: CitationIndex = new Map();
  // Casos conectados a cada nodo (la API no siempre manda data.casos).
  const codeOf = new Map(
    net.nodes.filter((n) => n.type === "caso").map((n) => [n.id, str(n.data?.code) ?? n.label.replace(/^Casos+/i, "")]),
  );
  const casesOf = (id: string, d: Record<string, unknown>): string[] => {
    const own = strArr(d.casos);
    if (own.length) return own;
    const out = new Set<string>();
    for (const e of net.edges) {
      const other = e.source === id ? e.target : e.target === id ? e.source : null;
      const code = other ? codeOf.get(other) : undefined;
      if (code) out.add(code);
    }
    return [...out].sort();
  };
  index.set(net.label, { kind: "red", ref: net.label, networkId: net.id });
  for (const l of net.links) {
    index.set(l.label, { kind: "vinculo", ref: l.label, linkId: l.id, cases: [l.case_a, l.case_b], score: l.score });
  }
  for (const n of net.nodes) {
    const d = n.data ?? {};
    if (n.type === "identificador") {
      index.set(n.label, {
        kind: "identificador",
        ref: n.label,
        tipo: str(d.tipo),
        rol: str(d.rol),
        ultimos_3: str(d.ultimos_3),
        cases: casesOf(n.id, d),
        evidencia: strArr(d.evidencia),
      });
    } else if (n.type === "voz") {
      const huellas = strArr(d.huellas);
      const target: CitationTarget = {
        kind: "voz",
        ref: n.label,
        cases: casesOf(n.id, d),
        huellas: huellas.length ? huellas : [n.label],
        fragments: [],
        segmentos: typeof d.segmentos === "number" ? d.segmentos : null,
      };
      index.set(n.label, target);
      for (const h of huellas) if (!index.has(h)) index.set(h, { ...target, ref: h });
    } else if (n.type === "imagen") {
      index.set(n.label, {
        kind: "imagen",
        ref: n.label,
        evidencia: strArr(d.evidencia),
        cases: casesOf(n.id, d),
        descripcion: str(d.descripcion) ?? (str(d.concept) ? `Concepto de SAM 3.1: “${str(d.concept)}”` : null),
      });
    } else if (n.type === "caso") {
      const code = str(d.code) ?? n.label.replace(/^Caso\s+/i, "");
      index.set(`FICHA-${code}`, { kind: "ficha", ref: `FICHA-${code}`, caseCode: code, ficha: null });
    }
  }
  return index;
}

export function mergeIndexes(...indexes: (CitationIndex | null | undefined)[]): CitationIndex {
  const out: CitationIndex = new Map();
  for (const idx of indexes) if (idx) for (const [k, v] of idx) if (!out.has(k)) out.set(k, v);
  return out;
}

const ID_TYPE_SHORT: Record<string, string> = {
  telefono: "Tel.",
  cuenta_yape: "Yape",
  cuenta_plin: "Plin",
  cuenta_bancaria: "Cuenta",
  placa: "Placa",
};

export const ID_TYPE_LABEL: Record<string, string> = {
  telefono: "Teléfono",
  cuenta_yape: "Cuenta de Yape",
  cuenta_plin: "Cuenta de Plin",
  cuenta_bancaria: "Cuenta bancaria",
  placa: "Placa",
};

/**
 * Texto visible de una cita. Los identificadores cifrados nunca se muestran completos: solo
 * "…488" (los últimos 3 caracteres que guarda la base), con el tipo si se conoce.
 */
export function citationText(ref: string, index?: CitationIndex): string {
  if (ref.startsWith("ID-")) {
    const display = DISPLAY_ID_RE.exec(ref);
    if (display) return `…${display[1]}`;
    const t = index?.get(ref);
    if (t?.kind === "identificador" && t.ultimos_3) {
      const short = t.tipo ? ID_TYPE_SHORT[t.tipo] : null;
      return short ? `${short} …${t.ultimos_3}` : `…${t.ultimos_3}`;
    }
  }
  return ref;
}

/** Descripción accesible (lector de pantalla) de una cita. */
export function citationAriaLabel(ref: string, index?: CitationIndex): string {
  const kind = citationKind(ref);
  const t = index?.get(ref);
  switch (kind) {
    case "evidencia":
      return `Abrir evidencia ${ref}`;
    case "ficha":
      return `Abrir ficha del caso ${ref.slice(6)}`;
    case "vinculo":
      return `Abrir vínculo ${ref}`;
    case "voz":
      return `Abrir huella de voz ${ref}`;
    case "identificador": {
      const tipo = t?.kind === "identificador" && t.tipo ? (ID_TYPE_LABEL[t.tipo] ?? "Identificador").toLowerCase() : "identificador cifrado";
      const shown = citationText(ref, index);
      return shown.includes("…") ? `Abrir ${tipo} terminado en ${shown.split("…")[1]}` : `Abrir ${tipo} ${ref}`;
    }
    case "imagen":
      return `Abrir recorte de imagen ${ref}`;
    case "red":
      return `Abrir red ${ref}`;
    default:
      return ref;
  }
}
