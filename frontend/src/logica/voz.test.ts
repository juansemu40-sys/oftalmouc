import { describe, expect, it } from "vitest";
import { dividirEnFrases, elegirVoz, textoParaVoz } from "./voz";

describe("textoParaVoz", () => {
  it("lee Snellen y siglas como una persona", () => {
    const t = textoParaVoz("AV en OD 20/40 y en OI 20/80. PIO del OI: 23 mmHg");
    expect(t).toContain("20 sobre 40");
    expect(t).toContain("ojo derecho");
    expect(t).toContain("presión intraocular");
    expect(t).toContain("milímetros de mercurio");
    expect(t).not.toContain("/");
  });

  it("decimales, él/ella y pausa al final de cada párrafo", () => {
    const t = textoParaVoz("Excavación 0.6\n\nRevisada por él/ella");
    expect(t).toBe("Excavación 0 coma 6.\n\nRevisada por él o ella.");
  });

  it("los paréntesis se leen como pausas", () => {
    expect(textoParaVoz("Agudeza visual (qué tan bien ve de lejos): ojo derecho 20/40"))
      .toBe("Agudeza visual, qué tan bien ve de lejos: ojo derecho 20 sobre 40.");
  });
});

describe("dividirEnFrases", () => {
  it("parte por frases y nunca deja una frase demasiado larga", () => {
    const largo = "Recuerde pedir a tiempo las citas, los exámenes, las gafas, las gotas, los controles, y todo lo demás que le indicó su médico.";
    const frases = dividirEnFrases(`Hola. Le explico: ${largo}`, 60);
    expect(frases[0]).toBe("Hola.");
    expect(frases.every((f) => f.length <= 60 || !f.includes(","))).toBe(true);
    expect(frases.join(" ")).toBe(`Hola. Le explico: ${largo}`);
  });
});

describe("elegirVoz", () => {
  it("prefiere español de Colombia y luego de México", () => {
    const voces = [{ lang: "en-US", name: "a" }, { lang: "es-MX", name: "b" }, { lang: "es-CO", name: "c" }];
    expect(elegirVoz(voces)).toBe(2);
    expect(elegirVoz(voces.slice(0, 2))).toBe(1);
    expect(elegirVoz([{ lang: "en-US", name: "a" }])).toBe(-1);
  });

  it("una voz natural gana a una robótica aunque sea de otra región", () => {
    const voces = [
      { lang: "es-CO", name: "Microsoft Helena" },
      { lang: "es-MX", name: "Microsoft Dalia Online (Natural) - Spanish (Mexico)" },
    ];
    expect(elegirVoz(voces)).toBe(1);
  });
});
