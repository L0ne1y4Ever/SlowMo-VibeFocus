precision highp float;
precision highp int;

uniform sampler2D uField;
uniform vec2 uTexelSize;
uniform float uDelta;

in vec2 vUv;

out vec4 outColor;

void main() {
  vec4 center = texture(uField, vUv);
  vec4 left   = texture(uField, vUv + vec2(-uTexelSize.x, 0.0));
  vec4 right  = texture(uField, vUv + vec2( uTexelSize.x, 0.0));
  vec4 up     = texture(uField, vUv + vec2(0.0,  uTexelSize.y));
  vec4 down   = texture(uField, vUv + vec2(0.0, -uTexelSize.y));

  vec4 blurred = center * 0.6 + (left + right + up + down) * 0.1;

  float decay = exp(-uDelta * 2.0);
  blurred.r *= decay;
  blurred.gb = mix(vec2(0.5), blurred.gb, decay);

  outColor = blurred;
}
