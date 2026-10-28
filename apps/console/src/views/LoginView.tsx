import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { errorMessage } from "../api/client";
import { useApi, useAuth } from "../app/context";
import { Icon } from "../components/Icons";
import { Loading, Notice } from "../components/ui";
import { homeFor } from "../lib/permissions";
import { DEMO_PASSWORD, USERS } from "../mock/fixtures";

const DEMO_ROLES: { email: string; label: string; desc: string }[] = [
  { email: USERS[0]!.email, label: "Revisora del gremio", desc: "Confirma vínculos y aprueba alertas de su organización" },
  { email: USERS[1]!.email, label: "Analista de la alianza", desc: "Redes, Cartógrafo, expedientes, auditoría y costos" },
  { email: USERS[2]!.email, label: "Administración", desc: "Organizaciones, invitaciones, usuarios, auditoría y costos" },
];

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
      if (!/^S+@S+.S+$/.test(creds.email.trim())) {
        setError("Escribe tu correo completo, por ejemplo nombre@gremio.pe.");
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
    <div className="login-wrap">
      <main id="contenido" tabIndex={-1} className="login-card" aria-labelledby="login-title">
        <div className="stack-sm">
          <span className="brand">
            <span className="brand-name">Blindaje</span>
            <span className="brand-sub">Consola</span>
          </span>
          <h1 id="login-title" style={{ fontSize: "21px" }}>
            Entrar a la consola de revisión
          </h1>
          <p className="muted small">Solo para revisores de gremios y analistas autorizados de la alianza. Cada acción queda registrada.</p>
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
          <section className="stack-sm" aria-labelledby="demo-title">
            <h2 id="demo-title" style={{ fontSize: "1rem" }}>
              Cuentas ficticias del modo simulado
            </h2>
            <p className="small muted">
              Contraseña: <code>{DEMO_PASSWORD}</code>
            </p>
            <ul className="list-plain stack-sm">
              {DEMO_ROLES.map((r) => (
                <li key={r.email}>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal" }}
                    disabled={busy}
                    onClick={(e) => void submit(e, { email: r.email, password: DEMO_PASSWORD })}
                  >
                    <span className="stack-sm" style={{ gap: 0 }}>
                      <span>Entrar como {r.label}</span>
                      <span className="small muted" style={{ fontWeight: 400 }}>
                        {r.desc}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
