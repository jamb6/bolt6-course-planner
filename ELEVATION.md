# Ground slope and tripod suitability

A tripod has a levelling limit. Stand one on ground steeper than that and it
cannot be levelled, so a camera position that looks fine on a satellite photo
turns out to be unusable when somebody walks it on the Monday.

The planner can shade the ground by how steep it is, and tell you the slope
under any tripod position you place. It needs an elevation file per course to do
that, which you upload yourself.

---

## Why you upload a file instead of the app fetching one

Slope is the **rate elevation changes**, not elevation itself. That makes it far
more demanding of resolution than a height reading is.

Google's Elevation API and the global 30 m datasets behind most elevation
services give you a height good to a metre or two — genuinely useful for "how
much higher is the tee than the green". Ask the same data for slope and you get
the average tilt across a 30 m square. A green surround, a bunker face and the
flat bit between them all land in one cell and average out to something gentle
and wrong.

For a tripod question you want something near 1 m. No global service offers
that, and the ones that do offer it are national programmes with their own
formats and licences. So the app is source-agnostic: bring a GeoTIFF from
wherever the venue's data actually comes from, and it will compute slope from
it. That also means no API bills, no provider outage, and no licence that
forbids exactly this use — Google's Photorealistic 3D Tiles, for instance,
explicitly prohibit programmatic measurement and say the data is not
survey-grade.

---

## Where to get a file

Ask for **1 m** resolution if the tool offers a choice, and **EPSG:4326** if it
offers a projection. Neither is required — the app handles UTM, British National
Grid and Web Mercator too — but 4326 always works.

Ask for a **DTM / bare-earth / ground** model rather than a surface model. A
surface model includes trees and buildings, which would show a canopy edge as a
cliff.

| Where | Source | Resolution |
|---|---|---|
| United States | USGS 3DEP, easiest via the OpenTopography API | 1 m over most populated areas |
| England | Environment Agency National LiDAR Programme | 1 m, national coverage |
| Netherlands | AHN | 0.5 m |
| France | IGN LiDAR HD | ~0.5 m, still rolling out |
| Anywhere else | A drone photogrammetry or LiDAR flight | whatever you fly |

For the 2027 LPGA schedule that is roughly half the season. **Thailand,
Singapore, Hong Kong, China, Korea, Japan, Malaysia and Mexico have no open 1 m
dataset**, so those venues need flying or they stay unshaded. Unshaded is the
correct outcome there, and is the point of the next section.

---

## No data stays no data

The single rule this feature is built around: **the map never shows ground as
flat unless it was measured as flat.**

- A course with no file uploaded gets no shading at all, and the slope toggle
  says "No elevation".
- A camera outside the uploaded file's area is told it is outside, not told it
  is fine.
- A gap inside the file — water, dense canopy, a dropout — stays transparent.
  So does every cell whose neighbourhood touches a gap, because a gradient
  computed against a missing value would invent a cliff.
- The rigging export, with no elevation loaded, prints
  `GROUND SLOPE,"not checked - no elevation uploaded for this course"` rather
  than an empty column that would read as all clear.

A smooth, confident, wrong surface would be worse than nothing, because somebody
would plan against it.

---

## Using it

**Upload.** Course list → **Elevation** next to a located course → drop in the
GeoTIFF. The app reports the cell size, the source projection, how much of the
file has a reading, and what share of the ground is tripod-suitable.

**Shade the map.** In the planner, the **Slope** button along the bottom.
Green is fine, amber is within a degree of your limit, red is too steep, and
unshaded means no reading.

**Check one position.** Click a camera set to *Tripod* and the panel gives the
slope under it and whether it will level. Towers, LED boards and hospitality
positions carry their own levelling, so they get no readout.

**The limit.** Five degrees by default, adjustable from 1 to 20 either on the
course's elevation screen or from the slider in the planner. It is a **per
device** setting, not part of the plan: it describes the heads and legs actually
in front of you, and a heavy box on a tall column runs out of level well before
a light one on short legs. Drag it and watch the green retreat — that is how you
find out whether a position is comfortably fine or only just.

---

## What it does to the data

- The file is resampled onto a regular longitude/latitude grid and slope is
  computed per cell with **Horn's 3×3 method**, the same one GDAL and ArcGIS
  use.
- Cell size follows the source up to a budget of 250,000 cells. A 1.5 km course
  lands near 2–3 m. A tripod stands on about a metre of ground, so the shading
  points at the flat areas rather than certifying a single leg.
- Slope is stored as one byte per cell at a quarter of a degree, **rounded up**
  so a stored figure never reads flatter than the ground is.
- A whole course costs a few hundred kilobytes, and Postgres compresses that to
  around 20 kB on disk. The source GeoTIFF is not kept.

## Accuracy

The projection maths is checked against **pyproj** and the slope computation
against an independent **numpy** implementation of the same method, both in
`tests/slope.mjs`:

- projections agree to under 2 mm across UTM, British National Grid and Web
  Mercator;
- a synthetic 10% grade reads 5.75°, the correct quarter-degree rounding of
  atan(0.1) = 5.7106°;
- on a realistic surface, the app's share of ground under 5° comes out at
  97.6% against the reference's 97.7%;
- and the same ground supplied as UTM and as EPSG:4326 reaches the same answer
  to within half a percent.

## If a file is refused

**"in EPSG:*nnnn*, which cannot be placed on the map with confidence"** — the
app supports WGS84/NAD83 longitude and latitude, UTM, Web Mercator and British
National Grid. Anything else (Albers, a state plane, a Lambert conformal) is
refused rather than guessed at, because placing the pixels in the wrong spot
would be worse than not shading. Re-export as EPSG:4326 and it will load.

**"Every pixel in this file is marked as no data"** — usually a tile from
outside the survey's coverage.

**A warning that the file covers ground some kilometres from the course** —
almost always the wrong tile. Check before planning against it.
