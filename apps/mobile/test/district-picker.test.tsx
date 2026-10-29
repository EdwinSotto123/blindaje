/**
 * Selector de distrito: búsqueda sin tildes y por nombres conocidos, agrupado por área, y el
 * componente (buscar, elegir, "Prefiero no decirlo"), con toques grandes y roles accesibles.
 */
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buscarDistritos, DistrictPicker, porArea } from "@/private/DistrictPicker";
import { DISTRICTS, ZONE_AREAS } from "@/shared";

const ids = (q: string) => buscarDistritos(q).map((d) => d.id);

describe("Buscar distritos", () => {
  it("sin texto, los 50 de Lima Metropolitana y el Callao", () => {
    expect(buscarDistritos("")).toHaveLength(50);
    expect(buscarDistritos("   ")).toHaveLength(DISTRICTS.length);
  });

  it("sin importar tildes ni mayúsculas", () => {
    expect(ids("rimac")).toEqual(["rimac"]);
    expect(ids("RÍMAC")).toEqual(["rimac"]);
    expect(ids("jesus maria")).toEqual(["jesus-maria"]);
  });

  it("por parte del nombre", () => {
    expect(ids("lurig").sort()).toEqual(["lurigancho", "san-juan-de-lurigancho"]);
  });

  it("por nombre corto o por el nombre con que se conoce", () => {
    expect(ids("SJL")).toEqual(["san-juan-de-lurigancho"]);
    expect(ids("ves")).toEqual(["villa-el-salvador"]);
    expect(ids("Surco")).toEqual(["santiago-de-surco"]);
    expect(ids("Chosica")).toEqual(["lurigancho"]);
    expect(ids("Cercado de Lima")).toContain("lima");
  });

  it("nada si no es un distrito", () => {
    expect(ids("Av. Siempre Viva 742")).toEqual([]);
  });

  it("agrupa por área en orden fijo y ordena por nombre", () => {
    const grupos = porArea(DISTRICTS);
    expect(grupos.map((g) => g.area)).toEqual([...ZONE_AREAS]);
    expect(grupos.reduce((n, g) => n + g.distritos.length, 0)).toBe(50);
    for (const g of grupos) {
      const nombres = g.distritos.map((d) => d.name);
      expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, "es")));
    }
    // Las áreas sin resultados no aparecen.
    expect(porArea(buscarDistritos("callao")).map((g) => g.area)).toEqual(["Callao"]);
  });
});

describe("DistrictPicker", () => {
  it("se abre, busca, elige y se cierra", async () => {
    const onChange = jest.fn();
    await render(<DistrictPicker label="Tu distrito (opcional)" value={null} onChange={onChange} />);
    expect(screen.getByLabelText("Tu distrito (opcional): Sin elegir")).toBeTruthy();
    expect(screen.queryByTestId("distrito-lista")).toBeNull();

    await fireEvent.press(screen.getByTestId("distrito"));
    expect(screen.getByTestId("distrito").props.accessibilityState).toMatchObject({ expanded: true });
    // Agrupado por área, con encabezados.
    expect(screen.getAllByRole("header").map((h) => h.props.children)).toEqual([...ZONE_AREAS]);
    expect(screen.getAllByRole("radio")).toHaveLength(51);

    await fireEvent.changeText(screen.getByTestId("distrito-buscar"), "lurig");
    expect(screen.getByText("2 distritos")).toBeTruthy();
    expect(screen.queryByText("Comas")).toBeNull();
    await fireEvent.press(screen.getByLabelText("San Juan de Lurigancho"));
    expect(onChange).toHaveBeenCalledWith("san-juan-de-lurigancho");
    expect(screen.queryByTestId("distrito-lista")).toBeNull();
  });

  it("muestra el distrito elegido, marcado en la lista", async () => {
    await render(<DistrictPicker label="Tu distrito" value="ate" onChange={() => undefined} />);
    expect(screen.getByLabelText("Tu distrito: Ate")).toBeTruthy();
    expect(screen.getByText("Lima Este")).toBeTruthy();
    expect(screen.getByText("Cambiar")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("distrito"));
    expect(screen.getByLabelText("Ate").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText("Comas").props.accessibilityState).toMatchObject({ checked: false });
  });

  it("“Prefiero no decirlo” deja la zona vacía", async () => {
    const onChange = jest.fn();
    await render(<DistrictPicker label="Tu distrito" value="comas" onChange={onChange} />);
    await fireEvent.press(screen.getByTestId("distrito"));
    await fireEvent.press(screen.getByLabelText("Prefiero no decirlo"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("si no encuentra nada, lo dice y deja elegir “Prefiero no decirlo”", async () => {
    await render(<DistrictPicker label="Tu distrito" value={null} onChange={() => undefined} />);
    await fireEvent.press(screen.getByTestId("distrito"));
    await fireEvent.changeText(screen.getByTestId("distrito-buscar"), "zzz");
    expect(screen.getByText(/No encontramos ese distrito/)).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByLabelText("Prefiero no decirlo")).toBeTruthy();
  });

  it("cada opción es un toque grande (48 dp o más)", async () => {
    await render(<DistrictPicker label="Tu distrito" value={null} onChange={() => undefined} />);
    expect(StyleSheet.flatten(screen.getByTestId("distrito").props.style).minHeight).toBeGreaterThanOrEqual(48);
    await fireEvent.press(screen.getByTestId("distrito"));
    for (const r of screen.getAllByRole("radio")) expect(StyleSheet.flatten(r.props.style).minHeight).toBeGreaterThanOrEqual(48);
  });
});
