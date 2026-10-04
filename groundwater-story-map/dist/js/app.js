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
  density: ["Record-density map", "Brighter areas contain more records; this is survey concentration, not groundwater abundance."],
  hexDensity: ["3D inventory density", "Notebook H3 output: height and colour show record concentration in each national grid cell."],
  hexDepth: ["3D median construction depth", "Notebook H3 output: height and colour show median depth; grey cells have fewer than five measurements."],
  monitoringGap: ["3D groundwater record coverage gaps", "Taller, brighter cells are farther from the nearest mapped groundwater-source record. This shows where records are sparse, not where groundwater is scarce."],
  points: ["Groundwater-source locations", "Every visible point is one source record in the public inventory."],
  depth: ["Construction-depth map", "Colour and size compare 552 usable depth records; depth is not groundwater level."],
  coverage: ["Depth-data coverage", "Green records include construction depth; muted red records do not."],
  timeline: ["Record-update timeline", "Records updated up to the selected month. This is metadata activity, not drilling activity."],
  wells3d: ["Wells below ground", "3D terrain with 552 usable construction depths projected downward at 150× vertical exaggeration."]
};

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
  playing: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
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
      label: "Main finding",
      kicker: "MAPPING KENYA'S GROUNDWATER",
      title: `<em>${format(summary.total)}</em> records reveal a national picture and a major blind spot.`,
      copy: `This public inventory brings together wells, boreholes and springs from ${format(summary.counties)} counties. It is a valuable starting point, but it mainly shows where surveys created records, not every groundwater source in Kenya.`,
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
      title: `<em>${summary.westernShare}%</em> of records sit in just two counties.`,
      copy: `Kakamega and Vihiga contain ${format(summary.westernCount)} records. This strong western cluster tells us where data collection was strongest. It does not mean these counties hold ${summary.westernShare}% of Kenya's groundwater.`,
      metrics: [[format(summary.countyCounts.Kakamega), "Kakamega records"], [format(summary.countyCounts.Vihiga), "Vihiga records"]],
      guardrail: "Survey effort and data coverage strongly influence the pattern on this map.",
      camera: { center: [34.75, 0.22], zoom: 7.25, pitch: 34, bearing: -9 },
      filter: ["in", ["get", "c"], ["literal", ["Kakamega", "Vihiga"]]],
      color: ["match", ["get", "c"], "Kakamega", "#38c9f3", "Vihiga", "#ffb21c", "#60737b"],
      radius: ["interpolate", ["linear"], ["zoom"], 5, 1.7, 8, 3.5, 11, 5],
      opacity: 0.72
    },
    {
      label: "Missing depth",
      kicker: "THE DATA BLACK BOX",
      title: `Only <em>${summary.depthShare}%</em> tell us how deep a source was built.`,
      copy: `Only ${format(summary.depthCount)} records have a usable construction depth. Their median is ${format(summary.medianDepth)} metres. Even then, construction depth is not the water-table depth and cannot tell us how much water is available.`,
      metrics: [[format(summary.depthCount), "usable depth records"], [`${format(summary.medianDepth)} m`, "median construction depth"]],
      guardrail: "The absence of a depth value is a data gap. It does not indicate a shallow well or provide evidence of non-compliance.",
      camera: { center: [36.9, 0.1], zoom: 5.6, pitch: 28, bearing: 8 },
      filter: ["==", ["get", "hasDepth"], 1],
      color: ["interpolate", ["linear"], ["get", "depth"], 0, "#6de2c1", 75, "#ffcf4a", 200, "#ff775f", 600, "#d8366f"],
      radius: ["interpolate", ["linear"], ["get", "depth"], 0, 3, 100, 5, 600, 9],
      opacity: 0.9
    },
    {
      label: "Read with care",
      kicker: "A TOOL, NOT A CENSUS",
      title: `Blank space means <em>missing evidence</em>, not missing groundwater.`,
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
      title: `The map gives WRA the clues. <em>Fieldwork turns them into action.</em>`,
      copy: "Start with likely wells and boreholes, match them to official records, visit the site, measure use where required, and then manage each source fairly. This turns a public inventory into better evidence without treating every dot as a final answer.",
      metrics: [[format(summary.wellCount), "well and borehole leads"], ["5 steps", "from identification to fair action"]],
      guardrail: "Permitting, charging or enforcement must use verified WRA records, measured use and a fair correction process, not this map alone.",
      camera: { center: [37.45, 0.05], zoom: 5.15, pitch: 52, bearing: 12 },
      filter: ["in", ["get", "t"], ["literal", ["bh", "pdw", "udw"]]],
      color: "#38c9f3",
      radius: ["interpolate", ["linear"], ["zoom"], 4, 1.5, 8, 3],
      opacity: 0.24,
      flow: true,
      flowLabels: ["Identify source", "Match records", "Visit the site", "Measure use", "Manage fairly"]
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
  state.animationMap.flyTo({ ...scene.camera, duration: 2200, essential: true });

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

  narrative.innerHTML = `
    <p class="eyebrow">${scene.kicker}</p>
    <h1>${scene.title}</h1>
    <p class="scene-copy">${scene.copy}</p>
    <div class="metric-row">
      ${scene.metrics.map(([value, label]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join('')}
    </div>
    <div class="wra-flow ${scene.flow ? 'is-visible' : ''}" aria-label="Responsible WRA implementation pathway">
      ${(scene.flowLabels || ["Inventory lead", "Match permit", "Field verify", "Meter use", "Charge fairly"]).map((label, index) => `
        <div><span>${index + 1}</span><b>${label}</b></div>${index < 4 ? '<i>→</i>' : ''}
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
      <a class="story-scroll-cue" href="#water-story">Continue to the story ↓</a>
      <div class="scene-counter"><span>${String(state.currentScene + 1).padStart(2, '0')}</span> / 05</div>
    </div>
    <div class="progress-track">
      <span class="${state.playing ? 'is-running' : ''}" style="--scene-duration: ${DURATION}ms"></span>
    </div>
  `;

  document.getElementById('prev-scene').addEventListener('click', () => goToScene(state.currentScene - 1));
  document.getElementById('next-scene').addEventListener('click', () => goToScene(state.currentScene + 1));
  document.getElementById('play-pause').addEventListener('click', togglePlay);
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
      title: "A useful national starting point",
      text: "The inventory brings together wells, boreholes and springs recorded across 40 counties. It gives water managers many places to start checking."
    },
    {
      number: "72.8%",
      title: "The illusion of abundance",
      text: "Nearly three quarters of all records are in Kakamega and Vihiga. This shows strong data collection in those counties, not Kenya's true share of groundwater."
    },
    {
      number: "2.6%",
      title: "The depth data black box",
      text: "Only 552 records can support depth comparisons. Their median construction depth is 75 metres, but construction depth is not the water-table depth."
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
    showMapNotice('dashboard-map', `Dashboard data could not be loaded: ${error.message}`);
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
    updateDashboardFilters();
  });

  document.getElementById('depth-only').addEventListener('change', (e) => {
    state.depthOnly = e.target.checked;
    updateDashboardFilters();
  });

  document.getElementById('reset-filters').addEventListener('click', resetFilters);

  // Analysis views
  const analysisViews = document.getElementById('analysis-views');
  analysisViews.innerHTML = Object.entries(ANALYSIS_VIEWS).map(([key, value]) => `
    <button class="${state.mapMode === key ? 'is-active' : ''}" data-mode="${key}">
      <i></i><span><b>${value[0]}</b><small>${value[1]}</small></span>
    </button>
  `).join('');

  analysisViews.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mapMode = btn.dataset.mode;
      updateDashboardMode();
    });
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
      trigger.innerHTML = '<span>Notebook outputs</span><b></b><i aria-hidden="true">▾</i>';
      currentLabel = trigger.querySelector('b');

      menu = document.createElement('div');
      menu.className = 'analysis-switcher-menu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;

      Object.entries(ANALYSIS_VIEWS).forEach(([mode, [title]]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.mode = mode;
        button.setAttribute('role', 'menuitemradio');
        button.innerHTML = `<i aria-hidden="true"></i><span>${title}</span>`;
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
      currentLabel.textContent = ANALYSIS_VIEWS[mode][0];
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
  const currentTitle = ANALYSIS_VIEWS[state.mapMode][0];
  const currentSubtitle = `${state.county} · ${format(getFilteredRecords().length)} visible records · ${ANALYSIS_VIEWS[state.mapMode][1]}`;
  document.getElementById('map-title-text').textContent = currentTitle;
  document.getElementById('map-subtitle').textContent = currentSubtitle;
  state.fullscreenTitleControl?.setContent(currentTitle, currentSubtitle);
  state.analysisViewControl?.setActive(state.mapMode);

  document.getElementById('well-scale-control').style.display = state.mapMode === 'wells3d' ? 'flex' : 'none';
  document.getElementById('timeline-control').style.display = state.mapMode === 'timeline' ? 'grid' : 'none';

  updateLegend();

  // Camera movement
  if (state.county !== 'All counties' && getFilteredRecords().length) {
    const filtered = getFilteredRecords();
    const bounds = filtered.reduce((box, record) => box.extend([record[0], record[1]]), new maplibregl.LngLatBounds());
    state.dashboardMap.fitBounds(bounds, { padding: 80, maxZoom: wells3d ? 8.5 : 10, duration: 900 });
    if (wells3d) state.dashboardMap.easeTo({ pitch: 68, bearing: -18, duration: 1100 });
  } else if (state.county === 'All counties') {
    state.dashboardMap.flyTo(wells3d
      ? { center: [37.2, 0.05], zoom: 5.7, pitch: 68, bearing: -18, duration: 1200 }
      : notebookSurface
        ? { center: [37.85, 0.15], zoom: 5.3, pitch: 55, bearing: -14, duration: 1100 }
        : { center: [37.7, 0.15], zoom: 5.45, pitch: 0, bearing: 0, duration: 900 });
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
  if (!rows.length) {
    container.innerHTML = '<p style="padding: 10px; color: var(--dash-muted); font-size: 9px;">No data</p>';
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
  if (!values.length) {
    container.innerHTML = '<p style="padding: 18px; color: var(--dash-muted); font-size: 9px;">No depth data</p>';
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
  if (!rows.length) {
    container.innerHTML = '<p style="padding: 14px; color: var(--dash-muted); font-size: 9px;">No update data</p>';
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
  document.getElementById('timeline-label').textContent = state.timelineIndex == null ? 'Select month' : formatMonthIndex(state.timelineIndex);

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
      <span>${state.timelineMode === 'cumulative' ? 'Cumulative through' : 'Only'} ${state.timelineIndex == null ? 'selected month' : formatMonthIndex(state.timelineIndex)}</span>
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
      <span>Density shows record concentration</span>
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
  document.querySelectorAll('#type-filters input').forEach(input => input.checked = true);
  document.getElementById('depth-only').checked = false;

  updateDashboardMode();
}

// View Switching
function switchView(view) {
  state.activeView = view;

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
  const chapters = [
    {
      mode: 'density',
      number: '01',
      label: 'WHERE RECORDS GATHER',
      title: 'The 2D hotspot map shows the survey footprint.',
      shows: 'Bright areas contain many records close together. The strongest clusters are in Kakamega and Vihiga.',
      meaning: 'The inventory is geographically uneven. Western Kenya is documented much more heavily, so quieter areas need more data collection before they can be compared fairly.',
      caution: 'A hotspot means more records, not more groundwater, recharge or safe yield.'
    },
    {
      mode: 'hexDensity',
      number: '02',
      label: 'COMPARE PLACES FAIRLY',
      title: 'The 3D grid turns concentration into comparable cells.',
      shows: 'Each equal-sized grid cell groups nearby records. Taller and brighter cells contain more entries.',
      meaning: 'The 3D pattern confirms that a small part of western Kenya carries much of the national inventory. It helps identify where records are concentrated and where the inventory needs strengthening.',
      caution: 'The column height is a display value. It is not metres of water.'
    },
    {
      mode: 'hexDepth',
      number: '03',
      label: 'WHAT DEPTH DATA CAN SAY',
      title: 'Only well-sampled cells become depth results.',
      shows: 'Height and colour compare the median construction depth in cells with at least five usable measurements. Grey cells do not meet that minimum.',
      meaning: 'Recorded construction depth varies from place to place, but only a small number of well-sampled cells support this comparison. These are local signals for further study, not a national depth model.',
      caution: 'Construction depth is not the water-table depth, aquifer thickness or available water.'
    },
    {
      mode: 'monitoringGap',
      number: '04',
      label: 'WHERE THE INVENTORY IS THIN',
      title: 'Distance reveals places with little nearby information.',
      shows: 'Taller, brighter cells are farther from the nearest mapped groundwater record.',
      meaning: 'These cells point to priority areas for checking existing records and carrying out new inventory work. They reveal where our information is weakest, not where water is necessarily scarce.',
      caution: 'A large gap is an information gap. It does not prove that groundwater is absent or scarce.'
    },
    {
      mode: 'points',
      number: '05',
      label: 'THE SOURCES BEHIND THE PATTERN',
      title: 'Every point is one entry in the public inventory.',
      shows: 'Every dot is one public inventory entry. Colour separates boreholes, dug wells and springs.',
      meaning: 'This is a starting list for matching sites with WRA permits, completion records and field observations. Dense and empty areas still reflect how the survey was carried out.',
      caution: 'A point does not confirm ownership, operating condition, permit status or current water use.'
    },
    {
      mode: 'depth',
      number: '06',
      label: 'THE SMALL DEPTH SAMPLE',
      title: 'Only 552 records support the construction-depth map.',
      shows: 'Colour and marker size compare the 552 records with usable construction depth. Their median construction depth is 75 metres.',
      meaning: 'Usable depth evidence is rare and unevenly distributed. It can guide targeted local checks, but it is too limited to describe typical borehole depth across all of Kenya.',
      caution: 'This small sample cannot describe depth conditions across the whole country.'
    },
    {
      mode: 'coverage',
      number: '07',
      label: 'SEE THE MISSING VALUES',
      title: 'The coverage map makes the depth gap impossible to miss.',
      shows: 'Green records contain usable construction depth; muted red records do not. Only 2.6% of the inventory has a usable value.',
      meaning: 'Missing depth is the clearest limitation in this dataset. Completing and verifying these records would greatly improve groundwater planning, drilling review and future monitoring.',
      caution: 'Missing depth is not zero depth, a shallow source or evidence of non-compliance.'
    },
    {
      mode: 'timeline',
      number: '08',
      label: 'WHEN RECORDS CHANGED',
      title: 'The timeline follows data updates, not drilling.',
      shows: 'The view groups records by the date their database entry was last updated. The controls can show one month or the cumulative record up to that month.',
      meaning: 'Large peaks represent periods of database activity or bulk updates. They help assess how current the inventory may be, but they do not show when wells were drilled or began operating.',
      caution: 'These are record-update dates. They are not construction, permit or abstraction start dates.'
    },
    {
      mode: 'wells3d',
      number: '09',
      label: 'BELOW THE SURFACE',
      title: 'Depth shafts place the small sample beneath 3D terrain.',
      shows: 'Each coloured shaft starts at the terrain surface and extends downward using the recorded construction depth. Display scaling makes the shafts visible at national level.',
      meaning: 'The view makes relative drilling depth easier to compare and highlights how small the usable sample is. It can guide record checks, but it does not reveal the shape or condition of an aquifer.',
      caution: 'The shafts show relative construction depth, not groundwater level, aquifer shape or pumping capacity.'
    }
  ];

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
      <div class="map-story-mobile-image"><img src="${chapter.image}" alt="" /></div>
      <span class="map-story-number">${chapter.number}</span>
      <p class="section-label">${chapter.label}</p>
      <h3>${chapter.title}</h3>
      <p class="map-story-explanation"><b>What the map shows:</b> ${chapter.shows}</p>
      <p class="map-story-meaning"><b>What the pattern means:</b> ${chapter.meaning}</p>
      <p class="map-story-caution"><b>Read with care:</b> ${chapter.caution}</p>
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
      <figcaption><span>Notebook outputs · Analysis view</span><b>${chapter.title}</b></figcaption>
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
