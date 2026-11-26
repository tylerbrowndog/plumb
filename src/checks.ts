// The apprentice double-checking the numbers: what looks wrong, said plainly, with what to do about it.
import type { Job, Room } from './types';
import { drawnLen, wallCount, wallEnds, wallLenIn } from './geometry';
import { fmtFtIn } from './units';

export interface Issue {
  key: string;
  room?: string;
  wall?: number;
  /** short, says what's wrong */
  text: string;
  /** what to do about it */
  fix: string;
  level: 'warn' | 'tip';
}

const sideName = (r: Room, i: number) => {
  const [a, b] = wallEnds(r, i);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? 'across' : 'up and down';
};

/** walls that run the same way have to add up to zero going round a room, or the room doesn't close */
export function closureGap(r: Room): { axis: 'x' | 'y'; gapIn: number } | null {
  if (!r.closed) return null;
  const n = wallCount(r);
  const sums = { x: 0, y: 0 },
    allTaped = { x: true, y: true },
    any = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    const [a, b] = wallEnds(r, i);
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const ax = Math.abs(dy) < 1e-6 && Math.abs(dx) > 1e-6 ? 'x' : Math.abs(dx) < 1e-6 && Math.abs(dy) > 1e-6 ? 'y' : null;
    if (!ax) return null; // angled walls: can't check this way
    any[ax]++;
    const L = r.walls[i]?.lengthIn;
    if (L == null) {
      allTaped[ax] = false;
      continue;
    }
    sums[ax] += Math.sign(ax === 'x' ? dx : dy) * L;
  }
  for (const ax of ['x', 'y'] as const) if (allTaped[ax] && any[ax] >= 2 && Math.abs(sums[ax]) > 1) return { axis: ax, gapIn: Math.abs(sums[ax]) };
  return null;
}

/** said right after a length goes on a wall: is it believable? */
export function lengthWarning(before: Job, after: Job, roomId: string, wall: number, inches: number): string | null {
  const r0 = before.rooms.find((x) => x.id === roomId);
  const r1 = after.rooms.find((x) => x.id === roomId);
  if (!r0 || !r1) return null;
  if (inches > 50 * 12) return `${fmtFtIn(inches)} is a long wall. Typo? Say "no" and the right number.`;
  if (inches < 4) return `${fmtFtIn(inches)} is a tiny wall. Say "no" and the right number if that's wrong.`;
  // compare with the sketch once the sketch has a scale from another wall
  const taped = r0.walls.filter((w, i) => i !== wall && w.lengthIn != null && !w.predicted).length + before.rooms.filter((x) => x.id !== roomId).reduce((t, x) => t + x.walls.filter((w) => w.lengthIn != null).length, 0);
  if (before.scaleSet && taped > 0) {
    const sketch = drawnLen(r0, wall) * before.inPerUnit;
    if (sketch > 18 && (inches > sketch * 2.2 || inches < sketch / 2.2))
      return `That's ${inches > sketch ? 'way longer' : 'way shorter'} than the sketch (about ${fmtFtIn(Math.round(sketch / 6) * 6)}). Say "no" and the number, or "keep it".`;
  }
  const gap0 = closureGap(r0),
    gap1 = closureGap(r1);
  if (gap1 && (!gap0 || Math.abs(gap0.gapIn - gap1.gapIn) > 0.5)) return `${r1.name} doesn't close: the walls running ${gap1.axis === 'x' ? 'across' : 'up and down'} are off by ${fmtFtIn(gap1.gapIn)}. Re-tape one of them.`;
  // openings that no longer fit their wall
  const tooWide = after.openings.find((o) => o.room === roomId && o.wall === wall && o.widthIn > inches - 2);
  if (tooWide) return `The ${tooWide.type} on this wall is ${tooWide.widthIn}" wide, wider than the wall. Check one of them.`;
  return null;
}

/** everything on the job that looks off, for the list and for "read it back" */
export function findIssues(job: Job): Issue[] {
  const out: Issue[] = [];
  for (const r of job.rooms) {
    const g = closureGap(r);
    if (g)
      out.push({
        key: `close-${r.id}`,
        room: r.id,
        text: `${r.name} doesn't add up`,
        fix: `The walls running ${g.axis === 'x' ? 'across' : 'up and down'} are off by ${fmtFtIn(g.gapIn)}. Re-tape the longest one.`,
        level: 'warn',
      });
    for (let i = 0; i < wallCount(r); i++) {
      const L = r.walls[i]?.lengthIn;
      if (L != null && L > 50 * 12) out.push({ key: `long-${r.id}-${i}`, room: r.id, wall: i, text: `${r.name} wall ${i + 1} is ${fmtFtIn(L)}`, fix: 'That looks like a typo. Tap to fix it.', level: 'warn' });
    }
    for (const o of job.openings.filter((x) => x.room === r.id)) {
      if (o.wall >= wallCount(r)) continue;
      const L = wallLenIn(job, r, o.wall);
      if (o.widthIn > L - 2 && r.walls[o.wall]?.lengthIn != null)
        out.push({ key: `wide-${o.id}`, room: r.id, wall: o.wall, text: `A ${o.type} is wider than its wall in ${r.name}`, fix: `${o.widthIn}" ${o.type} on a ${fmtFtIn(L)} wall. Check the wall or the ${o.type}.`, level: 'warn' });
    }
    const nothing = !r.base && !r.shoe && !r.crown && (!r.floor || r.floor === 'none') && !r.paintWalls && !r.paintCeiling;
    if (nothing && r.closed) out.push({ key: `none-${r.id}`, room: r.id, text: `Nothing on the list for ${r.name}`, fix: 'Tap it on the plan and pick baseboard, floor or paint.', level: 'tip' });
    if (!r.closed && (r.floor === 'lvp' || r.floor === 'tile' || r.paintCeiling))
      out.push({ key: `open-${r.id}`, room: r.id, text: `${r.name} isn't closed`, fix: 'Floor and ceiling need a closed room. Tap it and close it.', level: 'warn' });
  }
  return out;
}

export { sideName };
