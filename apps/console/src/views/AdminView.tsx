import { CENTRAL_ORG_ID, districtById } from "@blindaje/shared";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/client";
import { MIN_PASSWORD, type OrgKind, type OrgView, type UserView } from "../api/types";
import { useApi } from "../app/context";
import { DistrictSelect } from "../components/DistrictSelect";
import { Icon } from "../components/Icons";
import { CopyButton, ErrorBox, Loading, Notice, PageHead, useFlash } from "../components/ui";
import { ROLE_LABEL, fmtDate, zoneName } from "../lib/format";
import { useAsync } from "../lib/useAsync";

/** Tipos de canal de difusión. "alianza" queda para la organización central del equipo. */
const KIND_LABEL: Record<OrgKind, string> = {
  gremio: "Gremio",
  asociacion_mercado: "Asociación de mercado",
  junta_vecinal: "Junta vecinal",
  alianza: "Equipo central",
};
const CHANNEL_KINDS: OrgKind[] = ["gremio", "asociacion_mercado", "junta_vecinal"];

/** Canales de difusión: todas las organizaciones menos la central. */
export function channelsOf(orgs: OrgView[]): OrgView[] {
  return orgs.filter((o) => o.id !== CENTRAL_ORG_ID && o.kind !== "alianza");
}

