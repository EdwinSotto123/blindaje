import { parseSoles } from "@/lib/format";

/**
 * Calculadora de vuelto (funciona de verdad) y teclado del PIN.
 *
 * Hay dos campos: Total y Pagó con. Las teclas escriben en el campo activo. Al tocar
 * "Calcular", si lo último que se tecleó en el campo activo son de 4 a 8 dígitos, la pantalla
 * prueba esos dígitos como PIN. Si no coinciden, la calculadora sigue como si nada: muestra el
 * vuelto. Un intento fallido se ve igual que un cálculo normal.
 */
export type Field = "total" | "pago";
export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

export type VueltoState = {
  total: string;
  pago: string;
  active: Field;
  /** Teclas escritas en el campo activo desde que se activó o se limpió. */
  typed: string;
  /** Resultado en céntimos (positivo: vuelto; negativo: falta). */
  result: number | null;
};

export const MAX_INT_DIGITS = 7;

export function initialVuelto(totalCents?: number | null): VueltoState {
  return {
    total: totalCents != null ? (totalCents / 100).toFixed(2) : "",
    pago: "",
    active: totalCents != null ? "pago" : "total",
    typed: "",
    result: null,
  };
}

function appendKey(value: string, key: Key): string {
  if (key === ".") {
    if (value.includes(".")) return value;
    return value === "" ? "0." : `${value}.`;
  }
  const [ent = "", dec] = value.split(".");
  if (dec !== undefined) return dec.length >= 2 ? value : value + key;
  if (ent.length >= MAX_INT_DIGITS + 1) return value; // deja escribir un PIN de 8 dígitos
  if (value === "0") return key;
  return value + key;
}

export function press(s: VueltoState, key: Key): VueltoState {
  const field = s.active;
  const cur = s[field];
  if (key === "clear") return { ...s, [field]: "", typed: "", result: null };
  if (key === "back") return { ...s, [field]: cur.slice(0, -1), typed: s.typed.slice(0, -1), result: null };
  return { ...s, [field]: appendKey(cur, key), typed: s.typed + key, result: null };
}

export function focus(s: VueltoState, field: Field): VueltoState {
  return field === s.active ? s : { ...s, active: field, typed: "" };
}

/** Dígitos que se probarán como PIN, o null si lo tecleado no parece un PIN. */
export function pinCandidate(s: VueltoState): string | null {
  return /^\d{4,8}$/.test(s.typed) ? s.typed : null;
}

/** Calcula el vuelto. Si falta un dato, pasa al campo que falta. */
export function calculate(s: VueltoState): VueltoState {
  const total = parseSoles(s.total);
  const pago = parseSoles(s.pago);
  if (total === null) return { ...s, active: "total", typed: "", result: null };
  if (pago === null) return { ...s, active: "pago", typed: "", result: null };
  return { ...s, typed: "", result: pago - total };
}

/** Freno silencioso: después de 5 PIN fallidos seguidos, deja de probar PIN por 60 s. */
export class PinThrottle {
  private fails = 0;
  private until = 0;
  constructor(
    private readonly max = 5,
    private readonly coolMs = 60_000,
  ) {}
  canTry(now = Date.now()): boolean {
    return now >= this.until;
  }
  fail(now = Date.now()): void {
    this.fails += 1;
    if (this.fails >= this.max) {
      this.until = now + this.coolMs;
      this.fails = 0;
    }
  }
  success(): void {
    this.fails = 0;
    this.until = 0;
  }
}
