# Ground slope and mast suitability

A mast has a levelling limit. Stand one on ground steeper than that and it
cannot be levelled, so a camera position that looks fine on a satellite photo
turns out to be unusable when somebody walks it on the Monday.

The planner can shade the ground by how steep it is, and tell you the slope
under any mast position you place. It needs an elevation file per course to do
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

For a mast question you want something near 1 m. No global service offers
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

### The quickest US recipe

USGS will clip a tile for you, so you do not have to download a whole 300 MB
survey sheet. Put your course's bounding box into this URL and open it in a
browser — it returns a GeoTIFF of exactly that ground:

```
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage
  ?bbox=<west>,<south>,<east>,<north>
  &bboxSR=4326&size=2000,2000&format=tiff&pixelType=F32&f=image
```

A 2 km box at `size=2000,2000` gives you roughly 1 m cells in a file of about
16 MB. `size` maxes out at 8000.

Whole survey tiles work too — the app crops to the course and never reads more
of the file than it needs, so a 10000 x 10000 tile costs the same memory as a
small one.

| Where | Source | Resolution |
|---|---|---|
| United States | USGS 3DEP — see the recipe below | 1 m over most populated areas |
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

**Upload.** Open a course, then **Elevation** on any plan row → drop in the
GeoTIFF. It is stored against the *course*, not the plan, so one upload serves
every plan on that course.

**Shade the map.** In the planner, the **Slope** button along the bottom.
Green is fine, amber is within a degree of your limit, red is too steep, and
unshaded means no reading.

**Check one position.** Click a camera set to *Mast* and the panel gives the
slope under it and whether it will floor. Towers, LED boards and hospitality
positions carry their own levelling, so they get no readout.

**The mast floor limit.** Five degrees by default, adjustable from 1 to 20
either on the elevation screen or from the slider in the planner. It is a **per
device** setting, not part of the plan: it describes the kit actually in front of
you, and a heavy box on a tall column runs out of level well before a light one
on short legs. Drag it and watch the green retreat — that is how you find out
whether a position is comfortably fine or only just.

---

## The 3D view is a different thing

The **3D** button tilts the map and adds terrain relief, a sky and extruded
buildings. It is visual context — what a position looks at, and what it has to
see past — and it is free, because Mapbox bills per map load rather than per
tile.

It is not a second opinion on slope. Its heights come from Mapbox's global
elevation tileset at roughly 5–10 m per pixel, exaggerated 1.5x so a gently
rolling course reads on a screen at all. A bunker face the shading calls too
steep will look like nothing in the relief. When both are on, the slope bar
says `shading is measured · relief is not`.

### Why not Google's Photorealistic 3D Tiles

Rendering them live is permitted; **exporting them into this app is not.**
Google's Map Tiles API policy says you "must not pre-fetch, index, store, or
cache any Content," lists "Geodata extraction or resale" and "Offline uses"
among prohibited uses, and requires that "3D objects aren't extracted, traced,
or otherwise derived by hand or machine from Photorealistic 3D Tiles."

Even setting the licence aside, they would not help with masts. They are a
photogrammetric mesh from aerial imagery — a *surface* model, with trees,
grandstands and roofs in it as though they were ground — at metre-level vertical
accuracy, which is noise at the baseline slope is measured over. Google's own
FAQ calls the data not survey-grade and intended for immersive visualisation
"rather than support spatial analysis or model measurements."

Cesium World Terrain is free and legitimate, but it is a decimated streaming
blend of the same open sources listed above (SRTM, EU-DEM, the USGS National
Elevation Dataset, national LiDAR). Where it is good it is good because USGS or
the Environment Agency published it — and you can have that source intact, as a
GeoTIFF, for nothing.

## What it does to the data

- The file is resampled onto a regular longitude/latitude grid and slope is
  computed per cell with **Horn's 3×3 method**, the same one GDAL and ArcGIS
  use.
- The file is first **cropped to 1.5 km around the course**, and never read at
  more than 3000 pixels per axis. That is what lets a whole survey tile work:
  the cell budget is spent on the course rather than on the county, and memory
  does not depend on the size of the file.
- Cell size then follows the source up to a budget of 1.44 million cells, which
  lands near 2.5 m over a 3 km box. Finer would not buy much — a 1 m survey DTM
  is interpolated from a few returns per square metre, so slope detail below
  about 2 m is mostly noise. A mast stands on roughly a metre of ground.
- Slope is stored as one byte per cell at a quarter of a degree, **rounded up**
  so a stored figure never reads flatter than the ground is.
- A whole course costs 1–2 MB, which Postgres compresses to around 130 kB on
  disk. The source GeoTIFF is not kept. On the localStorage fallback that is a
  large share of the browser's quota, so a few courses will fill it — the app
  says so plainly rather than failing silently.

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

**"This file covers ground about N km from the course"** — the tile does not
overlap the course at all, so there is nothing to crop to. Almost always the
neighbouring sheet.

**A warning that the file covers ground some kilometres from the course** —
almost always the wrong tile. Check before planning against it.
