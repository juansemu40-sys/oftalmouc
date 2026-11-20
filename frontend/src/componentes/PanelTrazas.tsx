import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { numero, pesos } from "../logica/formato";
import { resumirConsulta, type Etapa } from "../logica/resumenConsulta";
import type { RespuestaTrazas, Salud } from "../tipos";

// "Qué pasó en esta consulta": las trazas del backend traducidas a las etapas de la consulta,
// en palabras de consultorio: quién hizo cada cosa (la IA, usted o el sistema), cuánto tardó
// y si hay algo que atender. Pensado para un médico sin formación en ingeniería.
// El registro técnico completo (tokens, llamadas, JSON) sigue en GET /api/consultas/{id}/trazas.
// Se consulta cada 1,5 s mientras hay una consulta abierta (el backend confirma cada traza al instante).

const ESTADO_GENERAL = {
  bien: { clase: "bien", titulo: "Todo salió bien", texto: "No hay nada pendiente en esta consulta." },
  revisar: { clase: "revisar", titulo: "Hay algo para que usted mire", texto: "Las etapas en amarillo le dicen qué revisar." },
  problema: { clase: "problema", titulo: "Hubo un problema", texto: "La etapa en rojo explica qué pasó y qué puede hacer. Su trabajo está guardado." },
} as const;

const QUIEN: Record<Etapa["quien"], string> = { ia: "IA", medico: "Usted", sistema: "Sistema" };

export function PanelTrazas({ consultaId, salud }: { consultaId: string | null; salud: Salud | null }) {
  const trm = salud?.colombia?.trm_cop ?? 0;
  const [datos, setDatos] = useState<RespuestaTrazas | null>(null);

  useEffect(() => {
    setDatos(null);
    if (!consultaId) return;
    let vivo = true;
    const cargar = () => api.trazas(consultaId).then((d) => vivo && setDatos(d)).catch(() => undefined);
    cargar();
    const t = setInterval(cargar, 1500);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [consultaId]);

  const resumen = useMemo(() => resumirConsulta(datos?.trazas ?? []), [datos]);

  return (
    <aside className="panel-trazas" aria-label="Qué pasó en esta consulta">
      <h2>Qué pasó en esta consulta</h2>
      {!consultaId || resumen.estadoGeneral === "vacio" ? (
        <p className="ayuda">
          Cuando abra una consulta, aquí verá cada etapa en palabras sencillas: qué hizo la IA, qué hizo usted
          y si hay algo que revisar.
        </p>
      ) : (
        <Resumen resumen={resumen} costo={datos ? (datos.resumen.costo_cop ?? datos.resumen.costo_usd * trm) : 0} />
      )}
    </aside>
  );
}

function Resumen({ resumen, costo }: { resumen: ReturnType<typeof resumirConsulta>; costo: number }) {
  const general = ESTADO_GENERAL[resumen.estadoGeneral as keyof typeof ESTADO_GENERAL];
  return (
    <>
      <div className={`estado-general ${general.clase}`} role="status">
        <strong>{general.titulo}</strong>
        <span>{general.texto}</span>
      </div>

      <dl className="cifras cifras-medico">
        <div><dt>La IA trabajó</dt><dd>{resumen.segundosIA > 0 ? `${numero(resumen.segundosIA, 1)} s` : "—"}</dd></div>
        <div title="Lo que cobra el servicio de IA por esta consulta">
          <dt>Costo de la IA</dt><dd>{costo > 0 && costo < 1 ? "menos de $1" : pesos(costo)}</dd>
        </div>
      </dl>

      <ol className="etapas">
        {resumen.etapas.map((e) => (
          <li key={e.clave} className={`etapa etapa-${e.estado}`}>
            <span className="etapa-marca" aria-hidden />
            <div className="etapa-cuerpo">
              <div className="etapa-cabecera">
                <span className={`etapa-quien quien-${e.quien}`}>{QUIEN[e.quien]}</span>
                {e.segundos !== undefined && e.segundos > 0 && <span className="etapa-tiempo">{numero(e.segundos, 1)} s</span>}
              </div>
              <p className="etapa-titulo">{e.titulo}</p>
              {e.detalles.length > 0 && (
                <ul className="etapa-detalles">
                  {e.detalles.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="etapas-nota">
        La IA solo organiza y redacta: nunca diagnostica. Nada llega al paciente sin que usted lo revise y lo apruebe.
      </p>
    </>
  );
}
