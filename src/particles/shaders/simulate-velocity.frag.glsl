precision highp float;
precision highp int;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uAnchorTexture;
uniform sampler2D uBoundaryTexture;
uniform sampler2D uMetaTexture;
uniform vec2 uDomainScale;
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

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

void accumulatePole(
  vec2 anchorPos,
  vec2 center,
  float radius,
  float polarity,
  vec2 boundaryNormal,
  vec2 tangentDir,
  inout float normalDrive,
  inout float tangentDrive,
  inout float bulgeDrive,
  inout float voidDrive,
  inout vec2 fieldVector
) {
  vec2 delta = center - anchorPos;
  float dist = length(delta) + 1e-5;
  vec2 dir = delta / dist;
  float influence = exp(-dot(delta, delta) / max(0.0001, radius * radius));
  float normalAlignment = dot(dir, boundaryNormal);
  float tangentAlignment = dot(dir, tangentDir);

  normalDrive += influence * polarity * normalAlignment;
  tangentDrive += influence * polarity * tangentAlignment;
  bulgeDrive += influence * max(0.0, polarity * normalAlignment);
  voidDrive += influence * max(0.0, -polarity * normalAlignment);
  fieldVector += dir * influence * polarity;
}

vec3 curlLikeField(vec3 p, float t) {
  vec3 warped = p;
  warped += vec3(
    sin(p.z * 0.92 + t * 0.14),
    cos(p.x * 0.71 - t * 0.11),
    sin(p.y * 0.64 + t * 0.16)
  ) * 0.34;

  float dFz_dy = -1.32 * sin(warped.x * 1.18 + t * 0.27) * sin(warped.y * 1.32 - t * 0.21);
  float dFy_dz = 1.26 * cos(warped.z * 1.26 - t * 0.29) * cos(warped.x * 1.06 + t * 0.18);
  float dFx_dz = -1.18 * sin(warped.y * 1.44 + t * 0.33) * sin(warped.z * 1.18 - t * 0.24);
  float dFz_dx = 1.18 * cos(warped.x * 1.18 + t * 0.27) * cos(warped.y * 1.32 - t * 0.21);
  float dFy_dx = -1.06 * sin(warped.z * 1.26 - t * 0.29) * sin(warped.x * 1.06 + t * 0.18);
  float dFx_dy = 1.44 * cos(warped.y * 1.44 + t * 0.33) * cos(warped.z * 1.18 - t * 0.24);

  return normalize(vec3(
    dFz_dy - dFy_dz,
    dFx_dz - dFz_dx,
    dFy_dx - dFx_dy
  ) + 1e-5) * 1.45;
}

