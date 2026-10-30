import { lazy, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./app/context";
import { DemoFlag, Layout } from "./components/Layout";
import { Empty, Loading, PageHead } from "./components/ui";
import { can, homeFor, type Capability } from "./lib/permissions";
import { LinksView } from "./views/LinksView";
import { VIEW_LOADERS } from "./views/loaders";
import { LoginView } from "./views/LoginView";

// Vistas con carga diferida: Cytoscape y las pantallas menos usadas no entran al bundle inicial.
const AdminView = lazy(() => VIEW_LOADERS.admin().then((m) => ({ default: m.AdminView })));
const AlertsView = lazy(() => VIEW_LOADERS.alerts().then((m) => ({ default: m.AlertsView })));
const AuditView = lazy(() => VIEW_LOADERS.audit().then((m) => ({ default: m.AuditView })));
const CostsView = lazy(() => VIEW_LOADERS.costs().then((m) => ({ default: m.CostsView })));
const ExpedientesView = lazy(() => VIEW_LOADERS.expedientes().then((m) => ({ default: m.ExpedientesView })));
const LeaksView = lazy(() => VIEW_LOADERS.leaks().then((m) => ({ default: m.LeaksView })));
const MonitorView = lazy(() => VIEW_LOADERS.monitor().then((m) => ({ default: m.MonitorView })));
const NetworkDetailView = lazy(() => VIEW_LOADERS.networkDetail().then((m) => ({ default: m.NetworkDetailView })));
const NetworksView = lazy(() => VIEW_LOADERS.networks().then((m) => ({ default: m.NetworksView })));
const RecommendationsView = lazy(() => VIEW_LOADERS.recommendations().then((m) => ({ default: m.RecommendationsView })));
const VectorsView = lazy(() => VIEW_LOADERS.vectors().then((m) => ({ default: m.VectorsView })));
const ZonesView = lazy(() => VIEW_LOADERS.zones().then((m) => ({ default: m.ZonesView })));

const TITLES: [RegExp, string][] = [
  [/^\/login/, "Entrar"],
  [/^\/vinculos/, "Cola de vínculos"],
  [/^\/redes\/[^/]+\/perfil/, "Perfil de red"],
  [/^\/redes\/[^/]+\/expediente/, "Expediente de red"],
  [/^\/redes\/[^/]+/, "Red"],
  [/^\/redes/, "Redes"],
  [/^\/zonas/, "Zonas"],
  [/^\/alertas/, "Alertas"],
  [/^\/recomendaciones/, "Recomendaciones"],
  [/^\/expedientes/, "Expedientes"],
  [/^\/auditoria/, "Auditoría"],
  [/^\/costos/, "Costos"],
  [/^\/admin/, "Administración"],
  [/^\/filtraciones/, "Rastrear filtración"],
  [/^\/vectores/, "Motor vectorial"],
  [/^\/monitoreo/, "Monitoreo"],
];

/** Título del documento por ruta y foco al contenido al navegar (lectores de pantalla). */
function useRouteAnnouncements() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · Blindaje` : "Blindaje · Consola";
    document.getElementById("contenido")?.focus({ preventScroll: true });
  }, [pathname]);
}

function RequireCap({ cap, children }: { cap: Capability; children: ReactNode }) {
  const { user } = useAuth();
  if (!can(user?.role, cap)) {
    return (
      <>
        <PageHead title="Sin acceso" />
        <Empty title="Tu rol no tiene acceso a esta sección">Si lo necesitas, pídelo a la administración de Blindaje.</Empty>
      </>
    );
  }
  return <>{children}</>;
}

function Protected() {
  const { status, loggedOut } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="login-wrap">
        <Loading label="Abriendo la consola…" />
      </div>
    );
  }
  // Tras "Cerrar sesión" no se recuerda la página: la próxima persona empieza en su inicio.
  if (status === "anon") return <Navigate to="/login" replace state={loggedOut ? null : { from: location.pathname }} />;
  return <Layout />;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

export function App() {
  useRouteAnnouncements();
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <DemoFlag />
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route element={<Protected />}>
          <Route index element={<Home />} />
          <Route
            path="vinculos"
            element={
              <RequireCap cap="links.review">
                <LinksView />
              </RequireCap>
            }
          />
          <Route
            path="vinculos/:id"
            element={
              <RequireCap cap="links.review">
                <LinksView />
              </RequireCap>
            }
          />
          <Route
            path="redes"
            element={
              <RequireCap cap="networks.view">
                <NetworksView />
              </RequireCap>
            }
          />
          <Route
            path="redes/:id/:tab?"
            element={
              <RequireCap cap="networks.view">
                <NetworkDetailView />
              </RequireCap>
            }
          />
          <Route
            path="zonas"
            element={
              <RequireCap cap="zones.view">
                <ZonesView />
              </RequireCap>
            }
          />
          <Route
            path="alertas"
            element={
              <RequireCap cap="alerts.view">
                <AlertsView />
              </RequireCap>
            }
          />
          <Route
            path="recomendaciones"
            element={
              <RequireCap cap="recommendations.view">
                <RecommendationsView />
              </RequireCap>
            }
          />
          <Route
            path="expedientes"
            element={
              <RequireCap cap="expedientes">
                <ExpedientesView />
              </RequireCap>
            }
          />
          <Route
            path="auditoria"
            element={
              <RequireCap cap="audit.view">
                <AuditView />
              </RequireCap>
            }
          />
          <Route
            path="costos"
            element={
              <RequireCap cap="costs.view">
                <CostsView />
              </RequireCap>
            }
          />
          <Route
            path="admin"
            element={
              <RequireCap cap="admin.orgs">
                <AdminView />
              </RequireCap>
            }
          />
          <Route
            path="filtraciones"
            element={
              <RequireCap cap="leaks.trace">
                <LeaksView />
              </RequireCap>
            }
          />
          <Route
            path="monitoreo"
            element={
              <RequireCap cap="monitor.view">
                <MonitorView />
              </RequireCap>
            }
          />
          <Route
            path="vectores"
            element={
              <RequireCap cap="vectors.view">
                <VectorsView />
              </RequireCap>
            }
          />
          <Route
            path="*"
            element={
              <>
                <PageHead title="No encontrado" />
                <Empty title="Esta página no existe">Usa el menú para volver a una sección.</Empty>
              </>
            }
          />
        </Route>
      </Routes>
    </>
  );
}
