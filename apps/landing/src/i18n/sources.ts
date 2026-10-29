import type { Source } from "./types";

/** Fuentes de la sección 20 de docs/blindaje-inteligencia-comunitaria.md. Ninguna cifra sin una de estas. */
export const SOURCES = {
  exitosa: {
    name: "Exitosa, con datos del Ministerio Público",
    url: "https://www.exitosanoticias.pe/actualidad/extorsion-peru-registran-mas-13-mil-denuncias-durante-primeros-siete-meses-2026-n182874",
  },
  larepublica: {
    name: "La República, editorial del 22 de junio de 2026",
    url: "https://larepublica.pe/opinion/2026/06/22/la-inseguridad-ciudadana-que-requiere-atencion-editorial-777876",
  },
  americatv: {
    name: "América TV",
    url: "https://www.americatv.com.pe/noticias/amp/actualidad/inseguridad-y-extorsion-herencia-criminal-que-recibira-proximo-presidente-n517381",
  },
  elcomercio: {
    name: "El Comercio",
    url: "https://elcomercio.pe/peru/extorsion-denuncias-pasan-de-4761-a-26217-pero-presos-sentenciados-bajan-de-712-a-650-apuesplan-noticia/",
  },
  ley29733: {
    name: "Ley 29733 de Protección de Datos Personales",
    url: "https://diariooficial.elperuano.pe/Normas/obtenerDocumento?idNorma=23",
  },
} satisfies Record<string, Source>;

export const REPO_URL = "https://github.com/EdwinSotto123/blindaje";

/** El portal público por zona (modo simulado, datos ficticios): el mapa por distrito vive ahí. */
export const PORTAL_URL = "https://blindaje-negocios.vigiaperu.workers.dev";
