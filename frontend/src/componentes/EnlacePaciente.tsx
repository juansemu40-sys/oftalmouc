// Código QR para que el paciente se lleve la explicación en el celular.
// El médico lo crea (es una decisión suya), lo ve en pantalla y sale impreso en la hoja del paciente.
// El enlace solo muestra la explicación aprobada, vence solo y se puede anular.
import { useEffect, useState } from "react";
import { ErrorApi, api } from "../api";
import { alcanceEnlace, direccionEnlace } from "../logica/enlace";
import { fecha, fechaHora } from "../logica/formato";
import { CodigoQR } from "./CodigoQR";
import { IconoCelular, IconoCopiar } from "./Iconos";
import type { Consulta, EnlacePaciente as Enlace } from "../tipos";

interface Props {
  consulta: Consulta;
  urlPublica?: string | null;
}

export function EnlacePaciente({ consulta, urlPublica }: Props) {
  const [enlace, setEnlace] = useState<Enlace | null | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Carga el enlace vigente y lo refresca cada 5 s: así el médico ve cuándo el paciente lo abrió.
  useEffect(() => {
    let vivo = true;
    const cargar = () => api.enlacePaciente(consulta.id).then((e) => vivo && setEnlace(e)).catch(() => vivo && setEnlace((x) => x ?? null));
    cargar();
    const t = setInterval(cargar, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [consulta.id]);

  const accion = async (f: () => Promise<void>) => {
    setOcupado(true);
    setAviso(null);
    try {
      await f();
    } catch (e) {
      setAviso(e instanceof ErrorApi ? e.message : "No se pudo completar la acción.");
    } finally {
      setOcupado(false);
    }
  };

  const crear = () => accion(async () => setEnlace(await api.crearEnlacePaciente(consulta.id)));
  const anular = () => accion(async () => {
    await api.anularEnlacePaciente(consulta.id);
    setEnlace(null);
    setConfirmarAnular(false);
  });

  if (enlace === undefined) return null;

  if (enlace === null) {
    return (
      <section className="qr-paciente qr-solo-pantalla" aria-labelledby="titulo-qr">
        <div className="escuchar-cabecera">
          <span className="escuchar-icono" aria-hidden><IconoCelular /></span>
          <div>
            <h2 id="titulo-qr">Para llevar en el celular</h2>
            <p>
              Cree un código QR: el paciente lo escanea con la cámara y escucha o lee esta explicación en su casa,
              las veces que quiera. Sale impreso en la hoja.
            </p>
          </div>
        </div>
        <div className="escuchar-controles">
          <button className="primario grande con-icono" onClick={crear} disabled={ocupado}>
            <IconoCelular />{ocupado ? "Creando…" : "Crear código QR"}
          </button>
        </div>
        <p className="qr-letra-pequena">
          El enlace muestra solo esta explicación aprobada, nunca la historia clínica. Vence en 30 días y usted puede
          anularlo cuando quiera.
        </p>
        {aviso && <p className="escuchar-aviso">{aviso}</p>}
      </section>
    );
  }

  const url = direccionEnlace(enlace, urlPublica, window.location.origin);
  const alcance = alcanceEnlace(url);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setAviso("No se pudo copiar automáticamente: seleccione el enlace y cópielo.");
    }
  };

  return (
    <section className="qr-paciente con-codigo" aria-labelledby="titulo-qr">
      <CodigoQR texto={url} etiqueta="Código QR con la explicación para el paciente" className="qr-imagen" />
      <div className="qr-info">
        <h2 id="titulo-qr" className="qr-solo-pantalla">Código QR del paciente</h2>
        <p className="qr-solo-impresion qr-instruccion">
          Escanee este código con la cámara de su celular para escuchar y leer esta explicación en casa.
        </p>
        <p className="qr-solo-impresion qr-letra-pequena">Disponible hasta el {fecha(enlace.expira_en)}. Es solo para usted.</p>

        <p className={`qr-estado qr-solo-pantalla ${enlace.aperturas ? "abierto" : ""}`} role="status" aria-live="polite">
          {enlace.aperturas
            ? `El paciente lo abrió ${enlace.aperturas === 1 ? "1 vez" : `${enlace.aperturas} veces`}${enlace.ultima_apertura ? ` (última: ${fechaHora(enlace.ultima_apertura)})` : ""}.`
            : "El paciente aún no lo ha abierto."}
        </p>
        <p className="qr-letra-pequena qr-solo-pantalla">
          Disponible hasta el {fecha(enlace.expira_en)}. Muestra solo esta explicación, nunca la historia clínica.
        </p>

        {alcance === "internet" && (
          <p className="qr-alcance internet qr-solo-pantalla">
            Abre desde cualquier red (datos móviles o cualquier Wi-Fi) mientras este PC esté encendido y la aplicación abierta.
          </p>
        )}
        {alcance === "wifi" && (
          <p className="qr-alcance qr-solo-pantalla">
            Solo abre en celulares conectados al mismo Wi-Fi de este PC. Para que abra desde cualquier red, active Tailscale
            Funnel (vea el README) y vuelva a abrir la aplicación con <strong>iniciar.bat</strong>.
          </p>
        )}
        {alcance === "local" && (
          <p className="qr-alerta qr-solo-pantalla">
            Este código apunta a “{new URL(url).host}”, que solo existe en este computador: un celular no lo podrá abrir.
            Cierre y vuelva a abrir la aplicación con <strong>iniciar.bat</strong> para que use la dirección del equipo en la red.
          </p>
        )}

        <div className="qr-enlace qr-solo-pantalla">
          <code>{url}</code>
          <button className="secundario con-icono" onClick={copiar}><IconoCopiar />{copiado ? "Copiado" : "Copiar enlace"}</button>
        </div>

        <div className="qr-acciones qr-solo-pantalla">
          {!confirmarAnular ? (
            <button className="enlace" onClick={() => setConfirmarAnular(true)}>Anular este código</button>
          ) : (
            <span className="qr-confirmar">
              ¿Anularlo? El código impreso dejará de funcionar.
              <button className="secundario" onClick={anular} disabled={ocupado}>Sí, anular</button>
              <button className="enlace" onClick={() => setConfirmarAnular(false)}>Cancelar</button>
            </span>
          )}
        </div>
        {aviso && <p className="escuchar-aviso qr-solo-pantalla">{aviso}</p>}
      </div>
    </section>
  );
}
