import { PenLine, Ruler, ClipboardList, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';

const STEPS = [
  { icon: PenLine, title: 'Draw the room', body: 'Sketch with one finger. Lines snap straight and square. Start on a corner to attach the next room.' },
  { icon: Ruler, title: 'Tap a wall, type the tape', body: 'Your first number sets the scale. Every wall you measure turns green.' },
  { icon: ClipboardList, title: 'Get the list', body: 'Sticks, cut list, caulk, nails, paint, flooring and tile, sized the way the store sells them.' },
];

export default function Welcome({ onStart, onSample }: { onStart: () => void; onSample: () => void }) {
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <div className="brand big">
          <span className="logo" /> Plumb
        </div>
        <h1 id="welcome-title">Measure once. Buy once.</h1>
        <p className="muted">Sketch the job on your phone and walk into the store with the exact list.</p>
        <ol className="steps">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title}>
              <span className="step-ico" aria-hidden>
                <Icon size={20} />
              </span>
              <span>
                <b>
                  {i + 1}. {title}
                </b>
                <span className="muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <button className="btn primary full" onClick={onStart}>
          Start a job <ArrowRight size={18} />
        </button>
        <button className="btn full ghost" onClick={onSample}>
          <Sparkles size={17} /> Look at a sample job first
        </button>
        <div className="privacy slim">
          <ShieldCheck size={18} />
          <span>No account, no cloud, no AI. Your jobs never leave this phone.</span>
        </div>
      </div>
    </div>
  );
}
