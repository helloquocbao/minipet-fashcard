import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const win    = getCurrentWebviewWindow();
const bubble = document.getElementById('bubble')!;

// Always click-through — speech bubble is display only
void win.setIgnoreCursorEvents(true);

const instanceId = win.label.replace('speech-', '');

const broadcast = (event: string, payload: any = {}) =>
  invoke('broadcast_pet_event', { event, payload }).catch(
    (e) => console.error('[Speech] broadcast failed:', event, e)
  );

// Track and report bubble size changes so the overlay window can resize to fit perfectly
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    // Add safety margins for shadow (16px left/right) and tail/bottom offset
    const w = Math.ceil(entry.contentRect.width) + 32; 
    const h = Math.ceil(entry.contentRect.height) + 35;
    void broadcast(`speech-size-${instanceId}`, { w, h });
  }
});
resizeObserver.observe(bubble);

void listen(`update-speech-${instanceId}`, (event: any) => {
  const { text, visible } = event.payload;

  if (visible && text) {
    bubble.innerHTML = text;
    bubble.classList.add('visible');
  } else {
    bubble.classList.remove('visible');
    setTimeout(() => win.hide(), 350);
  }
});
