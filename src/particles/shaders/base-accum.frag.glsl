precision highp float;
precision highp int;

uniform float uColorTint;

in vec3 vSourceColor;
in float vEnergy;
in float vHighlightMask;
in float vAlpha;

out vec4 outColor;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float dist = length(centered) * 2.0;

  // Particle shape (soft dot)
  float shape = exp(-dist * dist * 10.5);
  float innerDisc = exp(-dist * dist * 17.5);
  if (shape < 0.002) {
    discard;
  }

  // Coloring
  float luma = dot(vSourceColor, vec3(0.2126, 0.7152, 0.0722));
  float chromaRetention = mix(0.74, 1.0, uColorTint);
  vec3 warmWhite = vec3(1.0, 0.965, 0.93);
  vec3 color = mix(vec3(luma), vSourceColor, chromaRetention);
  color = mix(color, warmWhite, vHighlightMask * 0.12);

  float alphaShape = mix(shape, innerDisc, 0.22);
  
  // Total opacity is based on both core energy and edge dispersion alpha
  float particleOpacity = alphaShape * max(vEnergy, vAlpha);
  
  // Glow
  float glow = shape * vHighlightMask * 0.015;
  vec3 glowColor = mix(color, warmWhite, 0.35);

  // Premultiplied alpha additive blending
  outColor = vec4(color * particleOpacity + glowColor * glow, particleOpacity + glow * 0.24);
}
