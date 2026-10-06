// Kenya Groundwater Lens - Vanilla JS Application
// Static HTML/CSS/JavaScript application with MapLibre rendering

// Wells layer implementation
const VERTEX_SHADER = `
  attribute vec3 a_start;
  attribute vec3 a_end;
  attribute vec4 a_color;
  attribute vec2 a_corner;
  uniform mat4 u_matrix;
  uniform vec2 u_viewport;
  uniform float u_width;
  varying lowp vec4 v_color;
  void main() {
    vec4 start_clip = u_matrix * vec4(a_start, 1.0);
    vec4 end_clip = u_matrix * vec4(a_end, 1.0);
    vec2 start_ndc = start_clip.xy / start_clip.w;
    vec2 end_ndc = end_clip.xy / end_clip.w;
    vec2 direction = end_ndc - start_ndc;
    float direction_length = max(length(direction), 0.000001);
    vec2 normal = vec2(-direction.y, direction.x) / direction_length;
    vec4 position = mix(start_clip, end_clip, a_corner.x);
    position.xy += normal * a_corner.y * u_width * (2.0 / u_viewport) * position.w;
    gl_Position = position;
    v_color = a_color;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying lowp vec4 v_color;
  void main() {
    gl_FragColor = v_color;
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Unable to compile wells shader");
  }
  return shader;
}

function depthColor(depth) {
  if (depth <= 50) return [0.43, 0.89, 0.76, 0.95];
  if (depth <= 100) return [1, 0.8, 0.29, 0.98];
  if (depth <= 200) return [1, 0.45, 0.34, 0.98];
  return [0.85, 0.21, 0.44, 1];
}

const SHAFT_CORNERS = [
  [0, -1], [0, 1], [1, 1],
  [0, -1], [1, 1], [1, -1]
];

function createWellsBelowGroundLayer(records, verticalExaggeration = 8) {
  const wells = records.filter(record => record[4] != null);

  return {
    id: "wells-below-ground-custom",
    type: "custom",
    renderingMode: "3d",
    visible: false,
    vertexCount: 0,
    verticalExaggeration,
    activeTypes: null,
    activeCounty: "All counties",

    onAdd(map, gl) {
      this.map = map;
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertexShader);
      gl.attachShader(this.program, fragmentShader);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.program) || "Unable to link wells shader");
      }
      this.startLocation = gl.getAttribLocation(this.program, "a_start");
      this.endLocation = gl.getAttribLocation(this.program, "a_end");
      this.colorLocation = gl.getAttribLocation(this.program, "a_color");
      this.cornerLocation = gl.getAttribLocation(this.program, "a_corner");
      this.matrixLocation = gl.getUniformLocation(this.program, "u_matrix");
      this.viewportLocation = gl.getUniformLocation(this.program, "u_viewport");
      this.widthLocation = gl.getUniformLocation(this.program, "u_width");
      this.buffer = gl.createBuffer();
      this.rebuild(gl);
    },

    rebuild(glOverride) {
      const gl = glOverride || this.gl;
      if (!this.map || !gl) return;
      this.gl = gl;
      const vertices = [];
      wells.filter(record => (!this.activeTypes || this.activeTypes.includes(record[2])) && (this.activeCounty === "All counties" || record[3] === this.activeCounty))
        .forEach(([lon, lat, , , depth, , fallbackElevation]) => {
        const queried = this.map.queryTerrainElevation([lon, lat]);
        const surface = Number.isFinite(queried) ? queried : (Number.isFinite(fallbackElevation) ? fallbackElevation : 0);
        const bottom = surface - depth * this.verticalExaggeration;
        const topCoordinate = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], surface + 7);
        const bottomCoordinate = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], bottom);
        const color = depthColor(depth);
        SHAFT_CORNERS.forEach(corner => {
          vertices.push(
            topCoordinate.x, topCoordinate.y, topCoordinate.z,
            bottomCoordinate.x, bottomCoordinate.y, bottomCoordinate.z,
            ...color,
            ...corner
          );
        });
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
      this.vertexCount = vertices.length / 12;
    },

    setSelection(activeTypes, county) {
      this.activeTypes = activeTypes;
      this.activeCounty = county;
      this.rebuild();
    },

    setVerticalExaggeration(value) {
      this.verticalExaggeration = value;
      this.rebuild();
    },

    render(gl, options) {
      if (!this.visible || !this.vertexCount) return;
      const matrix = options?.defaultProjectionData?.mainMatrix || options;
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.startLocation);
      gl.vertexAttribPointer(this.startLocation, 3, gl.FLOAT, false, 48, 0);
      gl.enableVertexAttribArray(this.endLocation);
      gl.vertexAttribPointer(this.endLocation, 3, gl.FLOAT, false, 48, 12);
      gl.enableVertexAttribArray(this.colorLocation);
      gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 48, 24);
      gl.enableVertexAttribArray(this.cornerLocation);
      gl.vertexAttribPointer(this.cornerLocation, 2, gl.FLOAT, false, 48, 40);
      gl.uniformMatrix4fv(this.matrixLocation, false, matrix);
      gl.uniform2f(this.viewportLocation, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(this.widthLocation, 2.4);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      gl.enable(gl.DEPTH_TEST);
    },

    onRemove(map, gl) {
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      this.map = null;
      this.gl = null;
    }
  };
}

const MAP_STYLE = {
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

const TYPE_META = {
  bh: { label: "Borehole / tubewell", color: "#ffb21c" },
  pdw: { label: "Protected dug well", color: "#38c9f3" },
  udw: { label: "Unprotected dug well", color: "#70bce3" },
  ps: { label: "Protected spring", color: "#6de2c1" },
  us: { label: "Unprotected spring", color: "#a1d99b" }
};

const ANALYSIS_VIEWS = {
  density: ["Mapped-record density", "Brighter areas contain more mapped records; this is survey concentration, not groundwater abundance."],
  hexDensity: ["3D mapped-record density", "Notebook H3 output: height and colour show mapped-record concentration in each national grid cell."],
  hexDepth: ["3D median construction depth", "Notebook H3 output: height and colour show median depth; grey cells have fewer than five measurements."],
  monitoringGap: ["3D groundwater record coverage gaps", "Taller, brighter cells are farther from the nearest mapped groundwater-source record. This shows where records are sparse, not where groundwater is scarce."],
  points: ["Mapped groundwater-source records", "Every visible point is one mapped source record in the public inventory."],
  depth: ["Construction-depth map", "Colour and size compare 552 usable depth records; depth is not groundwater level."],
  coverage: ["Depth-data coverage", "Green records include construction depth; muted red records do not."],
  timeline: ["Record-update timeline", "Records updated up to the selected month. This is metadata activity, not drilling activity."],
  wells3d: ["Wells below ground", "3D terrain with 552 usable construction depths projected downward at 150× vertical exaggeration."]
};

const VIEW_GUIDE = {
  density: {
    group: "Where are records mapped?", title: "Where mapped records are concentrated", story: "#story-catch",
    seeing: "Bright areas have many mapped records close together.",
    question: "Does this show more sources, more survey work, or both?",
    next: "Compare the cluster with WRA files, county inventories and local field knowledge.",
    caution: "A bright area does not necessarily have more groundwater.",
    mini: "Bright = more mapped records, not more water."
  },
  hexDensity: {
    group: "Where are records mapped?", title: "Compare mapped-record counts in equal areas", story: "#story-catch",
    seeing: "Each equal-sized cell groups nearby mapped records. Taller, brighter cells contain more entries.",
    question: "Why are some equal-sized areas recorded much more heavily than others?",
    next: "Use the contrast to prioritise coverage checks, not to rank groundwater availability.",
    caution: "The height is a display aid. It is not the height or amount of groundwater.",
    mini: "Taller = more mapped records in the cell, not more water."
  },
  monitoringGap: {
    group: "Where are records mapped?", title: "Where nearby mapped records are scarce", story: "#story-gaps",
    seeing: "Taller, brighter cells are farther from the nearest mapped source record.",
    question: "Is this a real lack of sources, or a gap between datasets and survey coverage?",
    next: "Check WRA and county records, then plan targeted inventory work where evidence remains thin.",
    caution: "A large record gap does not prove that groundwater is absent or scarce.",
    mini: "Taller = farther from a recorded source, not less groundwater."
  },
  points: {
    group: "Where are records mapped?", title: "See each mapped source record", story: "#story-reading",
    seeing: "Each dot is one mapped record of a borehole, well or spring. Colours separate source types.",
    question: "Does this public entry match an official record and the source that exists today?",
    next: "Ask WRA, the county, data publisher and source owner or operator to confirm the location and record details.",
    caution: "A dot does not prove ownership, permit status, current use or a problem.",
    mini: "One dot = one record to check."
  },
  hexDepth: {
    group: "How deep were sources built?", title: "Compare typical recorded depth by area", story: "#story-quality",
    seeing: "Height and colour compare the middle recorded construction depth in cells with at least five depth values. Grey cells have fewer than five.",
    question: "Do unusually deep or shallow cells fit local geology and the original borehole records?",
    next: "Compare outlying cells with completion logs, original forms, permit information and technical knowledge.",
    caution: "Construction depth is not the water table, aquifer thickness or amount of water available.",
    mini: "Taller = built deeper, not more water."
  },
  depth: {
    group: "How deep were sources built?", title: "See sources with a recorded depth", story: "#story-quality",
    seeing: "Colour and dot size compare the 552 records with a usable construction depth.",
    question: "Which extreme values are valid deep sources, and which need a unit or entry check?",
    next: "Trace unusual depths to the source record, borehole log, owner or operator, and field evidence.",
    caution: "This small sample does not describe typical depth across all of Kenya.",
    mini: "Larger, warmer dots = built deeper, not more water."
  },
  coverage: {
    group: "How deep were sources built?", title: "See where depth is missing", story: "#story-reading",
    seeing: "Green records include a usable construction depth. Red records do not.",
    question: "Who may hold the missing depth: WRA, a county, the driller, owner, operator or data publisher?",
    next: "Use completion records and original forms to fill gaps only when the value can be supported.",
    caution: "Missing depth is not zero depth and does not show that anything is wrong.",
    mini: "Green = depth recorded. Red = depth missing."
  },
  wells3d: {
    group: "How deep were sources built?", title: "Look below the ground surface", story: "#story-quality",
    seeing: "Each coloured line starts at the ground surface and extends down by the recorded construction depth. Heights are stretched so they can be seen.",
    question: "Do the longest lines match construction documents and what is found at the site?",
    next: "Treat the longest lines as verification leads, especially where nearby records differ sharply.",
    caution: "The lines do not show the water table, aquifer shape, water quality or pumping capacity.",
    mini: "Longer = built deeper. Heights are stretched and are not real scale."
  },
  timeline: {
    group: "When were records last updated?", title: "When records were last updated", story: "#story-updates",
    seeing: "The map groups records by the month their database entry was last updated.",
    question: "Does an old date mean the source is unchanged, inactive, or simply not updated here?",
    next: "Check current status with WRA, counties, data publishers and source operators before using the record operationally.",
    caution: "The dates are not drilling, permit or water-use start dates.",
    mini: "Date = last record update, not drilling date."
  }
};

const VIEW_GROUPS = ["Where are records mapped?", "How deep were sources built?", "When were records last updated?"];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const motionDuration = duration => prefersReducedMotion ? 0 : duration;

const TYPE_COLOR = [
  "match", ["get", "t"],
  "bh", TYPE_META.bh.color,
  "pdw", TYPE_META.pdw.color,
  "udw", TYPE_META.udw.color,
  "ps", TYPE_META.ps.color,
  "us", TYPE_META.us.color,
  "#d4dce0"
];

const DURATION = 8500;

// Application State
const state = {
  activeView: 'story',
  dataset: null,
  surfaceData: null,
  animationMap: null,
  dashboardMap: null,
  analysisViewControl: null,
  fullscreenTitleControl: null,
  wellsLayer: null,
  currentScene: 0,
  playing: !prefersReducedMotion,
  mapMode: 'density',
  county: 'All counties',
  activeTypes: Object.keys(TYPE_META),
  depthOnly: false,
  wellScale: 150,
  timelineIndex: null,
  timelineMode: 'cumulative',
  analyticsExpanded: false,
  expandedChart: null,
  storyMapInitializing: false,
  dashboardInitializing: false
};

// Utility Functions
const format = value => Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 1 });

function formatMonthIndex(value) {
  const year = Math.floor(value / 12);
  const month = value % 12 + 1;
  return new Intl.DateTimeFormat("en-KE", { month: "short", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

// Scene definitions for animation
function buildScenes(summary) {
  return [
    {
      label: "The question",
      kicker: "WHERE ARE WATER-SOURCE RECORDS MAPPED?",
      title: `<em>${format(summary.total)}</em> mapped water-source records in ${format(summary.counties)} counties.`,
      copy: "Where should Kenya check groundwater records first—and which records need confirmation? This public list can reveal clusters, gaps, unusual values and records that may be old.",
      metrics: [[format(summary.total), "mapped records"], [format(summary.counties), "counties covered"]],
      guardrail: "This is a screening tool. It raises questions; official records and fieldwork answer them.",
      camera: { center: [37.75, 0.15], zoom: 5.35, pitch: 18, bearing: 0 },
      filter: null,
      color: TYPE_COLOR,
      radius: ["interpolate", ["linear"], ["zoom"], 4, 1.8, 7, 3.2, 10, 5],
      opacity: 0.78
    },
    {
      label: "The catch",
      kicker: "A MAP OF RECORDS IS NOT A MAP OF WATER",
      title: `<em>${summary.westernShare}%</em> of mapped records sit in just two counties.`,
      copy: `Kakamega and Vihiga contain ${format(summary.westernCount)} mapped records. Like a street with many restaurant reviews, this may show more recording activity, not more of the thing being counted.`,
      metrics: [[format(summary.countyCounts.Kakamega), "Kakamega mapped records"], [format(summary.countyCounts.Vihiga), "Vihiga mapped records"]],
      guardrail: "Bright means more mapped records, not more water. Quiet means less mapped information, not no water.",
      camera: { center: [34.75, 0.22], zoom: 7.25, pitch: 34, bearing: -9 },
      filter: ["in", ["get", "c"], ["literal", ["Kakamega", "Vihiga"]]],
      color: ["match", ["get", "c"], "Kakamega", "#38c9f3", "Vihiga", "#ffb21c", "#60737b"],
      radius: ["interpolate", ["linear"], ["zoom"], 5, 1.7, 8, 3.5, 11, 5],
      opacity: 0.72
    },
    {
      label: "Question the data",
      kicker: "A PRECISE VALUE CAN STILL NEED CHECKING",
      title: `<em>300 m</em> is recorded for two entries in Busia.`,
      copy: "Two nearby entries record 280 metres. These values may be valid, but the dashboard cannot confirm them. Original forms, borehole logs, permit information, local geology and a site check can.",
      metrics: [["300 m", "two Busia entries"], ["280 m", "two nearby entries"]],
      guardrail: "An unusual value is a verification lead, not proof that the record is wrong.",
      camera: { center: [34.07, 0.18], zoom: 9, pitch: 32, bearing: -8 },
      filter: ["all", ["==", ["get", "hasDepth"], 1], ["==", ["get", "c"], "Busia"]],
      color: ["interpolate", ["linear"], ["get", "depth"], 0, "#6de2c1", 75, "#ffcf4a", 200, "#ff775f", 600, "#d8366f"],
      radius: ["interpolate", ["linear"], ["get", "depth"], 0, 3, 100, 5, 600, 9],
      opacity: 0.9
    },
    {
      label: "Read the gaps",
      kicker: "MISSING INFORMATION CAN GUIDE THE NEXT CHECK",
      title: `Blank space means <em>missing evidence</em>, not missing groundwater.`,
      copy: "Bright clusters show stronger mapped-record coverage. Quiet areas show that this dataset has fewer nearby mapped records. Neither pattern, on its own, proves how much groundwater exists, how deep it lies or whether a source is active.",
      metrics: [[`${format(100 - summary.depthShare)}%`, "without usable depth"], [format(summary.total), "leads that still need context"]],
      guardrail: "The dashboard shows where to look. Fieldwork shows what is true.",
      camera: { center: [37.25, 0.1], zoom: 5.25, pitch: 38, bearing: -8 },
      filter: null,
      color: TYPE_COLOR,
      radius: ["interpolate", ["linear"], ["zoom"], 4, 1.7, 7, 3.3, 10, 5],
      opacity: 0.64
    },
    {
      label: "From dot to evidence",
      kicker: "A SHARED CHECKING PROCESS",
      title: `A dot on the map is a clue. <em>Checking turns it into a fact.</em>`,
      copy: `The map shows ${format(summary.wellCount)} mapped records of wells and boreholes that are worth a closer look. The other ${format(summary.total - summary.wellCount)} mapped records are springs. Each dot is a starting point, not an answer. WRA can work with counties, data publishers, source owners and operators to confirm what it represents.`,
      metrics: [[format(summary.wellCount), "mapped well and borehole records"], ["5 steps", "from a dot to a checked record"]],
      guardrail: "The map tells us where to look first. It does not replace WRA's files, expert checks or a visit to the site.",
      camera: { center: [37.45, 0.05], zoom: 5.15, pitch: 52, bearing: 12 },
      filter: ["in", ["get", "t"], ["literal", ["bh", "pdw", "udw"]]],
      color: "#38c9f3",
      radius: ["interpolate", ["linear"], ["zoom"], 4, 1.5, 8, 3],
      opacity: 0.24,
      flow: true,
      flowSteps: [
        { title: "Spot it", copy: "Pick a dot to check." },
        { title: "Find the record", copy: "Look in WRA's records." },
        { title: "Compare the papers", copy: "Match permits and files." },
        { title: "Visit the site", copy: "Check what is there." },
        { title: "Confirm or correct", copy: "Keep or fix the record." }
      ]
    }
  ];
}

// Initialize Animation Map
async function initAnimationMap() {
  if (state.animationMap || state.storyMapInitializing) return;
  state.storyMapInitializing = true;
  try {
    const response = await fetch('public/data/animation-points.json');
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.dataset = await response.json();
  } catch (error) {
    console.error('Failed to load animation data:', error);
    showMapNotice('story-animation', `Story data could not be loaded: ${error.message}`);
    state.storyMapInitializing = false;
    return;
  }

  renderAnimationUI();
  if (state.activeView === 'story') startAnimationTimer();

  const features = state.dataset.records.map(([lon, lat, type, county, depth], index) => ({
    type: "Feature",
    id: index,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { t: type, c: county, depth: depth ?? -1, hasDepth: depth == null ? 0 : 1 }
  }));

  const mapContainer = document.getElementById('animation-map');
  state.animationMap = new maplibregl.Map({
    container: mapContainer,
    style: structuredClone(MAP_STYLE),
    center: [37.75, 0.15],
    zoom: 5.35,
    pitch: 18,
    attributionControl: false,
    dragRotate: false,
    scrollZoom: false
  });

  state.animationMap.on('error', event => {
    const message = event?.error?.message || "The map background could not be loaded.";
    if (/style|source|tile|worker/i.test(message)) {
      showMapNotice('story-animation', 'The basemap is unavailable. The story text and local groundwater data remain available.');
    }
  });

  state.animationMap.on('style.load', () => {
    const firstSymbol = state.animationMap.getStyle()?.layers?.find(layer => layer.type === "symbol");

    state.animationMap.addSource('groundwater', { type: 'geojson', data: { type: 'FeatureCollection', features } });

    state.animationMap.addLayer({
      id: 'groundwater-glow',
      type: 'circle',
      source: 'groundwater',
      paint: {
        'circle-color': TYPE_COLOR,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 10],
        'circle-blur': 0.9,
        'circle-opacity': 0.26
      }
    }, firstSymbol?.id);

    state.animationMap.addLayer({
      id: 'groundwater-points',
      type: 'circle',
      source: 'groundwater',
      paint: {
        'circle-color': TYPE_COLOR,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 7, 3.2, 10, 5],
        'circle-opacity': 0.78,
        'circle-stroke-width': 0.35,
        'circle-stroke-color': 'rgba(255,255,255,0.58)'
      }
    }, firstSymbol?.id);

    updateScene();
    state.storyMapInitializing = false;
  });
}

function showMapNotice(containerId, message) {
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('.map-error')) return;
  const errorDiv = document.createElement('div');
  errorDiv.className = 'map-error';
  errorDiv.textContent = `Map notice: ${message}`;
  container.appendChild(errorDiv);
}

function showDashboardLoadError() {
  const message = 'The records could not be loaded. Please refresh the page and try again.';
  ['kpi-records', 'kpi-counties', 'kpi-depth'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.textContent = '—';
  });
  const depthCount = document.getElementById('depth-count');
  if (depthCount) depthCount.textContent = 'Records unavailable';
  ['type-bar-list', 'county-bar-list', 'depth-histogram', 'update-chart'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.remove('loading-state');
      element.textContent = message;
    }
  });
}

// Render Animation UI
function renderAnimationUI() {
  const scenes = buildScenes(state.dataset.summary);
  const sceneRail = document.getElementById('scene-rail');

  sceneRail.innerHTML = scenes.map((item, index) => `
    <button class="scene-tab ${index === state.currentScene ? 'is-active' : ''}" data-index="${index}">
      <span>${String(index + 1).padStart(2, '0')}</span><b>${item.label}</b>
    </button>
  `).join('');

  sceneRail.querySelectorAll('.scene-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentScene = parseInt(btn.dataset.index);
      updateScene();
    });
  });

  renderNarrative();
  renderFooter();
  renderLegend();
}

// Update Scene
function updateScene() {
  const scenes = buildScenes(state.dataset.summary);
  const scene = scenes[state.currentScene];

  if (!state.animationMap || !scene) return;

  state.animationMap.setFilter('groundwater-points', scene.filter);
  state.animationMap.setFilter('groundwater-glow', scene.filter);
  state.animationMap.setPaintProperty('groundwater-points', 'circle-color', scene.color);
  state.animationMap.setPaintProperty('groundwater-points', 'circle-radius', scene.radius);
  state.animationMap.setPaintProperty('groundwater-points', 'circle-opacity', scene.opacity);
  state.animationMap.setPaintProperty('groundwater-glow', 'circle-color', scene.color);
  state.animationMap.setPaintProperty('groundwater-glow', 'circle-opacity', Math.min(scene.opacity * 0.33, 0.3));
  state.animationMap.flyTo({ ...scene.camera, duration: motionDuration(2200), essential: false });

  // Update UI
  document.querySelectorAll('.scene-tab').forEach((btn, i) => {
    btn.classList.toggle('is-active', i === state.currentScene);
  });

  renderNarrative();
  renderFooter();
  renderLegend();
}

// Render Narrative
function renderNarrative() {
  const scenes = buildScenes(state.dataset.summary);
  const scene = scenes[state.currentScene];
  const narrative = document.getElementById('narrative');
  const storyAnimation = document.getElementById('story-animation');
  const mapCaption = document.getElementById('scene-map-caption');
  const flowSteps = scene.flowSteps || [
    { title: "Spot it", copy: "Pick a dot to check." },
    { title: "Find the record", copy: "Look in WRA's records." },
    { title: "Compare the papers", copy: "Match permits and files." },
    { title: "Visit the site", copy: "Check what is there." },
    { title: "Confirm or correct", copy: "Keep or fix the record." }
  ];

  storyAnimation.classList.toggle('is-checking-scene', Boolean(scene.flow));
  mapCaption.hidden = !scene.flow;

  narrative.innerHTML = `
    <p class="eyebrow">${scene.kicker}</p>
    <h1>${scene.title}</h1>
    <p class="scene-copy">${scene.copy}</p>
    <div class="metric-row">
      ${scene.metrics.map(([value, label]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join('')}
    </div>
    <div class="wra-flow ${scene.flow ? 'is-visible' : ''}" aria-label="Five steps from a map dot to a checked record">
      ${flowSteps.map((step, index) => `
        <div><span>${index + 1}</span><b>${step.title}</b><small>${step.copy}</small></div>${index < 4 ? '<i>→</i>' : ''}
      `).join('')}
    </div>
    <p class="guardrail"><span>Important</span> ${scene.guardrail}</p>
  `;
}

// Render Footer
function renderFooter() {
  const footer = document.getElementById('story-footer');
  footer.innerHTML = `
    <div class="controls">
      <button id="prev-scene">←</button>
      <button id="play-pause">
        <span id="play-icon">${state.playing ? 'Ⅱ' : '▶'}</span><span>${state.playing ? 'Pause' : 'Play'}</span>
      </button>
      <button id="next-scene">Next <span>→</span></button>
      <a class="story-scroll-cue" href="#water-story">Read the story ↓</a>
      <div class="scene-counter"><span>${String(state.currentScene + 1).padStart(2, '0')}</span> / 05</div>
    </div>
    <div class="progress-track">
      <span class="${state.playing ? 'is-running' : ''}" style="--scene-duration: ${DURATION}ms"></span>
    </div>
  `;

  document.getElementById('prev-scene').addEventListener('click', () => goToScene(state.currentScene - 1));
  document.getElementById('next-scene').addEventListener('click', () => goToScene(state.currentScene + 1));
  document.getElementById('play-pause').addEventListener('click', togglePlay);
  document.querySelector('.story-scroll-cue')?.addEventListener('click', event => {
    event.preventDefault();
    const storyPage = document.querySelector('.story-page');
    const storyBody = document.getElementById('water-story');
    if (!storyPage || !storyBody) return;
    state.playing = false;
    stopAnimationTimer();
    renderFooter();
    window.requestAnimationFrame(() => {
      storyBody.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
}

// Render Legend
function renderLegend() {
  const scenes = buildScenes(state.dataset.summary);
  const scene = scenes[state.currentScene];
  const legend = document.getElementById('animation-legend');

  if (scene.flow) {
    legend.style.display = 'none';
    return;
  }

  legend.innerHTML = `
    <span><i class="swatch borehole"></i>Borehole / tubewell</span>
    <span><i class="swatch dug"></i>Dug well</span>
    <span><i class="swatch spring"></i>Spring</span>
  `;
  legend.style.display = 'flex';
}

// Scene Navigation
function goToScene(index) {
  const scenes = buildScenes(state.dataset.summary);
  state.currentScene = (index + scenes.length) % scenes.length;
  updateScene();
}

function togglePlay() {
  state.playing = !state.playing;
  updateScene();
  if (state.playing) startAnimationTimer();
  else stopAnimationTimer();
}

// Auto-play timer
let animationTimer = null;
function startAnimationTimer() {
  stopAnimationTimer();
  if (!state.playing || state.activeView !== 'story' || !state.dataset) return;
  animationTimer = setTimeout(() => {
    goToScene(state.currentScene + 1);
    startAnimationTimer();
  }, DURATION);
}

function stopAnimationTimer() {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
}

// Keyboard controls
document.addEventListener('keydown', (event) => {
  if (state.activeView !== 'story' || /INPUT|SELECT|BUTTON|A|SUMMARY/.test(event.target.tagName)) return;
  if (event.key === 'ArrowRight') goToScene(state.currentScene + 1);
  if (event.key === 'ArrowLeft') goToScene(state.currentScene - 1);
  if (event.key === ' ') {
    event.preventDefault();
    togglePlay();
  }
});

// Story Page Content
function renderStoryContent() {
  const findings = [
    {
      number: "21,284",
      title: "Mapped records",
      text: "Wells, boreholes and springs appear in the public list."
    },
    {
      number: "40",
      title: "Counties covered",
      text: "Some counties have many mapped records. Others have very few."
    },
    {
      number: "552",
      title: "Records with depth",
      text: "Only 2.6% of records say how deep a source was built."
    }
  ];

  document.getElementById('finding-grid').innerHTML = findings.map(item => `
    <article class="finding-card">
      <strong>${item.number}</strong>
      <h3>${item.title}</h3>
      <p>${item.text}</p>
    </article>
  `).join('');

  const storyCta = document.getElementById('story-cta');
  if (storyCta) {
    storyCta.addEventListener('click', () => switchView('dashboard'));
  }

  document.querySelectorAll('.story-map-link').forEach(button => {
    button.addEventListener('click', () => {
      state.mapMode = button.dataset.mode || 'density';
      state.county = button.dataset.county || 'All counties';
      state.depthOnly = button.dataset.depthOnly === 'true';
      switchView('dashboard');
    });
  });
}

// Dashboard Initialization
async function initDashboard() {
  if (state.dashboardMap || state.dashboardInitializing) return;
  state.dashboardInitializing = true;
  try {
    const [inventoryRes, surfacesRes] = await Promise.all([
      fetch('public/data/animation-points.json'),
      fetch('public/data/notebook-surfaces.geojson')
    ]);

    if (!inventoryRes.ok) throw new Error(`Inventory data request failed (${inventoryRes.status})`);
    if (!surfacesRes.ok) throw new Error(`Surfaces data request failed (${surfacesRes.status})`);

    state.dataset = await inventoryRes.json();
    state.surfaceData = await surfacesRes.json();

    const monthValues = state.dataset.records.map(record => record[7]).filter(Number.isFinite);
    if (monthValues.length) state.timelineIndex = Math.max(...monthValues);
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    showMapNotice('dashboard-map', 'The records could not be loaded. Please refresh the page and try again.');
    showDashboardLoadError();
    state.dashboardInitializing = false;
    return;
  }

  renderDashboardUI();
  initDashboardMap();
}

// Render Dashboard UI
function renderDashboardUI() {
  // County filter
  const countySelect = document.getElementById('county-filter');
  const counties = state.dataset ? Object.keys(state.dataset.summary.countyCounts).sort() : [];
  countySelect.innerHTML = '<option value="All counties">All counties</option>' +
    counties.map(county => `<option value="${county}">${county}</option>`).join('');
  countySelect.value = state.county;

  const exampleCountySelect = document.getElementById('example-county-select');
  exampleCountySelect.innerHTML = '<option value="">Choose a county…</option>' +
    counties.map(county => `<option value="${county}">${county}</option>`).join('');
  exampleCountySelect.value = state.county === 'All counties' ? '' : state.county;

  // Type filters
  const typeFilters = document.getElementById('type-filters');
  typeFilters.innerHTML = Object.entries(TYPE_META).map(([type, meta]) => `
    <label>
      <input type="checkbox" value="${type}" checked />
      <i style="background: ${meta.color}"></i>${meta.label}
    </label>
  `).join('');

  typeFilters.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', () => {
      state.activeTypes = Array.from(typeFilters.querySelectorAll('input:checked')).map(i => i.value);
      updateDashboardFilters();
    });
  });

  countySelect.addEventListener('change', (e) => {
    state.county = e.target.value;
    exampleCountySelect.value = state.county === 'All counties' ? '' : state.county;
    updateDashboardFilters();
  });

  document.getElementById('depth-only').addEventListener('change', (e) => {
    state.depthOnly = e.target.checked;
    updateDashboardFilters();
  });

  document.getElementById('reset-filters').addEventListener('click', resetFilters);

  // Analysis views
  const analysisViews = document.getElementById('analysis-views');
  analysisViews.innerHTML = VIEW_GROUPS.map(group => {
    const groupId = `group-${group.replace(/\W+/g, '-').toLowerCase()}`;
    const buttons = Object.entries(VIEW_GUIDE).filter(([, guide]) => guide.group === group).map(([key, guide]) => `
      <button class="${state.mapMode === key ? 'is-active' : ''}" data-mode="${key}">
        <i aria-hidden="true"></i><span><b>${guide.title}</b><small>${ANALYSIS_VIEWS[key][0]}</small></span>
      </button>
    `).join('');
    return `<section class="analysis-group" aria-labelledby="${groupId}"><h3 id="${groupId}">${group}</h3>${buttons}</section>`;
  }).join('');

  analysisViews.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mapMode = btn.dataset.mode;
      updateDashboardMode();
    });
  });

  document.getElementById('depth-only').checked = state.depthOnly;
  exampleCountySelect.addEventListener('change', () => {
    if (!exampleCountySelect.value) return;
    state.county = exampleCountySelect.value;
    countySelect.value = state.county;
    updateDashboardFilters();
  });
  document.querySelector('[data-example-depth]')?.addEventListener('click', () => {
    state.depthOnly = true;
    document.getElementById('depth-only').checked = true;
    updateDashboardFilters();
  });

  const mobileFilterToggle = document.getElementById('mobile-filter-toggle');
  mobileFilterToggle?.addEventListener('click', () => {
    const expanded = mobileFilterToggle.getAttribute('aria-expanded') === 'true';
    mobileFilterToggle.setAttribute('aria-expanded', String(!expanded));
    document.getElementById('filter-panel').classList.toggle('is-mobile-open', !expanded);
  });

  const mobileViewToggle = document.getElementById('mobile-view-toggle');
  mobileViewToggle?.addEventListener('click', () => {
    const expanded = mobileViewToggle.getAttribute('aria-expanded') === 'true';
    mobileViewToggle.setAttribute('aria-expanded', String(!expanded));
    document.querySelector('.screening-panel').classList.toggle('is-mobile-open', !expanded);
    mobileViewToggle.textContent = expanded ? 'Choose a view' : 'Hide views';
  });

  // Well scale control
  document.querySelectorAll('#well-scale-control button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.wellScale = parseInt(btn.dataset.scale);
      document.querySelectorAll('#well-scale-control button').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      updateDashboardMode();
    });
  });

  // Timeline control
  document.getElementById('timeline-cumulative').addEventListener('click', () => {
    state.timelineMode = 'cumulative';
    updateTimelineUI();
  });
  document.getElementById('timeline-month').addEventListener('click', () => {
    state.timelineMode = 'month';
    updateTimelineUI();
  });
  document.getElementById('timeline-slider').addEventListener('input', (e) => {
    state.timelineIndex = parseInt(e.target.value);
    updateTimelineUI();
  });

  // Expand buttons
  document.getElementById('expand-analytics').addEventListener('click', () => {
    state.analyticsExpanded = !state.analyticsExpanded;
    state.expandedChart = null;
    updateExpandStates();
  });
  document.getElementById('expand-depth').addEventListener('click', () => {
    state.analyticsExpanded = false;
    state.expandedChart = state.expandedChart === 'depth' ? null : 'depth';
    updateExpandStates();
  });
  document.getElementById('expand-updates').addEventListener('click', () => {
    state.analyticsExpanded = false;
    state.expandedChart = state.expandedChart === 'updates' ? null : 'updates';
    updateExpandStates();
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.analyticsExpanded = false;
      state.expandedChart = null;
      updateExpandStates();
    }
  });

  updateAnalytics();
}

function createAnalysisViewControl(onSelect) {
  let container;
  let trigger;
  let currentLabel;
  let menu;
  let outsideClickHandler;

  const closeMenu = () => {
    if (!menu || !trigger) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };

  const control = {
    onAdd() {
      container = document.createElement('div');
      container.className = 'maplibregl-ctrl analysis-switcher-control';

      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'analysis-switcher-trigger';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML = '<span>Analysis views</span><b></b><i aria-hidden="true">▾</i>';
      currentLabel = trigger.querySelector('b');

      menu = document.createElement('div');
      menu.className = 'analysis-switcher-menu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;

      Object.entries(VIEW_GUIDE).forEach(([mode, guide]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.mode = mode;
        button.setAttribute('role', 'menuitemradio');
        button.innerHTML = `<i aria-hidden="true"></i><span>${guide.title}</span>`;
        button.addEventListener('click', event => {
          event.stopPropagation();
          onSelect(mode);
          closeMenu();
        });
        menu.appendChild(button);
      });

      trigger.addEventListener('click', event => {
        event.stopPropagation();
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
      });

      container.addEventListener('click', event => event.stopPropagation());
      container.append(trigger, menu);
      outsideClickHandler = () => closeMenu();
      document.addEventListener('click', outsideClickHandler);
      control.setActive(state.mapMode);
      return container;
    },

    onRemove() {
      document.removeEventListener('click', outsideClickHandler);
      container?.remove();
    },

    setActive(mode) {
      if (!currentLabel || !menu || !ANALYSIS_VIEWS[mode]) return;
      currentLabel.textContent = VIEW_GUIDE[mode].title;
      menu.querySelectorAll('button').forEach(button => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-checked', String(active));
      });
    }
  };

  return control;
}

function createFullscreenTitleControl() {
  let container;
  let title;
  let subtitle;

  return {
    onAdd() {
      container = document.createElement('section');
      container.className = 'maplibregl-ctrl fullscreen-map-title';
      container.setAttribute('aria-label', 'Current map view');
      title = document.createElement('strong');
      subtitle = document.createElement('span');
      container.append(title, subtitle);
      return container;
    },

    onRemove() {
      container?.remove();
    },

    setContent(titleText, subtitleText) {
      if (!title || !subtitle) return;
      title.textContent = titleText;
      subtitle.textContent = subtitleText;
    }
  };
}

// Initialize Dashboard Map
function initDashboardMap() {
  const records = state.dataset.records;
  const features = records.map(([lon, lat, type, recordCounty, depth, updateYear, elevation, updateIndex], index) => ({
    type: "Feature",
    id: index,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      t: type,
      c: recordCounty,
      depth: depth ?? -1,
      hasDepth: depth == null ? 0 : 1,
      updateYear: updateYear ?? -1,
      elevation: elevation ?? -1,
      updateIndex: updateIndex ?? -1
    }
  }));

  const mapContainer = document.getElementById('dashboard-map');
  state.dashboardMap = new maplibregl.Map({
    container: mapContainer,
    style: structuredClone(MAP_STYLE),
    center: [37.7, 0.15],
    zoom: 5.45,
    attributionControl: false
  });

  state.dashboardMap.on('error', event => {
    const message = event?.error?.message || '';
    if (/style|source|tile|worker/i.test(message)) {
      showMapNotice('dashboard-map', 'The remote basemap is unavailable. Local analysis layers will appear when MapLibre can finish loading.');
    }
  });

  state.dashboardMap.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
  state.dashboardMap.addControl(new maplibregl.FullscreenControl(), 'top-right');
  const syncFullscreenLegend = () => {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    mapContainer.classList.toggle('is-dashboard-fullscreen', fullscreenElement === mapContainer);
  };
  document.addEventListener('fullscreenchange', syncFullscreenLegend);
  document.addEventListener('webkitfullscreenchange', syncFullscreenLegend);
  state.fullscreenTitleControl = createFullscreenTitleControl();
  state.dashboardMap.addControl(state.fullscreenTitleControl, 'top-left');
  state.analysisViewControl = createAnalysisViewControl(mode => {
    state.mapMode = mode;
    updateDashboardMode();
  });
  state.dashboardMap.addControl(state.analysisViewControl, 'top-left');
  state.dashboardMap.on('style.load', () => {
    const firstSymbol = state.dashboardMap.getStyle()?.layers?.find(layer => layer.type === 'symbol');

    // Terrain source
    state.dashboardMap.addSource('terrain-dem', {
      type: 'raster-dem',
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 13
    });

    state.dashboardMap.addLayer({
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: 'terrain-dem',
      layout: { visibility: 'none' },
      paint: {
        'hillshade-shadow-color': '#071015',
        'hillshade-highlight-color': '#7ea6a3',
        'hillshade-accent-color': '#244a51',
        'hillshade-exaggeration': 0.58
      }
    }, firstSymbol?.id);

    // Notebook surfaces
    state.dashboardMap.addSource('notebook-surfaces', { type: 'geojson', data: state.surfaceData });

    state.dashboardMap.addLayer({
      id: 'dashboard-hex-density',
      type: 'fill-extrusion',
      source: 'notebook-surfaces',
      filter: ['>', ['get', 'records'], 0],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'densityScore'], 0, '#440154', 0.3, '#31688e', 0.55, '#35b779', 1, '#fde725'],
        'fill-extrusion-height': ['get', 'densityHeight'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.86
      }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-hex-depth-thin',
      type: 'fill-extrusion',
      source: 'notebook-surfaces',
      filter: ['all', ['>', ['get', 'records'], 0], ['==', ['get', 'depthOk'], false]],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': '#59636c',
        'fill-extrusion-height': 2600,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.72
      }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-hex-depth',
      type: 'fill-extrusion',
      source: 'notebook-surfaces',
      filter: ['==', ['get', 'depthOk'], true],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'depthScore'], 0, '#0d0887', 0.35, '#9c179e', 0.7, '#ed7953', 1, '#f0f921'],
        'fill-extrusion-height': ['get', 'depthHeight'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.88
      }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-monitoring-gap',
      type: 'fill-extrusion',
      source: 'notebook-surfaces',
      filter: ['==', ['get', 'insideKenya'], true],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'gapScore'], 0, '#000004', 0.3, '#51127c', 0.65, '#b73779', 1, '#fcfdbf'],
        'fill-extrusion-height': ['get', 'gapHeight'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.88
      }
    }, firstSymbol?.id);

    // Groundwater points
    state.dashboardMap.addSource('dashboard-groundwater', { type: 'geojson', data: { type: 'FeatureCollection', features } });

    state.dashboardMap.addLayer({
      id: 'dashboard-density',
      type: 'heatmap',
      source: 'dashboard-groundwater',
      maxzoom: 11,
      layout: { visibility: 'visible' },
      paint: {
        'heatmap-weight': 0.75,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 9, 1.7],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 9, 27],
        'heatmap-opacity': 0.86,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(7,16,20,0)', 0.18, '#153a50', 0.42, '#087ea8', 0.7, '#f3b522', 1, '#f05b3f']
      }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-glow',
      type: 'circle',
      source: 'dashboard-groundwater',
      layout: { visibility: 'none' },
      paint: { 'circle-color': TYPE_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 9, 11], 'circle-blur': 0.82, 'circle-opacity': 0.3 }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-points',
      type: 'circle',
      source: 'dashboard-groundwater',
      layout: { visibility: 'none' },
      paint: { 'circle-color': TYPE_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.2, 8, 5.2, 12, 7], 'circle-opacity': 0.9, 'circle-stroke-width': 0.55, 'circle-stroke-color': '#ffffff' }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-depth',
      type: 'circle',
      source: 'dashboard-groundwater',
      filter: ['==', ['get', 'hasDepth'], 1],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': ['interpolate', ['linear'], ['get', 'depth'], 0, '#6de2c1', 75, '#ffcf4a', 200, '#ff775f', 600, '#d8366f'],
        'circle-radius': ['interpolate', ['linear'], ['get', 'depth'], 0, 4.5, 100, 6.5, 600, 10],
        'circle-opacity': 0.9,
        'circle-stroke-width': 0.7,
        'circle-stroke-color': '#ffffff'
      }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-depth-coverage',
      type: 'circle',
      source: 'dashboard-groundwater',
      layout: { visibility: 'none' },
      paint: {
        'circle-color': ['match', ['get', 'hasDepth'], 1, '#6de2c1', '#e2534a'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.2, 9, 6],
        'circle-opacity': ['match', ['get', 'hasDepth'], 1, 0.94, 0.5]
      }
    }, firstSymbol?.id);

    state.dashboardMap.addLayer({
      id: 'dashboard-well-sites',
      type: 'circle',
      source: 'dashboard-groundwater',
      filter: ['==', ['get', 'hasDepth'], 1],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': '#f7f4dd',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 8, 4.5, 11, 7],
        'circle-opacity': 0.94,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffb21c'
      }
    }, firstSymbol?.id);

    // Popups
    const inspectPoint = event => {
      const feature = event.features?.[0];
      if (!feature) return;
      const properties = feature.properties;
      new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(event.lngLat)
        .setHTML(`<b>${TYPE_META[properties.t]?.label || "Groundwater source"}</b><br>${properties.c}<br>${Number(properties.depth) >= 0 ? `Construction depth: ${format(properties.depth)} m` : "Construction depth: not recorded"}`)
        .addTo(state.dashboardMap);
    };

    ['dashboard-points', 'dashboard-depth', 'dashboard-depth-coverage', 'dashboard-well-sites'].forEach(layer => {
      state.dashboardMap.on('click', layer, inspectPoint);
      state.dashboardMap.on('mouseenter', layer, () => { state.dashboardMap.getCanvas().style.cursor = 'pointer'; });
      state.dashboardMap.on('mouseleave', layer, () => { state.dashboardMap.getCanvas().style.cursor = ''; });
    });

    const inspectSurface = event => {
      const properties = event.features?.[0]?.properties;
      if (!properties) return;
      const activeLayer = event.features[0].layer.id;
      const content = activeLayer === 'dashboard-hex-density'
        ? `<b>3D record-density hexagon</b><br>${format(properties.records)} inventory records<br>${format(properties.depthCount)} depth measurements`
        : activeLayer.startsWith('dashboard-hex-depth')
          ? `<b>3D median-depth hexagon</b><br>${properties.depthOk ? `Median construction depth: ${format(properties.medianDepth)} m` : `Only ${format(properties.depthCount)} depth measurements, below the five-record threshold`}`
          : `<b>Groundwater record coverage gap</b><br>Nearest mapped record: ${format(properties.gapKm)} km<br><small>This shows sparse record coverage, not groundwater scarcity.</small>`;
      new maplibregl.Popup({ closeButton: true, maxWidth: '285px' }).setLngLat(event.lngLat).setHTML(content).addTo(state.dashboardMap);
    };

    ['dashboard-hex-density', 'dashboard-hex-depth-thin', 'dashboard-hex-depth', 'dashboard-monitoring-gap'].forEach(layer => {
      state.dashboardMap.on('click', layer, inspectSurface);
      state.dashboardMap.on('mouseenter', layer, () => { state.dashboardMap.getCanvas().style.cursor = 'pointer'; });
      state.dashboardMap.on('mouseleave', layer, () => { state.dashboardMap.getCanvas().style.cursor = ''; });
    });

    updateDashboardMode();
    state.dashboardInitializing = false;
  });
}

// Update Dashboard Filters
function updateDashboardFilters() {
  if (!state.dashboardMap) return;

  const records = state.dataset.records;
  const filtered = records.filter(record => {
    const [, , type, recordCounty, depth, , , updateIndex] = record;
    const timeVisible = state.mapMode !== 'timeline' || state.timelineIndex == null ||
      (Number.isFinite(updateIndex) && (state.timelineMode === 'cumulative' ? updateIndex <= state.timelineIndex : updateIndex === state.timelineIndex));
    return state.activeTypes.includes(type) &&
      (state.county === 'All counties' || recordCounty === state.county) &&
      (!state.depthOnly || depth != null) &&
      timeVisible;
  });

  const clauses = [];
  if (state.activeTypes.length < Object.keys(TYPE_META).length) clauses.push(['in', ['get', 't'], ['literal', state.activeTypes]]);
  if (state.county !== 'All counties') clauses.push(['==', ['get', 'c'], state.county]);
  if (state.depthOnly) clauses.push(['==', ['get', 'hasDepth'], 1]);
  if (state.mapMode === 'timeline' && state.timelineIndex != null) {
    clauses.push(['>=', ['get', 'updateIndex'], 0]);
    clauses.push(state.timelineMode === 'cumulative'
      ? ['<=', ['get', 'updateIndex'], state.timelineIndex]
      : ['==', ['get', 'updateIndex'], state.timelineIndex]);
  }
  const filter = clauses.length ? ['all', ...clauses] : null;
  const depthClauses = [...clauses, ['==', ['get', 'hasDepth'], 1]];
  const depthFilter = ['all', ...depthClauses];

  state.dashboardMap.setFilter('dashboard-density', filter);
  state.dashboardMap.setFilter('dashboard-glow', filter);
  state.dashboardMap.setFilter('dashboard-points', state.mapMode === 'depth' ? depthFilter : filter);
  state.dashboardMap.setFilter('dashboard-depth-coverage', filter);
  state.dashboardMap.setFilter('dashboard-depth', ['all', ...depthClauses]);
  state.dashboardMap.setFilter('dashboard-well-sites', ['all', ...depthClauses]);

  updateAnalytics(filtered);
}

function updateViewGuide() {
  const guide = VIEW_GUIDE[state.mapMode];
  if (!guide) return;
  document.getElementById('view-question').textContent = guide.group;
  document.getElementById('view-plain-title').textContent = guide.title;
  document.getElementById('view-technical-title').textContent = ANALYSIS_VIEWS[state.mapMode][0];
  document.getElementById('view-seeing').textContent = guide.seeing;
  document.getElementById('view-question-raised').textContent = guide.question;
  document.getElementById('view-next-check').textContent = guide.next;
  document.getElementById('view-caution').textContent = guide.caution;
  document.getElementById('heavy-view-note').hidden = state.mapMode !== 'wells3d';
  const storyLink = document.getElementById('view-story-link');
  storyLink.href = guide.story;
  storyLink.dataset.storyTarget = guide.story;
}

// Update Dashboard Mode
function updateDashboardMode() {
  if (!state.dashboardMap) return;

  const MODE_LAYERS = {
    density: ['dashboard-density'],
    hexDensity: ['dashboard-hex-density'],
    hexDepth: ['dashboard-hex-depth-thin', 'dashboard-hex-depth'],
    monitoringGap: ['dashboard-monitoring-gap'],
    points: ['dashboard-glow', 'dashboard-points'],
    depth: ['dashboard-depth'],
    coverage: ['dashboard-depth-coverage'],
    timeline: ['dashboard-glow', 'dashboard-points'],
    wells3d: ['dashboard-well-sites']
  };

  const NOTEBOOK_SURFACE_MODES = ['hexDensity', 'hexDepth', 'monitoringGap'];
  const visibleLayers = new Set(MODE_LAYERS[state.mapMode]);

  ['dashboard-density', 'dashboard-glow', 'dashboard-points', 'dashboard-depth', 'dashboard-depth-coverage', 'dashboard-well-sites',
   'dashboard-hex-density', 'dashboard-hex-depth-thin', 'dashboard-hex-depth', 'dashboard-monitoring-gap'].forEach(layer => {
    if (state.dashboardMap.getLayer(layer)) {
      state.dashboardMap.setLayoutProperty(layer, 'visibility', visibleLayers.has(layer) ? 'visible' : 'none');
    }
  });

  const wells3d = state.mapMode === 'wells3d';
  const notebookSurface = NOTEBOOK_SURFACE_MODES.includes(state.mapMode);
  state.dashboardMap.setLayoutProperty('terrain-hillshade', 'visibility', wells3d ? 'visible' : 'none');
  state.dashboardMap.setTerrain(wells3d ? { source: 'terrain-dem', exaggeration: 1.35 } : null);

  // The custom WebGL layer is expensive and can interfere with initial canvas
  // readiness on some browsers, so create it only when the 3D wells view opens.
  if (wells3d && !state.wellsLayer) {
    state.wellsLayer = createWellsBelowGroundLayer(state.dataset.records, state.wellScale);
    state.dashboardMap.addLayer(state.wellsLayer);
  }

  // Update wells layer
  if (state.wellsLayer) {
    state.wellsLayer.visible = wells3d;
    state.wellsLayer.setSelection(state.activeTypes, state.county);
    state.wellsLayer.setVerticalExaggeration(state.wellScale);
    if (wells3d) {
      state.wellsLayer.rebuild();
      state.dashboardMap.once('idle', () => {
        if (state.wellsLayer?.visible) {
          state.wellsLayer.rebuild();
          state.dashboardMap.triggerRepaint();
        }
      });
    }
  }

  // Update UI
  const currentTitle = VIEW_GUIDE[state.mapMode].title;
  const currentSubtitle = `${ANALYSIS_VIEWS[state.mapMode][0]} · ${state.county} · ${format(getFilteredRecords().length)} visible mapped records`;
  state.fullscreenTitleControl?.setContent(currentTitle, currentSubtitle);
  state.analysisViewControl?.setActive(state.mapMode);

  document.getElementById('well-scale-control').style.display = state.mapMode === 'wells3d' ? 'flex' : 'none';
  document.getElementById('timeline-control').style.display = state.mapMode === 'timeline' ? 'grid' : 'none';

  updateLegend();
  updateViewGuide();

  // Camera movement
  if (state.county !== 'All counties' && getFilteredRecords().length) {
    const filtered = getFilteredRecords();
    const bounds = filtered.reduce((box, record) => box.extend([record[0], record[1]]), new maplibregl.LngLatBounds());
    state.dashboardMap.fitBounds(bounds, { padding: 80, maxZoom: wells3d ? 8.5 : 10, duration: motionDuration(900) });
    if (wells3d) state.dashboardMap.easeTo({ pitch: 68, bearing: -18, duration: motionDuration(1100) });
  } else if (state.county === 'All counties') {
    state.dashboardMap.flyTo(wells3d
      ? { center: [37.2, 0.05], zoom: 5.7, pitch: 68, bearing: -18, duration: motionDuration(1200) }
      : notebookSurface
        ? { center: [37.85, 0.15], zoom: 5.3, pitch: 55, bearing: -14, duration: motionDuration(1100) }
        : { center: [37.7, 0.15], zoom: 5.45, pitch: 0, bearing: 0, duration: motionDuration(900) });
  }

  // Update analysis view buttons
  document.querySelectorAll('#analysis-views button').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.mode === state.mapMode);
  });

  updateDashboardFilters();
  state.dashboardMap.resize();
  state.dashboardMap.triggerRepaint();
}

// Get Filtered Records
function getFilteredRecords() {
  const records = state.dataset.records;
  return records.filter(record => {
    const [, , type, recordCounty, depth, , , updateIndex] = record;
    const timeVisible = state.mapMode !== 'timeline' || state.timelineIndex == null ||
      (Number.isFinite(updateIndex) && (state.timelineMode === 'cumulative' ? updateIndex <= state.timelineIndex : updateIndex === state.timelineIndex));
    return state.activeTypes.includes(type) &&
      (state.county === 'All counties' || recordCounty === state.county) &&
      (!state.depthOnly || depth != null) &&
      timeVisible;
  });
}

// Update Analytics
function updateAnalytics(filtered = getFilteredRecords()) {
  const countyCounts = new Map();
  const typeCounts = Object.fromEntries(Object.keys(TYPE_META).map(type => [type, 0]));
  const depths = [];
  const updateYears = new Map();

  filtered.forEach(record => {
    const [, , type, recordCounty, depth, updateYear] = record;
    countyCounts.set(recordCounty, (countyCounts.get(recordCounty) || 0) + 1);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    if (depth != null) depths.push(depth);
    if (updateYear != null) updateYears.set(updateYear, (updateYears.get(updateYear) || 0) + 1);
  });

  const topCounties = [...countyCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  const types = Object.entries(typeCounts).map(([type, value]) => ({ label: TYPE_META[type].label, value, color: TYPE_META[type].color }));
  const years = [...updateYears].sort((a, b) => a[0] - b[0]).map(([label, value]) => ({ label, value }));

  // Update KPIs
  document.getElementById('kpi-records').textContent = format(filtered.length);
  document.getElementById('kpi-counties').textContent = format(countyCounts.size);
  document.getElementById('kpi-depth').textContent = format(depths.length);
  document.getElementById('overview-county').textContent = state.county === 'All counties' ? 'ALL' : state.county.toUpperCase();
  document.getElementById('depth-count').textContent = `${format(depths.length)} usable values`;

  document.getElementById('depth-histogram').setAttribute('aria-label', `${format(depths.length)} visible sources have a usable recorded construction depth.`);
  document.getElementById('update-chart').setAttribute('aria-label', `${format(years.reduce((sum, row) => sum + row.value, 0))} visible records have a usable last-update year.`);

  // Update bar lists
  renderBarList('type-bar-list', types, filtered.length);
  renderBarList('county-bar-list', topCounties, filtered.length);

  // Update charts
  renderDepthHistogram(depths);
  renderUpdateChart(years);
}

// Render Bar List
function renderBarList(containerId, rows, total) {
  const container = document.getElementById(containerId);
  container.classList.remove('loading-state');
  if (!rows.length || total === 0) {
    container.innerHTML = '<p class="empty-state">No records match these filters. Try clearing one.</p>';
    return;
  }

  const maximum = Math.max(...rows.map(row => row.value));
  container.innerHTML = rows.map(row => `
    <div class="bar-row">
      <div><span>${row.label}</span><b>${format(row.value)}</b></div>
      <div class="bar-track"><i style="width: ${100 * row.value / maximum}%; background: ${row.color || 'var(--cyan)'}"></i></div>
      ${total ? `<small>${(100 * row.value / total).toFixed(1)}%</small>` : ''}
    </div>
  `).join('');
}

// Render Depth Histogram
function renderDepthHistogram(values) {
  const container = document.getElementById('depth-histogram');
  container.classList.remove('loading-state');
  if (!values.length) {
    container.innerHTML = '<p class="empty-state">None of these records has a usable depth. Try clearing the depth filter or choosing another county.</p>';
    return;
  }

  const bins = [
    { label: '0–25 m', min: 0, max: 25 },
    { label: '26–50', min: 25, max: 50 },
    { label: '51–75', min: 50, max: 75 },
    { label: '76–100', min: 75, max: 100 },
    { label: '101–200', min: 100, max: 200 },
    { label: '>200', min: 200, max: Infinity }
  ].map(bin => ({ ...bin, value: values.filter(value => value > bin.min && value <= bin.max).length }));

  const maximum = Math.max(...bins.map(bin => bin.value));
  container.innerHTML = bins.map(bin => `
    <div class="histogram-column">
      <b>${bin.value}</b><i style="height: ${Math.max(4, 100 * bin.value / maximum)}%"></i><span>${bin.label}</span>
    </div>
  `).join('');
}

// Render Update Chart
function renderUpdateChart(rows) {
  const container = document.getElementById('update-chart');
  container.classList.remove('loading-state');
  if (!rows.length) {
    container.innerHTML = '<p class="empty-state">These records do not have a usable update date. Try another selection.</p>';
    return;
  }

  const maximum = Math.max(...rows.map(row => row.value));
  container.innerHTML = rows.map(row => `
    <div><b>${format(row.value)}</b><i style="height: ${Math.max(4, 100 * row.value / maximum)}%"></i><span>${row.label}</span></div>
  `).join('');
}

// Update Timeline UI
function updateTimelineUI() {
  const records = state.dataset.records;
  const timelineBounds = records.map(record => record[7]).filter(Number.isFinite);
  const [min, max] = timelineBounds.length ? [Math.min(...timelineBounds), Math.max(...timelineBounds)] : [0, 0];

  document.getElementById('timeline-cumulative').classList.toggle('is-active', state.timelineMode === 'cumulative');
  document.getElementById('timeline-month').classList.toggle('is-active', state.timelineMode === 'month');
  document.getElementById('timeline-slider').min = min;
  document.getElementById('timeline-slider').max = max;
  document.getElementById('timeline-slider').value = state.timelineIndex ?? max;
  document.getElementById('timeline-label').textContent = state.timelineIndex == null ? 'Choose a month' : formatMonthIndex(state.timelineIndex);

  updateDashboardFilters();
  updateLegend();
}

// Update Legend
function getLegendMarkup(mode) {
  if (mode === 'wells3d') {
    return `
      <span><i style="background: #f7f4dd"></i>Well position</span>
      <span><i style="background: #6de2c1"></i>≤50 m</span>
      <span><i style="background: #ffcc4a"></i>51–100 m</span>
      <span><i style="background: #ff7357"></i>101–200 m</span>
      <span><i style="background: #d93670"></i>>200 m</span>
      <span>Depth shafts shown at ${state.wellScale}× · drag to rotate</span>
    `;
  }
  if (mode === 'hexDensity') {
    return `
      <span><i style="background: #440154"></i>Fewer records</span>
      <span><i style="background: #35b779"></i>More records</span>
      <span><i style="background: #fde725"></i>Highest concentration</span>
      <span>Height and colour show inventory density</span>
    `;
  }
  if (mode === 'hexDepth') {
    return `
      <span><i style="background: #59636c"></i>Fewer than 5 depths</span>
      <span><i style="background: #0d0887"></i>Shallower median</span>
      <span><i style="background: #f0f921"></i>Deeper median</span>
      <span>Construction depth, not water level</span>
    `;
  }
  if (mode === 'monitoringGap') {
    return `
      <span><i style="background: #000004"></i>Near an inventory record</span>
      <span><i style="background: #b73779"></i>Larger record gap</span>
      <span><i style="background: #fcfdbf"></i>Largest gap</span>
      <span>Not a groundwater quantity</span>
    `;
  }
  if (mode === 'timeline') {
    return `
      <span><i style="background: ${TYPE_META.bh.color}"></i>Visible update records</span>
      <span>${state.timelineMode === 'cumulative' ? 'Running total through' : 'One month only:'} ${state.timelineIndex == null ? 'chosen month' : formatMonthIndex(state.timelineIndex)}</span>
      <span>Dates describe record updates, not drilling</span>
    `;
  }
  if (mode === 'depth') {
    return `
      <span><i style="background: #6de2c1"></i>Shallower construction</span>
      <span><i style="background: #ffcf4a"></i>Around 75 m</span>
      <span><i style="background: #d8366f"></i>Deeper construction</span>
    `;
  }
  if (mode === 'coverage') {
    return `
      <span><i style="background: #6de2c1"></i>Depth recorded</span>
      <span><i style="background: #e2534a"></i>Depth missing</span>
    `;
  }
  if (mode === 'density') {
    return `
      <span><i style="background: #153a50"></i>Lower record density</span>
      <span><i style="background: #087ea8"></i>Medium record density</span>
      <span><i style="background: #f05b3f"></i>Highest record density</span>
      <span>More records, not more groundwater</span>
    `;
  }
  return Object.values(TYPE_META).map(meta =>
    `<span><i style="background: ${meta.color}"></i>${meta.label}</span>`
  ).join('');
}

function updateLegend() {
  const mode = state.mapMode;
  const markup = getLegendMarkup(mode);
  document.getElementById('dashboard-legend').innerHTML = markup;
  const fullscreenLegend = document.getElementById('dashboard-fullscreen-legend');
  fullscreenLegend.innerHTML = markup;
  fullscreenLegend.setAttribute('aria-label', `Fullscreen legend for ${ANALYSIS_VIEWS[mode][0]}`);
}

// Update Expand States
function updateExpandStates() {
  const analytics = document.getElementById('dashboard-analytics');
  const bottom = document.getElementById('dashboard-bottom');
  const depthPanel = document.querySelector('.depth-panel');
  const updatePanel = document.querySelector('.update-panel');

  analytics.classList.toggle('is-expanded', state.analyticsExpanded);
  bottom.classList.toggle('has-expanded-chart', state.expandedChart);
  depthPanel.classList.toggle('is-expanded', state.expandedChart === 'depth');
  updatePanel.classList.toggle('is-expanded', state.expandedChart === 'updates');

  document.getElementById('expand-analytics').setAttribute('aria-expanded', state.analyticsExpanded);
  document.getElementById('expand-depth').setAttribute('aria-expanded', state.expandedChart === 'depth');
  document.getElementById('expand-updates').setAttribute('aria-expanded', state.expandedChart === 'updates');
}

// Reset Filters
function resetFilters() {
  state.county = 'All counties';
  state.activeTypes = Object.keys(TYPE_META);
  state.depthOnly = false;
  state.mapMode = 'density';

  document.getElementById('county-filter').value = 'All counties';
  document.getElementById('example-county-select').value = '';
  document.querySelectorAll('#type-filters input').forEach(input => input.checked = true);
  document.getElementById('depth-only').checked = false;

  updateDashboardMode();
}

// View Switching
function switchView(view) {
  state.activeView = view;
  document.body.classList.toggle('dashboard-open', view === 'dashboard');

  const storyView = document.getElementById('story-view');
  const dashboardView = document.getElementById('dashboard-view');
  const navStory = document.getElementById('nav-story');
  const navDashboard = document.getElementById('nav-dashboard');

  if (view === 'story') {
    storyView.style.display = 'block';
    dashboardView.style.display = 'none';
    navStory.classList.add('is-active');
    navDashboard.classList.remove('is-active');
    if (!state.animationMap) initAnimationMap();
    else window.requestAnimationFrame(() => state.animationMap.resize());
    startAnimationTimer();
  } else {
    storyView.style.display = 'none';
    dashboardView.style.display = 'block';
    navStory.classList.remove('is-active');
    navDashboard.classList.add('is-active');
    stopAnimationTimer();

    if (!state.dashboardMap) {
      initDashboard();
    } else {
      document.getElementById('county-filter').value = state.county;
      document.getElementById('example-county-select').value = state.county === 'All counties' ? '' : state.county;
      document.getElementById('depth-only').checked = state.depthOnly;
      window.requestAnimationFrame(() => {
        state.dashboardMap.resize();
        updateDashboardMode();
      });
    }
  }
}

// Initialize App
function init() {
  if (typeof maplibregl === 'undefined') {
    console.error('MapLibre GL JS is not loaded!');
    renderStoryContent();
    renderMapStoryChapters();
    showMapNotice('story-animation', 'MapLibre could not be loaded. The written story remains available.');
    showMapNotice('dashboard-map', 'MapLibre could not be loaded.');
    return;
  }

  initApp();
}

function initApp() {
  // Check if running via file:// protocol (CORS issues)
  if (window.location.protocol === 'file:') {
    console.warn('WARNING: Running via file:// protocol. Fetch requests may be blocked by CORS.');
    console.warn('Please run via a local server: python -m http.server 8000');
  }

  // Check if required elements exist
  const brandButton = document.getElementById('brand-button');
  const navStory = document.getElementById('nav-story');
  const navDashboard = document.getElementById('nav-dashboard');
  const storyView = document.getElementById('story-view');
  const dashboardView = document.getElementById('dashboard-view');

  if (!brandButton || !navStory || !navDashboard) {
    console.error('Required DOM elements not found!');
    return;
  }

  // Navigation
  brandButton.addEventListener('click', () => switchView('story'));
  navStory.addEventListener('click', () => switchView('story'));
  navDashboard.addEventListener('click', () => switchView('dashboard'));
  document.getElementById('view-story-link')?.addEventListener('click', event => {
    event.preventDefault();
    const target = event.currentTarget.dataset.storyTarget || '#story-catch';
    switchView('story');
    window.setTimeout(() => document.querySelector(target)?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' }), 0);
  });

  const citationDate = document.getElementById('citation-date');
  if (citationDate) citationDate.textContent = new Intl.DateTimeFormat('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

  // Keep one clean URL while the story and dashboard switch in place.
  if (window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  switchView('story');

  renderStoryContent();
  renderMapStoryChapters();
}

// Render Map Story Chapters
function renderMapStoryChapters() {
  const chapterOrder = ['density', 'hexDensity', 'monitoringGap', 'points', 'hexDepth', 'depth', 'coverage', 'wells3d', 'timeline'];
  const chapters = chapterOrder.map((mode, index) => ({
    mode,
    number: String(index + 1).padStart(2, '0'),
    label: VIEW_GUIDE[mode].group.toUpperCase(),
    title: VIEW_GUIDE[mode].title,
    technical: ANALYSIS_VIEWS[mode][0],
    shows: VIEW_GUIDE[mode].seeing,
    question: VIEW_GUIDE[mode].question,
    next: VIEW_GUIDE[mode].next,
    caution: VIEW_GUIDE[mode].caution
  }));

  const chapterImages = {
    density: ['docs/images/record-density.png', 'Dashboard showing the 2D groundwater record-density hotspot map'],
    hexDensity: ['docs/images/inventory-density-3d.png', 'Dashboard showing 3D groundwater inventory density'],
    hexDepth: ['docs/images/median-depth-3d.png', 'Dashboard showing 3D median construction depth by grid cell'],
    monitoringGap: ['docs/images/monitoring-gaps-3d.png', 'Dashboard showing 3D groundwater record coverage gaps'],
    points: ['docs/images/source-locations.png', 'Dashboard showing groundwater-source locations by type'],
    depth: ['docs/images/construction-depth.png', 'Dashboard showing sources with usable construction depth'],
    coverage: ['docs/images/depth-coverage.png', 'Dashboard comparing records with and without construction depth'],
    timeline: ['docs/images/update-timeline.png', 'Dashboard showing the groundwater record-update timeline'],
    wells3d: ['docs/images/wells-below-ground.png', 'Dashboard showing construction-depth shafts below 3D terrain']
  };

  chapters.forEach(chapter => {
    [chapter.image, chapter.alt] = chapterImages[chapter.mode];
  });

  const container = document.getElementById('map-story-chapters');
  container.innerHTML = chapters.map((chapter, index) => `
    <article class="map-story-chapter" data-chapter="${index}">
      <div class="map-story-mobile-image"><img src="${chapter.image}" alt="${chapter.alt}" /></div>
      <span class="map-story-number">${chapter.number}</span>
      <p class="section-label">${chapter.label}</p>
      <h3>${chapter.title}</h3>
      <p class="technical-subtitle">Technical view: ${chapter.technical}</p>
      <p class="map-story-explanation"><b>What you are seeing:</b> ${chapter.shows}</p>
      <p class="map-story-meaning"><b>Question it raises:</b> ${chapter.question}</p>
      <p class="map-story-next"><b>What to check next:</b> ${chapter.next}</p>
      <p class="map-story-caution"><b>What it does NOT mean:</b> ${chapter.caution}</p>
      <button type="button" data-mode="${chapter.mode}">Open this live map →</button>
    </article>
  `).join('');

  const stage = document.getElementById('map-story-stage');
  const renderStage = index => {
    const chapter = chapters[index];
    if (!stage || !chapter) return;
    stage.innerHTML = `
      <div class="map-story-screen">
        <img src="${chapter.image}" alt="${chapter.alt}" />
        <div class="map-story-screen-label"><span>${chapter.number} / ${String(chapters.length).padStart(2, '0')}</span><b>${chapter.label}</b></div>
      </div>
      <figcaption><span>${chapter.label}</span><b>${chapter.title} · ${chapter.technical}</b></figcaption>
      <div class="map-story-progress" aria-label="Map ${index + 1} of ${chapters.length}">
        ${chapters.map((_, itemIndex) => `<i class="${itemIndex === index ? 'is-active' : ''}"></i>`).join('')}
      </div>
    `;
  };

  renderStage(0);
  container.querySelector('[data-chapter="0"]')?.classList.add('is-active');

  // Intersection Observer for scroll highlighting
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) {
        const index = parseInt(visible.target.dataset.chapter);
        document.querySelectorAll('.map-story-chapter').forEach((ch, i) => {
          ch.classList.toggle('is-active', i === index);
        });
        renderStage(index);
      }
    }, { rootMargin: '-28% 0px -42%', threshold: [0.05, 0.25, 0.5, 0.75] });

    document.querySelectorAll('.map-story-chapter').forEach(chapter => observer.observe(chapter));
  }

  // Button clicks
  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mapMode = btn.dataset.mode;
      switchView('dashboard');
      setTimeout(() => updateDashboardMode(), 100);
    });
  });
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
