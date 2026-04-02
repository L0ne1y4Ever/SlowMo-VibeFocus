precision highp float;
precision highp int;

uniform float uColorTint;
uniform float uAlphaGain;

in float vLuminance;
in vec3 vSourceColor;
in float vCoreMask;
in float vEdgeMask;
in float vAlpha;

out vec4 outColor;

void main() {
  // Crisp circular point sprite
  vec2 c = gl_PointCoord - 0.5;
  float dist = length(c) * 2.0;

  // Sharp core + soft halo
  float shape = exp(-dist * dist * 10.0);
  if (shape < 0.003) discard;

  // ---- COLOR: preserve source hue, bias toward luminous white ----
  vec3 warmWhite = vec3(1.0, 0.97, 0.93);

  // Base: mix source color toward white by luminance (brights go white, mids keep color)
  float whiteBias = 0.5 + vLuminance * 0.35;
  vec3 color = mix(vSourceColor * 1.2, warmWhite, whiteBias);
  // Tint control: 0 = fully white, 1 = maximum source color
  color = mix(warmWhite, color, uColorTint);
  // Brightness ramp
  color *= mix(0.2, 1.0, vLuminance);

  // ---- ALPHA: density gradient ----
  // Core: higher alpha → dense readable image
  // Edge: lower alpha → sparse, individual dots visible
  float baseAlpha = mix(0.01, 0.14, vLuminance);
  float alpha = shape * vAlpha * baseAlpha * uAlphaGain;

  // ---- ADDITIVE GLOW for highlights only ----
  float glow = vLuminance * vLuminance * 0.015 * shape * vCoreMask;

  // Premultiplied alpha output: color*alpha + glow
  outColor = vec4(color * alpha + glow, alpha);
}
