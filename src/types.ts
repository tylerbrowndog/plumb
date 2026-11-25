export type Pt = { x: number; y: number };

export type OpeningType = 'door' | 'window' | 'opening';

export interface Opening {
  id: string;
  room: string;
  wall: number;
  /** position along the wall, 0..1 (center of the opening) */
  t: number;
  type: OpeningType;
  widthIn: number;
  heightIn: number;
  /** case both sides of a door / cased opening */
  bothSides: boolean;
  /** buying a new prehung door for this opening */
  newDoor?: boolean;
}

export interface Wall {
  /** a typed, verified real-world length. Unset = estimated from the drawing */
  lengthIn?: number;
  /** no baseboard on this wall (cabinets, tub, etc) */
  noBase?: boolean;
}

export interface Room {
  id: string;
  name: string;
  pts: Pt[];
  walls: Wall[];
  closed: boolean;
  base: boolean;
  shoe: boolean;
  crown: boolean;
  /** new floor going in */
  floor?: FloorType;
  /** paint the walls / ceiling of this room */
  paintWalls?: boolean;
  paintCeiling?: boolean;
  /** ceiling height override (inches) */
  heightIn?: number;
}

export type FloorType = 'none' | 'lvp' | 'tile';

export interface Settings {
  wastePct: number;
  baseStickFt: number;
  casingStickFt: number;
  shoeStickFt: number;
  crownStickFt: number;
  baseHeightIn: number;
  casingWidthIn: number;
  doorWidthIn: number;
  doorHeightIn: number;
  windowWidthIn: number;
  windowHeightIn: number;
  windowCasing: boolean;
  cutAllowanceIn: number;
  caulkFtPerTube: number;
  paint: boolean;
  primed: boolean;
  coats: number;
  // walls + ceilings
  ceilingIn: number;
  wallCoats: number;
  newDrywall: boolean;
  // flooring
  lvpBoxSqft: number;
  floorWastePct: number;
  padAttached: boolean;
  // tile
  tileWIn: number;
  tileLIn: number;
  tileBoxSqft: number;
  tileWastePct: number;
  groutJointIn: number;
  backer: boolean;
}

export interface Job {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  rooms: Room[];
  openings: Opening[];
  /** real inches per drawing unit */
  inPerUnit: number;
  scaleSet: boolean;
  settings: Settings;
  /** checked-off shopping / don't-forget items */
  checks: Record<string, boolean>;
  notes: string;
}

export type Selection =
  | { kind: 'room'; room: string }
  | { kind: 'wall'; room: string; wall: number }
  | { kind: 'opening'; id: string }
  | null;

export type Tool = 'select' | 'draw' | 'rect' | 'door' | 'window';
