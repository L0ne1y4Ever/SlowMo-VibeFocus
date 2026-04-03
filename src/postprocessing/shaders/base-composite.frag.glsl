precision highp float;
precision highp int;

uniform sampler2D tBaseAccum;
uniform float uAlphaGain;

varying vec2 vUv;

void main() {
  vec4 accumulation = texture(tBaseAccum, vUv);
  float coverage = accumulation.a;
  if (coverage <= 0.0001) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec3 color = accumulation.rgb / max(coverage, 0.0001);
  float alpha = 1.0 - exp(-coverage * (1.55 * max(uAlphaGain, 0.05)));
  alpha = clamp(alpha, 0.0, 0.985);

  gl_FragColor = vec4(color * alpha, alpha);
}
