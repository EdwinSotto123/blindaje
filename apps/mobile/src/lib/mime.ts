import type { EvidenceType } from "@/shared";

export function evidenceTypeForMime(mime: string | null | undefined): EvidenceType {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "imagen";
  if (m.startsWith("video/")) return "video";
  return "texto";
}
