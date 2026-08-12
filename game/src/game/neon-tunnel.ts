import {
  Container,
  Mesh,
  MeshGeometry,
  Shader,
  UniformGroup,
  type DestroyOptions,
  type Ticker,
} from "pixi.js";

/**
 * Fullscreen 3D neon tunnel background.
 *
 * The whole thing is one quad running a fragment shader, so it rasterises at
 * the real backbuffer resolution (a 1280x720 virtual quad scaled onto a
 * 1920x1080 window still renders 1920x1080 sharp) and costs a single draw call.
 *
 * Geometry is analytic rather than raymarched: the tunnel is an infinite
 * equilateral prism, so the wall hit is one ray/half-plane solve per side, and
 * the receding arches are ray/plane intersections at fixed z intervals. That
 * keeps it cheap enough to sit behind gameplay.
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

uniform float uTime;      // seconds since the tunnel was created
uniform vec2 uSize;       // quad size, for aspect correction
uniform float uSpeed;     // forward travel, world units per second
uniform float uHueSpeed;  // colour cycle, full rotations per second
uniform float uPulse;     // 0..1 beat energy; drive this from the music

#define TUNNEL_R 1.0      // inradius of the triangular cross-section
#define ARCH_GAP 2.2      // spacing between the receding arches
#define ARCH_COUNT 26

vec3 hue(float h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
    return clamp(min(k, 4.0 - k), 0.0, 1.0);
}

mat2 rot(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
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

/**
 * Antialiased glow on the integer lattice of x. Line width tracks the
 * screen-space derivative, and once the lines pack tighter than a pixel the
 * term fades out instead of saturating — otherwise grazing surfaces (a wall
 * right beside the camera) blow out into a solid slab of colour.
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

    float z = uTime * uSpeed;
    // Weave through the tunnel instead of flying dead centre, and bank the view
    // along the path so the drift reads as speed rather than as a wobble.
    vec3 ro = vec3(sin(z * 0.11) * 0.30, cos(z * 0.09) * 0.22, z);
    vec3 rd = normalize(vec3(p, 1.45));
    rd = normalize(rd + vec3(cos(z * 0.11) * 0.10, -sin(z * 0.09) * 0.08, 0.0));

    float baseHue = uTime * uHueSpeed;
    vec3 col = vec3(0.0);

    // --- walls: exit point of the ray through the prism ---------------------
    float tHit = 1e9;
    int wall = 0;
    for (int i = 0; i < 3; i++) {
        vec2 n = wallNormal(i);
        float dn = dot(n, rd.xy);
        if (dn <= 1e-5) continue;                       // ray runs parallel or away
        float t = (TUNNEL_R - dot(n, ro.xy)) / dn;
        if (t > 0.0 && t < tHit) {
            tHit = t;
            wall = i;
        }
    }

    vec3 hit = ro + rd * tHit;
    vec2 n = wallNormal(wall);
    vec2 tangent = vec2(-n.y, n.x);
    float u = dot(tangent, hit.xy);                     // across the wall
    float v = hit.z;                                    // along the tunnel
    float halfEdge = TUNNEL_R * 1.7320508;              // half side length
    float fog = exp(-tHit * 0.085);

    // Each wall gets its own hue so the three planes read as separate surfaces.
    float wallHue = baseHue + float(wall) * 0.22;

    // Coarse panel joints plus a finer weave, for the dense circuit-board look.
    float grid = lattice(u * 2.0, 0.02) * 0.55
               + lattice(v * 1.5, 0.02) * 0.95
               + lattice(u * 8.0, 0.0) * 0.16
               + lattice(v * 6.0, 0.0) * 0.20;
    vec3 gridCol = hue(wallHue + 0.42 + v * 0.035) * grid;

    // Corner tubes: the two edges of this wall sit at u = +/- halfEdge.
    // A real neon tube blows out to white at the filament and keeps its colour
    // only in the bloom, so the core and the halo are shaded separately.
    float edge = halfEdge - abs(u);
    float filament = smoothstep(0.05, 0.0, edge);
    float halo = 0.022 / (edge * edge + 0.0018)
               + 0.008 / (edge * edge + 0.04);
    // Energy running down the tube. A wall right next to the camera covers a lot
    // of screen at nearly constant depth, so without this it reads as a flat slab.
    float flow = 0.5 + 0.5 * sin(v * 0.8 - uTime * 5.0);
    vec3 neon = hue(wallHue + v * 0.05 + u * 0.05);
    vec3 tubeCol = (neon * halo * (0.45 + 0.55 * flow)
                 + mix(neon, vec3(1.0), 0.8) * filament * 1.6)
                 * (1.0 + uPulse * 0.8);

    // Wash so the panels aren't pure black between the lines, brightest at the
    // corners where the tubes spill onto the surface.
    float spill = 0.10 + 0.30 * smoothstep(halfEdge * 0.2, halfEdge, abs(u));
    vec3 wash = hue(wallHue + 0.5 + v * 0.035) * spill * 0.18;

    col += (gridCol + tubeCol + wash) * fog;

    // --- arches: triangle outlines at fixed intervals down the tunnel -------
    float z0 = (floor(ro.z / ARCH_GAP) + 1.0) * ARCH_GAP;
    for (int i = 0; i < ARCH_COUNT; i++) {
        float zi = z0 + float(i) * ARCH_GAP;
        float t = (zi - ro.z) / rd.z;
        if (t > tHit) break;                            // t grows with i, so this is the last one
        vec2 q = ro.xy + rd.xy * t;
        float r = TUNNEL_R * (0.62 + 0.22 * sin(zi * 0.35) + uPulse * 0.06);
        float d = abs(sdTriangle(q, r));
        float glow = 0.008 / (d * d + 0.0007) + 0.005 / (d * d + 0.02);
        // Arches within a few units of the camera project across most of the
        // screen, so fade them in rather than letting them wash the frame out.
        col += hue(baseHue + 0.62 + zi * 0.03) * glow
             * exp(-t * 0.13) * smoothstep(0.0, 3.5, t);
    }

    // --- vanishing point + grade -------------------------------------------
    col += hue(baseHue + 0.55) * pow(max(rd.z, 0.0), 60.0) * 1.3;
    col *= 0.4 + 0.6 * smoothstep(2.8, 0.3, dot(p, p));  // vignette
    col = 1.0 - exp(-col * 1.1);                         // highlight rolloff
    col = pow(col, vec3(0.85));

    finalColor = vec4(col, 1.0);
}
`;

export interface NeonTunnelOptions {
  /** Quad size in virtual coordinates. */
  width: number;
  height: number;
  /** Forward travel in world units per second. */
  speed?: number;
  /** Colour cycle speed, full hue rotations per second. */
  hueSpeed?: number;
}

