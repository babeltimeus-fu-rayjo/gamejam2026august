import {
  Container,
  Mesh,
  MeshGeometry,
  Shader,
  UniformGroup,
  type DestroyOptions,
} from "pixi.js";

/**
 * Fullscreen 3D neon tunnel background.
 *
 * The whole thing is one quad running a fragment shader, so it rasterises at
 * the real backbuffer resolution (a 1280x720 virtual quad scaled onto a
 * 1920x1080 window still renders 1920x1080 sharp) and costs a single draw call.
 *
 * The tunnel is a triangular prism whose inradius steps between two values
 * along z: wide bays separated by narrow ribs, so the ribs stand proud of the
 * wall like structural beams. Because the radius is piecewise constant in z,
 * the ray march is exact rather than approximate — walk segment by segment,
 * and within each segment solve the ray against three half-planes. Crossing
 * into a rib exposes its front face, which is what gives the architecture
 * visible thickness: real ledges that occlude what is behind them and slide
 * past each other with parallax as the camera moves.
 *
 * Distance travelled is integrated on the CPU and passed in as `uDist` rather
 * than derived from `uTime * speed`, so the music can change the camera speed
 * without retroactively moving the camera.
 *
 * WebGL only — the app requests the default 'webgl' renderer preference. Add a
 * `gpu` WGSL program to `Shader.from` if that ever changes.
 */

