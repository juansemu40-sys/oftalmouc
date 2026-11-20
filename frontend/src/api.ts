// Cliente HTTP. Convierte cualquier fallo (HTTP, red, tiempo de espera) en un ErrorApi con
// mensaje legible: la interfaz nunca muestra un stack trace ni un "Failed to fetch".
import type {
  Consulta,
  ConsultaResumen,
  DatosNuevaConsulta,
  Ejemplo,
  EnlacePaciente,
  ExplicacionPaciente,
  HistoriaClinica,
  RespuestaTrazas,
  Salud,
} from "./tipos";

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    public codigo: string,
    public trazaId?: string,
    public detalle?: Record<string, unknown>,
  ) {
    super(mensaje);
  }
}

/** Evento que avisa a la app que la sesión del médico venció (401): se vuelve a la pantalla de ingreso. */
export const EVENTO_SESION_VENCIDA = "oftalmouc:sesion-vencida";

function avisarSiVencio(status: number, codigo: string | undefined, ruta: string) {
  if (status === 401 && codigo === "sesion_requerida" && !ruta.startsWith("/sesion")) {
    window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA));
  }
}

const TIEMPO_NORMAL = 30_000;
const TIEMPO_IA = 200_000; // Whisper en CPU y el agente pueden tardar

async function pedir<T>(ruta: string, opciones: RequestInit = {}, tiempoMs = TIEMPO_NORMAL): Promise<T> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), tiempoMs);
  try {
    // same-origin: la cookie de sesión (HttpOnly) viaja sola; JavaScript nunca la ve.
    const r = await fetch(`/api${ruta}`, { credentials: "same-origin", ...opciones, signal: control.signal });
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) {
      const e = cuerpo?.error;
      avisarSiVencio(r.status, e?.codigo, ruta);
      throw new ErrorApi(
        e?.mensaje ?? `El servidor respondió con un error (${r.status}).`,
        e?.codigo ?? `http_${r.status}`,
        e?.traza_id,
        e?.detalle,
      );
    }
    return cuerpo as T;
  } catch (e) {
    if (e instanceof ErrorApi) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ErrorApi("La operación superó el tiempo de espera del navegador. Reintente.", "timeout_cliente");
    }
    throw new ErrorApi(
      "No hay conexión con el servidor. Verifique que Docker Desktop esté abierto y que la aplicación esté en ejecución (iniciar.bat).",
      "sin_conexion",
    );
  } finally {
    clearTimeout(reloj);
  }
}

export interface AudioExplicacion {
  blob: Blob;
  duracionS: number;
  motor: string;
  formato: "wav" | "mp3";
}

/** Descarga el audio (WAV) de la explicación aprobada, con el mismo manejo de errores que `pedir`. */
async function pedirAudio(ruta: string): Promise<AudioExplicacion> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_IA);
  try {
    const r = await fetch(`/api${ruta}`, { credentials: "same-origin", signal: control.signal });
    if (!r.ok) {
      const e = (await r.json().catch(() => null))?.error;
      avisarSiVencio(r.status, e?.codigo, ruta);
      throw new ErrorApi(e?.mensaje ?? `No se pudo generar el audio (${r.status}).`, e?.codigo ?? `http_${r.status}`, e?.traza_id);
    }
    return {
      blob: await r.blob(),
      duracionS: Number(r.headers.get("X-Duracion-Audio") ?? 0),
      motor: r.headers.get("X-Motor-Voz") ?? "",
      formato: r.headers.get("X-Formato-Audio") === "mp3" ? "mp3" : "wav",
    };
  } catch (e) {
    if (e instanceof ErrorApi) throw e;
    throw new ErrorApi("No hay conexión con el servidor para generar el audio.", "sin_conexion");
  } finally {
    clearTimeout(reloj);
  }
}

const json = (cuerpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo),
});

export const api = {
  // Acceso del médico
  sesion: () => pedir<{ usuario: string }>("/sesion"),
  iniciarSesion: (usuario: string, clave: string) => pedir<{ usuario: string }>("/sesion", json({ usuario, clave })),
  cerrarSesion: () => pedir<{ cerrada: boolean }>("/sesion", { method: "DELETE" }),
  salud: () => pedir<Salud>("/salud"),
  ejemplos: () => pedir<Ejemplo[]>("/ejemplos"),
  listar: () => pedir<ConsultaResumen[]>("/consultas"),
  obtener: (id: string) => pedir<Consulta>(`/consultas/${id}`),
  crear: (datos: DatosNuevaConsulta) => pedir<Consulta>("/consultas", json(datos)),
  subirAudio: (id: string, audio: Blob, nombre: string) => {
    const datos = new FormData();
    datos.append("audio", audio, nombre);
    return pedir<Consulta>(`/consultas/${id}/audio`, { method: "POST", body: datos }, TIEMPO_IA);
  },
  fijarTranscripcion: (id: string, texto: string) =>
    pedir<Consulta>(`/consultas/${id}/transcripcion`, { ...json({ texto }), method: "PUT" }),
  extraer: (id: string) => pedir<Consulta>(`/consultas/${id}/extraccion`, { method: "POST" }, TIEMPO_IA),
  revisar: (id: string, historia: HistoriaClinica, alertas_resueltas: string[], medico: string, confirmo_revision: boolean) =>
    pedir<Consulta>(`/consultas/${id}/revision`, json({ historia, alertas_resueltas, medico, confirmo_revision })),
  explicar: (id: string) => pedir<Consulta>(`/consultas/${id}/explicacion`, { method: "POST" }, TIEMPO_IA),
  aprobar: (id: string, explicacion_final: string, medico: string, confirmo_aprobacion: boolean) =>
    pedir<Consulta>(`/consultas/${id}/aprobacion`, json({ explicacion_final, medico, confirmo_aprobacion })),
  trazas: (id: string) => pedir<RespuestaTrazas>(`/consultas/${id}/trazas`),
  audioExplicacion: (id: string) => pedirAudio(`/consultas/${id}/audio-explicacion`),
  enlacePaciente: (id: string) => pedir<EnlacePaciente | null>(`/consultas/${id}/enlace-paciente`),
  crearEnlacePaciente: (id: string) => pedir<EnlacePaciente>(`/consultas/${id}/enlace-paciente`, { method: "POST" }),
  anularEnlacePaciente: (id: string) => pedir<{ anulados: number }>(`/consultas/${id}/enlace-paciente`, { method: "DELETE" }),
  // Lo que abre el celular del paciente (solo con el token del QR).
  paciente: (token: string) => pedir<ExplicacionPaciente>(`/paciente/${token}`),
  audioPaciente: (token: string) => pedirAudio(`/paciente/${token}/audio`),
  simularFalla: (tipo: string | null) => pedir<{ proxima_falla: string | null }>("/demo/falla", json({ tipo })),
};
