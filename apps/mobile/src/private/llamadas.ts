import * as DocumentPicker from "expo-document-picker";

import { fullDateTime } from "@/lib/format";
import { utf8 } from "@/lib/bytes";
import { type AjustesLlamadas, cuadernoNativo, type LlamadaAnotada } from "@/native/cuaderno";
import { saveBytes, saveFile } from "@/private/data";
import { endExternal, expectExternal, isDecoy } from "@/state/session";

/**
 * Llamadas (solo Android 10+, opt-in). El filtro nativo anota las llamadas de números que no están
 * en los contactos; aquí la persona las revisa:
 *  - "Fue extorsión": se guarda como nota de su denuncia (texto, y la grabación si la adjunta), por
 *    la cola cifrada de siempre, y el número queda marcado.
 *  - "No era": se borra del celular. Nunca se sube.
 * Lo que no revisa se borra solo a los 30 días (lo hace el módulo nativo). En modo señuelo no se
 * lee ni se muestra nada.
 */
export const AJUSTES_INICIALES: AjustesLlamadas = { activo: false, modo: "desconocidos", accion: "sonar", marcados: [] };

export type EstadoLlamadas = {
  /** El celular permite el filtro (Android 10+ y la app tiene el módulo). */
  disponible: boolean;
  /** Cuaderno es la app de identificación de llamadas. */
  rol: boolean;
  ajustes: AjustesLlamadas;
  llamadas: LlamadaAnotada[];
};

export function leerEstado(): EstadoLlamadas {
  const n = cuadernoNativo();
  if (!n || isDecoy()) return { disponible: false, rol: false, ajustes: AJUSTES_INICIALES, llamadas: [] };
  try {
    const disponible = n.llamadasDisponible();
    const rol = disponible && n.rolActivo();
    return { disponible, rol, ajustes: { ...AJUSTES_INICIALES, ...n.leerAjustes() }, llamadas: rol ? n.listarLlamadas() : [] };
  } catch {
    return { disponible: false, rol: false, ajustes: AJUSTES_INICIALES, llamadas: [] };
  }
}

/** Cuántas llamadas esperan revisión (para el aviso en las notas privadas). */
export function porRevisar(): number {
  const e = leerEstado();
  return e.rol && e.ajustes.activo ? e.llamadas.length : 0;
}

/**
 * Pide a Android que Cuaderno sea la app de identificación de llamadas y, si la persona acepta,
 * enciende el filtro. El diálogo del sistema no debe bloquear las notas.
 */
export async function activar(): Promise<boolean> {
  const n = cuadernoNativo();
  if (!n || isDecoy()) return false;
  expectExternal(60_000);
  try {
    const ok = await n.pedirRol();
    if (ok) n.guardarAjustes({ ...leerEstado().ajustes, activo: true });
    return ok;
  } finally {
    endExternal();
  }
}

export function guardarAjustes(patch: Partial<AjustesLlamadas>): AjustesLlamadas {
  const n = cuadernoNativo();
  const next = { ...leerEstado().ajustes, ...patch };
  if (n && !isDecoy()) n.guardarAjustes(next);
  return next;
}

/** Quita a Cuaderno de los ajustes del teléfono (la persona lo hace allí; Android no deja hacerlo desde la app). */
export function abrirAjustesDelTelefono(): void {
  expectExternal(120_000);
  cuadernoNativo()?.abrirAjustesDelTelefono();
}

/**
 * Solo dígitos, sin el código de país de Perú (51) ni el 0 de larga distancia: "+51 987 654 321"
 * y "987654321" son el mismo número. Igual que Registro.normalizar() en Kotlin.
 */
export function normalizarNumero(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0051")) d = d.slice(4);
  else if (d.startsWith("51") && d.length >= 10) d = d.slice(2);
  d = d.replace(/^0+/, "");
  return d.length < 6 ? null : d;
}

