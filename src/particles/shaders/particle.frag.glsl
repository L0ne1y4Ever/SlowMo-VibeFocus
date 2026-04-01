precision highp float;
precision highp int;

uniform float uAlphaGain;

in vec2 vQuadUv;
in vec4 vColor;
in float vEdge;
in float vCore;
in float vSeed;
in float vShell;
in float vDetach;

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

  float body = exp(-radiusSquared * mix(3.45, 2.7, vCore));
  float haze = exp(-radiusSquared * mix(1.45, 1.1, vEdge));
  float breakup = 0.94 + 0.06 *
    sin((warpedUv.x + vSeed * 1.7) * 13.0) *
    sin((warpedUv.y - vSeed * 2.1) * 11.0);
  float moireBand = smoothstep(0.58, 0.76, vShell) * (1.0 - smoothstep(0.84, 0.96, vShell));
  float peelBand = smoothstep(0.78, 1.06, vShell);

  float alpha = (body * 0.74 + haze * 0.3) *
    breakup *
    vColor.a *
    mix(0.98, 0.82, vEdge) *
    mix(0.98, 1.04, vCore) *
    mix(1.04, 0.72, peelBand) *
    mix(1.0, 0.48, vDetach) *
    (1.0 + moireBand * 0.05) *
    uAlphaGain;

  vec3 color = vColor.rgb * (0.985 + body * 0.045 + haze * 0.02) * (1.0 + moireBand * 0.03) * mix(1.0, 0.94, vDetach);

  if (alpha < 0.001) {
    discard;
  }

  outColor = vec4(color * alpha, alpha);
}
