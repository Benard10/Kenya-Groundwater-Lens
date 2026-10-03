import { MercatorCoordinate } from "./maplibre.js";

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

export function createWellsBelowGroundLayer(records, verticalExaggeration = 8) {
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
        const topCoordinate = MercatorCoordinate.fromLngLat([lon, lat], surface + 7);
        const bottomCoordinate = MercatorCoordinate.fromLngLat([lon, lat], bottom);
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
