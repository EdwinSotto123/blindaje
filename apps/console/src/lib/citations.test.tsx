import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CiteList, CitationProvider, CitedText } from "../components/Citations";
import { initialLinks } from "../mock/fixtures";
import { citationAriaLabel, citationKind, citationText, indexFromLink, parseCitations } from "./citations";

const link = initialLinks().find((l) => l.label === "VIN-1")!;
const index = indexFromLink(link);

/** Texto visible (sin atributos ni etiquetas) de un HTML. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

describe("parseCitations", () => {
  it("separa texto y citas en orden, con su tipo", () => {
    const segs = parseCitations("La voz de EV-B1 se parece a la de EV-A1 (V-3, V-7). Ver FICHA-A y VIN-12 en R-014.");
    const cites = segs.filter((s) => s.type === "cite");
    expect(cites.map((c) => c.ref)).toEqual(["EV-B1", "EV-A1", "V-3", "V-7", "FICHA-A", "VIN-12", "R-014"]);
    expect(cites.map((c) => c.kind)).toEqual(["evidencia", "evidencia", "voz", "voz", "ficha", "vinculo", "red"]);
    expect(segs.map((s) => (s.type === "text" ? s.text : s.ref)).join("")).toBe(
      "La voz de EV-B1 se parece a la de EV-A1 (V-3, V-7). Ver FICHA-A y VIN-12 en R-014.",
    );
  });

  it("reconoce evidencia de códigos largos, identificadores, recortes y la forma ID-…488", () => {
    const refs = parseCitations("EV-K7Q2-3 ID-3fa9c1 IMG-7 ID-…488 ID-...131")
      .filter((s) => s.type === "cite")
      .map((s) => (s.type === "cite" ? s.ref : ""));
    expect(refs).toEqual(["EV-K7Q2-3", "ID-3fa9c1", "IMG-7", "ID-…488", "ID-...131"]);
  });

  it("no inventa citas dentro de palabras", () => {
    expect(parseCitations("PREV-1 y XV-3 no son citas").every((s) => s.type === "text")).toBe(true);
  });

  it("clasifica por prefijo", () => {
    expect(citationKind("IMG-1")).toBe("imagen");
    expect(citationKind("ID-3fa9c1")).toBe("identificador");
    expect(citationKind("hola")).toBeNull();
  });
});

describe("citationText", () => {
  it("muestra solo los últimos 3 caracteres de un identificador cifrado", () => {
    expect(citationText("ID-3fa9c1", index)).toBe("Yape …488");
    expect(citationText("ID-7c41e2", index)).toBe("Tel. …131");
    expect(citationText("ID-…488")).toBe("…488");
  });

  it("deja el resto de citas igual", () => {
    expect(citationText("EV-A1", index)).toBe("EV-A1");
    expect(citationText("V-3", index)).toBe("V-3");
  });

  it("describe la cita para lectores de pantalla", () => {
    expect(citationAriaLabel("ID-3fa9c1", index)).toBe("Abrir cuenta de yape terminado en 488");
    expect(citationAriaLabel("EV-A1", index)).toBe("Abrir evidencia EV-A1");
    expect(citationAriaLabel("FICHA-B", index)).toBe("Abrir ficha del caso B");
  });
});

describe("indexFromLink", () => {
  it("resuelve evidencia, fichas, huellas e identificadores de los dos casos", () => {
    const ev = index.get("EV-A1");
    expect(ev?.kind).toBe("evidencia");
    if (ev?.kind === "evidencia") {
      expect(ev.caseCode).toBe("A");
      expect(ev.fragments.map((f) => f.voice_label)).toEqual(["V-3"]);
    }
    const voz = index.get("V-7");
    expect(voz?.kind === "voz" && voz.cases).toEqual(["B"]);
    const id = index.get("ID-3fa9c1");
    expect(id?.kind === "identificador" && id.ultimos_3).toBe("488");
    expect(index.get("FICHA-B")?.kind).toBe("ficha");
    expect(index.get("VIN-1")?.kind).toBe("vinculo");
  });
});

describe("render de citas", () => {
  it("convierte cada cita en un botón accesible y nunca muestra el identificador completo", () => {
    const html = renderToStaticMarkup(
      <CitationProvider index={index}>
        <p>
          <CitedText text={link.vinculador!.explicacion} />
        </p>
      </CitationProvider>,
    );
    expect(html).toContain('<button type="button" class="cite" data-kind="evidencia" aria-label="Abrir evidencia EV-B1"');
    expect(html).toContain('aria-label="Abrir teléfono terminado en 131"');
    const text = visibleText(html);
    expect(text).toContain("Tel. …131");
    expect(text).toContain("Tel. …904");
    expect(text).not.toMatch(/ID-[0-9a-f]{6}/);
    expect(html).not.toMatch(/ID-[0-9a-f]{6}/);
  });

  it("marca citas inexistentes y afirmaciones sin cita", () => {
    const html = renderToStaticMarkup(
      <CitationProvider index={index}>
        <CiteList refs={["EV-A1", "EV-D9"]} missing={["EV-D9"]} />
        <CiteList refs={[]} />
      </CitationProvider>,
    );
    expect(html).toContain('class="cite cite-missing"');
    expect(html).toContain("(cita inexistente)");
    expect(html).toContain("Sin cita");
  });

  it("sin proveedor, las citas se muestran pero no son botones", () => {
    const html = renderToStaticMarkup(<CitedText text="Ver EV-A1." />);
    expect(html).toBe('<span>Ver </span><span class="cite" data-kind="evidencia">EV-A1</span><span>.</span>');
  });
});
