# Geographic social-card prototypes

Review-only alternatives to the shipped cards. Nothing in `renders/` is copied
to `public/`, and the site's metadata does not reference these files.

Run:

```sh
npm run social-images:prototypes
```

Chrome is required; set `CHROME_PATH` when it is not in a common install
location.

## Directions

- **A — real map:** OpenFreeMap's Positron vector style and tiles, restyled to
  a warm muted palette. Water, parks, major roads, buildings and selected
  labels come from the actual map around each configured center. The home
  version uses the same map and places one marker at each published metro's
  `initialView` coordinate from `shared/metros.ts`.
- **B — recognizable silhouette:** the same OpenFreeMap vector tiles reduced
  to real water, waterways, parks, wooded land and boundaries. The home
  version collages the three rendered city silhouettes.

The city views are deliberate cartographic frames; no geographic feature or
place marker is drawn by hand.

## Place pins

The city prototypes intentionally have no frolicmap place pins. Production
place coordinates live in Cloudflare D1 and are not checked into this
repository. Coordinates in tests are synthetic fixtures and are not valid
source data for a public design. The generator never queries production
resources and never invents coordinates.

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
