import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDdlApp, type UseDdlAppOptions } from '../hooks/useDdlApp';
import drawerCss from '../styles/drawer.css?inline';
import { DdlDrawer } from './DdlDrawer';
import { FloatingDock } from './FloatingDock';
import { AlertTriangleIcon, CheckIcon } from './Icons';

export interface ContentAppProps extends UseDdlAppOptions {
  /** If true, renders inside an isolated Shadow DOM host element automatically */
  useShadowDom?: boolean;
}

function ContentAppInner(props: UseDdlAppOptions) {
  const app = useDdlApp(props);

  return (
    <div className="ykt-root" data-theme={app.resolvedTheme}>
      {!app.isOpen && (
        <FloatingDock
          stats={app.stats}
          nextUpcoming={app.nextUpcoming}
          now={app.now}
          loading={app.loading}
          initialBottom={app.settings.dockPosition?.y}
          onPositionChange={y => void app.updateSettings({ dockPosition: { x: 20, y } })}
          onOpen={() => app.setIsOpen(true)}
        />
      )}

      <DdlDrawer app={app} />

      {app.toast && (
        <div role="status" className={`ykt-toast${app.toast.tone === 'error' ? ' error' : ''}`}>
          {app.toast.tone === 'error' ? <AlertTriangleIcon size={15} /> : <CheckIcon size={15} />}
          <span style={{ flex: 1 }}>{app.toast.text}</span>
          {app.toast.actionLabel && app.toast.onAction && (
            <button
              type="button"
              className="ykt-toast-action"
              onClick={app.toast.onAction}
            >
              {app.toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ContentApp({ useShadowDom = true, ...options }: ContentAppProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mountNode, setMountNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!useShadowDom || !hostRef.current) return;
    const shadow = hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    const styleEl = document.createElement('style');
    styleEl.textContent = drawerCss;
    shadow.appendChild(styleEl);

    const container = document.createElement('div');
    shadow.appendChild(container);
    setMountNode(container);

    return () => {
      shadow.innerHTML = '';
      setMountNode(null);
    };
  }, [useShadowDom]);

  if (!useShadowDom) {
    return (
      <>
        <style>{drawerCss}</style>
        <ContentAppInner {...options} />
      </>
    );
  }

  return (
    <div ref={hostRef} id="ykt-ddl-shadow-host">
      {mountNode ? createPortal(<ContentAppInner {...options} />, mountNode) : null}
    </div>
  );
}
