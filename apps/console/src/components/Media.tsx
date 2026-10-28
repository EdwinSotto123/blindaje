import { useEffect, useRef, useState } from "react";
import type { AudioFragment } from "../api/types";
import { useApi } from "../app/context";
import { fmtDuration } from "../lib/format";
import { CitedText } from "./Citations";
import { Icon } from "./Icons";
import { ErrorBox } from "./ui";

type MediaState = { status: "idle" } | { status: "loading" } | { status: "ready"; url: string } | { status: "error"; error: unknown };

/** Descarga un medio protegido (requiere Authorization) como Blob y lo expone como object URL. */
function useProtectedMedia() {
  const api = useApi();
  const [state, setState] = useState<MediaState>({ status: "idle" });
  const url = state.status === "ready" ? state.url : null;
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  const load = async (mediaUrl: string, range?: { start_ms: number; end_ms: number }) => {
    setState({ status: "loading" });
    try {
      const blob = await api.fetchMedia(mediaUrl, range);
      setState({ status: "ready", url: URL.createObjectURL(blob) });
    } catch (error) {
      setState({ status: "error", error });
    }
  };
  return { state, load };
}

/**
 * Reproductor de un fragmento de audio. El audio se descarga solo cuando el revisor lo pide
 * (cada acceso queda en la auditoría). Si la API devolviera el audio completo en vez del recorte,
 * el reproductor salta al inicio del rango y se detiene al final.
 */
export function AudioClip({ fragment, onListened }: { fragment: AudioFragment; onListened?: () => void }) {
  const { state, load } = useProtectedMedia();
  const audioRef = useRef<HTMLAudioElement>(null);
  const untrimmed = useRef(false);
  const span = fragment.end_ms - fragment.start_ms;

  useEffect(() => {
    if (state.status === "ready") {
      audioRef.current?.play().catch(() => undefined);
    }
  }, [state.status]);

  return (
    <div className="audio-clip">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 6 }}>
          <Icon name="mic" size={16} />
          <CitedText text={`${fragment.evidence_label} · ${fragment.voice_label}`} />
        </span>
        <span className="small muted">
          {fmtDuration(fragment.start_ms)} a {fmtDuration(fragment.end_ms)} ({Math.round(span / 100) / 10} s)
        </span>
      </div>
      {fragment.text ? <p className="transcript">“{fragment.text}”</p> : null}
      {state.status === "ready" ? (
        <audio
          ref={audioRef}
          controls
          preload="auto"
          src={state.url}
          aria-label={`Fragmento de ${fragment.evidence_label}, huella ${fragment.voice_label}`}
          onPlay={onListened}
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (Number.isFinite(a.duration) && a.duration > span / 1000 + 1.5) {
              untrimmed.current = true;
              a.currentTime = fragment.start_ms / 1000;
            }
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            if (untrimmed.current && a.currentTime >= fragment.end_ms / 1000) {
              a.pause();
              a.currentTime = fragment.start_ms / 1000;
            }
          }}
        />
      ) : state.status === "error" ? (
        <ErrorBox error={state.error} onRetry={() => void load(fragment.media_url, { start_ms: fragment.start_ms, end_ms: fragment.end_ms })} />
      ) : (
        <span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={state.status === "loading"}
            onClick={() => void load(fragment.media_url, { start_ms: fragment.start_ms, end_ms: fragment.end_ms })}
          >
            <Icon name="play" size={14} />
            {state.status === "loading" ? "Descargando…" : "Escuchar fragmento"}
          </button>
        </span>
      )}
    </div>
  );
}

/** Imagen redactada de una evidencia (rostros y datos de terceros tapados por la API). */
export function EvidenceImage({ evidenceId, label }: { evidenceId: string; label: string }) {
  const { state, load } = useProtectedMedia();
  const mediaUrl = `/v1/console/evidence/${encodeURIComponent(evidenceId)}/media`;
  if (state.status === "ready") {
    return <img src={state.url} alt={`Imagen redactada de ${label}`} style={{ maxWidth: "100%", borderRadius: 10, border: "1.5px solid var(--borde)" }} />;
  }
  if (state.status === "error") return <ErrorBox error={state.error} onRetry={() => void load(mediaUrl)} />;
  return (
    <span>
      <button type="button" className="btn btn-sm" disabled={state.status === "loading"} onClick={() => void load(mediaUrl)}>
        <Icon name="image" size={14} />
        {state.status === "loading" ? "Descargando…" : "Ver imagen redactada"}
      </button>
    </span>
  );
}
