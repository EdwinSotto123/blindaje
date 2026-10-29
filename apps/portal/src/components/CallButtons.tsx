import { Icon } from "./Icons";

/** Los dos canales oficiales, como enlaces que llaman desde el celular. */
export function CallButtons({ large = false }: { large?: boolean }) {
  return (
    <ul className={`calls${large ? " calls-large" : ""}`}>
      <li>
        <a className="call call-105" href="tel:105">
          <span className="call-when">Si estás en peligro ahora</span>
          <span className="call-number">
            <Icon name="phone" size={large ? 28 : 22} />
            105
          </span>
          <span className="call-who">Policía Nacional, emergencias</span>
        </a>
      </li>
      <li>
        <a className="call call-1818" href="tel:1818">
          <span className="call-when">Para denunciar una extorsión</span>
          <span className="call-number">
            <Icon name="phone" size={large ? 28 : 22} />
            1818
          </span>
          <span className="call-who">Línea 1818, Central Única de Denuncias del Mininter</span>
        </a>
      </li>
    </ul>
  );
}
