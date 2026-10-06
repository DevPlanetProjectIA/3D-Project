/*
 * Visualizador 3D em WebGL puro.
 *
 * Sem bibliotecas externas: shaders próprios, controle de órbita, grade de
 * referência, malha de arame e caixa envolvente. Renderiza sob demanda
 * (só desenha quando algo muda) e mantém um laço contínuo apenas durante a
 * rotação automática.
 */

import { mat4, clamp, DEG } from './math3d.js';
import { measure } from './parsers/index.js';

/* ---------- Shaders ---------- */

const VERT_SURFACE = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uProjection;
uniform mat4 uViewModel;
uniform mat3 uNormalMatrix;
varying vec3 vNormal;
varying vec3 vViewPos;
void main() {
  vec4 viewPos = uViewModel * vec4(aPosition, 1.0);
  vViewPos = viewPos.xyz;
  vNormal = uNormalMatrix * aNormal;
  gl_Position = uProjection * viewPos;
}`;

const FRAG_SURFACE = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vViewPos;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(-vViewPos);

  vec3 keyDir = normalize(vec3(0.45, 0.72, 0.85));
  vec3 fillDir = normalize(vec3(-0.65, -0.25, 0.45));

  float key = max(dot(n, keyDir), 0.0);
  float fill = max(dot(n, fillDir), 0.0) * 0.34;
  vec3 halfDir = normalize(keyDir + v);
  float spec = pow(max(dot(n, halfDir), 0.0), 40.0) * 0.3;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.8) * 0.25;

  vec3 color = uColor * (0.2 + key * 0.8 + fill) + spec + rim * vec3(0.55, 0.68, 1.0);
  gl_FragColor = vec4(color, uOpacity);
}`;

const VERT_LINE = `
attribute vec3 aPosition;
uniform mat4 uProjection;
uniform mat4 uViewModel;
void main() {
  gl_Position = uProjection * uViewModel * vec4(aPosition, 1.0);
}`;

const FRAG_LINE = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }`;

/* ---------- Auxiliares de GL ---------- */

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Falha ao compilar shader: ${log}`);
  }
  return shader;
}

function buildProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Falha ao linkar programa: ${log}`);
  }
  return program;
}

function createContext(canvas) {
  const options = {
    alpha: true,
    antialias: true,
    depth: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
  };
  if (!canvas) throw new Error('Canvas indisponível para o visualizador.');
  const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
  if (!gl) throw new Error('WebGL não está disponível neste navegador.');
  if (gl.isContextLost()) throw new Error('O contexto WebGL deste elemento foi perdido.');
  return gl;
}

/** Acima deste número de triângulos a malha de arame é recusada (memória). */
const WIREFRAME_LIMIT = 800_000;

/* ---------- Visualizador ---------- */

export class Viewer {
  constructor(canvas, { autoRotate = false, showGrid = true, color = [0.56, 0.62, 0.78] } = {}) {
    this.canvas = canvas;
    this.gl = createContext(canvas);
    this.color = color;

    const gl = this.gl;
    this.programs = {
      surface: buildProgram(gl, VERT_SURFACE, FRAG_SURFACE),
      line: buildProgram(gl, VERT_LINE, FRAG_LINE),
    };
    this.locations = {
      surface: {
        aPosition: gl.getAttribLocation(this.programs.surface, 'aPosition'),
        aNormal: gl.getAttribLocation(this.programs.surface, 'aNormal'),
        uProjection: gl.getUniformLocation(this.programs.surface, 'uProjection'),
        uViewModel: gl.getUniformLocation(this.programs.surface, 'uViewModel'),
        uNormalMatrix: gl.getUniformLocation(this.programs.surface, 'uNormalMatrix'),
        uColor: gl.getUniformLocation(this.programs.surface, 'uColor'),
        uOpacity: gl.getUniformLocation(this.programs.surface, 'uOpacity'),
      },
      line: {
        aPosition: gl.getAttribLocation(this.programs.line, 'aPosition'),
        uProjection: gl.getUniformLocation(this.programs.line, 'uProjection'),
        uViewModel: gl.getUniformLocation(this.programs.line, 'uViewModel'),
        uColor: gl.getUniformLocation(this.programs.line, 'uColor'),
      },
    };

    this.buffers = { position: null, normal: null, wire: null, box: null, grid: null };
    this.counts = { vertices: 0, wire: 0, box: 0, grid: 0 };
    this.geometry = null;
    this.metrics = null;

    this.view = { theta: Math.PI * 0.32, phi: Math.PI * 0.34, radius: 4, target: [0, 0, 0] };
    this.home = null;
    this.options = { autoRotate, showGrid, wireframe: false, boundingBox: false };
    this.projection = mat4.create();
    this.viewMatrix = mat4.create();
    this.modelMatrix = mat4.create();
    this.viewModel = mat4.create();
    this.normalMatrix = new Float32Array(9);

    this.dirty = true;
    this.disposed = false;
    this.frameHandle = 0;
    this.lastFrameAt = 0;
    this.pixelRatio = 1;

    this._bindEvents();
    this._observeSize();
    this._tick = this._tick.bind(this);
    this.frameHandle = requestAnimationFrame(this._tick);
  }

  /* ---------- Geometria ---------- */

  setGeometry(geometry) {
    const gl = this.gl;
    this.geometry = geometry;
    this.metrics = measure(geometry);

    this._deleteBuffer('position');
    this._deleteBuffer('normal');
    this._deleteBuffer('wire');
    this._deleteBuffer('box');

    this.buffers.position = this._upload(geometry.positions);
    this.buffers.normal = this._upload(geometry.normals);
    this.counts.vertices = geometry.positions.length / 3;
    this.counts.wire = 0;

    // Centraliza o modelo na origem para orbitar em torno do próprio centro.
    const [cx, cy, cz] = this.metrics.center;
    mat4.fromTranslation(this.modelMatrix, [-cx, -cy, -cz]);

    this._buildBoundingBox();
    this._buildGrid();
    this.resetView();
    return this;
  }

  _upload(data) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  _deleteBuffer(key) {
    if (this.buffers[key]) {
      this.gl.deleteBuffer(this.buffers[key]);
      this.buffers[key] = null;
    }
  }

  /** Malha de arame: construída sob demanda, a partir da sopa de triângulos. */
  _buildWireframe() {
    if (this.buffers.wire || !this.geometry) return this.counts.wire > 0;
    const triangles = this.geometry.triangles;
    if (triangles > WIREFRAME_LIMIT) return false;

    const src = this.geometry.positions;
    const lines = new Float32Array(triangles * 18);
    for (let t = 0; t < triangles; t++) {
      const s = t * 9;
      const d = t * 18;
      const edges = [[0, 3], [3, 6], [6, 0]];
      for (let e = 0; e < 3; e++) {
        const [a, b] = edges[e];
        lines[d + e * 6 + 0] = src[s + a];
        lines[d + e * 6 + 1] = src[s + a + 1];
        lines[d + e * 6 + 2] = src[s + a + 2];
        lines[d + e * 6 + 3] = src[s + b];
        lines[d + e * 6 + 4] = src[s + b + 1];
        lines[d + e * 6 + 5] = src[s + b + 2];
      }
    }
    this.buffers.wire = this._upload(lines);
    this.counts.wire = triangles * 6;
    return true;
  }

  _buildBoundingBox() {
    if (!this.geometry) return;
    const { min, max } = this.geometry.bounds;
    if (!min.every(Number.isFinite)) return;
    const c = [
      [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
      [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
    ];
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    const data = new Float32Array(edges.length * 6);
    edges.forEach(([a, b], i) => {
      data.set(c[a], i * 6);
      data.set(c[b], i * 6 + 3);
    });
    this.buffers.box = this._upload(data);
    this.counts.box = edges.length * 2;
  }

  /** Grade no plano Z = base do modelo, com passo em potências de 10. */
  _buildGrid() {
    this._deleteBuffer('grid');
    if (!this.metrics) return;
    const span = Math.max(this.metrics.size.x, this.metrics.size.y, 1);
    const step = 10 ** clamp(Math.round(Math.log10(span / 8)), -3, 4);
    if (!Number.isFinite(step) || step <= 0) return;
    const half = Math.min(Math.ceil((span * 0.9) / step) * step, step * 200);
    const z = this.geometry.bounds.min[2];
    const lines = [];
    for (let v = -half; v <= half + 1e-6; v += step) {
      lines.push(-half, v, z, half, v, z);
      lines.push(v, -half, z, v, half, z);
    }
    this.buffers.grid = this._upload(new Float32Array(lines));
    this.counts.grid = lines.length / 3;
  }

  /* ---------- Câmera ---------- */

  resetView() {
    const radius = this.metrics ? this.metrics.radius : 1;
    this.view.theta = Math.PI * 0.32;
    this.view.phi = Math.PI * 0.36;
    this.view.radius = (radius / Math.sin(26 * DEG)) * 1.18;
    this.view.target = [0, 0, 0];
    this.home = { ...this.view, target: [0, 0, 0] };
    this.invalidate();
    return this;
  }

  /** Ângulos pré-definidos: 'front' | 'top' | 'side' | 'iso'. */
  setAngle(name) {
    const presets = {
      iso: [Math.PI * 0.32, Math.PI * 0.36],
      front: [-Math.PI / 2, Math.PI / 2],
      side: [0, Math.PI / 2],
      top: [-Math.PI / 2, 0.02],
    };
    const preset = presets[name] || presets.iso;
    this.view.theta = preset[0];
    this.view.phi = preset[1];
    this.invalidate();
  }

  setOption(key, value) {
    if (!(key in this.options)) return this.options;
    if (key === 'wireframe' && value && !this._buildWireframe()) {
      this.options.wireframe = false;
      this.invalidate();
      return this.options;
    }
    this.options[key] = value;
    this.invalidate();
    return this.options;
  }

  toggleOption(key) {
    return this.setOption(key, !this.options[key]);
  }

  invalidate() {
    this.dirty = true;
  }

  /* ---------- Interação ---------- */

  _bindEvents() {
    const canvas = this.canvas;
    const pointers = new Map();
    let mode = null;
    let last = null;
    let pinchDistance = 0;

    const onDown = (ev) => {
      canvas.setPointerCapture?.(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      last = { x: ev.clientX, y: ev.clientY };
      mode = (ev.button === 2 || ev.shiftKey || ev.ctrlKey) ? 'pan' : 'orbit';
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        mode = 'pinch';
      }
      this.options.autoRotate = false;
    };

    const onMove = (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (mode === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) this._zoom(pinchDistance / distance);
        pinchDistance = distance;
        return;
      }

      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };

      if (mode === 'pan') this._pan(dx, dy);
      else this._orbit(dx, dy);
    };

    const onUp = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (!pointers.size) mode = null;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.options.autoRotate = false;
      this._zoom(Math.exp(clamp(ev.deltaY, -120, 120) * 0.0014));
    }, { passive: false });

    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 0.22 : 0.08;
      const actions = {
        ArrowLeft: () => this._orbit(-step * 160, 0),
        ArrowRight: () => this._orbit(step * 160, 0),
        ArrowUp: () => this._orbit(0, -step * 160),
        ArrowDown: () => this._orbit(0, step * 160),
        '+': () => this._zoom(0.9),
        '=': () => this._zoom(0.9),
        '-': () => this._zoom(1.1),
        r: () => this.resetView(),
      };
      const action = actions[ev.key];
      if (action) { ev.preventDefault(); action(); }
    });

    this.gl.canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.contextLost = true;
    });
    this.gl.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.invalidate();
    });
  }

  _orbit(dx, dy) {
    this.view.theta -= dx * 0.0085;
    this.view.phi = clamp(this.view.phi - dy * 0.0085, 0.02, Math.PI - 0.02);
    this.invalidate();
  }

  _zoom(factor) {
    const radius = this.metrics ? this.metrics.radius : 1;
    this.view.radius = clamp(this.view.radius * factor, radius * 0.25, radius * 40);
    this.invalidate();
  }

  _pan(dx, dy) {
    const scale = this.view.radius * 0.0022;
    const { theta, phi } = this.view;
    // Eixos direito e acima da câmera, derivados dos ângulos esféricos.
    const right = [-Math.sin(theta), Math.cos(theta), 0];
    const forward = [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    for (let i = 0; i < 3; i++) {
      this.view.target[i] -= (right[i] * dx - up[i] * dy) * scale;
    }
    this.invalidate();
  }

  /* ---------- Tamanho ---------- */

  _observeSize() {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.pixelRatio = ratio;
        this.invalidate();
      }
    };
    resize();
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(resize);
      this.resizeObserver.observe(this.canvas);
    } else {
      this._onWindowResize = resize;
      window.addEventListener('resize', resize);
    }
  }

  /* ---------- Desenho ---------- */

  _tick(now) {
    if (this.disposed) return;
    if (this.options.autoRotate) {
      const delta = this.lastFrameAt ? (now - this.lastFrameAt) : 16;
      this.view.theta += delta * 0.00022;
      this.dirty = true;
    }
    this.lastFrameAt = now;
    if (this.dirty && !this.contextLost) {
      this.dirty = false;
      this.draw();
    }
    this.frameHandle = requestAnimationFrame(this._tick);
  }

  _computeMatrices(width, height) {
    const { theta, phi, radius, target } = this.view;
    const eye = [
      target[0] + radius * Math.sin(phi) * Math.cos(theta),
      target[1] + radius * Math.sin(phi) * Math.sin(theta),
      target[2] + radius * Math.cos(phi),
    ];
    const near = Math.max(radius * 0.01, 0.01);
    const far = radius * 40;
    mat4.perspective(this.projection, 52 * DEG, width / height, near, far);
    mat4.lookAt(this.viewMatrix, eye, target, [0, 0, 1]);
    mat4.multiply(this.viewModel, this.viewMatrix, this.modelMatrix);
    mat4.normalFromMat4(this.normalMatrix, this.viewModel);
  }

  draw() {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!this.counts.vertices) return;
    this._computeMatrices(width, height);

    if (this.options.showGrid && this.buffers.grid) {
      this._drawLines(this.buffers.grid, this.counts.grid, [0.55, 0.6, 0.72, 0.16]);
    }

    const surface = this.locations.surface;
    gl.useProgram(this.programs.surface);
    gl.uniformMatrix4fv(surface.uProjection, false, this.projection);
    gl.uniformMatrix4fv(surface.uViewModel, false, this.viewModel);
    gl.uniformMatrix3fv(surface.uNormalMatrix, false, this.normalMatrix);
    gl.uniform3fv(surface.uColor, this.color);
    gl.uniform1f(surface.uOpacity, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.enableVertexAttribArray(surface.aPosition);
    gl.vertexAttribPointer(surface.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normal);
    gl.enableVertexAttribArray(surface.aNormal);
    gl.vertexAttribPointer(surface.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.counts.vertices);

    if (this.options.wireframe && this.buffers.wire) {
      this._drawLines(this.buffers.wire, this.counts.wire, [0.04, 0.06, 0.1, 0.45]);
    }
    if (this.options.boundingBox && this.buffers.box) {
      this._drawLines(this.buffers.box, this.counts.box, [0.43, 0.55, 1, 0.7]);
    }
  }

  _drawLines(buffer, count, rgba) {
    const gl = this.gl;
    const line = this.locations.line;
    gl.useProgram(this.programs.line);
    gl.uniformMatrix4fv(line.uProjection, false, this.projection);
    gl.uniformMatrix4fv(line.uViewModel, false, this.viewModel);
    gl.uniform4fv(line.uColor, rgba);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(line.aPosition);
    gl.vertexAttribPointer(line.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, count);
  }

  /** Captura o quadro atual como PNG (bytes). */
  async snapshotPng() {
    this.draw();
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // readPixels devolve as linhas de baixo para cima.
    const flipped = new Uint8ClampedArray(pixels.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * rowBytes;
      flipped.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
    }

    const canvas2d = document.createElement('canvas');
    canvas2d.width = width;
    canvas2d.height = height;
    canvas2d.getContext('2d').putImageData(new ImageData(flipped, width, height), 0, 0);
    const blob = await new Promise((resolve) => canvas2d.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Não foi possível gerar a imagem.');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Libera recursos de GL.
   *
   * `loseContext` só deve ser usado em canvas descartáveis: um contexto perdido
   * não pode ser recriado no mesmo elemento, e `getContext` voltaria a devolver
   * o contexto morto — inutilizando o canvas para sempre.
   */
  dispose({ loseContext = false } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver?.disconnect();
    if (this._onWindowResize) window.removeEventListener('resize', this._onWindowResize);
    const gl = this.gl;
    Object.keys(this.buffers).forEach((key) => this._deleteBuffer(key));
    gl.deleteProgram(this.programs.surface);
    gl.deleteProgram(this.programs.line);
    if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * Renderiza a miniatura de uma geometria fora da tela.
 * Devolve bytes PNG com fundo transparente.
 */
export async function renderThumbnail(geometry, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  // Fora do DOM o getBoundingClientRect é zero; fixa o tamanho manualmente.
  const viewer = new Viewer(canvas, { showGrid: false });
  viewer.resizeObserver?.disconnect();
  canvas.width = size;
  canvas.height = size;
  try {
    viewer.setGeometry(geometry);
    viewer.setAngle('iso');
    return await viewer.snapshotPng();
  } finally {
    // Canvas descartável: liberar o contexto evita estourar o limite do navegador.
    viewer.dispose({ loseContext: true });
  }
}

export default Viewer;
