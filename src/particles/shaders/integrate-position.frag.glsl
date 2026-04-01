precision highp float;
precision highp int;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform float uDelta;

in vec2 vUv;

out vec4 outColor;

void main() {
  vec4 positionSample = texture(uPositionTexture, vUv);
  vec4 velocitySample = texture(uVelocityTexture, vUv);
  outColor = vec4(positionSample.xyz + velocitySample.xyz * uDelta, velocitySample.w);
}
