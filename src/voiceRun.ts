// Doing what was said: the apprentice writes it on the right wall, says it back, and speaks up when a number looks wrong.
import type { Extra, Job, Room, Selection } from './types';
import { isVerified, uid, wallCount, wallEnds, wallLenIn } from './geometry';
import { applyMeasurement } from './measure';
import { newOpening } from './edit';
import { fmtFtIn } from './units';
import { dontForget, estimate } from './estimate';
import { findIssues, lengthWarning } from './checks';
import { parseUtterance, plural, sayLength, type Cmd, type ParsedItem, type WallRef } from './voice';

export interface VoiceApi {
  job(): Job;
  commit(fn: (j: Job) => Job): void;
  sel(): Selection;
  setSel(s: Selection): void;
  undo(): void;
  redo(): void;
  tab(): 'plan' | 'list';
  setTab(t: 'plan' | 'list'): void;
  addRoom(name: string, L: number, W: number): void;
  openAddRoom(): void;
  stop(): void;
  help(): void;
}
export interface VoiceMemory {
  /** the last wall a length went on, for "no, 12 foot" */
  last?: { room: string; wall: number };
  /** a warning is waiting for "keep it" or a fix */
  warn?: boolean;
  /** the job before that last length, so a fix is checked against the sketch, not the typo */
  prev?: Job;
}
export interface VoiceOut {
  lines: { text: string; tone: 'ok' | 'warn' | 'info' | 'bad' }[];
  say: string;
  warn: boolean;
}

const wallName = (j: Job, r: Room, w: number) => `${j.rooms.length > 1 ? r.name + ' ' : ''}wall ${w + 1}`;

