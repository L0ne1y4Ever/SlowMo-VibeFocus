precision highp float;
precision highp int;

uniform float uAlphaGain;
uniform int uDebugMode;

in vec2 vQuadUv;
in vec4 vColor;
in float vEdge;
in float vCore;
in float vSeed;
in float vShell;
in float vState;
in vec3 vVelocity;

out vec4 outColor;

void main() {
  vec2 centeredUv = vQuadUv * 2.0 - 1.0;
  float skew = (vSeed - 0.5) * 0.16;
  vec2 warpedUv = centeredUv;
  warpedUv.x += centeredUv.y * skew * 0.22;
  warpedUv.y -= centeredUv.x * skew * 0.14;
  warpedUv *= vec2(1.0 + skew * 0.05, 1.0 - skew * 0.04);
  float radiusSquared = dot(warpedUv, warpedUv);

  if (radiusSquared > 1.22) {
    discard;
  }

  float body = exp(-radiusSquared * mix(3.45, 2.72, vCore));
  float haze = exp(-radiusSquared * mix(1.45, 1.08, vEdge));
  float breakup = 0.94 + 0.06 *
    sin((warpedUv.x + vSeed * 1.7) * 13.0) *
    sin((warpedUv.y - vSeed * 2.1) * 11.0);

  float shellBand = 1.0 - smoothstep(0.12, 0.46, vShell);
  float transitionBand = smoothstep(0.18, 0.42, vShell) * (1.0 - smoothstep(0.46, 0.78, vShell));
  float coreBand = smoothstep(0.34, 0.82, vShell) * mix(0.82, 1.0, vCore);
  float detached = smoothstep(0.7, 0.9, vState);
  float shellAttached = shellBand * (1.0 - detached) * smoothstep(0.14, 0.5, vState + shellBand * 0.34);

  float alpha = 0.0;
  vec3 color = vec3(0.0);

  if (uDebugMode == 1) {
    alpha = (body * 0.9 + haze * 0.1) * 0.96;
    color = vec3(1.0);
  } else if (uDebugMode == 2) {
    alpha = (body * 0.82 + haze * 0.18) * 0.94;
    color = mix(vec3(0.03, 0.07, 0.12), vec3(0.93, 0.96, 1.0), clamp(vShell, 0.0, 1.0));
  } else if (uDebugMode == 3) {
    if (shellBand < 0.02) {
      discard;
    }

    alpha = (body * 0.78 + haze * 0.22) * shellBand;
    color = mix(vec3(1.0, 0.28, 0.08), vec3(1.0, 0.94, 0.58), shellBand);
  } else if (uDebugMode == 4) {
    alpha = (body * 0.72 + haze * 0.28) * max(max(coreBand, shellAttached), detached);
    color =
      vec3(0.94, 0.94, 0.98) * coreBand +
      vec3(0.22, 0.82, 1.0) * shellAttached +
      vec3(1.0, 0.26, 0.12) * detached;
  } else if (uDebugMode == 5) {
    vec2 dir = normalize(vVelocity.xy + vec2(1e-5));
    float magnitude = clamp(length(vVelocity) * 18.0, 0.0, 1.0);
    alpha = max(0.18, magnitude) * (body * 0.56 + haze * 0.44);
    color = mix(vec3(0.04), 0.5 + 0.5 * vec3(dir.x, dir.y, magnitude * 2.0 - 1.0), magnitude);
  } else {
    alpha = (body * 0.76 + haze * 0.28) *
      breakup *
      vColor.a *
      mix(0.98, 1.03, coreBand) *
      mix(1.0, 0.86, shellAttached * 0.48) *
      mix(1.0, 0.44, detached) *
      (1.0 + transitionBand * 0.05) *
      uAlphaGain;

    color = vColor.rgb *
      (0.985 + body * 0.045 + haze * 0.018) *
      (1.0 + transitionBand * 0.03) *
      mix(1.0, 0.95, shellAttached * 0.24 + detached * 0.34);
  }

  if (alpha < 0.001) {
    discard;
  }

  outColor = vec4(color * alpha, alpha);
}
