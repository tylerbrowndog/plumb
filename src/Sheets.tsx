import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, DoorOpen, AppWindow, Trash2, Ruler, Check, Scale, Delete, X, RectangleHorizontal } from 'lucide-react';
import type { FloorType, Job, Opening, OpeningType, Room } from './types';
import { dist, drawnLen, isSquareRoom, isVerified, reshapeWall, uid, wallCount, wallEnds, wallLenIn } from './geometry';
import { fmtFtIn, parseLength } from './units';

type Commit = (fn: (j: Job) => Job) => void;

function updRoom(j: Job, id: string, fn: (r: Room) => Room): Job {
  return { ...j, rooms: j.rooms.map((r) => (r.id === id ? fn(r) : r)) };
}

// ---------------- Wall sheet with tape keypad ----------------
export function WallSheet({ job, room, wall, commit, onSelectWall, onClose }: { job: Job; room: Room; wall: number; commit: Commit; onSelectWall: (room: string, wall: number) => void; onClose: () => void }) {
  const [txt, setTxt] = useState('');
  useEffect(() => setTxt(''), [room.id, wall]);
  const n = wallCount(room);
  const len = wallLenIn(job, room, wall);
  const verified = isVerified(room, wall);
  const parsed = parseLength(txt);
  const w = room.walls[wall] ?? {};

  // unverified walls across the whole job, in order
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
      const r = j.rooms.find((x) => x.id === o.room)!;
      if (!isVerified(r, o.wall)) return o;
    }
    return null;
  };

  const save = (inches: number, setScale: boolean) => {
    let nextJob: Job | null = null;
    commit((j) => {
      let nj = updRoom(j, room.id, (r) => {
        const walls = r.walls.slice();
        walls[wall] = { ...walls[wall], lengthIn: inches };
        return { ...r, walls };
      });
      // a shared wall is one real wall: copy the length to the matching wall of an attached room
      const [a, b] = wallEnds(room, wall);
      nj = {
        ...nj,
        rooms: nj.rooms.map((r) => {
          if (r.id === room.id) return r;
          let walls = r.walls;
          for (let i = 0; i < wallCount(r); i++) {
            const [c, d] = wallEnds(r, i);
            const same = (dist(a, c) < 0.5 && dist(b, d) < 0.5) || (dist(a, d) < 0.5 && dist(b, c) < 0.5);
            if (same && r.walls[i]?.lengthIn == null) {
              walls = walls === r.walls ? walls.slice() : walls;
              walls[i] = { ...walls[i], lengthIn: inches };
            }
          }
          return walls === r.walls ? r : { ...r, walls };
        }),
      };
      const dl = drawnLen(room, wall);
      if ((setScale || !j.scaleSet) && dl > 0) nj = { ...nj, inPerUnit: inches / dl, scaleSet: true };
      // a square room has two pairs of equal walls: measuring one fills in the one across from it
      const square = isSquareRoom(room);
      const across = (wall + 2) % 4;
      nj = reshapeWall(nj, room.id, wall, inches);
      if (square && !isVerified(room, across))
        nj = updRoom(nj, room.id, (r) => {
          const walls = r.walls.slice();
          walls[across] = { ...walls[across], lengthIn: inches };
          return { ...r, walls };
        });
      nextJob = nj;
      return nj;
    });
    setTxt('');
    const nx = nextJob ? nextUnverified(nextJob) : null;
    if (nx) onSelectWall(nx.room, nx.wall);
    else onClose();
  };

  const confirmEstimate = () => save(Math.round(len * 8) / 8, false);

  const key = (k: string) => {
    if (k === 'del') setTxt((t) => t.slice(0, -1));
    else if (k === 'clr') setTxt('');
    else setTxt((t) => (t + k).replace(/\s{2,}/g, ' '));
  };

  const KEY_NAMES: Record<string, string | undefined> = { "'": 'feet', '"': 'inches', '/': 'fraction', ' ': 'space', '.': 'decimal point', del: 'Delete last character' };
  const keys = ['7', '8', '9', "'", '4', '5', '6', '"', '1', '2', '3', '/', ' ', '0', '.', 'del'];

  return (
    <div className="sheet wall-sheet" role="region" aria-label={`Measure ${room.name}, wall ${wall + 1}`}>
      <div className="sheet-head">
        <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous wall">
          <ChevronLeft size={22} />
        </button>
        <div className="sheet-title">
          <div className="eyebrow">
            {room.name}, wall {wall + 1} of {n}
          </div>
          <div aria-live="polite" className={`readout ${txt ? (parsed != null ? 'typed-ok' : 'typed-bad') : verified ? 'measured' : 'est'}`}>
          <div className={`big-len ${verified ? 'ok' : ''}`}>
            {txt ? (parsed != null ? fmtFtIn(parsed) : <span className="bad">{txt}</span>) : (verified ? '' : '~') + fmtFtIn(len)}
          </div>
          </div>
          <div className="sub">{txt ? parsed != null ? <span className="typed">You typed {txt}</span> : <span className="bad-msg">Not a length yet. Try 12 6 or 12' 6 1/2"</span> : verified ? <span className="okc"><Check size={13} /> Measured</span> : job.scaleSet ? 'Estimated from your sketch. Type the tape.' : 'Type this wall’s tape length. It sets the scale for the whole job.'}</div>
        </div>
        <button className="icon-btn" onClick={() => go(1)} aria-label="Next wall">
          <ChevronRight size={22} />
        </button>
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <div className="keypad">
        {keys.map((k) => (
          <button key={k} className={`key ${/\d/.test(k) ? 'num' : 'sym'}`} onClick={() => key(k)} aria-label={KEY_NAMES[k]}>
            {k === 'del' ? <Delete size={20} /> : k === ' ' ? 'space' : k === "'" ? 'ft' + " '" : k === '"' ? 'in "' : k}
          </button>
        ))}
      </div>
      <div className="row gap">
        {txt ? (
          <>
            <button className="btn ghost" onClick={() => key('clr')}>
              Clear
            </button>
            <button className="btn primary grow" disabled={parsed == null || parsed <= 0} onClick={() => parsed && save(parsed, false)}>
              <Check size={18} /> Save &amp; next wall
            </button>
          </>
        ) : (
          <button className="btn grow" onClick={confirmEstimate} disabled={!job.scaleSet}>
            <Check size={18} /> {verified ? 'Looks right, next' : `Use ~${fmtFtIn(len)}`}
          </button>
        )}
      </div>
      <div className="chips" role="group" aria-label="Add to this wall">
        <span className="chips-label">Add</span>
        <button className="chip" onClick={() => addOpening(job, room, wall, 'door', commit)}>
          <DoorOpen size={16} /> Door
        </button>
        <button className="chip" onClick={() => addOpening(job, room, wall, 'window', commit)}>
          <AppWindow size={16} /> Window
        </button>
        <button className="chip" onClick={() => addOpening(job, room, wall, 'opening', commit)}>
          <RectangleHorizontal size={16} /> Opening
        </button>
      </div>
      <div className="chips">
        <button
          className={`chip ${w.noBase ? 'on' : ''}`}
          onClick={() =>
            commit((j) =>
              updRoom(j, room.id, (r) => {
                const walls = r.walls.slice();
                walls[wall] = { ...walls[wall], noBase: !walls[wall]?.noBase };
                return { ...r, walls };
              }),
            )
          }
        >
          {w.noBase ? <Check size={15} /> : null} No baseboard here
        </button>
        {txt && parsed ? (
          <button className="chip" onClick={() => save(parsed, true)}>
            <Scale size={15} /> Save and rescale
          </button>
        ) : verified && job.scaleSet ? (
          <button className="chip" onClick={() => w.lengthIn && save(w.lengthIn, true)}>
            <Scale size={15} /> Set scale from this wall
          </button>
        ) : null}
        {verified && (
          <button
            className="chip"
            onClick={() =>
              commit((j) =>
                updRoom(j, room.id, (r) => {
                  const walls = r.walls.slice();
                  walls[wall] = { ...walls[wall], lengthIn: undefined };
                  return { ...r, walls };
                }),
              )
            }
          >
            Clear length
          </button>
        )}
      </div>
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
const PAD_KEYS = ['7', '8', '9', "'", '4', '5', '6', '"', '1', '2', '3', '/', ' ', '0', '.', 'del'];
const PAD_NAMES: Record<string, string | undefined> = { "'": 'feet', '"': 'inches', '/': 'fraction', ' ': 'space', '.': 'decimal point', del: 'Delete last character' };

export function AddRoomSheet({ defaultName, onAdd, onSketch, onClose }: { defaultName: string; onAdd: (name: string, lengthIn: number, widthIn: number) => void; onSketch: () => void; onClose: () => void }) {
  const [field, setField] = useState<0 | 1>(0);
  const [txt, setTxt] = useState<[string, string]>(['', '']);
  const [name, setName] = useState(defaultName);
  const vals = [parseLength(txt[0]), parseLength(txt[1])];
  const cur = txt[field];
  const key = (k: string) =>
    setTxt((t) => {
      const n = t.slice() as [string, string];
      n[field] = k === 'del' ? n[field].slice(0, -1) : (n[field] + k).replace(/\s{2,}/g, ' ');
      return n;
    });
  const ready = vals[0] != null && vals[1] != null;
  const label = ['Length', 'Width'];
  return (
    <div className="sheet wall-sheet add-sheet" role="region" aria-label="Add a room by its size">
      <div className="sheet-head">
        <div className="sheet-title">
          <div className="eyebrow">New room</div>
          <div className="h2">Type the room’s size</div>
        </div>
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="size-fields">
        {([0, 1] as const).map((i) => (
          <button key={i} className={`size-field ${field === i ? 'on' : ''} ${txt[i] && vals[i] == null ? 'bad' : ''}`} onClick={() => setField(i)} aria-pressed={field === i}>
            <span className="size-label">{label[i]}</span>
            <span className="size-val">{txt[i] ? (vals[i] != null ? fmtFtIn(vals[i]!) : txt[i]) : <span className="muted">tap to type</span>}</span>
          </button>
        ))}
      </div>
      <div className="sub add-sub">{cur && vals[field] == null ? <span className="bad-msg">Not a length yet. Try 12 6 or 12' 6 1/2"</span> : field === 0 ? 'Wall to wall the long way. 12 means 12 feet.' : 'Wall to wall the short way.'}</div>
      <div className="keypad">
        {PAD_KEYS.map((k) => (
          <button key={k} className={`key ${/\d/.test(k) ? 'num' : 'sym'}`} onClick={() => key(k)} aria-label={PAD_NAMES[k]}>
            {k === 'del' ? <Delete size={20} /> : k === ' ' ? 'space' : k === "'" ? "ft '" : k === '"' ? 'in "' : k}
          </button>
        ))}
      </div>
      <div className="row gap">
        <button className="btn ghost" onClick={onSketch}>
          Sketch it instead
        </button>
        {field === 0 && !ready ? (
          <button className="btn primary grow" disabled={vals[0] == null} onClick={() => setField(1)}>
            Next: width
          </button>
        ) : (
          <button className="btn primary grow" disabled={!ready} onClick={() => ready && onAdd(name.trim() || defaultName, vals[0]!, vals[1]!)}>
            <Check size={18} /> Add room
          </button>
        )}
      </div>
      <div className="chips" role="group" aria-label="Room name">
        {ROOM_NAMES.map((nm) => (
          <button key={nm} className={`chip ${name === nm ? 'on' : ''}`} onClick={() => setName(name === nm ? defaultName : nm)} aria-pressed={name === nm}>
            {name === nm && <Check size={15} />} {nm}
          </button>
        ))}
      </div>
    </div>
  );
}
