import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PaginaPaciente } from "./componentes/PaginaPaciente";
import "./estilos.css";

// /p/<token> es la página que abre el celular del paciente al escanear el QR: no carga nada del médico.
const enlace = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]{16,64})\/?$/);

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    {enlace ? <PaginaPaciente token={enlace[1]} /> : <App />}
  </StrictMode>,
);
