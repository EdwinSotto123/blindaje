import type { DisguiseRepo } from "@/disguise/repo";

/** Repositorio del disfraz. La app usa SQLite; los tests inyectan uno en memoria. */
let repo: DisguiseRepo | null = null;

export function getDisguiseRepo(): DisguiseRepo {
  if (!repo) {
    // Carga perezosa para no abrir SQLite en los tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SqliteDisguiseRepo } = require("@/disguise/sqliteRepo") as typeof import("@/disguise/sqliteRepo");
    repo = new SqliteDisguiseRepo();
  }
  return repo;
}

export function setDisguiseRepo(r: DisguiseRepo): void {
  repo = r;
}
