import type { Job, Pt, Room } from './types';

export const GRID = 6; // drawing units; default scale 1 unit = 1 inch, so 6" snap

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const snapN = (v: number, g = GRID) => Math.round(v / g) * g;
export const snapPt = (p: Pt, g = GRID): Pt => ({ x: snapN(p.x, g), y: snapN(p.y, g) });

export const uid = () => Math.random().toString(36).slice(2, 10);

export function wallCount(r: Room) {
  return r.closed ? r.pts.length : Math.max(0, r.pts.length - 1);
}

export function wallEnds(r: Room, i: number): [Pt, Pt] {
  return [r.pts[i], r.pts[(i + 1) % r.pts.length]];
}

export function drawnLen(r: Room, i: number) {
  const [a, b] = wallEnds(r, i);
  return dist(a, b);
}

export function wallLenIn(job: Job, r: Room, i: number) {
  return r.walls[i]?.lengthIn ?? drawnLen(r, i) * job.inPerUnit;
}

export function isVerified(r: Room, i: number) {
  return r.walls[i]?.lengthIn != null;
}

/** distance from p to segment ab, plus param t */
export function segDist(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const ab = sub(b, a);
  const L2 = ab.x * ab.x + ab.y * ab.y;
  if (L2 === 0) return { d: dist(p, a), t: 0 };
  let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2;
  t = Math.max(0, Math.min(1, t));
  return { d: dist(p, lerp(a, b, t)), t };
}

export function signedArea(pts: Pt[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPoly(p: Pt, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function centroid(pts: Pt[]): Pt {
  const A = signedArea(pts);
  if (Math.abs(A) < 1e-6) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return mul(s, 1 / pts.length);
  }
  let cx = 0,
    cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Corner kinds for a closed room: inside corners get coped, outside corners get mitered. */
export function cornerKinds(r: Room): ('inside' | 'outside')[] {
  const n = r.pts.length;
  if (!r.closed || n < 3) return [];
  const A = signedArea(r.pts);
  const out: ('inside' | 'outside')[] = [];
  for (let i = 0; i < n; i++) {
    const p = r.pts[(i - 1 + n) % n];
    const c = r.pts[i];
    const q = r.pts[(i + 1) % n];
    const cr = (c.x - p.x) * (q.y - c.y) - (c.y - p.y) * (q.x - c.x);
    if (Math.abs(cr) < 1e-6) continue; // straight
    out.push(Math.sign(cr) === Math.sign(A) ? 'inside' : 'outside');
  }
  return out;
}

// ---------- sketch recognition ----------

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0,
    idx = 0;
  const a = pts[0],
    b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b).d;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps);
    const r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}

const DIRS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  return { x: Math.round(Math.cos(a) * 1e6) / 1e6, y: Math.round(Math.sin(a) * 1e6) / 1e6, i };
});

function snapDir(v: Pt, allow45: boolean) {
  const ang = Math.atan2(v.y, v.x);
  let best = DIRS[0],
    bestD = Infinity;
  for (const d of DIRS) {
    if (!allow45 && d.i % 2 === 1) continue;
    let diff = Math.abs(Math.atan2(d.y, d.x) - ang);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    // prefer right angles: diagonals need to be clearly diagonal
    if (d.i % 2 === 1) diff += 0.14;
    if (diff < bestD) {
      bestD = diff;
      best = d;
    }
  }
  return best;
}

export interface Recognized {
  pts: Pt[];
  closed: boolean;
}

/**
 * Turn a freehand stroke (drawing units) into straight walls snapped to 90/45 degrees.
 * px = drawing units per screen pixel (for tolerances).
 */
