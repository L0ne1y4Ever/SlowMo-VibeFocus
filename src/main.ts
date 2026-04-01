import './styles.css';
import { SlowMoFocusApp } from './app/SlowMoFocusApp';

const mount = document.querySelector<HTMLDivElement>('#app');

if (!mount) {
  throw new Error('App mount element not found.');
}

const appMount = mount;
let app: SlowMoFocusApp | null = null;

function showFatalError(message: string): void {
  appMount.innerHTML = `
    <div class="fatal-shell">
      <div class="fatal-card">
        <p class="fatal-eyebrow">SlowMoFocus</p>
        <h1 class="fatal-title">Render bootstrap failed</h1>
        <p class="fatal-copy">${message}</p>
        <p class="fatal-copy">Try <code>pnpm dev</code> or rebuild with <code>pnpm build</code>. If your browser blocks WebGL2, the GPU simulation cannot start.</p>
      </div>
    </div>
  `;
}

try {
  app = new SlowMoFocusApp(appMount);
  app.init();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  console.error(error);
  showFatalError(message);
}

window.addEventListener('error', (event) => {
  if (!app) {
    showFatalError(event.error instanceof Error ? event.error.message : event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (!app) {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
    showFatalError(reason);
  }
});

window.addEventListener('beforeunload', () => {
  app?.dispose();
});
