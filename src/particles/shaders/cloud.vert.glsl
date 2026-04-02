precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

uniform sampler2D uSourceImage;
uniform sampler2D uMaskTexture;
uniform sampler2D uMouseTexture;
uniform float uTime;
uniform float uParticleSize;
uniform float uContrast;
uniform float uFlowSpeed;
uniform float uFlowAmplitude;
uniform float uEdgeLooseness;
uniform float uDepthStrength;
uniform float uMouseStrength;
uniform vec2 uResolution;

in vec3 position;
in vec2 uv;
in float aSeed;

out float vLuminance;
out vec3 vSourceColor;
out float vCoreMask;
out float vEdgeMask;
out float vAlpha;

// Cheap coherent flow
vec2 flow(vec2 p, float t) {
  return vec2(
    sin(p.x * 2.1 + t * 0.7 + sin(p.y * 1.7 + t * 0.3) * 0.8),
    cos(p.y * 1.9 + t * 0.5 + cos(p.x * 2.3 - t * 0.4) * 0.7)
  );
}

void main() {
  // Sample source image and mask
  vec4 srcColor = texture(uSourceImage, uv);
  vec4 mask = texture(uMaskTexture, uv);

  float luminance = mask.r;
  float edgeStrength = mask.g;
  float distToEdge = mask.b;
  float silhouette = mask.a;
  float remappedLum = pow(clamp(luminance, 0.0, 1.0), uContrast);

  // Cull background particles
  if (silhouette < 0.05 && luminance < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vLuminance = 0.0;
    vSourceColor = vec3(0.0);
    vCoreMask = 0.0;
    vEdgeMask = 0.0;
    vAlpha = 0.0;
    return;
  }

  // Core/edge masks — smooth transition
  float coreMask = smoothstep(0.04, 0.22, distToEdge);
  float edgeMask = (1.0 - smoothstep(0.0, 0.18, distToEdge)) * silhouette;

  // Base position
  vec3 pos = position;
  float t = uTime * uFlowSpeed;

  // ---- CORE MOTION: very subtle micro-twist ----
  vec2 coreFlow = flow(uv * 6.0 + aSeed * 0.3, t * 0.6);
  float coreAmp = uFlowAmplitude * 0.12 * coreMask;
  pos.x += coreFlow.x * coreAmp;
  pos.y += coreFlow.y * coreAmp;

  // ---- EDGE MOTION: contour-tangent peeling ----
  // Compute contour normal from distance field gradient
  vec2 texelSize = 1.0 / vec2(textureSize(uMaskTexture, 0));
  float dR = texture(uMaskTexture, uv + vec2(texelSize.x, 0.0)).b;
  float dL = texture(uMaskTexture, uv - vec2(texelSize.x, 0.0)).b;
  float dU = texture(uMaskTexture, uv + vec2(0.0, texelSize.y)).b;
  float dD = texture(uMaskTexture, uv - vec2(0.0, texelSize.y)).b;
  vec2 distGrad = vec2(dR - dL, dU - dD);
  vec2 contourNormal = length(distGrad) > 0.001 ? normalize(distGrad) : vec2(0.0);
  vec2 contourTangent = vec2(-contourNormal.y, contourNormal.x);

  // Edge flow: along tangent + slight outward drift
  float edgeAmp = uFlowAmplitude * uEdgeLooseness * edgeMask;
  float edgeNoise = flow(uv * 3.0 + aSeed * 2.0, t * 0.8).x;
  pos.x += contourTangent.x * edgeAmp * edgeNoise * 0.8;
  pos.y += contourTangent.y * edgeAmp * edgeNoise * 0.8;
  // Outward peel
  float peelNoise = flow(uv * 5.0 + aSeed * 1.5, t * 0.4 + 3.0).y;
  float peelAmount = edgeAmp * (0.3 + peelNoise * 0.4) * (1.0 + edgeStrength * 2.0);
  pos.x -= contourNormal.x * peelAmount;
  pos.y -= contourNormal.y * peelAmount;

  // ---- Z DEPTH: luminance-driven plume ----
  float zBase = remappedLum * uDepthStrength;
  float zEdge = edgeMask * uDepthStrength * 0.05 * peelNoise;
  pos.z = zBase + zEdge;

  // ---- MOUSE disturbance ----
  vec4 ms = texture(uMouseTexture, uv);
  float mouseIntensity = ms.r;
  vec2 mouseDir = ms.gb * 2.0 - 1.0;
  pos.x += mouseDir.x * mouseIntensity * uMouseStrength * 0.5;
  pos.y += mouseDir.y * mouseIntensity * uMouseStrength * 0.5;
  pos.z -= mouseIntensity * uMouseStrength * 0.25;

  // ---- Transform ----
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Point size: core = small/crisp, edge = slightly larger
  float sizeBoost = mix(0.85, 1.15, remappedLum);
  sizeBoost *= mix(1.0, 1.4, edgeMask * uEdgeLooseness);
  float refDepth = 1.8;
  gl_PointSize = uParticleSize * sizeBoost * refDepth / (-mvPosition.z);
  gl_PointSize = clamp(gl_PointSize, 0.5, 32.0);

  // Varyings
  vLuminance = remappedLum;
  vSourceColor = srcColor.rgb;
  vCoreMask = coreMask;
  vEdgeMask = edgeMask;
  vAlpha = mix(0.3, 1.0, remappedLum) * mix(1.0, 0.5, edgeMask * uEdgeLooseness)
         * (1.0 - mouseIntensity * 0.6);
}
