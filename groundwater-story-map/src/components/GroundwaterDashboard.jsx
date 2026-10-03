import { useEffect, useMemo, useRef, useState } from "react";
import { FullscreenControl, LngLatBounds, Map as MapLibreMap, NavigationControl, Popup } from "../lib/maplibre.js";
import { createWellsBelowGroundLayer } from "../lib/wellsBelowGroundLayer.js";
import { MAP_STYLE } from "./GroundwaterAnimation.jsx";

const TYPE_META = {
  bh: { label: "Borehole / tubewell", color: "#ffb21c" },
  pdw: { label: "Protected dug well", color: "#38c9f3" },
  udw: { label: "Unprotected dug well", color: "#70bce3" },
  ps: { label: "Protected spring", color: "#6de2c1" },
  us: { label: "Unprotected spring", color: "#a1d99b" }
};

const TYPE_COLOR = [
  "match", ["get", "type"],
  "bh", TYPE_META.bh.color,
  "pdw", TYPE_META.pdw.color,
  "udw", TYPE_META.udw.color,
  "ps", TYPE_META.ps.color,
  "us", TYPE_META.us.color,
  "#d4dce0"
];

const format = value => Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 1 });
const NOTEBOOK_SURFACE_MODES = ["hexDensity", "hexDepth", "monitoringGap"];
const MAP_MODES = ["density", "hexDensity", "hexDepth", "monitoringGap", "points", "depth", "coverage", "timeline", "wells3d"];
const MODE_LAYERS = {
  density: ["dashboard-density"],
  hexDensity: ["dashboard-hex-density"],
  hexDepth: ["dashboard-hex-depth-thin", "dashboard-hex-depth"],
  monitoringGap: ["dashboard-monitoring-gap"],
  points: ["dashboard-glow", "dashboard-points"],
  depth: ["dashboard-depth"],
  coverage: ["dashboard-depth-coverage"],
  timeline: ["dashboard-glow", "dashboard-points"],
  wells3d: ["dashboard-well-sites"]
};
const ANALYSIS_LAYER_IDS = [...new Set(Object.values(MODE_LAYERS).flat())];

