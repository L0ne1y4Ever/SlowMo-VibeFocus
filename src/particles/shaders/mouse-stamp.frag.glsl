precision highp float;
precision highp int;

uniform sampler2D uPrevField;
uniform vec2 uMouseUV;
uniform float uMouseRadius;
uniform float uMouseActive;
uniform float uDelta;

in vec2 vUv;

out vec4 outColor;

void main() {
  vec4 prev = texture(uPrevField, vUv);

  vec2 diff = vUv - uMouseUV;
  float dist = length(diff);
  vec2 dir = dist > 0.001 ? normalize(diff) : vec2(0.0);

  float brushMask = smoothstep(uMouseRadius, uMouseRadius * 0.3, dist);
  float stampIntensity = brushMask * uMouseActive * 0.8;

  float newIntensity = min(prev.r + stampIntensity * uDelta * 8.0, 1.0);

  vec2 prevDir = prev.gb * 2.0 - 1.0;
  vec2 blendedDir = mix(prevDir, dir, stampIntensity * 0.5);
  vec2 encodedDir = blendedDir * 0.5 + 0.5;

  outColor = vec4(newIntensity, encodedDir, 1.0);
}
