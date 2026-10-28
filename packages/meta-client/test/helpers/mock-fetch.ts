import type { FetchInit, FetchLike } from "../../src/core";

export interface RecordedCall {
  url: string;
  init: FetchInit;
  /** Cuerpo JSON parseado (si el cuerpo era JSON). */
  json: Record<string, unknown> | undefined;
  /** Cuerpo como texto (latin1 para binarios). */
  text: string;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** fetch simulado: responde con los handlers en orden y registra cada llamada. */
export function mockFetch(...handlers: Handler[]): FetchLike & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = (async (url: string, init: FetchInit) => {
    let text = "";
    if (typeof init.body === "string") text = init.body;
    else if (init.body instanceof ArrayBuffer) text = new TextDecoder("latin1").decode(init.body);
    let json: Record<string, unknown> | undefined;
    try {
      json = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    } catch {
      json = undefined;
    }
    const call: RecordedCall = { url, init, json, text };
    calls.push(call);
    const handler = handlers[calls.length - 1] ?? handlers[handlers.length - 1];
    if (!handler) throw new Error("mockFetch sin handlers");
    return handler(call);
  }) as FetchLike & { calls: RecordedCall[] };
  fn.calls = calls;
  return fn;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-test", ...headers },
  });
}

/** Respuesta SSE que entrega `text` en trozos de tamaño variable (prueba los cortes de buffer). */
export function sseResponse(text: string, chunkSizes: number[] = [7, 64, 3, 500]): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = chunkSizes[i++ % chunkSizes.length] ?? 64;
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req-sse" } });
}

/** Arma un SSE de la Responses API a partir de eventos. */
export function sseText(events: Array<Record<string, unknown>>, done = true): string {
  return (
    events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "")
  );
}

/** Respuesta de la Responses API con los ítems de salida dados. */
export function responseBody(
  id: string,
  output: Array<Record<string, unknown>>,
  usage: Partial<{ input: number; output: number; cached: number; reasoning: number }> = {},
  status = "completed",
): Record<string, unknown> {
  const input = usage.input ?? 100;
  const out = usage.output ?? 50;
  return {
    id,
    object: "response",
    status,
    model: "muse-spark-1.3",
    output,
    usage: {
      input_tokens: input,
      output_tokens: out,
      total_tokens: input + out,
      input_tokens_details: { cached_tokens: usage.cached ?? 0 },
      output_tokens_details: { reasoning_tokens: usage.reasoning ?? 0 },
    },
  };
}

export const message = (text: string, phase?: "commentary") => ({
  type: "message",
  id: `msg_${Math.random().toString(36).slice(2)}`,
  role: "assistant",
  status: "completed",
  ...(phase ? { phase } : {}),
  content: [{ type: "output_text", text, annotations: [] }],
});

export const functionCall = (callId: string, name: string, args: unknown) => ({
  type: "function_call",
  id: `fc_${callId}`,
  call_id: callId,
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
  status: "completed",
});

export const reasoning = () => ({ type: "reasoning", id: "rs_x", summary: [] });
