import type { BusinessMe } from "@blindaje/shared";
import type { Env } from "../env";

/** Cuenta del portal de negocios (rol `business`). Ver infra/migrations/0002_business.sql. */
export interface BusinessAccountRow {
  id: string;
  org_id: string;
  email: string;
  password_hash: string;
  business_name: string;
  sector: string;
  zona: string;
  disabled: number;
  is_demo: number;
  created_by: string | null;
  created_at: string;
  last_login_at: string | null;
  org_name: string;
}

const SELECT = "SELECT b.*, o.name AS org_name FROM business_accounts b JOIN organizations o ON o.id = b.org_id";

export async function getBusinessById(env: Env, id: string): Promise<BusinessAccountRow | null> {
  return env.DB.prepare(`${SELECT} WHERE b.id = ?`).bind(id).first<BusinessAccountRow>();
}

export async function getBusinessByEmail(env: Env, email: string): Promise<BusinessAccountRow | null> {
  return env.DB.prepare(`${SELECT} WHERE b.email = ?`).bind(email.trim().toLowerCase()).first<BusinessAccountRow>();
}

export function businessMeView(b: BusinessAccountRow): BusinessMe {
  return {
    id: b.id,
    email: b.email,
    business_name: b.business_name,
    sector: b.sector,
    zona: b.zona,
    org: { id: b.org_id, name: b.org_name },
  };
}
