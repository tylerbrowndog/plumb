import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Job, Opening, Pt, Room, Selection, Tool } from './types';
import {
  allVertices,
  centroid,
  dist,
  drawnLen,
  isVerified,
  lerp,
  nearestAnchor,
  pointInPoly,
  recognize,
  rectPts,
  segDist,
  signedArea,
  roomAreaIn2,
  snapN,
  uid,
  wallCount,
  wallEnds,
  wallLenIn,
} from './geometry';
import { fmtFtIn } from './units';
import { newRoom } from './store';

export interface View {
  x: number;
  y: number;
  k: number;
}

interface Props {
  job: Job;
  sel: Selection;
  setSel: (s: Selection) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  commit: (fn: (j: Job) => Job) => void;
  view: View;
  setView: (v: View | ((v: View) => View)) => void;
  allow45: boolean;
  /** the wall a dragged tape tag is over */
  hot?: { room: string; wall: number } | null;
}

type Gesture =
  | { type: 'pinch'; d0: number; m0: Pt; v0: View }
  | { type: 'stroke'; pts: Pt[]; s0: Pt; moved: boolean }
  | { type: 'rect'; a: Pt; b: Pt; s0: Pt; moved: boolean }
  | { type: 'pan'; s0: Pt; v0: View; moved: boolean; tap: Selection | 'clear' }
  | { type: 'vertex'; refs: { room: string; idx: number }[]; s0: Pt; moved: boolean; tap: Selection; base: Job }
  | { type: 'opening'; id: string; s0: Pt; moved: boolean }
  | { type: 'place'; s0: Pt; moved: boolean };

const TAP = 8; // px

function outwardNormal(r: Room, a: Pt, b: Pt): Pt {
  const L = dist(a, b) || 1;
  const n = { x: (b.y - a.y) / L, y: -(b.x - a.x) / L };
  if (!r.closed) return n;
  const m = lerp(a, b, 0.5);
  const probe = { x: m.x + n.x * 0.5, y: m.y + n.y * 0.5 };
  return pointInPoly(probe, r.pts) ? { x: -n.x, y: -n.y } : n;
}

export function openingGeom(job: Job, r: Room, o: Opening) {
  const [a, b] = wallEnds(r, o.wall);
  const dl = drawnLen(r, o.wall);
  const realPerUnit = dl > 0 ? wallLenIn(job, r, o.wall) / dl : job.inPerUnit;
  const halfT = (o.widthIn / realPerUnit / 2) / (dl || 1);
  const t0 = Math.max(0, o.t - halfT),
    t1 = Math.min(1, o.t + halfT);
  return { a, b, p0: lerp(a, b, t0), p1: lerp(a, b, t1), c: lerp(a, b, o.t), nOut: outwardNormal(r, a, b), w: (t1 - t0) * dl };
}

