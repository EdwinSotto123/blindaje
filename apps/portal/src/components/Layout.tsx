import { Suspense, useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useApi, useAuth } from "../app/context";
import { QUICK_EXIT_URL } from "../config";
import { capitalize } from "../lib/format";
import { Icon } from "./Icons";
import { Loading } from "./ui";

/** En pantallas angostas se ve la etiqueta corta (que es parte de la larga, para el nombre accesible). */
const NAV = [
  { to: "/", label: "Mi panorama", short: "Mi panorama", end: true },
  { to: "/recomendaciones", label: "Recomendaciones", short: "Recomendaciones" },
  { to: "/alertas", label: "Alertas del gremio", short: "Alertas" },
  { to: "/si-te-pasa", label: "Qué hacer si te pasa", short: "Si te pasa" },
  { to: "/datos", label: "Cómo cuidamos los datos", short: "Tus datos" },
];

/**
 * Franja de ayuda (DESIGN.md, Help Strip): 105 y Línea 1818 siempre a la vista, y "Salir rápido"
 * primero en el orden de foco. Salir rápido también borra la sesión de esta pestaña.
 */
export function HelpStrip() {
  const api = useApi();
  const lastEsc = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const now = Date.now();
      if (now - lastEsc.current < 800) quickExit();
      lastEsc.current = now;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // quickExit solo usa `api`, que no cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  function quickExit() {
    api.forget();
    window.open(QUICK_EXIT_URL, "_blank", "noopener,noreferrer");
    window.location.replace(QUICK_EXIT_URL);
  }

  return (
    <div className="help" role="region" aria-label="Ayuda inmediata">
      <div className="help-in">
        <a
          className="help-exit"
          href={QUICK_EXIT_URL}
          rel="noreferrer"
          aria-describedby="exit-hint"
          onClick={(e) => {
            e.preventDefault();
            quickExit();
          }}
        >
          <Icon name="exit" size={18} />
          <span className="wide">Salir rápido</span>
          <span className="narrow" aria-hidden="true">
            Salir
          </span>
        </a>
        <span className="sr-only" id="exit-hint">
          Cierra tu sesión y abre una página neutra. Atajo: Esc dos veces.
        </span>
        <p className="help-item help-never">No pagues ni negocies.</p>
        <p className="help-item">
          <span className="help-lead">¿Estás en peligro ahora?</span>
          <a className="pill" href="tel:105">
            <Icon name="phone" size={18} />
            Llamar al 105
          </a>
        </p>
        <p className="help-item">
          <span className="help-lead">Para denunciar:</span>
          <a className="pill" href="tel:1818">
            Línea 1818
          </a>
        </p>
      </div>
    </div>
  );
}

/** Marca "Datos ficticios" en todo el portal mientras sea una demostración. */
export function DemoFlag() {
  const { isDemo } = useAuth();
  const api = useApi();
  if (!isDemo) return null;
  return (
    <div className="demo-flag" role="region" aria-label="Aviso de datos ficticios">
      <strong>Datos ficticios</strong>
      <span>
        Es una demostración: las zonas, “Los X”, los negocios y las cifras no son reales.
        {api.mode === "mock" ? <span className="demo-long"> Modo simulado, sin conexión al servidor.</span> : null}
      </span>
    </div>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;

  return (
    <>
      <header className="top">
        <div className="top-in">
          <NavLink to="/" className="brand" aria-label="Blindaje Negocios, ir a Mi panorama">
            <span className="brand-name" translate="no">
              Blindaje
            </span>
            <span className="brand-sub">Negocios</span>
          </NavLink>
          <p className="whoami">
            <span className="strong">{me.business_name}</span>{" "}
            <span className="pencil">
              {capitalize(me.sector)} · {me.zona}
              <span className="whoami-org"> · {me.org.name}</span>
            </span>
          </p>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              void logout().then(() => navigate("/entrar", { replace: true, state: null }));
            }}
          >
            <Icon name="logout" size={18} />
            Cerrar sesión
          </button>
        </div>
        <nav className="tabs" aria-label="Secciones del portal">
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end ?? false}>
                  <span className="nav-long">{n.label}</span>
                  <span className="nav-short">{n.short}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="contenido" className="main" tabIndex={-1}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <p>
        <strong>Nunca pagues ni negocies.</strong> Blindaje no reemplaza a la policía ni a la fiscalía: si estás en peligro, llama al{" "}
        <a href="tel:105">105</a>; para denunciar, a la <a href="tel:1818">Línea 1818</a> o ve a tu comisaría.
      </p>
    </footer>
  );
}
