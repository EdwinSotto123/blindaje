/**
 * JSON canónico: claves ordenadas, sin espacios, `undefined` omitido. Dos objetos con el mismo
 * contenido producen siempre la misma cadena, así el hash de la auditoría es reproducible.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error("JSON canónico: número no finito");
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`JSON canónico: tipo no admitido (${typeof value})`);
  }
}
