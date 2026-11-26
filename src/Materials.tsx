import { useMemo, useRef, useState } from 'react';
import { Check, Copy, MessageSquare, Share2, ChevronDown, ChevronRight, Ruler, Scissors, Mic, Plus, Minus, X, MapPin, TriangleAlert, Lightbulb, Store as Store_ } from 'lucide-react';
import type { Extra, Job, Settings } from './types';
import { GROUP_ORDER, dontForget, estimate, frac, type Estimate, type Scopes } from './estimate';
import { DEPT_ORDER, STORES, deptFor, loadStore, nearMe, saveStore, storeSearch, type Dept, type Store } from './pickup';
import { parseItems } from './voice';
import { addItems, qtyText } from './voiceRun';
import type { Issue } from './checks';
import { fmtFtIn } from './units';

type Commit = (fn: (j: Job) => Job) => void;
type Mode = 'trade' | 'aisle';

/** one thing to buy, from Plumb's figures or added by hand */
interface Row {
  id: string;
  name: string;
  qty: string;
  note?: string;
  done: boolean;
  dept: Dept;
  extra?: Extra;
  checkKey?: string;
}

function rowsFor(job: Job, est: Estimate): Row[] {
  const rows: Row[] = (job.extras || []).map((e) => ({ id: e.id, name: e.name, qty: qtyText(e), done: !!e.done, dept: deptFor(e.name), extra: e }));
  for (const it of est.items) rows.push({ id: it.key, name: it.name, qty: it.qty, note: it.note, done: !!job.checks['buy-' + it.key], dept: deptFor(it.name, it.key), checkKey: 'buy-' + it.key });
  // the don't-forget things you buy, not the tools you bring
  for (const d of dontForget(est.scopes)) if (d.group === 'Supplies' || d.group === 'Paint') rows.push({ id: 'df-' + d.key, name: d.name, qty: '', done: !!job.checks['df-' + d.key], dept: deptFor(d.name), checkKey: 'df-' + d.key });
  return rows;
}

export function shoppingText(job: Job, est: Estimate, mode: Mode = 'trade') {
  const lines: string[] = [];
  lines.push(`${job.name}: materials list`);
  if (est.verifiedWalls < est.totalWalls) lines.push(`(${est.totalWalls - est.verifiedWalls} of ${est.totalWalls} walls still estimated)`);
  const rows = rowsFor(job, est).filter((r) => !r.done);
  const sec = (title: string, rs: Row[]) => {
    if (!rs.length) return;
    lines.push('');
    lines.push(title.toUpperCase());
    for (const r of rs) lines.push(`• ${r.name}${r.qty ? `: ${r.qty}` : ''}`);
  };
  if (mode === 'aisle') for (const d of DEPT_ORDER) sec(d, rows.filter((r) => r.dept === d));
  else {
    sec('Added', rows.filter((r) => r.extra));
    for (const g of GROUP_ORDER) sec(g, rows.filter((r) => !r.extra && est.items.some((it) => 'buy-' + it.key === r.checkKey && it.group === g)));
  }
  const forgot = dontForget(est.scopes).filter((d) => !job.checks['df-' + d.key] && d.group !== 'Supplies' && d.group !== 'Paint');
  if (forgot.length) {
    lines.push('');
    lines.push('Bring:');
    for (const d of forgot) lines.push(`• ${d.name}`);
  }
  lines.push('');
  lines.push('Checked-off items are left out. Made with Plumb.');
  return lines.join('\n');
}

