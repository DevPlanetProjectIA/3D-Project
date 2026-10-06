/* Álgebra linear mínima para o visualizador. Matrizes 4x4 em ordem de coluna (padrão WebGL). */

export const mat4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  identity(out) {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  },

  /** Projeção em perspectiva. `fovy` em radianos. */
  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  },

  /** Câmera olhando de `eye` para `center`. */
  lookAt(out, eye, center, up) {
    let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    let len = Math.hypot(z0, z1, z2);
    if (len < 1e-7) { z0 = 0; z1 = 0; z2 = 1; len = 1; }
    z0 /= len; z1 /= len; z2 /= len;

    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2);
    if (len < 1e-7) {
      // `up` paralelo ao eixo de visão: escolhe um eixo alternativo.
      x0 = 1; x1 = 0; x2 = 0;
      const dot = x0 * z0 + x1 * z1 + x2 * z2;
      if (Math.abs(dot) > 0.99) { x0 = 0; x1 = 1; x2 = 0; }
      const cx = x1 * z2 - x2 * z1, cy = x2 * z0 - x0 * z2, cz = x0 * z1 - x1 * z0;
      len = Math.hypot(cx, cy, cz) || 1;
      x0 = cx / len; x1 = cy / len; x2 = cz / len;
    } else {
      x0 /= len; x1 /= len; x2 /= len;
    }

    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;

    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  },

  multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return out;
  },

  fromTranslation(out, v) {
    mat4.identity(out);
    out[12] = v[0]; out[13] = v[1]; out[14] = v[2];
    return out;
  },

  /** Bloco 3x3 da matriz, já invertido e transposto, para transformar normais. */
  normalFromMat4(out9, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[4], a11 = m[5], a12 = m[6];
    const a20 = m[8], a21 = m[9], a22 = m[10];

    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) { out9.fill(0); out9[0] = out9[4] = out9[8] = 1; return out9; }
    det = 1 / det;

    out9[0] = b01 * det;
    out9[1] = (-a22 * a01 + a02 * a21) * det;
    out9[2] = (a12 * a01 - a02 * a11) * det;
    out9[3] = b11 * det;
    out9[4] = (a22 * a00 - a02 * a20) * det;
    out9[5] = (-a12 * a00 + a02 * a10) * det;
    out9[6] = b21 * det;
    out9[7] = (-a21 * a00 + a01 * a20) * det;
    out9[8] = (a11 * a00 - a01 * a10) * det;
    return out9;
  },
};

export const vec3 = {
  create: () => new Float32Array(3),
  set(out, x, y, z) { out[0] = x; out[1] = y; out[2] = z; return out; },
  sub(out, a, b) { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; },
  add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; },
  scale(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; },
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize(out, a) {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    out[0] = a[0] / len; out[1] = a[1] / len; out[2] = a[2] / len;
    return out;
  },
  cross(out, a, b) {
    const ax = a[0], ay = a[1], az = a[2];
    const bx = b[0], by = b[1], bz = b[2];
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
  },
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const DEG = Math.PI / 180;
