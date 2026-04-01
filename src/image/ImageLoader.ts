function drawSourceToCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create upload canvas.');
  }

  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export async function loadCanvasFromFile(file: File): Promise<HTMLCanvasElement> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    const canvas = drawSourceToCanvas(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return canvas;
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Unable to load "${file.name}".`));
      img.src = objectUrl;
    });

    return drawSourceToCanvas(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