export default function PlanCanvas({ job, sel, setSel, tool, setTool, commit, view, setView, allow45, hot }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Pt>());
  const g = useRef<Gesture | null>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [size, setSize] = useState({ w: 390, h: 700 });
  const [dragJob, setDragJob] = useState<Job | null>(null);
  const shown = dragJob ?? job;

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback((s: Pt): Pt => ({ x: (s.x - view.x) / view.k, y: (s.y - view.y) / view.k }), [view]);
  const px = 1 / view.k;

  const local = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ---------- label layout ----------
  const labels = useMemo(() => {
    const out: { room: string; wall: number; x: number; y: number; text: string; verified: boolean; predicted: boolean; w: number; noBase: boolean }[] = [];
    for (const r of shown.rooms) {
      const n = wallCount(r);
      for (let i = 0; i < n; i++) {
        const [a, b] = wallEnds(r, i);
        const dl = dist(a, b);
        if (dl * view.k < 18) continue;
        const nOut = outwardNormal(r, a, b);
        const m = lerp(a, b, 0.5);
        const off = 17 / view.k;
        const len = wallLenIn(shown, r, i);
        const verified = isVerified(r, i);
        const text = (verified ? '' : '~') + fmtFtIn(len);
        out.push({ room: r.id, wall: i, x: m.x + nOut.x * off, y: m.y + nOut.y * off, text, verified, predicted: !!r.walls[i]?.predicted, w: text.length * 7 + 16, noBase: !!r.walls[i]?.noBase });
      }
    }
    return out;
  }, [shown, view.k]);

  // ---------- hit testing ----------
  const hit = useCallback(
    (s: Pt): Selection | { kind: 'vertex'; room: string; idx: number } | null => {
      const w = toWorld(s);
      // vertices
      let best: { room: string; idx: number } | null = null;
      let bd = 22 / view.k;
      const selRoom = sel && sel.kind !== 'opening' ? sel.room : null;
      for (const r of shown.rooms) {
        r.pts.forEach((p, idx) => {
          const d = dist(p, w) - (r.id === selRoom ? 4 / view.k : 0);
          if (d < bd) {
            bd = d;
            best = { room: r.id, idx };
          }
        });
      }
      if (best) return { kind: 'vertex', ...(best as { room: string; idx: number }) };
      // openings
      for (const o of shown.openings) {
        const r = shown.rooms.find((x) => x.id === o.room);
        if (!r || o.wall >= wallCount(r)) continue;
        const og = openingGeom(shown, r, o);
        if (dist(og.c, w) < Math.max(18 / view.k, og.w / 2)) return { kind: 'opening', id: o.id };
      }
      // labels
      for (const l of labels) {
        const sx = l.x * view.k + view.x,
          sy = l.y * view.k + view.y;
        if (Math.abs(s.x - sx) < l.w / 2 + 4 && Math.abs(s.y - sy) < 14) return { kind: 'wall', room: l.room, wall: l.wall };
      }
      // walls
      let bw: { room: string; wall: number } | null = null;
      let bwd = 22 / view.k;
      for (const r of shown.rooms) {
        for (let i = 0; i < wallCount(r); i++) {
          const [a, b] = wallEnds(r, i);
          const d = segDist(w, a, b).d;
          if (d < bwd) {
            bwd = d;
            bw = { room: r.id, wall: i };
          }
        }
      }
      if (bw) return { kind: 'wall', ...(bw as { room: string; wall: number }) };
      // rooms (last drawn on top)
      for (let i = shown.rooms.length - 1; i >= 0; i--) {
        const r = shown.rooms[i];
        if (r.closed && pointInPoly(w, r.pts)) return { kind: 'room', room: r.id };
      }
      return null;
    },
    [shown, labels, view, toWorld, sel],
  );

  const nearestWall = (w: Pt, maxPx = 28) => {
    let best: { room: Room; wall: number; t: number } | null = null;
    let bd = maxPx / view.k;
    for (const r of job.rooms)
      for (let i = 0; i < wallCount(r); i++) {
        const [a, b] = wallEnds(r, i);
        const { d, t } = segDist(w, a, b);
        if (d < bd) {
          bd = d;
          best = { room: r, wall: i, t };
        }
      }
    return best;
  };

  // ---------- pointer handlers ----------
  const onDown = (e: React.PointerEvent) => {
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      if (g.current?.type === 'vertex') setDragJob(null);
      g.current = { type: 'pinch', d0: dist(p1, p2), m0: lerp(p1, p2, 0.5), v0: view };
      rerender();
      return;
    }
    if (pointers.current.size > 2) return;
    const w = toWorld(s);
    if (tool === 'draw') {
      g.current = { type: 'stroke', pts: [w], s0: s, moved: false };
    } else if (tool === 'rect') {
      g.current = { type: 'rect', a: w, b: w, s0: s, moved: false };
    } else if (tool === 'door' || tool === 'window') {
      g.current = { type: 'place', s0: s, moved: false };
    } else {
      const h = hit(s);
      if (h && h.kind === 'vertex') {
        const r = job.rooms.find((x) => x.id === h.room)!;
        const p = r.pts[h.idx];
        const refs: { room: string; idx: number }[] = [];
        for (const rr of job.rooms) rr.pts.forEach((q, idx) => dist(q, p) < 0.01 && refs.push({ room: rr.id, idx }));
        g.current = { type: 'vertex', refs, s0: s, moved: false, tap: { kind: 'room', room: h.room }, base: job };
      } else if (h && h.kind === 'opening' && sel?.kind === 'opening' && sel.id === h.id) {
        g.current = { type: 'opening', id: h.id, s0: s, moved: false };
      } else {
        g.current = { type: 'pan', s0: s, v0: view, moved: false, tap: (h as Selection) ?? 'clear' };
      }
    }
    rerender();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    const gs = g.current;
    if (!gs) return;
    if (gs.type === 'pinch') {
      if (pointers.current.size < 2) return;
      const [p1, p2] = [...pointers.current.values()];
      const d = dist(p1, p2);
      const m = lerp(p1, p2, 0.5);
      const k = Math.min(40, Math.max(0.08, gs.v0.k * (d / (gs.d0 || 1))));
      // keep world point under the initial midpoint under the current midpoint
      const wx = (gs.m0.x - gs.v0.x) / gs.v0.k,
        wy = (gs.m0.y - gs.v0.y) / gs.v0.k;
      setView({ k, x: m.x - wx * k, y: m.y - wy * k });
      return;
    }
    const moved = dist(s, gs.s0) > TAP;
    if (gs.type === 'stroke') {
      gs.moved ||= moved;
      gs.pts.push(toWorld(s));
      rerender();
    } else if (gs.type === 'rect') {
      gs.moved ||= moved;
      gs.b = toWorld(s);
      rerender();
    } else if (gs.type === 'place') {
      gs.moved ||= moved;
    } else if (gs.type === 'pan') {
      gs.moved ||= moved;
      if (gs.moved) setView({ ...gs.v0, x: gs.v0.x + s.x - gs.s0.x, y: gs.v0.y + s.y - gs.s0.y });
    } else if (gs.type === 'vertex') {
      gs.moved ||= moved;
      if (!gs.moved) return;
      const w = toWorld(s);
      const others = allVertices(gs.base).filter((p) => !gs.refs.some((r) => {
        const rr = gs.base.rooms.find((x) => x.id === r.room)!;
        return dist(rr.pts[r.idx], p) < 0.01;
      }));
      let np: Pt = nearestAnchor(w, others, 16 / view.k) ?? { x: snapN(w.x), y: snapN(w.y) };
      // align with neighbors
      const first = gs.refs[0];
      const fr = gs.base.rooms.find((x) => x.id === first.room)!;
      const nb = [fr.pts[(first.idx - 1 + fr.pts.length) % fr.pts.length], fr.pts[(first.idx + 1) % fr.pts.length]];
      for (const q of nb) {
        if (Math.abs(q.x - np.x) * view.k < 12) np = { ...np, x: q.x };
        if (Math.abs(q.y - np.y) * view.k < 12) np = { ...np, y: q.y };
      }
      const next: Job = {
        ...gs.base,
        rooms: gs.base.rooms.map((r) => {
          const mine = gs.refs.filter((x) => x.room === r.id);
          if (!mine.length) return r;
          const pts = r.pts.slice();
          for (const m of mine) pts[m.idx] = np;
          return { ...r, pts };
        }),
      };
      setDragJob(next);
    } else if (gs.type === 'opening') {
      gs.moved ||= moved;
      if (!gs.moved) return;
      const o = job.openings.find((x) => x.id === gs.id);
      const r = o && job.rooms.find((x) => x.id === o.room);
      if (!o || !r) return;
      const [a, b] = wallEnds(r, o.wall);
      const { t } = segDist(toWorld(s), a, b);
      setDragJob({ ...job, openings: job.openings.map((x) => (x.id === o.id ? { ...x, t: Math.max(0.02, Math.min(0.98, t)) } : x)) });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const gs = g.current;
    if (!gs) return;
    if (gs.type === 'pinch') {
      if (pointers.current.size === 0) g.current = null;
      return;
    }
    g.current = null;
    const s = local(e);
    const tapSelect = () => {
      const h = hit(s);
      if (h && h.kind !== 'vertex') setSel(h);
      else if (h && h.kind === 'vertex') setSel({ kind: 'room', room: h.room });
      else setSel(null);
    };
    if (gs.type === 'stroke') {
      if (!gs.moved) {
        tapSelect();
      } else {
        const anchors = allVertices(job);
        const rec = recognize(gs.pts, px, allow45, anchors);
        if (rec && rec.pts.length >= 2) {
          const name = rec.closed ? `Room ${job.rooms.filter((r) => r.closed).length + 1}` : `Wall run ${job.rooms.filter((r) => !r.closed).length + 1}`;
          const room = newRoom(name, rec.pts, rec.closed);
          commit((j) => ({ ...j, rooms: [...j.rooms, room] }));
          // stay in sketch so the next room can go right on; tape lengths get dropped on after
          setSel(null);
        }
      }
    } else if (gs.type === 'rect') {
      if (!gs.moved) tapSelect();
      else {
        const pts = rectPts(gs.a, gs.b, allVertices(job), px);
        if (Math.abs(pts[0].x - pts[2].x) > 0 && Math.abs(pts[0].y - pts[2].y) > 0) {
          const room = newRoom(`Room ${job.rooms.filter((r) => r.closed).length + 1}`, pts, true);
          commit((j) => ({ ...j, rooms: [...j.rooms, room] }));
          setSel(null);
        }
      }
    } else if (gs.type === 'place') {
      if (gs.moved) return;
      const nw = nearestWall(toWorld(s));
      if (!nw) {
        tapSelect();
        return;
      }
      const st = job.settings;
      const o: Opening = {
        id: uid(),
        room: nw.room.id,
        wall: nw.wall,
        t: Math.max(0.05, Math.min(0.95, nw.t)),
        type: tool === 'door' ? 'door' : 'window',
        widthIn: tool === 'door' ? st.doorWidthIn : st.windowWidthIn,
        heightIn: tool === 'door' ? st.doorHeightIn : st.windowHeightIn,
        bothSides: tool === 'door',
      };
      commit((j) => ({ ...j, openings: [...j.openings, o] }));
      setSel({ kind: 'opening', id: o.id });
      setTool('select');
    } else if (gs.type === 'pan') {
      if (!gs.moved) setSel(gs.tap === 'clear' ? null : gs.tap);
    } else if (gs.type === 'vertex') {
      if (gs.moved && dragJob) {
        const dj = dragJob;
        commit(() => dj);
      } else if (!gs.moved) setSel(gs.tap);
      setDragJob(null);
    } else if (gs.type === 'opening') {
      if (gs.moved && dragJob) {
        const dj = dragJob;
        commit(() => dj);
      }
      setDragJob(null);
    }
    rerender();
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = local(e as unknown as React.PointerEvent);
    const f = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const k = Math.min(40, Math.max(0.08, v.k * f));
      const wx = (s.x - v.x) / v.k,
        wy = (s.y - v.y) / v.k;
      return { k, x: s.x - wx * k, y: s.y - wy * k };
    });
  };

  // ---------- render ----------
  const gs = g.current;
  const selRoomId = sel && sel.kind !== 'opening' ? sel.room : sel?.kind === 'opening' ? shown.openings.find((o) => o.id === sel.id)?.room : null;

  let preview: Pt[] | null = null;
  let previewClosed = false;
  if (gs?.type === 'stroke' && gs.moved) {
    const rec = recognize(gs.pts, px, allow45, allVertices(job));
    if (rec) {
      preview = rec.pts;
      previewClosed = rec.closed;
    }
  }
  if (gs?.type === 'rect' && gs.moved) {
    preview = rectPts(gs.a, gs.b, allVertices(job), px);
    previewClosed = true;
  }

  const grid = 12 * view.k;
  const showMinor = grid > 9;
  const k = view.k;

  return (
    <svg
      ref={svgRef}
      className="plan"
      role="img"
      aria-label={`Floor plan with ${shown.rooms.length} ${shown.rooms.length === 1 ? 'room' : 'rooms'}. Use the Measure button to go wall by wall.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="tapeTicks" width={4} height={22} patternUnits="userSpaceOnUse" y={-11}>
          <path d="M 0.5 0 V 3.5 M 0.5 18.5 V 22" stroke="var(--tape-ink)" strokeWidth={1} opacity={0.5} />
        </pattern>
        <pattern id="gMinor" width={grid} height={grid} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
          <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="var(--grid)" strokeWidth={1} />
        </pattern>
        <pattern id="gMajor" width={grid * 4} height={grid * 4} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
          <path d={`M ${grid * 4} 0 L 0 0 0 ${grid * 4}`} fill="none" stroke="var(--grid-major)" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={size.w} height={size.h} fill="var(--canvas)" />
      {showMinor && <rect width={size.w} height={size.h} fill="url(#gMinor)" />}
      <rect width={size.w} height={size.h} fill="url(#gMajor)" />

      <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
        {/* rooms */}
        {shown.rooms.map((r) => {
          const isSel = r.id === selRoomId;
          const d = r.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (r.closed ? ' Z' : '');
          return (
            <g key={r.id}>
              {r.closed && <path d={d} fill={isSel ? 'var(--room-sel)' : 'var(--room)'} />}
              <path d={d} fill="none" stroke={isSel ? 'var(--wall-sel)' : 'var(--wall)'} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              {r.walls.map((wl, i) =>
                wl.noBase && i < wallCount(r) ? (
                  <line key={i} x1={wallEnds(r, i)[0].x} y1={wallEnds(r, i)[0].y} x2={wallEnds(r, i)[1].x} y2={wallEnds(r, i)[1].y} stroke="var(--nobase)" strokeWidth={3} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
                ) : null,
              )}
            </g>
          );
        })}

        {/* selected wall */}
        {sel?.kind === 'wall' &&
          (() => {
            const r = shown.rooms.find((x) => x.id === sel.room);
            if (!r || sel.wall >= wallCount(r)) return null;
            const [a, b] = wallEnds(r, sel.wall);
            return (
              <g>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={14} strokeOpacity={0.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })()}

        {/* the wall a tape tag would land on */}
        {hot &&
          (() => {
            const r = shown.rooms.find((x) => x.id === hot.room);
            if (!r || hot.wall >= wallCount(r)) return null;
            const [a, b] = wallEnds(r, hot.wall);
            return (
              <g>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--tape)" strokeWidth={18} strokeOpacity={0.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--tape-edge)" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })()}

        {/* openings */}
        {shown.openings.map((o) => {
          const r = shown.rooms.find((x) => x.id === o.room);
          if (!r || o.wall >= wallCount(r)) return null;
          const og = openingGeom(shown, r, o);
          const isSel = sel?.kind === 'opening' && sel.id === o.id;
          const col = isSel ? 'var(--accent)' : o.type === 'window' ? 'var(--window)' : 'var(--door)';
          const nIn = { x: -og.nOut.x, y: -og.nOut.y };
          if (o.type === 'window') {
            const t = 3 / k;
            return (
              <g key={o.id}>
                <line x1={og.p0.x} y1={og.p0.y} x2={og.p1.x} y2={og.p1.y} stroke="var(--canvas)" strokeWidth={6} vectorEffect="non-scaling-stroke" />
                <line x1={og.p0.x + nIn.x * t} y1={og.p0.y + nIn.y * t} x2={og.p1.x + nIn.x * t} y2={og.p1.y + nIn.y * t} stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                <line x1={og.p0.x - nIn.x * t} y1={og.p0.y - nIn.y * t} x2={og.p1.x - nIn.x * t} y2={og.p1.y - nIn.y * t} stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                <line x1={og.p0.x} y1={og.p0.y} x2={og.p1.x} y2={og.p1.y} stroke={col} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              </g>
            );
          }
          const leaf = { x: og.p0.x + nIn.x * og.w, y: og.p0.y + nIn.y * og.w };
          return (
            <g key={o.id}>
              <line x1={og.p0.x} y1={og.p0.y} x2={og.p1.x} y2={og.p1.y} stroke="var(--canvas)" strokeWidth={7} vectorEffect="non-scaling-stroke" />
              {o.type === 'door' ? (
                <>
                  <line x1={og.p0.x} y1={og.p0.y} x2={leaf.x} y2={leaf.y} stroke={col} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  <path d={`M ${leaf.x} ${leaf.y} A ${og.w} ${og.w} 0 0 ${sweep(og.p0, og.p1, leaf)} ${og.p1.x} ${og.p1.y}`} fill="none" stroke={col} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                </>
              ) : (
                <>
                  <line x1={og.p0.x - nIn.x * 4 / k} y1={og.p0.y - nIn.y * 4 / k} x2={og.p0.x + nIn.x * 4 / k} y2={og.p0.y + nIn.y * 4 / k} stroke={col} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  <line x1={og.p1.x - nIn.x * 4 / k} y1={og.p1.y - nIn.y * 4 / k} x2={og.p1.x + nIn.x * 4 / k} y2={og.p1.y + nIn.y * 4 / k} stroke={col} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                </>
              )}
              {isSel && <circle cx={og.c.x} cy={og.c.y} r={7 / k} fill="var(--accent)" />}
            </g>
          );
        })}

        {/* preview */}
        {gs?.type === 'stroke' && gs.moved && (
          <path d={gs.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.55} />
        )}
        {preview && (
          <path d={preview.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (previewClosed ? ' Z' : '')} fill={previewClosed ? 'var(--room-sel)' : 'none'} stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        )}

        {/* vertices */}
        {(tool === 'select' || selRoomId) &&
          shown.rooms.map((r) =>
            r.pts.map((p, i) => {
              const isSel = r.id === selRoomId;
              if (!isSel && tool !== 'select') return null;
              return (
                <circle key={r.id + i} cx={p.x} cy={p.y} r={(isSel ? 6.5 : 4) / k} fill={isSel ? 'var(--handle)' : 'var(--canvas)'} stroke={isSel ? 'var(--accent)' : 'var(--wall-dim)'} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              );
            }),
          )}
      </g>

      {/* labels in screen space for crisp text */}
      {labels.map((l) => {
        const sx = l.x * k + view.x,
          sy = l.y * k + view.y;
        const isSel = sel?.kind === 'wall' && sel.room === l.room && sel.wall === l.wall;
        return (
          <g key={l.room + l.wall} transform={`translate(${sx} ${sy})`}>
            {l.verified || isSel ? (
              <>
                <rect x={-l.w / 2} y={-11} width={l.w} height={22} rx={2.5} fill={isSel ? 'var(--chalk)' : 'var(--tape)'} stroke={isSel ? 'none' : 'var(--tape-edge)'} strokeWidth={l.predicted ? 1.5 : 1} strokeDasharray={l.predicted && !isSel ? '4 2' : undefined} />
                {!isSel && <rect x={-l.w / 2 + 2} y={-11} width={l.w - 4} height={22} fill="url(#tapeTicks)" />}
              </>
            ) : (
              <rect x={-l.w / 2} y={-11} width={l.w} height={22} rx={2.5} fill="var(--chip)" stroke="var(--pencil)" strokeWidth={1.25} strokeDasharray="3 2.5" />
            )}
            <text textAnchor="middle" dy="4.5" className="lbl" fill={isSel ? '#fff' : l.verified ? 'var(--tape-ink)' : 'var(--pencil)'}>
              {l.text}
            </text>
          </g>
        );
      })}

      {/* room names */}
      {shown.rooms.filter((r) => r.closed && r.pts.length >= 3).map((r) => {
        const c = centroid(r.pts);
        const sx = c.x * k + view.x,
          sy = c.y * k + view.y;
        const areaSqft = roomAreaIn2(shown, r) / 144;
        if (Math.abs(signedArea(r.pts)) * k * k < 2500) return null;
        return (
          <g key={'n' + r.id} transform={`translate(${sx} ${sy})`} pointerEvents="none">
            <text textAnchor="middle" className="rname" dy="-2">
              {r.name}
            </text>
            <text textAnchor="middle" className="rarea" dy="14">
              {Math.round(areaSqft)} sq ft
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function sweep(p0: Pt, p1: Pt, leaf: Pt) {
  // arc from leaf tip to p1 centered at p0
  const v1 = { x: leaf.x - p0.x, y: leaf.y - p0.y };
  const v2 = { x: p1.x - p0.x, y: p1.y - p0.y };
  return v1.x * v2.y - v1.y * v2.x > 0 ? 1 : 0;
}
