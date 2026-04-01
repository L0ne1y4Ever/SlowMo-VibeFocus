precision highp float;
precision highp int;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uAnchorTexture;
uniform sampler2D uBoundaryTexture;
uniform sampler2D uMetaTexture;
uniform float uDelta;
uniform float uTime;
uniform float uAttractionStrength;
uniform float uFlowStrength;
uniform float uErosionStrength;
uniform float uEdgeThreshold;
uniform float uEdgeBoost;
uniform float uDamping;
uniform float uDepthThickness;
uniform float uMotionSpeed;

in vec2 vUv;

out vec4 outColor;

const float TAU = 6.28318530718;

float angularDistance(float a, float b) {
  float d = abs(a - b);
  return min(d, TAU - d);
}

float poleWeight(float angle, float center, float width) {
  float d = angularDistance(angle, center);
  return exp(-(d * d) / max(0.0001, width * width));
}

vec3 curlLikeField(vec3 p, float t) {
  vec3 warped = p;
  warped += vec3(
    sin(p.z * 0.78 + t * 0.11),
    cos(p.x * 0.63 - t * 0.09),
    sin(p.y * 0.58 + t * 0.13)
  ) * 0.38;

  float dFz_dy = -1.58 * sin(warped.x * 1.42 + t * 0.29) * sin(warped.y * 1.58 - t * 0.37);
  float dFy_dz = 1.46 * cos(warped.z * 1.46 - t * 0.33) * cos(warped.x * 1.18 + t * 0.21);
  float dFx_dz = -1.34 * sin(warped.y * 1.68 + t * 0.41) * sin(warped.z * 1.34 - t * 0.27);
  float dFz_dx = 1.42 * cos(warped.x * 1.42 + t * 0.29) * cos(warped.y * 1.58 - t * 0.37);
  float dFy_dx = -1.18 * sin(warped.z * 1.46 - t * 0.33) * sin(warped.x * 1.18 + t * 0.21);
  float dFx_dy = 1.68 * cos(warped.y * 1.68 + t * 0.41) * cos(warped.z * 1.34 - t * 0.27);

  return normalize(vec3(
    dFz_dy - dFy_dz,
    dFx_dz - dFz_dx,
    dFy_dx - dFx_dy
  ) + 1e-5) * 1.6;
}

