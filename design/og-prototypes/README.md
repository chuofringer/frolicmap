# Geographic social-card prototypes

Review-only alternatives to the shipped cards. Nothing in `renders/` is copied
to `public/`, and the site's metadata does not reference these files.

Run:

```sh
FROLICMAP_OG_PLACES_CSV=/path/to/read-only-export.csv npm run social-images:prototypes
```

Chrome is required; set `CHROME_PATH` when it is not in a common install
location. The first run copies the export to the gitignored
`.data/frolicmap-og-places.csv`; later runs can omit the environment variable.

## Directions

- **A — real map:** OpenFreeMap's Positron vector style and tiles, restyled to
  a warm muted palette. Water, parks, major roads, buildings and selected
  labels come from the actual map around each configured center. The home
  version uses the same map and places one marker at each published metro's
  `initialView` coordinate from `shared/metros.ts`.
- **B — recognizable silhouette:** the same OpenFreeMap vector tiles reduced
  to real water, waterways, parks, wooded land and boundaries. The home
  version collages the three rendered city silhouettes.
- **Pin-map round:** the warmer real-map direction with true approved-place
  coordinates from a private read-only export. These renders live under
  `renders/pins/`; the prior A/B files remain available for comparison.

The city views are deliberate cartographic frames; no geographic feature or
place marker is drawn by hand.

## Place pins and private input

The pin-map city cards use only rows from the private export supplied at
generation time. The CSV and every derived coordinate list stay under the
gitignored `.data/` directory and are never committed. A production generator
would need a read-only D1 or API export step before rendering.

Rows are first projected into the card's exact viewport and anything outside
the visible pixel bounds is discarded. Remaining rows are sorted
deterministically, interleaved by legend group, and capped at one real row per
16×16-pixel cell. Coordinates are never moved or synthesized.

The five pin colors use Paul Tol's color-blind-safe qualitative palette:
park `#117733`, playground `#DDCC77`, library `#332288`, museum `#CC6677`,
and more `#88CCEE`. The generator simulates protanopia and deuteranopia with
`@bjornlu/colorblind` and fails if any simulated color pair is less than 70
RGB-distance units apart. Every dot also has a dark outline and light halo.

The home pin-map uses the 15 published metro centers from `shared/metros.ts`.
Basemap labels are hidden; short labels are drawn separately with leader lines,
so markers remain at their true coordinates and never cover a label.

## Attribution and licences

Every full-size prototype visibly says:

> OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors ·
> openstreetmap.org/copyright (ODbL)

Sources and requirements:

- [OpenFreeMap](https://openfreemap.org/) says attribution is required and
  gives alternative clients and static media the wording “OpenFreeMap ©
  OpenMapTiles Data from OpenStreetMap.”
- The [OpenStreetMap Foundation attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
  require visible, legible attribution near a static produced work and accept
  “© OpenStreetMap contributors.”
- The [OpenStreetMap copyright page](https://www.openstreetmap.org/copyright)
  explains that OSM data is available under the ODbL and that the copyright
  URL supplies the required origin and licence information.

## Automated checks

Generation fails if a full-size card is not 1200×630, reaches 300,000 bytes,
or if any card-owned text leaves its container or canvas. All card-owned text
is measured using the same bundled DejaVu Sans files used for rendering and
must have at least 4.5:1 contrast. A 400px-wide review thumbnail is generated
next to each full-size card under `renders/thumbs/`.
