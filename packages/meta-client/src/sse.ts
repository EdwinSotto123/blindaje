import { MetaApiError } from "./errors";

/**
 * Lector de server-sent events sobre un `ReadableStream` de bytes. Implementa el formato de
 * WHATWG: líneas `event:`/`data:`/`id:`, comentarios con `:`, varias líneas `data:` unidas con
 * salto de línea, y fin de evento con una línea vacía (acepta \n, \r\n y \r).
 */

export interface SseMessage {
  event: string | null;
  data: string;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | null = null;
  let data: string[] = [];

  const flushLine = function* (line: string): Generator<SseMessage> {
    if (line === "") {
      if (data.length > 0) yield { event, data: data.join("\n") };
      event = null;
      data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      const lineBreak = /\r\n|\r|\n/g;
      let consumed = 0;
      while ((match = lineBreak.exec(buffer)) !== null) {
        // Un \r al final del buffer puede ser la primera mitad de un \r\n: esperamos más bytes.
        if (match[0] === "\r" && match.index === buffer.length - 1) break;
        yield* flushLine(buffer.slice(consumed, match.index));
        consumed = match.index + match[0].length;
      }
      buffer = buffer.slice(consumed);
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield* flushLine(buffer.replace(/\r$/, ""));
    yield* flushLine("");
  } finally {
    reader.releaseLock();
  }
}

/** Evento de la Responses API en streaming (`data:` en JSON). */
export interface ResponsesStreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Convierte el SSE de la Responses API en eventos JSON. Termina en `[DONE]` o al cerrarse el
 * stream. Un evento `error` (fallo del backend a mitad de stream) se lanza como MetaApiError con
 * `inStream: true`, reintentable si su código es transitorio.
 */
export async function* readResponsesEvents(
  body: ReadableStream<Uint8Array>,
  requestId: string | null,
): AsyncGenerator<ResponsesStreamEvent> {
  for await (const message of readSse(body)) {
    if (message.data === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      continue; // keep-alive u otra línea que no es JSON
    }
    if (!parsed || typeof parsed !== "object") continue;
    const evt = parsed as ResponsesStreamEvent;
    if (typeof evt.type !== "string" && message.event) evt.type = message.event;
    if (evt.type === "error") {
      const err = (typeof evt.error === "object" && evt.error ? evt.error : evt) as Record<string, unknown>;
      throw new MetaApiError({
        status: 200,
        inStream: true,
        message: typeof err.message === "string" ? err.message : "error en el stream",
        code: typeof err.code === "string" ? err.code : null,
        type: typeof err.type === "string" && err.type !== "error" ? err.type : null,
        requestId,
      });
    }
    yield evt;
  }
}
