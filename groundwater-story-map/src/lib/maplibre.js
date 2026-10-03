import { FullscreenControl, LngLatBounds, Map, MercatorCoordinate, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);

export { FullscreenControl, LngLatBounds, Map, MercatorCoordinate, NavigationControl, Popup };