function formatMonthIndex(value) {
  const year = Math.floor(value / 12);
  const month = value % 12 + 1;
  return new Intl.DateTimeFormat("en-KE", { month: "short", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function BarList({ rows, total }) {
  const maximum = Math.max(...rows.map(row => row.value), 1);
  return <div className="bar-list">{rows.map(row => (
    <div className="bar-row" key={row.label}>
      <div><span>{row.label}</span><b>{format(row.value)}</b></div>
      <div className="bar-track"><i style={{ width: `${100 * row.value / maximum}%`, background: row.color || "var(--cyan)" }} /></div>
      {total ? <small>{(100 * row.value / total).toFixed(1)}%</small> : null}
    </div>
  ))}</div>;
}

function DepthHistogram({ values }) {
  const bins = [
    { label: "0–25 m", min: 0, max: 25 },
    { label: "26–50", min: 25, max: 50 },
    { label: "51–75", min: 50, max: 75 },
    { label: "76–100", min: 75, max: 100 },
    { label: "101–200", min: 100, max: 200 },
    { label: ">200", min: 200, max: Infinity }
  ].map(bin => ({ ...bin, value: values.filter(value => value > bin.min && value <= bin.max).length }));
  const maximum = Math.max(...bins.map(bin => bin.value), 1);
  return <div className="histogram">{bins.map(bin => (
    <div className="histogram-column" key={bin.label}>
      <b>{bin.value}</b><i style={{ height: `${Math.max(4, 100 * bin.value / maximum)}%` }} /><span>{bin.label}</span>
    </div>
  ))}</div>;
}

function UpdateChart({ rows }) {
  const maximum = Math.max(...rows.map(row => row.value), 1);
  return <div className="update-chart">{rows.map(row => (
    <div key={row.label}><b>{format(row.value)}</b><i style={{ height: `${Math.max(4, 100 * row.value / maximum)}%` }} /><span>{row.label}</span></div>
  ))}</div>;
}

function ExpandIcon({ expanded }) {
  return expanded
    ? <span aria-hidden="true">×</span>
    : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /><path d="M8 10.5h5M10.5 8v5" /></svg>;
}

export default function GroundwaterDashboard() {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const wellsLayerRef = useRef(null);
  const [dataset, setDataset] = useState(null);
  const [surfaceData, setSurfaceData] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [county, setCounty] = useState("All counties");
  const [activeTypes, setActiveTypes] = useState(() => Object.keys(TYPE_META));
  const [depthOnly, setDepthOnly] = useState(false);
  const [mapMode, setMapMode] = useState(() => {
    const requestedMode = window.location.hash.split("/")[1];
    return MAP_MODES.includes(requestedMode) ? requestedMode : "density";
  });
  const [wellScale, setWellScale] = useState(150);
  const [timelineIndex, setTimelineIndex] = useState(null);
  const [timelineMode, setTimelineMode] = useState("cumulative");
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [expandedChart, setExpandedChart] = useState(null);

  useEffect(() => {
    if (!analyticsExpanded && !expandedChart) return undefined;
    const collapseOnEscape = event => {
      if (event.key === "Escape") {
        setAnalyticsExpanded(false);
        setExpandedChart(null);
      }
    };
    window.addEventListener("keydown", collapseOnEscape);
    return () => window.removeEventListener("keydown", collapseOnEscape);
  }, [analyticsExpanded, expandedChart]);

  useEffect(() => {
    Promise.all([
      fetch("./data/animation-points.json").then(response => response.json()),
      fetch("./data/notebook-surfaces.geojson").then(response => response.json())
    ]).then(([inventory, surfaces]) => {
      setDataset(inventory);
      setSurfaceData(surfaces);
      const monthValues = inventory.records.map(record => record[7]).filter(Number.isFinite);
      if (monthValues.length) setTimelineIndex(Math.max(...monthValues));
    });
  }, []);

  const records = dataset?.records || [];
  const timelineBounds = useMemo(() => {
    const values = records.map(record => record[7]).filter(Number.isFinite);
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
  }, [records]);
  const counties = useMemo(() => dataset ? Object.keys(dataset.summary.countyCounts).sort() : [], [dataset]);
  const filtered = useMemo(() => records.filter(record => {
    const [, , type, recordCounty, depth, , , updateIndex] = record;
    const timeVisible = mapMode !== "timeline" || timelineIndex == null || (Number.isFinite(updateIndex) && (timelineMode === "cumulative" ? updateIndex <= timelineIndex : updateIndex === timelineIndex));
    return activeTypes.includes(type) && (county === "All counties" || recordCounty === county) && (!depthOnly || depth != null) && timeVisible;
  }), [records, activeTypes, county, depthOnly, mapMode, timelineIndex, timelineMode]);

  const analytics = useMemo(() => {
    const countyCounts = new globalThis.Map();
    const typeCounts = Object.fromEntries(Object.keys(TYPE_META).map(type => [type, 0]));
    const depths = [];
    const updateYears = new globalThis.Map();
    filtered.forEach(record => {
      const [, , type, recordCounty, depth, updateYear] = record;
      countyCounts.set(recordCounty, (countyCounts.get(recordCounty) || 0) + 1);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      if (depth != null) depths.push(depth);
      if (updateYear != null) updateYears.set(updateYear, (updateYears.get(updateYear) || 0) + 1);
    });
    const topCounties = [...countyCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
    const types = Object.entries(typeCounts).map(([type, value]) => ({ label: TYPE_META[type].label, value, color: TYPE_META[type].color }));
    const wellCount = filtered.filter(record => ["bh", "pdw", "udw"].includes(record[2])).length;
    const years = [...updateYears].sort((a, b) => a[0] - b[0]).map(([label, value]) => ({ label, value }));
    return { topCounties, types, depths, years, wellCount, countyCount: countyCounts.size };
  }, [filtered]);

  useEffect(() => {
    if (!dataset || !surfaceData || !mapNode.current || mapRef.current) return;
    const features = records.map(([lon, lat, type, recordCounty, depth, updateYear, elevation, updateIndex], index) => ({
      type: "Feature",
      id: index,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { type, county: recordCounty, depth: depth ?? -1, hasDepth: depth == null ? 0 : 1, updateYear: updateYear ?? -1, elevation: elevation ?? -1, updateIndex: updateIndex ?? -1 }
    }));
    const map = new MapLibreMap({
      container: mapNode.current,
      style: structuredClone(MAP_STYLE),
      center: [37.7, 0.15],
      zoom: 5.45,
      attributionControl: false
    });
    map.addControl(new NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new FullscreenControl(), "top-right");
    mapRef.current = map;
    let resizeFrame = 0;
    const scheduleMapResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => mapRef.current?.resize());
    };
    const resizeObserver = new ResizeObserver(scheduleMapResize);
    resizeObserver.observe(mapNode.current);
    window.addEventListener("resize", scheduleMapResize);
    const attach = () => {
      if (!mapRef.current) return;
      if (map.getSource("dashboard-groundwater")) return;
      try {
        const firstSymbol = map.getStyle()?.layers?.find(layer => layer.type === "symbol")?.id;
        const initialLayerVisibility = layer => MODE_LAYERS[mapMode].includes(layer) ? "visible" : "none";
        map.addSource("terrain-dem", {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 13
        });
        map.addLayer({
          id: "terrain-hillshade",
          type: "hillshade",
          source: "terrain-dem",
          layout: { visibility: "none" },
          paint: {
            "hillshade-shadow-color": "#071015",
            "hillshade-highlight-color": "#7ea6a3",
            "hillshade-accent-color": "#244a51",
            "hillshade-exaggeration": 0.58
          }
        }, firstSymbol);
        map.addSource("notebook-surfaces", { type: "geojson", data: surfaceData });
        map.addLayer({
          id: "dashboard-hex-density",
          type: "fill-extrusion",
          source: "notebook-surfaces",
          filter: [">", ["get", "records"], 0],
          layout: { visibility: initialLayerVisibility("dashboard-hex-density") },
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["get", "densityScore"], 0, "#440154", 0.3, "#31688e", 0.55, "#35b779", 1, "#fde725"],
            "fill-extrusion-height": ["get", "densityHeight"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.86
          }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-hex-depth-thin",
          type: "fill-extrusion",
          source: "notebook-surfaces",
          filter: ["all", [">", ["get", "records"], 0], ["==", ["get", "depthOk"], false]],
          layout: { visibility: initialLayerVisibility("dashboard-hex-depth-thin") },
          paint: {
            "fill-extrusion-color": "#59636c",
            "fill-extrusion-height": 2600,
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.72
          }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-hex-depth",
          type: "fill-extrusion",
          source: "notebook-surfaces",
          filter: ["==", ["get", "depthOk"], true],
          layout: { visibility: initialLayerVisibility("dashboard-hex-depth") },
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["get", "depthScore"], 0, "#0d0887", 0.35, "#9c179e", 0.7, "#ed7953", 1, "#f0f921"],
            "fill-extrusion-height": ["get", "depthHeight"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.88
          }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-monitoring-gap",
          type: "fill-extrusion",
          source: "notebook-surfaces",
          filter: ["==", ["get", "insideKenya"], true],
          layout: { visibility: initialLayerVisibility("dashboard-monitoring-gap") },
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["get", "gapScore"], 0, "#000004", 0.3, "#51127c", 0.65, "#b73779", 1, "#fcfdbf"],
            "fill-extrusion-height": ["get", "gapHeight"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.88
          }
        }, firstSymbol);
        map.addSource("dashboard-groundwater", { type: "geojson", data: { type: "FeatureCollection", features } });
        map.addLayer({
          id: "dashboard-density",
          type: "heatmap",
          source: "dashboard-groundwater",
          maxzoom: 11,
          layout: { visibility: initialLayerVisibility("dashboard-density") },
          paint: {
            "heatmap-weight": 0.75,
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.7, 9, 1.7],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 9, 27],
            "heatmap-opacity": 0.86,
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(7,16,20,0)", 0.18, "#153a50", 0.42, "#087ea8", 0.7, "#f3b522", 1, "#f05b3f"]
          }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-glow",
          type: "circle",
          source: "dashboard-groundwater",
          layout: { visibility: initialLayerVisibility("dashboard-glow") },
          paint: { "circle-color": TYPE_COLOR, "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 7, 9, 11], "circle-blur": 0.82, "circle-opacity": 0.3 }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-points",
          type: "circle",
          source: "dashboard-groundwater",
          layout: { visibility: initialLayerVisibility("dashboard-points") },
          paint: { "circle-color": TYPE_COLOR, "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.2, 8, 5.2, 12, 7], "circle-opacity": 0.9, "circle-stroke-width": 0.55, "circle-stroke-color": "#ffffff" }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-depth",
          type: "circle",
          source: "dashboard-groundwater",
          filter: ["==", ["get", "hasDepth"], 1],
          layout: { visibility: initialLayerVisibility("dashboard-depth") },
          paint: {
            "circle-color": ["interpolate", ["linear"], ["get", "depth"], 0, "#6de2c1", 75, "#ffcf4a", 200, "#ff775f", 600, "#d8366f"],
            "circle-radius": ["interpolate", ["linear"], ["get", "depth"], 0, 4.5, 100, 6.5, 600, 10],
            "circle-opacity": 0.9,
            "circle-stroke-width": 0.7,
            "circle-stroke-color": "#ffffff"
          }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-depth-coverage",
          type: "circle",
          source: "dashboard-groundwater",
          layout: { visibility: initialLayerVisibility("dashboard-depth-coverage") },
          paint: {
            "circle-color": ["match", ["get", "hasDepth"], 1, "#6de2c1", "#e2534a"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.2, 9, 6],
            "circle-opacity": ["match", ["get", "hasDepth"], 1, 0.94, 0.5]
          }
        }, firstSymbol);
        map.addLayer({
          id: "dashboard-well-sites",
          type: "circle",
          source: "dashboard-groundwater",
          filter: ["==", ["get", "hasDepth"], 1],
          layout: { visibility: initialLayerVisibility("dashboard-well-sites") },
          paint: {
            "circle-color": "#f7f4dd",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 8, 4.5, 11, 7],
            "circle-opacity": 0.94,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffb21c"
          }
        }, firstSymbol);
        const wellsLayer = createWellsBelowGroundLayer(records, wellScale);
        wellsLayerRef.current = wellsLayer;
        map.addLayer(wellsLayer, firstSymbol);
        setMapReady(true);
      } catch (error) {
        console.error("Dashboard map layers could not be attached.", error);
      }
    };
    if (map.isStyleLoaded()) attach();
    else map.once("style.load", attach);

    const inspectPoint = event => {
      const feature = event.features?.[0];
      if (!feature) return;
      const properties = feature.properties;
      popupRef.current?.remove();
      popupRef.current = new Popup({ closeButton: true, maxWidth: "260px" })
        .setLngLat(event.lngLat)
        .setHTML(`<b>${TYPE_META[properties.type]?.label || "Groundwater source"}</b><br>${properties.county}<br>${Number(properties.depth) >= 0 ? `Construction depth: ${format(properties.depth)} m` : "Construction depth: not recorded"}`)
        .addTo(map);
    };
    ["dashboard-points", "dashboard-depth", "dashboard-depth-coverage", "dashboard-well-sites"].forEach(layer => {
      map.on("click", layer, inspectPoint);
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    });

    const inspectSurface = event => {
      const properties = event.features?.[0]?.properties;
      if (!properties) return;
      const activeLayer = event.features[0].layer.id;
      const content = activeLayer === "dashboard-hex-density"
        ? `<b>3D record-density hexagon</b><br>${format(properties.records)} inventory records<br>${format(properties.depthCount)} depth measurements`
        : activeLayer.startsWith("dashboard-hex-depth")
          ? `<b>3D median-depth hexagon</b><br>${properties.depthOk ? `Median construction depth: ${format(properties.medianDepth)} m` : `Only ${format(properties.depthCount)} depth measurements — below the five-record threshold`}`
          : `<b>Inventory monitoring gap</b><br>Nearest mapped record: ${format(properties.gapKm)} km<br><small>This is an inventory-coverage gap, not a groundwater measurement.</small>`;
      popupRef.current?.remove();
      popupRef.current = new Popup({ closeButton: true, maxWidth: "285px" }).setLngLat(event.lngLat).setHTML(content).addTo(map);
    };
    ["dashboard-hex-density", "dashboard-hex-depth-thin", "dashboard-hex-depth", "dashboard-monitoring-gap"].forEach(layer => {
      map.on("click", layer, inspectSurface);
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    });

    return () => {
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleMapResize);
      popupRef.current?.remove();
      wellsLayerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [dataset, records, surfaceData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.getLayer("dashboard-density")) return;
    const clauses = [];
    if (activeTypes.length < Object.keys(TYPE_META).length) clauses.push(["in", ["get", "type"], ["literal", activeTypes]]);
    if (county !== "All counties") clauses.push(["==", ["get", "county"], county]);
    if (depthOnly) clauses.push(["==", ["get", "hasDepth"], 1]);
    if (mapMode === "timeline" && timelineIndex != null) {
      clauses.push([">=", ["get", "updateIndex"], 0]);
      clauses.push(timelineMode === "cumulative"
        ? ["<=", ["get", "updateIndex"], timelineIndex]
        : ["==", ["get", "updateIndex"], timelineIndex]);
    }
    const filter = clauses.length ? ["all", ...clauses] : null;
    const depthClauses = [...clauses, ["==", ["get", "hasDepth"], 1]];
    const depthFilter = ["all", ...depthClauses];
    map.setFilter("dashboard-density", filter);
    map.setFilter("dashboard-glow", filter);
    map.setFilter("dashboard-points", mapMode === "depth" ? depthFilter : filter);
    map.setFilter("dashboard-depth-coverage", filter);
    map.setFilter("dashboard-depth", ["all", ...depthClauses]);
    map.setFilter("dashboard-well-sites", ["all", ...depthClauses]);

    const visibleLayers = new Set(MODE_LAYERS[mapMode]);
    const syncAnalysisLayerVisibility = () => {
      ANALYSIS_LAYER_IDS.forEach(layer => {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visibleLayers.has(layer) ? "visible" : "none");
      });
    };
    syncAnalysisLayerVisibility();
    map.once("idle", syncAnalysisLayerVisibility);
    const wells3d = mapMode === "wells3d";
    const notebookSurface = NOTEBOOK_SURFACE_MODES.includes(mapMode);
    map.setLayoutProperty("terrain-hillshade", "visibility", wells3d ? "visible" : "none");
    map.setTerrain(wells3d ? { source: "terrain-dem", exaggeration: 1.35 } : null);
    if (wellsLayerRef.current) {
      wellsLayerRef.current.visible = wells3d;
      wellsLayerRef.current.setSelection(activeTypes, county);
      wellsLayerRef.current.setVerticalExaggeration(wellScale);
      if (wells3d) {
        wellsLayerRef.current.rebuild();
        map.once("idle", () => {
          if (wellsLayerRef.current?.visible) {
            wellsLayerRef.current.rebuild();
            map.triggerRepaint();
          }
        });
      }
    }
    if (county !== "All counties" && filtered.length) {
      const bounds = filtered.reduce((box, record) => box.extend([record[0], record[1]]), new LngLatBounds());
      map.fitBounds(bounds, { padding: 80, maxZoom: wells3d ? 8.5 : 10, duration: 900 });
      if (wells3d) map.easeTo({ pitch: 68, bearing: -18, duration: 1100 });
    } else if (county === "All counties") {
      map.flyTo(wells3d
        ? { center: [37.2, 0.05], zoom: 5.7, pitch: 68, bearing: -18, duration: 1200 }
        : notebookSurface
          ? { center: [37.85, 0.15], zoom: 5.3, pitch: 55, bearing: -14, duration: 1100 }
          : { center: [37.7, 0.15], zoom: 5.45, pitch: 0, bearing: 0, duration: 900 });
    }
    map.triggerRepaint();
    return () => map.off("idle", syncAnalysisLayerVisibility);
  }, [activeTypes, county, depthOnly, filtered, mapMode, mapReady, wellScale, timelineIndex, timelineMode]);

  const toggleType = type => setActiveTypes(current => current.includes(type) ? current.filter(item => item !== type) : [...current, type]);
  const selectMapMode = mode => {
    if (NOTEBOOK_SURFACE_MODES.includes(mode)) {
      setCounty("All counties");
      setActiveTypes(Object.keys(TYPE_META));
      setDepthOnly(false);
    }
    setMapMode(mode);
    window.history.replaceState(null, "", mode === "density" ? "#dashboard" : `#dashboard/${mode}`);
  };
  const reset = () => { setCounty("All counties"); setActiveTypes(Object.keys(TYPE_META)); setDepthOnly(false); selectMapMode("density"); };

  const viewMeta = {
    density: ["Record-density map", "Brighter areas contain more records; this is survey concentration, not groundwater abundance."],
    hexDensity: ["3D inventory density", "Notebook H3 output: height and colour show record concentration in each national grid cell."],
    hexDepth: ["3D median construction depth", "Notebook H3 output: height and colour show median depth; grey cells have fewer than five measurements."],
    monitoringGap: ["3D inventory monitoring gaps", "Notebook H3 output: taller, brighter cells are farther from the nearest mapped inventory record."],
    points: ["Groundwater-source locations", "Every visible point is one source record in the public inventory."],
    depth: ["Construction-depth map", "Colour and size compare 552 usable depth records; depth is not groundwater level."],
    coverage: ["Depth-data coverage", "Green records include construction depth; muted red records do not."],
    timeline: ["Record-update timeline", `${timelineMode === "cumulative" ? "Records updated up to" : "Records updated during"} ${timelineIndex == null ? "the selected month" : formatMonthIndex(timelineIndex)}. This is metadata activity, not drilling activity.`],
    wells3d: ["Wells below ground", `3D terrain with 552 usable construction depths projected downward at ${wellScale}× vertical exaggeration.`]
  };

  if (!dataset || !surfaceData) return <div className="dashboard-loading">Preparing dashboard data…</div>;

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <section className="panel filter-panel">
          <div className="panel-heading"><div><span>Controls</span><h2>Filters</h2></div><button onClick={reset}>Reset</button></div>
          <label className="field-label" htmlFor="county-filter">County</label>
          <select id="county-filter" value={county} onChange={event => setCounty(event.target.value)}>
            <option>All counties</option>{counties.map(item => <option key={item}>{item}</option>)}
          </select>
          <div className="field-label">Source type</div>
          <div className="checkbox-list">
            {Object.entries(TYPE_META).map(([type, meta]) => (
              <label key={type}><input type="checkbox" checked={activeTypes.includes(type)} onChange={() => toggleType(type)} /><i style={{ background: meta.color }} />{meta.label}</label>
            ))}
          </div>
          <label className="depth-toggle"><input type="checkbox" checked={depthOnly} onChange={event => setDepthOnly(event.target.checked)} /><span>Only records with depth</span></label>
        </section>

        <section className="panel screening-panel">
          <div className="panel-heading"><div><span>Notebook outputs</span><h2>Analysis view</h2></div></div>
          <div className="analysis-view-list">
            {Object.entries(viewMeta).map(([key, value]) => (
              <button className={mapMode === key ? "is-active" : ""} key={key} onClick={() => selectMapMode(key)}><i /> <span><b>{value[0]}</b><small>{value[1]}</small></span></button>
            ))}
          </div>
          <p className="panel-note"><b>Interpretation rule:</b> high record density means stronger inventory coverage. It does not by itself mean more groundwater is available.</p>
        </section>
      </aside>

      <section className="dashboard-map-panel">
        <div className="map-title"><div><b>{viewMeta[mapMode][0]}</b><span>{county} · {format(filtered.length)} visible records · {viewMeta[mapMode][1]}</span></div><span className="live-pill"><i /> Analysis current</span></div>
        {mapMode === "wells3d" && <div className="well-scale-control"><span>Analytical vertical scale</span>{[30, 150, 300].map(scale => <button className={wellScale === scale ? "is-active" : ""} key={scale} onClick={() => setWellScale(scale)}>{scale}×</button>)}</div>}
        {mapMode === "timeline" && <div className="timeline-control"><div><button className={timelineMode === "cumulative" ? "is-active" : ""} onClick={() => setTimelineMode("cumulative")}>Cumulative</button><button className={timelineMode === "month" ? "is-active" : ""} onClick={() => setTimelineMode("month")}>One month</button></div><label><b>{timelineIndex == null ? "Select month" : formatMonthIndex(timelineIndex)}</b><input type="range" min={timelineBounds[0]} max={timelineBounds[1]} value={timelineIndex ?? timelineBounds[1]} onChange={event => setTimelineIndex(Number(event.target.value))} /></label></div>}
        <div className="dashboard-map" ref={mapNode} />
        <div className="dashboard-legend">
          {mapMode === "wells3d" ? <><span><i style={{ background: "#f7f4dd" }} />Well position</span><span><i style={{ background: "#6de2c1" }} />≤50 m</span><span><i style={{ background: "#ffcc4a" }} />51–100 m</span><span><i style={{ background: "#ff7357" }} />101–200 m</span><span><i style={{ background: "#d93670" }} />&gt;200 m</span><span>Depth shafts shown at {wellScale}× · drag to rotate</span></> :
           mapMode === "hexDensity" ? <><span><i style={{ background: "#440154" }} />Fewer records</span><span><i style={{ background: "#35b779" }} />More records</span><span><i style={{ background: "#fde725" }} />Highest concentration</span><span>Height and colour show inventory density</span></> :
           mapMode === "hexDepth" ? <><span><i style={{ background: "#59636c" }} />Fewer than 5 depths</span><span><i style={{ background: "#0d0887" }} />Shallower median</span><span><i style={{ background: "#f0f921" }} />Deeper median</span><span>Construction depth—not water level</span></> :
           mapMode === "monitoringGap" ? <><span><i style={{ background: "#000004" }} />Near an inventory record</span><span><i style={{ background: "#b73779" }} />Larger record gap</span><span><i style={{ background: "#fcfdbf" }} />Largest gap</span><span>Not a groundwater quantity</span></> :
           mapMode === "timeline" ? <><span><i style={{ background: TYPE_META.bh.color }} />Visible update records</span><span>{timelineMode === "cumulative" ? "Cumulative through" : "Only"} {timelineIndex == null ? "selected month" : formatMonthIndex(timelineIndex)}</span><span>Dates describe record updates, not drilling</span></> :
           mapMode === "depth" ? <><span><i style={{ background: "#6de2c1" }} />Shallower construction</span><span><i style={{ background: "#ffcf4a" }} />Around 75 m</span><span><i style={{ background: "#d8366f" }} />Deeper construction</span></> :
           mapMode === "coverage" ? <><span><i style={{ background: "#6de2c1" }} />Depth recorded</span><span><i style={{ background: "#e2534a" }} />Depth missing</span></> :
           Object.entries(TYPE_META).map(([type, meta]) => <span key={type}><i style={{ background: meta.color }} />{meta.label}</span>)}
        </div>
      </section>

      <aside className={`dashboard-analytics${analyticsExpanded ? " is-expanded" : ""}`} aria-label="Groundwater statistics and charts">
        <section className="panel overview-panel">
          <div className="panel-heading"><div><span>Visible selection</span><h2>Inventory overview</h2></div><div className="panel-heading-actions"><b>{county === "All counties" ? "ALL" : county.toUpperCase()}</b><button className="analytics-expand-button" type="button" onClick={() => { setExpandedChart(null); setAnalyticsExpanded(value => !value); }} aria-expanded={analyticsExpanded} aria-label={analyticsExpanded ? "Collapse statistics panel" : "Expand statistics panel over the map"} title={analyticsExpanded ? "Collapse statistics panel (Esc)" : "Expand statistics panel"}><ExpandIcon expanded={analyticsExpanded} /></button></div></div>
          <div className="overview-kpis">
            <div><strong>{format(filtered.length)}</strong><span>records</span></div>
            <div><strong>{format(analytics.countyCount)}</strong><span>counties</span></div>
            <div><strong>{format(analytics.depths.length)}</strong><span>with depth</span></div>
          </div>
          <BarList rows={analytics.types} total={filtered.length} />
        </section>
        <section className="panel county-panel">
          <div className="panel-heading"><div><span>Record concentration</span><h2>Top counties</h2></div></div>
          <BarList rows={analytics.topCounties} total={filtered.length} />
        </section>
      </aside>

      <section className={`dashboard-bottom${expandedChart ? " has-expanded-chart" : ""}`}>
        <article className={`panel depth-panel${expandedChart === "depth" ? " is-expanded" : ""}`}>
          <div className="panel-heading"><div><span>{format(analytics.depths.length)} usable values</span><h2>Construction-depth distribution</h2></div><button className="analytics-expand-button" type="button" onClick={() => { setAnalyticsExpanded(false); setExpandedChart(value => value === "depth" ? null : "depth"); }} aria-expanded={expandedChart === "depth"} aria-label={expandedChart === "depth" ? "Collapse construction-depth chart" : "Expand construction-depth chart over the map"} title={expandedChart === "depth" ? "Collapse chart (Esc)" : "Expand chart"}><ExpandIcon expanded={expandedChart === "depth"} /></button></div>
          <DepthHistogram values={analytics.depths} />
        </article>
        <article className={`panel update-panel${expandedChart === "updates" ? " is-expanded" : ""}`}>
          <div className="panel-heading"><div><span>2013–2025</span><h2>Record-update years</h2></div><button className="analytics-expand-button" type="button" onClick={() => { setAnalyticsExpanded(false); setExpandedChart(value => value === "updates" ? null : "updates"); }} aria-expanded={expandedChart === "updates"} aria-label={expandedChart === "updates" ? "Collapse record-update chart" : "Expand record-update chart over the map"} title={expandedChart === "updates" ? "Collapse chart (Esc)" : "Expand chart"}><ExpandIcon expanded={expandedChart === "updates"} /></button></div>
          <UpdateChart rows={analytics.years} />
          <p className="chart-note">These are last-update years, not drilling or construction years.</p>
        </article>
      </section>
    </div>
  );
}
