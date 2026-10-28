import { decodeMaskToRaster } from "@meta-sam/parser";
import { MetaOutputError } from "./errors";

/**
 * Lectura de la salida de SAM 3.1. La gramática (docs/sam/reading-segmentation):
 *
 *   line   ::= "<" N "f>" record ("," record)*
 *   record ::= ID "<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|>" "<|mask;x=0;y=0[;c=..];data=H,W,<enc>payload|>"
 *
 * El texto llega en el carril `output_text`, una línea por frame. Los ids de objeto son estables
 * entre frames pero no densos. Las coordenadas de la caja son inclusivas, en píxeles de la
 * fuente, y la máscara es un raster H×W recortado a la caja (su esquina es x1,y1). La carga va
 * en base85 (no base64) con un códec propio: para decodificarla usamos `decodeMaskToRaster` de
 * `@meta-sam/parser` (ESM puro, sin dependencias ni APIs de Node: corre en Workers).
 *
 * El parseo de líneas es propio para conservar el token crudo de la máscara tal como llegó.
 */

export interface SamBox {
  x1: number;
  y1: number;
  /** Inclusivo. */
  x2: number;
  /** Inclusivo. */
  y2: number;
  /** Ancho de la imagen o frame de origen. */
  w: number;
  /** Alto de la imagen o frame de origen. */
  h: number;
}

export interface SamObject {
  id: number;
  box: SamBox;
  confidence?: number;
  /** Token crudo de la máscara tal como llegó: `<|mask;x=0;y=0;data=H,W,~…|>`. */
  mask: string;
}

export interface SamFrame {
  frame: number;
  objects: SamObject[];
}

export interface SamParseResult {
  frames: SamFrame[];
  /** Fragmentos que no se pudieron leer (se omiten, no se adivinan). */
  problems: string[];
}

const FRAME_SPLIT = /(?=<\d+f>)/;
const FRAME_HEADER = /^<(\d+)f>/;
const RECORD = /,?(\d+)((?:<\|[^|]*\|>)+)/y;
const TOKEN = /<\|([A-Za-z][A-Za-z0-9_.-]*)((?:;[^|]*)?)\|>/g;

function fieldsOf(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of body.split(";")) {
    const field = part.trim();
    if (!field) continue;
    const eq = field.indexOf("=");
    if (eq > 0) fields.set(field.slice(0, eq).trim(), field.slice(eq + 1).trim());
  }
  return fields;
}

const int = (v: string | undefined): number | null => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : null);

function readBox(fields: Map<string, string>): SamBox | null {
  const x1 = int(fields.get("x1"));
  const y1 = int(fields.get("y1"));
  const x2 = int(fields.get("x2"));
  const y2 = int(fields.get("y2"));
  const w = int(fields.get("w"));
  const h = int(fields.get("h"));
  if (x1 === null || y1 === null || x2 === null || y2 === null || w === null || h === null) return null;
  return { x1, y1, x2, y2, w, h };
}

