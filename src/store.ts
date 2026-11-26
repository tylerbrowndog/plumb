import type { Job, Opening, Pt, Room } from './types';
import { DEFAULT_SETTINGS, safeSettings } from './estimate';
import { uid } from './geometry';

const KEY = 'plumb.jobs.v1';
const CUR = 'plumb.current.v1';
const SEEN = 'plumb.onboarded.v1';

export function seenWelcome() {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return true;
  }
}
export function markWelcome() {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    /* ignore */
  }
}
/** wipe everything Plumb keeps on this device */
export function wipeAll() {
  try {
    for (const k of [KEY, CUR, SEEN]) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function newRoom(name: string, pts: Room['pts'], closed = true): Room {
  const n = closed ? pts.length : pts.length - 1;
  return { id: uid(), name, pts, closed, walls: Array.from({ length: n }, () => ({})), base: true, shoe: false, crown: false };
}

export function newJob(name = 'New job'): Job {
  const now = Date.now();
  return {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    rooms: [],
    openings: [],
    inPerUnit: 1,
    scaleSet: false,
    settings: { ...DEFAULT_SETTINGS },
    checks: {},
    notes: '',
  };
}

export function sampleJob(): Job {
  const j = newJob('Sample: bedroom + closet');
  const bed = newRoom('Bedroom', [
    { x: 0, y: 0 },
    { x: 144, y: 0 },
    { x: 144, y: 84 },
    { x: 120, y: 84 },
    { x: 120, y: 132 },
    { x: 0, y: 132 },
  ]);
  const closet = newRoom('Closet', [
    { x: 144, y: 0 },
    { x: 192, y: 0 },
    { x: 192, y: 84 },
    { x: 144, y: 84 },
  ]);
  j.rooms = [bed, closet];
  j.openings = [
    { id: uid(), room: bed.id, wall: 5, t: 0.75, type: 'door', widthIn: 32, heightIn: 80, bothSides: true },
    { id: uid(), room: bed.id, wall: 1, t: 0.5, type: 'opening', widthIn: 30, heightIn: 80, bothSides: false },
    { id: uid(), room: bed.id, wall: 4, t: 0.5, type: 'window', widthIn: 36, heightIn: 48, bothSides: false },
  ];
  j.scaleSet = true;
  bed.walls[0].lengthIn = 144;
  return j;
}

export function loadJobs(): Job[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Job[];
    return Array.isArray(arr) ? arr.map(migrate) : [];
  } catch {
    return [];
  }
}

export function migrate(j: Job): Job {
  return { ...newJob(j.name), ...j, settings: { ...DEFAULT_SETTINGS, ...(j.settings || {}) }, checks: j.checks || {}, openings: j.openings || [] };
}

export function saveJobs(jobs: Job[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* storage full or blocked */
  }
}

export function loadCurrent(): string | null {
  try {
    return localStorage.getItem(CUR);
  } catch {
    return null;
  }
}
export function saveCurrent(id: string) {
  try {
    localStorage.setItem(CUR, id);
  } catch {
    /* ignore */
  }
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MAX_IMPORT = 5_000_000; // characters
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, d: string, max = 80) => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d);

