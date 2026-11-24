import { createRoot } from 'react-dom/client';
import { detectPlatform } from '../core';
import { ContentApp } from '../ui/components/ContentApp';

const MOUNT_ID = 'yuketang-ddl-helper-extension-root';

function mount() {
  if (!detectPlatform(window.location.origin)) return;
  if (document.getElementById(MOUNT_ID)) return;

  const container = document.createElement('div');
  container.id = MOUNT_ID;
  document.documentElement.appendChild(container);

  createRoot(container).render(<ContentApp useShadowDom />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
