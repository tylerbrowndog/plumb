# Plumb

Sketch the job on your phone, tap each wall and type the tape, and walk into the store with the exact list.

Plumb is a phone-first web app for contractors. It turns a finger sketch into a measured floor plan and a store-ready materials list for trim, doors, LVP, tile and paint.

## What it does

- **Sketch:** freehand strokes snap to straight lines and 90° or 45° corners. Rooms attach at shared corners. Undo, redo, pan, pinch zoom.
- **Measure:** tap a wall and type feet and inches on a tape-style keypad. The first length sets the scale; shared walls fill in for both rooms.
- **Openings:** doors, windows and cased openings sit on walls, with sizes and an option to buy a new prehung door.
- **Trim:** baseboard, shoe, crown and casing in real stick lengths, a first-fit cut list per stick, copes and miters, caulk, brads, filler and trim paint.
- **Floors and tile:** LVP boxes with waste, underlayment, transition strips, tile boxes, thinset, grout by joint size, cement board, clips or spacers.
- **Paint:** walls (doors and windows removed) and ceilings, in quarts, gallons and 5-gallon buckets.
- **Lists:** grouped by trade, checkable, and shareable by copy or text. A don't-forget list changes with the job.

## Privacy

No account, no server, no analytics, no AI. Jobs are stored in the browser's local storage on the device. Users can back up or export a job to a file, import it again (imports are validated), and erase everything from the job menu. When hosted, `vercel.json` sends a strict Content-Security-Policy that blocks all outside requests.

## Develop

Requires Node 22 or newer.

```sh
npm install
npm run dev      # local dev server
npm run check    # type-check
npm run build    # production build into dist/
```

The build also generates the app icons into `public/`.

### Tests

The walk-through and estimate checks run headless with jsdom:

```sh
npm install --no-save jsdom@25.0.1
npx tsx e2e/run.tsx     # drives the UI at phone size
npx tsx e2e/scopes.ts   # prints the flooring, tile, paint and door estimate for the sample job
```

## Deploy

Vercel picks it up as a Vite project with no settings: build command `npm run build`, output directory `dist`.
