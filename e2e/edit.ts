// Checks for line editing. Run: npx tsx e2e/edit.ts
import { alignWallOffset, closeRun, deleteCorner, deleteWall, moveRoom, moveWall, roomDragOffset, splitWall } from '../src/edit.ts';
import type { Job } from '../src/types.ts';
import { applyMeasurement } from '../src/measure.ts';
import { squareUp } from '../src/geometry.ts';

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(c ? '✓' : '✗', m);
  if (!c) fails++;
};
const base = (): Job =>
  ({
    id: 'j',
    name: 'j',
    createdAt: 0,
    updatedAt: 0,
    inPerUnit: 1,
    scaleSet: true,
    rooms: [
      {
        id: 'r',
        name: 'Room',
        closed: true,
        base: true,
        shoe: false,
        crown: false,
        pts: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }],
        walls: [{ lengthIn: 120 }, { lengthIn: 96 }, { lengthIn: 120, predicted: true }, { noBase: true }],
      },
    ],
    openings: [
      { id: 'd', room: 'r', wall: 2, t: 0.25, type: 'door', widthIn: 30, heightIn: 80, bothSides: true },
      { id: 'w', room: 'r', wall: 0, t: 0.5, type: 'window', widthIn: 36, heightIn: 48, bothSides: false },
    ],
  }) as unknown as Job;

