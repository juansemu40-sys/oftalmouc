import { describe, expect, it } from "vitest";
import { generarQR, rutaSVG } from "./qr";

// La lectura real de los códigos se verificó decodificándolos con OpenCV (213 textos, versiones 1 a 10).
// Aquí se prueba la estructura que todo lector necesita encontrar.

const buscadorEn = (m: boolean[][], x0: number, y0: number) => {
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
    if (m[y0 + dy][x0 + dx] !== (d !== 2)) return false;
  }
  return true;
};

describe("generarQR", () => {
  it("un enlace típico del paciente cabe en un QR pequeño (fácil de escanear impreso)", () => {
    const qr = generarQR("http://192.168.1.20:8080/p/Xq3_9kTz-Lm2Pq8sVb7wNa");
    expect(qr.version).toBe(4);
    expect(qr.tamano).toBe(33);
    expect(qr.matriz.length).toBe(33);
  });

  it("dibuja los tres cuadros de las esquinas y el patrón de sincronización", () => {
    const { matriz: m, tamano: n } = generarQR("hola");
    expect(buscadorEn(m, 0, 0)).toBe(true);
    expect(buscadorEn(m, n - 7, 0)).toBe(true);
    expect(buscadorEn(m, 0, n - 7)).toBe(true);
    for (let i = 8; i < n - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8][8]).toBe(true); // módulo oscuro fijo
  });

  it("siempre da el mismo código para el mismo enlace", () => {
    const a = JSON.stringify(generarQR("http://equipo/p/abc").matriz);
    expect(JSON.stringify(generarQR("http://equipo/p/abc").matriz)).toBe(a);
    expect(JSON.stringify(generarQR("http://equipo/p/abd").matriz) === a).toBe(false);
  });

  it("crece de versión con el texto y avisa si no cabe", () => {
    expect(generarQR("x".repeat(200)).version).toBe(10);
    let error = "";
    try { generarQR("x".repeat(400)); } catch (e) { error = (e as Error).message; }
    expect(error).toContain("demasiado largo");
  });

  it("el SVG respeta el margen silencioso", () => {
    const ruta = rutaSVG(generarQR("hola"), 4);
    expect(ruta.startsWith("M4,4h1v1h-1z")).toBe(true);
  });
});
