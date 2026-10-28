import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import type { OrgKind, OrgView, UserView } from "../api/types";
import { useApi, useUser } from "../app/context";
import { Icon } from "../components/Icons";
import { CopyButton, ErrorBox, Loading, Notice, PageHead, useFlash } from "../components/ui";
import { ROLE_LABEL, fmtDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const KIND_LABEL: Record<OrgKind, string> = {
  gremio: "Gremio",
  asociacion_mercado: "Asociación de mercado",
  junta_vecinal: "Junta vecinal",
  alianza: "Alianza",
};

export function AdminView() {
  const api = useApi();
  const orgs = useAsync(() => api.listOrgs(), "admin:orgs");
  const users = useAsync(() => api.listUsers(), "admin:users");
  const [flash, showFlash] = useFlash();

  return (
    <>
      <PageHead title="Administración">
        Las organizaciones verifican a sus miembros antes de darles acceso: es la primera defensa contra la infiltración.
      </PageHead>
      {flash}
      <section className="panel stack-sm" aria-labelledby="orgs-titulo">
        <div className="panel-head">
          <h2 id="orgs-titulo">Organizaciones</h2>
        </div>
        {orgs.error ? <ErrorBox error={orgs.error} onRetry={orgs.reload} /> : null}
        {!orgs.data && orgs.loading ? <Loading /> : null}
        {orgs.data ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Distrito o zona</th>
                  <th scope="col">Creada</th>
                </tr>
              </thead>
              <tbody>
                {orgs.data.map((o) => (
                  <tr key={o.id}>
                    <td className="strong">{o.name}</td>
                    <td>{KIND_LABEL[o.kind] ?? o.kind}</td>
                    <td>{o.district ?? "—"}</td>
                    <td className="nowrap">{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <NewOrgForm
          onCreated={(o) => {
            orgs.setData((prev) => [...(prev ?? []), o]);
            showFlash(`Organización “${o.name}” creada.`);
          }}
        />
      </section>

      <InvitesPanel orgs={orgs.data ?? []} />

      <section className="panel stack-sm" aria-labelledby="users-titulo">
        <div className="panel-head">
          <h2 id="users-titulo">Usuarios de la consola</h2>
        </div>
        {users.error ? <ErrorBox error={users.error} onRetry={users.reload} /> : null}
        {!users.data && users.loading ? <Loading /> : null}
        {users.data ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Correo</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Organización</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td className="strong">{u.display_name}</td>
                    <td>{u.email}</td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td>{u.org.name}</td>
                    <td>{u.disabled ? <span className="chip chip-danger">Desactivado</span> : <span className="chip chip-mint">Activo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <NewUserForm
          orgs={orgs.data ?? []}
          onCreated={(u) => {
            users.setData((prev) => [...(prev ?? []), u]);
            showFlash(`Usuario ${u.email} creado como ${ROLE_LABEL[u.role] ?? u.role}.`);
          }}
        />
      </section>
    </>
  );
}

function NewOrgForm({ onCreated }: { onCreated: (o: OrgView) => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrgKind>("gremio");
  const [district, setDistrict] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createOrg(district.trim() ? { name, kind, district } : { name, kind }));
      setName("");
      setDistrict("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <fieldset className="stack-sm">
        <legend>Nueva organización</legend>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="org-name">Nombre</label>
            <input id="org-name" type="text" required minLength={3} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="org-kind">Tipo</label>
            <select id="org-kind" value={kind} onChange={(e) => setKind(e.target.value as OrgKind)}>
              {(Object.keys(KIND_LABEL) as OrgKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="org-district">Distrito o zona (opcional)</label>
            <input id="org-district" type="text" value={district} onChange={(e) => setDistrict(e.target.value)} />
          </div>
        </div>
        <span>
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 3}>
            {busy ? "Creando…" : "Crear organización"}
          </button>
        </span>
        {error ? <Notice kind="error-box">{error}</Notice> : null}
      </fieldset>
    </form>
  );
}

function NewUserForm({ orgs, onCreated }: { orgs: OrgView[]; onCreated: (u: UserView) => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserView["role"]>("reviewer");
  const [orgId, setOrgId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const org = orgId || orgs[0]?.id || "";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createUser({ email: email.trim(), display_name: name.trim(), role, org_id: org, password }));
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
    <form onSubmit={(e) => void submit(e)}>
      <fieldset className="stack-sm">
        <legend>Nuevo usuario</legend>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="u-email">Correo</label>
            <input id="u-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-name">Nombre visible</label>
            <input id="u-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-role">Rol</label>
            <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as UserView["role"])}>
              <option value="reviewer">Revisor (gremio)</option>
              <option value="analyst">Analista (alianza)</option>
              <option value="admin">Administración</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-org">Organización</label>
            <select id="u-org" value={org} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-pass">Contraseña temporal</label>
            <input
              id="u-pass"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="u-pass-hint"
            />
            <span id="u-pass-hint" className="hint">
              Al menos 8 caracteres. Entrégala por un canal seguro.
            </span>
          </div>
        </div>
        <span>
          <button type="submit" className="btn btn-primary" disabled={busy || !email || !name || password.length < 8 || !org}>
            {busy ? "Creando…" : "Crear usuario"}
          </button>
        </span>
        {error ? <Notice kind="error-box">{error}</Notice> : null}
      </fieldset>
    </form>
  );
}

/** Códigos de invitación para que las víctimas registren su app. El revisor solo genera para su organización. */
export function InvitesPanel({ orgs }: { orgs: OrgView[] }) {
  const api = useApi();
  const user = useUser();
  const [orgId, setOrgId] = useState("");
  const [count, setCount] = useState(5);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user.role === "admin";
  const org = isAdmin ? orgId || orgs.find((o) => o.kind !== "alianza")?.id || orgs[0]?.id || "" : user.org.id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCodes(await api.createInvites(isAdmin ? { org_id: org, count } : { count }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack-sm" aria-labelledby="inv-titulo">
      <div className="panel-head">
        <h2 id="inv-titulo">
          <Icon name="key" /> Códigos de invitación
        </h2>
      </div>
      <p className="small muted">
        Cada código registra un celular en la organización. Entrégalos en persona a miembros verificados; nunca por grupos abiertos.
      </p>
      <form className="row" style={{ alignItems: "flex-end" }} onSubmit={(e) => void submit(e)}>
        {isAdmin ? (
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="inv-org">Organización</label>
            <select id="inv-org" value={org} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p>
            Para <strong>{user.org.name}</strong>
          </p>
        )}
        <div className="field" style={{ width: 120 }}>
          <label htmlFor="inv-count">Cantidad</label>
          <input id="inv-count" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !org}>
          {busy ? "Generando…" : "Generar códigos"}
        </button>
      </form>
      {error ? <Notice kind="error-box">{error}</Notice> : null}
      {codes.length ? (
        <div className="stack-sm" aria-live="polite">
          <div className="codes">
            {codes.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
          <span>
            <CopyButton text={codes.join("\n")} label="Copiar todos" />
          </span>
          <span className="small muted">Los códigos no se vuelven a mostrar. Guárdalos ahora.</span>
        </div>
      ) : null}
    </section>
  );
}