// delete the top wall of a closed room: it opens there, the window on it goes
{
  const j = deleteWall(base(), 'r', 0);
  const r = j.rooms[0];
  ok(!r.closed && r.pts.length === 4 && r.walls.length === 3, 'closed room opens into a 3-wall run');
  ok(r.pts[0].x === 120 && r.pts[0].y === 0 && r.pts[3].x === 0 && r.pts[3].y === 0, 'run starts after the deleted wall');
  ok(!j.openings.some((o) => o.id === 'w'), 'window on the deleted wall is gone');
  const d = j.openings.find((o) => o.id === 'd')!;
  ok(d.wall === 1 && Math.abs(d.t - 0.25) < 1e-6, 'door stays put on the bottom wall (now wall 1)');
  ok(r.walls[2].noBase === true, 'no-baseboard flag follows its wall');
}
// delete a middle wall of the run: splits in two
{
  let j = deleteWall(base(), 'r', 0);
  j = deleteWall(j, 'r', 1);
  ok(j.rooms.length === 2 && j.rooms.every((r) => !r.closed && r.pts.length === 2), 'middle wall of a run splits it into two runs');
  ok(j.openings.length === 0, 'door on the deleted middle wall is gone');
}
// add a corner, then take it back out
{
  const j1 = splitWall(base(), 'r', 2);
  const r1 = j1.rooms[0];
  ok(r1.pts.length === 5 && r1.walls.length === 5, 'add corner makes five walls');
  ok(r1.pts[3].x === 60 && r1.pts[3].y === 96, 'corner sits mid-line');
  const d1 = j1.openings.find((o) => o.id === 'd')!;
  ok(d1.wall === 2 && Math.abs(d1.t - 0.5) < 1e-6, 'door lands on the first half at the same spot');
  ok(r1.walls[4].noBase === true, 'later walls keep their flags');
  const j2 = deleteCorner(j1, 'r', 3);
  ok(j2.rooms[0].pts.length === 4, 'delete corner merges back to four walls');
  const d2 = j2.openings.find((o) => o.id === 'd')!;
  ok(d2.wall === 2 && Math.abs(d2.t - 0.25) < 1e-6, 'door is back where it was');
}
// delete corner 0 of a closed room
{
  const j5 = { ...base(), rooms: [{ ...base().rooms[0], pts: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }], walls: [{}, {}, {}, {}, { noBase: true }] }], openings: [] } as Job;
  const j = deleteCorner(j5, 'r', 0);
  const r = j.rooms[0];
  ok(r.pts.length === 4 && r.walls[3].noBase !== true && r.walls[2].noBase === undefined, 'deleting corner 0 merges the last and first walls');
  ok(r.pts[3].x === 0 && r.pts[3].y === 96, 'points shift right');
}
// slide the right wall out 12"
{
  const j = moveWall(base(), 'r', 1, -12);
  const r = j.rooms[0];
  ok(r.pts[1].x === 132 && r.pts[2].x === 132, 'right wall slides out');
  ok(r.walls[2].lengthIn === undefined && r.walls[0].lengthIn === 120, 'worked-out length clears, taped one stays');
}
// move a whole room
{
  const j = moveRoom(base(), 'r', 24, 12);
  ok(j.rooms[0].pts[0].x === 24 && j.rooms[0].pts[2].y === 108, 'room slides as one piece');
  ok(j.openings.length === 2 && j.rooms[0].walls[0].lengthIn === 120, 'doors, windows and tape lengths ride along');
  const two = { ...base(), rooms: [...base().rooms, { ...base().rooms[0], id: 'r2', pts: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 96 }, { x: 200, y: 96 }] }] } as Job;
  const o = roomDragOffset(two, 'r2', { x: -77, y: 1 }, 6);
  ok(o.x === -80 && o.y === 0, 'a room snaps onto the corner of the room next to it');
}
// close an open run back into a room
{
  const open = deleteWall(base(), 'r', 0);
  const j = closeRun(open, 'r');
  ok(j.rooms[0].closed && j.rooms[0].walls.length === 4 && j.rooms[0].pts.length === 4, 'open run closes into a four-wall room');
}
// slide a wall until it lines up with another corner
{
  const two = { ...base(), rooms: [...base().rooms, { ...base().rooms[0], id: 'r2', pts: [{ x: 130, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 300 }, { x: 130, y: 300 }] }] } as Job;
  const d = alignWallOffset(two, two.rooms[0], 1, -8, 4);
  ok(Math.abs(d - -10) < 1e-6, 'slid wall lines up with the other room');
}
// a closet in an L's notch stays in the notch when the L is measured
{
  const mk = (id: string, pts: { x: number; y: number }[]) => ({ id, name: id, pts, closed: true, walls: pts.map(() => ({})) });
  const L = mk('L', [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 66 }, { x: 144, y: 66 }, { x: 144, y: 168 }, { x: 0, y: 168 }]);
  const C = mk('C', [{ x: 90, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 66 }, { x: 90, y: 66 }]);
  const j0 = { ...base(), rooms: [L, C], openings: [], inPerUnit: 1 } as unknown as Job;
  const j = applyMeasurement(j0, 'L', 1, 48);
  const c = j.rooms.find((r) => r.id === 'C')!;
  ok(c.pts[0].y === 0 && c.pts[2].y === 48 && c.pts[3].y === 48, 'closet keeps its top and follows the shorter notch');
  ok(c.walls[3].lengthIn === 48 && c.walls[1].lengthIn === 48, 'closet takes the shared length and works out its other side');
}
// rooms drawn side by side come out square and lined up, and a hall under both narrows with the room above it
{
  const anchors = [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 84 }, { x: 0, y: 84 }];
  const sq = squareUp([{ x: 72, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 90 }, { x: 72, y: 90 }], true, anchors, 1)!;
  ok(sq[2].y === 84 && sq[3].y === 84 && sq[2].x === 144, 'second room squares onto the first');
  const mk = (id: string, pts: { x: number; y: number }[]) => ({ id, name: id, pts, closed: true, walls: pts.map(() => ({})) });
  const A = mk('A', [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 84 }, { x: 0, y: 84 }]);
  const B = mk('B', [{ x: 72, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 84 }, { x: 72, y: 84 }]);
  const H = mk('H', [{ x: 0, y: 84 }, { x: 144, y: 84 }, { x: 144, y: 132 }, { x: 0, y: 132 }]);
  const j0 = { ...base(), rooms: [A, B, H], openings: [], inPerUnit: 1 } as unknown as Job;
  const j = applyMeasurement(j0, 'B', 0, 60);
  const a = j.rooms.find((r) => r.id === 'A')!,
    h = j.rooms.find((r) => r.id === 'H')!;
  ok(a.pts[1].x === 72 && a.pts[2].x === 72, 'the room beside it stays put');
  ok(h.pts[0].x === 0 && h.pts[1].x === 132 && h.pts[2].x === 132, 'the hall under both narrows with it');
}
console.log(fails ? `${fails} failed` : 'all good');
process.exit(fails ? 1 : 0);