export function AdminView() {
  const api = useApi();
  const orgs = useAsync(() => api.listOrgs(), "admin:orgs");
  const users = useAsync(() => api.listUsers(), "admin:users");
  const [flash, showFlash] = useFlash();
  const channels = channelsOf(orgs.data ?? []);

  return (
    <>
      <PageHead title="Administración">
        El equipo de Blindaje revisa y aprueba para todos los distritos. Las organizaciones solo difunden la app: no ven casos ni aprueban nada.
      </PageHead>
      {flash}
      <section className="panel stack-sm" aria-labelledby="users-titulo">
        <div className="panel-head">
          <h2 id="users-titulo">Equipo de la consola</h2>
        </div>
        <p className="small muted">
          Revisión confirma vínculos y aprueba alertas y consejos de cualquier distrito. Análisis hace lo mismo y además corre el Cartógrafo, el Vigía y el
          Asesor. Administración gestiona el equipo y los canales.
        </p>
        {users.error ? <ErrorBox error={users.error} onRetry={users.reload} /> : null}
        {!users.data && users.loading ? <Loading /> : null}
        {users.data ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Usuarios de la consola (se desplaza a los lados)">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Correo</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td className="strong">{u.display_name}</td>
                    <td>{u.email}</td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td>{u.disabled ? <span className="chip chip-danger">Desactivado</span> : <span className="chip chip-mint">Activo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <NewUserForm
          onCreated={(u) => {
            users.setData((prev) => [...(prev ?? []), u]);
            showFlash(`Usuario ${u.email} creado en ${ROLE_LABEL[u.role] ?? u.role}.`);
          }}
        />
      </section>

      <section className="panel stack-sm" aria-labelledby="orgs-titulo">
        <div className="panel-head">
          <h2 id="orgs-titulo">
            <Icon name="megaphone" /> Canales de difusión
          </h2>
        </div>
        <p className="small muted">
          Gremios, asociaciones y juntas que reparten la app. La víctima no necesita código: si usa uno, solo queda anotado por qué canal llegó a Blindaje.
        </p>
        {orgs.error ? <ErrorBox error={orgs.error} onRetry={orgs.reload} /> : null}
        {!orgs.data && orgs.loading ? <Loading /> : null}
        {orgs.data && channels.length === 0 ? <p className="small">Aún no hay canales de difusión.</p> : null}
        {channels.length ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Canales de difusión (se desplaza a los lados)">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Distrito</th>
                  <th scope="col" className="num">
                    Celulares con su código
                  </th>
                  <th scope="col">Creado</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((o) => (
                  <tr key={o.id}>
                    <td className="strong">{o.name}</td>
                    <td>{KIND_LABEL[o.kind] ?? o.kind}</td>
                    <td>{o.district ? zoneName(o.district) : "—"}</td>
                    <td className="num">{o.devices ?? "—"}</td>
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
            showFlash(`Canal “${o.name}” creado.`);
          }}
        />
        <InvitesPanel channels={channels} />
      </section>
    </>
  );
}

function NewOrgForm({ onCreated }: { onCreated: (o: OrgView) => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrgKind>("gremio");
  /** Id del distrito; a la API va su nombre, que es lo que guarda la organización. */
  const [district, setDistrict] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = districtById(district);
      onCreated(await api.createOrg(d ? { name, kind, district: d.name } : { name, kind }));
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
        <legend>Nuevo canal de difusión</legend>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="org-name">Nombre</label>
            <input id="org-name" type="text" required minLength={2} maxLength={160} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="org-kind">Tipo</label>
            <select id="org-kind" value={kind} onChange={(e) => setKind(e.target.value as OrgKind)}>
              {CHANNEL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="org-district">Distrito (opcional)</label>
            <DistrictSelect id="org-district" value={district} onChange={setDistrict} emptyLabel="Sin distrito" />
          </div>
        </div>
        <span>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Creando…" : "Crear canal"}
          </button>
        </span>
        {error ? <Notice kind="error-box">{error}</Notice> : null}
      </fieldset>
    </form>
  );
}

/** Todas las cuentas de consola son del equipo central (CENTRAL_ORG_ID). */
function NewUserForm({ onCreated }: { onCreated: (u: UserView) => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserView["role"]>("reviewer");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createUser({ email: email.trim(), display_name: name.trim(), role, org_id: CENTRAL_ORG_ID, password }));
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
        <legend>Nueva cuenta del equipo</legend>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="u-email">Correo</label>
            <input id="u-email" type="email" required autoComplete="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-name">Nombre visible</label>
            <input id="u-name" type="text" required minLength={2} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-role">Rol</label>
            <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as UserView["role"])}>
              <option value="reviewer">{ROLE_LABEL.reviewer}</option>
              <option value="analyst">{ROLE_LABEL.analyst}</option>
              <option value="admin">{ROLE_LABEL.admin}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-pass">Contraseña temporal</label>
            <input
              id="u-pass"
              type="password"
              required
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="u-pass-hint"
            />
            <span id="u-pass-hint" className="hint">
              Al menos {MIN_PASSWORD} caracteres. Entrégala por un canal seguro.
            </span>
          </div>
        </div>
        <span>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Creando…" : "Crear cuenta"}
          </button>
        </span>
        {error ? <Notice kind="error-box">{error}</Notice> : null}
      </fieldset>
    </form>
  );
}

/**
 * Códigos de invitación opcionales de un canal de difusión. Solo marcan por dónde llegó la persona:
 * no cambian lo que ve ni quién revisa su caso. Los genera la administración.
 */
export function InvitesPanel({ channels }: { channels: OrgView[] }) {
  const api = useApi();
  const [orgId, setOrgId] = useState("");
  const [count, setCount] = useState(5);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const org = orgId || channels[0]?.id || "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCodes(await api.createInvites({ org_id: org, count }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack-sm" onSubmit={(e) => void submit(e)} aria-labelledby="inv-titulo">
      <h3 id="inv-titulo" className="row">
        <Icon name="key" /> Códigos de un canal (opcional)
      </h3>
      <p className="small muted">
        Sirven para saber cuántas personas llegaron por cada canal. Cada código sirve una vez y vence en 30 días. Sin código, la app funciona igual.
      </p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="inv-org">Canal</label>
          <select id="inv-org" value={org} onChange={(e) => setOrgId(e.target.value)} disabled={!channels.length}>
            {channels.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 120 }}>
          <label htmlFor="inv-count">Cantidad</label>
          <input id="inv-count" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
        </div>
        <button type="submit" className="btn" disabled={busy || !org}>
          {busy ? "Generando…" : "Generar códigos"}
        </button>
      </div>
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
    </form>
  );
}
