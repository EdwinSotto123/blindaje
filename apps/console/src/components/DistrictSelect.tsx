import { DISTRICTS, ZONE_AREAS, type District } from "@blindaje/shared";

/** Los 50 distritos agrupados por área y en orden alfabético dentro de cada una. */
export const DISTRICTS_BY_AREA: { area: string; districts: District[] }[] = ZONE_AREAS.map((area) => ({
  area,
  districts: DISTRICTS.filter((d) => d.area === area).sort((a, b) => a.name.localeCompare(b.name, "es")),
}));

/**
 * Selector de distrito de la lista fija (docs/rediseno.md, Zonas). El valor es el id del distrito;
 * nunca se pide una dirección ni algo más fino.
 */
export function DistrictSelect({
  id,
  value,
  onChange,
  emptyLabel,
  describedBy,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  /** Texto de la opción vacía ("Elige un distrito", "Sin distrito"). */
  emptyLabel: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
      <option value="">{emptyLabel}</option>
      {DISTRICTS_BY_AREA.map((g) => (
        <optgroup key={g.area} label={g.area}>
          {g.districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
