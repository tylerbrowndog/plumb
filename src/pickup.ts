// Leaving the job to pick something up: what aisle it's in, and the store's own page to see if it's in stock.
export type Dept = 'Lumber and millwork' | 'Building materials' | 'Flooring' | 'Paint' | 'Hardware' | 'Tools' | 'Safety and cleanup' | 'Other';
export const DEPT_ORDER: Dept[] = ['Lumber and millwork', 'Building materials', 'Flooring', 'Paint', 'Hardware', 'Tools', 'Safety and cleanup', 'Other'];

const BY_KEY: Record<string, Dept> = {
  caulk: 'Paint', tape: 'Paint', paint: 'Paint', primer: 'Paint', sand: 'Paint', filler: 'Paint',
  'nails-2': 'Hardware', 'nails-114': 'Hardware', glue: 'Hardware',
  'door-hw': 'Hardware', 'door-stop': 'Hardware', 'door-screws': 'Hardware', 'door-shims': 'Lumber and millwork',
  lvp: 'Flooring', 'lvp-pad': 'Flooring', transition: 'Flooring',
  tile: 'Flooring', thinset: 'Flooring', grout: 'Flooring', clips: 'Flooring', spacers: 'Flooring', sealer: 'Flooring', mesh: 'Flooring',
  backer: 'Building materials', 'backer-screws': 'Hardware',
  'wall-paint': 'Paint', 'ceil-paint': 'Paint', pva: 'Paint', roller: 'Paint', liners: 'Paint', patch: 'Paint', 'wall-tape': 'Paint',
};

const WORDS: [RegExp, Dept][] = [
  [/caulk|paint|primer|tape|roller|brush|spackle|filler|putty|sandpaper|sanding|sponge|drop cloth|tarp|stain|poly(urethane)?|mud|tray|liner|rag/, 'Paint'],
  [/tile|grout|thinset|mortar|lvp|vinyl|laminate|floor|underlayment|transition|threshold|reducer|t-mold|spacer|leveling clip/, 'Flooring'],
  [/drywall|sheetrock|cement board|backer|insulation|joint compound|corner bead|concrete|plaster/, 'Building materials'],
  [/nail|screw|brad|staple|hinge|knob|lever|handle|bolt|anchor|washer|nut|glue|adhesive|liquid nails|door stop|strike|hook|bracket/, 'Hardware'],
  [/blade|bit|battery|batteries|knife|saw|drill|level|square|pencil|chalk|clamp|nailer|compressor|hose|oil|cord|light|trowel|float|bucket|paddle|ladder/, 'Tools'],
  [/glove|mask|respirator|glasses|goggles|ear|knee|trash|bag|broom|vac|wipe|towel|paper|plastic sheet|poly sheet/, 'Safety and cleanup'],
  [/shim|board|lumber|2x|1x|plywood|mdf|trim|casing|base|molding|moulding|shoe|quarter round|crown|stool|apron|jamb|door|stop/, 'Lumber and millwork'],
];

export function deptFor(name: string, key?: string): Dept {
  if (key && BY_KEY[key]) return BY_KEY[key];
  if (key?.startsWith('trim-') || key?.startsWith('door-')) return 'Lumber and millwork';
  const n = name.replace(/\(.*?\)/g, ' ').toLowerCase();
  for (const [re, d] of WORDS) if (re.test(n)) return d;
  return 'Other';
}

export type Store = 'homedepot' | 'lowes';
export const STORES: { id: Store; name: string }[] = [
  { id: 'homedepot', name: 'Home Depot' },
  { id: 'lowes', name: "Lowe's" },
];

/** what to type in the store's search box: the plain product, without our notes */
export function searchTerm(name: string): string {
  return name
    .replace(/\(.*?\)/g, ' ')
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(/⅛/g, ' 1/8').replace(/⅜/g, ' 3/8').replace(/⅝/g, ' 5/8').replace(/⅞/g, ' 7/8').replace(/⅓/g, ' 1/3')
    .replace(/(\d)\s*"/g, '$1 in.')
    .replace(/(\d)\s*'/g, '$1 ft.')
    .replace(/[×]/g, 'x')
    .replace(/\s*\/\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** the store's own search page; it shows price and stock once you pick your store there */
export function storeSearch(store: Store, name: string): string {
  const q = encodeURIComponent(searchTerm(name));
  return store === 'lowes' ? `https://www.lowes.com/search?searchTerm=${q}` : `https://www.homedepot.com/s/${q}`;
}

const isApple = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in (typeof document !== 'undefined' ? document : {});

/** the phone's maps app finds the nearest one with its own location; Plumb never asks for it */
export function nearMe(what: string): string {
  const q = encodeURIComponent(what);
  return isApple() ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

const KEY = 'plumb.store.v1';
export function loadStore(): Store {
  try {
    return localStorage.getItem(KEY) === 'lowes' ? 'lowes' : 'homedepot';
  } catch {
    return 'homedepot';
  }
}
export function saveStore(s: Store) {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* private mode */
  }
}
