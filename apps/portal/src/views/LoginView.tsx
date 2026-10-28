import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiRequestError, errorMessage } from "../api/client";
import { useApi, useAuth } from "../app/context";
import { Icon } from "../components/Icons";
import { Footer } from "../components/Layout";
import { Loading } from "../components/ui";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../mock/fixtures";

/** Validación mínima en el cliente: algo@algo.algo, sin espacios. La API decide el resto. */
export function looksLikeEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}

type FieldError = { field: "email" | "password" | "form"; message: string };

export function LoginView() {
  const { status, me, expired, login } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return (
      <main id="contenido" className="login" tabIndex={-1}>
        <Loading label="Abriendo tu portal…" />
      </main>
    );
  }
  if (status === "authed" && me) return <Navigate to={from && from !== "/entrar" ? from : "/"} replace />;

  const submit = async (e: FormEvent, override?: { email: string; password: string }) => {
    e.preventDefault();
    const creds = override ?? { email, password };
    if (!override) {
      if (!looksLikeEmail(creds.email)) {
        setError({ field: "email", message: "Escribe tu correo completo, por ejemplo nombre@negocio.pe." });
        document.getElementById("email")?.focus();
        return;
      }
      if (creds.password.length < 8) {
        setError({ field: "password", message: "Tu contraseña tiene al menos 8 caracteres." });
        document.getElementById("password")?.focus();
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      await login(creds.email, creds.password);
      navigate(from && from !== "/entrar" ? from : "/", { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiRequestError && (err.status === 401 || err.status === 400 || err.status === 422)
          ? "El correo o la contraseña no coinciden. Si no la recuerdas, pídele a tu gremio que la cambie."
          : errorMessage(err);
      setError({ field: "form", message });
      setBusy(false);
    }
  };

  const errId = error ? `${error.field}-error` : undefined;

  return (
    <>
      <main id="contenido" className="login" tabIndex={-1} aria-labelledby="login-title">
        <div className="login-head">
          <p className="brand" aria-hidden="true">
            <span className="brand-name">Blindaje</span>
            <span className="brand-sub">Negocios</span>
          </p>
          <h1 id="login-title">Entra a tu portal</h1>
          <p className="lead">
            Para dueños y gerentes de negocios afiliados a un gremio. Aquí ves cómo está la extorsión en tu zona y qué te recomienda tu gremio.
          </p>
        </div>

        {expired ? (
          <div className="note" role="status">
            <Icon name="info" />
            <p>Tu sesión terminó. Vuelve a entrar.</p>
          </div>
        ) : null}

        <form className="login-form sheet" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error?.field === "email" ? true : undefined}
              aria-describedby={error?.field === "email" ? errId : undefined}
            />
            {error?.field === "email" ? (
              <p id={errId} className="field-error">
                {error.message}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <div className="password">
              <input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error?.field === "password" ? true : undefined}
                aria-describedby={error?.field === "password" ? errId : undefined}
              />
              <button type="button" className="btn btn-quiet" aria-pressed={show} onClick={() => setShow((s) => !s)}>
                <Icon name="eye" size={18} />
                {show ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            {error?.field === "password" ? (
              <p id={errId} className="field-error">
                {error.message}
              </p>
            ) : null}
          </div>
          {error?.field === "form" ? (
            <p id={errId} className="field-error" role="alert">
              {error.message}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          <p className="pencil small">¿No tienes cuenta? Tu gremio la crea por ti: pídela a tu dirigente.</p>
        </form>

        {api.mode === "mock" ? (
          <section className="demo-accounts" aria-labelledby="demo-title">
            <h2 id="demo-title">Cuentas de demostración</h2>
            <p className="pencil small">
              Son ficticias. Contraseña: <code>{DEMO_PASSWORD}</code>
            </p>
            <ul className="plain">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.me.id}>
                  <button
                    type="button"
                    className="btn btn-outline btn-block"
                    disabled={busy}
                    onClick={(e) => void submit(e, { email: a.me.email, password: DEMO_PASSWORD })}
                  >
                    <span className="btn-text">
                      <span>Entrar como {a.me.business_name}</span>
                      <span className="pencil small">{a.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
