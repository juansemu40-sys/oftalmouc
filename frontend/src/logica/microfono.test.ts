import { describe, expect, it } from "vitest";
import { VENTANA, evaluar, medir, type Lectura } from "./microfono";

const onda = (amplitud: number, n = 2048) => Array.from({ length: n }, (_, i) => amplitud * Math.sin((2 * Math.PI * i) / 32));
const repetir = (l: Lectura, n = VENTANA) => Array.from({ length: n }, () => l);

describe("medidor del micrófono", () => {
  it("mide energía y pico de la señal", () => {
    const l = medir(onda(0.5));
    expect(l.pico).toBeCloseTo(0.5, 2);
    expect(l.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(medir([]).rms).toBe(0);
  });

  it("al empezar solo escucha (no alarma antes de tiempo)", () => {
    expect(evaluar(repetir(medir(onda(0.001)), 5)).estado).toBe("midiendo");
  });

  it("voz normal: se oye bien", () => {
    const r = evaluar(repetir(medir(onda(0.2))));
    expect(r.estado).toBe("bien");
    expect(r.porcentaje).toBeGreaterThan(60);
  });

  it("voz lejana: pide acercarse", () => {
    const r = evaluar(repetir(medir(onda(0.02))));
    expect(r.estado).toBe("bajo");
    expect(r.mensaje).toContain("acérquese");
  });

  it("sin señal 2 segundos: revisar el micrófono", () => {
    expect(evaluar(repetir(medir(onda(0.001)))).estado).toBe("silencio");
  });

  it("las pausas al hablar no cuentan como silencio", () => {
    const lecturas = [...repetir(medir(onda(0.2)), 4), ...repetir(medir(onda(0.001)), 16)];
    expect(evaluar(lecturas).estado).toBe("bien");
  });

  it("muy cerca del micrófono: avisa la saturación", () => {
    const lecturas = [...repetir(medir(onda(0.3)), 15), ...repetir(medir(onda(1)), 5)];
    expect(evaluar(lecturas).estado).toBe("saturado");
  });
});