export class NeonTunnel extends Container {
  private readonly uniforms: UniformGroup<{
    uTime: { value: number; type: "f32" };
    uSize: { value: Float32Array; type: "vec2<f32>" };
    uSpeed: { value: number; type: "f32" };
    uHueSpeed: { value: number; type: "f32" };
    uPulse: { value: number; type: "f32" };
  }>;
  // Explicit generics: Mesh defaults its shader type to TextureShader, and ours
  // is a bare Shader with no texture.
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private elapsed = 0;

  constructor({
    width,
    height,
    speed = 6,
    hueSpeed = 0.05,
  }: NeonTunnelOptions) {
    super();

    this.uniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uSize: { value: new Float32Array([width, height]), type: "vec2<f32>" },
      uSpeed: { value: speed, type: "f32" },
      uHueSpeed: { value: hueSpeed, type: "f32" },
      uPulse: { value: 0, type: "f32" },
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

  /** 0..1 beat energy; brightens the tubes and swells the arches. */
  set pulse(value: number) {
    this.uniforms.uniforms.uPulse = value;
  }

  get pulse(): number {
    return this.uniforms.uniforms.uPulse;
  }

  update(ticker: Ticker): void {
    this.elapsed += ticker.deltaMS / 1000;
    this.uniforms.uniforms.uTime = this.elapsed;
  }

  override destroy(options?: DestroyOptions): void {
    // Mesh.destroy leaves the shader and geometry alone; they're ours to free.
    this.mesh.shader?.destroy(true);
    this.mesh.geometry.destroy();
    super.destroy(options);
  }
}
