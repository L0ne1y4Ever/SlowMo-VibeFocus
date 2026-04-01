function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  if (textContent) {
    element.textContent = textContent;
  }
  return element;
}

export class AppShell {
  readonly root: HTMLDivElement;
  readonly canvasHost: HTMLDivElement;
  readonly guiHost: HTMLDivElement;
  readonly uploadInput: HTMLInputElement;
  readonly uploadButton: HTMLButtonElement;
  private readonly statusTitle: HTMLParagraphElement;
  private readonly statusDetail: HTMLParagraphElement;
  private readonly particleMeta: HTMLParagraphElement;

  constructor(private readonly mount: HTMLElement) {
    this.root = createElement('div', 'app-shell');
    this.canvasHost = createElement('div', 'canvas-host');

    const overlay = createElement('div', 'ui-overlay');
    const masthead = createElement('div', 'masthead');
    const eyebrow = createElement('p', 'eyebrow', 'SlowMoFocus');
    const title = createElement('h1', 'hero-title', 'Stable core. Living edge.');
    const copy = createElement(
      'p',
      'hero-copy',
      'Upload an image and rebuild it as a dense cinematic particle surface with subtle motion, restrained depth, and unstable peeling contours.',
    );

    masthead.append(eyebrow, title, copy);

    const actions = createElement('div', 'action-bar');
    this.uploadButton = createElement('button', 'action-button action-button-primary', 'Upload Image');
    actions.append(this.uploadButton);

    const statusCard = createElement('div', 'status-card');
    this.statusTitle = createElement('p', 'status-title', 'Preparing demo source…');
    this.statusDetail = createElement(
      'p',
      'status-detail',
      'Dense reconstruction, edge-aware erosion, and restrained depth are being initialized.',
    );
    this.particleMeta = createElement('p', 'particle-meta');
    statusCard.append(this.statusTitle, this.statusDetail, this.particleMeta);

    this.guiHost = createElement('div', 'gui-host');
    overlay.append(masthead, actions, statusCard, this.guiHost);

    this.uploadInput = document.createElement('input');
    this.uploadInput.type = 'file';
    this.uploadInput.accept = 'image/*';
    this.uploadInput.hidden = true;

    this.root.append(this.canvasHost, overlay, this.uploadInput);
    this.mount.replaceChildren(this.root);
  }

  setStatus(title: string, detail: string): void {
    this.statusTitle.textContent = title;
    this.statusDetail.textContent = detail;
  }

  setParticleMeta(meta: string): void {
    this.particleMeta.textContent = meta;
  }

  setBackgroundIntensity(value: number): void {
    this.root.style.setProperty('--bg-intensity', value.toFixed(3));
  }

  dispose(): void {
    this.root.remove();
  }
}
