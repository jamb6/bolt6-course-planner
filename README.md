# Bolt6 Course Planner

Camera and cable planning for live golf broadcast. Pick a course, build a plan
on satellite imagery, and export the per-hole rigging breakdown the crew takes
out onto the course.

## Deploying

`npm run build` gives you a static `dist/` — no server. `DEPLOY.md` covers
putting it on Cloudflare Pages with the Mapbox token locked to your domain and
Supabase told about the new URL. About twenty minutes.

`tests/prodcheck.mjs` smoke-tests the real shipped bundle, as opposed to the
stubbed one the other suites use.

## Where the data lives

By default, `localStorage` — one browser, one machine, nothing shared.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and it switches to a
shared Postgres workspace instead: the same courses, plans and kits for
everyone signed in. `supabase/schema.sql` and `SETUP-SUPABASE.md` cover that,
and it takes about fifteen minutes.

Both are the same interface — `src/lib/db/` picks a driver at build time and
nothing else in the app knows which one it got.

Entities are written **one at a time** rather than as a whole plan document, so
two people working the same event do not overwrite each other. You see their
changes when you reopen a plan or press Refresh, not live.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

You need a Mapbox **public** token (starts with `pk.`). The app asks for one on
first run and keeps it in `localStorage`. To skip that, copy `.env.example` to
`.env` and set `VITE_MAPBOX_TOKEN`.

It must be served over HTTP — `npm run dev` handles that. Opening a built
`index.html` straight off disk will not work, because Mapbox GL JS cannot start
its workers from a `file://` origin.

## How it fits together

Four screens, in order. `App.jsx` picks between them based on what has been
chosen; there is no router.

```
token  →  course  →  plan  →  map
```

```
src/
  App.jsx                  which screen to show
  main.jsx                 mounts React
  styles.css               all the CSS, one file

  data/
    lpgaCourses.js         2027 LPGA schedule — plain data, edit freely
    constants.js           camera/cable/marker types, colours, tunables

  lib/
    geo.js                 Vincenty distance, bearing, bounds
    db/
      index.js             the only storage the app sees: cached reads, async writes
      local.js             localStorage driver
      supabase.js          shared Postgres driver + auth
    osm.js                 hole layouts from OpenStreetMap
    geocode.js             Mapbox geocoding, for placing a course
    cameraNumber.js        the numbering rule and the h01-g03 positions
    kits.js                kit model and the "7, 23, 41-44" parser
    exportPlan.js          rigging breakdown + CSV

  store/
    useStore.js            all app state, one Zustand store

  screens/
    TokenGate.jsx          asks for the Mapbox token
    AuthGate.jsx           sign-in, only when a shared workspace is configured
    Settings.jsx           kits: sizes and what is broken or missing
    CoursePicker.jsx       course list, search, add
    AddCourse.jsx          name it, find it on the map
    PlanPicker.jsx         plans for a course: open/copy/share/delete
    Planner.jsx            the map screen — composes the overlays

  map/
    MapView.jsx            owns the Mapbox instance, draws from the store
    layers.js              source and layer definitions
    icons.js               marker and switch shapes, drawn on a canvas
    useMapInteractions.js  clicking, dragging, cable drawing, WASD

  components/
    HoleSelector.jsx       bottom: all 18 holes, dimmed until worked on
    LayoutBar.jsx          course setup: tap the tee, tap the green
    BuildToolbar.jsx       bottom-centre: camera / connections / markers
    StatsBar.jsx           kit counts, scoped to the course or one hole
    NoteTooltip.jsx        the note that pops up on hover
    EntityPanel.jsx        right-hand panel for whatever is selected
    MenuSheet.jsx          top-right: save, export, switch plan
```

Nothing does two jobs. To change how something is drawn, open `map/layers.js`.
To change what an entity holds, open `store/useStore.js`. To change where it is
saved, open `lib/storage.js` and nothing else.

## Using it

**Placing things.** Click a tool, then click the map. The tool stays armed, so
three cameras on a hole is three clicks. `Esc` puts the tool away. Only one
tool is ever active — arming the camera closes Connections and Markers, and
vice versa.

**Holes.** All 18 sit along the bottom under the build tools. A hole with no
cameras on it is dimmed, so what is left to do reads at a glance. `All` zooms
back out to the whole course.

**Cameras** are one colour whatever they are mounted on; the small letter next
to each one says which — `T` tripod, `L` LED board, `▲` tower, `H`
hospitality. (Tower is a triangle rather than a T because tripod already owns
that letter.)

Each camera carries **two identifiers, and they are not the same thing**:

- **Position** — where it stands, numbered clockwise from the left of the
  green: `g01` left, `g02` middle, `g03` right, written with the hole as
  `h01-g03`. This is the spot on the course. It shows under the marker on the
  map and is what the camera is named by in the panel and the export.
- **Camera number** — the physical unit, three to a hole: hole 1 owns 1–3,
  hole 2 owns 4–6, up to hole 18 owning 52–54, with whatever is left over
  spare for a fourth camera somewhere. This is the box you pick up, and it
  comes from the plan's kit. It shows inside the marker dot.

