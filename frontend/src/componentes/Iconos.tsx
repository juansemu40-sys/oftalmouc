// Íconos de línea propios (SVG en línea, sin librerías). Heredan el color del texto (currentColor).
import type { ReactNode } from "react";

type P = { className?: string };
const base = (hijos: ReactNode, className = "") => (
  <svg viewBox="0 0 24 24" className={`icono ${className}`} aria-hidden focusable="false" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {hijos}
  </svg>
);

export const IconoMicrofono = ({ className }: P) => base(<>
  <rect x="9" y="3" width="6" height="11" rx="3" />
  <path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /><path d="M9 21h6" />
</>, className);

export const IconoOjo = ({ className }: P) => base(<>
  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
</>, className);

export const IconoRevisar = ({ className }: P) => base(<>
  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
  <rect x="9" y="3" width="6" height="4" rx="1" /><path d="m9 14 2 2 4-4" />
</>, className);

export const IconoEntregar = ({ className }: P) => base(<>
  <path d="M4 4h16v12H5.2L4 17.5z" /><path d="M8 9h8" /><path d="M8 12h5" />
</>, className);

export const IconoEscudo = ({ className }: P) => base(<>
  <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" />
</>, className);

export const IconoAlerta = ({ className }: P) => base(<>
  <path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><path d="M12 17h.01" />
</>, className);

export const IconoCheck = ({ className }: P) => base(<path d="m5 12 5 5L20 7" />, className);

export const IconoChip = ({ className }: P) => base(<>
  <rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
</>, className);

export const IconoImprimir = ({ className }: P) => base(<>
  <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
</>, className);

export const IconoAltavoz = ({ className }: P) => base(<>
  <path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
</>, className);

export const IconoPausa = ({ className }: P) => base(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>, className);

export const IconoDescargar = ({ className }: P) => base(<>
  <path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" />
</>, className);

export const IconoLetraGrande = ({ className }: P) => base(<>
  <path d="M4 19 9.5 5h1L16 19" /><path d="M6.3 14h7.4" /><path d="M17 19l2.5-6.5h.5L22 19" />
</>, className);

export const IconoCelular = ({ className }: P) => base(<>
  <rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" />
</>, className);

export const IconoCopiar = ({ className }: P) => base(<>
  <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" />
</>, className);
