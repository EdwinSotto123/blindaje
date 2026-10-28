import { useEffect, useRef } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./app/context";
import { DemoFlag, HelpStrip, Layout } from "./components/Layout";
import { Empty, Loading, PageHead } from "./components/ui";
import { AlertsView } from "./views/AlertsView";
import { DataView } from "./views/DataView";
import { LoginView } from "./views/LoginView";
import { PanoramaView } from "./views/PanoramaView";
import { ProtocolView } from "./views/ProtocolView";
import { RecommendationsView } from "./views/RecommendationsView";

const TITLES: [RegExp, string][] = [
  [/^\/entrar/, "Entrar"],
  [/^\/recomendaciones/, "Recomendaciones"],
  [/^\/alertas/, "Alertas del gremio"],
  [/^\/si-te-pasa/, "Qué hacer si te pasa"],
  [/^\/datos/, "Cómo cuidamos los datos"],
  [/^\/$/, "Mi panorama"],
];

/**
 * Título del documento por ruta y foco al contenido al navegar (lectores de pantalla). En la primera
 * carga el foco se queda al inicio: el primer Tab llega a "Saltar al contenido" y el segundo a
 * "Salir rápido".
 */
function useRouteAnnouncements() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · Blindaje Negocios` : "Blindaje Negocios";
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("contenido")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [pathname]);
}

function Protected() {
  const { status, loggedOut } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <main id="contenido" className="login" tabIndex={-1}>
        <Loading label="Abriendo tu portal…" />
      </main>
    );
  }
  // Tras "Cerrar sesión" no se recuerda la página: la próxima persona empieza en su inicio.
  if (status === "anon") return <Navigate to="/entrar" replace state={loggedOut ? null : { from: location.pathname }} />;
  return <Layout />;
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
        <Route path="/entrar" element={<LoginView />} />
        <Route element={<Protected />}>
          <Route index element={<PanoramaView />} />
          <Route path="recomendaciones" element={<RecommendationsView />} />
          <Route path="alertas" element={<AlertsView />} />
          <Route path="si-te-pasa" element={<ProtocolView />} />
          <Route path="datos" element={<DataView />} />
          <Route
            path="*"
            element={
              <>
                <PageHead title="Esta página no existe" margin="Perdido" />
                <Empty title="No encontramos lo que buscabas">
                  <Link to="/">Vuelve a Mi panorama</Link>.
                </Empty>
              </>
            }
          />
        </Route>
      </Routes>
    </>
  );
}