void main() {
  vec4 positionSample = texture(uPositionTexture, vUv);
  vec4 velocitySample = texture(uVelocityTexture, vUv);
  vec4 anchorSample = texture(uAnchorTexture, vUv);
  vec4 boundarySample = texture(uBoundaryTexture, vUv);
  vec4 meta = texture(uMetaTexture, vUv);

  vec3 position = positionSample.xyz;
  float state = positionSample.w;
  vec3 velocity = velocitySample.xyz;
  vec3 anchor = anchorSample.xyz;
  float coreWeight = anchorSample.w;
  vec2 boundaryNormal = boundarySample.xy;
  float shellDepth = boundarySample.z;
  float interior = boundarySample.w;
  float seed = meta.y;
  float depthBias = meta.z;

  float t = uTime * uMotionSpeed;
  if (dot(boundaryNormal, boundaryNormal) < 1e-6) {
    boundaryNormal = vec2(0.0, 1.0);
  } else {
    boundaryNormal = normalize(boundaryNormal);
  }

  vec2 tangentDir = vec2(-boundaryNormal.y, boundaryNormal.x);
  float shellInner = 0.08 + uEdgeThreshold * 0.18;
  float shellOuter = min(0.72, shellInner + 0.16 + uEdgeBoost * 0.08);
  float shellEligible = (1.0 - smoothstep(shellInner, shellOuter, interior)) * smoothstep(0.16, 0.7, shellDepth);
  float transitionBand = smoothstep(shellInner * 0.8 + 0.12, shellOuter + 0.08, interior) * (1.0 - smoothstep(0.52, 0.84, interior));
  float coreBand = smoothstep(0.34, 0.84, interior) * mix(0.7, 1.0, coreWeight);

  vec2 extent = uDomainScale * 0.5;
  float majorScale = max(uDomainScale.x, uDomainScale.y);
  vec2 poleA = extent * vec2(-0.82 + 0.16 * sin(t * 0.21 + 0.3), 0.58 + 0.16 * cos(t * 0.17 + 1.2));
  vec2 poleB = extent * vec2(0.88 + 0.1 * cos(t * 0.19 + 2.1), 0.08 + 0.22 * sin(t * 0.24 + 0.7));
  vec2 poleC = extent * vec2(-0.28 + 0.18 * sin(t * 0.23 + 1.4), -0.86 + 0.12 * cos(t * 0.15 + 2.4));
  vec2 poleD = extent * vec2(0.18 + 0.22 * cos(t * 0.27 + 3.1), -0.34 + 0.18 * sin(t * 0.18 + 4.0));

  float normalDrive = 0.0;
  float tangentDrive = 0.0;
  float bulgeDrive = 0.0;
  float voidDrive = 0.0;
  vec2 fieldVector = vec2(0.0);

  accumulatePole(anchor.xy, poleA, majorScale * 0.22, 1.0, boundaryNormal, tangentDir, normalDrive, tangentDrive, bulgeDrive, voidDrive, fieldVector);
  accumulatePole(anchor.xy, poleB, majorScale * 0.19, -1.0, boundaryNormal, tangentDir, normalDrive, tangentDrive, bulgeDrive, voidDrive, fieldVector);
  accumulatePole(anchor.xy, poleC, majorScale * 0.18, 1.0, boundaryNormal, tangentDir, normalDrive, tangentDrive, bulgeDrive, voidDrive, fieldVector);
  accumulatePole(anchor.xy, poleD, majorScale * 0.17, -1.0, boundaryNormal, tangentDir, normalDrive, tangentDrive, bulgeDrive, voidDrive, fieldVector);

  float localWeave = sin(anchor.x * 9.4 + t * 0.34 + seed * 11.0) * cos(anchor.y * 11.2 - t * 0.29 + seed * 7.1);
  float localRipple = sin(dot(anchor.xy, vec2(7.6, -5.4)) + t * 0.41 + seed * 5.3);
  float localCurl = sin(dot(anchor.xy, vec2(-8.8, 6.3)) - t * 0.37 + seed * 3.1) * cos(dot(anchor.xy, vec2(6.9, 9.1)) + t * 0.28 + seed * 2.4);
  float shellMacro = abs(normalDrive) * 1.18 + abs(tangentDrive) * 0.84 + bulgeDrive * 0.76 + voidDrive * 0.96 + abs(localWeave) * 0.18;
  float shellActivity = shellEligible * saturate(shellMacro * (0.6 + uErosionStrength * 0.28));

  float shellFloor = shellEligible * (0.18 + smoothstep(0.12, 0.4, shellActivity) * 0.16);
  float detachedIntent = shellEligible * smoothstep(0.52, 1.08, shellMacro + voidDrive * 0.38 + bulgeDrive * 0.2 + abs(localRipple) * 0.14);
  float stateTarget = clamp(shellFloor + detachedIntent * 0.76, 0.0, 1.0);
  float riseRate = 0.9 + shellMacro * 0.9 + uErosionStrength * 0.36;
  float fallRate = mix(0.13, 0.035, smoothstep(0.66, 0.92, state));
  float rate = stateTarget > state ? riseRate : fallRate;
  float nextState = clamp(state + (stateTarget - state) * saturate(rate * uDelta), 0.0, 1.0);

  float detached = smoothstep(0.7, 0.9, nextState);
  float shellAttached = shellEligible * (1.0 - detached) * smoothstep(0.14, 0.5, nextState + shellEligible * 0.34);

  vec2 tissueWarp = vec2(
    sin(dot(anchor.xy, vec2(5.3, -3.9)) + t * 0.22 + seed * 5.6),
    cos(dot(anchor.xy, vec2(-4.2, 6.1)) - t * 0.19 + seed * 4.8)
  );
  vec3 attachedTarget = anchor;
  attachedTarget.xy += tissueWarp * (coreBand * 0.0016 + transitionBand * 0.0023);
  attachedTarget.xy += tangentDir * localCurl * transitionBand * 0.0018;
  attachedTarget.z += uDepthThickness * (
    coreBand * (localWeave * 0.04 + localRipple * 0.03) +
    transitionBand * (localCurl * 0.08 + localRipple * 0.06)
  );
  attachedTarget.z += depthBias * uDepthThickness * 0.08;

  float contourNormalDisplacement =
    shellEligible *
    (normalDrive * 0.082 + bulgeDrive * 0.048 - voidDrive * 0.072 + localRipple * 0.016) *
    (0.58 + uEdgeBoost * 0.34);
  float contourShear =
    shellEligible *
    (tangentDrive * 0.041 + localCurl * 0.024 + localWeave * 0.012) *
    (0.54 + uFlowStrength * 0.48);

  vec3 shellTarget = anchor;
  shellTarget.xy += boundaryNormal * contourNormalDisplacement;
  shellTarget.xy += tangentDir * contourShear;
  shellTarget.xy += fieldVector * (0.018 + bulgeDrive * 0.014 + voidDrive * 0.01) * shellEligible;
  shellTarget.z += uDepthThickness * (
    shellEligible * (contourNormalDisplacement * 1.7 + contourShear * 0.42 + localCurl * 0.1) +
    shellAttached * (0.05 + localWeave * 0.07) -
    voidDrive * 0.1
  );

  vec3 detachedFlow = curlLikeField(vec3(anchor.xy * 2.1 + position.xy * 0.24, position.z * 6.4 + seed * 2.3), t + seed * 1.7);
  vec3 detachedForce = vec3(0.0);
  detachedForce.xy += boundaryNormal * (0.034 + max(0.0, normalDrive) * 0.09 + bulgeDrive * 0.05 - voidDrive * 0.018);
  detachedForce.xy += tangentDir * (contourShear * 1.45 + localCurl * 0.032);
  detachedForce.xy += fieldVector * (0.09 + uFlowStrength * 0.1);
  detachedForce += detachedFlow * (0.06 + uFlowStrength * 0.22);
  detachedForce.z += uDepthThickness * (0.22 + abs(localCurl) * 0.18 + shellMacro * 0.1 + abs(localWeave) * 0.08);

  vec3 attachedForce = (attachedTarget - position) * uAttractionStrength * mix(2.5, 1.4, transitionBand + shellEligible * 0.18);
  vec3 shellForce =
    (shellTarget - position) * uAttractionStrength * mix(0.76, 0.28, nextState) +
    vec3(boundaryNormal * contourNormalDisplacement * 0.56, contourNormalDisplacement * 0.42);
  vec3 detachedReturn = (shellTarget - position) * uAttractionStrength * mix(0.16, 0.05, detached);

  vec3 attachedToShell = mix(attachedForce, shellForce, shellAttached);
  vec3 totalForce = mix(attachedToShell, detachedReturn + detachedForce, detached);

  vec3 breathingForce = vec3(
    sin(t * 0.2 + dot(anchor.xy, vec2(4.2, -2.8)) + seed * 6.1),
    cos(t * 0.23 + dot(anchor.xy, vec2(-3.2, 4.4)) - seed * 4.9),
    sin(t * 0.27 + dot(anchor.xy, vec2(5.0, 3.4)) + seed * 7.2)
  ) * (coreBand * 0.0014 + transitionBand * 0.0022 + shellAttached * 0.0036 + detached * 0.0022);

  velocity += (totalForce + breathingForce) * uDelta;

  float mobility = shellAttached * 0.56 + detached + transitionBand * 0.22;
  float damping = exp(-uDamping * mix(4.3, 0.82, mobility) * uDelta * 60.0);
  velocity *= damping;

  float speedLimit = mix(0.02, 0.11, detached + shellAttached * 0.42);
  float speed = length(velocity);
  if (speed > speedLimit) {
    velocity = normalize(velocity) * speedLimit;
  }

  outColor = vec4(velocity, nextState);
}
