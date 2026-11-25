/** Parse a tape-measure style length into inches.
 * Accepts: 12' 6"  12'6  12-6  12 6  150 in  150"  12.5'  12' 6 1/2"  6 1/2"  150  (bare number = inches if it has a decimal-less value >= 20? no: bare = feet unless "in")
 */
/** longest wall we accept: 200 feet */
export const MAX_LEN_IN = 2400;

export function parseLength(raw: string): number | null {
  if (raw.length > 32) return null;
  const v = parseLengthRaw(raw);
  return v !== null && Number.isFinite(v) && v > 0 && v <= MAX_LEN_IN ? v : null;
}

function parseLengthRaw(raw: string): number | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s
    .replace(/feet|foot|ft/g, "'")
    .replace(/inches|inch|in/g, '"')
    .replace(/[’′]/g, "'")
    .replace(/[”″]/g, '"')
    .replace(/\s+/g, ' ');

  const frac = (t: string): number | null => {
    t = t.trim();
    if (!t) return 0;
    // "6 1/2", "6-1/2", "1/2", "6.5"
    const m = t.match(/^(\d+(?:\.\d+)?)?(?:[ -]?(\d+)\/(\d+))?$/);
    if (!m) return null;
    const whole = m[1] ? parseFloat(m[1]) : 0;
    const f = m[2] && m[3] ? parseInt(m[2]) / parseInt(m[3]) : 0;
    if (!m[1] && !m[2]) return null;
    return whole + f;
  };

  // feet and inches: 12' 6 1/2"
  let m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(.*?)\s*"?$/);
  if (m) {
    const ft = parseFloat(m[1]);
    const inch = frac(m[2]);
    if (inch === null) return null;
    return ft * 12 + inch;
  }
  // inches only: 150"  6 1/2"
  m = s.match(/^(.*?)\s*"$/);
  if (m) {
    const v = frac(m[1]);
    return v === null ? null : v;
  }
  // 12-6  or 12-6 1/2 (feet-inches)
  m = s.match(/^(\d+)-(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)$/);
  if (m) {
    const inch = frac(m[2]);
    if (inch === null) return null;
    return parseInt(m[1]) * 12 + inch;
  }
  // 12 6  or 12 6 1/2  (feet inches)
  m = s.match(/^(\d+)\s+(\d+(?:\.\d+)?)(\s+\d+\/\d+)?$/);
  if (m) {
    const inch = frac(m[2] + (m[3] || ''));
    if (inch === null) return null;
    return parseInt(m[1]) * 12 + inch;
  }
  // bare number: small = feet (12 -> 12'), big = inches (150 -> 150")
  const v = frac(s);
  if (v === null) return null;
  return v >= 40 ? v : v * 12;
}

const FRACS: [number, string][] = [
  [0, ''],
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
  [1, ''],
];

/** 150.5 -> 12' 6½" (rounded to nearest 1/8") */
export function fmtFtIn(inches: number, opts: { short?: boolean } = {}): string {
  if (!isFinite(inches)) return '—';
  const neg = inches < 0;
  let total = Math.round(Math.abs(inches) * 8) / 8;
  let ft = Math.floor(total / 12);
  let inch = total - ft * 12;
  let whole = Math.floor(inch + 1e-9);
  let f = inch - whole;
  let fi = FRACS.reduce((best, cur) => (Math.abs(cur[0] - f) < Math.abs(best[0] - f) ? cur : best));
  if (fi[0] === 1) {
    whole += 1;
    fi = FRACS[0];
  }
  if (whole === 12) {
    ft += 1;
    whole = 0;
  }
  const inStr = `${whole}${fi[1]}"`;
  const out = ft > 0 ? (opts.short && whole === 0 && !fi[1] ? `${ft}'` : `${ft}' ${inStr}`) : inStr;
  return (neg ? '-' : '') + out;
}

/** inches -> "12.5 ft" style linear feet */
export function fmtLF(inches: number): string {
  const ft = inches / 12;
  return `${ft < 10 ? ft.toFixed(1) : Math.round(ft)} LF`;
}

export function fmtIn(inches: number): string {
  return fmtFtIn(inches).replace(/^0' /, '');
}
