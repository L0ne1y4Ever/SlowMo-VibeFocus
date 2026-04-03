precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

uniform sampler2D uSourceImage;
uniform sampler2D uAnalysisTexture;
uniform sampler2D uMouseTexture;
uniform float uTime;
uniform float uAudioLevel;
uniform float uAudioBass;
uniform float uAudioMid;
uniform float uAudioHigh;
uniform float uParticleSize;
uniform float uContrast;
uniform float uFlowSpeed;
uniform float uFlowAmplitude;
uniform float uEdgeLooseness;
uniform float uDepthStrength;
uniform float uMouseStrength;

in vec3 position;
in vec2 uv;
in float aSeed;
in float aWeight;
in float aPeelBias;
in float aPeelPhase;

out vec3 vSourceColor;
out float vHighlightMask;
out float vDetachFactor;
out float vEdgeEnergy;
out float vAlpha;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float remapContrast(float value, float contrast) {
  float normalizedContrast = clamp((contrast - 0.5) / 2.5, 0.0, 1.0);
  float scale = mix(0.82, 1.28, normalizedContrast);
  return saturate(0.5 + (value - 0.5) * scale);
}

vec2 flow(vec2 p, float t) {
  return vec2(
    sin(p.x * 2.06 + t * 0.88 + sin(p.y * 1.54 + t * 0.24) * 0.7),
    cos(p.y * 1.9 + t * 0.66 + cos(p.x * 2.18 - t * 0.29) * 0.66)
  );
}

float membraneWave(vec2 p, float t) {
  float waveA = sin(dot(p, vec2(6.3, 4.8)) + t * 1.28);
  float waveB = cos(dot(p, vec2(-4.0, 7.4)) - t * 1.02 + waveA * 0.32);
  return waveA * 0.54 + waveB * 0.46;
}

