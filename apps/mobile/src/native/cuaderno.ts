import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/**
 * Puente con el módulo nativo local `modules/cuaderno-nativo` (solo Android): el filtro de llamadas
 * y el widget de la pantalla de inicio. En iOS, en jest o en un build sin el módulo, todo responde
 * "no disponible" y la app sigue igual.
 */
export type ModoLlamadas = "desconocidos" | "marcados";
export type AccionMarcados = "sonar" | "silenciar" | "rechazar";

export type AjustesLlamadas = {
  activo: boolean;
  /** desconocidos: anota toda llamada de un número que no está en los contactos. marcados: solo los marcados. */
  modo: ModoLlamadas;
  /** Qué hacer cuando vuelve a llamar un número marcado como extorsión. */
  accion: AccionMarcados;
  /** Números marcados, normalizados (normalizarNumero). Se guardan cifrados en el celular. */
  marcados: string[];
};

export type LlamadaAnotada = {
  id: string;
  /** null: número oculto. */
  numero: string | null;
  /** Epoch en ms. */
  recibida: number;
  /** Era un número que la persona ya había marcado. */
  marcado: boolean;
  /** Lo que hizo el filtro con la llamada. */
  accion: AccionMarcados;
};

export interface CuadernoNativo {
  llamadasDisponible(): boolean;
  rolActivo(): boolean;
  pedirRol(): Promise<boolean>;
  leerAjustes(): AjustesLlamadas;
  guardarAjustes(a: AjustesLlamadas): void;
  listarLlamadas(): LlamadaAnotada[];
  borrarLlamadas(ids: string[]): void;
  borrarTodo(): void;
  abrirAjustesDelTelefono(): void;
  actualizarWidget(disfraz: string): void;
}

let modulo: CuadernoNativo | null = Platform.OS === "android" ? requireOptionalNativeModule<CuadernoNativo>("CuadernoNativo") : null;

/** Solo para tests. */
export function setCuadernoNativoForTests(m: CuadernoNativo | null): void {
  modulo = m;
}

export function cuadernoNativo(): CuadernoNativo | null {
  return modulo;
}

/** Redibuja el widget con el disfraz elegido. Nunca falla. */
export function actualizarWidget(disfraz: string): void {
  try {
    modulo?.actualizarWidget(disfraz);
  } catch {
    // sin widget en la pantalla de inicio o sin módulo
  }
}