void main() {
  vec4 positionSample = texture(uPositionTexture, vUv);
  vec4 velocitySample = texture(uVelocityTexture, vUv);
  vec4 anchorSample = texture(uAnchorTexture, vUv);
  vec4 boundarySample = texture(uBoundaryTexture, vUv);
  vec4 meta = texture(uMetaTexture, vUv);

  vec3 position = positionSample.xyz;
  float detachState = positionSample.w;
  vec3 velocity = velocitySample.xyz;
  vec3 anchor = anchorSample.xyz;
  float coreWeight = anchorSample.w;
  vec2 boundaryNormal = boundarySample.xy;
  float shellDepth = boundarySample.z;
  float interior = boundarySample.w;
  float rawEdge = meta.x;
  float seed = meta.y;
  float depthBias = meta.z;
  float shellCoord = meta.w;

  float t = uTime * uMotionSpeed;
  if (dot(boundaryNormal, boundaryNormal) < 1e-6) {
    float radialLength = length(anchor.xy);
    boundaryNormal = radialLength > 1e-5 ? anchor.xy / radialLength : vec2(0.0, 1.0);
  } else {
    boundaryNormal = normalize(boundaryNormal);
  }

  vec2 tangentDir = vec2(-boundaryNormal.y, boundaryNormal.x);
  float angle = atan(boundaryNormal.y, boundaryNormal.x);

  float poleAngleA = t * 0.22 + 0.3;
  float poleAngleB = -t * 0.18 + 1.95;
  float poleAngleC = t * 0.27 + 3.32;
  float poleAngleD = -t * 0.24 + 5.1;
  float poleA = poleWeight(angle, poleAngleA, 0.44);
  float poleB = poleWeight(angle, poleAngleB, 0.4);
  float poleC = poleWeight(angle, poleAngleC, 0.48);
  float poleD = poleWeight(angle, poleAngleD, 0.42);
  vec2 poleVector =
    vec2(cos(poleAngleA), sin(poleAngleA)) * poleA +
    vec2(cos(poleAngleC), sin(poleAngleC)) * poleC * 0.82 -
    vec2(cos(poleAngleB), sin(poleAngleB)) * poleB -
    vec2(cos(poleAngleD), sin(poleAngleD)) * poleD * 0.78;
  float magnetRadial = dot(poleVector, boundaryNormal);
  float magnetTangential = dot(poleVector, tangentDir);
  float shellPulse = sin(t * 0.47 + angle * 4.6 + seed * 5.4);
  float shellCurl = cos(t * 0.35 - angle * 3.5 + seed * 3.8);
  float contourOffset = (magnetRadial * 0.2 + magnetTangential * 0.08 + shellPulse * 0.06) * shellDepth;
  float dynamicShell = shellCoord + contourOffset;

  float denseBand = 1.0 - smoothstep(0.62, 0.78, dynamicShell);
  float moireBand = smoothstep(0.58, 0.72, dynamicShell) * (1.0 - smoothstep(0.82, 0.94, dynamicShell));
  float shellBand = smoothstep(0.74, 0.98, dynamicShell) * smoothstep(0.22, 0.95, shellDepth);
  float dustBand = smoothstep(0.92, 1.14, dynamicShell) * shellDepth;

  float tissuePhase = dot(anchor.xy, vec2(6.5, -3.9));
  float tissuePhaseAlt = dot(anchor.xy, vec2(-4.3, 5.4));
  float coreWaveA = sin(t * 0.24 + tissuePhase + seed * 4.0);
  float coreWaveB = cos(t * 0.19 + tissuePhaseAlt - seed * 2.7);
  float coreWaveC = sin(t * 0.28 + dot(anchor.xy, vec2(5.7, -4.6)));
  vec2 coreWarp = vec2(coreWaveA + coreWaveC * 0.34, coreWaveB - coreWaveC * 0.3);
  vec2 coreWarpDir = normalize(coreWarp + 1e-5);
  vec2 moireAxisA = normalize(vec2(cos(seed * 3.0 + t * 0.05), sin(seed * 2.4 - t * 0.07)));
  vec2 moireAxisB = normalize(vec2(-sin(seed * 2.8 + t * 0.06), cos(seed * 1.9 - t * 0.05)));
  float moire = sin(dot(anchor.xy, moireAxisA * 23.0) + t * 0.58 + seed * 7.0);
  float moire2 = cos(dot(anchor.xy, moireAxisB * 19.0) - t * 0.42 + seed * 5.0);
  vec2 moireDir = normalize(vec2(moire, moire2) + 1e-5);
  float drumWave = sin(dot(anchor.xy, vec2(10.5, -8.4)) + t * 0.44) * cos(dot(anchor.xy, vec2(7.8, 9.6)) - t * 0.31);
  float depthWave = sin(dot(anchor.xy, vec2(12.8, -10.2)) + t * 0.39 + seed * 6.0);

  vec3 attachedTarget = anchor;
  attachedTarget.xy += coreWarpDir * length(coreWarp) * denseBand * 0.0018;
  attachedTarget.xy += moireDir * moire * moireBand * 0.0028;
  attachedTarget.xy += tangentDir * moire2 * moireBand * 0.0021;
  attachedTarget.xy += boundaryNormal * magnetRadial * moireBand * 0.0048;
  attachedTarget.xy += tangentDir * magnetTangential * moireBand * 0.0039;
  attachedTarget.z += uDepthThickness * (
    denseBand * (coreWaveA * 0.03 + coreWaveB * 0.026 + coreWaveC * 0.02) +
    moireBand * (moire * 0.08 + moire2 * 0.06 + drumWave * 0.05) +
    shellBand * (shellPulse * 0.06 + shellCurl * 0.05)
  );
  attachedTarget.z += depthBias * uDepthThickness * 0.1;

  float edgeBand = smoothstep(max(0.0, uEdgeThreshold - 0.08), min(1.0, uEdgeThreshold + 0.18), rawEdge);
  float bulgeMask = smoothstep(0.34, 0.92, max(poleA, poleC) + max(0.0, magnetRadial) * 0.28 + shellPulse * 0.08) * shellBand;
  float voidMask = smoothstep(0.3, 0.88, max(poleB, poleD) + max(0.0, -magnetRadial) * 0.34 + abs(magnetTangential) * 0.18 + shellCurl * 0.08) * shellBand;
  float fieldStrength = abs(magnetRadial) * 0.82 + abs(magnetTangential) * 0.56 + abs(shellPulse) * 0.42 + abs(shellCurl) * 0.32 + edgeBand * 0.22;
  float detachNoise = sin(t * 0.49 + seed * 21.0 + angle * 4.4) * 0.5 + 0.5;
  float detachDrive = shellBand * smoothstep(0.18, 0.72, fieldStrength + voidMask * 0.24) * smoothstep(0.24, 0.96, detachNoise);
  float detachDecay = mix(0.08, 0.18, 1.0 - shellBand);
  float nextDetach = clamp(detachState + detachDrive * uDelta * (1.6 + uErosionStrength * 0.9) - detachDecay * uDelta, 0.0, 1.0);
  float shellState = max(shellBand, smoothstep(0.06, 0.34, nextDetach));
  float detached = smoothstep(0.48, 0.76, nextDetach);

  vec2 collectiveShellVec = poleVector + vec2(shellPulse, shellCurl) * 0.38;
  vec2 shellDir = normalize(collectiveShellVec + boundaryNormal * 0.2 + 1e-5);
  vec3 detachedFlow = curlLikeField(anchor * 2.15 + position * 0.46 + vec3(seed * 4.3, seed * 3.2, nextDetach * 2.5), t);
  vec3 detachedForce = vec3(0.0);
  detachedForce.xy += boundaryNormal * (0.05 + shellBand * 0.08 + dustBand * 0.04) * (1.0 + max(0.0, magnetRadial) * 1.6);
  detachedForce.xy += tangentDir * magnetTangential * 0.09;
  detachedForce.xy += shellDir * (0.05 + shellBand * 0.05);
  detachedForce.xy += vec2(shellPulse, shellCurl) * 0.028;
  detachedForce += detachedFlow * (0.12 + uFlowStrength * 0.26);
  detachedForce.z += uDepthThickness * (
    shellBand * (magnetRadial * 0.24 + shellPulse * 0.18 + shellCurl * 0.14) +
    dustBand * (0.16 + depthWave * 0.12 + shellPulse * 0.08)
  );

  float contourDisplacement =
    bulgeMask * (0.05 + max(0.0, magnetRadial) * 0.1 + shellPulse * 0.02) -
    voidMask * (0.045 + max(0.0, -magnetRadial) * 0.08 + abs(magnetTangential) * 0.03);
  vec3 shellTarget = anchor;
  shellTarget.xy += boundaryNormal * contourDisplacement;
  shellTarget.xy += tangentDir * (magnetTangential * 0.022 + shellCurl * 0.012);
  shellTarget.xy += shellDir * (bulgeMask * 0.018 - voidMask * 0.012);
  shellTarget.xy += vec2(shellPulse, shellCurl) * shellBand * 0.006;
  shellTarget.z += uDepthThickness * (
    contourDisplacement * 1.15 +
    bulgeMask * (shellPulse * 0.12 + shellCurl * 0.08) -
    voidMask * (0.08 + abs(shellCurl) * 0.06)
  );

  vec3 attachedForce = (attachedTarget - position) * uAttractionStrength * mix(2.4, 1.6, moireBand + shellBand * 0.25);
  vec3 shellForce = (shellTarget - position) * uAttractionStrength * mix(0.62, 0.34, nextDetach) + vec3(boundaryNormal * contourDisplacement, contourDisplacement * 0.5);
  vec3 weakReturn = (shellTarget - position) * uAttractionStrength * mix(0.26, 0.08, detached);
  vec3 attachedToShell = mix(attachedForce, shellForce, shellState);
  vec3 totalForce = mix(attachedToShell, weakReturn + detachedForce, detached);

  vec3 breathingForce = vec3(
    sin(t * 0.22 + tissuePhase * 0.34),
    cos(t * 0.19 + tissuePhaseAlt * 0.31),
    sin(t * 0.29 + depthWave * 1.3 + seed * 6.8)
  ) * (denseBand * 0.0014 + moireBand * 0.0032 + shellBand * 0.0054 + detached * 0.0022);

  velocity += (totalForce + breathingForce) * uDelta;

  float damping = exp(-uDamping * mix(3.2, 0.74, detached) * mix(1.06, 0.94, dustBand) * uDelta * 60.0);
  velocity *= damping;

  float speedLimit = mix(0.022, 0.094, detached + dustBand * 0.12);
  float speed = length(velocity);
  if (speed > speedLimit) {
    velocity = normalize(velocity) * speedLimit;
  }

  outColor = vec4(velocity, nextDetach);
}