void main() {
  vec4 srcColor = texture(uSourceImage, uv);
  vec4 analysis = texture(uAnalysisTexture, uv);
  vec2 texelSize = 1.0 / vec2(textureSize(uAnalysisTexture, 0));

  float occupancy = analysis.r;
  float edgeStrength = analysis.g;
  float distToEdge = analysis.b;
  float highlightMask = analysis.a;

  if (occupancy < 0.02 || aPeelBias < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vSourceColor = vec3(0.0);
    vHighlightMask = 0.0;
    vDetachFactor = 0.0;
    vEdgeEnergy = 0.0;
    vAlpha = 0.0;
    return;
  }

  float luminance = dot(srcColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float tonalEnergy = max(0.1, remapContrast(luminance, uContrast));
  float coreMask = smoothstep(0.2, 0.62, distToEdge);
  float transitionMask = smoothstep(0.08, 0.34, distToEdge) * (1.0 - coreMask);

  vec2 centered = position.xy;
  float radius = length(centered);
  vec2 twistDir = radius > 0.0001 ? normalize(vec2(-centered.y, centered.x)) : vec2(0.0, 1.0);
  float t = uTime * uFlowSpeed;

  float dR = texture(uAnalysisTexture, uv + vec2(texelSize.x, 0.0)).b;
  float dL = texture(uAnalysisTexture, uv - vec2(texelSize.x, 0.0)).b;
  float dU = texture(uAnalysisTexture, uv + vec2(0.0, texelSize.y)).b;
  float dD = texture(uAnalysisTexture, uv - vec2(0.0, texelSize.y)).b;
  vec2 distGrad = vec2(dR - dL, dU - dD);
  vec2 contourNormal = length(distGrad) > 0.001 ? normalize(distGrad) : normalize(centered + vec2(0.0001, 0.0001));
  vec2 contourTangent = vec2(-contourNormal.y, contourNormal.x);

  vec2 lowFreqFlow = flow(uv * 4.15 + vec2(aSeed * 2.4, aSeed * 1.9), t * 0.76);
  vec2 highFreqFlow = flow(uv * 6.7 + vec2(aSeed * 4.4, aSeed * 2.4), t * 1.16);
  float twistPhase = sin(t * 0.9 + aSeed * 6.28318 + radius * 5.0);
  float wave = membraneWave(uv * 1.2 + centered * 0.52 + lowFreqFlow * 0.22, t + aSeed * 3.2);
  float audioLevel = clamp(uAudioLevel, 0.0, 1.0);
  float audioBass = clamp(uAudioBass, 0.0, 1.0);
  float audioMid = clamp(uAudioMid, 0.0, 1.0);
  float audioHigh = clamp(uAudioHigh, 0.0, 1.0);
  float breathing = sin(t * (1.18 + audioBass * 2.0) + radius * 5.4 + aPeelPhase * 6.28318);

  vec3 attached = position;
  float attachedAmplitude = uFlowAmplitude * (0.012 + transitionMask * 0.012 + highlightMask * 0.004);
  attached.xy += lowFreqFlow * attachedAmplitude;
  attached.xy += twistDir * (uFlowAmplitude * 0.012) * twistPhase * (0.16 + transitionMask * 0.42);
  attached.xy += contourTangent * (uFlowAmplitude * 0.0045) * wave * transitionMask;
  attached.z = uDepthStrength * (
    0.01 +
    occupancy * 0.014 +
    tonalEnergy * 0.048 +
    highlightMask * 0.012 +
    edgeStrength * 0.01
  );
  attached.z += uDepthStrength * (0.01 + transitionMask * 0.008) * wave;

  vec4 mouse = texture(uMouseTexture, uv);
  float mouseIntensity = mouse.r;
  vec2 mouseDir = mouse.gb * 2.0 - 1.0;
  attached.xy += mouseDir * mouseIntensity * uMouseStrength * (0.03 + transitionMask * 0.028);
  attached.z -= mouseIntensity * uMouseStrength * 0.05;

  float detachOscillation = 0.5 + 0.5 * sin(t * 0.96 + aPeelPhase * 6.28318 + wave * 1.4);
  float dynamicSupport = aPeelBias * (0.32 + 0.52 * detachOscillation);
  dynamicSupport *= 1.0 + audioLevel * 0.5 + audioHigh * 0.34 + mouseIntensity * 0.45;
  float detachFactor = clamp(dynamicSupport, 0.0, 0.88);

  float tangentDrift = uFlowAmplitude * uEdgeLooseness * detachFactor * (0.12 + 0.14 * highFreqFlow.x + audioMid * 0.12);
  float outwardPeel = uFlowAmplitude * uEdgeLooseness * detachFactor * (0.06 + 0.08 * (0.5 + 0.5 * highFreqFlow.y) + audioHigh * 0.06);
  vec3 detached = attached;
  detached.xy += contourTangent * tangentDrift;
  detached.xy -= contourNormal * outwardPeel;
  detached.xy += lowFreqFlow * (uFlowAmplitude * 0.018 * detachFactor);
  detached.xy += contourNormal * wave * (uFlowAmplitude * 0.01 * detachFactor);
  detached.z += uDepthStrength * (0.02 + highlightMask * 0.012 + audioLevel * 0.012);
  detached.z += uDepthStrength * (0.028 + audioLevel * 0.022 + audioBass * 0.016) * breathing * detachFactor;

  vec3 pos = mix(attached, detached, detachFactor);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float sizeBoost = mix(1.0, 1.34, detachFactor);
  sizeBoost *= mix(0.94, 1.08, tonalEnergy);
  gl_PointSize = uParticleSize * sizeBoost * 1.8 / max(0.001, -mvPosition.z);
  gl_PointSize = clamp(gl_PointSize, 1.25, 30.0);

  vSourceColor = srcColor.rgb;
  vHighlightMask = highlightMask;
  vDetachFactor = detachFactor;
  vEdgeEnergy = clamp(detachFactor * (0.62 + edgeStrength * 0.3 + highlightMask * 0.18), 0.0, 1.0);
  vAlpha = clamp(0.1 + detachFactor * 0.2 + highlightMask * 0.05, 0.0, 0.34);
}
