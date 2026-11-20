// Dónde puede abrirse el código QR del paciente, según la dirección que lleva dentro.
import type { EnlacePaciente } from "../tipos";

export type Alcance = "internet" | "wifi" | "local";

/** Arma la dirección que va dentro del QR: la que da el servidor (Tailscale o Wi-Fi) o, si no hay, la del navegador. */
export function direccionEnlace(enlace: EnlacePaciente, urlPublica: string | null | undefined, origen: string): string {
  if (enlace.url) return enlace.url;
  return `${(urlPublica || origen).replace(/\/+$/, "")}${enlace.ruta}`;
}

/**
 * - "local": localhost / 127.x / ::1 → solo existe en este computador.
 * - "wifi": IP privada (192.168.x, 10.x, 172.16-31.x) o nombre sin punto → solo en la misma red.
 * - "internet": cualquier otra dirección (p. ej. https://pc.tailnet.ts.net) → desde cualquier red.
 */
export function alcanceEnlace(url: string): Alcance {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "local";
  }
  if (host === "localhost" || host === "::1" || /^127\./.test(host)) return "local";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) || !host.includes(".") || host.endsWith(".local")) {
    return "wifi";
  }
  return "internet";
}
