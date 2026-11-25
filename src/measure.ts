import type { Job, Room } from './types';
import { dist, drawnLen, reshapeWall, wallCount, wallEnds } from './geometry';

function updRoom(j: Job, id: string, fn: (r: Room) => Room): Job {
  return { ...j, rooms: j.rooms.map((r) => (r.id === id ? fn(r) : r)) };
}

/** a wall whose length you typed or dropped on, not one Plumb worked out */
export const isTaped = (r: Room, i: number) => r.walls[i]?.lengthIn != null && !r.walls[i]?.predicted;

/**
 * Put a tape length on a wall: sets the scale on the first one, copies it to the same wall of an
 * attached room, makes the drawing follow it, and works out any wall the others now decide.
 */
export function applyMeasurement(job: Job, roomId: string, wall: number, inches: number, setScale = false): Job {
  const room = job.rooms.find((r) => r.id === roomId);
  if (!room || wall >= wallCount(room)) return job;
  let nj = updRoom(job, room.id, (r) => {
    const walls = r.walls.slice();
    walls[wall] = { ...walls[wall], lengthIn: inches, predicted: undefined };
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
        if (same && !isTaped(r, i)) {
          walls = walls === r.walls ? walls.slice() : walls;
          walls[i] = { ...walls[i], lengthIn: inches, predicted: undefined };
        }
      }
      return walls === r.walls ? r : { ...r, walls };
    }),
  };
  const dl = drawnLen(room, wall);
  if ((setScale || !job.scaleSet) && dl > 0) nj = { ...nj, inPerUnit: inches / dl, scaleSet: true };
  nj = reshapeWall(nj, room.id, wall, inches);
  return predictRoom(nj, room.id);
}

/**
 * In a room with square corners, the walls running across add up to zero and so do the walls
 * running up and down. When only one wall in a direction is left without a tape length, that
 * length is decided: fill it in and mark it as worked out.
 */
export function predictRoom(job: Job, roomId: string): Job {
  const r = job.rooms.find((x) => x.id === roomId);
  if (!r || !r.closed || !job.scaleSet) return job;
  const n = wallCount(r);
  const edges = Array.from({ length: n }, (_, i) => {
    const [a, b] = wallEnds(r, i);
    return { dx: b.x - a.x, dy: b.y - a.y };
  });
  const axisOf = (e: { dx: number; dy: number }) => (Math.abs(e.dy) < 1e-6 && Math.abs(e.dx) > 1e-6 ? 'x' : Math.abs(e.dx) < 1e-6 && Math.abs(e.dy) > 1e-6 ? 'y' : null);
  if (edges.some((e) => !axisOf(e))) return job;
  const walls = r.walls.slice();
  let changed = false;
  for (const axis of ['x', 'y'] as const) {
    const idx = edges.map((e, i) => (axisOf(e) === axis ? i : -1)).filter((i) => i >= 0);
    const open = idx.filter((i) => !isTaped(r, i));
    if (open.length !== 1 || idx.length < 2) continue;
    let sum = 0;
    for (const i of idx) {
      if (i === open[0]) continue;
      const e = edges[i];
      const sign = Math.sign(axis === 'x' ? e.dx : e.dy);
      sum += sign * (r.walls[i].lengthIn as number);
    }
    const e = edges[open[0]];
    const sign = Math.sign(axis === 'x' ? e.dx : e.dy);
    const len = -sum * sign;
    if (!(len > 0.5) || len > 2400) continue;
    walls[open[0]] = { ...walls[open[0]], lengthIn: Math.round(len * 8) / 8, predicted: true };
    changed = true;
  }
  return changed ? updRoom(job, r.id, (x) => ({ ...x, walls })) : job;
}
