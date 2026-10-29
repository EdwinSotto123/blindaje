import { COUNT_BANDS } from "@blindaje/shared";
import { PageHead, Section } from "../components/ui";
import { MIN_CASES, MIN_VICTIMS } from "../config";

const PUNTOS: { id: string; titulo: string; texto: string }[] = [
  {
    id: "distrito",
    titulo: "Hasta el distrito, nunca una vivienda",
    texto:
      "El mapa y las cifras llegan hasta el distrito. No hay calles, direcciones, viviendas, coordenadas ni puntos en un mapa. El mapa es un esquema de cuadros: muestra dónde queda cada distrito, no dónde pasó nada.",
  },
  {
    id: "rangos",
    titulo: "Rangos, no cifras exactas",
    texto: `Ves ${COUNT_BANDS.join(", ")} casos, nunca la cifra exacta. Tampoco hay un total de la ciudad ni del distrito junto a las cifras por partes: con un total y sus partes, una resta revelaría lo que se oculta.`,
  },
  {
    id: "umbral",
    titulo: `Datos solo con ${MIN_CASES} casos de ${MIN_VICTIMS} personas`,
    texto: `Un distrito, un rubro, una semana o una modalidad con menos de ${MIN_CASES} casos de ${MIN_VICTIMS} personas distintas aparece como “sin datos”, igual que uno sin casos. No hay un cubo de “otros” que los sume. Así nadie puede ser reconocido por descarte.`,
  },
  {
    id: "sesgo",
    titulo: "Más casos no siempre es más peligro",
    texto:
      "Más casos en un distrito puede significar que ahí se denuncia más, o que más personas conocen Blindaje. Solo cuentan los casos que las personas aceptaron compartir con la comunidad, y muchos casos nunca se denuncian. No uses el mapa para comparar barrios.",
  },
  {
    id: "buscador",
    titulo: "No hay buscador de números",
    texto: "Si existiera, alguien que extorsiona podría usarlo para saber si su número ya está marcado. Por eso no lo hay, ni para ti ni para nadie.",
  },
  {
    id: "revision",
    titulo: "Una persona revisa cada aviso y cada consejo",
    texto:
      "Los consejos los escribe un asistente de inteligencia artificial de Blindaje con estos datos agregados. Antes de publicarlos, una persona del equipo de Blindaje los lee y los aprueba. Lo mismo con los avisos.",
  },
  {
    id: "cuenta",
    titulo: "Sin cuenta y sin rastreo",
    texto:
      "No necesitas cuenta. Tu distrito y tu rubro van solo en la dirección de la página: el portal no los guarda. “Salir rápido” abre una página neutra y reemplaza esta.",
  },
];

const NO_HACE = [
  "No reemplaza a la policía ni a la fiscalía.",
  "Nunca te aconsejará pagar ni negociar.",
  "No publica nombres, números, cuentas, direcciones ni coordenadas.",
  "No muestra casos uno por uno ni nada más fino que un distrito.",
];

export function DataView() {
  return (
    <>
      <PageHead title="Cómo leer los datos" margin="Datos">
        <p>Lo que ves aquí sirve para prevenir sin exponer a nadie. Así se calcula y estas son las reglas.</p>
      </PageHead>

      <Section id="reglas" title="Las reglas del portal" margin="Reglas">
        <dl className="rules">
          {PUNTOS.map((p) => (
            <div key={p.id} className="rule">
              <dt>{p.titulo}</dt>
              <dd>{p.texto}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="nivel" title="Cómo se calcula el nivel" margin="Nivel">
        <div className="measure stack-sm">
          <p>
            Cuentan los casos de los últimos 28 días. Si el distrito no llega al mínimo, el nivel es “sin datos”. Si llega, suma un punto por 8 casos o
            más, otro por 15 o más, uno si hubo intimidación en persona y uno si hay una modalidad activa. Sin puntos es bajo; con 1 o 2, medio; con 3 o
            más, alto.
          </p>
          <p>Los avisos y consejos los aprueba el equipo de Blindaje para cada distrito. No hace falta pertenecer a ninguna organización para verlos.</p>
        </div>
      </Section>

      <Section id="no-hace" title="Lo que Blindaje no hace" margin="Límites">
        <ul className="bullets measure">
          {NO_HACE.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>

      <Section id="demo" title="Datos de esta demostración" margin="Demo">
        <p className="measure">
          Blindaje es un prototipo. Los distritos son reales, pero todo lo demás es ficticio: los casos, los rangos, “Los X”, los negocios, los avisos y
          los consejos.
        </p>
      </Section>
    </>
  );
}
