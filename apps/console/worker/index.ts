/**
 * Worker de la consola: sirve la SPA (Workers Static Assets) y pasa /v1/* a blindaje-api por un
 * service binding. Así la consola habla con la API en su mismo origen: sin preflight CORS por cada
 * ruta nueva ni una segunda conexión TLS (medido el 29/10: ~500 ms menos por petición nueva desde
 * Lima). blindaje-api sigue corriendo fijada junto a D1; este Worker corre donde entra la petición.
 */

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/v1/")) return env.API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
