import { districtById } from "@blindaje/shared";
import { useEffect, useRef } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { DemoFlag, HelpStrip, Layout } from "./components/Layout";
import { Empty, PageHead } from "./components/ui";
import { AlertsView } from "./views/AlertsView";
import { DataView } from "./views/DataView";
import { MapView } from "./views/MapView";
import { PickerView } from "./views/PickerView";
import { ProtocolView } from "./views/ProtocolView";
import { RecommendationsView } from "./views/RecommendationsView";
import { HomeView } from "./views/ZoneView";

const TITLES: [RegExp, string][] = [
  [/^\/elegir/, "Elige tu distrito"],
  [/^\/mapa/, "Mapa de Lima y el Callao"],
  [/^\/recomendaciones/, "Consejos"],
  [/^\/alertas/, "Alertas"],
  [/^\/si-te-pasa/, "Qué hacer si te pasa"],
  [/^\/datos/, "Cómo leer los datos"],
];

/** Título del documento: la sección y, si hay, el distrito ("Ate · Mi zona · Blindaje"). */
export function documentTitle(pathname: string, search: string): string {
  const d = districtById(new URLSearchParams(search).get("distrito"));
  const section = pathname === "/" ? (d ? "Mi zona" : "Elige tu distrito") : TITLES.find(([re]) => re.test(pathname))?.[1];
  if (!section) return "Blindaje";
  return d && pathname !== "/mapa" ? `${d.name} · ${section} · Blindaje` : `${section} · Blindaje`;
}

/**
 * Título del documento por ruta y foco al contenido al navegar (lectores de pantalla). En la primera
 * carga el foco se queda al inicio: el primer Tab llega a "Saltar al contenido" y el segundo a
 * "Salir rápido". Cambiar de distrito también cuenta como navegar; cambiar solo el rubro, no.
 */
function useRouteAnnouncements() {
  const { pathname, search } = useLocation();
  const distrito = new URLSearchParams(search).get("distrito") ?? "";
  const first = useRef(true);
  useEffect(() => {
    document.title = documentTitle(pathname, search);
  }, [pathname, search]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("contenido")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [pathname, distrito]);
}

export function App() {
  useRouteAnnouncements();
  return (
    <>
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <HelpStrip />
      <DemoFlag />
      <Routes>
        {/* El portal ya no tiene cuenta: un enlace viejo a "Entrar" lleva al inicio. */}
        <Route path="/entrar" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route index element={<HomeView />} />
          <Route path="elegir" element={<PickerView />} />
          <Route path="mapa" element={<MapView />} />
          <Route path="alertas" element={<AlertsView />} />
          <Route path="recomendaciones" element={<RecommendationsView />} />
          <Route path="si-te-pasa" element={<ProtocolView />} />
          <Route path="datos" element={<DataView />} />
          <Route
            path="*"
            element={
              <>
                <PageHead title="Esta página no existe" margin="Perdido" />
                <Empty title="No encontramos lo que buscabas">
                  <Link to="/">Elige tu distrito</Link> o mira el <Link to="/mapa">mapa</Link>.
                </Empty>
              </>
            }
          />
        </Route>
      </Routes>
    </>
  );
}
