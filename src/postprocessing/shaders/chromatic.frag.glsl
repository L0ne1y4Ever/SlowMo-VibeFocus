uniform sampler2D tDiffuse;
uniform vec2 uOffset;
uniform vec2 uResolution;

varying vec2 vUv;

void main() {
  vec2 texelOffset = uOffset / uResolution;
  vec2 fromCenter = vUv - 0.5;
  vec2 dir = normalize(fromCenter + vec2(0.0001));
  float dist = length(fromCenter);
  vec2 offset = dir * texelOffset * dist;

  float r = texture2D(tDiffuse, vUv + offset).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - offset).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
