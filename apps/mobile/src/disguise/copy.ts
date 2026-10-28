/**
 * Todos los textos visibles del disfraz (cuaderno, lista, calculadora y su teclado).
 * test/disguise-words.test.ts recorre este objeto y las pantallas renderizadas contra
 * DISGUISE_FORBIDDEN_WORDS: aquí nunca aparece nada que delate las notas privadas.
 */
export const disguiseCopy = {
  app: { name: "Cuaderno" },
  cuaderno: {
    title: "Cuaderno",
    titleHint: "Cuaderno de ventas",
    ventasHoy: "Ventas de hoy",
    fiadosPorCobrar: "Fiados por cobrar",
    tabVentas: "Ventas",
    tabFiados: "Fiados",
    anotarVenta: "Anotar venta",
    anotarFiado: "Anotar fiado",
    vacioVentas: "Todavía no anotas ventas hoy.",
    vacioFiados: "No hay fiados pendientes.",
    pagado: "Pagado",
    marcarPagado: "Marcar como pagado",
    menu: "Menú",
    menuVuelto: "Calcular vuelto",
    menuCerrar: "Cerrar menú",
    borrarVenta: "Borrar venta",
    borrarConfirm: "¿Borrar esta venta?",
    borrar: "Borrar",
    cancelar: "Cancelar",
  },
  anotar: {
    tituloVenta: "Anotar venta",
    tituloFiado: "Anotar fiado",
    que: "¿Qué vendiste?",
    quePlaceholder: "Ej.: 2 leches",
    monto: "Monto",
    montoPlaceholder: "0.00",
    montoHint: "En soles, por ejemplo 7.50",
    quien: "¿A quién?",
    quienPlaceholder: "Ej.: Sra. Rosa",
    queFiado: "¿Qué se llevó?",
    guardar: "Guardar",
    volver: "Volver",
    errorMonto: "Escribe un monto, por ejemplo 7.50",
    errorTexto: "Escribe qué vendiste",
    errorNombre: "Escribe a quién le fiaste",
  },
  lista: {
    title: "Lista",
    titleHint: "Lista de compras",
    subtitulo: "Para el mercado",
    agregar: "Agregar",
    producto: "Producto",
    productoPlaceholder: "Ej.: Arroz 5 kg",
    precio: "Precio (opcional)",
    vacio: "Tu lista está vacía.",
    total: "Total estimado",
    limpiar: "Quitar lo comprado",
    marcar: "Marcar como comprado",
    desmarcar: "Marcar como pendiente",
    quitar: "Quitar",
  },
  vueltos: {
    title: "Vuelto",
    titleHint: "Calculadora de vueltos",
    total: "Total",
    pago: "Pagó con",
    vuelto: "Vuelto",
    falta: "Falta",
    calcular: "Calcular",
    borrar: "Borrar",
    limpiar: "Limpiar",
    ultimos: "Últimos vueltos",
    vacio: "Aquí aparecen tus últimos vueltos.",
    volver: "Volver al cuaderno",
    tocaCampo: "Toca un campo para escribir en él",
    punto: "Punto",
  },
  disfraces: {
    cuaderno: "Cuaderno de ventas",
    lista: "Lista de compras",
    vueltos: "Calculadora de vueltos",
  },
  privacidad: {
    // Pantalla neutra que se ve en el selector de apps.
    cubierta: "Cuaderno",
  },
} as const;

/** Recorre un objeto de textos y devuelve todas las cadenas. */
export function allStrings(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  if (obj && typeof obj === "object") return Object.values(obj).flatMap(allStrings);
  return [];
}
