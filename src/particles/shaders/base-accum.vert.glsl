precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

uniform sampler2D uSourceImage;
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
uniform float uEdgeLooseness;
uniform float uAlphaGain;
uniform float uContentAspect;

in vec3 position;
in vec2 uv;
in float aSeed;

out vec3 vSourceColor;
out float vEnergy;
out float vHighlightMask;
out float vAlpha;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float remapContrast(float value, float contrast) {
  float normalizedContrast = clamp((contrast - 0.5) / 2.5, 0.0, 1.0);
  float scale = mix(0.82, 1.28, normalizedContrast);
  return saturate(0.5 + (value - 0.5) * scale);
}

// Curl noise helpers
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
  float luminance = dot(srcColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float tonalEnergy = max(0.1, remapContrast(luminance, uContrast));
  float highlightMask = smoothstep(0.6, 0.95, luminance);

  // Noise flow and wave fields
  float t = uTime * uFlowSpeed;
  vec2 lowFreqFlow = flow(uv * 4.15 + vec2(aSeed * 2.4, aSeed * 1.9), t * 0.76);
  vec2 highFreqFlow = flow(uv * 8.7 + vec2(aSeed * 4.4, aSeed * 2.4), t * 1.16);

  // Radial metrics (Portal shape)
  vec2 centered = uv - vec2(0.5);
  centered.x *= uContentAspect; // Keep it perfectly circular regardless of aspect ratio
  float radius = length(centered);

  // Make the radius "wobbly" by adding noise
  float organicRadius = radius + (lowFreqFlow.x * 0.04) + (highFreqFlow.y * 0.02);

  // The portal shape definitions
  float coreRadius = 0.30;
  float EdgeRadius = 0.48;
  
  float coreMask = 1.0 - smoothstep(coreRadius - 0.1, coreRadius + 0.05, organicRadius);
  float transitionMask = smoothstep(coreRadius - 0.05, coreRadius + 0.1, organicRadius);
  // Fade out completely by EdgeRadius
  float fadeOut = 1.0 - smoothstep(coreRadius, EdgeRadius, organicRadius);
  
  if (fadeOut <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vSourceColor = vec3(0.0);
    vEnergy = 0.0;
    vHighlightMask = 0.0;
    vAlpha = 0.0;
    return;
  }

  vec3 pos = position;
  
  // Vectors for flow
  vec2 outwardDir = radius > 0.0001 ? normalize(centered) : vec2(0.0, 1.0);
  vec2 tangentDir = vec2(-outwardDir.y, outwardDir.x);

  float wave = membraneWave(uv * 1.5 + centered * 0.52 + lowFreqFlow * 0.22, t + aSeed * 3.2);

  // Audio responsiveness
  float audioLevel = clamp(uAudioLevel, 0.0, 1.0);
  float audioBass = clamp(uAudioBass, 0.0, 1.0);
  float audioHigh = clamp(uAudioHigh, 0.0, 1.0);
  float breathing = sin(t * (1.18 + audioBass * 2.0) + radius * 12.4 + aSeed * 6.28318);

  // --- CORE DISPLACEMENT --
  // We keep the center relatively stiff
  float stiffAmplitude = uFlowAmplitude * (0.01 + coreMask * 0.005 + highlightMask * 0.005);
  vec3 attached = pos;
  attached.xy += lowFreqFlow * stiffAmplitude;
  attached.z = uDepthStrength * (0.01 + tonalEnergy * 0.04 + highlightMask * 0.01);
  attached.z += uDepthStrength * (0.01 + coreMask * 0.005) * wave;

  // --- EDGE DISPLACEMENT (Peeling) ---
  // The outer area goes wild with noise and blows outwards
  float detachFactor = transitionMask * (0.5 + 0.5 * sin(t * 1.2 + aSeed * 6.28 + wave * 2.0));
  detachFactor *= 1.0 + audioLevel * 0.5 + audioHigh * 0.4;
  
  // Use much larger multipliers to ensure the peel effect is visible
  float tangentDrift = uFlowAmplitude * uEdgeLooseness * detachFactor * (8.0 + 12.0 * highFreqFlow.x);
  float outwardPeel = uFlowAmplitude * uEdgeLooseness * detachFactor * (12.0 + 15.0 * highFreqFlow.y);
  
  vec3 detached = attached;
  detached.xy += tangentDir * tangentDrift;
  // It's blowing out, so pull it slightly away based on radius to create explosion
  detached.xy += outwardDir * outwardPeel; 
  detached.xy += lowFreqFlow * (uFlowAmplitude * 1.5 * detachFactor);
  detached.z += uDepthStrength * (0.15 + audioLevel * 0.08) * breathing * detachFactor;

  // Mix between core and edge behavior
  pos = mix(attached, detached, transitionMask);

  // Interaction with mouse
  vec4 mouse = texture(uMouseTexture, uv);
  float mouseIntensity = mouse.r;
  vec2 mouseDir = mouse.gb * 2.0 - 1.0;
  pos.xy += mouseDir * mouseIntensity * uMouseStrength * (0.03 + transitionMask * 0.05);
  pos.z -= mouseIntensity * uMouseStrength * 0.1;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Visuals: Size
  float sizeBoost = mix(1.0, 1.4, transitionMask);
  sizeBoost *= mix(0.9, 1.1, tonalEnergy);
  gl_PointSize = uParticleSize * sizeBoost * 1.8 / max(0.001, -mvPosition.z);
  gl_PointSize = clamp(gl_PointSize, 1.0, 20.0);

  // Visuals: Colors & Alpha
  vSourceColor = srcColor.rgb;
  vHighlightMask = highlightMask;
  
  // High energy structure at the core, drops heavily at edges
  vEnergy = mix(1.0, 0.4, transitionMask) * mix(0.8, 1.2, sqrt(tonalEnergy));
  
  // Alpha fades perfectly to invisible at the fringes due to radial fadeOut
  float densityGradient = mix(1.0, smoothstep(0.0, 1.0, fadeOut), transitionMask);
  // Adding small random noise to alpha for particulate effect at the edges
  float particleFade = saturate(densityGradient * uAlphaGain * (0.8 + 0.4 * abs(highFreqFlow.x)));
  vAlpha = particleFade;
}
