// Texto pensado para el oído: lo mismo que hace el backend (app/ia/voz.py) para la voz del navegador.
// No cambia el contenido; solo cómo se pronuncia.

const SIGLAS: [RegExp, string][] = [
  [/\bmm\s?Hg\b/g, "milímetros de mercurio"],
  [/\bPIO\b/g, "presión intraocular"],
  [/\bOD\b/g, "ojo derecho"],
  [/\bOI\b/g, "ojo izquierdo"],
  [/\bAO\b/g, "ambos ojos"],
  [/\bAV\b/g, "agudeza visual"],
  [/\bEPS\b/g, "E P S"],
  [/\bIPS\b/g, "I P S"],
  [/\bIA\b/g, "inteligencia artificial"],
];

export function textoParaVoz(texto: string): string {
  let t = texto.replace(/\r\n/g, "\n");
  t = t.replace(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g, "$1 sobre $2"); // 20/40 -> 20 sobre 40
  t = t.replace(/([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\/([A-Za-zÁÉÍÓÚáéíóúÑñ]+)/g, "$1 o $2"); // él/ella -> él o ella
  for (const [patron, lectura] of SIGLAS) t = t.replace(patron, lectura);
  t = t.replace(/\b(\d+)\.(\d+)\b/g, "$1 coma $2"); // 0.6 -> 0 coma 6
  // Paréntesis como pausas: "Agudeza visual (qué tan bien ve de lejos):" -> "Agudeza visual, qué tan bien ve de lejos:"
  t = t.replace(/\s*\(([^()]*)\)/g, ", $1,").replace(/,\s*([:.;!?])/g, "$1").replace(/,\s*,/g, ",");
  t = t.replace(/^\s*[-•*·]\s+/gm, "");
  return t
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/[ \t]+/g, " "))
    .filter(Boolean)
    .map((p) => (/[.!?:]$/.test(p) ? p : `${p}.`))
    .join("\n\n");
}

/**
 * Parte el texto en frases cortas. La voz del navegador lee frase por frase: así no se corta
 * (Chrome deja de hablar en textos largos, a los ~15 s) y las pausas caen donde deben.
 */
export function dividirEnFrases(texto: string, maximo = 180): string[] {
  const frases = texto.split(/(?<=[.!?:])\s+/).map((f) => f.trim()).filter(Boolean);
  const salida: string[] = [];
  for (const frase of frases) {
    if (frase.length <= maximo) {
      salida.push(frase);
      continue;
    }
    let actual = "";
    for (const parte of frase.split(/(?<=[,;])\s+/)) {
      if (actual && `${actual} ${parte}`.length > maximo) {
        salida.push(actual);
        actual = parte;
      } else {
        actual = actual ? `${actual} ${parte}` : parte;
      }
    }
    if (actual) salida.push(actual);
  }
  return salida;
}

export interface VozDisponible {
  lang: string;
  name: string;
  localService?: boolean;
}

/** Puntaje de una voz del navegador: primero las voces naturales, luego español de Colombia. -1 = no sirve. */
export function puntajeVoz(voz: VozDisponible): number {
  const idioma = voz.lang.toLowerCase().replace("_", "-");
  if (!idioma.startsWith("es")) return -1;
  const regiones = ["es-co", "es-mx", "es-us", "es-419", "es-es"];
  const r = regiones.findIndex((region) => idioma.startsWith(region));
  let puntaje = r >= 0 ? (regiones.length - r) * 10 : 5;
  const nombre = voz.name.toLowerCase();
  if (nombre.includes("natural")) puntaje += 100; // Edge: "Microsoft Salome Online (Natural)"
  else if (nombre.includes("online") || nombre.includes("google")) puntaje += 60;
  return puntaje;
}

/** Índice de la mejor voz en español, o -1 si no hay ninguna. */
export function elegirVoz(voces: VozDisponible[]): number {
  let mejor = -1;
  let mejorPuntaje = -1;
  voces.forEach((v, i) => {
    const p = puntajeVoz(v);
    if (p > mejorPuntaje) {
      mejor = i;
      mejorPuntaje = p;
    }
  });
  return mejorPuntaje >= 0 ? mejor : -1;
}

/** Las voces "Natural"/"Online" y las de Google suenan mejor, pero envían el texto a internet para leerlo. */
export const vozEnLinea = (voz: VozDisponible) =>
  /natural|online|google/i.test(voz.name) || voz.localService === false;
