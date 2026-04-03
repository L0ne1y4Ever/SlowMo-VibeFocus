precision highp float;
precision highp int;

uniform float uColorTint;
uniform float uAlphaGain;

in vec3 vSourceColor;
in float vHighlightMask;
in float vDetachFactor;
in float vEdgeEnergy;
in float vAlpha;

out vec4 outColor;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float dist = length(centered) * 2.0;
  float shape = exp(-dist * dist * 8.6);
  float innerDisc = exp(-dist * dist * 13.6);
  if (shape < 0.002) {
    discard;
  }

  float luma = dot(vSourceColor, vec3(0.2126, 0.7152, 0.0722));
  float chromaRetention = mix(0.72, 1.0, uColorTint);
  vec3 warmWhite = vec3(1.0, 0.965, 0.93);
  vec3 color = mix(vec3(luma), vSourceColor, chromaRetention);
  float warmMix = clamp(vHighlightMask * 0.18 + vDetachFactor * vHighlightMask * 0.1, 0.0, 0.28);
  color = mix(color, warmWhite, warmMix);

  float alphaShape = mix(shape, innerDisc, 0.18);
  float alpha = alphaShape * vAlpha * uAlphaGain;
  float glow = shape * (vHighlightMask * 0.012 + vEdgeEnergy * 0.008);
  vec3 glowColor = mix(color, warmWhite, 0.38);

  outColor = vec4(color * alpha + glowColor * glow, alpha);
}
