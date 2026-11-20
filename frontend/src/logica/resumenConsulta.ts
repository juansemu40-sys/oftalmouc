// Traduce las trazas técnicas (llamada_1, extractor_determinista, guarda_no_diagnostico_2…) a las etapas
// de la consulta, en palabras de consultorio. Es lo que ve el médico; la vista técnica sigue disponible aparte.
import type { Traza } from "../tipos";

export type EstadoEtapa = "hecho" | "atencion" | "problema" | "en_curso";
export type Quien = "ia" | "medico" | "sistema";

export interface Etapa {
  clave: string;
  titulo: string;
  quien: Quien;
  estado: EstadoEtapa;
  segundos?: number;
  detalles: string[];
}

export interface ResumenSimple {
  etapas: Etapa[];
  estadoGeneral: "bien" | "revisar" | "problema" | "vacio";
  segundosIA: number;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const seg = (ms: number) => Math.round(ms / 100) / 10;
const fin = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];

// Causas de fallo de la IA, dichas como se las diría un colega.
const CAUSAS: Record<string, string> = {
  ia_timeout: "La IA tardó demasiado en responder.",
  ia_no_disponible: "No hubo conexión con el servicio de IA (internet o antivirus).",
  ia_limite_tasa: "El servicio de IA recibió demasiadas solicitudes; espere un minuto.",
  configuracion_incompleta: "Falta la llave de la IA o no es válida.",
  respuesta_invalida: "La IA respondió con un formato incorrecto.",
  audio_invalido: "El audio no se pudo procesar (formato, tamaño o sin voz).",
  voz_proveedor: "El servicio de voz no respondió (llave, créditos o conexión).",
  voz_no_disponible: "La voz del servidor no está instalada.",
};
const causa = (t: Traza) => CAUSAS[String(t.detalle?.codigo ?? t.detalle?.error ?? "")] ?? "Ocurrió un error inesperado.";

