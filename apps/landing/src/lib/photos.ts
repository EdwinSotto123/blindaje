/**
 * Fotos del mundo de Blindaje, tomadas de colecciones abiertas (Wikimedia Commons). Ninguna muestra a
 * una víctima ni a un usuario: son quipus de museo y calles del Perú. Los créditos están en
 * src/assets/photos/credits.json y se muestran en el pie de la página.
 */
import type { ImageMetadata } from "astro";
import khipuEspiral from "../assets/photos/khipu-antwerpen-espiral.jpg";
import khipuCleveland from "../assets/photos/khipu-cleveland.jpg";
import khipuColgante from "../assets/photos/khipu-antwerpen-colgante.jpg";
import lockeNudos from "../assets/photos/locke-nudos.jpg";
import mototaxisPiura from "../assets/photos/mototaxis-piura.jpg";
import mototaxisLambayeque from "../assets/photos/mototaxis-lambayeque.jpg";
import mototaxiChivay from "../assets/photos/mototaxi-chivay.jpg";
import mercado from "../assets/photos/mercado-central-lima.jpg";

export const PHOTOS = {
  khipuEspiral,
  khipuCleveland,
  khipuColgante,
  lockeNudos,
  mototaxisPiura,
  mototaxisLambayeque,
  mototaxiChivay,
  mercado,
} satisfies Record<string, ImageMetadata>;

export type PhotoKey = keyof typeof PHOTOS;

/** Crédito corto de cada foto, en el orden del pie de página. */
export const CREDITS: { key: PhotoKey; text: string; url: string }[] = [
  {
    key: "khipuEspiral",
    text: "Quipu inca, 1450–1533, MAS Amberes (CC0)",
    url: "https://commons.wikimedia.org/wiki/File:Quipu_of_khipu,_asset_DceZWn8LYYDIRKWYkOyZNdoj.tif",
  },
  {
    key: "khipuCleveland",
    text: "Quipu inca, Cleveland Museum of Art 1940.469 (CC0)",
    url: "https://commons.wikimedia.org/wiki/File:Peru,_Inca_Period,_15th-16th_Century_-_Inka_Khipu_(Fiber_Recording_Device)_-_1940.469_-_Cleveland_Museum_of_Art.tif",
  },
  {
    key: "khipuColgante",
    text: "Quipu inca, 1350–1532, MAS Amberes (CC0)",
    url: "https://commons.wikimedia.org/wiki/File:Quipu_of_khipu,_asset_u6FupXbgPG9jDmVHnY689dhg.tif",
  },
  {
    key: "lockeNudos",
    text: "L. L. Locke, The Ancient Quipu, lámina XXI, 1912 (dominio público)",
    url: "https://commons.wikimedia.org/wiki/File:The_Ancient_Quipu_Plate_XXI.jpg",
  },
  {
    key: "mototaxisPiura",
    text: "Mototaxis en Piura, Beatrice Murch (CC BY 2.0)",
    url: "https://commons.wikimedia.org/wiki/File:Mototaxis_en_Piura,_Per%C3%BA.jpg",
  },
  {
    key: "mototaxisLambayeque",
    text: "Mototaxis en Perú, TheJCNA (CC BY-SA 4.0)",
    url: "https://commons.wikimedia.org/wiki/File:Mototaxis_en_Per%C3%BA.jpg",
  },
  {
    key: "mototaxiChivay",
    text: "Calle con mototaxi en Chivay, Josep M. Gracia (CC BY-SA 4.0)",
    url: "https://commons.wikimedia.org/wiki/File:CHI_-_Street_with_mototaxi_in_Chivay,_Peru,_2013.jpg",
  },
  {
    key: "mercado",
    text: "Mercado Central de Lima, Ovruni (CC BY-SA 4.0)",
    url: "https://commons.wikimedia.org/wiki/File:Mercado_Central_de_Lima_20.jpg",
  },
];
