precision highp float;
precision highp int;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uAnchorTexture;
uniform sampler2D uColorTexture;
uniform sampler2D uMetaTexture;
uniform float uParticleSize;
uniform float uDensityScale;
uniform float uBrightness;
uniform vec2 uViewport;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 uv;
in vec2 aParticleUv;

out vec2 vQuadUv;
out vec4 vColor;
out float vEdge;
out float vCore;
out float vSeed;
out float vShell;
out float vState;
out vec3 vVelocity;

void main() {
  vec4 positionSample = texture(uPositionTexture, aParticleUv);
  vec4 velocitySample = texture(uVelocityTexture, aParticleUv);
  vec3 worldPosition = positionSample.xyz;
  vec4 anchorSample = texture(uAnchorTexture, aParticleUv);
  vec4 colorSample = texture(uColorTexture, aParticleUv);
  vec4 meta = texture(uMetaTexture, aParticleUv);

  float edge = meta.x;
  float core = anchorSample.w;
  float seed = meta.y;
  float shellCoord = meta.w;
  float state = positionSample.w;

  float shellBand = 1.0 - smoothstep(0.12, 0.46, shellCoord);
  float coreBand = smoothstep(0.34, 0.82, shellCoord) * mix(0.82, 1.0, core);
  float detached = smoothstep(0.7, 0.9, state);
  float shellAttached = shellBand * (1.0 - detached) * smoothstep(0.14, 0.5, state + shellBand * 0.34);
  float sizeJitter = 0.94 + (seed - 0.5) * 0.12;
  float size =
    uParticleSize *
    uDensityScale *
    mix(1.02, 0.84, shellAttached * 0.45) *
    mix(1.0, 0.72, detached) *
    mix(0.98, 1.08, coreBand) *
    sizeJitter;

  vec4 mvPosition = modelViewMatrix * vec4(worldPosition, 1.0);
  float pixelWorldScale = -mvPosition.z / (0.5 * uViewport.y * projectionMatrix[1][1]);
  mvPosition.xy += position.xy * size * pixelWorldScale;

  gl_Position = projectionMatrix * mvPosition;

  vQuadUv = uv;
  vColor = vec4(colorSample.rgb * uBrightness, colorSample.a);
  vEdge = edge;
  vCore = core;
  vSeed = seed;
  vShell = shellCoord;
  vState = state;
  vVelocity = velocitySample.xyz;
}