export function resumirConsulta(trazas: Traza[]): ResumenSimple {
  const etapas: Etapa[] = [];
  const por = (f: (t: Traza) => boolean) => trazas.filter(f);
  const ultima = (nombre: string) => [...trazas].reverse().find((t) => t.nombre === nombre);
  let segundosIA = 0;

  // ---- 1. Apertura
  if (ultima("consulta_creada")) {
    etapas.push({ clave: "abrir", titulo: "Se abrió la consulta", quien: "sistema", estado: "hecho", detalles: [] });
  }

  // ---- 2. Dictado
  const audios = por((t) => t.tipo === "whisper");
  const erroresAudio = por((t) => t.paso === 2 && t.tipo === "error");
  const manual = ultima("transcripcion_manual");
  if (audios.length || erroresAudio.length || manual) {
    const detalles: string[] = [];
    const ok = fin(audios);
    let estado: EstadoEtapa = "hecho";
    let titulo = "Su voz se pasó a texto";
    let quien: Quien = "ia";
    let segundos: number | undefined;
    if (ok) {
      segundos = seg(num(ok.latencia_ms));
      segundosIA += segundos;
      detalles.push(`Audio de ${Math.round(num(ok.detalle?.duracion_audio_s))} s, convertido en este computador; el audio no se guardó.`);
      if (audios.length > 1) detalles.push(`Se grabó ${audios.length} veces y se usó la última.`);
      if (manual) detalles.push("Usted revisó y corrigió el texto antes de seguir.");
    } else if (manual) {
      titulo = "Usted escribió el dictado";
      quien = "medico";
    }
    if (erroresAudio.length && !ok && !manual) {
      estado = "problema";
      titulo = "No se pudo pasar el audio a texto";
      detalles.push(causa(fin(erroresAudio)!), "Puede grabar de nuevo o escribir el dictado.");
    }
    etapas.push({ clave: "dictado", titulo, quien, estado, segundos, detalles });
  }

  // ---- 3-4. La IA organiza la historia
  const organizar = por((t) => t.paso === 3 || t.paso === 4);
  if (organizar.length) {
    const detalles: string[] = [];
    const extractor = [...organizar].reverse().find((t) => t.nombre === "extractor_determinista");
    const llamadasOk = organizar.filter((t) => t.tipo === "llm" && t.ok);
    const jsonRoto = organizar.filter((t) => t.tipo === "llm" && !t.ok).length;
    const errores = organizar.filter((t) => t.tipo === "error");
    const rechazos = organizar.filter((t) => t.nombre === "enviar_borrador" && !t.ok).length;
    const limite = organizar.find((t) => t.tipo === "limite");
    const listo = [...organizar].reverse().find((t) => t.nombre === "borrador_listo");
    const segundos = seg(llamadasOk.reduce((s, t) => s + num(t.latencia_ms), 0));
    segundosIA += segundos;

    if (extractor) {
      const n = num(extractor.detalle?.mediciones);
      const dudas = num(extractor.detalle?.ambiguedades);
      detalles.push(n
        ? `El sistema leyó ${plural(n, "medida", "medidas")} de agudeza visual y presión, ojo por ojo, para comprobar a la IA.`
        : "No se dictaron medidas de agudeza visual ni de presión.");
      if (dudas) detalles.push(`${plural(dudas, "medida no dice", "medidas no dicen")} de qué ojo es: quedó para que usted decida.`);
    }
    if (errores.length && listo) detalles.push("Hubo un corte con el servicio de IA y se reintentó con éxito.");
    if (jsonRoto) detalles.push(`La IA respondió ${jsonRoto === 1 ? "una vez" : `${jsonRoto} veces`} en un formato incorrecto y se corrigió sola.`);
    if (rechazos) detalles.push(`El control rechazó ${plural(rechazos, "borrador", "borradores")} de la IA por datos que no cuadraban, y la IA lo corrigió.`);

    let estado: EstadoEtapa;
    let titulo: string;
    if (listo) {
      const alertas = num(listo.detalle?.alertas);
      const obligatorias = num(listo.detalle?.bloqueantes);
      // Una vez que el médico revisó y guardó, lo marcado ya no está pendiente.
      const yaRevisada = trazas.some((t) => t.nombre === "revision_medica");
      titulo = "La IA organizó la historia clínica";
      estado = alertas && !yaRevisada ? "atencion" : "hecho";
      if (limite) detalles.push("La IA llegó a su límite de tiempo o de intentos; se dejó lo que alcanzó a organizar.");
      detalles.push(!alertas
        ? "Todo cuadró con el dictado: no hay datos pendientes de revisar."
        : yaRevisada
          ? `Marcó ${plural(alertas, "dato", "datos")} para su revisión; usted ya ${alertas === 1 ? "lo revisó" : "los revisó"}.`
          : `Quedaron ${plural(alertas, "dato", "datos")} para que usted revise${obligatorias ? ` (${obligatorias} antes de poder guardar)` : ""}.`);
    } else if (errores.length) {
      titulo = "La IA no pudo organizar la historia";
      estado = "problema";
      detalles.push(causa(fin(errores)!), "Su dictado está guardado: puede reintentar.");
    } else {
      titulo = "La IA está organizando la historia…";
      estado = "en_curso";
    }
    etapas.push({ clave: "organizar", titulo, quien: "ia", estado, segundos: segundos || undefined, detalles });
  }

  // ---- 5-6. Revisión del médico
  const revision = ultima("revision_medica");
  const guardada = ultima("historia_guardada");
  if (revision || guardada) {
    const corregidos = Array.isArray(revision?.detalle?.campos_corregidos) ? (revision!.detalle!.campos_corregidos as unknown[]).length : 0;
    const resueltas = num(revision?.detalle?.alertas_resueltas);
    const detalles = [corregidos ? `Usted corrigió ${plural(corregidos, "dato", "datos")} del borrador.` : "Usted no tuvo que corregir ningún dato."];
    if (resueltas) detalles.push(`Revisó ${plural(resueltas, "dato marcado", "datos marcados")} por el sistema.`);
    if (guardada?.detalle?.revisado_por) detalles.push(`Guardada por ${String(guardada.detalle.revisado_por)}.`);
    etapas.push({ clave: "revision", titulo: "Usted revisó y guardó la historia", quien: "medico", estado: "hecho", detalles });
  }

  // ---- 7. Explicación para el paciente
  const explicacion = por((t) => t.paso === 7);
  if (explicacion.length) {
    const llamadas = explicacion.filter((t) => t.tipo === "llm");
    const guardas = explicacion.filter((t) => t.nombre.startsWith("guarda_no_diagnostico"));
    const plantilla = explicacion.some((t) => t.nombre === "plantilla_determinista");
    const errores = explicacion.filter((t) => t.tipo === "error");
    const segundos = seg(llamadas.reduce((s, t) => s + num(t.latencia_ms), 0));
    segundosIA += segundos;
    const detalles: string[] = [];
    let estado: EstadoEtapa = "hecho";
    let titulo = "La IA redactó la explicación para el paciente";
    if (plantilla) {
      estado = "atencion";
      titulo = "Se preparó la explicación con un texto seguro de respaldo";
      detalles.push(errores.length
        ? `${causa(fin(errores)!)} Por eso se usó un texto escrito de antemano con los datos de la historia.`
        : "La IA agregaba información que usted no dictó, así que se usó un texto escrito de antemano.");
    } else {
      if (guardas.some((g) => !g.ok)) detalles.push("La primera versión agregaba algo que usted no dictó; la IA la corrigió.");
      detalles.push("Se comprobó que no agregara diagnósticos, cifras ni medicamentos que no estén en la historia.");
    }
    etapas.push({ clave: "explicacion", titulo, quien: "ia", estado, segundos: segundos || undefined, detalles });
  }

  // ---- 8. Aprobación final
  const aprobacion = ultima("aprobacion_final");
  if (aprobacion) {
    const detalles: string[] = [];
    if (aprobacion.detalle?.editada_por_medico) detalles.push("Usted la editó antes de aprobarla.");
    const avisos = aprobacion.detalle?.advertencias_guarda;
    if (Array.isArray(avisos) && avisos.length) detalles.push("Nota: su texto menciona algo que no está en la historia; quedó registrado.");
    etapas.push({ clave: "aprobacion", titulo: "Usted aprobó la explicación", quien: "medico", estado: "hecho", detalles });
  }

  // ---- Voz para el paciente
  const voces = por((t) => t.nombre === "audio_explicacion");
  if (voces.length) {
    const ok = [...voces].reverse().find((t) => t.ok);
    const detalles: string[] = [];
    let estado: EstadoEtapa = "hecho";
    let titulo = "Se preparó el audio para el paciente";
    let segundos: number | undefined;
    if (ok) {
      segundos = seg(num(ok.latencia_ms));
      segundosIA += segundos;
      const fuera = ok.detalle?.texto_sale_del_equipo === true;
      detalles.push(`${Math.round(num(ok.detalle?.duracion_audio_s))} s de audio, con ${fuera ? "la voz de ElevenLabs (en internet)" : "la voz de este computador"}.`);
    } else {
      estado = "atencion";
      titulo = "No se pudo preparar el audio con la voz elegida";
      detalles.push(causa(fin(voces)!), "Se leyó con la voz del navegador.");
    }
    etapas.push({ clave: "voz", titulo, quien: "ia", estado, segundos, detalles });
  }

  // ---- Código QR para el paciente
  const qr = por((t) => t.tipo === "paciente");
  if (qr.length) {
    const ultimoCambio = [...qr].reverse().find((t) => t.nombre === "enlace_creado" || t.nombre === "enlace_anulado");
    const anulado = ultimoCambio?.nombre === "enlace_anulado";
    const aperturas = qr.filter((t) => t.nombre === "paciente_abrio").length;
    const detalles = [aperturas
      ? `El paciente abrió su explicación en el celular ${aperturas === 1 ? "1 vez" : `${aperturas} veces`}.`
      : "El paciente aún no lo ha abierto."];
    if (anulado) detalles.push("El código impreso ya no funciona.");
    etapas.push({ clave: "qr", titulo: anulado ? "Usted anuló el código QR del paciente" : "Se creó el código QR para el paciente",
      quien: "medico", estado: "hecho", detalles });
  }

  const estados = etapas.map((e) => e.estado);
  const estadoGeneral = !etapas.length ? "vacio"
    : estados.includes("problema") ? "problema"
    : estados.includes("atencion") ? "revisar" : "bien";
  return { etapas, estadoGeneral, segundosIA: Math.round(segundosIA * 10) / 10 };
}
