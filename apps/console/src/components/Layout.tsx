import { Suspense, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useApi, useAuth } from "../app/context";
import { can, type Capability } from "../lib/permissions";
import { ROLE_LABEL } from "../lib/format";
import { MockApi, type MockScenario } from "../mock/mockApi";
import { Icon, type IconName } from "./Icons";
import { Loading } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  cap: Capability;
}

const NAV: NavItem[] = [
  { to: "/vinculos", label: "Cola de vínculos", icon: "link", cap: "links.review" },
  { to: "/redes", label: "Redes", icon: "network", cap: "networks.view" },
  { to: "/alertas", label: "Alertas", icon: "megaphone", cap: "alerts.view" },
  { to: "/recomendaciones", label: "Recomendaciones", icon: "shield", cap: "recommendations.view" },
  { to: "/expedientes", label: "Expedientes", icon: "file", cap: "expedientes" },
  { to: "/auditoria", label: "Auditoría", icon: "chain", cap: "audit.view" },
  { to: "/costos", label: "Costos", icon: "coins", cap: "costs.view" },
  { to: "/admin", label: "Administración", icon: "users", cap: "admin.orgs" },
  { to: "/filtraciones", label: "Rastrear filtración", icon: "search", cap: "leaks.trace" },
];

/** Marca visible en toda la consola cuando el entorno es de demostración. */
export function DemoFlag() {
  const { isDemo, health } = useAuth();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  if (!isDemo) return null;
  const mock = api instanceof MockApi ? api : null;

  const reset = async (scenario: MockScenario) => {
    if (!mock) return;
    setBusy(true);
    await mock.reset(scenario);
    window.location.reload();
  };

  return (
    <div className="demo-flag" role="region" aria-label="Aviso de datos ficticios">
      <strong>Datos ficticios</strong>
      <span>
        Entorno de demostración: ningún caso, voz, número ni cuenta es real.
        {mock ? " Modo simulado, sin API." : health?.version ? ` API ${health.version}.` : ""}
      </span>
      {mock ? (
        <div className="demo-tools">
          <label htmlFor="escenario" className="small strong">
            Escenario
          </label>
          <select
            id="escenario"
            disabled={busy}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as MockScenario | "";
              if (v) void reset(v);
            }}
          >
            <option value="" disabled>
              Restablecer…
            </option>
            <option value="inicio">Inicio: vínculos A–B y B–C por revisar</option>
            <option value="red">Red armada: A, B y C confirmados</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const items = NAV.filter((n) => can(user.role, n.cap));
  if (user.role === "reviewer") items.push({ to: "/invitaciones", label: "Invitaciones", icon: "key", cap: "invites.create" });

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <NavLink to="/" className="brand" aria-label="Blindaje, inicio de la consola">
          <span className="brand-name">Blindaje</span>
          <span className="brand-sub">Consola</span>
        </NavLink>
        <nav className="nav">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="whoami">
          <span className="strong">{user.display_name}</span>
          <span className="muted">
            {ROLE_LABEL[user.role] ?? user.role} · {user.org.name}
          </span>
          <span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void logout().then(() => navigate("/login", { replace: true, state: null }));
              }}
            >
              <Icon name="logout" size={15} />
              Cerrar sesión
            </button>
          </span>
        </div>
      </aside>
      <main id="contenido" className="main" tabIndex={-1}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
