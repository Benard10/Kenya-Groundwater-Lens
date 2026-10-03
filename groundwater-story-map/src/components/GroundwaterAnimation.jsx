import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map } from "../lib/maplibre.js";

const DURATION = 8500;
export const MAP_STYLE = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    relief: {
      type: "raster",
      tiles: ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 6
    },
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet"
    }
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#071014" } },
    { id: "relief", type: "raster", source: "relief", paint: { "raster-opacity": 0.52, "raster-saturation": -0.72, "raster-brightness-max": 0.42 } },
    { id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover", paint: { "fill-color": "#14252a", "fill-opacity": 0.34 } },
    { id: "parks", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": "#17352f", "fill-opacity": 0.45 } },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#082936", "fill-opacity": 0.88 } },
    { id: "waterways", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": "#197895", "line-opacity": 0.62, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 10, 1.6] } },
    { id: "roads", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#6c7779", "line-opacity": 0.22, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.25, 11, 1.1] } },
    { id: "boundaries", type: "line", source: "openmaptiles", "source-layer": "boundary", paint: { "line-color": "#9fb1b5", "line-opacity": 0.28, "line-dasharray": [2, 2], "line-width": 0.8 } },
    {
      id: "place-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 4,
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 9, 13]
      },
      paint: { "text-color": "#b5c2c5", "text-halo-color": "#071014", "text-halo-width": 1.2 }
    }
  ]
};

const TYPE_COLOR = [
  "match", ["get", "type"],
  "bh", "#ffb21c",
  "pdw", "#38c9f3",
  "udw", "#38c9f3",
  "ps", "#6de2c1",
  "us", "#6de2c1",
  "#d4dce0"
];

const format = value => Number(value).toLocaleString("en-KE", { maximumFractionDigits: 1 });

function buildScenes(summary) {
  return [
    {
      label: "Main finding",
      kicker: "MAPPING KENYA'S GROUNDWATER",
      title: <><em>{format(summary.total)}</em> records reveal a national picture—and a major blind spot.</>,
      copy: `This public inventory brings together wells, boreholes and springs from ${format(summary.counties)} counties. It is a valuable starting point, but it mainly shows where surveys created records—not every groundwater source in Kenya.`,
      metrics: [[format(summary.total), "mapped records"], [format(summary.counties), "counties represented"]],
      guardrail: "Use this map to begin an enquiry. Finish it with official records and a field check.",
      camera: { center: [37.75, 0.15], zoom: 5.35, pitch: 18, bearing: 0 },
      filter: null,
      color: TYPE_COLOR,
      radius: ["interpolate", ["linear"], ["zoom"], 4, 1.8, 7, 3.2, 10, 5],
      opacity: 0.78
    },
    {
      label: "Map pattern",
      kicker: "THE ILLUSION OF ABUNDANCE",
      title: <><em>{summary.westernShare}%</em> of records sit in just two counties.</>,
      copy: `Kakamega and Vihiga contain ${format(summary.westernCount)} records. This strong western cluster tells us where data collection was strongest. It does not mean these counties hold ${summary.westernShare}% of Kenya’s groundwater.`,
      metrics: [[format(summary.countyCounts.Kakamega), "Kakamega records"], [format(summary.countyCounts.Vihiga), "Vihiga records"]],
      guardrail: "Survey effort and data coverage strongly influence the pattern on this map.",
      camera: { center: [34.75, 0.22], zoom: 7.25, pitch: 34, bearing: -9 },
      filter: ["in", ["get", "county"], ["literal", ["Kakamega", "Vihiga"]]],
      color: ["match", ["get", "county"], "Kakamega", "#38c9f3", "Vihiga", "#ffb21c", "#60737b"],
      radius: ["interpolate", ["linear"], ["zoom"], 5, 1.7, 8, 3.5, 11, 5],
      opacity: 0.72
    },
    {
      label: "Missing depth",
      kicker: "THE DATA BLACK BOX",
      title: <>Only <em>{summary.depthShare}%</em> tell us how deep a source was built.</>,
      copy: `Only ${format(summary.depthCount)} records have a usable construction depth. Their median is ${format(summary.medianDepth)} metres. Even then, construction depth is not the water-table depth and cannot tell us how much water is available.`,
      metrics: [[format(summary.depthCount), "usable depth records"], [`${format(summary.medianDepth)} m`, "median construction depth"]],
      guardrail: "The absence of a depth value is a data gap—not a shallow well and not evidence of non-compliance.",
      camera: { center: [36.9, 0.1], zoom: 5.6, pitch: 28, bearing: 8 },
      filter: ["==", ["get", "hasDepth"], 1],
      color: ["interpolate", ["linear"], ["get", "depth"], 0, "#6de2c1", 75, "#ffcf4a", 200, "#ff775f", 600, "#d8366f"],
      radius: ["interpolate", ["linear"], ["get", "depth"], 0, 3, 100, 5, 600, 9],
      opacity: 0.9
    },
    {
      label: "Read with care",
      kicker: "A TOOL, NOT A CENSUS",
      title: <>Blank space means <em>missing evidence</em>—not missing groundwater.</>,
      copy: "Bright clusters show stronger inventory coverage. Quiet areas show that this dataset has fewer nearby records. Neither pattern, on its own, proves how much groundwater exists, how deep it lies or whether a source is active.",
      metrics: [[`${format(100 - summary.depthShare)}%`, "without usable depth"], [format(summary.total), "leads that still need context"]],
      guardrail: "Do not turn survey coverage into a claim about groundwater abundance, scarcity or compliance.",
      camera: { center: [37.25, 0.1], zoom: 5.25, pitch: 38, bearing: -8 },
      filter: null,
      color: TYPE_COLOR,
      radius: ["interpolate", ["linear"], ["zoom"], 4, 1.7, 7, 3.3, 10, 5],
      opacity: 0.64
    },
    {
      label: "WRA action",
      kicker: "FROM MAP TO MANAGEMENT",
      title: <>The map gives WRA the clues. <em>Fieldwork turns them into action.</em></>,
      copy: "Start with likely wells and boreholes, match them to official records, visit the site, measure use where required, and then manage each source fairly. This turns a public inventory into better evidence without treating every dot as a final answer.",
      metrics: [[format(summary.wellCount), "well and borehole leads"], ["5 steps", "from identification to fair action"]],
      guardrail: "Permitting, charging or enforcement must use verified WRA records, measured use and a fair correction process—not this map alone.",
      camera: { center: [37.45, 0.05], zoom: 5.15, pitch: 52, bearing: 12 },
      filter: ["in", ["get", "type"], ["literal", ["bh", "pdw", "udw"]]],
      color: "#38c9f3",
      radius: ["interpolate", ["linear"], ["zoom"], 4, 1.5, 8, 3],
      opacity: 0.24,
      flow: true,
      flowLabels: ["Identify source", "Match records", "Visit the site", "Measure use", "Manage fairly"]
    }
  ];
}

