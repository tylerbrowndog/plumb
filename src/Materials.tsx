import { useMemo, useState } from 'react';
import { Check, Copy, MessageSquare, Share2, ChevronDown, Ruler, Scissors } from 'lucide-react';
import type { Job, Settings } from './types';
import { GROUP_ORDER, dontForget, estimate, frac, type Estimate } from './estimate';
import { fmtFtIn } from './units';

type Commit = (fn: (j: Job) => Job) => void;

export function shoppingText(job: Job, est: Estimate) {
  const lines: string[] = [];
  lines.push(`${job.name}: materials list`);
  if (est.verifiedWalls < est.totalWalls) lines.push(`(${est.totalWalls - est.verifiedWalls} of ${est.totalWalls} walls still estimated)`);
  for (const g of GROUP_ORDER) {
    const its = est.items.filter((it) => it.group === g && !job.checks['buy-' + it.key]);
    if (!its.length) continue;
    lines.push('');
    lines.push(g.toUpperCase());
    for (const it of its) lines.push(`• ${it.name}: ${it.qty}`);
  }
  const forgot = dontForget(est.scopes).filter((d) => !job.checks['df-' + d.key]);
  if (forgot.length) {
    lines.push('');
    lines.push("Don't forget:");
    for (const d of forgot) lines.push(`• ${d.name}`);
  }
  lines.push('');
  lines.push('Checked-off items are left out. Made with Plumb.');
  return lines.join('\n');
}

