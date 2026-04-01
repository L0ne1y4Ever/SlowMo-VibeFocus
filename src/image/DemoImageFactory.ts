import { clamp, hash21 } from '../utils/math';

function drawPetal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
  tone: readonly [number, number, number],
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const gradient = ctx.createRadialGradient(radiusX * 0.1, -radiusY * 0.15, radiusX * 0.08, 0, 0, radiusY);
  gradient.addColorStop(0, `rgba(${tone[0]}, ${tone[1]}, ${tone[2]}, ${alpha})`);
  gradient.addColorStop(0.45, `rgba(${tone[0] - 8}, ${tone[1] - 8}, ${tone[2] - 10}, ${alpha * 0.88})`);
  gradient.addColorStop(1, `rgba(24, 21, 24, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `rgba(244, 236, 228, ${alpha * 0.08})`;
  ctx.beginPath();
  ctx.ellipse(radiusX * 0.06, -radiusY * 0.28, radiusX * 0.22, radiusY * 0.26, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function createDemoImageCanvas(width = 900, height = 1180): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('2D canvas context unavailable for demo source.');
  }

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#040508');
  background.addColorStop(0.45, '#090b0f');
  background.addColorStop(1, '#020204');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.75;
  const halo = ctx.createRadialGradient(width * 0.5, height * 0.42, 0, width * 0.5, height * 0.42, width * 0.48);
  halo.addColorStop(0, 'rgba(198, 176, 144, 0.18)');
  halo.addColorStop(0.42, 'rgba(98, 102, 118, 0.08)');
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.translate(width * 0.53, height * 0.44);
  ctx.rotate(-0.22);
  ctx.filter = 'blur(1px)';

  const petals = [
    { x: -120, y: -120, rx: 128, ry: 300, rot: -0.95, tone: [188, 178, 168], alpha: 0.82 },
    { x: 102, y: -110, rx: 124, ry: 292, rot: 0.92, tone: [186, 180, 170], alpha: 0.82 },
    { x: -24, y: -198, rx: 118, ry: 276, rot: -0.05, tone: [206, 196, 184], alpha: 0.88 },
    { x: -178, y: 24, rx: 116, ry: 246, rot: -1.32, tone: [162, 156, 152], alpha: 0.74 },
    { x: 170, y: 40, rx: 110, ry: 238, rot: 1.3, tone: [162, 158, 154], alpha: 0.74 },
    { x: -42, y: 142, rx: 154, ry: 214, rot: -0.28, tone: [132, 126, 124], alpha: 0.68 },
    { x: 82, y: 150, rx: 142, ry: 210, rot: 0.34, tone: [126, 122, 121], alpha: 0.64 },
  ] as const;

  petals.forEach((petal) =>
    drawPetal(ctx, petal.x, petal.y, petal.rx, petal.ry, petal.rot, petal.tone, petal.alpha),
  );

  ctx.filter = 'blur(0px)';
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(255, 244, 230, 0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 16, 72, 108, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(30, 20, 14, 0.9)';
  ctx.beginPath();
  ctx.ellipse(0, 24, 50, 72, 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(92, 84, 76, 0.42)';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(width * 0.53, height * 0.56);
  ctx.bezierCurveTo(width * 0.48, height * 0.74, width * 0.56, height * 0.86, width * 0.5, height * 1.02);
  ctx.stroke();
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const grain = (hash21(x * 0.85, y * 0.92) - 0.5) * 8;
      const vignetteX = (x / width - 0.5) * 2;
      const vignetteY = (y / height - 0.48) * 2;
      const vignette = clamp(1 - Math.sqrt(vignetteX * vignetteX * 0.85 + vignetteY * vignetteY), 0, 1);
      const lift = vignette * 3.8;

      pixels[index] = clamp(pixels[index] + grain + lift, 0, 255);
      pixels[index + 1] = clamp(pixels[index + 1] + grain + lift, 0, 255);
      pixels[index + 2] = clamp(pixels[index + 2] + grain + lift * 0.9, 0, 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}
