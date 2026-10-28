import type { Env } from "../env";
import { readDerivativePlain, readEvidencePlain, type EvidenceRow } from "../evidence";
import { fromUtf8, utf8 } from "../lib/encoding";
import { ApiError } from "../lib/errors";
import type { EvidenceCtx } from "./context";
import { binaryDerivative, commitWrites, emptyWrites, previousOutputs } from "./store";
import type { TextoContent } from "./types";

/**
 * Texto (mensajes pegados y el relato): se guarda como derivado de texto plano normalizado, cifrado
 * en R2 como todo lo demás. El relato es de la víctima: nunca entra en claro a D1.
 */

const MAX_CHARS = 20_000;

export function normalizePlainText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}

export async function processText(ctx: EvidenceCtx): Promise<void> {
  const { env, ev } = ctx;
  const plain = await readEvidencePlain(env, ev);
  if (!plain) throw new ApiError("not_found", "No se encontró el archivo de la evidencia");
  const text = normalizePlainText(fromUtf8(plain));
  const w = emptyWrites();
  const content: TextoContent = { source: ev.source, chars: text.length };
  await binaryDerivative(env, w, ev, "texto", utf8(text), content);
  const prev = await previousOutputs(env, ev.id);
  await commitWrites(env, prev, w);
}

/** Texto plano de una evidencia de tipo texto: el derivado si existe, si no el original. */
export async function readEvidenceText(env: Env, ev: Pick<EvidenceRow, "id" | "r2_key">): Promise<string | null> {
  const der = await env.DB.prepare("SELECT id, r2_key FROM derivatives WHERE evidence_id = ? AND tipo = 'texto' LIMIT 1")
    .bind(ev.id)
    .first<{ id: string; r2_key: string | null }>();
  const bytes = der ? await readDerivativePlain(env, der).catch(() => null) : null;
  if (bytes) return fromUtf8(bytes);
  const original = await readEvidencePlain(env, ev).catch(() => null);
  return original ? normalizePlainText(fromUtf8(original)) : null;
}
