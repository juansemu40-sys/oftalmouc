import type { Estado } from "../tipos";

// Los 8 pasos del producto y quién actúa en cada uno: la frontera de la IA, visible.
const PASOS: { nombre: string; actor: "médico" | "IA" | "sistema" }[] = [
  { nombre: "Dictado", actor: "médico" },
  { nombre: "Transcripción", actor: "IA" },
  { nombre: "Extracción", actor: "IA" },
  { nombre: "Borrador", actor: "sistema" },
  { nombre: "Revisión médica", actor: "médico" },
  { nombre: "Guardado", actor: "sistema" },
  { nombre: "Explicación", actor: "IA" },
  { nombre: "Aprobación final", actor: "médico" },
];

/** Último paso COMPLETADO para cada estado de la consulta. */
const COMPLETADO: Record<Estado, number> = {
  CREADA: 0,
  TRANSCRITA: 2,
  BORRADOR: 4,
  GUARDADA: 6,
  EXPLICACION_GENERADA: 7,
  APROBADA: 8,
};

const CLASE_ACTOR = { IA: "ia", médico: "medico", sistema: "sistema" } as const;

export function Progreso({ estado }: { estado: Estado | null }) {
  const hechos = estado ? COMPLETADO[estado] : 0;
  const actual = Math.min(hechos + 1, PASOS.length);
  const paso = PASOS[actual - 1];
  return (
    <div className="progreso">
      <div className="progreso-texto">
        <span className="progreso-contador">{hechos === 8 ? "Consulta completa" : `Paso ${actual} de 8`}</span>
        {hechos < 8 && (
          <span className="progreso-actual">
            {paso.nombre} <span className={`actor actor-${CLASE_ACTOR[paso.actor]}`}>{paso.actor}</span>
          </span>
        )}
      </div>
      <ol className="progreso-pista" aria-label="Pasos de la consulta">
        {PASOS.map((p, i) => {
          const n = i + 1;
          const clase = n <= hechos ? "hecho" : n === actual ? "actual" : "";
          return (
            <li key={p.nombre} className={`${clase} actor-${CLASE_ACTOR[p.actor]}`} title={`${n}. ${p.nombre} (${p.actor})`}
              aria-current={clase === "actual" ? "step" : undefined}>
              <span className="sr">{n}. {p.nombre}, {p.actor}{n <= hechos ? ", completado" : ""}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
