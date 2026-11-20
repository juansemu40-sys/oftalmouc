// Lo que ve el paciente al escanear el QR: su explicación aprobada, para escuchar y leer en el celular.
// Pensada para adultos mayores y personas que no ven bien: un botón grande, letra que se agranda y voz.
// No carga nada del médico (ni historia clínica, ni trazas, ni otras consultas).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ErrorApi, api } from "../api";
import { fecha } from "../logica/formato";
import { dividirEnFrases, elegirVoz, textoParaVoz } from "../logica/voz";
import { IconoAltavoz, IconoPausa } from "./Iconos";
import type { ExplicacionPaciente } from "../tipos";

const TAMANOS = [1.15, 1.35, 1.6, 1.9];
const hayVozNavegador = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function PaginaPaciente({ token }: { token: string }) {
  const [datos, setDatos] = useState<ExplicacionPaciente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tamano, setTamano] = useState(1);
  const [lento, setLento] = useState(true);
  const [estado, setEstado] = useState<"quieto" | "cargando" | "sonando" | "pausado">("quieto");
  const [url, setUrl] = useState<string | null>(null);
  const [conNavegador, setConNavegador] = useState(false);
  const [voces, setVoces] = useState<SpeechSynthesisVoice[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const lectura = useRef(0);

  useEffect(() => {
    document.title = "Su explicación · OftalmoUC";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    api.paciente(token).then(setDatos).catch((e) => {
      setError(e instanceof ErrorApi && e.codigo === "enlace_no_disponible"
        ? e.message
        : "No pudimos abrir su explicación. Revise que el celular tenga conexión e inténtelo de nuevo.");
    });
    return () => { meta.remove(); };
  }, [token]);

  useEffect(() => {
    if (!hayVozNavegador()) return;
    const cargar = () => setVoces(window.speechSynthesis.getVoices());
    cargar();
    window.speechSynthesis.addEventListener("voiceschanged", cargar);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", cargar);
      window.speechSynthesis.cancel();
    };
  }, []);
  const vozNavegador = useMemo(() => { const i = elegirVoz(voces); return i >= 0 ? voces[i] : null; }, [voces]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => { if (audio.current) audio.current.playbackRate = lento ? 0.9 : 1; }, [lento, url]);
  useEffect(() => { if (url) void audio.current?.play().catch(() => setEstado("pausado")); }, [url]);

  const leerConNavegador = () => {
    if (!datos || !hayVozNavegador()) { setEstado("quieto"); return; }
    const s = window.speechSynthesis;
    s.cancel();
    const id = ++lectura.current;
    const frases = dividirEnFrases(textoParaVoz(datos.explicacion));
    frases.forEach((texto, i) => {
      const f = new SpeechSynthesisUtterance(texto);
      if (vozNavegador) { f.voice = vozNavegador; f.lang = vozNavegador.lang; } else f.lang = "es-CO";
      f.rate = lento ? 0.88 : 1;
      const fin = () => { if (lectura.current === id) setEstado("quieto"); };
      if (i === frases.length - 1) f.onend = fin;
      f.onerror = fin;
      s.speak(f);
    });
    setConNavegador(true);
    setEstado("sonando");
  };

  const escuchar = async () => {
    if (conNavegador) {
      if (estado === "sonando") { window.speechSynthesis.pause(); setEstado("pausado"); return; }
      if (estado === "pausado") { window.speechSynthesis.resume(); setEstado("sonando"); return; }
      leerConNavegador();
      return;
    }
    if (url && audio.current) {
      if (estado === "sonando") audio.current.pause();
      else void audio.current.play();
      return;
    }
    if (!datos?.voz.disponible) { leerConNavegador(); return; }
    setEstado("cargando");
    try {
      const r = await api.audioPaciente(token);
      setUrl(URL.createObjectURL(r.blob));
    } catch {
      leerConNavegador(); // si la voz del consultorio no responde, lee el celular
    }
  };

  if (error) {
    return (
      <main className="pagina-paciente">
        <Cabecera />
        <div className="paciente-error" role="alert">{error}</div>
      </main>
    );
  }
  if (!datos) {
    return <main className="pagina-paciente"><Cabecera /><p className="paciente-cargando">Abriendo su explicación…</p></main>;
  }

  const etiquetaBoton = estado === "cargando" ? "Preparando la voz…"
    : estado === "sonando" ? "Pausar"
    : estado === "pausado" ? "Continuar"
    : (url || conNavegador) ? "Escuchar de nuevo" : "Escuchar mi explicación";

  return (
    <main className="pagina-paciente" style={{ "--letra-paciente": `${TAMANOS[tamano]}rem` } as CSSProperties}>
      <Cabecera />
      <p className="paciente-meta">
        {datos.ips && <>{datos.ips}<br /></>}
        Revisada y aprobada por {datos.medico}{datos.aprobado_en ? ` el ${fecha(datos.aprobado_en)}` : ""}.
      </p>

      <button className="primario paciente-escuchar con-icono" onClick={escuchar} disabled={estado === "cargando"}>
        {estado === "sonando" ? <IconoPausa /> : <IconoAltavoz />}{etiquetaBoton}
      </button>
      {url && !conNavegador && (
        <audio ref={audio} src={url} controls className="paciente-audio" aria-label="Audio de su explicación"
          onPlay={() => setEstado("sonando")} onPause={() => setEstado("pausado")} onEnded={() => setEstado("quieto")} />
      )}

      <div className="paciente-ajustes">
        <label className="escuchar-lento">
          <input type="checkbox" checked={lento} onChange={(e) => setLento(e.target.checked)} />
          Más despacio
        </label>
        <div className="paciente-letra" role="group" aria-label="Tamaño de la letra">
          <button className="secundario" onClick={() => setTamano((t) => Math.max(0, t - 1))} disabled={tamano === 0}
            aria-label="Letra más pequeña">A−</button>
          <button className="secundario" onClick={() => setTamano((t) => Math.min(TAMANOS.length - 1, t + 1))}
            disabled={tamano === TAMANOS.length - 1} aria-label="Letra más grande">A+</button>
        </div>
      </div>

      <article className="paciente-texto">{datos.explicacion}</article>

      <footer className="paciente-pie">
        Este enlace es solo para usted. Estará disponible hasta el {fecha(datos.expira_en)}.
      </footer>
    </main>
  );
}

function Cabecera() {
  return (
    <header className="paciente-cabecera">
      <img src="/logo-oftalmouc.png" alt="OftalmoUC · Cuida tu visión" />
      <h1>Su explicación de la consulta</h1>
    </header>
  );
}
