// Emblema de la app: un iris dibujado en SVG (fibras radiales, pupila y brillo). Puramente decorativo.

const FIBRAS = Array.from({ length: 72 }, (_, i) => {
  const angulo = (i / 72) * Math.PI * 2;
  const largo = i % 3 === 0 ? 0.98 : i % 2 === 0 ? 0.9 : 0.82;
  return {
    x1: 50 + Math.cos(angulo) * 17,
    y1: 50 + Math.sin(angulo) * 17,
    x2: 50 + Math.cos(angulo) * 38 * largo,
    y2: 50 + Math.sin(angulo) * 38 * largo,
  };
});

export function Iris({ className = "", detallado = true }: { className?: string; detallado?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden focusable="false">
      <defs>
        <radialGradient id="iris-color" cx="50%" cy="50%" r="50%">
          <stop offset="30%" stopColor="#7FD1C7" />
          <stop offset="62%" stopColor="#1E8C8A" />
          <stop offset="100%" stopColor="#0D3B5E" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#iris-color)" />
      {detallado && (
        <g stroke="#E6FFFB" strokeOpacity="0.35" strokeWidth="0.6" strokeLinecap="round">
          {FIBRAS.map((f, i) => <line key={i} {...f} />)}
        </g>
      )}
      <circle cx="50" cy="50" r="40" fill="none" stroke="#0B2545" strokeWidth="3" strokeOpacity="0.55" />
      <circle cx="50" cy="50" r="15" fill="#08182E" />
      <circle cx="43" cy="42" r="5" fill="#FFFFFF" fillOpacity="0.85" />
      <circle cx="58" cy="57" r="2" fill="#FFFFFF" fillOpacity="0.45" />
    </svg>
  );
}
