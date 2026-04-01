# SlowMoFocus

SlowMoFocus is a production-oriented Three.js/WebGL app that reconstructs an uploaded image as a dense living particle surface rather than a sparse point cloud. The visual target is a stable image core with subtle continuous motion, irregular edge erosion, and a thin volumetric thickness that reveals itself under restrained parallax.

## Run Locally

```bash
pnpm install
pnpm dev
```

Available scripts:

```bash
pnpm dev
pnpm build
pnpm preview
pnpm exec tsc --noEmit
```

The app starts with an original built-in demo image so the first render already feels cinematic before any upload.

## Architecture

- `src/app/SlowMoFocusApp.ts`
  App bootstrap, lifecycle, rebuild orchestration, animation loop, upload flow, and cleanup.
- `src/core/RendererManager.ts`
  WebGL renderer setup, tone mapping, canvas management, and resize handling.
- `src/core/SceneRig.ts`
  Scene and camera setup plus slow parallax-driven camera/group motion.
- `src/image/DemoImageFactory.ts`
  Procedural premium demo source used for the initial state.
- `src/image/ImageLoader.ts`
  Upload pipeline that converts image files into canvases for preprocessing.
- `src/image/ImagePreprocessor.ts`
  Image analysis and texture preparation. Generates dense particle anchors, color, edge instability, and depth bias data.
- `src/particles/SimulationFBO.ts`
  Ping-pong FBO simulation using raw GLSL shaders for velocity update and position integration.
- `src/particles/ParticleField.ts`
  Instanced quad billboard renderer driven by simulation textures.
- `src/particles/shaders/*`
  Raw GLSL for the fullscreen simulation passes and custom particle rendering.
- `src/ui/AppShell.ts`
  Premium overlay UI, status readout, upload affordances, and GUI host.
- `src/ui/ControlPanel.ts`
  Minimal lil-gui developer tuning panel.
- `src/utils/dispose.ts`
  Disposal helpers for geometries, materials, textures, and render targets.

## Rendering Strategy

### Image preprocessing

The preprocessing step does more than sample image pixels:

- Downscales the source to an analysis canvas.
- Extracts luminance and coverage.
- Computes a Sobel-like gradient map.
- Estimates interior distance from edges using a two-pass distance transform.
- Builds a raw edge instability weight so the body and contour do not behave the same way.
- Importance-samples dense anchors from the source with quasi-random jitter to avoid visible grid artifacts.
- Preserves image color and stores per-particle seed, edge weight, and depth bias in textures.

The goal is to oversample the stable interior while still letting the outer body detach more easily.

### GPU simulation

Each particle carries:

- Anchor position
- Current position
- Velocity
- Random seed
- Edge instability weight
- Depth bias
- Size bias

Per frame, the velocity shader combines:

- Attraction back toward the image anchor
- A coherent curl-like analytic flow field
- Edge-amplified drift and peeling
- Small breathing motion
- Damping that is weaker at unstable edges

Position is then integrated in a second ping-pong pass.

### Particle rendering

- Particles render as custom instanced soft billboards, not `PointsMaterial`.
- Each instance looks up its simulated position, source color, and metadata from textures.
- Alpha falloff is tuned so overlapping sprites merge into a denser continuous-looking surface.
- A thin z variation plus camera parallax creates a restrained volumetric feel.

## Artistic Tuning

The fastest way to shape the look is the dev panel. Press `T` or use `Toggle Tuning`.

For the most important artistic controls:

- `particleCount`
  Higher values increase continuity and reduce visible holes in the image body.
- `particleSize`
  Larger values help the center read as nearly continuous. Too large starts to feel blurry.
- `densityCompensation`
  Counterbalances lower particle counts by enlarging billboards enough to keep the body cohesive.
- `attractionStrength`
  Higher values keep the image more recognizable and pull detached regions back toward the source.
- `flowStrength`
  Controls the living constrained motion across the whole surface.
- `erosionStrength`
  Pushes edge peeling and irregular contour drift.
- `edgeThreshold`
  Decides how much of the image is considered unstable edge territory.
- `edgeBoost`
  Amplifies the difference between the stable body and the fragile contour.
- `damping`
  Higher damping calms the field. Lower damping makes the surface breathe and drift more.
- `depthThickness`
  Increases z variation and the thin volumetric layer feel.
- `motionSpeed`
  Speeds up or slows down the entire living image behavior.
- `alphaGain`
  Increases overlapping particle opacity and helps the core read as solid.
- `brightness`
  Adjusts overall particle light response.
- `backgroundIntensity`
  Changes how much atmospheric light the page background carries.
- `parallaxAmount`
  Controls the subtle hover/camera response that reveals thickness.

## Default Look Tuning Notes

If you want the image body to feel even more solid:

- Raise `particleCount`
- Raise `particleSize` slightly
- Raise `alphaGain` a little
- Raise `densityCompensation` carefully

If the image gets too noisy or unstable:

- Raise `attractionStrength`
- Raise `damping`
- Lower `flowStrength`
- Lower `erosionStrength`

If the edges are too polite and not peeling enough:

- Lower `edgeThreshold`
- Raise `edgeBoost`
- Raise `erosionStrength`

If the effect feels too flat:

- Raise `depthThickness`
- Raise `parallaxAmount` slightly

## Notes

- The simulation requires WebGL2.
- The initial demo image is original and procedural.
- The app is intentionally built with plain Three.js to preserve low-level control over the FBO pipeline and shader-driven particle renderer.
