import { describe, expect, it } from "vitest";
import { alcanceEnlace, direccionEnlace } from "./enlace";
import type { EnlacePaciente } from "../tipos";

const enlace = (url: string | null): EnlacePaciente => ({
  token: "Xq3_9kTz-Lm2Pq8sVb7wNa", ruta: "/p/Xq3_9kTz-Lm2Pq8sVb7wNa", url,
  creado_en: "", expira_en: "", aperturas: 0, ultima_apertura: null,
});

describe("dónde abre el código QR", () => {
  it("con Tailscale abre desde cualquier red", () => {
    expect(alcanceEnlace("https://pc-juan.tail1234.ts.net/p/abc")).toBe("internet");
  });

  it("con la IP del Wi-Fi solo abre en la misma red", () => {
    for (const u of ["http://192.168.1.20:8080/p/abc", "http://10.0.0.5:8080/p/abc", "http://172.20.3.4:8080/p/abc", "http://mi-pc:8080/p/abc"]) {
      expect(alcanceEnlace(u)).toBe("wifi");
    }
  });

  it("localhost solo existe en este computador", () => {
    for (const u of ["http://localhost:8080/p/abc", "http://127.0.0.1:8080/p/abc", "http://[::1]:8080/p/abc", "no es url"]) {
      expect(alcanceEnlace(u)).toBe("local");
    }
  });

  it("usa la dirección del servidor y, si no hay, la del navegador", () => {
    expect(direccionEnlace(enlace("https://pc.ts.net/p/x"), null, "http://localhost:8080")).toBe("https://pc.ts.net/p/x");
    expect(direccionEnlace(enlace(null), "http://192.168.1.20:8080/", "http://localhost:8080"))
      .toBe("http://192.168.1.20:8080/p/Xq3_9kTz-Lm2Pq8sVb7wNa");
    expect(direccionEnlace(enlace(null), null, "http://localhost:8080")).toBe("http://localhost:8080/p/Xq3_9kTz-Lm2Pq8sVb7wNa");
  });
});
