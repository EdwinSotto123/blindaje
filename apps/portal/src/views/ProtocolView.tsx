import { CallButtons } from "../components/CallButtons";
import { PageHead, Section } from "../components/ui";

/** El protocolo, un paso por renglón. Nunca pagar ni negociar; siempre hacia los canales oficiales. */
export const PROTOCOLO: { paso: string; detalle: string }[] = [
  { paso: "No pagues ni negocies.", detalle: "No respondas ni discutas montos. Cualquier respuesta les dice que pueden presionarte." },
  { paso: "Guarda todo.", detalle: "Los audios, las capturas, el número que te escribió y la hora. No borres el chat." },
  { paso: "Si hay peligro, llama al 105.", detalle: "Si alguien está en tu local o cerca de tu casa, no esperes." },
  { paso: "Denuncia.", detalle: "Llama a la Línea 1818 o ve a tu comisaría. Lleva lo que guardaste." },
  {
    paso: "Registra tu caso en Blindaje.",
    detalle: "Si aceptas compartirlo, se suma al mapa de tu distrito y ayuda a alertar a otros, sin decir quién eres ni dónde vives.",
  },
  { paso: "Cuida a tu familia y a tu personal.", detalle: "Que nadie atienda esos mensajes por su cuenta: acuerden que todo te llega a ti." },
];

export function ProtocolView() {
  return (
    <>
      <PageHead title="Qué hacer si te pasa">
        <p>Si te llega un audio, un mensaje o una visita que te pide dinero, sigue estos pasos en orden.</p>
      </PageHead>

      <CallButtons large />

      <Section id="pasos" title="Paso a paso">
        <ol className="protocol">
          {PROTOCOLO.map((p) => (
            <li key={p.paso}>
              <p className="protocol-step">{p.paso}</p>
              <p>{p.detalle}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="app" title="Guarda las pruebas con la app de Blindaje">
        <div className="measure stack-sm">
          <p className="body-l">
            Blindaje tiene una app para guardar las pruebas sin que se note y armar tu denuncia. Se ve como una app común de negocio, y tú eliges cuál.
          </p>
          <p>
            No necesitas código ni pertenecer a ninguna organización: la instalas, eliges tu distrito y empiezas. Tú decides si tu caso se suma al mapa de
            tu distrito o queda solo para tu denuncia. El equipo de Blindaje revisa los casos; nunca publica tu nombre, tu número ni tu dirección.
          </p>
        </div>
      </Section>
    </>
  );
}
