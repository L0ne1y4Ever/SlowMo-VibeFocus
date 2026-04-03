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
uniform float uDepthStrength;
uniform float uMouseStrength;

in vec3 position;
in vec2 uv;
in float aSeed;
in float aWeight;

out vec3 vSourceColor;
out float vEnergy;
out float vHighlightMask;

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
    sin(p.x * 2.02 + t * 0.84 + sin(p.y * 1.58 - t * 0.26) * 0.72),
    cos(p.y * 1.88 + t * 0.62 + cos(p.x * 2.34 + t * 0.31) * 0.64)
  );
}

float membraneWave(vec2 p, float t) {
  float waveA = sin(dot(p, vec2(5.9, 4.6)) + t * 1.22);
  float waveB = cos(dot(p, vec2(-4.2, 6.8)) - t * 1.04 + waveA * 0.34);
  return waveA * 0.56 + waveB * 0.44;
}

void main() {
  vec4 srcColor = texture(uSourceImage, uv);
  vec4 analysis = texture(uAnalysisTexture, uv);

  float occupancy = analysis.r;
  float edgeStrength = analysis.g;
  float distToEdge = analysis.b;
  float highlightMask = analysis.a;

  if (occupancy < 0.02) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vSourceColor = vec3(0.0);
    vEnergy = 0.0;
    vHighlightMask = 0.0;
    return;
  }

  float luminance = dot(srcColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float tonalEnergy = max(0.1, remapContrast(luminance, uContrast));
  float coreMask = smoothstep(0.2, 0.62, distToEdge);
  float transitionMask = smoothstep(0.08, 0.34, distToEdge) * (1.0 - coreMask);

  vec3 pos = position;
  vec2 centered = position.xy;
  float radius = length(centered);
  vec2 twistDir = radius > 0.0001 ? normalize(vec2(-centered.y, centered.x)) : vec2(0.0, 1.0);
  float t = uTime * uFlowSpeed;

  vec2 lowFreqFlow = flow(uv * 4.0 + vec2(aSeed * 2.1, aSeed * 1.7), t * 0.72);
  vec2 highFreqFlow = flow(uv * 6.3 + vec2(aSeed * 4.0, aSeed * 3.2), t * 1.08);
  float twistPhase = sin(t * 0.92 + aSeed * 6.28318 + radius * 4.6);
  float wave = membraneWave(uv * 1.16 + centered * 0.48 + lowFreqFlow * 0.18, t + aSeed * 2.9);
  float audioLevel = clamp(uAudioLevel, 0.0, 1.0);
  float audioBass = clamp(uAudioBass, 0.0, 1.0);
  float breathing = sin(t * (1.16 + audioBass * 1.8) + radius * 5.1 + aSeed * 5.6);

  float microAmplitude = uFlowAmplitude * (0.012 + transitionMask * 0.011 + highlightMask * 0.005);
  pos.xy += lowFreqFlow * microAmplitude;
  pos.xy += twistDir * (uFlowAmplitude * 0.013) * twistPhase * (0.18 + coreMask * 0.42 + transitionMask * 0.24);
  pos.xy += highFreqFlow * (uFlowAmplitude * 0.0048) * transitionMask;

  float baseRelief = uDepthStrength * (
    0.01 +
    occupancy * 0.016 +
    tonalEnergy * 0.055 +
    highlightMask * 0.012 +
    edgeStrength * 0.008
  );
  float idleLift = uDepthStrength * (0.012 + transitionMask * 0.008 + highlightMask * 0.007) * wave;
  float audioLift = uDepthStrength * (audioLevel * (0.017 + highlightMask * 0.009) + audioBass * 0.012);
  float audioBreath = uDepthStrength * audioLevel * 0.012 * breathing;
  pos.z = baseRelief + idleLift + audioLift + audioBreath;

  vec4 mouse = texture(uMouseTexture, uv);
  float mouseIntensity = mouse.r;
  vec2 mouseDir = mouse.gb * 2.0 - 1.0;
  pos.xy += mouseDir * mouseIntensity * uMouseStrength * (0.03 + transitionMask * 0.02);
  pos.z -= mouseIntensity * uMouseStrength * 0.05;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float sizeBoost = mix(0.92, 1.14, coreMask + transitionMask * 0.42);
  sizeBoost *= mix(0.94, 1.06, tonalEnergy);
  sizeBoost *= mix(0.9, 1.08, clamp(aWeight, 0.0, 1.0));
  gl_PointSize = uParticleSize * sizeBoost * 1.8 / max(0.001, -mvPosition.z);
  gl_PointSize = clamp(gl_PointSize, 1.15, 28.0);

  float occupancyFloor = max(occupancy, 0.34);
  float structuralDensity = occupancyFloor * mix(0.72, 1.06, coreMask + transitionMask * 0.34);
  float tonalBoost = mix(0.9, 1.08, sqrt(tonalEnergy));
  vSourceColor = srcColor.rgb;
  vHighlightMask = highlightMask;
  vEnergy = structuralDensity * tonalBoost * (1.0 - mouseIntensity * 0.12);
}
