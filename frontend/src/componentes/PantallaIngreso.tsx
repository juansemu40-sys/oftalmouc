// Ingreso del médico. Sin sesión no se ve ninguna consulta ni se puede usar la IA.
// La contraseña la define el propio médico en el archivo .env (MEDICO_CLAVE); el servidor limita los intentos.
import { useState, type FormEvent } from "react";
import { ErrorApi, api } from "../api";

interface Props {
  configurada: boolean;
  aviso?: string | null;
  onIngreso: (usuario: string) => void;
}

export function PantallaIngreso({ configurada, aviso, onIngreso }: Props) {
  const [usuario, setUsuario] = useState("medico");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await api.iniciarSesion(usuario.trim(), clave);
      setClave("");
      onIngreso(r.usuario);
    } catch (err) {
      setClave("");
      setError(err instanceof ErrorApi ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="ingreso">
      <form className="tarjeta ingreso-tarjeta" onSubmit={entrar} aria-labelledby="titulo-ingreso">
        <img className="ingreso-logo" src="/logo-oftalmouc.png" alt="OftalmoUC · Cuida tu visión" />
        <h1 id="titulo-ingreso">Ingreso del médico</h1>
        <p className="meta">Las historias clínicas solo se ven después de iniciar sesión.</p>

        {aviso && <p className="ingreso-aviso" role="status">{aviso}</p>}
        {!configurada && (
          <div className="ingreso-ayuda" role="note">
            <strong>Falta configurar la contraseña.</strong> Abra el archivo <code>.env</code> de la aplicación, escriba
            una línea <code>MEDICO_CLAVE=</code> con su contraseña (mínimo 10 caracteres) y vuelva a abrir la
            aplicación con <strong>iniciar.bat</strong>.
          </div>
        )}

        <label className="campo">
          <span className="campo-etiqueta">Usuario</span>
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username"
            required maxLength={80} />
        </label>
        <label className="campo">
          <span className="campo-etiqueta">Contraseña</span>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)}
            autoComplete="current-password" required maxLength={200} autoFocus />
        </label>
        {error && <p className="ingreso-error" role="alert">{error}</p>}
        <button className="primario grande" type="submit" disabled={enviando || !clave || !usuario.trim()}>
          {enviando ? "Verificando…" : "Entrar"}
        </button>
        <p className="ingreso-pie">Tras 5 intentos fallidos el ingreso se bloquea 15 minutos.</p>
      </form>
    </main>
  );
}
