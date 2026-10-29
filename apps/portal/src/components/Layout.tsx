import { Suspense, useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useApi, useIsDemo } from "../app/context";
import { QUICK_EXIT_URL } from "../config";
import { RUBRO_LABEL, useChoice } from "../lib/choice";
import { quickExit } from "../lib/quickExit";
import { Icon } from "./Icons";
import { Loading } from "./ui";

/** En pantallas angostas se ve la etiqueta corta (que es parte de la larga, para el nombre accesible). */
const NAV = [
  { to: "/", label: "Mi zona", short: "Mi zona", end: true },
  { to: "/mapa", label: "Mapa", short: "Mapa" },
  { to: "/alertas", label: "Alertas", short: "Alertas" },
  { to: "/recomendaciones", label: "Consejos", short: "Consejos" },
  { to: "/si-te-pasa", label: "Qué hacer si te pasa", short: "Si te pasa" },
  { to: "/datos", label: "Cómo leer los datos", short: "Datos" },
];

/**
 * Franja de ayuda (DESIGN.md, Help Strip): 105 y Línea 1818 siempre a la vista, y "Salir rápido"
 * primero en el orden de foco.
 */
export function HelpStrip() {
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
  }, []);

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
          Abre una página neutra y reemplaza esta. Atajo: Esc dos veces.
        </span>
        <p className="help-item help-never">No pagues ni negocies.</p>
        <p className="help-item">
          <span className="help-lead">¿Estás en peligro ahora?</span>
          <a className="pill pill-105" href="tel:105">
            <Icon name="phone" size={18} />
            Llamar al 105
          </a>
        </p>
        <p className="help-item">
          <span className="help-lead">Para denunciar:</span>
          <a className="pill pill-1818" href="tel:1818">
            Línea 1818
          </a>
        </p>
      </div>
    </div>
  );
}

/** Marca "Datos ficticios" en todo el portal mientras sea una demostración. */
export function DemoFlag() {
  const isDemo = useIsDemo();
  const api = useApi();
  if (!isDemo) return null;
  return (
    <div className="demo-flag" role="region" aria-label="Aviso de datos ficticios">
      <strong>Datos ficticios</strong>
      <span>
        <span className="demo-long">Es una demostración: los distritos son reales, pero los casos, “Los X”, los negocios y las cifras no.</span>
        <span className="demo-short">Los casos y las cifras no son reales.</span>
        {api.mode === "mock" ? <span className="demo-long"> Modo simulado, sin conexión al servidor.</span> : null}
      </span>
    </div>
  );
}

/** La zona elegida, siempre a la vista, con el enlace para cambiarla. Sin elección, el enlace para elegir. */
function ZoneChip() {
  const { distrito, rubro, search } = useChoice();
  const { pathname } = useLocation();
  if (!distrito) {
    // En el selector no hace falta el botón: ya se está eligiendo.
    if (pathname === "/" || pathname === "/elegir") return null;
    return (
      <Link className="btn btn-outline btn-sm zone-chip-pick" to={{ pathname: "/elegir", search }}>
        Elegir distrito
      </Link>
    );
  }
  return (
    <p className="zone-chip">
      <span className="zone-chip-text">
        <span className="strong">{distrito.name}</span>
        <span className="muted"> · {rubro ? RUBRO_LABEL[rubro] : "Todos los rubros"}</span>
      </span>
      <Link className="zone-chip-change" to={{ pathname: "/elegir", search }}>
        Cambiar<span className="sr-only"> de distrito o de rubro</span>
      </Link>
    </p>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const { search } = useChoice();
  const tabsRef = useRef<HTMLUListElement>(null);

  // En el celular las pestañas se deslizan: la de la página actual siempre queda a la vista.
  useEffect(() => {
    const ul = tabsRef.current;
    const active = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !active || ul.scrollWidth <= ul.clientWidth) return;
    const left = active.offsetLeft - ul.offsetLeft;
    if (left < ul.scrollLeft || left + active.offsetWidth > ul.scrollLeft + ul.clientWidth) ul.scrollLeft = Math.max(0, left - 8);
  }, [pathname]);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <Link to={{ pathname: "/", search }} className="brand" aria-label="Blindaje, ir a Mi zona">
            <span className="brand-name" translate="no">
              blindaje
            </span>
            <span className="brand-sub">tu zona</span>
          </Link>
          <ZoneChip />
        </div>
        <nav className="tabs" aria-label="Secciones del portal">
          <ul ref={tabsRef}>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={{ pathname: n.to, search }} end={n.end ?? false}>
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

/** Pie en la banda oscura: la regla de oro, los canales oficiales y lo que el portal no guarda. */
export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-in">
        <p className="foot-brand" translate="no" aria-hidden="true">
          blindaje
        </p>
        <div className="foot-text">
          <p>
            <strong>Nunca pagues ni negocies.</strong> Blindaje no reemplaza a la policía ni a la fiscalía: si estás en peligro, llama al{" "}
            <a href="tel:105">105</a>; para denunciar, a la <a href="tel:1818">Línea 1818</a> o ve a tu comisaría.
          </p>
          <p className="small">Sin cuenta y sin rastreo: el portal no guarda tu distrito ni tu rubro; van solo en la dirección de la página.</p>
        </div>
      </div>
    </footer>
  );
}