/** Rebuild a job from untrusted JSON, keeping only known fields with sane values. */
export function sanitizeJob(raw: unknown): Job | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  if (!Array.isArray(j.rooms)) return null;
  const base = newJob(str(j.name, 'Imported job'));
  const rooms: Room[] = [];
  for (const rr of (j.rooms as unknown[]).slice(0, 200)) {
    if (!rr || typeof rr !== 'object') continue;
    const r = rr as Record<string, unknown>;
    const pts = (Array.isArray(r.pts) ? r.pts : [])
      .slice(0, 400)
      .map((p) => (p && typeof p === 'object' ? { x: num((p as Pt).x, -1e6, 1e6, NaN), y: num((p as Pt).y, -1e6, 1e6, NaN) } : null))
      .filter((p): p is Pt => !!p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length < 2) continue;
    const closed = bool(r.closed, true) && pts.length >= 3;
    const n = closed ? pts.length : pts.length - 1;
    const wallsIn = Array.isArray(r.walls) ? r.walls : [];
    const walls = Array.from({ length: n }, (_, i) => {
      const w = (wallsIn[i] || {}) as Record<string, unknown>;
      const out: Room['walls'][number] = {};
      if (typeof w.lengthIn === 'number' && Number.isFinite(w.lengthIn) && w.lengthIn > 0 && w.lengthIn <= 2400) out.lengthIn = w.lengthIn;
      if (w.noBase === true) out.noBase = true;
      if (w.predicted === true && out.lengthIn) out.predicted = true;
      return out;
    });
    const floor = r.floor === 'lvp' || r.floor === 'tile' ? r.floor : 'none';
    rooms.push({
      id: str(r.id, uid(), 40) || uid(),
      name: str(r.name, 'Room'),
      pts,
      walls,
      closed,
      base: bool(r.base, true),
      shoe: bool(r.shoe),
      crown: bool(r.crown),
      floor,
      paintWalls: bool(r.paintWalls),
      paintCeiling: bool(r.paintCeiling),
      ...(typeof r.heightIn === 'number' ? { heightIn: num(r.heightIn, 48, 360, 96) } : {}),
    });
  }
  const ids = new Set(rooms.map((r) => r.id));
  const openings: Opening[] = [];
  for (const oo of (Array.isArray(j.openings) ? j.openings : []).slice(0, 500)) {
    if (!oo || typeof oo !== 'object') continue;
    const o = oo as Record<string, unknown>;
    const room = str(o.room, '', 40);
    const r = rooms.find((x) => x.id === room);
    if (!r || !ids.has(room)) continue;
    const type = o.type === 'window' || o.type === 'opening' ? o.type : 'door';
    openings.push({
      id: uid(),
      room,
      wall: Math.round(num(o.wall, 0, r.walls.length - 1, 0)),
      t: num(o.t, 0, 1, 0.5),
      type,
      widthIn: num(o.widthIn, 6, 240, 32),
      heightIn: num(o.heightIn, 6, 240, 80),
      bothSides: bool(o.bothSides),
      newDoor: bool(o.newDoor),
    });
  }
  const sIn = (j.settings && typeof j.settings === 'object' ? j.settings : {}) as Record<string, unknown>;
  const settings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) {
    const d = DEFAULT_SETTINGS[k];
    const v = sIn[k];
    if (typeof d === 'number') (settings as Record<string, unknown>)[k] = num(v, 0, 10000, d);
    else if (typeof d === 'boolean') (settings as Record<string, unknown>)[k] = bool(v, d);
  }
  const checks: Record<string, boolean> = {};
  if (j.checks && typeof j.checks === 'object')
    for (const [k, v] of Object.entries(j.checks as Record<string, unknown>).slice(0, 500)) if (v === true && k.length < 80) checks[k] = true;
  return {
    ...base,
    rooms,
    openings,
    inPerUnit: num(j.inPerUnit, 0.001, 1000, 1),
    scaleSet: bool(j.scaleSet),
    settings: safeSettings(settings),
    checks,
    notes: str(j.notes, '', 5000),
    tray: (Array.isArray(j.tray) ? j.tray : [])
      .slice(0, 60)
      .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>).inches : null))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 2400)
      .map((inches) => ({ id: uid(), inches })),
    extras: (Array.isArray(j.extras) ? j.extras : [])
      .slice(0, 300)
      .map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : null))
      .filter((e): e is Record<string, unknown> => !!e && typeof e.name === 'string' && !!(e.name as string).trim())
      .map((e) => ({
        id: uid(),
        name: str(e.name, 'Item', 80).trim(),
        qty: Math.round(num(e.qty, 1, 999, 1)),
        ...(typeof e.unit === 'string' && e.unit.trim() ? { unit: str(e.unit, '', 20).trim() } : {}),
        ...(e.done === true ? { done: true } : {}),
        addedAt: num(e.addedAt, 0, 1e13, Date.now()),
      })),
  };
}

export function parseImport(text: string): Job[] {
  if (text.length > MAX_IMPORT) throw new Error('too big');
  const data = JSON.parse(text);
  const list: unknown[] = Array.isArray(data) ? data : data?.jobs ? data.jobs : [data];
  return list
    .slice(0, 200)
    .map(sanitizeJob)
    .filter((j): j is Job => !!j);
}

// one-time tips, so each is said once
export function seenTip(name: string) {
  try {
    return localStorage.getItem('plumb.tip.' + name) === '1';
  } catch {
    return true;
  }
}
export function markTip(name: string) {
  try {
    localStorage.setItem('plumb.tip.' + name, '1');
  } catch {
    /* private mode */
  }
}
