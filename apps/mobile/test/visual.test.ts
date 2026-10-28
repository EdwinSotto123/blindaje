import { highlight } from "@/private/highlight";
import { buildRows, overallSafety, safetyLabel } from "@/private/rows";
import { colors } from "@/theme/tokens";
import type { QueueItem } from "@/sync/queue";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe("Sistema visual Cuaderno: contraste mínimo 4.5:1", () => {
  const pares: [string, string, string][] = [
    ["Tinta sobre Papel", colors.tinta, colors.papel],
    ["Lápiz sobre Papel", colors.lapiz, colors.papel],
    ["Lápiz sobre blanco", colors.lapiz, colors.blanco],
    ["Blanco sobre Tinta (botón primario)", colors.blanco, colors.tinta],
    ["Tinta sobre Resaltador", colors.tinta, colors.resaltador],
    ["Tinta sobre Resaltador verde", colors.tinta, colors.resaltadorVerde],
    ["Tinta sobre Resaltador rosa", colors.tinta, colors.resaltadorRosa],
    ["Tinta sobre Cuadrícula suave", colors.tinta, colors.cuadriculaSuave],
    ["Lápiz sobre Cuadrícula suave", colors.lapiz, colors.cuadriculaSuave],
    ["Blanco sobre Tinta fuerte", colors.blanco, colors.tintaFuerte],
  ];
  it.each(pares)("%s", (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Resaltado de datos en la transcripción", () => {
  it("marca montos, plazos, medio de pago, números y grupo", () => {
    const segs = highlight("Vas a yapear S/ 2,000 al 987 654 321 en 48 horas. Somos de Los X.");
    const marcados = segs.filter((s) => s.hl).map((s) => s.text);
    expect(marcados).toEqual(expect.arrayContaining(["yapear", "S/ 2,000", "987 654 321", "48 horas", "Los X"]));
    expect(segs.map((s) => s.text).join("")).toBe("Vas a yapear S/ 2,000 al 987 654 321 en 48 horas. Somos de Los X.");
  });
});

describe("Lo que está a salvo y lo que espera conexión", () => {
  const q = (status: QueueItem["status"], id: string = status): QueueItem => ({
    id,
    tipo: "audio",
    mime: "audio/mp4",
    source: "grabacion",
    captured_at: "2026-10-03T19:40:00-05:00",
    duration_ms: 42000,
    size: 10,
    sha256: "a".repeat(64),
    blob: `${id}.bin`,
    status,
    attempts: 0,
    next_at: 0,
    last_error: null,
    evidence_id: null,
    label: null,
    preview: null,
    created_at: 1,
  });

  it("el chip dice la verdad", () => {
    expect(safetyLabel(overallSafety([], true, true))).toBe("Guardado cifrado, fuera de este celular");
    expect(safetyLabel(overallSafety([q("pendiente")], false, true))).toBe("1 nota espera conexión");
    expect(safetyLabel(overallSafety([q("pendiente", "a"), q("pendiente", "b")], false, false))).toBe("2 notas esperan conexión");
  });

  it("cada fila dice dónde está; lo retenido no se lista hasta aceptarlo", () => {
    const rows = buildRows(null, [q("pendiente"), q("retenido"), q("error")]);
    expect(rows.map((r) => r.subtitle)).toEqual(expect.arrayContaining(["Esperando conexión", "No se pudo subir. Toca para reintentar"]));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe("Audio de 0:42");
  });
});
