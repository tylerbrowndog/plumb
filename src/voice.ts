// Turns what you say (or type) on the job into actions. Runs on the phone: no server, no AI service.
import { parseLength } from './units';

const ONES: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// the speech engine hears these for fractions
const FRACS: [RegExp, string][] = [
  [/(\d) (?:and )?(?:a |one |1 )?half\b/g, '$1 1/2'],
  [/(\d) (?:and )?3 quarters?\b/g, '$1 3/4'],
  [/(\d) (?:and )?(?:a |one |1 )?quarter\b/g, '$1 1/4'],
  [/(\d) (?:and )?(\d) eighths\b/g, '$1 $2/8'],
  [/(\d) (?:and )?(?:an |one |1 )?eighth\b/g, '$1 1/8'],
  [/(\d) (?:and )?(\d+) sixteenths\b/g, '$1 $2/16'],
  [/(\d) (?:and )?(?:a |one |1 )?sixteenth\b/g, '$1 1/16'],
];

/** number words to digits, only where a number word stands alone ("for" and "to" only next to a unit) */
function wordsToDigits(s: string): string {
  const toks = s.split(' ');
  const out: string[] = [];
  const unitNext = (i: number) => /^(feet|foot|ft|inch|inches|in|by|x|boxes|box|tubes?|bags?|rolls?)$/.test(toks[i + 1] || '');
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const weak = t === 'to' || t === 'too' || t === 'for' || t === 'oh' || t === 'ate';
    if (TENS[t] != null) {
      let v = TENS[t];
      const n = toks[i + 1];
      if (n && ONES[n] != null && ONES[n] < 10 && ONES[n] > 0 && n !== 'to' && n !== 'for') {
        v += ONES[n];
        i++;
      }
      out.push(String(v));
    } else if (ONES[t] != null && (!weak || unitNext(i))) out.push(String(ONES[t]));
    else if (t === 'hundred' && out.length && /^\d+$/.test(out[out.length - 1])) {
      const h = parseInt(out.pop() as string) * 100;
      const n = toks[i + 1] === 'and' ? 2 : 1;
      const nx = toks[i + n];
      if (nx && /^\d+$/.test(nx)) {
        out.push(String(h + parseInt(nx)));
        i += n;
      } else if (nx && (TENS[nx] != null || (ONES[nx] != null && nx !== 'to' && nx !== 'for'))) {
        let v = TENS[nx] ?? ONES[nx];
        i += n;
        const n2 = toks[i + 1];
        if (TENS[nx] != null && n2 && ONES[n2] != null && ONES[n2] < 10 && ONES[n2] > 0) {
          v += ONES[n2];
          i++;
        }
        out.push(String(h + v));
      } else out.push(String(h));
    } else out.push(t);
  }
  return out.join(' ');
}

