import { useCallback, useEffect, useState } from "react";
import { ErrorApi, EVENTO_SESION_VENCIDA, api } from "./api";
import { PanelTrazas } from "./componentes/PanelTrazas";
import { PantallaIngreso } from "./componentes/PantallaIngreso";
import { PasoDictado } from "./componentes/PasoDictado";
import { PasoExplicacion } from "./componentes/PasoExplicacion";
import { PasoRevision } from "./componentes/PasoRevision";
import { Iris } from "./componentes/Iris";
import { Progreso } from "./componentes/Progreso";
import { fechaHora } from "./logica/formato";
import type { Consulta, ConsultaResumen, Ejemplo, Estado, Salud } from "./tipos";

const ESTADO_LEGIBLE: Record<Estado, string> = {
  CREADA: "sin dictado",
  TRANSCRITA: "dictado listo",
  BORRADOR: "por revisar",
  GUARDADA: "guardada",
  EXPLICACION_GENERADA: "explicación por aprobar",
  APROBADA: "finalizada",
};

type EstadoSesion = "verificando" | "fuera" | "dentro";

export function App() {
  const [sesion, setSesion] = useState<EstadoSesion>("verificando");
  const [configurada, setConfigurada] = useState(true);
  const [avisoIngreso, setAvisoIngreso] = useState<string | null>(null);
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<ErrorApi | null>(null);
  const [salud, setSalud] = useState<Salud | null>(null);
  const [ejemplos, setEjemplos] = useState<Ejemplo[]>([]);
  const [recientes, setRecientes] = useState<ConsultaResumen[]>([]);

  // ¿Ya hay sesión? (la cookie es HttpOnly: solo el servidor sabe).
  useEffect(() => {
    api.sesion().then(() => setSesion("dentro")).catch((e) => {
      setConfigurada(!(e instanceof ErrorApi && e.detalle?.configurada === false));
      setSesion("fuera");
    });
  }, []);

  // Si la sesión vence (inactividad), cualquier petición responde 401 y se vuelve al ingreso sin perder nada guardado.
  useEffect(() => {
    const vencio = () => {
      setSesion((s) => {
        if (s === "dentro") setAvisoIngreso("Su sesión se cerró por inactividad. Inicie sesión de nuevo; su trabajo guardado sigue ahí.");
        return "fuera";
      });
    };
    window.addEventListener(EVENTO_SESION_VENCIDA, vencio);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, vencio);
  }, []);

  useEffect(() => {
    if (sesion !== "dentro") return;
    api.salud().then(setSalud).catch((e) => setError(e));
    api.ejemplos().then(setEjemplos).catch(() => undefined);
  }, [sesion]);

  useEffect(() => {
    if (sesion !== "dentro") return;
    api.listar().then(setRecientes).catch(() => undefined);
  }, [consulta?.estado, sesion]);

  const cerrarSesion = async () => {
    await api.cerrarSesion().catch(() => undefined);
    setConsulta(null);
    setRecientes([]);
    setSalud(null);
    setError(null);
    setAvisoIngreso("Sesión cerrada.");
    setSesion("fuera");
  };

  /** Ejecuta una acción contra la API mostrando progreso y errores legibles. */
  const ejecutar = useCallback(async (mensaje: string, accion: () => Promise<Consulta>) => {
    setOcupado(mensaje);
    setError(null);
    try {
      setConsulta(await accion());
    } catch (e) {
      setError(e instanceof ErrorApi ? e : new ErrorApi("Ocurrió un error inesperado en la interfaz.", "interfaz"));
    } finally {
      setOcupado(null);
    }
  }, []);

  const id = consulta?.id ?? "";
  const estado = consulta?.estado ?? null;

  if (sesion === "verificando") {
    return <div className="app"><div className="ocupado" role="status"><Iris className="pulso" detallado={false} />Cargando…</div></div>;
  }
  if (sesion === "fuera") {
    return (
      <PantallaIngreso configurada={configurada} aviso={avisoIngreso}
        onIngreso={() => { setAvisoIngreso(null); setConsulta(null); setSesion("dentro"); }} />
    );
  }

  return (
    <div className="app">
      <header className="barra">
        <div className="marca">
          <span className="marca-logo"><img src="/marca-oftalmouc.png" alt="OftalmoUC" /></span>
          <span className="marca-nombre">Oftalmología <em>+ IA</em></span>
          <span className="marca-lema">Universidad Cooperativa de Colombia</span>
        </div>
        <Progreso estado={estado} />
        {recientes.length > 0 && (
          <select className="recientes" aria-label="Abrir una consulta reciente" value=""
            onChange={(e) => e.target.value && ejecutar("Abriendo consulta…", () => api.obtener(e.target.value))}>
            <option value="">Retomar una consulta</option>
            {recientes.map((c) => (
              <option key={c.id} value={c.id}>{c.paciente_ref} · {ESTADO_LEGIBLE[c.estado]} · {fechaHora(c.creado_en)}</option>
            ))}
          </select>
        )}
        <button className="cerrar-sesion" onClick={cerrarSesion}>Cerrar sesión</button>
      </header>

      <div className="contenido">
        <main>
          {error && (
            <div className="error" role="alert">
              <p>{error.message}</p>
              <p className="error-meta">
                {error.trazaId && <>Código {error.trazaId}. </>}
                {consulta && "Su trabajo está guardado; puede intentarlo de nuevo."}
              </p>
              <button className="enlace" onClick={() => setError(null)}>Cerrar</button>
            </div>
          )}
          {ocupado && (
            <div className="ocupado" role="status">
              <Iris className="pulso" detallado={false} />
              {ocupado}
            </div>
          )}

          {(!consulta || estado === "CREADA" || estado === "TRANSCRITA") && (
            <PasoDictado
              consulta={consulta}
              ejemplos={ejemplos}
              ocupado={!!ocupado}
              onCrear={(d) => ejecutar("Abriendo la consulta…", () => api.crear(d))}
              onAudio={(b, n) => ejecutar("Escuchando su dictado y pasándolo a texto…", () => api.subirAudio(id, b, n))}
              onExtraer={(texto) =>
                ejecutar("La IA está organizando la historia clínica. Tarda unos segundos…", async () => {
                  if (texto !== null) await api.fijarTranscripcion(id, texto);
                  return api.extraer(id);
                })
              }
            />
          )}

          {consulta && estado === "BORRADOR" && (
            <PasoRevision
              key={consulta.id + (consulta.resumen_extraccion?.latencia_ms ?? "")}
              consulta={consulta}
              ocupado={!!ocupado}
              onGuardar={(h, r, m, c) => ejecutar("Guardando la historia clínica…", () => api.revisar(id, h, r, m, c))}
            />
          )}

          {consulta && (estado === "GUARDADA" || estado === "EXPLICACION_GENERADA" || estado === "APROBADA") && (
            <PasoExplicacion
              consulta={consulta}
              ocupado={!!ocupado}
              voz={salud?.voz}
              urlPublica={salud?.url_publica}
              onGenerar={() => ejecutar("La IA está redactando la explicación para su paciente…", () => api.explicar(id))}
              onAprobar={(t, m, c) => ejecutar("Aprobando la explicación…", () => api.aprobar(id, t, m, c))}
              onNueva={() => {
                setConsulta(null);
                setError(null);
              }}
            />
          )}
        </main>

        <PanelTrazas consultaId={consulta?.id ?? null} salud={salud} />
      </div>
    </div>
  );
}
