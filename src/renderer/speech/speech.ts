import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const win    = getCurrentWebviewWindow();
const bubble = document.getElementById('bubble')!;

// Always click-through — speech bubble is display only
void win.setIgnoreCursorEvents(true);

const label = win.label;
const instanceId = label.replace('speech-', '');

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
