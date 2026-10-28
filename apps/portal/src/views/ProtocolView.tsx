import { useMe } from "../app/context";
import { CallButtons } from "../components/CallButtons";
import { PageHead, Section } from "../components/ui";

/** El protocolo, un paso por renglón. Nunca pagar ni negociar; siempre hacia los canales oficiales. */
export const PROTOCOLO: { paso: string; detalle: string }[] = [
  { paso: "No pagues ni negocies.", detalle: "No respondas ni discutas montos. Cualquier respuesta les dice que pueden presionarte." },
  { paso: "Guarda todo.", detalle: "Los audios, las capturas, el número que te escribió y la hora. No borres el chat." },
  { paso: "Si hay peligro, llama al 105.", detalle: "Si alguien está en tu local o cerca de tu casa, no esperes." },
  { paso: "Denuncia.", detalle: "Llama a la Línea 1818 o ve a tu comisaría. Lleva lo que guardaste." },
  { paso: "Avisa a tu gremio.", detalle: "Así pueden alertar a otros negocios de la zona sin decir quién eres." },
  { paso: "Cuida a tu personal.", detalle: "Que nadie atienda esos mensajes por su cuenta: acuerden que todo te llega a ti." },
];

export function ProtocolView() {
  const me = useMe();
  return (
    <>
      <PageHead title="Qué hacer si te pasa" margin="Si te pasa">
        <p>Si te llega un audio, un mensaje o una visita que te pide dinero, sigue estos pasos en orden.</p>
      </PageHead>

      <CallButtons large />

      <Section id="pasos" title="Paso a paso" margin="Protocolo">
        <ol className="protocol">
          {PROTOCOLO.map((p) => (
            <li key={p.paso}>
              <p className="protocol-step">{p.paso}</p>
              <p>{p.detalle}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="sumate" title="Súmate a Blindaje con tu gremio" margin="Blindaje">
        <div className="measure stack-sm">
          <p className="body-l">
            Blindaje tiene una app para guardar las pruebas sin que se note y armar tu denuncia. Se ve como una app común de negocio, y tú eliges cuál.
          </p>
          <p>
            Para instalarla, pide un código de invitación a {me.org.name}: tu gremio te explica cómo empezar. Tú decides si tu caso se suma a la red del
            gremio o queda solo para tu denuncia.
          </p>
        </div>
      </Section>
    </>
  );
}
