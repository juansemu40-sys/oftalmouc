import { describe, expect, it } from "vitest";

// Revisión estática del código de la interfaz: React escapa todo lo que muestra como texto, así que un dictado
// o una explicación con "<script>" se ve como texto y no se ejecuta (XSS). Esa protección se pierde si alguien
// inserta HTML a mano. Esta prueba falla si aparece cualquiera de esas puertas traseras.
const fuentes = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const PELIGROSOS: [string, RegExp][] = [
  ["HTML sin escapar (dangerouslySetInnerHTML)", /dangerouslySetInnerHTML/],
  ["asignar innerHTML/outerHTML", /\.(inner|outer)HTML\s*=/],
  ["insertAdjacentHTML", /insertAdjacentHTML/],
  ["document.write", /document\.write/],
  ["eval", /\beval\s*\(/],
  ["new Function", /new\s+Function\s*\(/],
  ["enlaces javascript:", /["'`]javascript:/i],
];

describe("seguridad de la interfaz", () => {
  it("revisa todo el código fuente", () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(15);
  });

  it("no inserta HTML ni ejecuta texto como código (XSS)", () => {
    const hallazgos: string[] = [];
    for (const [archivo, codigo] of Object.entries(fuentes)) {
      for (const [nombre, patron] of PELIGROSOS) if (patron.test(codigo)) hallazgos.push(`${archivo}: ${nombre}`);
    }
    expect(hallazgos).toEqual([]);
  });

  it("no guarda contraseñas ni sesiones en el navegador", () => {
    // Revisa el NOMBRE con que se guarda cada dato (setItem directo o el ayudante guardarLocal).
    const secreto = /(clave|contrase|password|token|sesion|cookie)/i;
    const hallazgos: string[] = [];
    for (const [archivo, codigo] of Object.entries(fuentes)) {
      for (const m of codigo.matchAll(/(?:Storage\.setItem|guardarLocal)\(\s*["'`]([^"'`]+)["'`]/g)) {
        if (secreto.test(m[1])) hallazgos.push(`${archivo}: ${m[1]}`);
      }
      // La contraseña nunca se pasa a un almacenamiento, ni siquiera como valor.
      if (/(Storage\.setItem|guardarLocal)\([^)]*,\s*clave\b/.test(codigo) && !/function guardarLocal/.test(codigo)) {
        hallazgos.push(`${archivo}: guarda la variable "clave"`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  it("los enlaces que abren otra pestaña no le dan acceso a esta (noopener)", () => {
    const hallazgos: string[] = [];
    for (const [archivo, codigo] of Object.entries(fuentes)) {
      for (const etiqueta of codigo.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) {
        if (!/rel="[^"]*noopener/.test(etiqueta)) hallazgos.push(`${archivo}: ${etiqueta}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });
});
