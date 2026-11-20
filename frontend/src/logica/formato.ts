// Formatos colombianos: pesos (COP), números con punto de miles y coma decimal, fecha y hora de Bogotá.

const ZONA = "America/Bogota";

/** $ 1.250 ó $ 9,48 (con decimales solo cuando el valor es menor a 100 pesos). */
export function pesos(valor: number): string {
  const decimales = Math.abs(valor) < 100 ? 2 : 0;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

export function numero(valor: number, decimales = 0): string {
  return new Intl.NumberFormat("es-CO", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(valor);
}

/** 27/10/2026, 7:50 a. m. en hora de Colombia, sin importar la zona del equipo. */
export function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: ZONA,
  }).format(new Date(iso));
}

/** 20/12/2026 en hora de Colombia. */
export function fecha(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ZONA }).format(new Date(iso));
}

/** Saludo según la hora en Bogotá. */
export function saludo(ahora = new Date()): string {
  const hora = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: ZONA }).format(ahora));
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}