export function recognize(raw: Pt[], px: number, allow45 = true, anchors: Pt[] = []): Recognized | null {
  if (raw.length < 2) return null;
  // bounding size
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 14 * px) return null;

  let strokeLen = 0;
  for (let i = 1; i < raw.length; i++) strokeLen += dist(raw[i - 1], raw[i]);
  const startEndGap = dist(raw[0], raw[raw.length - 1]);
  const closed = startEndGap < Math.max(36 * px, strokeLen * 0.12) && strokeLen > 3 * startEndGap;

  const eps = Math.max(9 * px, diag * 0.045);
  let simp = rdp(raw, eps);
  if (closed && simp.length > 2) {
    // drop the duplicated end; close back to start
    simp = simp.slice(0, -1);
  }

  // segments
  type Seg = { dir: (typeof DIRS)[number]; len: number };
  let segs: Seg[] = [];
  const n = simp.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = simp[i];
    const b = simp[(i + 1) % n];
    const v = sub(b, a);
    const L = Math.hypot(v.x, v.y);
    if (L < 1e-9) continue;
    const dir = snapDir(v, allow45);
    const proj = v.x * dir.x + v.y * dir.y;
    segs.push({ dir, len: Math.max(0, proj) });
  }
  // merge consecutive same-direction, drop tiny
  const minSeg = 10 * px;
  const merge = (arr: Seg[]) => {
    const out: Seg[] = [];
    for (const s of arr) {
      if (s.len < minSeg && out.length) {
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.dir.i === s.dir.i) last.len += s.len;
      else out.push({ ...s });
    }
    return out;
  };
  segs = merge(segs);
  segs = merge(segs);
  if (closed && segs.length > 1 && segs[0].dir.i === segs[segs.length - 1].dir.i) {
    segs[0].len += segs[segs.length - 1].len;
    segs.pop();
  }
  // remove opposite back-and-forth pairs
  if (segs.length === 0) return null;

  // round lengths to the grid
  for (const s of segs) {
    const g = s.dir.i % 2 === 1 ? GRID * Math.SQRT2 : GRID;
    s.len = Math.max(g, Math.round(s.len / g) * g);
  }

  if (closed) {
    if (segs.length < 3) return recognizeAsRect(raw, anchors, px);
    // close the loop by adjusting the last horizontal and last vertical segments
    let ex = 0,
      ey = 0;
    for (const s of segs) {
      ex += s.dir.x * s.len;
      ey += s.dir.y * s.len;
    }
    const fixAxis = (axis: 'x' | 'y', err: number) => {
      if (Math.abs(err) < 1e-6) return true;
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        if (s.dir.i % 2 === 1) continue;
        const comp = axis === 'x' ? s.dir.x : s.dir.y;
        if (Math.abs(comp) < 0.5) continue;
        const newLen = s.len - err / comp;
        if (newLen > GRID * 0.9) {
          s.len = newLen;
          return true;
        }
      }
      return false;
    };
    const okX = fixAxis('x', ex);
    const okY = fixAxis('y', ey);
    if (!okX || !okY) {
      // fall back: just build the polygon and let the last edge close itself
    }
  }

  let start = snapPt(raw[0]);
  const anchor = nearestAnchor(raw[0], anchors, 24 * px);
  if (anchor) start = { ...anchor };
  const pts: Pt[] = [start];
  let cur = start;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    cur = { x: cur.x + s.dir.x * s.len, y: cur.y + s.dir.y * s.len };
    pts.push(cur);
  }
  if (closed) {
    // last point should equal start
    if (dist(pts[pts.length - 1], start) < GRID * 0.5) pts.pop();
    if (pts.length < 3) return recognizeAsRect(raw, anchors, px);
  }
  // clean tiny rounding
  const cleaned = pts.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
  // attach to other rooms: corners land on their corners, and walls line up with theirs,
  // while every wall stays straight and every corner square
  const square = squareUp(cleaned, closed, anchors, px);
  const out =
    square ??
    cleaned.map((p, i) => {
      if (i === 0) return p;
      const a = nearestAnchor(p, anchors, 18 * px);
      return a ? { ...a } : p;
    });
  return { pts: dedupe(out, closed), closed };
}

/**
 * Snap a square-cornered outline onto the rooms around it without bending it: corners that share
 * a wall share an x (or a y), so they move together. Each shared x (or y) takes a nearby corner's
 * value, or else lines up with another room's wall. Returns null if the outline has a slanted wall.
 */
