/** Identificadores y códigos legibles. Alfabeto sin caracteres ambiguos (0/O, 1/I/L). */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";

export function newId(): string {
  return crypto.randomUUID();
}

export function randomCode(length: number, alphabet = ALPHABET): string {
  // Rechazo por módulo para no sesgar el alfabeto.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Código de caso de 4 caracteres (EV-K7Q2-3). */
export function caseCode(): string {
  return randomCode(4);
}

/**
 * Seudónimo de víctima: V-7F3K. Siempre contiene al menos una letra para que nunca se confunda
 * con una cita de huella de voz (V-<número>).
 */
export function pseudonym(): string {
  const body = randomCode(3) + randomCode(1, LETTERS);
  // Mezcla la letra garantizada en una posición aleatoria.
  const chars = body.split("");
  const pos = crypto.getRandomValues(new Uint8Array(1))[0]! % 4;
  [chars[pos], chars[3]] = [chars[3]!, chars[pos]!];
  return `V-${chars.join("")}`;
}

/** Código de invitación: XXXX-XXXX. */
export function inviteCode(): string {
  return `${randomCode(4)}-${randomCode(4)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string | Date, seconds: number): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() + seconds * 1000).toISOString();
}
