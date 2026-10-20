import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// maplibre-gl 6 ships its web worker as a separate file and, by default,
// looks for it next to the module that imports it. Once bundled (and in
// Vite's dev pre-bundle) that file is not there, so every tile request fails
// with "Worker failed to load". Point it at the emitted asset explicitly.
setWorkerUrl(workerUrl)
