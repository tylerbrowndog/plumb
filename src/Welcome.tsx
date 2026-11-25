import { ShieldCheck } from 'lucide-react';

const STEPS = [
  { title: 'Draw the rooms', body: 'Sketch each room with a finger. Lines snap straight and corners snap square.' },
  { title: 'Tap a wall, type the tape', body: 'The keypad walks you wall to wall. Two sides of a square room fill in the rest.' },
  { title: 'Take the list to the store', body: 'Sticks and cuts, caulk, nails, paint, flooring and tile, in the sizes the store sells.' },
];

// A small hand-drawn plan: the thing the app makes, shown before anything else.
function PlanSketch() {
  const tape = (x: number, y: number, w: number, t: string, rot = 0) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-w / 2} y={-11} width={w} height={22} rx={2.5} fill="var(--tape)" stroke="var(--tape-edge)" />
      <rect x={-w / 2 + 2} y={-11} width={w - 4} height={22} fill="url(#wTicks)" />
      <text textAnchor="middle" dy="4.5" className="lbl" fill="var(--tape-ink)">
        {t}
      </text>
    </g>
  );
  return (
    <svg className="welcome-plan" viewBox="0 0 320 190" role="img" aria-label="A sketched kitchen and hall with measured walls">
      <defs>
        <pattern id="wGrid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M 12 0 L 0 0 0 12" fill="none" stroke="var(--grid)" />
        </pattern>
        <pattern id="wGridM" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--grid-major)" />
        </pattern>
        <pattern id="wTicks" width="4" height="22" patternUnits="userSpaceOnUse" y="-11">
          <path d="M 0.5 0 V 3.5 M 0.5 18.5 V 22" stroke="var(--tape-ink)" opacity="0.5" />
        </pattern>
      </defs>
      <rect width="320" height="190" fill="var(--canvas)" />
      <rect width="320" height="190" fill="url(#wGrid)" />
      <rect width="320" height="190" fill="url(#wGridM)" />
      <path d="M60 36 H216 V96 H264 V156 H60 Z" fill="var(--room)" stroke="var(--wall)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M216 96 V156" stroke="var(--wall)" strokeWidth="3" />
      <line x1="120" y1="156" x2="150" y2="156" stroke="var(--canvas)" strokeWidth="5" />
      <line x1="120" y1="156" x2="120" y2="126" stroke="var(--door)" strokeWidth="2" />
      <path d="M120 126 A30 30 0 0 1 150 156" fill="none" stroke="var(--door)" strokeDasharray="3 3" />
      <text x="138" y="96" textAnchor="middle" className="rname">
        Kitchen
      </text>
      <text x="240" y="132" textAnchor="middle" className="rarea">
        Hall
      </text>
      {tape(138, 20, 64, "13' 2\"")}
      {tape(40, 96, 56, "10' 0\"", -90)}
      <g transform="translate(240 80)">
        <rect x={-30} y={-11} width={60} height={22} rx={2.5} fill="var(--chip)" stroke="var(--pencil)" strokeWidth="1.25" strokeDasharray="3 2.5" />
        <text textAnchor="middle" dy="4.5" className="lbl" fill="var(--pencil)">
          ~4' 0"
        </text>
      </g>
      <circle cx="216" cy="36" r="5" fill="var(--chalk)" />
      <path d="M216 36 L232 22" stroke="var(--chalk)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Welcome({ onStart, onSample }: { onStart: () => void; onSample: () => void }) {
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <div className="brand">
          <span className="logo" aria-hidden /> Plumb
        </div>
        <PlanSketch />
        <h1 id="welcome-title">Measure once. Buy once.</h1>
        <p className="welcome-lede">Draw the room, put in your tape lengths, and walk into the store with the exact list.</p>
        <ol className="steps">
          {STEPS.map(({ title, body }, i) => (
            <li key={title}>
              <span className="step-n" aria-hidden>
                {i + 1}
              </span>
              <span>
                <b>{title}</b>
                <span className="muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="welcome-actions">
          <button className="btn primary full" onClick={onStart} autoFocus>
            Start a job
          </button>
          <button className="btn full ghost" onClick={onSample}>
            Look at a sample job first
          </button>
        </div>
        <p className="privacy slim">
          <ShieldCheck size={18} aria-hidden />
          <span>No account, no cloud, no AI. Your jobs never leave this phone.</span>
        </p>
      </div>
    </div>
  );
}
