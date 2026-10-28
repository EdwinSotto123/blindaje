import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./app/context";
import { DemoFlag, Layout } from "./components/Layout";
import { Empty, Loading, PageHead } from "./components/ui";
import { can, homeFor, type Capability } from "./lib/permissions";
import { AdminView } from "./views/AdminView";
import { AlertsView } from "./views/AlertsView";
import { AuditView } from "./views/AuditView";
import { CostsView } from "./views/CostsView";
import { ExpedientesView } from "./views/ExpedientesView";
import { InvitesView } from "./views/InvitesView";
import { LinksView } from "./views/LinksView";
import { LoginView } from "./views/LoginView";
import { NetworkDetailView } from "./views/NetworkDetailView";
import { NetworksView } from "./views/NetworksView";

const TITLES: [RegExp, string][] = [
  [/^\/login/, "Entrar"],
  [/^\/vinculos/, "Cola de vínculos"],
  [/^\/redes\/[^/]+\/perfil/, "Perfil de red"],
  [/^\/redes\/[^/]+\/expediente/, "Expediente de red"],
  [/^\/redes\/[^/]+/, "Red"],
  [/^\/redes/, "Redes"],
  [/^\/alertas/, "Alertas"],
  [/^\/expedientes/, "Expedientes"],
  [/^\/auditoria/, "Auditoría"],
  [/^\/costos/, "Costos"],
  [/^\/admin/, "Administración"],
  [/^\/invitaciones/, "Invitaciones"],
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
        <Empty title="Tu rol no tiene acceso a esta sección">Si lo necesitas, pídelo a la administración de tu organización.</Empty>
      </>
    );
  }
  return <>{children}</>;
}

function Protected() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="login-wrap">
        <Loading label="Abriendo la consola…" />
      </div>
    );
  }
  if (status === "anon") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
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
            path="alertas"
            element={
              <RequireCap cap="alerts.view">
                <AlertsView />
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
            path="invitaciones"
            element={
              <RequireCap cap="invites.create">
                <InvitesView />
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
