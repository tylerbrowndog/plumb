// Unit check of the flooring / tile / paint / door estimate. Run: npx tsx e2e/scopes.ts
import { sampleJob } from '../src/store';
import { estimate, paintPack } from '../src/estimate';
const g = globalThis as any;
g.crypto ??= { randomUUID: () => Math.random().toString(36) };
const j = sampleJob();
j.rooms[0].floor = 'lvp';
j.rooms[0].paintWalls = true;
j.rooms[0].paintCeiling = true;
j.rooms[1].floor = 'tile';
j.openings[0].newDoor = true;
const e = estimate(j);
console.log('lvp', e.lvpSqft.toFixed(1), 'tile', e.tileSqft.toFixed(1), 'walls', e.wallSqft.toFixed(1), 'ceil', e.ceilingSqft.toFixed(1), 'doors', e.newDoors, e.scopes);
for (const it of e.items) console.log(`[${it.group}] ${it.name}: ${it.qty}${it.note ? '  (' + it.note + ')' : ''}`);
console.log([0.3, 1.2, 3.1, 4.2, 7, 9.5, 12].map((x) => `${x}→${paintPack(x)}`).join(' | '));