/** things that get forgotten on this kind of job, offered as one tap */
const OFTEN: { name: string; when: keyof Scopes | 'any'; unit?: string }[] = [
  { name: 'Caulk', when: 'trim', unit: 'tube' },
  { name: 'Wood glue', when: 'trim' },
  { name: 'Construction adhesive', when: 'trim', unit: 'tube' },
  { name: 'Shims', when: 'any', unit: 'bundle' },
  { name: 'Brad nails', when: 'trim', unit: 'box' },
  { name: 'Wood filler', when: 'trim' },
  { name: "Painter's tape", when: 'any', unit: 'roll' },
  { name: 'Sanding sponges', when: 'trim' },
  { name: 'Utility blades', when: 'any', unit: 'pack' },
  { name: 'Contractor bags', when: 'any', unit: 'box' },
  { name: 'Batteries', when: 'any' },
  { name: 'Pencils', when: 'any' },
  { name: 'Rags', when: 'any' },
  { name: 'Gloves', when: 'any', unit: 'pair' },
  { name: 'Quarter round', when: 'lvp', unit: 'stick' },
  { name: 'Transition strip', when: 'lvp' },
  { name: 'Tile spacers', when: 'tile', unit: 'bag' },
  { name: 'Grout sponge', when: 'tile' },
  { name: 'Roller covers', when: 'walls' },
  { name: 'Drop cloth', when: 'walls' },
  { name: 'Door shims', when: 'doors', unit: 'bundle' },
  { name: 'Trim screws', when: 'doors', unit: 'box' },
];

const MODE_KEY = 'plumb.listmode.v1';
const loadMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'aisle' ? 'aisle' : 'trade';
  } catch {
    return 'trade';
  }
};

