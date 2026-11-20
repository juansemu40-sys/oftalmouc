import { describe, expect, it } from "vitest";
import { resumirConsulta } from "./resumenConsulta";
import type { Traza } from "../tipos";

let id = 0;
const t = (paso: number, tipo: string, nombre: string, extra: Partial<Traza> = {}): Traza => ({
  id: ++id, paso, tipo, nombre, ok: true, detalle: null, latencia_ms: null,
  tokens_entrada: null, tokens_salida: null, costo_usd: null, creado_en: "2026-11-20T10:00:00Z", ...extra,
});

const consultaCompleta = (): Traza[] => [
  t(1, "estado", "consulta_creada"),
  t(2, "whisper", "transcripcion", { latencia_ms: 4200, detalle: { duracion_audio_s: 38.4 } }),
  t(3, "herramienta", "extractor_determinista", { detalle: { mediciones: 6, ambiguedades: 0 } }),
  t(3, "llm", "llamada_1", { latencia_ms: 1800, tokens_entrada: 900, tokens_salida: 300 }),
  t(3, "herramienta", "enviar_borrador"),
  t(4, "estado", "borrador_listo", { detalle: { alertas: 2, bloqueantes: 1 } }),
  t(5, "validacion", "revision_medica", { detalle: { alertas_resueltas: 2, campos_corregidos: ["plan"] } }),
  t(6, "estado", "historia_guardada", { detalle: { revisado_por: "Dra. Prueba" } }),
  t(7, "llm", "explicacion_llm_1", { latencia_ms: 1200 }),
  t(7, "seguridad", "guarda_no_diagnostico_1", { detalle: { violaciones: [] } }),
  t(8, "estado", "aprobacion_final", { detalle: { editada_por_medico: true, advertencias_guarda: [] } }),
];

describe("resumirConsulta", () => {
  it("sin trazas no hay nada que contar", () => {
    expect(resumirConsulta([]).estadoGeneral).toBe("vacio");
  });

  it("cuenta la consulta completa en etapas sin jerga", () => {
    const r = resumirConsulta(consultaCompleta());
    expect(r.etapas.map((e) => e.clave)).toEqual(["abrir", "dictado", "organizar", "revision", "explicacion", "aprobacion"]);
    const texto = JSON.stringify(r.etapas);
    for (const jerga of ["llamada_", "token", "JSON", "LLM", "extractor", "determinista", "whisper"]) {
      expect(texto.toLowerCase()).not.toContain(jerga.toLowerCase());
    }
    expect(r.segundosIA).toBe(7.2); // 4,2 audio + 1,8 historia + 1,2 explicación
  });

  it("los datos por revisar se marcan como atención, no como error", () => {
    const r = resumirConsulta(consultaCompleta().slice(0, 6)); // hasta el borrador, sin revisión todavía
    const organizar = r.etapas.find((e) => e.clave === "organizar")!;
    expect(organizar.estado).toBe("atencion");
    expect(organizar.detalles.join(" ")).toContain("2 datos para que usted revise (1 antes de poder guardar)");
    expect(r.estadoGeneral).toBe("revisar");
  });

  it("cuando el médico ya revisó, lo marcado deja de estar pendiente", () => {
    const r = resumirConsulta(consultaCompleta());
    const organizar = r.etapas.find((e) => e.clave === "organizar")!;
    expect(organizar.estado).toBe("hecho");
    expect(organizar.detalles.join(" ")).toContain("usted ya los revisó");
    expect(r.estadoGeneral).toBe("bien");
  });

  it("explica en palabras sencillas por qué falló la IA", () => {
    const r = resumirConsulta([
      t(1, "estado", "consulta_creada"),
      t(2, "estado", "transcripcion_manual"),
      t(3, "herramienta", "extractor_determinista", { detalle: { mediciones: 4, ambiguedades: 1 } }),
      t(3, "error", "llamada_1", { ok: false, detalle: { codigo: "ia_no_disponible" } }),
    ]);
    const organizar = r.etapas.find((e) => e.clave === "organizar")!;
    expect(organizar.estado).toBe("problema");
    expect(organizar.detalles.join(" ")).toContain("antivirus");
    expect(organizar.detalles.join(" ")).toContain("1 medida no dice de qué ojo es");
    expect(r.etapas.find((e) => e.clave === "dictado")!.titulo).toBe("Usted escribió el dictado");
    expect(r.estadoGeneral).toBe("problema");
  });

  it("un fallo que se reintentó con éxito no asusta al médico", () => {
    const r = resumirConsulta([
      t(3, "error", "llamada_1", { ok: false, detalle: { codigo: "ia_timeout" } }),
      t(3, "llm", "llamada_2", { latencia_ms: 900 }),
      t(4, "estado", "borrador_listo", { detalle: { alertas: 0, bloqueantes: 0 } }),
    ]);
    const organizar = r.etapas[0];
    expect(organizar.estado).toBe("hecho");
    expect(organizar.detalles.join(" ")).toContain("se reintentó con éxito");
  });

  it("avisa cuando se usó la explicación de respaldo y cuando el audio salió a internet", () => {
    const r = resumirConsulta([
      t(7, "error", "explicacion_llm_1", { ok: false, detalle: { codigo: "ia_limite_tasa" } }),
      t(7, "seguridad", "plantilla_determinista"),
      t(8, "voz", "audio_explicacion", { latencia_ms: 2500, detalle: { duracion_audio_s: 52, texto_sale_del_equipo: true } }),
    ]);
    expect(r.etapas[0].titulo).toContain("respaldo");
    expect(r.etapas[0].estado).toBe("atencion");
    expect(r.etapas[1].detalles[0]).toContain("ElevenLabs");
  });

  it("cuenta si el paciente abrió el código QR", () => {
    const r = resumirConsulta([
      t(8, "paciente", "enlace_creado"),
      t(8, "paciente", "paciente_abrio"),
      t(8, "paciente", "paciente_abrio"),
    ]);
    expect(r.etapas[0].titulo).toBe("Se creó el código QR para el paciente");
    expect(r.etapas[0].detalles[0]).toContain("2 veces");
    const anulado = resumirConsulta([t(8, "paciente", "enlace_creado"), t(8, "paciente", "enlace_anulado")]);
    expect(anulado.etapas[0].titulo).toContain("anuló");
    expect(anulado.etapas[0].detalles.join(" ")).toContain("aún no lo ha abierto");
  });
});