Both are auto-assigned when you place a camera and both are editable, and
changing one never touches the other — swap the kit on a position and the
position keeps its name. The panel warns separately if a camera number is used
twice or if two cameras claim the same position on a hole.

**Both are required.** A camera has to sit on a hole and hold one of that
hole's three positions, because the camera plan is a grid of hole × position
and anything outside it cannot appear. So the app refuses to place a camera
while the course view is on, and refuses a fourth camera on a hole, saying why
in each case rather than creating something the export would quietly drop.

**Cables.** Under Connections, picking Cat6 or Fibre arms the cable ready to
place — the type *is* the button. Left-click each point; a point dropped within
14 px of a camera, switch or another cable's end pins to it. Right-click or
`Enter` finishes the run, `Esc` throws it away.

**Editing a cable.** Select it and press *Edit points*. Every point becomes a
draggable handle — filled if it is pinned to something, hollow if it is free.
Grabbing a pinned handle unpins it immediately and moves only the cable, never
the camera or switch underneath. Drop a handle on a node to pin it there, and
right-click a handle to drop that point.

Two more things in edit mode: **click the run itself** to drop a new joint in
where you clicked, ready to drag, and use the **large (+) above either end** to
carry the run on from there — click to place each further point, right-click or
`Enter` to stop. Length updates throughout.

**Pinned points follow.** Move a camera or switch and every cable point pinned
to it comes along, so the segment stretches and swings to keep up and the run
re-measures itself. Delete the node and the points quietly unpin rather than
leaving a dangling reference.

**Editing anything else.** Click it to open its panel. Drag a camera, switch or
marker to move it, or use the Move button and click where it should go.

**Notes** go on anything. An entity carrying one gets a ✎ badge, sitting below
the type badge so the type reads first, and hovering it pops the note up beside
the cursor — so you can read what is on a hole without opening each item. Works
on cables too.

**Markers** are drawn shapes rather than coloured dots: a pennant, a hazard
triangle, a lightning bolt, an info disc. They are painted on a canvas at load
in `map/icons.js` and registered as Mapbox images, so adding one is a draw
function, not an asset file.

**Kit counts.** The whole plan's totals sit beside the plan name, top right.
The build bar carries the same figures for whichever hole is selected, so you
can see what a hole needs without doing the subtraction.

**Keyboard.** `W A S D` pan · `Esc` cancel or stop editing · `Enter` finish a
cable or an extension.

## Kits

Bolt6 runs several kits, each a numbered set of about 60 cameras. **Kits** on
the course screen opens the setup: name the kit, say how many cameras it holds,
and type anything broken or missing into one field — `7, 23, 41-44`, commas,
spaces or ranges, however it comes off the flight case.

A plan is built against one kit, chosen when you create it and changeable from
the planner's menu. Everywhere a camera number is offered, that kit decides
what is on the table:

- **Auto-assignment skips what is out.** With 2 broken, hole 1 gets cameras 1
  and 3 rather than 1 and 2. It exhausts the hole's own block first, then takes
  any spare number the kit can still supply.
- **The number picker greys them out**, saying why, so you cannot pick a camera
  that is in a repair shop.
- **Switching a plan's kit re-checks it.** Existing numbers are left alone, but
  any camera the new kit cannot supply is flagged in its panel.
- **The rigging CSV names the kit** and lists what was out of service, so the
  sheet is self-explanatory a month later.

## Exports

**Camera plan** is the sheet the crew works from: a row per hole, a column per
position, each cell carrying the camera number and its mounting mark.

```
Hole,g01,g02,g03,Tripods
1,"1 ^","3 T","6 T",2
2,"","","7 T",1
3,"","","",0
```

`T` tripod, `L` LED board, `^` tower, `H` hospitality — the key is printed at
the foot of the sheet. Every hole gets a row whether or not anything is planned
on it, and the Tripods column is what the hole needs carrying out to it.

Any camera missing a hole or a position is listed under the grid rather than
dropped silently, so a half-finished plan says so.

**Rigging breakdown** is the other view of the same plan — a row per hole with
positions, camera numbers, switches, markers, cable metres by type and the
notes attached to anything on that hole.

## Setting up a hole layout

OpenStreetMap gives you the club's everyday routing at best, and nothing at all
for a course nobody has mapped. **Menu → Set up hole layout** lets you draw it:

Pick a hole, click where the tee is, click where the green is. It arms the tee
first, moves to the green once you have set it, then jumps to the next hole —
so a full course is 36 clicks. The bar shows which point it is waiting for and
how many holes are done, the hole strip dims the ones still to do, and par can
be set per hole from the same bar. Clicking again corrects a point.

Everything else is derived: the play bearing that turns the map tee-to-green,
the bounds the map flies to, and the dashed centreline. Holes set this way are
marked `source: 'manual'` so they are distinguishable from imported ones later.

This is also the only route to a **tournament** layout. Temporary tees, moved
pins and reversed nines exist in no public dataset, so when the event routing
differs from the members' course, this is how it gets in.