export function squareUp(pts: Pt[], closed: boolean, anchors: Pt[], px: number): Pt[] | null {
  const n = pts.length;
  if (n < 2) return null;
  const edges = closed ? n : n - 1;
  const fx = pts.map((_, i) => i),
    fy = pts.map((_, i) => i);
  const find = (f: number[], i: number): number => (f[i] === i ? i : (f[i] = find(f, f[i])));
  for (let i = 0; i < edges; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n];
    const h = Math.abs(a.y - b.y) < 1e-6,
      v = Math.abs(a.x - b.x) < 1e-6;
    if (!h && !v) return null;
    if (h) fy[find(fy, i)] = find(fy, (i + 1) % n);
    if (v) fx[find(fx, i)] = find(fx, (i + 1) % n);
  }
  const corner = 18 * px,
    line = 12 * px;
  const out = pts.map((p) => ({ ...p }));
  const tooShort = () => {
    for (let i = 0; i < edges; i++) if (dist(out[i], out[(i + 1) % n]) < GRID * 0.9) return true;
    return false;
  };
  for (const axis of ['x', 'y'] as const) {
    const f = axis === 'x' ? fx : fy;
    const groups = new Map<number, number[]>();
    pts.forEach((_, i) => {
      const g = find(f, i);
      groups.set(g, [...(groups.get(g) ?? []), i]);
    });
    for (const members of groups.values()) {
      const val = pts[members[0]][axis];
      let best: number | null = null,
        bd = corner;
      for (const i of members)
        for (const a of anchors) {
          const d = dist(a, pts[i]);
          if (d < bd) {
            bd = d;
            best = a[axis];
          }
        }
      if (best == null) {
        bd = line;
        for (const a of anchors) {
          const d = Math.abs(a[axis] - val);
          if (d < bd) {
            bd = d;
            best = a[axis];
          }
        }
      }
      if (best == null || Math.abs(best - val) < 1e-9) continue;
      const keep = members.map((i) => out[i][axis]);
      for (const i of members) out[i][axis] = best;
      if (tooShort()) members.forEach((i, k) => (out[i][axis] = keep[k]));
    }
  }
  return out;
}

function dedupe(pts: Pt[], closed: boolean) {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && dist(last, p) < 0.5) continue;
    out.push(p);
  }
  if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) < 0.5) out.pop();
  return out;
}

function recognizeAsRect(raw: Pt[], anchors: Pt[], px: number): Recognized {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pts = rectPts({ x: minX, y: minY }, { x: maxX, y: maxY }, [], px);
  return { pts: squareUp(pts, true, anchors, px) ?? pts, closed: true };
}

