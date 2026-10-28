import { PageHead, Section } from "../components/ui";

const PUNTOS: { id: string; titulo: string; texto: string }[] = [
  {
    id: "agregado",
    titulo: "Solo ves cifras de grupo",
    texto: "Aquí no hay nombres, números de teléfono, cuentas ni placas: ni de las víctimas ni de quien extorsiona. Solo cuántos casos hay y cómo operan.",
  },
  {
    id: "buscador",
    titulo: "No hay buscador de números",
    texto: "Si existiera, alguien que extorsiona podría usarlo para saber si su número ya está marcado. Por eso no lo hay, ni para ti ni para nadie.",
  },
  {
    id: "umbral",
    titulo: "Cifras solo con 5 casos de 3 personas",
    texto: "Si una zona o un sector tiene menos, verás “Aún no hay suficientes casos para mostrar cifras”. Así nadie puede ser reconocido por descarte.",
  },
  {
    id: "sesgo",
    titulo: "Más casos no siempre es más peligro",
    texto: "Más casos en una zona puede significar que ahí se denuncia más, o que su gremio usa más Blindaje. No compares barrios con estas cifras.",
  },
  {
    id: "revision",
    titulo: "Una persona revisa cada recomendación",
    texto: "Las recomendaciones las escribe un asistente de inteligencia artificial de Blindaje con estos datos agregados. Antes de que lleguen aquí, una persona de tu gremio las lee y las aprueba.",
  },
  {
    id: "cuenta",
    titulo: "Tu cuenta",
    texto: "Tu gremio crea tu cuenta. Tu sesión se guarda solo en esta pestaña: al cerrarla, se cierra. “Salir rápido” la cierra al instante.",
  },
];

const NO_HACE = [
  "No reemplaza a la policía ni a la fiscalía.",
  "Nunca te aconsejará pagar ni negociar.",
  "No identifica personas ni publica mapas o datos abiertos.",
  "No te muestra los casos de otros negocios.",
];

export function DataView() {
  return (
    <>
      <PageHead title="Cómo cuidamos los datos" margin="Tus datos">
        <p>Lo que ves aquí sirve para prevenir sin exponer a nadie. Estas son las reglas.</p>
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

      <Section id="no-hace" title="Lo que Blindaje no hace" margin="Límites">
        <ul className="bullets measure">
          {NO_HACE.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>

      <Section id="demo" title="Datos de esta demostración" margin="Demo">
        <p className="measure">
          Blindaje es un prototipo. Todo lo que ves en este portal es ficticio: Lima Este, “Los X”, los negocios, los gremios y las cifras.
        </p>
      </Section>
    </>
  );
}