export default function Materials({ job, commit, onVerify, toast }: { job: Job; commit: Commit; onVerify: () => void; toast: (s: string) => void }) {
  const est = useMemo(() => estimate(job), [job]);
  const [openCut, setOpenCut] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const pct = est.totalWalls ? Math.round((est.verifiedWalls / est.totalWalls) * 100) : 0;
  const text = shoppingText(job, est);
  const facts: { label: string; value: string }[] = [];
  if (est.scopes.trim) facts.push({ label: 'Baseboard', value: `${Math.ceil(est.baseIn / 12)} LF` });
  if (est.newDoors) facts.push({ label: est.newDoors === 1 ? 'New door' : 'New doors', value: `${est.newDoors}` });
  if (est.lvpSqft) facts.push({ label: 'LVP floor', value: `${Math.round(est.lvpSqft)} sq ft` });
  if (est.tileSqft) facts.push({ label: 'Tile', value: `${Math.round(est.tileSqft)} sq ft` });
  if (est.wallSqft + est.ceilingSqft) facts.push({ label: 'Paint area', value: `${Math.round(est.wallSqft + est.ceilingSqft)} sq ft` });
  const forget = dontForget(est.scopes);
  const check = (k: string) => commit((j) => ({ ...j, checks: { ...j.checks, [k]: !j.checks[k] } }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('List copied');
    } catch {
      toast('Copy blocked, use Share');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: job.name, text });
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') copy();
      }
    } else copy();
  };
  const sms = `sms:?&body=${encodeURIComponent(text)}`;

  if (!job.rooms.length)
    return (
      <div className="mat empty">
        <Ruler size={36} />
        <h2>No rooms yet</h2>
        <p>Sketch a room on the Plan tab. Your list builds itself as you measure.</p>
      </div>
    );

  return (
    <div className="mat">
      <section className="card hero" aria-label="Job summary">
        <h1 className="sr-only">Materials for {job.name}</h1>
        {facts.length > 0 ? (
          <dl className="facts">
            {facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="hero-sub">Tap a room on the plan and pick baseboard, flooring or paint.</p>
        )}
        <div className="hero-progress">
          <span className="tape-progress lg" role="img" aria-label={`${pct}% of walls measured`}>
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="hero-sub">
            {est.verifiedWalls === est.totalWalls ? `All ${est.totalWalls} walls measured in ${job.rooms.length} ${job.rooms.length === 1 ? 'room' : 'rooms'}` : `${est.verifiedWalls} of ${est.totalWalls} walls measured. The rest are estimated from your sketch.`}
          </span>
        </div>
        {est.verifiedWalls < est.totalWalls && (
          <button className="btn warn full" onClick={onVerify}>
            <Ruler size={18} /> Measure the last {est.totalWalls - est.verifiedWalls} {est.totalWalls - est.verifiedWalls === 1 ? 'wall' : 'walls'}
          </button>
        )}
      </section>

      <div className="card">
        <div className="card-head">
          <h2 className="sec-title">Shopping list</h2>
          <span className="muted small">Tap what you already have</span>
        </div>
        {est.items.length === 0 && <p className="muted small pad">Tap a room on the Plan tab and turn on baseboard, flooring or paint.</p>}
        {GROUP_ORDER.map((g) => {
          const its = est.items.filter((it) => it.group === g);
          if (!its.length) return null;
          return (
            <div key={g} className="group">
              <h3 className="group-head">
                {g} <span>{its.length}</span>
              </h3>
              {its.map((it) => {
                const on = !!job.checks['buy-' + it.key];
                return (
                  <button key={it.key} className={`item ${on ? 'done' : ''}`} onClick={() => check('buy-' + it.key)} aria-pressed={on}>
                    <span className={`box ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>
                    <span className="item-main">
                      <span className="item-name">{it.name}</span>
                      {it.note && <span className="item-note">{it.note}</span>}
                    </span>
                    <span className="qty">{it.qty}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {est.profiles.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2 className="sec-title">
              <Scissors size={18} /> Cut list
            </h2>
            <span className="muted small">What to cut from each stick</span>
          </div>
          {est.profiles.map((p) => (
            <div key={p.key} className="cut">
              <button className="cut-head" onClick={() => setOpenCut(openCut === p.key ? null : p.key)}>
                <span>
                  <b>{p.name}</b>
                  <span className="muted small">
                    {' '}
                    {p.sticks.length} × {p.stickIn / 12}' sticks
                  </span>
                </span>
                <ChevronDown size={18} className={openCut === p.key ? 'rot' : ''} />
              </button>
              {openCut === p.key && (
                <div className="sticks">
                  {p.sticks.map((s, i) => (
                    <div key={i} className="stick">
                      <div className="stick-bar" aria-hidden>
                        {s.pieces.map((pc, k) => (
                          <span key={k} style={{ width: `${(pc.len / p.stickIn) * 100}%` }} title={pc.label} />
                        ))}
                      </div>
                      <div className="stick-txt">
                        <b>Stick {i + 1}:</b> {s.pieces.map((pc) => `${pc.label} ${fmtFtIn(pc.len)}`).join(', ')}
                        <span className="muted">. Offcut {fmtFtIn(Math.max(0, s.left))}</span>
                      </div>
                    </div>
                  ))}
                  <div className="hint-small">Each piece includes {job.settings.cutAllowanceIn}" extra for miters and copes.</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2 className="sec-title">Rooms</h2>
        </div>
        <div className="rooms-table">
          {est.rooms.map((r) => (
            <div key={r.room.id} className="rrow">
              <div className="rrow-name">
                <b>{r.room.name}</b>
                <span className="muted small">
                  {r.verified}/{r.walls} measured
                </span>
              </div>
              <div className="rrow-facts">
                <span>{fmtFtIn(r.perimeterIn)} walls</span>
                {r.room.closed && <span>{Math.round(r.areaIn2 / 144)} sq ft</span>}
                {r.room.floor === 'lvp' && <span>LVP</span>}
                {r.room.floor === 'tile' && <span>tile</span>}
                {(r.room.paintWalls || r.room.paintCeiling) && <span>paint {[r.room.paintWalls && 'walls', r.room.paintCeiling && 'ceiling'].filter(Boolean).join(' + ')}</span>}
                {r.baseIn > 0 && <span>{Math.ceil(r.baseIn / 12)} LF base</span>}
                {r.doors + r.openings > 0 && <span>{r.doors + r.openings} door{r.doors + r.openings > 1 ? 's' : ''}</span>}
                {r.windows > 0 && <span>{r.windows} win</span>}
                {r.inside > 0 && <span>{r.inside} copes</span>}
                {r.outside > 0 && <span>{r.outside} miters</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="sec-title">Don't forget</h2>
          <span className="muted small">Tap when it's on the truck</span>
        </div>
        {forget.map((d) => {
          const on = !!job.checks['df-' + d.key];
          return (
            <button key={d.key} className={`item slim ${on ? 'done' : ''}`} onClick={() => check('df-' + d.key)} aria-pressed={on}>
              <span className={`box ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>
              <span className="item-main">
                <span className="item-name">{d.name}</span>
              </span>
              <span className="tag">{d.group}</span>
            </button>
          );
        })}
      </div>

      <div className="card">
        <button className="cut-head" onClick={() => setShowSettings(!showSettings)}>
          <h2 className="sec-title">Assumptions</h2>
          <ChevronDown size={18} className={showSettings ? 'rot' : ''} />
        </button>
        {showSettings && <SettingsForm s={job.settings} set={(p) => commit((j) => ({ ...j, settings: { ...j.settings, ...p } }))} />}
      </div>
      <div className="foot">Everything stays on this phone. No account, no AI, no tracking.</div>
      <div className="act-bar">
        <button className="btn primary grow" onClick={copy}>
          <Copy size={18} /> Copy list
        </button>
        <a className="btn sq" href={sms} aria-label="Text the list">
          <MessageSquare size={19} />
        </a>
        <button className="btn sq" onClick={share} aria-label="Share the list">
          <Share2 size={19} />
        </button>
      </div>
    </div>
  );
}

function SettingsForm({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const Seg = ({ name, k, opts, suffix = "'", fmt }: { name: string; k: keyof Settings; opts: number[]; suffix?: string; fmt?: (o: number) => string }) => (
    <div className="seg-sm" role="group" aria-label={name}>
      {opts.map((o) => (
        <button key={o} className={s[k] === o ? 'on' : ''} aria-pressed={s[k] === o} onClick={() => set({ [k]: o } as Partial<Settings>)}>
          {fmt ? fmt(o) : Number.isInteger(o) ? o : frac(o)}
          {fmt ? '' : suffix}
        </button>
      ))}
    </div>
  );
  const Num = ({ name, k, step = 1 }: { name: string; k: keyof Settings; step?: number }) => (
    <div className="stepper" role="group" aria-label={name}>
      <button aria-label={`Less ${name.toLowerCase()}`} onClick={() => set({ [k]: Math.max(step, +((s[k] as number) - step).toFixed(3)) } as Partial<Settings>)}>−</button>
      <span aria-live="polite">{s[k] as number}</span>
      <button aria-label={`More ${name.toLowerCase()}`} onClick={() => set({ [k]: +((s[k] as number) + step).toFixed(3) } as Partial<Settings>)}>+</button>
    </div>
  );
  const Tog = ({ name, k }: { name: string; k: keyof Settings }) => (
    <button role="switch" aria-checked={!!s[k]} aria-label={name} className={`switch ${s[k] ? 'on' : ''}`} onClick={() => set({ [k]: !s[k] } as Partial<Settings>)} >
      <span />
    </button>
  );
  return (
    <div className="settings">
      <label>Extra for mistakes (%)</label>
      <Num name="Extra for mistakes (%)" k="wastePct" step={5} />
      <label>Baseboard stick</label>
      <Seg name="Baseboard stick" k="baseStickFt" opts={[8, 12, 16]} />
      <label>Casing stick</label>
      <Seg name="Casing stick" k="casingStickFt" opts={[7, 8, 14, 16]} />
      <label>Shoe stick</label>
      <Seg name="Shoe stick" k="shoeStickFt" opts={[8, 12, 16]} />
      <label>Crown stick</label>
      <Seg name="Crown stick" k="crownStickFt" opts={[8, 12, 16]} />
      <label>Baseboard height (in)</label>
      <Seg name="Baseboard height (in)" k="baseHeightIn" opts={[3.25, 4.25, 5.25, 7.25]} suffix='"' />
      <label>Casing width (in)</label>
      <Seg name="Casing width (in)" k="casingWidthIn" opts={[2.25, 2.5, 3.25, 3.5]} suffix='"' />
      <label>Default door (in)</label>
      <Seg name="Default door (in)" k="doorWidthIn" opts={[28, 30, 32, 36]} suffix='"' />
      <label>Case windows</label>
      <Tog name="Case windows" k="windowCasing" />
      <label>Paint the trim</label>
      <Tog name="Paint the trim" k="paint" />
      <label>Trim is pre-primed</label>
      <Tog name="Trim is pre-primed" k="primed" />
      <label>Paint coats</label>
      <Num name="Paint coats" k="coats" />
      <label>Caulk: feet per tube</label>
      <Num name="Caulk: feet per tube" k="caulkFtPerTube" step={5} />
      <label>Extra per cut (in)</label>
      <Num name="Extra per cut (in)" k="cutAllowanceIn" step={0.5} />
      <div className="settings-head">Walls and ceilings</div>
      <label>Ceiling height</label>
      <Seg name="Ceiling height" k="ceilingIn" opts={[96, 108, 120]} fmt={(o) => `${o / 12}'`} />
      <label>Wall paint coats</label>
      <Num name="Wall paint coats" k="wallCoats" />
      <label>New drywall (prime)</label>
      <Tog name="New drywall (prime)" k="newDrywall" />
      <div className="settings-head">Flooring</div>
      <label>LVP sq ft per box</label>
      <Num name="LVP sq ft per box" k="lvpBoxSqft" step={0.5} />
      <label>Floor waste (%)</label>
      <Num name="Floor waste (%)" k="floorWastePct" step={5} />
      <label>Pad attached to planks</label>
      <Tog name="Pad attached to planks" k="padAttached" />
      <div className="settings-head">Tile</div>
      <label>Tile width (in)</label>
      <Seg name="Tile width (in)" k="tileWIn" opts={[3, 6, 12, 24]} suffix='"' />
      <label>Tile length (in)</label>
      <Seg name="Tile length (in)" k="tileLIn" opts={[6, 12, 24, 48]} suffix='"' />
      <label>Tile sq ft per box</label>
      <Num name="Tile sq ft per box" k="tileBoxSqft" step={0.5} />
      <label>Tile waste (%)</label>
      <Num name="Tile waste (%)" k="tileWastePct" step={1} />
      <label>Grout joint</label>
      <Seg name="Grout joint" k="groutJointIn" opts={[0.0625, 0.125, 0.1875, 0.25]} suffix='"' />
      <label>Cement board under tile</label>
      <Tog name="Cement board under tile" k="backer" />
    </div>
  );
}