const vertex = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
}
`;

const fragment = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform float uTime;      // seconds since creation; drives colour, roll, twinkle
uniform float uDist;      // distance travelled down the tunnel (CPU-integrated)
uniform vec2 uSize;       // quad size, for aspect correction
uniform float uHueSpeed;  // colour cycle, full rotations per second
uniform float uLevel;     // 0..1 sustained music energy
uniform float uKick;      // 0..1 decaying spike on each detected beat

#define R_BAY 1.0         // inradius of the open bays
#define R_RIB 0.76        // inradius through a rib: how far the beams stand proud
#define RIB_PERIOD 3.0
#define RIB_LEN 0.85
#define MARCH_STEPS 18
#define MOTE_PLANES 14
#define MOTE_GAP 1.7
#define SQRT3 1.7320508

vec3 hue(float h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
    return clamp(min(k, 4.0 - k), 0.0, 1.0);
}

mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
}

vec2 hash22(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
}

/** Outward normal of wall i. Three of them make an equilateral triangle, apex up. */
vec2 wallNormal(int i) {
    float a = -1.5707963 + float(i) * 2.0943951;
    return vec2(cos(a), sin(a));
}

/** Signed distance to the triangle cross-section of inradius r (negative inside). */
float sdTriangle(vec2 p, float r) {
    float d = -1e9;
    for (int i = 0; i < 3; i++) {
        d = max(d, dot(wallNormal(i), p) - r);
    }
    return d;
}

/** Ray parameter where the ray leaves a prism of inradius r, and which wall it leaves by. */
float prismExit(vec3 ro, vec3 rd, float r, out int wall) {
    float best = 1e9;
    wall = 0;
    for (int i = 0; i < 3; i++) {
        vec2 n = wallNormal(i);
        float dn = dot(n, rd.xy);
        if (dn <= 1e-5) continue;              // parallel to this wall, or leaving by another
        float t = (r - dot(n, ro.xy)) / dn;
        if (t > 0.0 && t < best) {
            best = t;
            wall = i;
        }
    }
    return best;
}

/**
 * Antialiased glow on the integer lattice of x. Line width tracks the
 * screen-space derivative, and once the lines pack tighter than a pixel the
 * term fades out instead of saturating — otherwise grazing surfaces (a wall
 * right beside the camera) blow out into a solid slab of colour.
 *
 * fwidth() is only defined in uniform control flow, so every call sits above
 * the surface-type branch below.
 */
float lattice(float x, float core) {
    float w = fwidth(x);
    float d = abs(fract(x - 0.5) - 0.5);
    float line = smoothstep(w * 0.8 + core + 1e-4, 0.0, d);
    return line * (1.0 - smoothstep(0.25, 0.7, w));
}

void main() {
    // --- camera ------------------------------------------------------------
    vec2 p = vUV * 2.0 - 1.0;
    p.x *= uSize.x / uSize.y;
    p *= rot(uTime * 0.06 + sin(uTime * 0.17) * 0.3);   // slow roll

    float z = uDist;
    // Weave through the tunnel instead of flying dead centre, and bank the view
    // along the path so the drift reads as speed rather than as a wobble. The
    // sway stays well inside R_RIB so the camera never clips a beam.
    vec3 ro = vec3(sin(z * 0.11) * 0.22, cos(z * 0.09) * 0.16, z);
    // Each beat widens the lens: the edges stretch and it reads as a surge.
    vec3 rd = normalize(vec3(p, 1.45 - uKick * 0.28));
    rd = normalize(rd + vec3(cos(z * 0.11) * 0.09, -sin(z * 0.09) * 0.07, 0.0));

    float baseHue = uTime * uHueSpeed;
    vec3 col = vec3(0.0);

    // --- march the ribbed prism --------------------------------------------
    // Radius is piecewise constant in z, so each segment is an exact solve.
    // kind 0 = bay wall, 1 = rib wall (inner face of a beam), 2 = rib front
    // face (the ledge you see because the beam has thickness).
    float tHit = 1e9;
    int hitKind = 0;
    int hitWall = 0;
    float hitR = R_BAY;

    float t = 0.0;
    for (int i = 0; i < MARCH_STEPS; i++) {
        float zs = ro.z + rd.z * t + 1e-4;
        float local = mod(zs, RIB_PERIOD);
        bool inRib = local < RIB_LEN;
        float r = inRib ? R_RIB : R_BAY;
        float tEnd = max(t + 1e-3,
                         t + ((inRib ? RIB_LEN : RIB_PERIOD) - local) / rd.z);

        int w;
        float tw = prismExit(ro, rd, r, w);
        if (tw <= tEnd) {                       // leaves sideways inside this segment
            tHit = tw;
            hitWall = w;
            hitR = r;
            hitKind = inRib ? 1 : 0;
            break;
        }

        t = tEnd;
        if (!inRib) {
            // Entering a rib: the beam's front face is squarely in our path
            // wherever we are already outside the narrower prism.
            vec2 q = ro.xy + rd.xy * t;
            if (sdTriangle(q, R_RIB) > 0.0) {
                tHit = t;
                hitR = R_RIB;
                hitKind = 2;
                break;
            }
        }
    }
    // A near-axial ray can run the whole march without touching anything; park
    // it far away so the fog takes it to black instead of producing infinities.
    tHit = min(tHit, 60.0);

    vec3 hitP = ro + rd * tHit;
    vec2 tangent = vec2(-wallNormal(hitWall).y, wallNormal(hitWall).x);
    float u = dot(tangent, hitP.xy);            // across the wall
    float v = hitP.z;                           // along the tunnel
    float ledge = sdTriangle(hitP.xy, R_RIB);   // >0 only out on a rib face
    float halfEdge = hitR * SQRT3;
    float fog = exp(-tHit * 0.075);

    // Every lattice() call is here, above the branch, so fwidth() stays valid.
    float gU = lattice(u * 2.0, 0.02);
    float gV = lattice(v * 1.5, 0.02);
    float gUFine = lattice(u * 8.0, 0.0);
    float gVFine = lattice(v * 6.0, 0.0);
    float gLedge = lattice(ledge * 16.0, 0.0);

    if (hitKind == 2) {
        // --- rib front face: the ledge that sells the thickness -------------
        vec3 faceHue = hue(baseHue + 0.28 + v * 0.04);
        float lip = 0.008 / (ledge * ledge + 0.0007);       // hot trim on the inner edge
        col += (faceHue * (lip + gLedge * 0.30 + 0.10)
             + vec3(1.0) * lip * 0.25) * fog;
    } else {
        // --- lateral wall ---------------------------------------------------
        float rib = hitKind == 1 ? 1.0 : 0.0;
        float wallHue = baseHue + float(hitWall) * 0.22 + rib * 0.35;

        // Coarse panel joints plus a finer weave, for the dense circuit look.
        // Beam undersides get a dimmer, tighter version so they read as
        // structure rather than as more wall.
        float grid = gU * 0.55 + gV * 0.95 + gUFine * 0.16 + gVFine * 0.20;
        vec3 gridCol = hue(wallHue + 0.42 + v * 0.035) * grid * mix(1.0, 0.5, rib);

        // Corner tubes. A real neon tube blows out to white at the filament and
        // keeps its colour only in the bloom, so core and halo shade separately.
        float edge = halfEdge - abs(u);
        float filament = smoothstep(0.05, 0.0, edge);
        float halo = 0.022 / (edge * edge + 0.0018)
                   + 0.008 / (edge * edge + 0.04);
        // Energy running down the tube. A wall right beside the camera covers a
        // lot of screen at nearly constant depth; without this it reads flat.
        float flow = 0.5 + 0.5 * sin(v * 0.8 - uTime * 5.0);
        vec3 neon = hue(wallHue + v * 0.05 + u * 0.05);
        vec3 tubeCol = (neon * halo * (0.45 + 0.55 * flow)
                     + mix(neon, vec3(1.0), 0.8) * filament * 1.6)
                     * (1.0 + uLevel * 0.9);

        float spill = 0.10 + 0.30 * smoothstep(halfEdge * 0.2, halfEdge, abs(u));
        vec3 wash = hue(wallHue + 0.5 + v * 0.035) * spill * 0.18;

        // Glints: one hashed twinkle per panel cell, so the surfaces sparkle.
        vec2 cell = floor(vec2(u, v) * 3.0);
        vec2 h = hash22(cell);
        vec2 gp = (cell + 0.2 + h * 0.6) / 3.0;
        float gd = length(vec2(u, v) - gp);
        float tw = pow(0.5 + 0.5 * sin(uTime * 3.0 + h.x * 62.0), 8.0);
        vec3 glint = vec3(1.0, 0.97, 0.9) * tw * 0.0009 / (gd * gd + 0.00025);

        col += (gridCol + tubeCol + wash + glint) * fog;
    }

    // --- motes: sparks hanging in the air between the beams -----------------
    float m0 = (floor(ro.z / MOTE_GAP) + 1.0) * MOTE_GAP;
    for (int i = 0; i < MOTE_PLANES; i++) {
        float zp = m0 + float(i) * MOTE_GAP;
        float tm = (zp - ro.z) / rd.z;
        if (tm > tHit) break;
        vec2 q = ro.xy + rd.xy * tm;
        vec2 cell = floor(q * 1.6);
        // mod() keeps the hash input small: fract-based hashes fall apart once
        // the camera has travelled a few thousand units.
        vec2 h = hash22(cell + mod(zp, 97.0) * 7.13);
        vec2 mp = (cell + 0.15 + h * 0.7) / 1.6;
        float d = length(q - mp);
        float tw = pow(0.5 + 0.5 * sin(uTime * 4.0 + h.y * 51.0), 6.0);
        col += hue(baseHue + 0.7 + h.x) * tw
             * (0.00045 / (d * d + 0.00006)) * exp(-tm * 0.08);
    }

    // --- vanishing point + grade -------------------------------------------
    float axial = max(rd.z, 0.0);
    col += hue(baseHue + 0.55)
         * (pow(axial, 24.0) * 0.30 + pow(axial, 90.0) * 1.5)
         * (1.0 + uKick * 1.2);
    col *= 0.4 + 0.6 * smoothstep(2.8, 0.3, dot(p, p));   // vignette
    col = 1.0 - exp(-col * (1.1 + uLevel * 0.35));        // highlight rolloff
    col = pow(col, vec3(0.85));

    finalColor = vec4(col, 1.0);
}
`;