/** lower case, digits for number words, plain fractions, one space between words */
export function normalize(raw: string): string {
  let s = ` ${raw.toLowerCase()} `
    .replace(/[’‘`]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/′/g, "'")
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(/⅛/g, ' 1/8').replace(/⅜/g, ' 3/8').replace(/⅝/g, ' 5/8').replace(/⅞/g, ' 7/8')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[!?]/g, ' ')
    .replace(/\s+/g, ' ');
  s = wordsToDigits(s.trim());
  for (const [re, rep] of FRACS) s = s.replace(re, rep);
  s = s
    .replace(/(\d) point (\d)/g, '$1.$2')
    .replace(/(\d)\s*(?:'|feet|foot|ft)\.?/g, '$1 ft ')
    .replace(/(\d)\s*(?:"|inches|inch|in\b)\.?/g, '$1 in ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/** "12 ft 6 1/2" / "12 6" / "150 in" / "12 and a half feet" → inches */
export function spokenLength(raw: string): number | null {
  let s = normalize(raw);
  for (let i = 0; i < 4; i++) s = s.replace(/^(it'?s|its|that'?s|thats|is|was|about|around|roughly|call it|measures?|exactly|make it|set it to|length|it|the wall|wall)\s+/, '');
  s = s
    .replace(/\s+(even|on the nose|flat|exactly)$/, '')
    .replace(/ and /g, ' ')
    .replace(/[,.]$/, '')
    .trim();
  if (!s || !/\d/.test(s)) return null;
  // "12 1/2 ft" → 12.5 ft
  s = s.replace(/^(\d+) (\d+)\/(\d+) ft$/, (_, a, b, c) => `${+a + +b / +c} ft`);
  s = s.replace(/ ft /g, "' ").replace(/ ft$/, "'").replace(/ in$/, '"').replace(/ in /g, '" ');
  const v = parseLength(s.replace(/,/g, ' ').replace(/\s+/g, ' ').trim());
  return v;
}

const UNITS: Record<string, string> = {
  tube: 'tube', tubes: 'tube', box: 'box', boxes: 'box', bag: 'bag', bags: 'bag', roll: 'roll', rolls: 'roll', gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
  quart: 'quart', quarts: 'quart', sheet: 'sheet', sheets: 'sheet', stick: 'stick', sticks: 'stick', piece: 'piece', pieces: 'piece', pack: 'pack', packs: 'pack',
  package: 'pack', packages: 'pack', bundle: 'bundle', bundles: 'bundle', can: 'can', cans: 'can', bottle: 'bottle', bottles: 'bottle', pair: 'pair', pairs: 'pair',
  bucket: 'bucket', buckets: 'bucket', tub: 'tub', tubs: 'tub', case: 'case', cases: 'case', length: 'length', lengths: 'length', board: 'board', boards: 'board',
  sleeve: 'sleeve', sleeves: 'sleeve', set: 'set', sets: 'set', pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb', jug: 'jug', jugs: 'jug', spool: 'spool', spools: 'spool',
};
const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, another: 1, one: 1, couple: 2, 'a couple': 2, 'a couple of': 2, few: 3, 'a few': 3, dozen: 12, 'a dozen': 12 };

export function plural(unit: string, n: number) {
  if (n === 1 || unit === 'lb') return unit;
  if (/(x|ch|sh|s)$/.test(unit)) return unit + 'es';
  return unit + 's';
}

export interface ParsedItem {
  name: string;
  qty: number;
  unit?: string;
}

/** "two tubes of caulk and a box of shims" → [{2, tube, caulk}, {1, box, shims}] */
export function parseItems(raw: string): ParsedItem[] {
  const s = normalize(raw)
    .replace(/\b(to|on|onto|for) (the|my|our) (shopping )?list\b/g, ' ')
    .replace(/\b(please|thanks|thank you|too|as well|also)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // split on commas and on "and" between two things, but keep "and" inside a known pair like "nuts and bolts"
  const parts = s
    .split(/\s*(?:,|;|\bplus\b|\bthen\b|\band then\b|\band also\b|\band\b(?! bolts| washers| water| grout))\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: ParsedItem[] = [];
  for (let p of parts) {
    p = p.replace(/^(some|more|the|extra|any|of)\s+/, '').trim();
    let qty = 1,
      unit: string | undefined;
    let m = p.match(/^(a couple of|a couple|a few|a dozen|couple|few|dozen|another|an|a|one)\s+(.*)$/);
    if (m) {
      qty = COUNT_WORDS[m[1]] ?? 1;
      p = m[2];
    } else if ((m = p.match(/^(\d+)\s+(.*)$/))) {
      // "2 inch brads" or "2 x 4s": the number is part of the name
      if (!/^(in|ft|by|x|inch|foot|mm|gauge|ga|penny|d)\b/.test(m[2])) {
        qty = Math.min(999, parseInt(m[1]));
        p = m[2];
      }
    }
    m = p.match(/^(more\s+)?([a-z]+)\s+(?:of\s+)?(.+)$/);
    if (m && UNITS[m[2]] && m[3]) {
      unit = UNITS[m[2]];
      p = m[3];
    }
    p = p.replace(/^(of|the|some)\s+/, '').replace(/\s+/g, ' ').trim();
    // spoken lengths in names read better as the tape writes them: 2 in brads → 2" brads
    p = p.replace(/(\d) in\b/g, '$1"').replace(/(\d) ft\b/g, "$1'");
    if (p.length < 2 || p.length > 60 || /^(it|that|this|them|those|stuff|things?)$/.test(p)) continue;
    if (qty < 1) qty = 1;
    out.push({ name: p.charAt(0).toUpperCase() + p.slice(1), qty, unit });
  }
  return out;
}

export type WallRef = { index?: number; side?: 'top' | 'bottom' | 'left' | 'right'; ordinal?: 'first' | 'last' };
export type Cmd =
  | { k: 'length'; inches: number; room?: string; wall?: WallRef; raw: string }
  | { k: 'fix'; inches: number; raw: string }
  | { k: 'next' }
  | { k: 'back' }
  | { k: 'undo' }
  | { k: 'redo' }
  | { k: 'keep' }
  | { k: 'stop' }
  | { k: 'status' }
  | { k: 'help' }
  | { k: 'tab'; tab: 'plan' | 'list' }
  | { k: 'measure'; room?: string }
  | { k: 'select'; room: string; wall?: WallRef }
  | { k: 'opening'; type: 'door' | 'window' | 'opening'; widthIn?: number; heightIn?: number; newDoor?: boolean; room?: string; wall?: WallRef }
  | { k: 'nobase'; on: boolean }
  | { k: 'scope'; what: 'lvp' | 'tile' | 'nofloor' | 'shoe' | 'crown' | 'base' | 'nobaseroom' | 'paintWalls' | 'paintCeiling'; on: boolean; room?: string }
  | { k: 'newroom'; name?: string; L?: number; W?: number }
  | { k: 'add'; items: ParsedItem[] }
  | { k: 'got'; what: string }
  | { k: 'remove'; what: string }
  | { k: 'unknown'; raw: string };

const ADD_VERB = /^(?:can you |could you |please |also |and |oh |hey |plus )*(add|we need|we're gonna need|we are going to need|i need|need|we gotta get|gotta get|get|grab|buy|pick up|don't forget|dont forget|do not forget|remember|put|we're out of|we are out of|out of|running low on|low on|we're low on)\b\s*(.*)$/;
const GOT_VERB = /^(?:i |we )?(got|have|grabbed|picked up|bought|already have|check off|check|tick|tick off|cross off|done with)\b\s*(?:the |a |an |some )?(.*)$/;
const REMOVE_VERB = /^(?:take |cross |scratch |delete |remove )(?:off )?(?:the )?(.*?)(?: off)?(?: the list| from the list)?$/;

function wallRef(s: string): { ref?: WallRef; rest: string } {
  let m = s.match(/\b(north|top|upper|back|south|bottom|lower|front|east|right|west|left)\s+(?:wall|side)\b/);
  if (m) {
    const side = ({ north: 'top', top: 'top', upper: 'top', back: 'top', south: 'bottom', bottom: 'bottom', lower: 'bottom', front: 'bottom', east: 'right', right: 'right', west: 'left', left: 'left' } as const)[m[1] as 'north'];
    return { ref: { side }, rest: s.replace(m[0], ' ') };
  }
  m = s.match(/\b(?:wall|side)\s*(?:number\s*)?(\d{1,2})\b(?!\s*(?:ft|in)\b)/);
  if (m) return { ref: { index: parseInt(m[1]) - 1 }, rest: s.replace(m[0], ' ') };
  m = s.match(/\b(first|last)\s+wall\b/);
  if (m) return { ref: { ordinal: m[1] as 'first' }, rest: s.replace(m[0], ' ') };
  return { rest: s };
}

/** find a room named at the start of what was said */
function roomAt(s: string, rooms: string[]): { room?: string; rest: string } {
  const named = rooms
    .map((r) => ({ r, n: r.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() }))
    .filter((x) => x.n)
    .sort((a, b) => b.n.length - a.n.length);
  for (const { r, n } of named) {
    const re = new RegExp(`^(?:(?:in|the|go to|in the|on the|for the|for)\\s+)*${n.replace(/ /g, '\\s+')}(?:'s)?\\b`);
    const m = s.match(re);
    if (m) return { room: r, rest: s.slice(m[0].length).trim() };
  }
  return { rest: s };
}

const strip = (s: string) => s.replace(/^[\s,.;:]+|[\s,.;:]+$/g, '').trim();

/** break one breath into the steps it holds: "12 foot 6 next 10 foot 2" is two lengths and two nexts */
function clauses(s: string): string[] {
  const out: string[] = [];
  s = s.replace(/(\d) ft\s*,\s*(\d)/g, '$1 ft $2').replace(/(^|[.;,] )(no|nope|nah|wrong|sorry|oops|actually|correction)\s*,\s*/g, '$1$2 ');
  for (const part of s.split(/\s*(?:[;]|,(?!\s*\d+\s*in\b)|\.(?!\d)|\band then\b|\bthen\b|\bafter that\b|\bokay\b|\bok\b)\s*/)) {
    // the step words stand alone
    const bits = part.split(/\b(next(?: wall| one)?|skip(?: it| that| this one| this wall)?(?=$|\s*(?:next|\d))|go back|back up|previous(?: wall)?|undo|redo|scratch that)\b/);
    for (const b of bits) if (strip(b)) out.push(strip(b));
  }
  return out;
}

export interface Ctx {
  rooms: string[];
  tab: 'plan' | 'list';
}

export function parseUtterance(raw: string, ctx: Ctx): Cmd[] {
  const s0 = normalize(raw).replace(/^(hey plumb|plumb|okay plumb|ok plumb)[, ]*/, '');
  if (!s0) return [];
  // a list of things to buy: the whole breath is items
  const add = s0.match(ADD_VERB);
  if (add && !/^(a |an |one |another )?(new |prehung )?(door|doors|window|windows|opening|doorway|cased opening|room)\b/.test(add[2]) && !(add[1] === 'put' && /\b(door|window)\b/.test(add[2]))) {
    const items = parseItems(add[2]);
    return items.length ? [{ k: 'add', items }] : [{ k: 'unknown', raw }];
  }
  const out: Cmd[] = [];
  for (const c0 of clauses(s0)) out.push(...parseClause(c0, ctx, raw));
  return out;
}

function parseClause(c0: string, ctx: Ctx, raw: string): Cmd[] {
  const c = c0.replace(/^(and|so|um|uh|alright|all right|now|yeah|yep)\s+/, '').trim();
  if (!c) return [];
  if (/^(next|next wall|next one|skip|skip it|skip that|skip this one)$/.test(c)) return [{ k: 'next' }];
  if (/^(go back|back up|back|previous|previous wall|last one)$/.test(c)) return [{ k: 'back' }];
  if (/^(undo|scratch that|undo that|never mind|nevermind|cancel that|delete that)$/.test(c)) return [{ k: 'undo' }];
  if (/^redo$/.test(c)) return [{ k: 'redo' }];
  if (/^(stop|stop listening|done|i'm done|im done|that's it|thats it|that's all|thats all|finish|finished|quiet|shut up|bye)$/.test(c)) return [{ k: 'stop' }];
  if (/^(yes|yeah|yep|keep it|keep|that's right|thats right|correct|right|it's right|its right|it is right|confirmed?|good)$/.test(c)) return [{ k: 'keep' }];
  if (/^(help|what can i say|what do i say|commands)$/.test(c)) return [{ k: 'help' }];
  if (/^(read (it |that )?back|status|what's left|whats left|where are we|how many (are )?left|how many walls( left)?|what('s| is) next)$/.test(c)) return [{ k: 'status' }];
  if (/^(show |open |go to )?(the )?(shopping )?list$/.test(c)) return [{ k: 'tab', tab: 'list' }];
  if (/^(show |open |go to )?(the )?(plan|drawing|sketch|map)$/.test(c)) return [{ k: 'tab', tab: 'plan' }];

  // corrections: "no, 12 foot", "I meant 12 6", "make that 11 4"
  let m = c.match(/^(no|nope|nah|wrong|not that|i mean|i meant|actually|make it|make that|change it to|change that to|correction|sorry|oops|should be|it should be|that should be|it's actually)\b[, ]*(.*)$/);
  if (m) {
    const v = spokenLength(m[2]);
    if (v != null) return [{ k: 'fix', inches: v, raw: m[2] }];
    if (!m[2]) return [{ k: 'undo' }];
  }

  m = c.match(GOT_VERB);
  if (m && m[2] && !/\d+ (ft|in)\b/.test(m[2])) return [{ k: 'got', what: m[2] }];
  m = c.match(REMOVE_VERB);
  if (m && m[1]) return [{ k: 'remove', what: m[1] }];

  // new room: "new room kitchen 12 by 14"
  m = c.match(/^(?:new|add(?: a)?|another|make(?: a)?)\s+room\b\s*(?:called |named )?(.*)$/);
  if (m) {
    const dims = m[1].match(/(.*?)\s*(\d[\d\s/.]*(?:ft|in)?(?:\s*\d[\d\s/]*(?:in)?)?)\s*(?:by|x)\s*(\d[\d\s/.]*(?:ft|in)?(?:\s*\d[\d\s/]*(?:in)?)?)\s*$/);
    if (dims) {
      const L = spokenLength(dims[2]),
        W = spokenLength(dims[3]);
      const nm = strip(dims[1]);
      return [{ k: 'newroom', name: nm ? nm.replace(/\b\w/g, (x) => x.toUpperCase()) : undefined, L: L ?? undefined, W: W ?? undefined }];
    }
    const nm = strip(m[1]);
    return [{ k: 'newroom', name: nm ? nm.replace(/\b\w/g, (x) => x.toUpperCase()) : undefined }];
  }

  // a room by name, with or without more after it
  const ra = roomAt(c, ctx.rooms);
  let rest = ra.rest;
  const room = ra.room;
  const wr = wallRef(rest);
  rest = strip(wr.rest.replace(/^(is|at|wall)\b/, ''));

  if (/^(measure|start measuring|let's measure|lets measure|start|begin|measure (it|this|the room|everything|the rest))$/.test(rest)) return [{ k: 'measure', room }];

  // doors and windows: "door", "32 door", "door 30", "window 36 by 48", "new prehung door"
  m = rest.match(/^(?:add |put |there's |theres |there is |with |and )?(?:a |an |one )?(new |prehung |pre hung )?(?:(\d+(?:\.\d+)?)\s*(?:in |ft )?)?(door|doorway|cased opening|opening|window|closet door|slider|sliding door|patio door|french door)s?\b\s*(?:(?:is |at )?(\d+(?:\.\d+)?)\s*(?:in|ft)?)?(?:\s*(?:by|x)\s*(\d+(?:\.\d+)?)\s*(?:in|ft)?)?\s*(here|on (this|that|the) wall|too)?$/);
  if (m) {
    const word = m[3];
    const type = /window/.test(word) ? 'window' : /opening|doorway/.test(word) ? 'opening' : 'door';
    let w = m[2] ? parseFloat(m[2]) : m[4] ? parseFloat(m[4]) : undefined;
    let h = m[5] ? parseFloat(m[5]) : undefined;
    // "3 foot door" comes through as 3: that's feet
    if (w != null && w <= 8) w *= 12;
    if (h != null && h <= 9) h *= 12;
    const sliding = /slider|sliding|patio|french/.test(word);
    return [{ k: 'opening', type, widthIn: w ?? (sliding ? 72 : undefined), heightIn: h, newDoor: !!m[1], room, wall: wr.ref }];
  }

  if (/^(no base|no baseboard|skip base|skip the base|no trim here|cabinets?( here)?|tub( here)?|vanity( here)?|fridge( here)?|built ?ins?( here)?|no base (on|here|on this wall))$/.test(rest)) return [{ k: 'nobase', on: true }];
  if (/^(base (here|back|on)|put base back|baseboard back|yes base)$/.test(rest)) return [{ k: 'nobase', on: false }];

  // what goes in a room
  const sc: [RegExp, Extract<Cmd, { k: 'scope' }>['what'], boolean][] = [
    [/^(lvp|vinyl( plank)?( floor(ing)?)?|luxury vinyl|plank floor(ing)?|floor(ing)? (is )?lvp|new floor(ing)?|lvp floor(ing)?)$/, 'lvp', true],
    [/^(tile|tile floor(ing)?|floor(ing)? (is )?tile|tiling)$/, 'tile', true],
    [/^(no floor(ing)?|no new floor(ing)?|skip (the )?floor(ing)?)$/, 'nofloor', true],
    [/^(shoe|shoe molding|shoe moulding|quarter round|add shoe)$/, 'shoe', true],
    [/^(no shoe|no quarter round)$/, 'shoe', false],
    [/^(crown|crown molding|crown moulding|add crown)$/, 'crown', true],
    [/^(no crown)$/, 'crown', false],
    [/^(baseboard|base|add base(board)?)$/, 'base', true],
    [/^(no base(board)? in (here|this room)|no base(board)? (at all|anywhere))$/, 'nobaseroom', true],
    [/^(paint (the )?walls|paint walls|walls (get )?paint(ed)?|painting (the )?walls)$/, 'paintWalls', true],
    [/^(paint (the )?ceiling|ceiling (gets )?paint(ed)?)$/, 'paintCeiling', true],
    [/^(no paint|don't paint|dont paint)$/, 'paintWalls', false],
  ];
  for (const [re, what, on] of sc) if (re.test(rest)) return [{ k: 'scope', what, on, room }];

  const v = spokenLength(rest);
  if (v != null) return [{ k: 'length', inches: v, room, wall: wr.ref, raw: rest }];
  if (room && !rest) return [{ k: 'select', room, wall: wr.ref }];
  if (wr.ref && !rest) return [{ k: 'select', room: room ?? '', wall: wr.ref }];

  // on the list, anything else you say goes on it
  if (ctx.tab === 'list') {
    const items = parseItems(c);
    if (items.length) return [{ k: 'add', items }];
  }
  return [{ k: 'unknown', raw: c0 || raw }];
}

/** 150.5 → "12 foot 6 and a half", for reading a length out loud */
export function sayLength(inches: number): string {
  const t = Math.round(inches * 8) / 8;
  let ft = Math.floor(t / 12);
  let inch = t - ft * 12;
  let whole = Math.floor(inch + 1e-9);
  const f = inch - whole;
  const fw = f < 0.06 ? '' : f < 0.19 ? ' and an eighth' : f < 0.31 ? ' and a quarter' : f < 0.44 ? ' and 3 eighths' : f < 0.56 ? ' and a half' : f < 0.69 ? ' and 5 eighths' : f < 0.81 ? ' and 3 quarters' : f < 0.94 ? ' and 7 eighths' : '';
  if (f >= 0.94) whole += 1;
  if (whole === 12) {
    ft += 1;
    whole = 0;
  }
  inch = whole;
  if (!ft) return `${inch}${fw} inches`;
  if (!inch && !fw) return `${ft} foot even`;
  return `${ft} foot ${inch}${fw}`;
}
