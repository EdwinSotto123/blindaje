import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { errorMessage } from "../api/client";
import { useApi, useAuth } from "../app/context";
import { Icon } from "../components/Icons";
import { Loading, Notice } from "../components/ui";
import { homeFor } from "../lib/permissions";
import { DEMO_PASSWORD, demoUser } from "../mock/fixtures";

/** Las tres cuentas ficticias del equipo central, tomadas por rol (no por posición). */
export const DEMO_ROLES: { email: string; label: string; desc: string }[] = [
  { email: demoUser("reviewer").email, label: "revisora del equipo", desc: "Confirma vínculos y aprueba alertas y consejos de cualquier distrito" },
  { email: demoUser("analyst").email, label: "analista del equipo", desc: "Redes, zonas, Cartógrafo, Vigía, Asesor, expedientes, auditoría y costos" },
  { email: demoUser("admin").email, label: "administración", desc: "Todo lo de la consola, más monitoreo, equipo, filtraciones y motor vectorial" },
];

/** Validación mínima en el cliente: algo@algo.algo, sin espacios. La API decide el resto. */
export function looksLikeEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}

export function LoginView() {
  const { status, user, expired, login } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return (
      <div className="login-wrap">
        <Loading />
      </div>
    );
  }
  if (status === "authed" && user) return <Navigate to={from ?? homeFor(user.role)} replace />;

  const submit = async (e: FormEvent, override?: { email: string; password: string }) => {
    e.preventDefault();
    const creds = override ?? { email, password };
    if (!override) {
      if (!looksLikeEmail(creds.email)) {
        setError("Escribe tu correo completo, por ejemplo nombre@blindaje.pe.");
        document.getElementById("email")?.focus();
        return;
      }
      if (creds.password.length < 8) {
        setError("La contraseña tiene al menos 8 caracteres.");
        document.getElementById("password")?.focus();
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      const u = await login(creds.email, creds.password);
      navigate(from && from !== "/login" ? from : homeFor(u.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main id="contenido" tabIndex={-1} className="login-wrap" aria-labelledby="login-title">
      <div className="login-card">
        <div className="stack-sm">
          <span className="brand">
            <span className="brand-name">blindaje</span>
            <span className="brand-sub">Consola</span>
          </span>
          <h1 id="login-title" className="login-title">
            Entrar a la consola de revisión
          </h1>
          <p className="muted">Solo para el equipo de análisis de Blindaje. Cada acción queda registrada.</p>
        </div>

        {expired ? <Notice kind="warn">Tu sesión expiró. Vuelve a entrar.</Notice> : null}

        <form className="stack-sm" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          {error ? (
            <div id="login-error" className="error-box" role="alert">
              <Icon name="alert" />
              <span>{error}</span>
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        {api.mode === "mock" ? (
          <section className="stack-sm demo-accounts" aria-labelledby="demo-title">
            <h2 id="demo-title">Cuentas ficticias del modo simulado</h2>
            <p className="small muted">
              Contraseña: <code>{DEMO_PASSWORD}</code>
            </p>
            <ul className="list-plain stack-sm">
              {DEMO_ROLES.map((r) => (
                <li key={r.email}>
                  <button
                    type="button"
                    className="demo-account"
                    disabled={busy}
                    onClick={(e) => void submit(e, { email: r.email, password: DEMO_PASSWORD })}
                  >
                    <span>
                      <strong>Entrar como {r.label}</strong>
                      <small>{r.desc}</small>
                    </span>
                    <Icon name="arrowRight" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {/* La única foto de la consola: una calle de Lima, con su crédito a la vista. */}
      <figure className="login-photo">
        <img src="/fotos/cerro.jpg" alt="Una avenida de Lima con un cerro poblado al fondo" width={1600} height={1200} decoding="async" />
        <figcaption>Foto: moctezuma nacario, CC BY 3.0</figcaption>
      </figure>
    </main>
  );
}