export function nearestAnchor(p: Pt, anchors: Pt[], maxD: number): Pt | null {
  let best: Pt | null = null,
    bd = maxD;
  for (const a of anchors) {
    const d = dist(a, p);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

export function rectPts(a: Pt, b: Pt, anchors: Pt[], px: number): Pt[] {
  const A = nearestAnchor(a, anchors, 22 * px) ?? snapPt(a);
  const B = nearestAnchor(b, anchors, 22 * px) ?? snapPt(b);
  const x0 = Math.min(A.x, B.x),
    x1 = Math.max(A.x, B.x),
    y0 = Math.min(A.y, B.y),
    y1 = Math.max(A.y, B.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function allVertices(job: Job, exceptRoom?: string): Pt[] {
  const out: Pt[] = [];
  for (const r of job.rooms) if (r.id !== exceptRoom) out.push(...r.pts);
  return out;
}

export function bounds(job: Job) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of job.rooms)
    for (const p of r.pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** real floor area in square inches. Shape from the drawing, size corrected by the measured walls. */
export function roomAreaIn2(job: Job, r: Room) {
  if (!r.closed) return 0;
  const n = wallCount(r);
  let drawn = 0,
    real = 0;
  for (let i = 0; i < n; i++) {
    drawn += drawnLen(r, i) * job.inPerUnit;
    real += wallLenIn(job, r, i);
  }
  const f = drawn > 0 ? real / drawn : 1;
  return Math.abs(signedArea(r.pts)) * job.inPerUnit * job.inPerUnit * f * f;
}

/** true when every wall runs straight across or straight up the page */
export function isSquareRoom(r: Room) {
  if (!r.closed || r.pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const [a, b] = wallEnds(r, i);
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) return false;
  }
  return true;
}

/**
 * Make the drawing follow a typed length: stretch the wall and give the difference to a
 * parallel wall on the other side that is still unmeasured, so the room stays closed and square.
 * Corners shared with other rooms move with it. Returns the job unchanged when it can't do this cleanly.
 */
export function reshapeWall(job: Job, roomId: string, wall: number, inches: number): Job {
  const r = job.rooms.find((x) => x.id === roomId);
  if (!r || wall >= wallCount(r) || !(job.inPerUnit > 0)) return job;
  const n = wallCount(r);
  const edges: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = wallEnds(r, i);
    edges.push(sub(b, a));
  }
  const L = Math.hypot(edges[wall].x, edges[wall].y);
  if (L < 1e-6) return job;
  const dir = mul(edges[wall], 1 / L);
  const u = inches / job.inPerUnit;
  const delta = u - L;
  if (Math.abs(delta) < 1e-3) return job;
  edges[wall] = mul(dir, u);
  if (r.closed) {
    const straight = Math.abs(dir.x) < 1e-6 || Math.abs(dir.y) < 1e-6;
    if (!straight) return job;
    let best = -1,
      bestLen = 0;
    for (let j = 0; j < n; j++) {
      if (j === wall || (isVerified(r, j) && !r.walls[j]?.predicted)) continue;
      const lj = Math.hypot(edges[j].x, edges[j].y);
      if (lj < 1e-6) continue;
      const dot = (edges[j].x * dir.x + edges[j].y * dir.y) / lj;
      if (dot > -0.999) continue;
      if ((lj + delta) * job.inPerUnit < 3) continue;
      if (lj > bestLen) {
        bestLen = lj;
        best = j;
      }
    }
    if (best < 0) return job;
    edges[best] = mul(edges[best], (bestLen + delta) / bestLen);
  }
  const pts: Pt[] = [r.pts[0]];
  const count = r.closed ? r.pts.length - 1 : n;
  for (let i = 0; i < count; i++) {
    const p = add(pts[i], edges[i]);
    pts.push({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });
  }
  const moves: [Pt, Pt][] = [];
  r.pts.forEach((p, i) => {
    if (dist(p, pts[i]) > 1e-6) moves.push([p, pts[i]]);
  });
  // rooms attached to the moved corners slide along with them, staying the same size,
  // and anything attached to those slides too. A room pinned by corners that moved
  // different ways just has those corners moved.
  const shift = new Map<string, Pt>();
  const bent = new Map<string, Pt[]>();
  const queue: { id: string; pairs: [Pt, Pt][] }[] = [];
  const touchers = (pairs: [Pt, Pt][], skip: Set<string>) =>
    job.rooms.filter((x) => !skip.has(x.id) && x.pts.some((p) => pairs.some(([o]) => dist(o, p) < 0.01)));
  const seen = new Set<string>([r.id]);
  // corners that stayed put count too: a room pinned to one is bent, not slid
  const all: [Pt, Pt][] = r.pts.map((p, i) => [p, pts[i] ?? p]);
  for (const x of touchers(moves, seen)) {
    seen.add(x.id);
    queue.push({ id: x.id, pairs: all });
  }
  while (queue.length) {
    const { id, pairs } = queue.shift()!;
    const x = job.rooms.find((q) => q.id === id)!;
    // a corner this room shares with a room nobody is moving stays put; that pins the room
    const pins: [Pt, Pt][] = x.pts
      .filter((p) => !pairs.some(([o]) => dist(o, p) < 0.01))
      .filter((p) => job.rooms.some((y) => y.id !== id && !seen.has(y.id) && y.pts.some((q) => dist(q, p) < 0.01)))
      .map((p) => [p, p]);
    const all2 = [...pairs, ...pins];
    const ds = x.pts.flatMap((p) => all2.filter(([o]) => dist(o, p) < 0.01).slice(0, 1).map(([o, nw]) => sub(nw, o)));
    const d0 = ds[0];
    const rigid = ds.every((d) => dist(d, d0) < 1e-6);
    let own: [Pt, Pt][];
    if (rigid) {
      shift.set(id, d0);
      own = x.pts.map((p) => [p, add(p, d0)]);
    } else {
      const np = followSquare(x, all2);
      // a room that would fold over itself (a wall flipping round or shrinking to nothing) is
      // left where it was rather than turned inside out
      const m = np.length;
      const folds = np.some((p, i) => {
        if (!x.closed && i === m - 1) return false;
        const q = np[(i + 1) % m],
          o1 = x.pts[i],
          o2 = x.pts[(i + 1) % m];
        const e = sub(q, p),
          eo = sub(o2, o1);
        return e.x * eo.x + e.y * eo.y <= 0 || Math.hypot(e.x, e.y) < GRID * 0.5;
      });
      if (folds) continue;
      bent.set(id, np);
      own = x.pts.map((p, i) => [p, np[i]]);
    }
    if (own.some(([o, nw]) => dist(o, nw) > 1e-6))
      for (const y of touchers(own.filter(([o, nw]) => dist(o, nw) > 1e-6), seen)) {
        seen.add(y.id);
        queue.push({ id: y.id, pairs: own });
      }
  }
  const r3 = (p: Pt) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });
  return {
    ...job,
    rooms: job.rooms.map((x) => {
      if (x.id === r.id) return { ...x, pts };
      const d = shift.get(x.id);
      if (d) return { ...x, pts: x.pts.map((p) => r3(add(p, d))) };
      const b = bent.get(x.id);
      return b ? { ...x, pts: b } : x;
    }),
  };
}

