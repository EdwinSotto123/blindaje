import { LINEA_DENUNCIAS, LINEA_EMERGENCIAS, type FichaStored } from "@blindaje/shared";

/**
 * Consejos de prevención para la víctima según SU propio caso (VictimReport.consejos).
 *
 * Reglas deterministas a partir de su ficha, sin modelo: nunca usan datos de otros casos, vínculos,
 * redes ni patrones de la zona. Siempre dicen "no pagues ni negocies" y nunca repiten números,
 * cuentas ni el nombre del grupo (la víctima ya los ve en su ficha).
 */

type FichaParaConsejos = Pick<
  FichaStored,
  "sector" | "tipo_amenaza" | "plazo" | "plazo_horas" | "canal_pago" | "escalamiento" | "frases_firma" | "grupo_que_dice_ser" | "periodicidad"
>;

const SIN_POLICIA = /(no|ni)\s+(llames|vayas|avises|digas)\s+(a\s+)?(la\s+)?(polic[ií]a|comisar[ií]a|tombos?|autoridad)/i;

export function consejosParaVictima(ficha: FichaParaConsejos | null): string[] {
  const out: string[] = [
    "No pagues ni negocies: un pago no detiene la extorsión y suele traer nuevos cobros.",
  ];
  const f = ficha;

  const fisico = Boolean(f && (f.escalamiento.length > 0 || f.tipo_amenaza === "dano_fisico" || f.tipo_amenaza === "dano_familia"));
  if (fisico) {
    out.push(
      `Tu caso ya incluye una amenaza o intimidación física: si te sientes en peligro, llama al ${LINEA_EMERGENCIAS} de inmediato y evita quedarte solo en el negocio.`,
    );
  }

  if (f?.plazo || f?.plazo_horas) {
    out.push(`No esperes a que venza el plazo que te dieron: denuncia antes en la Línea ${LINEA_DENUNCIAS} o en la comisaría más cercana.`);
  } else {
    out.push(`Denuncia en la Línea ${LINEA_DENUNCIAS} o en la comisaría más cercana. Blindaje te prepara la denuncia con tu evidencia.`);
  }

  if (f && f.frases_firma.some((x) => SIN_POLICIA.test(x))) {
    out.push("Aunque te digan que no avises a la policía, denunciar es tu derecho y es la forma de protegerte.");
  }

  out.push("Guarda en Blindaje cada audio, mensaje, llamada o foto que te manden, aunque te pidan borrarlos. No los reenvíes a desconocidos.");

  if (f?.canal_pago === "yape" || f?.canal_pago === "plin" || f?.canal_pago === "transferencia") {
    out.push("No hagas pagos de prueba ni compartas datos de tus cuentas o billeteras digitales con quien te escribe.");
  }

  if (f?.tipo_amenaza === "difusion_informacion") {
    out.push("Si amenazan con difundir información tuya, no respondas ni envíes nada: guarda la evidencia y denuncia.");
  }
  if (f?.tipo_amenaza === "dano_vehiculo" || f?.sector === "mototaxi" || f?.sector === "transporte") {
    out.push("Si trabajas en la calle, cambia tus rutas y horarios cuando puedas y cuéntale a alguien de confianza dónde estás.");
  }
  if (f?.sector === "bodega" || f?.sector === "mercado" || f?.sector === "restaurante") {
    out.push("Acuerda con tu personal y tu familia qué hacer si llaman o llega alguien a cobrar: no responder, no entregar nada y avisarte.");
  }

  out.push("Cuéntale a alguien de confianza lo que está pasando: no enfrentes esto solo ni sola.");
  out.push("Cuida lo que publica tu negocio en redes: horarios, fotos del local, del personal o de la caja dan información a quien extorsiona.");
  if (!fisico) out.push(`Si en algún momento te sientes en peligro, llama al ${LINEA_EMERGENCIAS}.`);
  return out;
}