A file import — GeoJSON, KML, or whatever your LiDAR pipeline produces — is the
obvious next step and the hole record is deliberately small enough to make it
easy: `{ number, par, tee: [lng,lat], green: [lng,lat] }` is the whole input,
the rest is computed.

## Courses and hole layouts

The course list is seeded from `data/lpgaCourses.js` on first run. After that
the stored list is the truth, so editing that file will not change a browser
that has already run the app — clear `localStorage` or add courses through the
UI.

Seeded courses carry a venue name but no coordinates. The first time one is
opened the app geocodes it through Mapbox and pulls the hole layout from
OpenStreetMap, then caches both.

The public Overpass endpoint queues requests when it is busy instead of
refusing them, so every attempt has its own 12-second timeout and the app tries
both mirrors, POST then GET. While it is working the banner says which mirror
it is on, and **Open without hole data** gets you into the planner immediately
— the map works fine, you just lose hole snapping until the layout is
available. A course that fails opens anyway rather than leaving you stuck.

**A caveat worth knowing.** OpenStreetMap gives you the club's everyday
routing. It does not give you the tournament layout — temporary tees, moved
pins, reversed nines and altered pars live in tournament media-guide PDFs and
are not published anywhere machine-readable. Treat the imported holes as a
baseline and expect to adjust them once the tournament layout is known. Three
2027 venues are still marked "Venue TBC" by the tour and cannot be opened until
someone fills them in.

## Distances

`lib/geo.js` uses Vincenty's inverse formula on the WGS84 ellipsoid, not
haversine. Haversine — what `@turf/turf` uses — runs about 0.04 % long, which
is nothing on a 50 m cable and 7 m over 10 km. The test suite checks the app's
figure against GeographicLib, the reference implementation, and they agree to
2 micrometres. PostGIS `ST_Length(geography)` is ellipsoidal too, so when there
is a backend the two ends will agree.

## Ground slope

Upload a GeoTIFF per course and the map shades the ground by how steep it is,
so you can see where a tripod will level before anyone walks the course. Click
a tripod position and the panel gives the slope under it against your limit —
5 degrees by default, adjustable per device.

The rule the whole feature is built on: **ground is never shown as flat unless
it was measured as flat.** No file means no shading; a gap in a file stays a
gap; a camera outside the covered area is told so. A smooth, confident, wrong
surface would be worse than nothing.

Full guide, including where to get a file for each venue and why the app cannot
just call an elevation API: **[ELEVATION.md](ELEVATION.md)**.

## Tests

```bash
npx vite build --config vite.config.test.js
node tests/e2e.mjs          # the app
node tests/osm.mjs          # OpenStreetMap failure paths
node tests/layout.mjs       # drawing a hole layout by hand
node tests/writes.mjs       # that saves are per entity, not whole-plan
node tests/slope.mjs        # projections, slope maths, and the overlay

npm run build && node tests/prodcheck.mjs   # the bundle that actually ships
```

84 assertions in a headless Chromium: course seeding, hole import, the hole
row and its dimming, kit setup and the number-list parser, camera numbering
around broken kit cameras, rig positions and the independence of the two,
refusing a camera with no hole or no free position, the camera-plan grid,
type badges, one-tool-at-a-time,
cable snapping, point dragging, unpinning on grab (and the node staying put),
extending a run from the (+), inserting a joint by clicking the line, pinned
points following a moved node, marker icons, hover notes, Move, WASD, CSV
export and persistence across a reload.

Four more suites cover what is hard to reproduce by hand: `osm.mjs` for
OpenStreetMap rate-limiting, hanging and cancellation; `layout.mjs` for
building a hole layout from nothing; `writes.mjs` for the write batching that
keeps two people from overwriting each other; and `slope.mjs` for the elevation
pipeline. 216 assertions in total.

`slope.mjs` is checked against outside references rather than against itself:
the projections against **pyproj**, the slope computation against an
independent **numpy** implementation of the same Horn method, both run over real
GeoTIFFs in `tests/fixtures/`. It also drives the whole feature in a browser —
upload a file, shade the map, read a camera's slope, remove the file and watch
the shading go. That matters because the failure mode here is silent: shading
that looks plausible and is in the wrong place would send somebody to a bank
with a tripod.

`vite.config.test.js` swaps `mapbox-gl` for `tests/mapbox-mock.js`, so the
suites run the real application code without a token or a network. The
OpenStreetMap and geocoding calls are intercepted with fixtures.

## What is not real yet

- **Sharing** downloads a `.b6plan.json` file that the other person imports
  from the plan screen. There is no backend, so there are no accounts and no
  live collaboration.
- **Camera types** (tripod / LED / tower / hospitality) are set by hand. They
  are meant to be set automatically from whatever fixture a camera is snapped
  to, once fixture and building plans are imported. The pinning model the
  cables already use is the same mechanism that will carry that.
- **Live updates.** With Supabase you see other people's work when you reopen a
  plan or press Refresh, not as it happens.
- **Roles.** Anyone signed in can edit or delete anything.
- **Offline.** Writes fail if the network is down. The app says so and retries,
  but the queue is in memory — close the tab and it is gone. On a golf course
  this matters, and it is the next thing worth building.