export interface NeonTunnelOptions {
  /** Quad size in virtual coordinates. */
  width: number;
  height: number;
  /** Cruising speed in world units per second, with no music playing. */
  speed?: number;
  /** Colour cycle speed, full hue rotations per second. */
  hueSpeed?: number;
}

export class NeonTunnel extends Container {
  private readonly uniforms: UniformGroup<{
    uTime: { value: number; type: "f32" };
    uDist: { value: number; type: "f32" };
    uSize: { value: Float32Array; type: "vec2<f32>" };
    uHueSpeed: { value: number; type: "f32" };
    uLevel: { value: number; type: "f32" };
    uKick: { value: number; type: "f32" };
  }>;
  // Explicit generics: Mesh defaults its shader type to TextureShader, and ours
  // is a bare Shader with no texture.
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly baseSpeed: number;
  private elapsed = 0;
  private distance = 0;

  constructor({
    width,
    height,
    speed = 6,
    hueSpeed = 0.05,
  }: NeonTunnelOptions) {
    super();
    this.baseSpeed = speed;

    this.uniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uDist: { value: 0, type: "f32" },
      uSize: { value: new Float32Array([width, height]), type: "vec2<f32>" },
      uHueSpeed: { value: hueSpeed, type: "f32" },
      uLevel: { value: 0, type: "f32" },
      uKick: { value: 0, type: "f32" },
    });

    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });

    const shader = Shader.from({
      gl: { vertex, fragment },
      resources: { tunnelUniforms: this.uniforms },
    });

    this.mesh = new Mesh<MeshGeometry, Shader>({ geometry, shader });
    this.addChild(this.mesh);
  }

  /**
   * Advance one frame. `level` is sustained music energy and `kick` a decaying
   * per-beat spike, both 0..1; pass zeros for an unreactive idle drift.
   *
   * Speed is integrated here rather than in the shader so a beat can surge the
   * camera forward without the change rewriting where it has already been.
   */
  update(dt: number, level = 0, kick = 0): void {
    this.elapsed += dt;
    this.distance += dt * (this.baseSpeed * (0.7 + level * 0.9) + kick * 14);

    const u = this.uniforms.uniforms;
    u.uTime = this.elapsed;
    u.uDist = this.distance;
    u.uLevel = level;
    u.uKick = kick;
  }

  override destroy(options?: DestroyOptions): void {
    // Mesh.destroy leaves the shader and geometry alone; they're ours to free.
    // Not `destroy(true)`: `Shader.from` builds its GlProgram through
    // `GlProgram.from`, which caches by shader source, so the program is shared
    // with every other tunnel ever created. Destroying it here leaves a dead
    // entry in that cache and the next tunnel comes up with no attributes.
    this.mesh.shader?.destroy(false);
    this.mesh.geometry.destroy();
    super.destroy(options);
  }
}
