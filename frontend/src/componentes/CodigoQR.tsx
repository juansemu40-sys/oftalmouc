import { useMemo } from "react";
import { generarQR, rutaSVG } from "../logica/qr";

/** Dibuja un código QR como SVG nítido (se ve igual en pantalla e impreso). */
export function CodigoQR({ texto, etiqueta, className = "" }: { texto: string; etiqueta: string; className?: string }) {
  const { ruta, lado } = useMemo(() => {
    const qr = generarQR(texto);
    return { ruta: rutaSVG(qr, 4), lado: qr.tamano + 8 };
  }, [texto]);
  return (
    <svg className={`codigo-qr ${className}`} viewBox={`0 0 ${lado} ${lado}`} role="img" aria-label={etiqueta}
      shapeRendering="crispEdges">
      <rect width={lado} height={lado} fill="#fff" />
      <path d={ruta} fill="#000" />
    </svg>
  );
}
