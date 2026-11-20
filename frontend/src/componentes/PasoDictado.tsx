import { useEffect, useRef, useState } from "react";
import { saludo } from "../logica/formato";
import { evaluar, medir, type Lectura } from "../logica/microfono";
import { IconoChip, IconoEntregar, IconoEscudo, IconoMicrofono, IconoOjo, IconoRevisar } from "./Iconos";
import { Iris } from "./Iris";
import type { Consulta, DatosNuevaConsulta, Ejemplo } from "../tipos";

interface Props {
  consulta: Consulta | null;
  ejemplos: Ejemplo[];
  ocupado: boolean;
  onCrear: (datos: DatosNuevaConsulta) => void;
  onAudio: (audio: Blob, nombre: string) => void;
  onExtraer: (textoEditado: string | null) => void;
}

type Modo = "grabar" | "archivo" | "texto";

// Lo que el médico hace en la app, en tres momentos. Es una secuencia real, por eso va numerada.
const COMO_FUNCIONA = [
  { titulo: "Dicte", texto: "Hable como en cualquier consulta, nombrando el ojo en cada dato.", Icono: IconoMicrofono },
  { titulo: "Revise", texto: "La IA arma el borrador y le señala en amarillo lo que debe confirmar.", Icono: IconoRevisar },
  { titulo: "Entregue", texto: "Apruebe la historia y una explicación sencilla para su paciente.", Icono: IconoEntregar },
];

const SELLOS = [
  { texto: "La IA documenta, no diagnostica", Icono: IconoEscudo },
  { texto: "Voz transcrita en este equipo", Icono: IconoChip },
  { texto: "Cada dato con su cita del dictado", Icono: IconoOjo },
];