export default function Materials({ job, commit, onVerify, toast, issues, onIssue, listening, onVoice }: { job: Job; commit: Commit; onVerify: () => void; toast: (s: string, undoable?: boolean) => void; issues: Issue[]; onIssue: (i: Issue) => void; listening: boolean; onVoice: () => void }) {
  const est = useMemo(() => estimate(job), [job]);
  const [openCut, setOpenCut] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setModeS] = useState<Mode>(loadMode);
  const [store, setStoreS] = useState<Store>(loadStore);
  const [add, setAdd] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const setMode = (m: Mode) => {
    setModeS(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode */
    }
  };
  const setStore = (s: Store) => {
    setStoreS(s);
    saveStore(s);
  };
  const pct = est.totalWalls ? Math.round((est.verifiedWalls / est.totalWalls) * 100) : 0;
  const text = shoppingText(job, est, mode);
  const facts: { label: string; value: string }[] = [];
  if (est.scopes.trim) facts.push({ label: 'Baseboard', value: `${Math.ceil(est.baseIn / 12)} LF` });
  if (est.newDoors) facts.push({ label: est.newDoors === 1 ? 'New door' : 'New doors', value: `${est.newDoors}` });
  if (est.lvpSqft) facts.push({ label: 'LVP floor', value: `${Math.round(est.lvpSqft)} sq ft` });
  if (est.tileSqft) facts.push({ label: 'Tile', value: `${Math.round(est.tileSqft)} sq ft` });
  if (est.wallSqft + est.ceilingSqft) facts.push({ label: 'Paint area', value: `${Math.round(est.wallSqft + est.ceilingSqft)} sq ft` });
  const forget = dontForget(est.scopes);
  const check = (k: string) => commit((j) => ({ ...j, checks: { ...j.checks, [k]: !j.checks[k] } }));
  const rows = rowsFor(job, est);
  const left = rows.filter((r) => !r.done);
  const extras = job.extras || [];
  const storeName = STORES.find((s) => s.id === store)!.name;

  const addText = (t: string) => {
    const items = parseItems(t);
    if (!items.length) {
      toast('Type what you need, like 2 tubes of caulk');
      return;
    }
    commit((j) => addItems(j, items));
    toast(`Added ${items.map((i) => i.name.toLowerCase()).join(', ')}`);
  };
  const taken = (n: string) => {
    const w = n.toLowerCase().split(' ')[0].replace(/s$/, '');
    return rows.some((r) => r.name.toLowerCase().includes(w));
  };
  const often = OFTEN.filter((o) => (o.when === 'any' || est.scopes[o.when]) && !taken(o.name)).slice(0, 12);
  const setQty = (e: Extra, d: number) => {
    if (e.qty + d < 1) {
      commit((j) => ({ ...j, extras: (j.extras || []).filter((x) => x.id !== e.id) }));
      toast(`${e.name} taken off`, true);
      return;
    }
    commit((j) => ({ ...j, extras: (j.extras || []).map((x) => (x.id === e.id ? { ...x, qty: Math.min(999, x.qty + d) } : x)) }));
  };
  const toggle = (r: Row) => {
    if (r.extra) {
      const id = r.extra.id;
      commit((j) => ({ ...j, extras: (j.extras || []).map((x) => (x.id === id ? { ...x, done: !x.done } : x)) }));
    } else if (r.checkKey) check(r.checkKey);
  };

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

  const findLink = (r: Row, label = false) => (
    <a className={`find ${label ? 'lab' : ''}`} href={storeSearch(store, r.name)} target="_blank" rel="noopener noreferrer" aria-label={`Find ${r.name} at ${storeName}`}>
      <Store_ size={16} />
      {label && <span>{storeName}</span>}
    </a>
  );
  const itemRow = (r: Row, aisle = false) => (
    <div key={r.id} className={`irow ${r.done ? 'done' : ''}`}>
      <button className={`item ${r.done ? 'done' : ''}`} onClick={() => toggle(r)} aria-pressed={r.done}>
        <span className={`box ${r.done ? 'on' : ''}`}>{r.done && <Check size={14} />}</span>
        <span className="item-main">
          <span className="item-name">{r.name}</span>
          {r.note && !aisle && <span className="item-note">{r.note}</span>}
        </span>
        {!r.extra && r.qty && <span className="qty">{r.qty}</span>}
      </button>
      {r.extra && !r.done && (
        <span className="qstep" role="group" aria-label={`How many ${r.name}`}>
          <button onClick={() => setQty(r.extra!, -1)} aria-label={r.extra.qty === 1 ? `Take ${r.name} off` : `One less ${r.name}`}>
            {r.extra.qty === 1 ? <X size={15} /> : <Minus size={15} />}
          </button>
          <span>{qtyText(r.extra)}</span>
          <button onClick={() => setQty(r.extra!, 1)} aria-label={`One more ${r.name}`}>
            <Plus size={15} />
          </button>
        </span>
      )}
      {!r.done && findLink(r, aisle)}
    </div>
  );

  if (!job.rooms.length && !extras.length)
    return (
      <div className="mat">
        <div className="mat empty">
          <Ruler size={36} />
          <h2>No rooms yet</h2>
          <p>Sketch a room on the Plan tab. Your list builds itself as you measure. You can add things here any time.</p>
        </div>
        <AddBar add={add} setAdd={setAdd} addRef={addRef} onAdd={addText} listening={listening} onVoice={onVoice} />
      </div>
    );

  const warns = issues.filter((i) => i.level === 'warn');
  const tips = issues.filter((i) => i.level === 'tip');

  return (
    <div className="mat">
      {job.rooms.length > 0 && (
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
      )}

      {(warns.length > 0 || tips.length > 0) && (
        <section className="card checks" aria-label="Things to check">
          {warns.map((i) => (
            <button key={i.key} className="issue warn" onClick={() => onIssue(i)}>
              <TriangleAlert size={18} />
              <span>
                <b>{i.text}</b>
                <span>{i.fix}</span>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
          {tips.slice(0, 2).map((i) => (
            <button key={i.key} className="issue tip" onClick={() => onIssue(i)}>
              <Lightbulb size={18} />
              <span>
                <b>{i.text}</b>
                <span>{i.fix}</span>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </section>
      )}

      <AddBar add={add} setAdd={setAdd} addRef={addRef} onAdd={addText} listening={listening} onVoice={onVoice} />
      {often.length > 0 && (
        <div className="often" role="group" aria-label="Often forgotten">
          <span className="often-t">Often forgotten</span>
          <div className="often-chips">
            {often.map((o) => (
              <button
                key={o.name}
                className="chip sm"
                onClick={() => {
                  commit((j) => addItems(j, [{ name: o.name, qty: 1, unit: o.unit }]));
                  toast(`Added ${o.name.toLowerCase()}`);
                }}
              >
                <Plus size={14} /> {o.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2 className="sec-title">{mode === 'aisle' ? 'Pickup run' : 'Shopping list'}</h2>
          <div className="seg-sm" role="group" aria-label="Sort the list">
            <button className={mode === 'trade' ? 'on' : ''} aria-pressed={mode === 'trade'} onClick={() => setMode('trade')}>
              By job
            </button>
            <button className={mode === 'aisle' ? 'on' : ''} aria-pressed={mode === 'aisle'} onClick={() => setMode('aisle')}>
              By aisle
            </button>
          </div>
        </div>

        {mode === 'aisle' ? (
          <>
            <div className="pickup">
              <p className="pick-sum">
                {left.length ? (
                  <>
                    <b>{left.length}</b> {left.length === 1 ? 'thing' : 'things'} to pick up, in store order
                  </>
                ) : (
                  'Everything is checked off'
                )}
              </p>
              <div className="pick-row">
                <div className="seg-sm" role="group" aria-label="Store">
                  {STORES.map((s) => (
                    <button key={s.id} className={store === s.id ? 'on' : ''} aria-pressed={store === s.id} onClick={() => setStore(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
                <a className="btn sm" href={nearMe(storeName)} target="_blank" rel="noopener noreferrer">
                  <MapPin size={16} /> Nearest
                </a>
              </div>
              <p className="pick-how">Tap an item to open it at {storeName}. Pick your store there once, then filter Pick Up Today. Plumb can't see their stock, their page shows it.</p>
            </div>
            {DEPT_ORDER.map((d) => {
              const rs = left.filter((r) => r.dept === d);
              if (!rs.length) return null;
              return (
                <div key={d} className="group">
                  <h3 className="group-head">
                    {d} <span>{rs.length}</span>
                  </h3>
                  {rs.map((r) => itemRow(r, true))}
                </div>
              );
            })}
            {rows.some((r) => r.done) && (
              <div className="group">
                <h3 className="group-head">
                  Got it <span>{rows.filter((r) => r.done).length}</span>
                </h3>
                {rows.filter((r) => r.done).map((r) => itemRow(r, true))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="muted small pad-t">Tap what you already have. The store button finds it nearby.</p>
            {rows.length === 0 && <p className="muted small pad">Tap a room on the Plan tab and turn on baseboard, flooring or paint.</p>}
            {extras.length > 0 && (
              <div className="group">
                <h3 className="group-head">
                  Added <span>{extras.length}</span>
                </h3>
                {rows.filter((r) => r.extra).map((r) => itemRow(r))}
              </div>
            )}
            {GROUP_ORDER.map((g) => {
              const its = est.items.filter((it) => it.group === g);
              if (!its.length) return null;
              return (
                <div key={g} className="group">
                  <h3 className="group-head">
                    {g} <span>{its.length}</span>
                  </h3>
                  {its.map((it) => itemRow(rows.find((r) => r.id === it.key)!))}
                </div>
              );
            })}
          </>
        )}
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
                {r.windows > 0 && <span>{r.windows} window{r.windows > 1 ? 's' : ''}</span>}
                {r.inside > 0 && <span>{r.inside} cope{r.inside > 1 ? 's' : ''}</span>}
                {r.outside > 0 && <span>{r.outside} miter{r.outside > 1 ? 's' : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="sec-title">Bring</h2>
          <span className="muted small">Tap when it's on the truck</span>
        </div>
        {forget.filter((d) => d.group !== 'Supplies' && d.group !== 'Paint').map((d) => {
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
      <div className="foot">Your jobs stay on this phone. No account, no tracking. Voice is turned into words by your phone or browser; Plumb does the rest on the phone.</div>
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

function AddBar({ add, setAdd, addRef, onAdd, listening, onVoice }: { add: string; setAdd: (s: string) => void; addRef: React.RefObject<HTMLInputElement | null>; onAdd: (t: string) => void; listening: boolean; onVoice: () => void }) {
  return (
    <form
      className="addbar"
      onSubmit={(e) => {
        e.preventDefault();
        if (!add.trim()) return;
        onAdd(add);
        setAdd('');
        addRef.current?.focus();
      }}
    >
      <input ref={addRef} value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add an item" aria-label="Add to the list" enterKeyHint="done" autoComplete="off" />
      <button type="button" className={`addmic ${listening ? 'on' : ''}`} onClick={onVoice} aria-label={listening ? 'Stop listening' : 'Say what to add'} aria-pressed={listening}>
        <Mic size={19} />
      </button>
      <button type="submit" className="btn primary sm" disabled={!add.trim()}>
        Add
      </button>
    </form>
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
