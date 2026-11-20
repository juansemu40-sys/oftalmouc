// Explicación en voz alta para el paciente: pensada para quien no ve bien o no lee.
// Dos voces, a elección del médico:
//   - "Servidor": la voz configurada en el .env. Piper (local y privada, WAV) o ElevenLabs (nube, muy humana, MP3).
//     En ambos casos se puede descargar para enviarla por WhatsApp.
//   - "Navegador": la mejor voz en español instalada (en Edge, voces "Natural" como Salome · Colombia).
//     Se lee frase por frase para que no se corte. No se puede descargar.
// Solo existe en la consulta finalizada: se lee únicamente lo que el médico aprobó.
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorApi, api } from "../api";
import { dividirEnFrases, elegirVoz, textoParaVoz, vozEnLinea } from "../logica/voz";
import { IconoAltavoz, IconoDescargar, IconoLetraGrande, IconoPausa } from "./Iconos";
import type { Consulta, Salud } from "../tipos";

type Motor = "equipo" | "navegador";

interface Props {
  consulta: Consulta;
  voz?: Salud["voz"];
}

const hayVozNavegador = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function EscucharExplicacion({ consulta, voz }: Props) {
  const vozServidor = voz?.disponible ?? false;
  const servidorLocal = voz?.local ?? true;
  const esElevenLabs = (voz?.motor ?? "").toLowerCase().includes("elevenlabs");
  const [motor, setMotor] = useState<Motor>(vozServidor ? "equipo" : "navegador");
  const [cargando, setCargando] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [formato, setFormato] = useState<"wav" | "mp3">("wav");
  const [lento, setLento] = useState(true); // por defecto un poco más despacio: adultos mayores
  const [leyendo, setLeyendo] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [voces, setVoces] = useState<SpeechSynthesisVoice[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Cada lectura del navegador tiene un número: los avisos de una lectura cancelada no apagan la nueva.
  const lectura = useRef(0);

  const ref = consulta.paciente_ref.replace(/[^A-Za-z0-9_-]+/g, "-") || "paciente";
  const nombreArchivo = `OftalmoUC-explicacion-${ref}.${formato}`;

  // Las voces del navegador llegan con retraso (evento voiceschanged).
  useEffect(() => {
    if (!hayVozNavegador()) return;
    const cargar = () => setVoces(window.speechSynthesis.getVoices());
    cargar();
    window.speechSynthesis.addEventListener("voiceschanged", cargar);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", cargar);
  }, []);
  const vozNavegador = useMemo(() => {
    const i = elegirVoz(voces);
    return i >= 0 ? voces[i] : null;
  }, [voces]);

  // Al salir de la pantalla: liberar el audio y callar la voz del navegador.
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  useEffect(() => () => {
    if (hayVozNavegador()) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = lento ? 0.9 : 1;
  }, [lento, url]);

  const detenerTodo = () => {
    lectura.current += 1;
    audio.current?.pause();
    if (hayVozNavegador()) window.speechSynthesis.cancel();
    setLeyendo(false);
    setPausado(false);
  };

  const leerConNavegador = () => {
    if (!hayVozNavegador()) {
      setAviso("Este navegador no puede leer en voz alta. Use Chrome o Edge.");
      return;
    }
    detenerTodo();
    const sintesis = window.speechSynthesis;
    const frases = dividirEnFrases(textoParaVoz(consulta.explicacion_final ?? ""));
    const id = ++lectura.current;
    const terminar = () => {
      if (lectura.current !== id) return;
      setLeyendo(false);
      setPausado(false);
    };
    frases.forEach((texto, i) => {
      const frase = new SpeechSynthesisUtterance(texto);
      if (vozNavegador) {
        frase.voice = vozNavegador;
        frase.lang = vozNavegador.lang;
      } else {
        frase.lang = "es-CO";
      }
      frase.rate = lento ? 0.88 : 1;
      if (i === frases.length - 1) frase.onend = terminar;
      frase.onerror = terminar;
      sintesis.speak(frase);
    });
    setLeyendo(true);
  };

  const escucharEquipo = async () => {
    if (url) {
      if (audio.current) {
        audio.current.currentTime = 0;
        void audio.current.play();
      }
      return;
    }
    setCargando(true);
    try {
      const r = await api.audioExplicacion(consulta.id);
      setFormato(r.formato);
      setUrl(URL.createObjectURL(r.blob));
    } catch (e) {
      // Sin voz en el servidor (o cualquier fallo): la explicación se lee igual, con la voz del navegador.
      setAviso(e instanceof ErrorApi && e.codigo !== "voz_no_disponible" ? e.message : null);
      setMotor("navegador");
      leerConNavegador();
    } finally {
      setCargando(false);
    }
  };

  const escuchar = () => {
    setAviso(null);
    if (motor === "navegador") leerConNavegador();
    else void escucharEquipo();
  };

  // Al terminar de generar, el audio empieza solo (el clic del médico ya autorizó el sonido).
  useEffect(() => {
    if (url) void audio.current?.play().catch(() => undefined);
  }, [url]);

  const cambiarMotor = (nuevo: Motor) => {
    detenerTodo();
    setMotor(nuevo);
  };

  const pausarNavegador = () => {
    const s = window.speechSynthesis;
    if (pausado) { s.resume(); setPausado(false); } else { s.pause(); setPausado(true); }
  };

  const imprimirGrande = () => {
    document.body.classList.add("impresion-grande");
    const quitar = () => {
      document.body.classList.remove("impresion-grande");
      window.removeEventListener("afterprint", quitar);
    };
    window.addEventListener("afterprint", quitar);
    window.print();
    setTimeout(quitar, 2000);
  };

  const nombreVozNavegador = vozNavegador
    ? vozNavegador.name.replace(/^(Microsoft|Google)\s+/, "").replace(/\s*-\s*Spanish.*$/, "")
    : "voz del navegador";

  return (
    <section className="escuchar" aria-labelledby="titulo-escuchar">
      <div className="escuchar-cabecera">
        <span className="escuchar-icono" aria-hidden><IconoAltavoz /></span>
        <div>
          <h2 id="titulo-escuchar">Escuchar la explicación</h2>
          <p>Para pacientes que no ven bien o prefieren oírla. Se lee solo lo que usted aprobó.</p>
        </div>
      </div>

      {vozServidor && hayVozNavegador() && (
        <div className="escuchar-motor" role="radiogroup" aria-label="Voz">
          <span>Voz:</span>
          <label>
            <input type="radio" name="motor-voz" checked={motor === "equipo"} onChange={() => cambiarMotor("equipo")} />
            {esElevenLabs ? "ElevenLabs" : "Natural de este equipo"}{" "}
            <small>{servidorLocal ? "(privada, se puede descargar)" : "(muy humana, en la nube, se puede descargar)"}</small>
          </label>
          <label>
            <input type="radio" name="motor-voz" checked={motor === "navegador"} onChange={() => cambiarMotor("navegador")} />
            {nombreVozNavegador} <small>(del navegador)</small>
          </label>
        </div>
      )}

      <div className="escuchar-controles">
        {!(motor === "navegador" && leyendo) && (
          <button className="primario grande con-icono" onClick={escuchar} disabled={cargando}>
            <IconoAltavoz />
            {cargando ? "Preparando la voz…" : (motor === "equipo" && url) ? "Escuchar de nuevo" : "Escuchar explicación"}
          </button>
        )}
        {motor === "navegador" && leyendo && (
          <>
            <button className="primario grande con-icono" onClick={pausarNavegador}>
              {pausado ? <IconoAltavoz /> : <IconoPausa />}{pausado ? "Continuar" : "Pausar"}
            </button>
            <button className="secundario" onClick={detenerTodo}>Detener</button>
          </>
        )}
        <label className="escuchar-lento">
          <input type="checkbox" checked={lento} onChange={(e) => setLento(e.target.checked)} />
          Más despacio
        </label>
      </div>

      {motor === "equipo" && url && (
        <>
          <audio ref={audio} src={url} controls className="escuchar-audio" aria-label="Audio de la explicación" />
          <div className="escuchar-compartir">
            <a className="boton secundario con-icono" href={url} download={nombreArchivo}>
              <IconoDescargar />Descargar audio
            </a>
            <span>Envíelo por WhatsApp para que el paciente lo vuelva a escuchar en casa.</span>
          </div>
        </>
      )}

      <div className="escuchar-pie" role="status" aria-live="polite">
        {motor === "equipo" && (servidorLocal
          ? "Voz generada en este equipo: el texto del paciente no sale a internet."
          : "Voz de ElevenLabs: para generarla, el texto aprobado se envía a ElevenLabs (igual que la historia se envía a Groq).")}
        {motor === "navegador" && (vozNavegador && vozEnLinea(vozNavegador)
          ? `Leyendo con ${nombreVozNavegador}, una voz en línea del navegador: para leerlo, el texto se envía al proveedor del navegador. No se puede descargar.`
          : "Leyendo con la voz del navegador (no se puede descargar).")}
        {aviso && <span className="escuchar-aviso"> {aviso}</span>}
      </div>

      <button className="enlace con-icono escuchar-imprimir" onClick={imprimirGrande}>
        <IconoLetraGrande />Imprimir en letra grande
      </button>
    </section>
  );
}
