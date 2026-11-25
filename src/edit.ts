// Editing a drawn plan the way pro sketch apps do: delete a line, add a corner to it,
// delete a corner, and slide a line sideways. Every edit keeps doors and windows on the
// wall they were on, at the same spot.
import type { Job, Opening, Pt, Room, Wall } from './types';
import { dist, lerp, segDist, snapN, uid, wallCount, wallEnds } from './geometry';

const same = (a: Pt, b: Pt) => dist(a, b) < 0.01;

/** where each opening sits in the drawing, so it can be put back on the edited walls */
function openingSpots(job: Job, r: Room) {
  return job.openings
    .filter((o) => o.room === r.id && o.wall < wallCount(r))
    .map((o) => {
      const [a, b] = wallEnds(r, o.wall);
      return { o, p: lerp(a, b, o.t) };
    });
}

/** put openings on the nearest wall of the new rooms; ones that lost their wall are dropped */
function placeOpenings(job: Job, spots: { o: Opening; p: Pt }[], rooms: Room[], dropWalls: Set<string> = new Set()): Opening[] {
  const out: Opening[] = [];
  for (const { o, p } of spots) {
    let best: { room: string; wall: number; t: number; d: number } | null = null;
    for (const r of rooms)
      for (let i = 0; i < wallCount(r); i++) {
        if (dropWalls.has(r.id + ':' + i)) continue;
        const [a, b] = wallEnds(r, i);
        const { d, t } = segDist(p, a, b);
        if (!best || d < best.d) best = { room: r.id, wall: i, t, d };
      }
    if (best && best.d < 0.5) out.push({ ...o, room: best.room, wall: best.wall, t: Math.max(0.02, Math.min(0.98, best.t)) });
  }
  const touched = new Set(rooms.map((r) => r.id));
  return [...job.openings.filter((o) => !touched.has(o.room) && !spots.some((s) => s.o.id === o.id)), ...out];
}

function replaceRoom(job: Job, id: string, rooms: Room[], openings: Opening[]): Job {
  const i = job.rooms.findIndex((r) => r.id === id);
  const list = job.rooms.slice();
  list.splice(i, 1, ...rooms);
  return { ...job, rooms: list, openings };
}

/** what deleting this line does, in plain words, before it happens */
export function deleteWallEffect(r: Room, i: number): 'room' | 'opens' | 'splits' | 'shortens' {
  if (r.closed) return 'opens';
  const n = wallCount(r);
  if (n <= 1) return 'room';
  if (i === 0 || i === n - 1) return 'shortens';
  return 'splits';
}

export function deleteWall(job: Job, roomId: string, i: number): Job {
  const r = job.rooms.find((x) => x.id === roomId);
  if (!r || i >= wallCount(r)) return job;
  const spots = openingSpots(job, r).filter((s) => s.o.wall !== i);
  const n = r.pts.length;
  if (r.closed) {
    // the room opens up at that wall: start the run just after it
    const pts: Pt[] = [],
      walls: Wall[] = [];
    for (let k = 0; k < n; k++) pts.push(r.pts[(i + 1 + k) % n]);
    for (let k = 0; k < n - 1; k++) walls.push(clean(r.walls[(i + 1 + k) % n]));
    const nr: Room = { ...r, pts, walls, closed: false };
    return replaceRoom(job, roomId, [nr], placeOpenings(job, spots, [nr]));
  }
  const m = wallCount(r);
  if (m <= 1) return { ...job, rooms: job.rooms.filter((x) => x.id !== roomId), openings: job.openings.filter((o) => o.room !== roomId) };
  const A: Room = { ...r, pts: r.pts.slice(0, i + 1), walls: r.walls.slice(0, i).map(clean) };
  const B: Room = { ...r, id: uid(), name: r.name + ' (2)', pts: r.pts.slice(i + 1), walls: r.walls.slice(i + 1).map(clean) };
  const keep = [A, B].filter((x) => x.pts.length >= 2);
  if (keep.length === 2) B.name = r.name;
  return replaceRoom(job, roomId, keep, placeOpenings(job, spots, keep));
}

