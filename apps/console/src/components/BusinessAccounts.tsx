import "../styles/recommendations.css";

import type { BusinessMe } from "@blindaje/shared";
import { useMemo, useState, type FormEvent } from "react";
import { advisorFor, MIN_BUSINESS_PASSWORD } from "../api/advisor";
import { errorMessage } from "../api/client";
import type { OrgView } from "../api/types";
import { useApi, useUser } from "../app/context";
import { SECTOR_LABEL } from "../lib/format";
import { Icon } from "./Icons";
import { Notice } from "./ui";

/** Validación mínima en el cliente; la API decide el resto (CreateBusinessAccountRequest). */
export function businessAccountProblem(f: { email: string; password: string; business_name: string; sector: string; zona: string }): string | null {
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return "Escribe un correo completo, por ejemplo dueno@negocio.pe.";
  if (f.business_name.trim().length < 2) return "Escribe el nombre del negocio.";
  if (!f.sector.trim()) return "Elige el rubro.";
  if (f.zona.trim().length < 2) return "Escribe la zona del negocio, por ejemplo Lima Este.";
  if (f.password.length < MIN_BUSINESS_PASSWORD) return `La contraseña temporal necesita al menos ${MIN_BUSINESS_PASSWORD} caracteres.`;
  return null;
}

/**
 * Cuentas del portal de negocios (rol business). Las crea la administración o el revisor de su
 * propio gremio; el negocio ve solo información agregada de su zona y su rubro.
 */
export function BusinessAccountsPanel({ orgs }: { orgs: OrgView[] }) {
  const api = useApi();
  const user = useUser();
  const advisor = useMemo(() => advisorFor(api, user), [api, user]);
  const isAdmin = user.role === "admin";
  const choices = orgs.filter((o) => o.kind !== "alianza");
  const [orgId, setOrgId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("bodega");
  const [zona, setZona] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<BusinessMe[]>([]);
  const org = isAdmin ? orgId || choices[0]?.id || "" : user.org.id;
  const selected = choices.find((o) => o.id === org);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const zonaFinal = zona.trim() || selected?.district || "";
    const problem = businessAccountProblem({ email, password, business_name: name, sector, zona: zonaFinal });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const account = await advisor.createBusinessAccount({ email, password, business_name: name, sector, zona: zonaFinal, org_id: org });
      setCreated((prev) => [account, ...prev]);
      setEmail("");
      setName("");
      setPassword("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack-sm" aria-labelledby="biz-titulo">
      <div className="panel-head">
        <h2 id="biz-titulo">
          <Icon name="users" /> Cuentas de negocio
        </h2>
      </div>
      <p className="small muted">
        Para dueños y gerentes de negocios afiliados a un gremio. Ven el panorama agregado de su zona y su rubro, las recomendaciones y las alertas aprobadas
        de su gremio. Nunca ven casos, números ni cuentas. Entrega la contraseña temporal en persona.
      </p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="stack-sm">
          <legend>Nueva cuenta de negocio</legend>
          <div className="grid-3">
            {isAdmin ? (
              <div className="field">
                <label htmlFor="biz-org">Gremio</label>
                <select id="biz-org" value={org} onChange={(e) => setOrgId(e.target.value)}>
                  {choices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="biz-name">Nombre del negocio</label>
              <input id="biz-name" name="business_name" type="text" maxLength={160} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="biz-email">Correo del dueño o gerente</label>
              <input
                id="biz-email"
                name="email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="biz-sector">Rubro</label>
              <select id="biz-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
                {Object.entries(SECTOR_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="biz-zona">Zona</label>
              <input
                id="biz-zona"
                name="zona"
                type="text"
                autoComplete="off"
                placeholder={selected?.district ? `${selected.district}` : "Por ejemplo, Lima Este"}
                value={zona}
                onChange={(e) => setZona(e.target.value)}
                aria-describedby="biz-zona-hint"
              />
              <span id="biz-zona-hint" className="hint">
                {selected?.district ? `Si la dejas vacía, se usa la del gremio: ${selected.district}.` : "La misma zona que usan las alertas del gremio."}
              </span>
            </div>
            <div className="field">
              <label htmlFor="biz-pass">Contraseña temporal</label>
              <input
                id="biz-pass"
                name="password"
                type="password"
                minLength={MIN_BUSINESS_PASSWORD}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="biz-pass-hint"
              />
              <span id="biz-pass-hint" className="hint">
                Al menos {MIN_BUSINESS_PASSWORD} caracteres.
              </span>
            </div>
          </div>
          <span>
            <button type="submit" className="btn btn-primary" disabled={busy || (isAdmin && !org)}>
              {busy ? "Creando…" : "Crear cuenta de negocio"}
            </button>
          </span>
          {error ? <Notice kind="error-box">{error}</Notice> : null}
        </fieldset>
      </form>
      <div aria-live="polite">
        {created.length ? (
          <ul className="list-plain list-lines biz-accounts">
            {created.map((a) => (
              <li key={a.id}>
                <Icon name="check" size={16} /> <span className="strong">{a.business_name}</span> · {a.email} · {SECTOR_LABEL[a.sector] ?? a.sector}, {a.zona} ·{" "}
                {a.org.name}. Ya puede entrar al portal de negocios.
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