export function PasoDictado({ consulta, ejemplos, ocupado, onCrear, onAudio, onExtraer }: Props) {
  const [datos, setDatos] = useState<DatosNuevaConsulta>(() => ({
    paciente_ref: "",
    medico: localStorageSeguro("medico") ?? "",
    registro_medico: localStorageSeguro("registro_medico") ?? "",
    ips: localStorageSeguro("ips") ?? "",
  }));
  const [modo, setModo] = useState<Modo>("grabar");
  const [texto, setTexto] = useState(consulta?.transcripcion ?? "");

  // Se sincroniza también con actualizado_en: si se sube otra vez un audio que da la misma transcripción,
  // el cuadro vuelve a mostrarla aunque el médico lo hubiera vaciado o editado.
  useEffect(() => setTexto(consulta?.transcripcion ?? ""), [consulta?.transcripcion, consulta?.actualizado_en]);

  const campo = (clave: keyof DatosNuevaConsulta) => ({
    value: datos[clave],
    onChange: (e: { target: { value: string } }) => setDatos((d) => ({ ...d, [clave]: e.target.value })),
  });

  if (!consulta) {
    const nombre = datos.medico.trim();
    return (
      <section className="inicio">
        <div className="portada">
          <div className="portada-texto">
            <h1>{saludo()}{nombre ? `, ${nombre}` : ""}</h1>
            <p className="entrada">
              Dicte su consulta de oftalmología y reciba la historia clínica organizada, lista para revisar.
              La inteligencia artificial le ayuda a documentar; el diagnóstico siempre es suyo.
            </p>
            <ul className="sellos">
              {SELLOS.map(({ texto, Icono }) => <li key={texto}><Icono />{texto}</li>)}
            </ul>
          </div>
          <div className="portada-visual" aria-hidden>
            <span className="anillo a1" /><span className="anillo a2" /><span className="anillo a3" />
            <Iris className="portada-iris" />
          </div>
        </div>

        <ol className="como-funciona">
          {COMO_FUNCIONA.map((p, i) => (
            <li key={p.titulo} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
              <span className="como-icono"><p.Icono /></span>
              <strong><span className="como-numero">{i + 1}</span>{p.titulo}</strong>
              <span>{p.texto}</span>
            </li>
          ))}
        </ol>

        <form
          className="tarjeta formulario-inicio"
          onSubmit={(e) => {
            e.preventDefault();
            guardarLocal("medico", datos.medico);
            guardarLocal("registro_medico", datos.registro_medico);
            guardarLocal("ips", datos.ips);
            onCrear(datos);
          }}
        >
          <h2>Datos de la consulta</h2>
          <p className="formulario-ayuda">Solo el número de historia y el médico son obligatorios.</p>
          <label className="ancho">
            <span className="etiqueta">Número de historia clínica</span>
            <input {...campo("paciente_ref")} placeholder="Ej. HC-2026-0457" required maxLength={64} />
            <small>Use el número interno de la historia. No escriba la cédula ni el nombre del paciente.</small>
          </label>
          <label>
            <span className="etiqueta">Médico tratante</span>
            <input {...campo("medico")} placeholder="Ej. Dra. Marcela Ríos" required maxLength={120} />
          </label>
          <label>
            <span className="etiqueta">Registro médico (RETHUS) <span className="opcional">opcional</span></span>
            <input {...campo("registro_medico")} placeholder="Ej. RM 12345" maxLength={40} />
          </label>
          <label className="ancho">
            <span className="etiqueta">IPS o consultorio <span className="opcional">opcional</span></span>
            <input {...campo("ips")} placeholder="Ej. Consultorio Visión Clara, Medellín" maxLength={120} />
          </label>
          <button className="primario ancho" disabled={ocupado || !datos.paciente_ref.trim() || !datos.medico.trim()}>
            Empezar la consulta
          </button>
        </form>

        <p className="aviso-legal">
          Los datos se tratan de forma confidencial conforme a la Ley 1581 de 2012 (protección de datos personales).
          Use dictados de prueba ficticios mientras evalúa la aplicación.
        </p>
      </section>
    );
  }

  const transcrita = consulta.transcripcion !== null;
  const editado = transcrita && texto.trim() !== (consulta.transcripcion ?? "").trim();

  return (
    <section className="tarjeta">
      <header className="cabecera-paso">
        <h1>Dicte la consulta</h1>
        <p className="meta">
          Historia {consulta.paciente_ref} · {consulta.medico}{consulta.ips ? ` · ${consulta.ips}` : ""}
        </p>
      </header>

      <div className="pestanas" role="tablist">
        {(["grabar", "archivo", "texto"] as Modo[]).map((m) => (
          <button key={m} role="tab" aria-selected={modo === m} className={modo === m ? "activa" : ""}
            onClick={() => setModo(m)}>
            {{ grabar: "Grabar con el micrófono", archivo: "Subir un audio", texto: "Escribir o pegar" }[m]}
          </button>
        ))}
      </div>

      {modo === "grabar" && <Grabadora deshabilitada={ocupado} onListo={(b) => onAudio(b, nombreArchivo(b))} />}

      {modo === "archivo" && (
        <div className="zona-audio">
          <label className="boton-archivo">
            Elegir archivo de audio
            <input type="file" accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg" disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onAudio(f, f.name);
                e.target.value = "";
              }} />
          </label>
          <p className="ayuda">webm, wav, mp3, m4a u ogg. Hasta 25 MB. El audio se elimina apenas se transcribe.</p>
        </div>
      )}

      {modo === "texto" && !transcrita && ejemplos.length > 0 && (
        <div className="ejemplos">
          <span>¿Sin paciente a mano? Pruebe con un dictado de ejemplo (ficticio):</span>
          {ejemplos.map((ej) => (
            <button key={ej.id} className="enlace" onClick={() => setTexto(ej.texto)}>{ej.titulo}</button>
          ))}
        </div>
      )}

      {(transcrita || modo === "texto") && (
        <div className="transcripcion">
          <label htmlFor="texto-dictado">
            {transcrita ? "Esto fue lo que entendimos. Corrija lo que haga falta antes de continuar" : "Dictado"}
          </label>
          <textarea id="texto-dictado" value={texto} rows={9} onChange={(e) => setTexto(e.target.value)}
            placeholder="Paciente consulta por… Agudeza visual sin corrección ojo derecho 20/40…" />
          <div className="acciones">
            {consulta.duracion_audio_s && consulta.fuente_transcripcion !== "texto" && (
              <span className="meta">Audio de {Math.round(consulta.duracion_audio_s)} s transcrito con Whisper en este equipo</span>
            )}
            <button className="primario" disabled={ocupado || texto.trim().length < 10}
              onClick={() => onExtraer(!transcrita || editado ? texto : null)}>
              Organizar historia con IA
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Grabadora({ deshabilitada, onListo }: { deshabilitada: boolean; onListo: (b: Blob) => void }) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const grabador = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  // Medidor de volumen: el audio del micrófono pasa también por un analizador (no se graba aparte).
  const [nivel, setNivel] = useState(() => evaluar([]));
  const contexto = useRef<AudioContext | null>(null);
  const lecturas = useRef<Lectura[]>([]);
  const medidor = useRef<number | null>(null);

  useEffect(() => {
    if (!grabando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [grabando]);

  const apagarMedidor = () => {
    if (medidor.current !== null) window.clearInterval(medidor.current);
    medidor.current = null;
    void contexto.current?.close().catch(() => undefined);
    contexto.current = null;
  };
  useEffect(() => apagarMedidor, []);

  const encenderMedidor = (flujo: MediaStream) => {
    try {
      const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Contexto) return;
      const ctx = new Contexto();
      const analizador = ctx.createAnalyser();
      analizador.fftSize = 2048;
      ctx.createMediaStreamSource(flujo).connect(analizador);
      const muestras = new Float32Array(analizador.fftSize);
      lecturas.current = [];
      setNivel(evaluar([]));
      medidor.current = window.setInterval(() => {
        analizador.getFloatTimeDomainData(muestras);
        lecturas.current = [...lecturas.current.slice(-40), medir(muestras)];
        setNivel(evaluar(lecturas.current));
      }, 100);
      contexto.current = ctx;
    } catch {
      /* sin medidor: la grabación funciona igual */
    }
  };

  async function iniciar() {
    setAviso(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setAviso("Este navegador no permite grabar. Use “Subir un audio” o “Escribir o pegar”.");
      return;
    }
    try {
      // Reducción de ruido y de eco, y volumen automático: ayudan a Whisper a entender mejor la voz.
      const flujo = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      // 128 kbps: buena calidad de voz; 20 minutos ocupan ~19 MB, dentro del límite de 25 MB.
      const g = new MediaRecorder(flujo, { ...(tipo ? { mimeType: tipo } : {}), audioBitsPerSecond: 128_000 });
      trozos.current = [];
      g.ondataavailable = (e) => e.data.size > 0 && trozos.current.push(e.data);
      g.onstop = () => {
        apagarMedidor();
        flujo.getTracks().forEach((t) => t.stop());
        onListo(new Blob(trozos.current, { type: g.mimeType || "audio/webm" }));
      };
      encenderMedidor(flujo);
      g.start(1000);
      grabador.current = g;
      setSegundos(0);
      setGrabando(true);
    } catch {
      setAviso("No se pudo usar el micrófono. Revise el permiso del navegador para este sitio.");
    }
  }

  function detener() {
    grabador.current?.stop();
    setGrabando(false);
  }

  const mmss = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
  return (
    <div className="zona-audio">
      {grabando ? (
        <button className="grabar activo" onClick={detener}>
          <span className="ondas" aria-hidden><span /><span /><span /></span>
          <span className="grabar-circulo"><span className="cuadro" /></span>
          <span className="grabar-texto">Detener y transcribir<small>{mmss}</small></span>
        </button>
      ) : (
        <button className="grabar" onClick={iniciar} disabled={deshabilitada}>
          <span className="grabar-circulo"><IconoMicrofono /></span>
          <span className="grabar-texto">Empezar a grabar<small>Pulse y dicte la consulta</small></span>
        </button>
      )}
      {grabando && (
        <div className={`medidor medidor-${nivel.estado}`}>
          <div className="medidor-barra" role="meter" aria-label="Volumen del micrófono" aria-valuemin={0}
            aria-valuemax={100} aria-valuenow={nivel.porcentaje}>
            <span className="medidor-relleno" style={{ width: `${nivel.porcentaje}%` }} />
          </div>
          <p className="medidor-mensaje" role="status" aria-live="polite">{nivel.mensaje}</p>
        </div>
      )}
      <p className="ayuda">
        Dicte ojo por ojo y nombre el ojo en cada dato: “presión intraocular, ojo derecho 15, ojo izquierdo 17”.
        Mejor con audífonos con micrófono y en un lugar sin ruido.
      </p>
      {aviso && <p className="aviso-linea">{aviso}</p>}
    </div>
  );
}

function nombreArchivo(b: Blob) {
  return b.type.includes("mp4") ? "dictado.m4a" : "dictado.webm";
}

function localStorageSeguro(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardarLocal(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* almacenamiento no disponible: no es crítico */
  }
}
