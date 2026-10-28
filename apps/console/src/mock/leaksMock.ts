import { NOTA_RASTREO, type LeakTraceKind, type LeakTraceResult } from "@blindaje/shared";
import { ApiRequestError } from "../api/client";
import type { LeaksActor, LeaksApi } from "../api/leaks";
import { USERS } from "./fixtures";
import { readMockMark } from "./media";

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Rastreo simulado: aplica los mismos permisos que la API (solo admin) y busca la marca simulada que
 * `MockApi.fetchMedia` pone en cada copia. Un archivo sin esa marca no acusa a nadie.
 */
export class MockLeaksApi implements LeaksApi {
  private readonly latency: number;

  constructor(
    private readonly actor: LeaksActor,
    opts: { latency?: number } = {},
  ) {
    this.latency = opts.latency ?? 600;
  }

  private async wait(): Promise<void> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
  }

  async trace(file: Blob, kind?: LeakTraceKind): Promise<LeakTraceResult> {
    if (this.actor.role !== "admin") throw new ApiRequestError(403, "forbidden", "Tu rol no tiene permiso para esta acción.");
    if (!file.size) throw new ApiRequestError(400, "bad_request", "Falta el archivo");
    if (file.size > MAX_BYTES) throw new ApiRequestError(413, "payload_too_large", "El archivo supera el límite de 50 MB");
    const type = file.type.toLowerCase();
    if (!kind && type.startsWith("video/")) {
      throw new ApiRequestError(400, "bad_request", "Los videos todavía no llevan marca: solo se rastrean audios e imágenes.");
    }
    const mark = await readMockMark(file);
    const k: LeakTraceKind = kind ?? (type.startsWith("audio/") ? "audio" : type.startsWith("image/") ? "imagen" : (mark?.k ?? "imagen"));
    await this.wait();
    const model = k === "audio" ? "audioseal-16bits (simulado)" : "videoseal-256bits (simulado)";
    if (!mark || mark.k !== k) {
      return {
        detected: false,
        kind: k,
        score: 0.04,
        candidates: [],
        ambiguo: false,
        nota: `No se detectó una marca de Blindaje en ${k === "audio" ? "este audio" : "esta imagen"}. ${NOTA_RASTREO}`,
        model,
      };
    }
    const u = USERS.find((x) => x.id === mark.u);
    const nota =
      k === "audio"
        ? "La marca de audio identifica la cuenta, no el archivo ni la hora: revisa en la auditoría qué audios escuchó esa cuenta."
        : "La marca coincide con una entrega de la consola: cuenta, evidencia y hora de la copia.";
    return {
      detected: true,
      kind: k,
      score: k === "audio" ? 0.97 : 0.93,
      candidates: [
        {
          user_id: mark.u,
          email_or_name: u?.email ?? mark.u,
          display_name: u?.display_name ?? null,
          role: u?.role ?? null,
          evidence_label: k === "imagen" ? mark.e : null,
          case_id: k === "imagen" ? mark.c : null,
          issued_at: mark.t,
          bit_accuracy: k === "audio" ? 1 : 0.98,
        },
      ],
      ambiguo: false,
      nota: `${nota} ${NOTA_RASTREO}`,
      model,
    };
  }
}
