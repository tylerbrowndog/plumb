import type { Job, Opening, Room, Settings } from './types';
import { cornerKinds, isVerified, roomAreaIn2, wallCount, wallLenIn } from './geometry';

export const DEFAULT_SETTINGS: Settings = {
  wastePct: 10,
  baseStickFt: 16,
  casingStickFt: 8,
  shoeStickFt: 8,
  crownStickFt: 12,
  baseHeightIn: 3.25,
  casingWidthIn: 2.25,
  doorWidthIn: 32,
  doorHeightIn: 80,
  windowWidthIn: 36,
  windowHeightIn: 48,
  windowCasing: true,
  cutAllowanceIn: 2,
  caulkFtPerTube: 60,
  paint: true,
  primed: true,
  coats: 2,
  ceilingIn: 96,
  wallCoats: 2,
  newDrywall: false,
  lvpBoxSqft: 20,
  floorWastePct: 10,
  padAttached: true,
  tileWIn: 12,
  tileLIn: 24,
  tileBoxSqft: 15.5,
  tileWastePct: 12,
  groutJointIn: 0.125,
  backer: true,
};

const REVEAL = 0.25; // casing reveal on the jamb
const KERF = 0.125;

export interface Piece {
  label: string;
  len: number; // inches, already including cut allowance
}
export interface Stick {
  pieces: Piece[];
  left: number;
}
export interface Profile {
  key: 'base' | 'shoe' | 'crown' | 'casing';
  name: string;
  stickIn: number;
  needIn: number; // net linear inches needed
  pieces: Piece[];
  sticks: Stick[];
  buy: number; // sticks to buy incl. spares
}

export interface RoomStats {
  room: Room;
  perimeterIn: number;
  baseIn: number;
  crownIn: number;
  doors: number;
  windows: number;
  openings: number;
  inside: number;
  outside: number;
  walls: number;
  verified: number;
  /** floor area, sq in */
  areaIn2: number;
  /** paintable wall area after doors and windows, sq in */
  wallIn2: number;
}

export type ShopGroup = 'Trim' | 'Flooring' | 'Tile' | 'Wall paint' | 'Doors' | 'Supplies';
export const GROUP_ORDER: ShopGroup[] = ['Trim', 'Doors', 'Flooring', 'Tile', 'Wall paint', 'Supplies'];

export interface ShopItem {
  key: string;
  group: ShopGroup;
  name: string;
  qty: string;
  note?: string;
}

export interface Estimate {
  rooms: RoomStats[];
  profiles: Profile[];
  items: ShopItem[];
  totalWalls: number;
  verifiedWalls: number;
  casingIn: number;
  baseIn: number;
  scopes: Scopes;
  /** totals in sq ft */
  lvpSqft: number;
  tileSqft: number;
  wallSqft: number;
  ceilingSqft: number;
  newDoors: number;
}

export interface Scopes {
  trim: boolean;
  lvp: boolean;
  tile: boolean;
  walls: boolean;
  doors: boolean;
}

/** Gaps (inches along the wall) blocked by door/opening casing */
function gapsOn(job: Job, room: Room, wall: number, L: number, s: Settings) {
  const gaps: [number, number][] = [];
  for (const o of job.openings) {
    if (o.room !== room.id || o.wall !== wall || o.type === 'window') continue;
    const c = o.t * L;
    const half = o.widthIn / 2 + REVEAL + s.casingWidthIn;
    gaps.push([c - half, c + half]);
  }
  return gaps.sort((a, b) => a[0] - b[0]);
}

function runsOn(L: number, gaps: [number, number][]): number[] {
  const runs: number[] = [];
  let cur = 0;
  for (const [a, b] of gaps) {
    if (a > cur) runs.push(Math.min(a, L) - cur);
    cur = Math.max(cur, b);
  }
  if (cur < L) runs.push(L - cur);
  return runs.filter((r) => r > 0.5);
}