function order(j: Job) {
  const o: { room: string; wall: number }[] = [];
  for (const r of j.rooms) for (let i = 0; i < wallCount(r); i++) o.push({ room: r.id, wall: i });
  return o;
}
function nextUnverified(j: Job, from?: { room: string; wall: number }, roomOnly?: string) {
  const o = order(j).filter((x) => !roomOnly || x.room === roomOnly);
  if (!o.length) return null;
  const start = from ? o.findIndex((x) => x.room === from.room && x.wall === from.wall) : -1;
  for (let s = 1; s <= o.length; s++) {
    const x = o[(start + s + o.length) % o.length];
    const r = j.rooms.find((q) => q.id === x.room);
    if (r && !isVerified(r, x.wall)) return x;
  }
  return null;
}
function step(j: Job, from: { room: string; wall: number } | null, d: number) {
  const o = order(j);
  if (!o.length) return null;
  const i = from ? o.findIndex((x) => x.room === from.room && x.wall === from.wall) : -1;
  return o[(i + d + o.length) % o.length];
}
function resolveWall(r: Room, ref?: WallRef): number | null {
  const n = wallCount(r);
  if (!ref) return null;
  if (ref.index != null) return ref.index >= 0 && ref.index < n ? ref.index : null;
  if (ref.ordinal) return ref.ordinal === 'first' ? 0 : n - 1;
  if (ref.side) {
    let best = -1,
      score = Infinity;
    for (let i = 0; i < n; i++) {
      const [a, b] = wallEnds(r, i);
      const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      if ((ref.side === 'top' || ref.side === 'bottom') !== horiz) continue;
      const s = ref.side === 'top' ? my : ref.side === 'bottom' ? -my : ref.side === 'left' ? mx : -mx;
      if (s < score) {
        score = s;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }
  return null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'some', 'more', 'for', 'off'].includes(w))
    .map((w) => w.replace(/(es|s)$/, ''));
/** how well a thing said matches a name on the list */
function matchScore(said: string, name: string) {
  const a = words(said),
    b = words(name);
  if (!a.length || !b.length) return 0;
  const hit = a.filter((w) => b.some((x) => x.startsWith(w) || w.startsWith(x))).length;
  return hit / a.length;
}

export function addItems(j: Job, items: ParsedItem[]): Job {
  const extras: Extra[] = (j.extras || []).slice();
  for (const it of items) {
    const i = extras.findIndex((e) => e.name.toLowerCase() === it.name.toLowerCase() && (e.unit || '') === (it.unit || '') && !e.done);
    if (i >= 0) extras[i] = { ...extras[i], qty: Math.min(999, extras[i].qty + it.qty) };
    else extras.unshift({ id: uid(), name: it.name, qty: it.qty, ...(it.unit ? { unit: it.unit } : {}), addedAt: Date.now() });
  }
  return { ...j, extras };
}
export const qtyText = (e: { qty: number; unit?: string }) => (e.unit ? `${e.qty} ${plural(e.unit, e.qty)}` : `${e.qty}`);

export function runVoice(text: string, api: VoiceApi, mem: VoiceMemory): VoiceOut {
  const lines: VoiceOut['lines'] = [];
  const say: string[] = [];
  let warn = false;
  let j = api.job();
  const cmds = parseUtterance(text, { rooms: j.rooms.map((r) => r.name), tab: api.tab() });
  let cur: Selection = api.sel();
  let justMeasured = false;
  const curWall = () => (cur?.kind === 'wall' ? { room: cur.room, wall: cur.wall } : null);
  const curRoom = (): Room | undefined => {
    j = api.job();
    const c0 = cur;
    if (c0 && c0.kind !== 'opening') return j.rooms.find((r) => r.id === c0.room);
    if (cur?.kind === 'opening') {
      const id = cur.id;
      const o = j.openings.find((x) => x.id === id);
      return o ? j.rooms.find((r) => r.id === o.room) : undefined;
    }
    if (mem.last) return j.rooms.find((r) => r.id === mem.last!.room);
    return j.rooms.length === 1 ? j.rooms[0] : undefined;
  };
  const roomByName = (n?: string) => (n ? api.job().rooms.find((r) => r.name === n) : undefined);
  /** where a length or a door goes: what was named, else the wall you're on, else the next one to measure */
  const target = (c: { room?: string; wall?: WallRef }): { room: Room; wall: number } | string => {
    j = api.job();
    if (!j.rooms.length) return 'No rooms yet. Draw one, or say "new room kitchen 12 by 14".';
    const named = roomByName(c.room);
    if (c.wall) {
      const r = named ?? curRoom() ?? j.rooms[0];
      const w = resolveWall(r, c.wall);
      if (w == null) return `${r.name} has no wall like that. It has ${wallCount(r)} walls.`;
      return { room: r, wall: w };
    }
    if (named) {
      const cw = curWall();
      if (cw && cw.room === named.id) return { room: named, wall: cw.wall };
      const nx = nextUnverified(j, undefined, named.id);
      return { room: named, wall: nx ? nx.wall : 0 };
    }
    const cw = curWall();
    if (cw) {
      const r = j.rooms.find((x) => x.id === cw.room);
      if (r && cw.wall < wallCount(r)) return { room: r, wall: cw.wall };
    }
    const nx = nextUnverified(j);
    if (nx) return { room: j.rooms.find((r) => r.id === nx.room)!, wall: nx.wall };
    return { room: j.rooms[0], wall: 0 };
  };

  const measure = (room: Room, wall: number, inches: number, isFix: boolean) => {
    api.setTab('plan');
    const base = api.job();
    const before = isFix && mem.prev ? mem.prev : base;
    if (!isFix) mem.prev = base;
    api.commit((x) => applyMeasurement(x, room.id, wall, inches));
    const after = api.job();
    mem.last = { room: room.id, wall };
    const w = lengthWarning(before, after, room.id, wall, inches);
    const where = wallName(after, room, wall);
    lines.push({ text: `${isFix ? 'Fixed: ' : ''}${where[0].toUpperCase() + where.slice(1)} is ${fmtFtIn(inches)}`, tone: w ? 'warn' : 'ok' });
    say.push(isFix ? `Fixed. ${where}, ${sayLength(inches)}.` : `${sayLength(inches)}.`);
    mem.warn = !!w;
    if (w) {
      lines.push({ text: w, tone: 'warn' });
      say.push(w.replace(/"/g, ''));
    }
    // a worked-out wall is worth hearing about: it saves a trip with the tape
    const r1 = after.rooms.find((x) => x.id === room.id);
    const r0 = before.rooms.find((x) => x.id === room.id);
    if (r1 && r0) {
      const worked = r1.walls.map((x, i) => (x.predicted && !r0.walls[i]?.predicted ? i : -1)).filter((i) => i >= 0);
      if (worked.length) {
        const t = worked.map((i) => `wall ${i + 1} is ${fmtFtIn(r1.walls[i].lengthIn as number)}`).join(', ');
        lines.push({ text: `Worked out ${t}`, tone: 'info' });
        say.push(`Worked out ${worked.map((i) => `wall ${i + 1}, ${sayLength(r1.walls[i].lengthIn as number)}`).join('. ')}.`);
      }
    }
    if (w) {
      // stay on this wall until it's fixed or kept
      cur = { kind: 'wall', room: room.id, wall };
      justMeasured = true;
    } else {
      const nx = nextUnverified(after, { room: room.id, wall });
      cur = nx ? { kind: 'wall', ...nx } : null;
      if (nx) {
        const nr = after.rooms.find((x) => x.id === nx.room)!;
        say.push(`Next, ${nr.id !== room.id ? nr.name + ' ' : ''}wall ${nx.wall + 1}.`);
      } else {
        lines.push({ text: 'Every wall measured. The list is exact.', tone: 'ok' });
        say.push('That is every wall. The list is exact.');
      }
      justMeasured = true;
    }
  };

  for (const c of cmds as Cmd[]) {
    const wasMeasured = justMeasured;
    justMeasured = false;
    j = api.job();
    switch (c.k) {
      case 'length': {
        // after a warning, the next plain number is the corrected one
        if (mem.warn && mem.last && !c.room && !c.wall) {
          const r = api.job().rooms.find((x) => x.id === mem.last!.room);
          if (r) {
            measure(r, mem.last.wall, c.inches, true);
            break;
          }
        }
        const t = target(c);
        if (typeof t === 'string') {
          lines.push({ text: t, tone: 'bad' });
          say.push(t);
          break;
        }
        measure(t.room, t.wall, c.inches, false);
        break;
      }
      case 'fix': {
        const last = mem.last ?? curWall();
        const r = last && api.job().rooms.find((x) => x.id === last.room);
        if (!last || !r) {
          const t = target({});
          if (typeof t === 'string') {
            lines.push({ text: t, tone: 'bad' });
            break;
          }
          measure(t.room, t.wall, c.inches, false);
          break;
        }
        measure(r, last.wall, c.inches, true);
        break;
      }
      case 'next':
      case 'back': {
        // "12 foot 6, next" already moved on
        if (c.k === 'next' && wasMeasured) break;
        const nx = step(j, curWall() ?? mem.last ?? null, c.k === 'next' ? 1 : -1);
        if (!nx) {
          lines.push({ text: 'No walls yet', tone: 'bad' });
          break;
        }
        cur = { kind: 'wall', ...nx };
        const r = j.rooms.find((x) => x.id === nx.room)!;
        const len = wallLenIn(j, r, nx.wall);
        const v = isVerified(r, nx.wall);
        lines.push({ text: `${wallName(j, r, nx.wall)}: ${v ? fmtFtIn(len) : 'not taped'}`, tone: 'info' });
        say.push(`${wallName(j, r, nx.wall)}.${v ? ' ' + sayLength(len) + '.' : ''}`);
        break;
      }
      case 'undo':
        api.undo();
        cur = mem.last ? { kind: 'wall', ...mem.last } : null;
        mem.warn = false;
        lines.push({ text: 'Undone', tone: 'info' });
        say.push('Undone.');
        break;
      case 'redo':
        api.redo();
        lines.push({ text: 'Redone', tone: 'info' });
        say.push('Redone.');
        break;
      case 'keep':
        if (mem.warn) {
          mem.warn = false;
          lines.push({ text: 'Kept it', tone: 'ok' });
          say.push('Kept it.');
          const nx = mem.last ? nextUnverified(api.job(), mem.last) : null;
          if (nx) {
            cur = { kind: 'wall', ...nx };
            const nr = api.job().rooms.find((x) => x.id === nx.room)!;
            say.push(`Next, ${wallName(api.job(), nr, nx.wall)}.`);
          }
        }
        break;
      case 'stop':
        api.stop();
        lines.push({ text: 'Stopped listening', tone: 'info' });
        break;
      case 'help':
        api.help();
        break;
      case 'tab':
        api.setTab(c.tab);
        if (c.tab === 'list') cur = null;
        lines.push({ text: c.tab === 'list' ? 'Showing the list' : 'Showing the plan', tone: 'info' });
        break;
      case 'status': {
        const e = estimate(j);
        const left = e.totalWalls - e.verifiedWalls;
        const nx = nextUnverified(j, curWall() ?? undefined);
        const iss = findIssues(j).filter((x) => x.level === 'warn');
        const open = (j.extras || []).filter((x) => !x.done).length + e.items.filter((x) => !j.checks['buy-' + x.key]).length;
        const t = !e.totalWalls ? 'No walls yet.' : left ? `${e.verifiedWalls} of ${e.totalWalls} walls taped.` : `All ${e.totalWalls} walls taped.`;
        lines.push({ text: t, tone: left ? 'info' : 'ok' });
        say.push(t);
        if (nx) {
          const r = j.rooms.find((x) => x.id === nx.room)!;
          say.push(`Next is ${r.name} wall ${nx.wall + 1}.`);
        }
        if (iss.length) {
          lines.push({ text: `${iss.length} to check: ${iss[0].text}`, tone: 'warn' });
          say.push(`${iss.length === 1 ? 'One thing' : iss.length + ' things'} to check. ${iss[0].text}. ${iss[0].fix}`);
        }
        say.push(`${open} things on the list to get.`);
        break;
      }
      case 'measure': {
        const r = roomByName(c.room);
        const nx = nextUnverified(j, undefined, r?.id);
        if (!nx) {
          lines.push({ text: r ? `${r.name} is all taped` : 'Every wall is taped', tone: 'ok' });
          say.push(r ? `${r.name} is all taped.` : 'Every wall is taped.');
          break;
        }
        api.setTab('plan');
        cur = { kind: 'wall', ...nx };
        const rr = j.rooms.find((x) => x.id === nx.room)!;
        lines.push({ text: `${rr.name}, wall ${nx.wall + 1}. Call it out.`, tone: 'info' });
        say.push(`${rr.name}, wall ${nx.wall + 1}.`);
        break;
      }
      case 'select': {
        const t = target({ room: c.room || undefined, wall: c.wall });
        if (typeof t === 'string') {
          lines.push({ text: t, tone: 'bad' });
          say.push(t);
          break;
        }
        api.setTab('plan');
        cur = { kind: 'wall', room: t.room.id, wall: t.wall };
        const len = wallLenIn(j, t.room, t.wall);
        const v = isVerified(t.room, t.wall);
        lines.push({ text: `${t.room.name}, wall ${t.wall + 1}${v ? `: ${fmtFtIn(len)}` : ''}`, tone: 'info' });
        say.push(`${t.room.name}, wall ${t.wall + 1}.`);
        break;
      }
      case 'opening': {
        const t = target(c);
        if (typeof t === 'string') {
          lines.push({ text: t, tone: 'bad' });
          say.push(t);
          break;
        }
        api.setTab('plan');
        const o = newOpening(j, t.room.id, t.wall, c.type, { widthIn: c.widthIn, heightIn: c.heightIn, newDoor: c.newDoor });
        api.commit((x) => ({ ...x, openings: [...x.openings, o] }));
        const nm = c.type === 'opening' ? 'Opening' : c.type === 'window' ? 'Window' : c.newDoor ? 'New door' : 'Door';
        const size = c.type === 'window' ? `${o.widthIn}" × ${o.heightIn}"` : `${o.widthIn}"`;
        const wl = wallLenIn(api.job(), t.room, t.wall);
        const tight = isVerified(t.room, t.wall) && o.widthIn > wl - 2;
        lines.push({ text: `${nm} ${size} on ${wallName(j, t.room, t.wall)}`, tone: tight ? 'warn' : 'ok' });
        say.push(`${nm}, ${o.widthIn} inch, on ${wallName(j, t.room, t.wall)}.`);
        if (tight) {
          warn = true;
          const m = `That ${c.type} is wider than the wall. Say undo, or fix the wall.`;
          lines.push({ text: m, tone: 'warn' });
          say.push(m);
        } else if (!c.widthIn && c.type !== 'opening') say.push('Say a size if it is not standard.');
        cur = { kind: 'wall', room: t.room.id, wall: t.wall };
        break;
      }
      case 'nobase': {
        const cw = curWall() ?? mem.last;
        const r = cw && j.rooms.find((x) => x.id === cw.room);
        if (!cw || !r) {
          lines.push({ text: 'Pick a wall first: say "next" or a room name', tone: 'bad' });
          say.push('Pick a wall first.');
          break;
        }
        api.commit((x) => ({ ...x, rooms: x.rooms.map((q) => (q.id === r.id ? { ...q, walls: q.walls.map((w, i) => (i === cw.wall ? { ...w, noBase: c.on || undefined } : w)) } : q)) }));
        lines.push({ text: `${c.on ? 'No baseboard' : 'Baseboard back'} on ${wallName(j, r, cw.wall)}`, tone: 'ok' });
        say.push(c.on ? 'No base on this wall.' : 'Base is back on this wall.');
        break;
      }
      case 'scope': {
        const r = roomByName(c.room) ?? curRoom();
        if (!r) {
          lines.push({ text: 'Which room? Say its name first, like "kitchen LVP"', tone: 'bad' });
          say.push('Which room?');
          break;
        }
        const patch: Partial<Room> =
          c.what === 'lvp' ? { floor: 'lvp' } : c.what === 'tile' ? { floor: 'tile' } : c.what === 'nofloor' ? { floor: 'none' } : c.what === 'shoe' ? { shoe: c.on } : c.what === 'crown' ? { crown: c.on } : c.what === 'base' ? { base: true } : c.what === 'nobaseroom' ? { base: false } : c.what === 'paintWalls' ? { paintWalls: c.on } : { paintCeiling: c.on };
        api.commit((x) => ({ ...x, rooms: x.rooms.map((q) => (q.id === r.id ? { ...q, ...patch } : q)) }));
        const label = { lvp: 'LVP floor', tile: 'Tile floor', nofloor: 'No new floor', shoe: c.on ? 'Shoe molding' : 'No shoe', crown: c.on ? 'Crown' : 'No crown', base: 'Baseboard', nobaseroom: 'No baseboard', paintWalls: c.on ? 'Paint the walls' : 'No wall paint', paintCeiling: 'Paint the ceiling' }[c.what];
        lines.push({ text: `${label} in ${r.name}`, tone: 'ok' });
        say.push(`${label} in ${r.name}.`);
        if ((c.what === 'lvp' || c.what === 'tile' || c.what === 'paintCeiling') && !r.closed) {
          warn = true;
          lines.push({ text: `${r.name} isn't closed, so there's no floor area yet`, tone: 'warn' });
          say.push(`${r.name} is not closed, so I can't work out the area.`);
        }
        break;
      }
      case 'newroom': {
        if (c.L && c.W) {
          const nm = c.name || `Room ${j.rooms.filter((r) => r.closed).length + 1}`;
          api.addRoom(nm, c.L, c.W);
          lines.push({ text: `Added ${nm}, ${fmtFtIn(c.L)} by ${fmtFtIn(c.W)}`, tone: 'ok' });
          say.push(`Added ${nm}, ${sayLength(c.L)} by ${sayLength(c.W)}.`);
          if (c.L > 600 || c.W > 600) {
            warn = true;
            lines.push({ text: 'That is a very big room. Typo?', tone: 'warn' });
          }
          cur = null;
        } else {
          api.openAddRoom();
          lines.push({ text: 'Say the size too, like "new room laundry 8 by 6", or type it', tone: 'info' });
          say.push('What size?');
        }
        break;
      }
      case 'add': {
        const e = estimate(j);
        api.commit((x) => addItems(x, c.items));
        const names = c.items.map((it) => (it.unit || it.qty > 1 ? `${qtyText(it)} ${it.name.toLowerCase()}` : it.name.toLowerCase()));
        lines.push({ text: `Added ${names.join(', ')}`, tone: 'ok' });
        say.push(`Got it. ${names.join(', ')}.`);
        // already figured by Plumb? say so, so nobody buys it twice
        for (const it of c.items) {
          const dup = e.items.find((x) => matchScore(it.name, x.name) >= 0.99);
          if (dup) lines.push({ text: `Plumb already has ${dup.name}: ${dup.qty}. Yours is extra.`, tone: 'info' });
        }
        break;
      }
      case 'got':
      case 'remove': {
        const e = estimate(j);
        const cands: { key: string; name: string; kind: 'extra' | 'buy' | 'df' }[] = [
          ...(j.extras || []).map((x) => ({ key: x.id, name: x.name, kind: 'extra' as const })),
          ...e.items.map((x) => ({ key: 'buy-' + x.key, name: x.name, kind: 'buy' as const })),
          ...dontForget(e.scopes).map((x) => ({ key: 'df-' + x.key, name: x.name, kind: 'df' as const })),
        ];
        let best: (typeof cands)[number] | null = null,
          bs = 0;
        for (const cd of cands) {
          const s = matchScore(c.what, cd.name);
          if (s > bs) {
            bs = s;
            best = cd;
          }
        }
        if (!best || bs < 0.5) {
          lines.push({ text: `Couldn't find "${c.what}" on the list`, tone: 'bad' });
          say.push(`I can't find ${c.what} on the list.`);
          break;
        }
        const b = best;
        if (c.k === 'remove' && b.kind === 'extra') {
          api.commit((x) => ({ ...x, extras: (x.extras || []).filter((q) => q.id !== b.key) }));
          lines.push({ text: `Took ${b.name} off the list`, tone: 'ok' });
          say.push(`Took ${b.name} off.`);
        } else if (b.kind === 'extra') {
          api.commit((x) => ({ ...x, extras: (x.extras || []).map((q) => (q.id === b.key ? { ...q, done: true } : q)) }));
          lines.push({ text: `Checked off ${b.name}`, tone: 'ok' });
          say.push(`Checked off ${b.name}.`);
        } else {
          api.commit((x) => ({ ...x, checks: { ...x.checks, [b.key]: true } }));
          lines.push({ text: `Checked off ${b.name}`, tone: 'ok' });
          say.push(`Checked off ${b.name.split('(')[0]}.`);
        }
        break;
      }
      case 'unknown':
        lines.push({ text: `Didn't catch "${c.raw}". Try "12 foot 6" or "add caulk"`, tone: 'bad' });
        say.push("Didn't catch that.");
        break;
    }
  }
  if (!cmds.length) lines.push({ text: "Didn't hear anything", tone: 'bad' });
  api.setSel(cur);
  if (warn) mem.warn = true;
  return { lines, say: say.join(' '), warn: !!mem.warn };
}