function confidenceOf(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/** Parsea el texto completo de una respuesta SAM (una o varias líneas `<Nf>…`). */
export function parseSamOutput(text: string): SamParseResult {
  const byFrame = new Map<number, SamObject[]>();
  const problems: string[] = [];
  for (const chunk of text.split(FRAME_SPLIT)) {
    const line = chunk.trim();
    if (!line) continue;
    const header = FRAME_HEADER.exec(line);
    if (!header) {
      problems.push(line.slice(0, 120));
      continue;
    }
    const frame = Number(header[1]);
    const body = line.slice(header[0].length);
    const objects = byFrame.get(frame) ?? [];
    RECORD.lastIndex = 0;
    let position = 0;
    while (position < body.length) {
      RECORD.lastIndex = position;
      const record = RECORD.exec(body);
      if (!record) {
        problems.push(body.slice(position, position + 120));
        break;
      }
      position = RECORD.lastIndex;
      const id = Number(record[1]);
      let box: SamBox | null = null;
      let mask: string | null = null;
      let confidence: number | undefined;
      for (const token of (record[2] ?? "").matchAll(TOKEN)) {
        const fields = fieldsOf(token[2] ?? "");
        if (token[1] === "box") {
          box = readBox(fields);
          confidence ??= confidenceOf(fields.get("c"));
        } else if (token[1] === "mask") {
          if (/^\d+,\d+,[!~]/.test(fields.get("data") ?? "")) mask = token[0];
          confidence ??= confidenceOf(fields.get("c"));
        }
      }
      if (!box || !mask) {
        problems.push(record[0].slice(0, 120));
        continue;
      }
      objects.push({ id, box, ...(confidence !== undefined ? { confidence } : {}), mask });
    }
    byFrame.set(frame, objects);
  }
  const frames = [...byFrame.entries()]
    .sort(([a], [b]) => a - b)
    .map(([frame, objects]) => ({ frame, objects }));
  return { frames, problems };
}

export interface ParsedMaskToken {
  height: number;
  width: number;
  encoding: "lossless" | "one_bit";
  payload: string;
  confidence?: number;
}

/** Lee un token de máscara `<|mask;x=0;y=0[;c=..];data=H,W,<enc>payload|>` (o solo su `data`). */
export function parseMaskToken(token: string): ParsedMaskToken {
  const inner = token.startsWith("<|") ? token.slice(2, token.endsWith("|>") ? -2 : undefined) : `mask;data=${token}`;
  const fields = fieldsOf(inner.replace(/^mask/, ""));
  const data = /^(\d+),(\d+),([!~][^|]*)$/.exec(fields.get("data") ?? "");
  if (!data) throw new MetaOutputError("invalid_json", "Token de máscara SAM inválido", { rawText: token.slice(0, 200) });
  const confidence = confidenceOf(fields.get("c"));
  return {
    height: Number(data[1]),
    width: Number(data[2]),
    encoding: data[3]?.startsWith("~") ? "lossless" : "one_bit",
    payload: data[3] ?? "",
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

export interface DecodedMask {
  /** Columnas del raster. */
  width: number;
  /** Filas del raster. */
  height: number;
  /** Raster binario fila por fila (0 o 1), largo width × height. */
  data: Uint8Array;
  /** Posición del raster en la imagen de origen (esquina superior izquierda de la caja). */
  left: number;
  top: number;
}

/** Decodifica la máscara de un objeto a un raster binario ubicado en la imagen de origen. */
export function decodeMask(object: Pick<SamObject, "box" | "mask">): DecodedMask {
  const token = parseMaskToken(object.mask);
  const data = decodeMaskToRaster({
    encoding: token.encoding,
    payload: token.payload,
    width: token.width,
    height: token.height,
  });
  return { width: token.width, height: token.height, data, left: object.box.x1, top: object.box.y1 };
}

export interface PixelBox {
  x1: number;
  y1: number;
  /** Inclusivo. */
  x2: number;
  /** Inclusivo. */
  y2: number;
}

/**
 * Caja ajustada a los píxeles encendidos de la máscara, en coordenadas de la imagen de origen.
 * Devuelve null si la máscara está vacía. Si las dimensiones del raster no coinciden con las de
 * la caja, se escala proporcionalmente.
 */
export function maskToBox(object: Pick<SamObject, "box" | "mask">): PixelBox | null {
  const mask = decodeMask(object);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] !== 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const sx = (object.box.x2 - object.box.x1 + 1) / mask.width;
  const sy = (object.box.y2 - object.box.y1 + 1) / mask.height;
  return {
    x1: object.box.x1 + Math.floor(minX * sx),
    y1: object.box.y1 + Math.floor(minY * sy),
    x2: object.box.x1 + Math.ceil((maxX + 1) * sx) - 1,
    y2: object.box.y1 + Math.ceil((maxY + 1) * sy) - 1,
  };
}

/** Agranda una caja un porcentaje por lado (útil para tapar rostros con margen), sin salir de la imagen. */
export function expandBox(box: SamBox, ratio = 0.15): SamBox {
  const dx = Math.round((box.x2 - box.x1 + 1) * ratio);
  const dy = Math.round((box.y2 - box.y1 + 1) * ratio);
  return {
    ...box,
    x1: Math.max(0, box.x1 - dx),
    y1: Math.max(0, box.y1 - dy),
    x2: Math.min(box.w - 1, box.x2 + dx),
    y2: Math.min(box.h - 1, box.y2 + dy),
  };
}

/**
 * Pixela en el lugar una región de un buffer RGBA (4 bytes por píxel, fila por fila). Con
 * `mask`, solo se pintan los bloques que tocan la máscara; sin ella, toda la caja.
 */
export function pixelateRGBA(
  rgba: Uint8Array | Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  region: PixelBox,
  blockSize = 16,
  mask?: DecodedMask,
): void {
  const x1 = Math.max(0, region.x1);
  const y1 = Math.max(0, region.y1);
  const x2 = Math.min(imageWidth - 1, region.x2);
  const y2 = Math.min(imageHeight - 1, region.y2);
  const inMask = (x: number, y: number): boolean => {
    if (!mask) return true;
    const mx = x - mask.left;
    const my = y - mask.top;
    return mx >= 0 && my >= 0 && mx < mask.width && my < mask.height && mask.data[my * mask.width + mx] === 1;
  };
  for (let by = y1; by <= y2; by += blockSize) {
    for (let bx = x1; bx <= x2; bx += blockSize) {
      const ex = Math.min(bx + blockSize - 1, x2);
      const ey = Math.min(by + blockSize - 1, y2);
      let touches = false;
      const sum = [0, 0, 0, 0];
      let count = 0;
      for (let y = by; y <= ey; y++) {
        for (let x = bx; x <= ex; x++) {
          if (inMask(x, y)) touches = true;
          const i = (y * imageWidth + x) * 4;
          for (let c = 0; c < 4; c++) sum[c]! += rgba[i + c] ?? 0;
          count++;
        }
      }
      if (!touches || count === 0) continue;
      const avg = sum.map((s) => Math.round(s / count));
      for (let y = by; y <= ey; y++) {
        for (let x = bx; x <= ex; x++) {
          const i = (y * imageWidth + x) * 4;
          for (let c = 0; c < 4; c++) rgba[i + c] = avg[c] ?? 0;
        }
      }
    }
  }
}