export default function GroundwaterAnimation() {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const [dataset, setDataset] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    let active = true;
    fetch("./data/animation-points.json")
      .then(response => {
        if (!response.ok) throw new Error(`Data request failed (${response.status})`);
        return response.json();
      })
      .then(data => active && setDataset(data))
      .catch(error => active && setMapError(error.message));
    return () => { active = false; };
  }, []);

  const scenes = useMemo(() => dataset ? buildScenes(dataset.summary) : [], [dataset]);
  const scene = scenes[current];

  useEffect(() => {
    if (!dataset || !mapNode.current || mapRef.current) return;
    const features = dataset.records.map(([lon, lat, type, county, depth], index) => ({
      type: "Feature",
      id: index,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { type, county, depth: depth ?? -1, hasDepth: depth == null ? 0 : 1 }
    }));
    const map = new Map({
      container: mapNode.current,
      style: MAP_STYLE,
      center: [37.75, 0.15],
      zoom: 5.35,
      pitch: 18,
      attributionControl: false,
      dragRotate: false,
      scrollZoom: false
    });
    mapRef.current = map;
    let attachFrame = 0;
    map.on("error", event => {
      const message = event?.error?.message || "The map background could not be loaded.";
      if (/style|source|tile/i.test(message)) setMapError(message);
    });
    const attachGroundwater = () => {
      if (!mapRef.current) return;
      if (map.getSource("groundwater")) return;
      try {
        const firstSymbol = map.getStyle()?.layers?.find(layer => layer.type === "symbol");
        const before = firstSymbol?.id;
        map.addSource("groundwater", { type: "geojson", data: { type: "FeatureCollection", features } });
        map.addLayer({
        id: "groundwater-glow",
        type: "circle",
        source: "groundwater",
        paint: {
          "circle-color": TYPE_COLOR,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 8, 10],
          "circle-blur": 0.9,
          "circle-opacity": 0.26
        }
        }, before);
        map.addLayer({
        id: "groundwater-points",
        type: "circle",
        source: "groundwater",
        paint: {
          "circle-color": TYPE_COLOR,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.8, 7, 3.2, 10, 5],
          "circle-opacity": 0.78,
          "circle-stroke-width": 0.35,
          "circle-stroke-color": "rgba(255,255,255,0.58)"
        }
        }, before);
        setMapReady(true);
      } catch {
        attachFrame = window.requestAnimationFrame(attachGroundwater);
      }
    };
    attachFrame = window.requestAnimationFrame(attachGroundwater);
    return () => {
      window.cancelAnimationFrame(attachFrame);
      map.remove();
      mapRef.current = null;
    };
  }, [dataset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !scene) return;
    map.setFilter("groundwater-points", scene.filter);
    map.setFilter("groundwater-glow", scene.filter);
    map.setPaintProperty("groundwater-points", "circle-color", scene.color);
    map.setPaintProperty("groundwater-points", "circle-radius", scene.radius);
    map.setPaintProperty("groundwater-points", "circle-opacity", scene.opacity);
    map.setPaintProperty("groundwater-glow", "circle-color", scene.color);
    map.setPaintProperty("groundwater-glow", "circle-opacity", Math.min(scene.opacity * 0.33, 0.3));
    map.flyTo({ ...scene.camera, duration: 2200, essential: true });
  }, [current, mapReady, scene]);

  const goTo = useCallback(index => {
    if (!scenes.length) return;
    setCurrent((index + scenes.length) % scenes.length);
  }, [scenes.length]);

  useEffect(() => {
    if (!playing || !scenes.length) return undefined;
    const timer = window.setTimeout(() => goTo(current + 1), DURATION);
    return () => window.clearTimeout(timer);
  }, [current, goTo, playing, scenes.length]);

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === "ArrowRight") goTo(current + 1);
      if (event.key === "ArrowLeft") goTo(current - 1);
      if (event.key === " ") {
        event.preventDefault();
        setPlaying(value => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, goTo]);

  if (!dataset || !scene) {
    return <main className="loading-screen"><div className="loader" />{mapError || "Preparing the groundwater story…"}</main>;
  }

  return (
    <main id="story-animation" aria-label="Animated Kenya groundwater story">
      <div id="map" ref={mapNode} aria-label="Animated map of recorded groundwater sources in Kenya" />
      <div className="map-wash" aria-hidden="true" />

      <aside className="scene-rail" aria-label="Story scenes">
        {scenes.map((item, index) => (
          <button key={item.label} className={`scene-tab ${index === current ? "is-active" : ""}`} onClick={() => goTo(index)} aria-current={index === current ? "step" : undefined}>
            <span>{String(index + 1).padStart(2, "0")}</span><b>{item.label}</b>
          </button>
        ))}
      </aside>

      <section className="narrative" aria-live="polite">
        <p className="eyebrow">{scene.kicker}</p>
        <h1>{scene.title}</h1>
        <p className="scene-copy">{scene.copy}</p>
        <div className="metric-row">
          {scene.metrics.map(([value, label]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}
        </div>
        <div className={`wra-flow ${scene.flow ? "is-visible" : ""}`} aria-label="Responsible WRA implementation pathway">
          {(scene.flowLabels || ["Inventory lead", "Match permit", "Field verify", "Meter use", "Charge fairly"]).map((label, index) => (
            <Fragment key={label}><div><span>{index + 1}</span><b>{label}</b></div>{index < 4 && <i>→</i>}</Fragment>
          ))}
        </div>
        <p className="guardrail"><span>Important</span> {scene.guardrail}</p>
      </section>

      <footer className="story-footer" aria-label="Story playback and navigation">
        <div className="controls">
          <button onClick={() => goTo(current - 1)} aria-label="Previous scene">←</button>
          <button id="play-pause" onClick={() => setPlaying(value => !value)} aria-label={`${playing ? "Pause" : "Play"} animation`}>
            <span id="play-icon">{playing ? "Ⅱ" : "▶"}</span><span>{playing ? "Pause" : "Play"}</span>
          </button>
          <button id="next" onClick={() => goTo(current + 1)}>Next <span>→</span></button>
          <a className="story-scroll-cue" href="#water-story">Continue to the story ↓</a>
          <div className="scene-counter"><span>{String(current + 1).padStart(2, "0")}</span> / 05</div>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span key={`${current}-${playing}`} className={playing ? "is-running" : ""} style={{ "--scene-duration": `${DURATION}ms` }} />
        </div>
      </footer>

      {!scene.flow && <div className="legend" aria-label="Map legend">
        <span><i className="swatch borehole" />Borehole / tubewell</span>
        <span><i className="swatch dug" />Dug well</span>
        <span><i className="swatch spring" />Spring</span>
      </div>}
      {mapError && <div className="map-error">Map notice: {mapError}</div>}
      <div className="map-note">OpenFreeMap © OpenMapTiles · Data from OpenStreetMap · WebGL map by MapLibre</div>
    </main>
  );
}
