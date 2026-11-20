import { describe, expect, it } from "vitest";
import { fechaHora, numero, pesos, saludo } from "./formato";

const sinEspacios = (t: string) => t.replace(/\s/g, " ");

describe("formatos colombianos", () => {
  it("muestra pesos con punto de miles y coma decimal", () => {
    expect(sinEspacios(pesos(1250))).toBe("$ 1.250");
    expect(sinEspacios(pesos(9.48))).toBe("$ 9,48");
  });

  it("separa miles con punto", () => {
    expect(numero(20940)).toBe("20.940");
  });

  it("usa la hora de Bogotá (UTC-5)", () => {
    // 12:50 UTC = 7:50 a. m. en Bogotá
    expect(fechaHora("2026-10-27T12:50:00Z")).toContain("7:50");
  });

  it("saluda según la hora de Bogotá", () => {
    expect(saludo(new Date("2026-10-27T13:00:00Z"))).toBe("Buenos días"); // 8:00 a. m.
    expect(saludo(new Date("2026-10-27T20:00:00Z"))).toBe("Buenas tardes"); // 3:00 p. m.
    expect(saludo(new Date("2026-10-28T02:00:00Z"))).toBe("Buenas noches"); // 9:00 p. m.
  });
});
