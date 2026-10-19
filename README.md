# frolicmap

A map of fun places for families (playgrounds, parks, libraries, museums,
aquariums, zoos, beaches, water play, hiking and campgrounds) sourced from
OpenStreetMap, IMLS, ParkServe and the National Park Service, served as
session-gated vector tiles from a Cloudflare Worker + D1 database.

**Work in progress.** This repository is a fresh-history, static-places-only
cut of a private codebase; see [docs/carve-out-manifest.md](docs/carve-out-manifest.md)
for what is being kept, changed and dropped, and in what order.

Code is MIT licensed (see [LICENSE](LICENSE)). Data is not MIT: rows carry a
`source_type` and are redistributed under each source's own terms.
