precision highp float;
precision highp int;

uniform float uColorTint;

in vec3 vSourceColor;
in float vEnergy;
in float vHighlightMask;

out vec4 outColor;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float dist = length(centered) * 2.0;
  float shape = exp(-dist * dist * 10.5);
  float innerDisc = exp(-dist * dist * 17.5);
  if (shape < 0.002) {
    discard;
  }

  float luma = dot(vSourceColor, vec3(0.2126, 0.7152, 0.0722));
  float chromaRetention = mix(0.74, 1.0, uColorTint);
  vec3 warmWhite = vec3(1.0, 0.965, 0.93);
  vec3 color = mix(vec3(luma), vSourceColor, chromaRetention);
  color = mix(color, warmWhite, vHighlightMask * 0.08);

  float alphaShape = mix(shape, innerDisc, 0.22);
  float energy = alphaShape * vEnergy;
  float glow = shape * vHighlightMask * 0.01;
  vec3 glowColor = mix(color, warmWhite, 0.3);

  outColor = vec4(color * energy + glowColor * glow, energy + glow * 0.24);
}
