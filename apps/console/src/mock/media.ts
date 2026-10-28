/**
 * Medios sintéticos para el modo simulado. No hay grabaciones reales: los "audios" son tonos con
 * envolvente de sílabas (una frecuencia por huella, así V-3 y V-7 suenan parecido y V-9 distinto),
 * las imágenes son ilustraciones vectoriales neutras y el PDF es un expediente de texto mínimo.
 */

const VOICE_PITCH: Record<string, number> = { "V-3": 128, "V-7": 131, "V-9": 205 };

/** WAV mono PCM16 de 8 kHz. */
export function synthVoiceWav(voiceLabel: string, durationMs: number, seed = 1): Blob {
  const rate = 8000;
  const n = Math.max(1, Math.round((Math.min(durationMs, 15_000) / 1000) * rate));
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);

  const f0 = VOICE_PITCH[voiceLabel] ?? 160;
  let rng = seed * 9301 + 49297;
  const rand = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };
  const syllable = 0.18 + rand() * 0.06;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const phase = (t % syllable) / syllable;
    const env = Math.sin(Math.PI * phase) ** 2 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t));
    const vibr = 1 + 0.03 * Math.sin(2 * Math.PI * 5 * t);
    const s =
      0.55 * Math.sin(2 * Math.PI * f0 * vibr * t) +
      0.25 * Math.sin(2 * Math.PI * 2 * f0 * vibr * t) +
      0.12 * Math.sin(2 * Math.PI * 3 * f0 * vibr * t);
    v.setInt16(44 + i * 2, Math.round(s * env * 0.5 * 32767), true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export function synthImageSvg(title: string, caption: string): Blob {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
<defs><pattern id="g" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#E3EBF5"/></pattern></defs>
<rect width="480" height="300" fill="#FBFCFE"/><rect width="480" height="300" fill="url(#g)"/>
<rect x="40" y="40" width="400" height="170" rx="10" fill="#DCE6F2" stroke="#C9D6E6"/>
<rect x="70" y="70" width="120" height="110" rx="6" fill="#1E3A70" opacity=".85"/>
<text x="130" y="132" font-family="sans-serif" font-size="13" fill="#FFFFFF" text-anchor="middle">tapado</text>
<path d="M260 150h120M290 120h60" stroke="#4A5B7A" stroke-width="6" stroke-linecap="round"/>
<text x="240" y="245" font-family="sans-serif" font-size="17" font-weight="700" fill="#1E3A70" text-anchor="middle">${esc(title)}</text>
<text x="240" y="270" font-family="sans-serif" font-size="13" fill="#4A5B7A" text-anchor="middle">${esc(caption)}</text>
</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

/** Reemplaza lo que no entra en Latin-1 (WinAnsi) por equivalentes ASCII. */
function latin1(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\xFF]/g, "?");
}

/** PDF 1.4 mínimo y válido, con una página de texto en Helvetica. */
export function buildPdf(lines: string[]): Uint8Array {
  const escapePdf = (s: string) => latin1(s).replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 11 Tf",
    "14 TL",
    "56 790 Td",
    ...lines.map((l, i) => (i === 0 ? `/F1 15 Tf (${escapePdf(l)}) Tj T* /F1 11 Tf T*` : `(${escapePdf(l)}) Tj T*`)),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

export async function sha256Hex(data: BufferSource | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