/** add a corner in the middle of a line, so it can be bent or slid in two parts */
export function splitWall(job: Job, roomId: string, i: number, t = 0.5): Job {
  const r = job.rooms.find((x) => x.id === roomId);
  if (!r || i >= wallCount(r)) return job;
  const [a, b] = wallEnds(r, i);
  const m = lerp(a, b, t);
  const pts = r.pts.slice();
  pts.splice(i + 1, 0, { x: Math.round(m.x * 1000) / 1000, y: Math.round(m.y * 1000) / 1000 });
  const old = r.walls[i] ?? {};
  const half: Wall = old.noBase ? { noBase: true } : {};
  const walls = r.walls.slice();
  walls.splice(i, 1, { ...half }, { ...half });
  const nr: Room = { ...r, pts, walls: walls.map(clean) };
  return replaceRoom(job, roomId, [nr], placeOpenings(job, openingSpots(job, r), [nr]));
}

export function canDeleteCorner(r: Room) {
  return r.closed ? r.pts.length > 3 : r.pts.length > 2;
}

/** take a corner out: the two lines on either side become one straight line */
export function deleteCorner(job: Job, roomId: string, idx: number): Job {
  const r = job.rooms.find((x) => x.id === roomId);
  if (!r || !canDeleteCorner(r)) return job;
  const n = r.pts.length;
  const spots = openingSpots(job, r);
  const pts = r.pts.filter((_, k) => k !== idx);
  let walls: Wall[];
  const drop = new Set<string>();
  if (r.closed) {
    const prev = (idx - 1 + n) % n;
    const merged: Wall = r.walls[prev]?.noBase && r.walls[idx]?.noBase ? { noBase: true } : {};
    walls = [];
    for (let w = 0; w < n; w++) {
      if (w === idx) continue;
      walls.push(w === prev ? merged : clean(r.walls[w]));
    }
  } else if (idx === 0 || idx === n - 1) {
    walls = idx === 0 ? r.walls.slice(1) : r.walls.slice(0, n - 2);
    walls = walls.map(clean);
  } else {
    const merged: Wall = r.walls[idx - 1]?.noBase && r.walls[idx]?.noBase ? { noBase: true } : {};
    walls = [...r.walls.slice(0, idx - 1).map(clean), merged, ...r.walls.slice(idx + 1).map(clean)];
  }
  const nr: Room = { ...r, pts, walls };
  // openings on an end wall that went away are dropped
  if (!r.closed && (idx === 0 || idx === n - 1)) {
    const gone = idx === 0 ? 0 : n - 2;
    const keep = spots.filter((s) => s.o.wall !== gone);
    return replaceRoom(job, roomId, [nr], placeOpenings(job, keep, [nr], drop));
  }
  return replaceRoom(job, roomId, [nr], placeOpenings(job, spots, [nr], drop));
}

/** slide a line sideways by `d` drawing units; corners shared with other rooms come along */
export function moveWall(job: Job, roomId: string, i: number, d: number): Job {
  const r = job.rooms.find((x) => x.id === roomId);
  if (!r || i >= wallCount(r) || !d) return job;
  const [a, b] = wallEnds(r, i);
  const L = dist(a, b) || 1;
  const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  const off = { x: n.x * d, y: n.y * d };
  const moveP = (p: Pt) => (same(p, a) || same(p, b) ? { x: Math.round((p.x + off.x) * 1000) / 1000, y: Math.round((p.y + off.y) * 1000) / 1000 } : p);
  const rooms = job.rooms.map((rr) => {
    const pts = rr.pts.map(moveP);
    if (pts.every((p, k) => p === rr.pts[k])) return rr;
    // walls that changed length lose any worked-out length; taped lengths stay
    const walls = rr.walls.map((w, k) => {
      if (rr.id === roomId && k === i) return w;
      const [p, q] = [rr.pts[k], rr.pts[(k + 1) % rr.pts.length]];
      if (!p || !q) return w;
      const moved = moveP(p) !== p || moveP(q) !== q;
      return moved && w?.predicted ? clean(w) : w;
    });
    return { ...rr, pts, walls };
  });
  return { ...job, rooms };
}

/** the snapped sideways distance for a drag from w0 to w1, against the wall's normal */
export function wallDragOffset(r: Room, i: number, w0: Pt, w1: Pt, grid?: number) {
  const [a, b] = wallEnds(r, i);
  const L = dist(a, b) || 1;
  const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  const d = (w1.x - w0.x) * n.x + (w1.y - w0.y) * n.y;
  return snapN(d, grid);
}

/** a wall whose shape changed keeps "no baseboard" but nothing worked out */
function clean(w: Wall | undefined): Wall {
  if (!w) return {};
  if (w.predicted) {
    const { predicted: _p, lengthIn: _l, ...rest } = w;
    void _p;
    void _l;
    return rest;
  }
  return w;
}