/** split a long run into stick-able pieces: full sticks + remainder */
function splitRun(label: string, run: number, stickIn: number, allowance: number): Piece[] {
  const usable = stickIn - allowance;
  if (run + allowance <= stickIn) return [{ label, len: run + allowance }];
  const pieces: Piece[] = [];
  let left = run;
  let k = 1;
  while (left + allowance > stickIn) {
    pieces.push({ label: `${label} (${k})`, len: stickIn });
    left -= usable;
    k++;
  }
  if (left > 0.5) pieces.push({ label: `${label} (${k})`, len: left + allowance });
  return pieces;
}

/** first-fit decreasing cut optimization */
export function packSticks(pieces: Piece[], stickIn: number): Stick[] {
  const sorted = [...pieces].sort((a, b) => b.len - a.len);
  const sticks: Stick[] = [];
  for (const p of sorted) {
    const need = p.len;
    let placed = false;
    for (const s of sticks) {
      if (s.left >= need + (s.pieces.length ? KERF : 0)) {
        s.left -= need + (s.pieces.length ? KERF : 0);
        s.pieces.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) sticks.push({ pieces: [p], left: stickIn - need });
  }
  return sticks;
}

function openingCasingPieces(o: Opening, s: Settings, name: string): Piece[] {
  const cw = s.casingWidthIn;
  // casing legs get one square cut and one miter, so half the allowance
  const a = Math.max(0.5, s.cutAllowanceIn / 2);
  if (o.type === 'window') {
    if (!s.windowCasing) return [];
    const leg = o.heightIn + 2 * REVEAL + 2 * cw;
    const head = o.widthIn + 2 * REVEAL + 2 * cw;
    return [
      { label: `${name} leg`, len: leg + a },
      { label: `${name} leg`, len: leg + a },
      { label: `${name} head`, len: head + a },
      { label: `${name} sill`, len: head + a },
    ];
  }
  const sides = o.bothSides ? 2 : 1;
  const leg = o.heightIn + REVEAL + cw;
  const head = o.widthIn + 2 * REVEAL + 2 * cw;
  const out: Piece[] = [];
  for (let k = 0; k < sides; k++) {
    const side = sides === 2 ? (k === 0 ? ' A' : ' B') : '';
    out.push({ label: `${name}${side} leg`, len: leg + a }, { label: `${name}${side} leg`, len: leg + a }, { label: `${name}${side} head`, len: head + a });
  }
  return out;
}

/** keep settings in ranges that can't break the math (zero-length sticks, empty boxes) */
export function safeSettings(x: Settings): Settings {
  const c = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const D = DEFAULT_SETTINGS;
  return {
    ...x,
    wastePct: c(x.wastePct, 0, 100, D.wastePct),
    baseStickFt: c(x.baseStickFt, 4, 20, D.baseStickFt),
    casingStickFt: c(x.casingStickFt, 4, 20, D.casingStickFt),
    shoeStickFt: c(x.shoeStickFt, 4, 20, D.shoeStickFt),
    crownStickFt: c(x.crownStickFt, 4, 20, D.crownStickFt),
    cutAllowanceIn: c(x.cutAllowanceIn, 0, 12, D.cutAllowanceIn),
    caulkFtPerTube: c(x.caulkFtPerTube, 10, 500, D.caulkFtPerTube),
    coats: c(x.coats, 1, 6, D.coats),
    ceilingIn: c(x.ceilingIn, 60, 360, D.ceilingIn),
    wallCoats: c(x.wallCoats, 1, 6, D.wallCoats),
    lvpBoxSqft: c(x.lvpBoxSqft, 5, 100, D.lvpBoxSqft),
    floorWastePct: c(x.floorWastePct, 0, 50, D.floorWastePct),
    tileWIn: c(x.tileWIn, 1, 96, D.tileWIn),
    tileLIn: c(x.tileLIn, 1, 96, D.tileLIn),
    tileBoxSqft: c(x.tileBoxSqft, 1, 100, D.tileBoxSqft),
    tileWastePct: c(x.tileWastePct, 0, 50, D.tileWastePct),
    groutJointIn: c(x.groutJointIn, 0.03, 1, D.groutJointIn),
  };
}

export function estimate(job: Job): Estimate {
  job = { ...job, settings: safeSettings({ ...DEFAULT_SETTINGS, ...job.settings }) };
  const s = job.settings;
  const roomStats: RoomStats[] = [];
  const basePieces: Piece[] = [];
  const shoePieces: Piece[] = [];
  const crownPieces: Piece[] = [];
  const casingPieces: Piece[] = [];
  let totalWalls = 0,
    verifiedWalls = 0;
  let casingNet = 0;

  const stick = (ft: number) => ft * 12;

  for (const r of job.rooms) {
    const n = wallCount(r);
    let perim = 0,
      baseIn = 0,
      crownIn = 0,
      verified = 0;
    for (let i = 0; i < n; i++) {
      const L = wallLenIn(job, r, i);
      perim += L;
      if (isVerified(r, i)) verified++;
      const wname = `${r.name} W${i + 1}`;
      if (!r.walls[i]?.noBase) {
        const runs = runsOn(L, gapsOn(job, r, i, L, s));
        runs.forEach((run, k) => {
          const label = runs.length > 1 ? `${wname}${String.fromCharCode(97 + k)}` : wname;
          baseIn += run;
          if (r.base) basePieces.push(...splitRun(label, run, stick(s.baseStickFt), s.cutAllowanceIn));
          if (r.shoe) shoePieces.push(...splitRun(label, run, stick(s.shoeStickFt), s.cutAllowanceIn));
        });
      }
      if (r.crown) {
        crownIn += L;
        crownPieces.push(...splitRun(wname, L, stick(s.crownStickFt), s.cutAllowanceIn * 2));
      }
    }
    totalWalls += n;
    verifiedWalls += verified;
    const ops = job.openings.filter((o) => o.room === r.id);
    let dn = 0,
      wn = 0,
      on = 0;
    for (const o of ops) {
      const name = o.type === 'window' ? `${r.name} Win${++wn}` : o.type === 'door' ? `${r.name} Door${++dn}` : `${r.name} Open${++on}`;
      const ps = openingCasingPieces(o, s, name);
      casingPieces.push(...ps);
      casingNet += ps.reduce((t, p) => t + p.len - Math.max(0.5, s.cutAllowanceIn / 2), 0);
    }
    const corners = cornerKinds(r);
    const H = r.heightIn ?? s.ceilingIn;
    const holes = ops.reduce((t, o) => t + o.widthIn * Math.min(o.heightIn, H), 0);
    roomStats.push({
      areaIn2: roomAreaIn2(job, r),
      wallIn2: Math.max(0, perim * H - holes),
      room: r,
      perimeterIn: perim,
      baseIn: r.base ? baseIn : 0,
      crownIn,
      doors: dn,
      windows: wn,
      openings: on,
      inside: corners.filter((c) => c === 'inside').length,
      outside: corners.filter((c) => c === 'outside').length,
      walls: n,
      verified,
    });
  }

  const mk = (key: Profile['key'], name: string, ft: number, pieces: Piece[], netIn: number): Profile => {
    const sticks = packSticks(pieces, stick(ft));
    const spare = sticks.length ? Math.ceil((sticks.length * s.wastePct) / 100) : 0;
    return { key, name, stickIn: stick(ft), needIn: netIn, pieces, sticks, buy: sticks.length + spare };
  };

  const baseNet = roomStats.reduce((t, r) => t + (r.room.base ? r.baseIn : 0), 0);
  const shoeNet = job.rooms.reduce((t, r) => t + (r.shoe ? shoeRunOnly(job, r, s) : 0), 0);
  const crownNet = roomStats.reduce((t, r) => t + r.crownIn, 0);

  const profiles: Profile[] = [];
  if (basePieces.length) profiles.push(mk('base', `Baseboard ${frac(s.baseHeightIn)}"`, s.baseStickFt, basePieces, baseNet));
  if (shoePieces.length) profiles.push(mk('shoe', 'Shoe / quarter round', s.shoeStickFt, shoePieces, shoeNet));
  if (casingPieces.length) profiles.push(mk('casing', `Casing ${frac(s.casingWidthIn)}"`, s.casingStickFt, casingPieces, casingNet));
  if (crownPieces.length) profiles.push(mk('crown', 'Crown', s.crownStickFt, crownPieces, crownNet));

  const items: ShopItem[] = [];
  for (const p of profiles) {
    items.push({
      group: 'Trim',
      key: `trim-${p.key}`,
      name: p.name,
      qty: `${p.buy} × ${p.stickIn / 12}'`,
      note: `${Math.ceil(p.needIn / 12)} LF needed. ${p.sticks.length} for the cuts, ${p.buy - p.sticks.length} spare`,
    });
  }

  const lf = (inches: number) => inches / 12;
  const baseLF = lf(baseNet),
    shoeLF = lf(shoeNet),
    crownLF = lf(crownNet),
    casLF = lf(casingNet);
  const anyTrim = baseLF + shoeLF + crownLF + casLF > 0;

  if (anyTrim) {
    // caulk: top of base, both edges of casing & crown
    const beadFt = baseLF + casLF * 1.5 + crownLF * 2;
    const tubes = Math.max(1, Math.ceil((beadFt * (1 + s.wastePct / 100)) / s.caulkFtPerTube));
    items.push({ group: 'Trim', key: 'caulk', name: 'Paintable caulk (white)', qty: `${tubes} tube${tubes > 1 ? 's' : ''}`, note: `~${Math.round(beadFt)} ft of bead` });

    const longNails = Math.ceil(baseLF * 1.5 + casLF * 1 + crownLF * 1.5);
    const shortNails = Math.ceil(casLF * 1 + shoeLF * 1);
    const box = (n: number) => (n <= 900 ? '1 box (1,000)' : n <= 2300 ? '1 box (2,500)' : `${Math.ceil(n / 5000)} box (5,000)`);
    if (longNails > 0) items.push({ group: 'Trim', key: 'nails-2', name: '18ga brad nails, 2"', qty: box(longNails), note: `~${longNails} nails` });
    if (shortNails > 0) items.push({ group: 'Trim', key: 'nails-114', name: '18ga brad nails, 1¼"', qty: box(shortNails), note: `~${shortNails} nails` });

    const totalLF = baseLF + shoeLF + crownLF + casLF;
    const filler = Math.max(1, Math.ceil(totalLF / 300));
    items.push({ group: 'Trim', key: 'filler', name: 'Wood filler / spackle', qty: `${filler} small tub${filler > 1 ? 's' : ''}`, note: 'nail holes and joints' });

    const corners = roomStats.reduce((t, r) => t + r.outside, 0);
    if (corners > 0) items.push({ group: 'Trim', key: 'glue', name: 'Wood glue (outside miters)', qty: '1 bottle', note: `${corners} outside corner${corners > 1 ? 's' : ''}` });

    if (s.paint) {
      const sqft = (baseLF * (s.baseHeightIn + 0.75) + casLF * (s.casingWidthIn + 0.5) + shoeLF * 1 + crownLF * 4.5) / 12;
      const paintSqft = sqft * 1.3 * s.coats;
      const qts = Math.max(1, Math.ceil(paintSqft / 90));
      const paintQty = qts >= 3 ? `${Math.ceil(qts / 4)} gallon${qts > 4 ? 's' : ''}` : `${qts} quart${qts > 1 ? 's' : ''}`;
      items.push({ group: 'Trim', key: 'paint', name: 'Trim paint, semi-gloss', qty: paintQty, note: `${s.coats} coats on ~${Math.round(sqft)} sq ft` });
      if (!s.primed) {
        const pq = Math.max(1, Math.ceil((sqft * 1.3) / 90));
        items.push({ group: 'Trim', key: 'primer', name: 'Primer', qty: pq >= 3 ? `${Math.ceil(pq / 4)} gallon` : `${pq} quart${pq > 1 ? 's' : ''}`, note: 'raw wood or bare spots' });
      }
      const tape = Math.max(1, Math.ceil((baseLF + shoeLF) / 150));
      items.push({ group: 'Trim', key: 'tape', name: "Painter's tape", qty: `${tape} roll${tape > 1 ? 's' : ''}`, note: 'floor edge along base' });
    }
    const sponges = Math.max(2, Math.ceil(totalLF / 150));
    items.push({ group: 'Trim', key: 'sand', name: 'Sanding sponges (fine)', qty: `${sponges}`, note: 'scuff and smooth filler' });
  }

  const more = moreItems(job, roomStats);
  items.push(...more.items);

  return {
    rooms: roomStats,
    profiles,
    items,
    totalWalls,
    verifiedWalls,
    casingIn: casingNet,
    baseIn: baseNet,
    scopes: { trim: anyTrim, ...more.scopes },
    lvpSqft: more.lvpSqft,
    tileSqft: more.tileSqft,
    wallSqft: more.wallSqft,
    ceilingSqft: more.ceilingSqft,
    newDoors: more.newDoors,
  };
}

function shoeRunOnly(job: Job, r: Room, s: Settings) {
  let t = 0;
  for (let i = 0; i < wallCount(r); i++) {
    if (r.walls[i]?.noBase) continue;
    const L = wallLenIn(job, r, i);
    t += runsOn(L, gapsOn(job, r, i, L, s)).reduce((a, b) => a + b, 0);
  }
  return t;
}

export function frac(v: number) {
  const whole = Math.floor(v);
  const f = v - whole;
  const map: Record<string, string> = { '0.125': '⅛', '0.25': '¼', '0.375': '⅜', '0.5': '½', '0.625': '⅝', '0.75': '¾', '0.875': '⅞' };
  const k = (Math.round(f * 8) / 8).toString();
  const fs = map[k] ?? '';
  return `${whole || (fs ? '' : '0')}${fs}`;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** paint in store sizes: 5-gal buckets + gallons, or quarts for small jobs */
export function paintPack(gal: number) {
  if (gal <= 0) return '';
  if (gal <= 0.5) return plural(Math.max(1, Math.ceil(gal * 4)), 'quart');
  let g = Math.floor(gal);
  const rem = gal - g;
  let quarts = 0;
  if (rem > 0.25) g++;
  else if (rem > 0.01) quarts = 1;
  // 4 gallons cost about the same as a 5-gallon bucket
  let buckets = Math.floor(g / 5);
  if (g % 5 >= 4) buckets++, (quarts = 0);
  g = Math.max(0, g - buckets * 5);
  const parts = [];
  if (buckets) parts.push(`${buckets} × 5-gal bucket`);
  if (g) parts.push(plural(g, 'gallon'));
  if (quarts) parts.push('1 quart');
  return parts.join(' + ');
}

function moreItems(job: Job, rooms: RoomStats[]) {
  const s = job.settings;
  const items: ShopItem[] = [];
  const sq = (in2: number) => in2 / 144;
  const lvpRooms = rooms.filter((r) => r.room.floor === 'lvp' && r.room.closed);
  const tileRooms = rooms.filter((r) => r.room.floor === 'tile' && r.room.closed);
  const wallRooms = rooms.filter((r) => r.room.paintWalls);
  const ceilRooms = rooms.filter((r) => r.room.paintCeiling && r.room.closed);
  const lvpSqft = lvpRooms.reduce((t, r) => t + sq(r.areaIn2), 0);
  const tileSqft = tileRooms.reduce((t, r) => t + sq(r.areaIn2), 0);
  const wallSqft = wallRooms.reduce((t, r) => t + sq(r.wallIn2), 0);
  const ceilingSqft = ceilRooms.reduce((t, r) => t + sq(r.areaIn2), 0);
  const newDoorList = job.openings.filter((o) => o.type === 'door' && o.newDoor);
  const flooredIds = new Set([...lvpRooms, ...tileRooms].map((r) => r.room.id));
  const doorways = job.openings.filter((o) => o.type !== 'window' && flooredIds.has(o.room)).length;

  // ---- doors
  if (newDoorList.length) {
    const bySize = new Map<string, number>();
    for (const o of newDoorList) {
      const k = `${frac(o.widthIn)}" × ${frac(o.heightIn)}"`;
      bySize.set(k, (bySize.get(k) || 0) + 1);
    }
    for (const [k, n] of bySize) items.push({ group: 'Doors', key: `door-${k}`, name: `Prehung interior door ${k}`, qty: `${n}`, note: 'check swing (left or right hand) and jamb depth on site' });
    const n = newDoorList.length;
    items.push({ group: 'Doors', key: 'door-hw', name: 'Knob or lever set', qty: `${n}`, note: 'passage for halls and closets, privacy for bed and bath' });
    items.push({ group: 'Doors', key: 'door-stop', name: 'Door stops', qty: `${n}` });
    items.push({ group: 'Doors', key: 'door-shims', name: 'Wood shims', qty: plural(Math.ceil(n / 2), 'bundle'), note: 'about 6 pairs per door' });
    items.push({ group: 'Doors', key: 'door-screws', name: '2½" trim screws', qty: '1 box', note: '2 per hinge into the stud, plus strike side' });
  }

  // ---- LVP
  if (lvpSqft > 0) {
    const need = lvpSqft * (1 + s.floorWastePct / 100);
    const boxes = Math.ceil(need / s.lvpBoxSqft);
    items.push({ group: 'Flooring', key: 'lvp', name: `LVP flooring (${s.lvpBoxSqft} sq ft/box)`, qty: plural(boxes, 'box', 'boxes'), note: `${Math.round(lvpSqft)} sq ft plus ${s.floorWastePct}% waste. Buy one lot number` });
    if (!s.padAttached) items.push({ group: 'Flooring', key: 'lvp-pad', name: 'Underlayment (100 sq ft roll)', qty: plural(Math.ceil(need / 100), 'roll'), note: 'skip if the planks have pad attached' });
  }
  if (doorways > 0 && lvpSqft + tileSqft > 0) {
    items.push({ group: 'Flooring', key: 'transition', name: 'Transition strip (72")', qty: `${Math.ceil(doorways / 2)}`, note: `${plural(doorways, 'doorway')}. T-molding, reducer or end cap to match` });
  }

  // ---- tile
  if (tileSqft > 0) {
    const need = tileSqft * (1 + s.tileWastePct / 100);
    const big = Math.max(s.tileWIn, s.tileLIn);
    const tiles = Math.ceil((need * 144) / (s.tileWIn * s.tileLIn));
    items.push({ group: 'Tile', key: 'tile', name: `Tile ${frac(s.tileWIn)}" × ${frac(s.tileLIn)}" (${s.tileBoxSqft} sq ft/box)`, qty: plural(Math.ceil(need / s.tileBoxSqft), 'box', 'boxes'), note: `${Math.round(tileSqft)} sq ft plus ${s.tileWastePct}% waste, about ${tiles} tiles` });
    const perBag = big >= 12 ? 45 : 90;
    items.push({ group: 'Tile', key: 'thinset', name: big >= 15 ? 'Large-format thinset (50 lb)' : 'Modified thinset (50 lb)', qty: plural(Math.ceil(tileSqft / perBag), 'bag'), note: big >= 12 ? '½" notch trowel, back-butter big tile' : '¼" notch trowel' });
    // grout: joint volume per sq ft, ~0.065 lb per cubic inch, +15%
    const thick = 0.375;
    const lbs = ((144 * (s.tileWIn + s.tileLIn)) / (s.tileWIn * s.tileLIn)) * s.groutJointIn * thick * 0.065 * tileSqft * 1.15;
    const sanded = s.groutJointIn >= 0.125;
    items.push({ group: 'Tile', key: 'grout', name: `${sanded ? 'Sanded' : 'Unsanded'} grout`, qty: lbs <= 9 ? '1 × 10 lb bag' : plural(Math.ceil(lbs / 25), '25 lb bag'), note: `~${Math.ceil(lbs)} lb at ${frac(s.groutJointIn)}" joints` });
    if (s.backer) {
      const sheets = Math.ceil(need / 15);
      items.push({ group: 'Tile', key: 'backer', name: 'Cement board ½" (3\' × 5\')', qty: plural(sheets, 'sheet'), note: 'over wood subfloor; skip on concrete' });
      items.push({ group: 'Tile', key: 'backer-screws', name: '1¼" backer board screws', qty: plural(Math.ceil((sheets * 45) / 185), 'box', 'boxes'), note: 'about 45 per sheet' });
      items.push({ group: 'Tile', key: 'mesh', name: 'Alkali-resistant mesh tape', qty: '1 roll' });
    }
    if (big >= 15) items.push({ group: 'Tile', key: 'clips', name: 'Tile leveling clips + wedges', qty: plural(Math.ceil((tiles * 2) / 100), 'bag'), note: '100 per bag, stops lippage' });
    else items.push({ group: 'Tile', key: 'spacers', name: `Tile spacers ${frac(s.groutJointIn)}"`, qty: '1 bag' });
    items.push({ group: 'Tile', key: 'sealer', name: 'Grout sealer', qty: '1 bottle', note: 'after grout cures' });
  }

  // ---- walls + ceilings
  const COVER = 350;
  if (wallSqft > 0) {
    const gal = (wallSqft * s.wallCoats) / COVER;
    items.push({ group: 'Wall paint', key: 'wall-paint', name: 'Wall paint, eggshell', qty: paintPack(gal), note: `${s.wallCoats} coats on ${Math.round(wallSqft)} sq ft (doors and windows taken out)` });
  }
  if (ceilingSqft > 0) {
    const gal = (ceilingSqft * s.wallCoats) / COVER;
    items.push({ group: 'Wall paint', key: 'ceil-paint', name: 'Ceiling paint, flat white', qty: paintPack(gal), note: `${s.wallCoats} coats on ${Math.round(ceilingSqft)} sq ft` });
  }
  if (wallSqft + ceilingSqft > 0) {
    const area = wallSqft + ceilingSqft;
    if (s.newDrywall) items.push({ group: 'Wall paint', key: 'pva', name: 'Drywall primer (PVA)', qty: paintPack(area / 300), note: 'one coat on new drywall' });
    items.push({ group: 'Wall paint', key: 'roller', name: '9" roller covers, ⅜" nap', qty: `${Math.max(2, Math.ceil(area / 500))}` });
    items.push({ group: 'Wall paint', key: 'liners', name: 'Roller tray liners', qty: `${Math.max(2, Math.ceil(area / 600))}` });
    items.push({ group: 'Wall paint', key: 'patch', name: 'Spackle + patch kit', qty: '1', note: 'fill holes before you paint' });
    const perim = wallRooms.reduce((t, r) => t + r.perimeterIn / 12, 0);
    const rolls = Math.max(1, Math.ceil((perim * 2) / 180));
    items.push({ group: 'Wall paint', key: 'wall-tape', name: "Painter's tape, 1.41\" (60 yd)", qty: plural(rolls, 'roll'), note: 'ceiling line and trim edges' });
  }

  return {
    items,
    lvpSqft,
    tileSqft,
    wallSqft,
    ceilingSqft,
    newDoors: newDoorList.length,
    scopes: { lvp: lvpSqft > 0, tile: tileSqft > 0, walls: wallSqft + ceilingSqft > 0, doors: newDoorList.length > 0 },
  };
}

export interface ForgetItem {
  key: string;
  group: string;
  name: string;
  when: keyof Scopes | 'any';
}

export const DONT_FORGET: ForgetItem[] = [
  { key: 'tape-measure', group: 'Tools', name: 'Tape measure + pencil', when: 'any' },
  { key: 'knife', group: 'Tools', name: 'Utility knife + spare blades', when: 'any' },
  { key: 'level', group: 'Tools', name: 'Level and stud finder', when: 'any' },
  { key: 'glasses', group: 'Safety', name: 'Safety glasses, ear protection, knee pads', when: 'any' },
  { key: 'vac', group: 'Cleanup', name: 'Shop vac + trash bags', when: 'any' },
  { key: 'cords', group: 'Power', name: 'Extension cord + charged batteries', when: 'any' },
  { key: 'nailer', group: 'Tools', name: 'Brad nailer + compressor or battery', when: 'trim' },
  { key: 'miter', group: 'Tools', name: 'Miter saw (fine-tooth blade)', when: 'trim' },
  { key: 'coping', group: 'Tools', name: 'Coping saw + file (inside corners)', when: 'trim' },
  { key: 'gun', group: 'Tools', name: 'Caulk gun', when: 'trim' },
  { key: 'pry', group: 'Tools', name: 'Pry bar (old trim) + nail puller', when: 'trim' },
  { key: 'nailset', group: 'Tools', name: 'Nail set + putty knife', when: 'trim' },
  { key: 'angle', group: 'Tools', name: 'Angle finder (walls are never 90°)', when: 'trim' },
  { key: 'brush', group: 'Paint', name: '2" angled brush + small roller', when: 'trim' },
  { key: 'shims', group: 'Supplies', name: 'Shims (wavy floors, door jambs)', when: 'trim' },
  { key: 'adhesive', group: 'Supplies', name: 'Construction adhesive (outside corners, loose base)', when: 'trim' },
  { key: 'drop', group: 'Paint', name: 'Drop cloths + rags', when: 'any' },
  { key: 'door-level', group: 'Tools', name: '6\' level or door jack for plumb jambs', when: 'doors' },
  { key: 'jig', group: 'Tools', name: 'Drill, driver bits, 2⅛" hole saw for knobs', when: 'doors' },
  { key: 'jamb-saw', group: 'Tools', name: 'Jamb undercut saw (floor under casing)', when: 'lvp' },
  { key: 'spacers-lvp', group: 'Tools', name: 'Expansion spacers, tapping block, pull bar', when: 'lvp' },
  { key: 'vapor', group: 'Supplies', name: '6-mil poly if going over concrete', when: 'lvp' },
  { key: 'lvp-cut', group: 'Tools', name: 'LVP cutter or extra knife blades', when: 'lvp' },
  { key: 'trowel', group: 'Tools', name: 'Notched trowel, margin trowel, grout float', when: 'tile' },
  { key: 'mixer', group: 'Tools', name: 'Mixing paddle, drill, 2 buckets', when: 'tile' },
  { key: 'wet-saw', group: 'Tools', name: 'Wet saw or tile cutter + diamond blade', when: 'tile' },
  { key: 'sponge', group: 'Supplies', name: 'Grout sponges (2) + haze cloth', when: 'tile' },
  { key: 'pole', group: 'Paint', name: 'Extension pole + roller frame', when: 'walls' },
  { key: 'cut-brush', group: 'Paint', name: '2½" cut-in brush', when: 'walls' },
  { key: 'ladder', group: 'Tools', name: 'Step ladder', when: 'walls' },
];

export function dontForget(sc: Scopes) {
  return DONT_FORGET.filter((d) => d.when === 'any' || sc[d.when]);
}
