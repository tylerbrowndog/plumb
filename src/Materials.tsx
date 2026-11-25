import { useMemo, useState } from 'react';
import { Check, Copy, MessageSquare, Share2, ChevronDown, Ruler, AlertTriangle, Scissors } from 'lucide-react';
import type { Job, Settings } from './types';
import { GROUP_ORDER, dontForget, estimate, frac, type Estimate } from './estimate';
import { fmtFtIn } from './units';

type Commit = (fn: (j: Job) => Job) => void;

export function shoppingText(job: Job, est: Estimate) {
  const lines: string[] = [];
  lines.push(`${job.name} — trim list`);
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
  if (est.scopes.trim) facts.push({ label: 'baseboard', value: `${Math.ceil(est.baseIn / 12)} LF` });
  if (est.newDoors) facts.push({ label: est.newDoors === 1 ? 'new door' : 'new doors', value: `${est.newDoors}` });
  if (est.lvpSqft) facts.push({ label: 'LVP', value: `${Math.round(est.lvpSqft)} sq ft` });
  if (est.tileSqft) facts.push({ label: 'tile', value: `${Math.round(est.tileSqft)} sq ft` });
  if (est.wallSqft + est.ceilingSqft) facts.push({ label: 'to paint', value: `${Math.round(est.wallSqft + est.ceilingSqft)} sq ft` });
  const lead = facts[0] ? { label: facts[0].label === 'baseboard' ? 'Baseboard needed' : facts[0].label, value: facts[0].value } : { label: 'Nothing picked yet', value: '0' };
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
        <p>Sketch a room on the Plan tab and your trim list shows up here.</p>
      </div>
    );

  return (
    <div className="mat">
      <div className="card hero">
        <div className="hero-top">
          <div>
            <div className="eyebrow">{lead.label}</div>
            <div className="hero-num">{lead.value}</div>
          </div>
          <div className="ring" style={{ ['--p' as string]: pct }} role="img" aria-label={`${pct}% of walls measured`}>
            <span>{pct}%</span>
          </div>
        </div>
        <div className="hero-sub">
          {job.rooms.length} {job.rooms.length === 1 ? 'room' : 'rooms'} · {est.verifiedWalls}/{est.totalWalls} walls measured
        </div>
        {facts.length > 1 && (
          <div className="facts">
            {facts.map((f) => (
              <span key={f.label}>
                <b>{f.value}</b> {f.label}
              </span>
            ))}
          </div>
        )}
        {est.verifiedWalls < est.totalWalls && (
          <button className="btn warn full" onClick={onVerify}>
            <AlertTriangle size={17} /> Measure {est.totalWalls - est.verifiedWalls} more {est.totalWalls - est.verifiedWalls === 1 ? 'wall' : 'walls'} to lock this in
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Shopping list</h3>
          <span className="muted small">tap what you already have</span>
        </div>
        {est.items.length === 0 && <p className="muted small pad">Tap a room on the Plan tab and turn on baseboard, flooring or paint.</p>}
        {GROUP_ORDER.map((g) => {
          const its = est.items.filter((it) => it.group === g);
          if (!its.length) return null;
          return (
            <div key={g} className="group">
              <div className="group-head">{g}</div>
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
        <div className="row gap share-row">
          <button className="btn primary grow" onClick={copy}>
            <Copy size={17} /> Copy list
          </button>
          <a className="btn" href={sms} aria-label="Text the list">
            <MessageSquare size={17} />
          </a>
          <button className="btn" onClick={share} aria-label="Share the list">
            <Share2 size={17} />
          </button>
        </div>
      </div>

      {est.profiles.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>
              <Scissors size={16} /> Cut list
            </h3>
            <span className="muted small">optimized per stick</span>
          </div>
          {est.profiles.map((p) => (
            <div key={p.key} className="cut">
              <button className="cut-head" onClick={() => setOpenCut(openCut === p.key ? null : p.key)}>
                <span>
                  <b>{p.name}</b>
                  <span className="muted small">
                    {' '}
                    · {p.sticks.length} × {p.stickIn / 12}' sticks
                  </span>
                </span>
                <ChevronDown size={18} className={openCut === p.key ? 'rot' : ''} />
              </button>
              {openCut === p.key && (
                <div className="sticks">
                  {p.sticks.map((s, i) => (
                    <div key={i} className="stick">
                      <div className="stick-bar">
                        {s.pieces.map((pc, k) => (
                          <span key={k} style={{ width: `${(pc.len / p.stickIn) * 100}%` }} title={pc.label} />
                        ))}
                      </div>
                      <div className="stick-txt">
                        <b>#{i + 1}</b> {s.pieces.map((pc) => `${pc.label} ${fmtFtIn(pc.len)}`).join(' · ')}
                        <span className="muted"> · offcut {fmtFtIn(Math.max(0, s.left))}</span>
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
          <h3>Rooms</h3>
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
          <h3>Don't forget</h3>
          <span className="muted small">tap when it's on the truck</span>
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
          <h3>Assumptions</h3>
          <ChevronDown size={18} className={showSettings ? 'rot' : ''} />
        </button>
        {showSettings && <SettingsForm s={job.settings} set={(p) => commit((j) => ({ ...j, settings: { ...j.settings, ...p } }))} />}
      </div>
      <div className="foot">Everything stays on this phone. No account, no AI, no tracking.</div>
    </div>
  );
}

function SettingsForm({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const Seg = ({ k, opts, suffix = "'", fmt }: { k: keyof Settings; opts: number[]; suffix?: string; fmt?: (o: number) => string }) => (
    <div className="seg-sm">
      {opts.map((o) => (
        <button key={o} className={s[k] === o ? 'on' : ''} onClick={() => set({ [k]: o } as Partial<Settings>)}>
          {fmt ? fmt(o) : Number.isInteger(o) ? o : frac(o)}
          {fmt ? '' : suffix}
        </button>
      ))}
    </div>
  );
  const Num = ({ k, step = 1 }: { k: keyof Settings; step?: number }) => (
    <div className="stepper">
      <button aria-label="Less" onClick={() => set({ [k]: Math.max(step, +((s[k] as number) - step).toFixed(3)) } as Partial<Settings>)}>−</button>
      <span>{s[k] as number}</span>
      <button aria-label="More" onClick={() => set({ [k]: +((s[k] as number) + step).toFixed(3) } as Partial<Settings>)}>+</button>
    </div>
  );
  const Tog = ({ k }: { k: keyof Settings }) => (
    <button className={`switch ${s[k] ? 'on' : ''}`} onClick={() => set({ [k]: !s[k] } as Partial<Settings>)} aria-pressed={!!s[k]}>
      <span />
    </button>
  );
  return (
    <div className="settings">
      <label>Extra for mistakes (%)</label>
      <Num k="wastePct" step={5} />
      <label>Baseboard stick</label>
      <Seg k="baseStickFt" opts={[8, 12, 16]} />
      <label>Casing stick</label>
      <Seg k="casingStickFt" opts={[7, 8, 14, 16]} />
      <label>Shoe stick</label>
      <Seg k="shoeStickFt" opts={[8, 12, 16]} />
      <label>Crown stick</label>
      <Seg k="crownStickFt" opts={[8, 12, 16]} />
      <label>Baseboard height (in)</label>
      <Seg k="baseHeightIn" opts={[3.25, 4.25, 5.25, 7.25]} suffix='"' />
      <label>Casing width (in)</label>
      <Seg k="casingWidthIn" opts={[2.25, 2.5, 3.25, 3.5]} suffix='"' />
      <label>Default door (in)</label>
      <Seg k="doorWidthIn" opts={[28, 30, 32, 36]} suffix='"' />
      <label>Case windows</label>
      <Tog k="windowCasing" />
      <label>Paint the trim</label>
      <Tog k="paint" />
      <label>Trim is pre-primed</label>
      <Tog k="primed" />
      <label>Paint coats</label>
      <Num k="coats" />
      <label>Caulk: feet per tube</label>
      <Num k="caulkFtPerTube" step={5} />
      <label>Extra per cut (in)</label>
      <Num k="cutAllowanceIn" step={0.5} />
      <div className="settings-head">Walls and ceilings</div>
      <label>Ceiling height</label>
      <Seg k="ceilingIn" opts={[96, 108, 120]} fmt={(o) => `${o / 12}'`} />
      <label>Wall paint coats</label>
      <Num k="wallCoats" />
      <label>New drywall (prime)</label>
      <Tog k="newDrywall" />
      <div className="settings-head">Flooring</div>
      <label>LVP sq ft per box</label>
      <Num k="lvpBoxSqft" step={0.5} />
      <label>Floor waste (%)</label>
      <Num k="floorWastePct" step={5} />
      <label>Pad attached to planks</label>
      <Tog k="padAttached" />
      <div className="settings-head">Tile</div>
      <label>Tile width (in)</label>
      <Seg k="tileWIn" opts={[3, 6, 12, 24]} suffix='"' />
      <label>Tile length (in)</label>
      <Seg k="tileLIn" opts={[6, 12, 24, 48]} suffix='"' />
      <label>Tile sq ft per box</label>
      <Num k="tileBoxSqft" step={0.5} />
      <label>Tile waste (%)</label>
      <Num k="tileWastePct" step={1} />
      <label>Grout joint</label>
      <Seg k="groutJointIn" opts={[0.0625, 0.125, 0.1875, 0.25]} suffix='"' />
      <label>Cement board under tile</label>
      <Tog k="backer" />
    </div>
  );
}
