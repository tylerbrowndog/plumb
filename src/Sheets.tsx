import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, DoorOpen, AppWindow, Trash2, Ruler, Check, Scale, Delete, X, RectangleHorizontal, Plus } from 'lucide-react';
import type React from 'react';
import type { FloorType, Job, Opening, OpeningType, Room } from './types';
import { isVerified, uid, wallCount, wallLenIn } from './geometry';
import { fmtFtIn, parseLength } from './units';
import { applyMeasurement } from './measure';

type Commit = (fn: (j: Job) => Job) => void;

function updRoom(j: Job, id: string, fn: (r: Room) => Room): Job {
  return { ...j, rooms: j.rooms.map((r) => (r.id === id ? fn(r) : r)) };
}

// ---------------- Tape bar: a slim keypad that leaves the plan in view ----------------
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const KEY_NAMES: Record<string, string | undefined> = { "'": 'feet', '"': 'inches', '/': 'fraction', ' ': 'space', del: 'Delete last character' };

/** typing on a real keyboard works too */
function usePhysicalKeys(onKey: (k: string) => void, onEnter: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9'"/ .]$/.test(e.key)) {
        e.preventDefault();
        onKey(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        onKey('del');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onEnter();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
}

function TapePad({ onKey, confirm, onConfirm, confirmDisabled, confirmLabel }: { onKey: (k: string) => void; confirm: React.ReactNode; onConfirm: () => void; confirmDisabled?: boolean; confirmLabel?: string }) {
  return (
    <div className="tpad">
      {DIGITS.map((k) => (
        <button key={k} className="tk num" onClick={() => onKey(k)}>
          {k}
        </button>
      ))}
      <button className="tk sym" onClick={() => onKey("'")} aria-label={KEY_NAMES["'"]}>
        ft
      </button>
      <button className="tk sym" onClick={() => onKey('"')} aria-label={KEY_NAMES['"']}>
        in
      </button>
      <button className="tk sym" onClick={() => onKey('/')} aria-label={KEY_NAMES['/']}>
        /
      </button>
      <button className="tk sym wide2" onClick={() => onKey(' ')} aria-label={KEY_NAMES[' ']}>
        space
      </button>
      <button className="tk sym" onClick={() => onKey('del')} aria-label={KEY_NAMES.del}>
        <Delete size={18} />
      </button>
      <button className="tk go" onClick={onConfirm} disabled={confirmDisabled} aria-label={confirmLabel}>
        {confirm}
      </button>
    </div>
  );
}

const typeKey = (t: string, k: string) => (k === 'del' ? t.slice(0, -1) : (t + k).replace(/\s{2,}/g, ' ').replace(/^\s+/, ''));

export function WallSheet({ job, room, wall, commit, onSelectWall, onClose, onDelete, onAddCorner }: { job: Job; room: Room; wall: number; commit: Commit; onSelectWall: (room: string, wall: number) => void; onClose: () => void; onDelete: () => void; onAddCorner: () => void }) {
  const [txt, setTxt] = useState('');
  const [more, setMore] = useState(false);
  useEffect(() => setTxt(''), [room.id, wall]);
  const n = wallCount(room);
  const len = wallLenIn(job, room, wall);
  const verified = isVerified(room, wall);
  const parsed = parseLength(txt);
  const w = room.walls[wall] ?? {};
  const onWall = job.openings.filter((o) => o.room === room.id && o.wall === wall).length;

  // every wall in the job, in drawing order: the bar walks around each room
  const order: { room: string; wall: number }[] = [];
  for (const r of job.rooms) for (let i = 0; i < wallCount(r); i++) order.push({ room: r.id, wall: i });
  const idx = order.findIndex((o) => o.room === room.id && o.wall === wall);
  const go = (d: number) => {
    const o = order[(idx + d + order.length) % order.length];
    onSelectWall(o.room, o.wall);
  };
  const nextUnverified = (j: Job) => {
    for (let s = 1; s <= order.length; s++) {
      const o = order[(idx + s) % order.length];
      const r = j.rooms.find((x) => x.id === o.room);
      if (r && !isVerified(r, o.wall)) return o;
    }
    return null;
  };

  const save = (inches: number, setScale: boolean) => {
    let nextJob: Job | null = null;
    commit((j) => {
      nextJob = applyMeasurement(j, room.id, wall, inches, setScale);
      return nextJob;
    });
    setTxt('');
    const nx = nextJob ? nextUnverified(nextJob) : null;
    if (nx) onSelectWall(nx.room, nx.wall);
    else onClose();
  };

  const canEstimate = job.scaleSet;
  const confirm = () => {
    if (txt) {
      if (parsed != null && parsed > 0) save(parsed, false);
    } else if (verified) {
      const nx = nextUnverified(job);
      if (nx) onSelectWall(nx.room, nx.wall);
      else go(1);
    } else if (canEstimate) save(Math.round(len * 8) / 8, false);
  };
  const key = (k: string) => setTxt((t) => typeKey(t, k));
  usePhysicalKeys(key, confirm);

  const goLabel = txt ? 'Save' : verified ? 'Next' : canEstimate ? `Use ~${fmtFtIn(len)}` : 'Save';
  const toggleNoBase = () =>
    commit((j) =>
      updRoom(j, room.id, (r) => {
        const walls = r.walls.slice();
        walls[wall] = { ...walls[wall], noBase: !walls[wall]?.noBase };
        return { ...r, walls };
      }),
    );

  return (
    <div className="tapebar" role="region" aria-label={`Measure ${room.name}, wall ${wall + 1}`}>
      <div className="tb-head">
        <button className="tb-nav" onClick={() => go(-1)} aria-label="Previous wall">
          <ChevronLeft size={22} />
        </button>
        <div className="tb-read" aria-live="polite">
          <span className="tb-where">
            {txt && parsed == null ? (
              <span className="bad-msg">Try 12 6 or 12' 6 1/2"</span>
            ) : (
              <>
                {room.name}, wall {wall + 1} of {n}
                {!txt && verified && w.predicted ? <span className="tb-tag">worked out</span> : null}
                {!txt && !verified && !canEstimate ? <span className="tb-tag">sets the scale</span> : null}
              </>
            )}
          </span>
          <span className={`tb-len ${txt ? (parsed != null ? 'typed' : 'bad') : verified ? 'ok' : 'est'}`}>
            {txt ? (parsed != null ? fmtFtIn(parsed) : txt) : (verified ? '' : '~') + fmtFtIn(len)}
          </span>
        </div>
        <button className="tb-nav" onClick={() => go(1)} aria-label="Next wall">
          <ChevronRight size={22} />
        </button>
        <button className="tb-nav del" onClick={onDelete} aria-label="Delete this line" title="Delete this line">
          <Trash2 size={19} />
        </button>
        <button className="tb-nav close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <TapePad onKey={key} onConfirm={confirm} confirmDisabled={txt ? parsed == null || parsed <= 0 : !verified && !canEstimate} confirmLabel={goLabel} confirm={<><Check size={17} /> {goLabel}</>} />

      <div className="tb-chips" role="group" aria-label="This wall">
        <button className="chip sm" onClick={onAddCorner}>
          <Plus size={15} /> Corner
        </button>
        <button className="chip sm" onClick={() => addOpening(job, room, wall, 'door', commit)}>
          <DoorOpen size={15} /> Door
        </button>
        <button className="chip sm" onClick={() => addOpening(job, room, wall, 'window', commit)}>
          <AppWindow size={15} /> Window
        </button>
        <button className="chip sm" onClick={() => addOpening(job, room, wall, 'opening', commit)}>
          <RectangleHorizontal size={15} /> Opening
        </button>
        <button className={`chip sm ${w.noBase ? 'on' : ''}`} onClick={toggleNoBase} aria-pressed={!!w.noBase}>
          {w.noBase ? <Check size={14} /> : null} No base
        </button>
        <button className={`chip sm ${more ? 'on' : ''}`} onClick={() => setMore(!more)} aria-expanded={more}>
          More
        </button>
      </div>
      {onWall > 0 && !more ? <div className="tb-note">{onWall === 1 ? '1 opening' : `${onWall} openings`} on this wall. Tap one on the plan to size it.</div> : null}
      {more && (
        <div className="tb-chips">
          {txt && parsed ? (
            <button className="chip sm" onClick={() => save(parsed, true)}>
              <Scale size={14} /> Save and rescale
            </button>
          ) : verified && job.scaleSet ? (
            <button className="chip sm" onClick={() => w.lengthIn && save(w.lengthIn, true)}>
              <Scale size={14} /> Scale the drawing to this
            </button>
          ) : null}
          {verified && (
            <button
              className="chip sm"
              onClick={() =>
                commit((j) =>
                  updRoom(j, room.id, (r) => {
                    const walls = r.walls.slice();
                    walls[wall] = { ...walls[wall], lengthIn: undefined, predicted: undefined };
                    return { ...r, walls };
                  }),
                )
              }
            >
              Clear length
            </button>
          )}
          {txt ? (
            <button className="chip sm" onClick={() => setTxt('')}>
              Clear typing
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function addOpening(job: Job, room: Room, wall: number, type: OpeningType, commit: Commit) {
  const s = job.settings;
  const existing = job.openings.filter((o) => o.room === room.id && o.wall === wall).length;
  const o: Opening = {
    id: uid(),
    room: room.id,
    wall,
    t: [0.5, 0.25, 0.75, 0.15, 0.85][existing % 5],
    type,
    widthIn: type === 'window' ? s.windowWidthIn : type === 'door' ? s.doorWidthIn : 36,
    heightIn: type === 'window' ? s.windowHeightIn : s.doorHeightIn,
    bothSides: type !== 'window',
  };
  commit((j) => ({ ...j, openings: [...j.openings, o] }));
}

// ---------------- Room sheet ----------------
export function RoomSheet({ job, room, commit, onMeasure, onClose, onDelete }: { job: Job; room: Room; commit: Commit; onMeasure: () => void; onClose: () => void; onDelete: () => void }) {
  const n = wallCount(room);
  let verified = 0,
    perim = 0;
  for (let i = 0; i < n; i++) {
    if (isVerified(room, i)) verified++;
    perim += wallLenIn(job, room, i);
  }
  const toggle = (k: 'base' | 'shoe' | 'crown') => commit((j) => updRoom(j, room.id, (r) => ({ ...r, [k]: !r[k] })));
  return (
    <div className="sheet" role="region" aria-label={`Room: ${room.name}`}>
      <div className="sheet-head">
        <input className="name-input" maxLength={60} value={room.name} onChange={(e) => commit((j) => updRoom(j, room.id, (r) => ({ ...r, name: e.target.value })))} aria-label="Room name" />
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="stats">
        <div>
          <b>{fmtFtIn(perim)}</b>
          <span>{room.closed ? 'around the room' : 'total run'}</span>
        </div>
        <div>
          <b>
            {verified}/{n}
          </b>
          <span>walls measured</span>
        </div>
        <div>
          <b>{job.openings.filter((o) => o.room === room.id).length}</b>
          <span>doors and windows</span>
        </div>
      </div>
      <div className="field-label">Trim</div>
      <div className="seg3">
        <button className={room.base ? 'on' : ''} onClick={() => toggle('base')} aria-pressed={room.base}>
          {room.base && <Check size={15} />} Baseboard
        </button>
        <button className={room.shoe ? 'on' : ''} onClick={() => toggle('shoe')} aria-pressed={room.shoe}>
          {room.shoe && <Check size={15} />} Shoe
        </button>
        <button className={room.crown ? 'on' : ''} onClick={() => toggle('crown')} aria-pressed={room.crown}>
          {room.crown && <Check size={15} />} Crown
        </button>
      </div>
      <div className="field-label">New floor</div>
      <div className="seg3">
        {(['none', 'lvp', 'tile'] as FloorType[]).map((f) => (
          <button key={f} className={(room.floor ?? 'none') === f ? 'on' : ''} onClick={() => commit((j) => updRoom(j, room.id, (r) => ({ ...r, floor: f })))} aria-pressed={(room.floor ?? 'none') === f}>
            {f === 'none' ? 'None' : f === 'lvp' ? 'LVP' : 'Tile'}
          </button>
        ))}
      </div>
      <div className="field-label">Paint</div>
      <div className="seg3 two">
        <button className={room.paintWalls ? 'on' : ''} onClick={() => commit((j) => updRoom(j, room.id, (r) => ({ ...r, paintWalls: !r.paintWalls })))} aria-pressed={!!room.paintWalls}>
          {room.paintWalls && <Check size={15} />} Walls
        </button>
        <button className={room.paintCeiling ? 'on' : ''} onClick={() => commit((j) => updRoom(j, room.id, (r) => ({ ...r, paintCeiling: !r.paintCeiling })))} aria-pressed={!!room.paintCeiling}>
          {room.paintCeiling && <Check size={15} />} Ceiling
        </button>
      </div>
      <div className="row gap">
        <button className="btn danger" onClick={onDelete} aria-label="Delete room">
          <Trash2 size={18} />
        </button>
        <button className="btn primary grow" onClick={onMeasure}>
          <Ruler size={18} /> {verified < n ? 'Measure walls' : 'Review walls'}
        </button>
      </div>
    </div>
  );
}

// ---------------- Opening sheet ----------------
const DOOR_W = [24, 28, 30, 32, 36];
const WIN_W = [24, 30, 36, 48, 60, 72];
const WIN_H = [36, 48, 60];

export function OpeningSheet({ job, o, commit, onClose }: { job: Job; o: Opening; commit: Commit; onClose: () => void }) {
  const set = (patch: Partial<Opening>) => commit((j) => ({ ...j, openings: j.openings.map((x) => (x.id === o.id ? { ...x, ...patch } : x)) }));
  const room = job.rooms.find((r) => r.id === o.room);
  const widths = o.type === 'window' ? WIN_W : DOOR_W;
  const [wTxt, setWTxt] = useState(String(o.widthIn));
  const [hTxt, setHTxt] = useState(String(o.heightIn));
  useEffect(() => {
    setWTxt(String(o.widthIn));
    setHTxt(String(o.heightIn));
  }, [o.id, o.widthIn, o.heightIn]);
  const label = o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Cased opening';
  return (
    <div className="sheet" role="region" aria-label={label}>
      <div className="sheet-head">
        <div className="sheet-title">
          <div className="eyebrow">
            {room?.name}, wall {o.wall + 1}
          </div>
          <div className="h2">{label}</div>
        </div>
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="seg3">
        {(['door', 'window', 'opening'] as OpeningType[]).map((t) => (
          <button key={t} className={o.type === t ? 'on' : ''} onClick={() => set({ type: t, bothSides: t !== 'window', heightIn: t === 'window' ? job.settings.windowHeightIn : job.settings.doorHeightIn, widthIn: t === 'window' ? job.settings.windowWidthIn : job.settings.doorWidthIn })}>
            {t === 'door' ? 'Door' : t === 'window' ? 'Window' : 'Opening'}
          </button>
        ))}
      </div>
      <div className="field-label">{o.type === 'door' ? 'Door slab width, inches' : 'Width, inches'}</div>
      <div className="chips tight">
        {widths.map((wd) => (
          <button key={wd} className={`chip ${o.widthIn === wd ? 'on' : ''}`} onClick={() => set({ widthIn: wd })}>
            {wd}"
          </button>
        ))}
        <input
          className="num-input"
          inputMode="decimal"
          value={wTxt}
          onChange={(e) => {
            setWTxt(e.target.value);
            const v = parseFloat(e.target.value);
            if (v > 0) set({ widthIn: v });
          }}
          aria-label="Width in inches"
        />
      </div>
      <div className="field-label">Height, inches</div>
      <div className="chips tight">
        {(o.type === 'window' ? WIN_H : [80, 84, 96]).map((h) => (
          <button key={h} className={`chip ${o.heightIn === h ? 'on' : ''}`} onClick={() => set({ heightIn: h })}>
            {h}"
          </button>
        ))}
        <input
          className="num-input"
          inputMode="decimal"
          value={hTxt}
          onChange={(e) => {
            setHTxt(e.target.value);
            const v = parseFloat(e.target.value);
            if (v > 0) set({ heightIn: v });
          }}
          aria-label="Height in inches"
        />
      </div>
      {o.type === 'door' && (
        <button className={`btn full toggle-row ${o.newDoor ? 'on' : ''}`} onClick={() => set({ newDoor: !o.newDoor })} aria-pressed={!!o.newDoor}>
          <span className={`box ${o.newDoor ? 'on' : ''}`}>{o.newDoor && <Check size={14} />}</span> Buying a new prehung door here
        </button>
      )}
      <div className="row gap">
        <button className="btn danger" onClick={() => { commit((j) => ({ ...j, openings: j.openings.filter((x) => x.id !== o.id) })); onClose(); }} aria-label="Delete">
          <Trash2 size={18} />
        </button>
        {o.type !== 'window' && (
          <button className={`btn grow ${o.bothSides ? 'on' : ''}`} onClick={() => set({ bothSides: !o.bothSides })}>
            {o.bothSides ? <Check size={18} /> : null} Case both sides
          </button>
        )}
        <button className="btn primary grow" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="hint-small">Drag the blue dot on the plan to slide it along the wall.</div>
    </div>
  );
}

// ---------------- Add a room by typing its size ----------------
const ROOM_NAMES = ['Bedroom', 'Bath', 'Kitchen', 'Living', 'Hall', 'Closet'];

export function AddRoomSheet({ defaultName, onAdd, onClose }: { defaultName: string; onAdd: (name: string, lengthIn: number, widthIn: number) => void; onSketch?: () => void; onClose: () => void }) {
  const [field, setField] = useState<0 | 1>(0);
  const [txt, setTxt] = useState<[string, string]>(['', '']);
  const [name, setName] = useState(defaultName);
  const vals = [parseLength(txt[0]), parseLength(txt[1])];
  const key = (k: string) =>
    setTxt((t) => {
      const n = t.slice() as [string, string];
      n[field] = typeKey(n[field], k);
      return n;
    });
  const ready = vals[0] != null && vals[1] != null;
  const confirm = () => {
    if (ready) onAdd(name.trim() || defaultName, vals[0]!, vals[1]!);
    else if (field === 0 && vals[0] != null) setField(1);
    else if (field === 1 && vals[0] == null) setField(0);
  };
  usePhysicalKeys(key, confirm);
  const label = ['Length', 'Width'];
  const goLabel = ready ? 'Add room' : field === 0 ? 'Width next' : 'Add room';
  return (
    <div className="tapebar add-bar" role="region" aria-label="Add a room by its size">
      <div className="tb-head">
        {([0, 1] as const).map((i) => (
          <button key={i} className={`tb-field ${field === i ? 'on' : ''} ${txt[i] && vals[i] == null ? 'bad' : ''}`} onClick={() => setField(i)} aria-pressed={field === i}>
            <span className="tb-where">{label[i]}</span>
            <span className="tb-len">{txt[i] ? (vals[i] != null ? fmtFtIn(vals[i]!) : txt[i]) : <span className="muted">{i === 0 ? 'long way' : 'short way'}</span>}</span>
          </button>
        ))}
        <button className="tb-nav close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <TapePad
        onKey={key}
        onConfirm={confirm}
        confirmDisabled={ready ? false : field === 0 ? vals[0] == null : true}
        confirmLabel={goLabel}
        confirm={
          <>
            <Check size={17} /> {goLabel}
          </>
        }
      />
      <div className="tb-chips" role="group" aria-label="Room name">
        {ROOM_NAMES.map((nm) => (
          <button key={nm} className={`chip sm ${name === nm ? 'on' : ''}`} onClick={() => setName(name === nm ? defaultName : nm)} aria-pressed={name === nm}>
            {name === nm && <Check size={14} />} {nm}
          </button>
        ))}
      </div>
    </div>
  );
}