/** a square room of a typed size, placed to the right of what's already drawn */
export function roomBySize(job: Job, lengthIn: number, widthIn: number): Pt[] {
  const k = job.scaleSet && job.inPerUnit > 0 ? job.inPerUnit : 1;
  const w = lengthIn / k,
    h = widthIn / k;
  const b = bounds(job);
  const x0 = b ? snapN(b.maxX + 36 / k) : 0;
  const y0 = b ? b.minY : 0;
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
}

/**
 * Move a room's corners that sat on moved corners, then let its other corners follow along
 * their square walls, so a closet in the notch of an L stays a rectangle in the notch.
 */
export function followSquare(x: Room, pairs: [Pt, Pt][]): Pt[] {
  const old = x.pts;
  const n = old.length;
  const np: (Pt | null)[] = old.map((p) => {
    const m = pairs.find(([o]) => dist(o, p) < 0.01);
    return m ? { ...m[1] } : null;
  });
  const nb = (i: number, d: number) => {
    const j = i + d;
    if (x.closed) return (j + n) % n;
    return j >= 0 && j < n ? j : -1;
  };
  for (let pass = 0; pass < n; pass++) {
    let any = false;
    for (let i = 0; i < n; i++) {
      if (np[i]) continue;
      let nx: number | null = null,
        ny: number | null = null;
      for (const d of [-1, 1]) {
        const j = nb(i, d);
        if (j < 0 || j === i || !np[j]) continue;
        if (Math.abs(old[j].y - old[i].y) < 1e-6) ny = np[j]!.y;
        else if (Math.abs(old[j].x - old[i].x) < 1e-6) nx = np[j]!.x;
      }
      if (nx == null && ny == null) continue;
      np[i] = { x: nx ?? old[i].x, y: ny ?? old[i].y };
      any = true;
    }
    if (!any) break;
  }
  return np.map((p, i) => (p ? { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 } : old[i]));
}
