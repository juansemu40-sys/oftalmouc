// Medidor de volumen del micrófono mientras se graba el dictado.
// La causa más común de una mala transcripción es el audio: muy bajo (micrófono lejos), saturado (muy cerca)
// o sin señal (micrófono equivocado). Esto lo detecta en vivo para que el médico lo corrija antes de terminar.

export type EstadoNivel = "midiendo" | "silencio" | "bajo" | "bien" | "saturado";

export interface Lectura {
  rms: number; // energía de la señal (0 a 1)
  pico: number; // muestra más alta (0 a 1): cerca de 1 = saturación
}

/** Lecturas que se miran para decidir (2 s a 10 lecturas por segundo): la voz tiene pausas naturales. */
export const VENTANA = 20;

const UMBRAL_SILENCIO = 0.004; // ~ -48 dB: solo ruido de fondo
const UMBRAL_BAJO = 0.03; // ~ -30 dB: voz lejana
const UMBRAL_PICO = 0.98;

export function medir(muestras: ArrayLike<number>): Lectura {
  let suma = 0;
  let pico = 0;
  for (let i = 0; i < muestras.length; i++) {
    const v = muestras[i];
    suma += v * v;
    const a = Math.abs(v);
    if (a > pico) pico = a;
  }
  return { rms: muestras.length ? Math.sqrt(suma / muestras.length) : 0, pico };
}

/** Nivel para la barra (0-100, escala en decibeles como un vúmetro) y el aviso para el médico. */
export function evaluar(lecturas: Lectura[]): { porcentaje: number; estado: EstadoNivel; mensaje: string } {
  const recientes = lecturas.slice(-VENTANA);
  const ultima = recientes[recientes.length - 1];
  const db = 20 * Math.log10(Math.max(ultima?.rms ?? 0, 1e-6));
  const porcentaje = Math.round(Math.min(100, Math.max(0, ((db + 60) / 60) * 100)));
  const masFuerte = recientes.reduce((m, l) => Math.max(m, l.rms), 0);
  const saturadas = recientes.filter((l) => l.pico >= UMBRAL_PICO).length;

  if (recientes.length < 10) return { porcentaje, estado: "midiendo", mensaje: "Escuchando…" };
  if (saturadas >= 3) return { porcentaje, estado: "saturado", mensaje: "Se oye saturado: aléjese un poco del micrófono." };
  if (recientes.length >= VENTANA && masFuerte < UMBRAL_SILENCIO) {
    return { porcentaje, estado: "silencio", mensaje: "No se oye nada: revise que esté activo el micrófono correcto." };
  }
  if (masFuerte < UMBRAL_BAJO) {
    return { porcentaje, estado: "bajo", mensaje: "Se oye bajo: acérquese al micrófono o hable un poco más fuerte." };
  }
  return { porcentaje, estado: "bien", mensaje: "Se oye bien." };
}