/** "987 654 321", "(01) 234 5678" o el número tal cual. null: "Número oculto". */
export function mostrarNumero(raw: string | null | undefined): string {
  if (!raw) return "Número oculto";
  const n = normalizarNumero(raw);
  if (n && n.length === 9 && n.startsWith("9")) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (n && n.length === 8 && n.startsWith("1")) return `(01) ${n.slice(1, 4)} ${n.slice(4)}`;
  return raw.trim();
}

/** El número como lo leen la policía y el equipo central: con el código de Perú si es de aquí. */
function numeroParaDenuncia(raw: string): string {
  const n = normalizarNumero(raw);
  if (n && n.length === 9 && n.startsWith("9")) return `+51 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  return raw.trim();
}

/** Texto de la nota que se sube a la denuncia. Nunca incluye otras llamadas ni otros números. */
export function textoDeLlamada(l: LlamadaAnotada, comentario: string): string {
  const lineas = [
    l.numero
      ? `Llamada recibida el ${fullDateTime(l.recibida)} desde el número ${numeroParaDenuncia(l.numero)}.`
      : `Llamada recibida el ${fullDateTime(l.recibida)} desde un número oculto.`,
    "La marqué como extorsión.",
  ];
  if (l.accion === "silenciar") lineas.push("El número ya estaba marcado: la llamada entró en silencio.");
  if (l.accion === "rechazar") lineas.push("El número ya estaba marcado: la llamada se rechazó.");
  const c = comentario.trim();
  if (c) lineas.push(`Lo que me dijeron: ${c}`);
  return lineas.join("\n");
}

export type Grabacion = { uri: string; nombre: string; mime: string };

/** Abre el selector de archivos del sistema para elegir la grabación de la llamada. */
export async function elegirGrabacion(): Promise<Grabacion | null> {
  expectExternal();
  try {
    const r = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true, multiple: false });
    const a = r.canceled ? null : r.assets[0];
    if (!a) return null;
    return { uri: a.uri, nombre: a.name, mime: a.mimeType ?? "audio/mpeg" };
  } finally {
    endExternal();
  }
}

/**
 * "Fue extorsión": la llamada (y su grabación, si la hay) entra a la denuncia por la cola cifrada,
 * el número queda marcado y la llamada sale de la lista por revisar.
 */
export async function guardarComoExtorsion(l: LlamadaAnotada, comentario: string, grabacion: Grabacion | null): Promise<string | null> {
  const capturedAt = new Date(l.recibida).toISOString();
  // Primero la grabación: si no se puede leer, no queda la nota a medias y la llamada sigue en la lista.
  if (grabacion) await saveFile(grabacion.uri, { tipo: "audio", mime: grabacion.mime, source: "llamada", capturedAt });
  const texto = textoDeLlamada(l, comentario);
  const item = await saveBytes(utf8(texto), {
    tipo: "texto",
    mime: "text/plain; charset=utf-8",
    source: "llamada",
    capturedAt,
    preview: texto.slice(0, 120),
  });

  const n = cuadernoNativo();
  if (n && !isDecoy()) {
    const numero = normalizarNumero(l.numero);
    if (numero) {
      const ajustes = leerEstado().ajustes;
      if (!ajustes.marcados.includes(numero)) n.guardarAjustes({ ...ajustes, marcados: [...ajustes.marcados, numero] });
    }
    n.borrarLlamadas([l.id]);
  }
  return item?.id ?? null;
}

/** "No era": se borra del celular sin subir nada. */
export function descartar(id: string): void {
  cuadernoNativo()?.borrarLlamadas([id]);
}

/** Marca un número a mano (por ejemplo, el que escribió por WhatsApp). Devuelve null si no parece un número. */
export function marcarNumero(raw: string): string | null {
  const numero = normalizarNumero(raw);
  if (!numero) return null;
  const ajustes = leerEstado().ajustes;
  if (!ajustes.marcados.includes(numero)) guardarAjustes({ marcados: [...ajustes.marcados, numero] });
  return numero;
}

export function quitarMarca(numero: string): void {
  guardarAjustes({ marcados: leerEstado().ajustes.marcados.filter((m) => m !== numero) });
}
