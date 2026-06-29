import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const win = getCurrentWebviewWindow();
const label = win.label; // flashcard-{instanceId}
const instanceId = label.replace('flashcard-', '');

// Helper: relay events via Rust so ALL windows (including overlay) receive them
const broadcast = (event: string, payload: any = {}) =>
  invoke('broadcast_pet_event', { event, payload }).catch(
    (e) => console.error('[Flashcard] broadcast failed:', event, e)
  );

const fcWrapper      = document.getElementById('fc-wrapper')!;
const fcContainer    = document.getElementById('fc-container')!;
const fcCard         = document.getElementById('fc-card')!;
const fcWordFront    = document.getElementById('fc-word-front')!;
const fcTypeFront    = document.getElementById('fc-type-front')!;
const fcIpaFront     = document.getElementById('fc-ipa-front')!;
const fcWordBack     = document.getElementById('fc-word-back')!;
const fcMeaningBack  = document.getElementById('fc-meaning-back')!;
const fcExampleBack  = document.getElementById('fc-example-back')!;
const actionButtons  = document.getElementById('action-buttons')!;

// Start click-through — buttons will disable this when shown
void win.setIgnoreCursorEvents(true);

function renderButtons(buttons: { label: string; action: string; style?: string }[]) {
  actionButtons.innerHTML = '';
  if (!buttons || buttons.length === 0) {
    actionButtons.style.display = 'none';
    void win.setIgnoreCursorEvents(true);
    return;
  }

  actionButtons.style.display = 'flex';
  void win.setIgnoreCursorEvents(false);

  for (const btn of buttons) {
    const el = document.createElement('button');
    el.textContent = btn.label;
    el.className = btn.style === 'primary' ? 'btn-primary' : 'btn-secondary';
    el.addEventListener('click', () => {
      // Use broadcast (via Rust) so overlay.ts listen() receives this
      void broadcast(`flashcard-button-${instanceId}`, { action: btn.action });
    });
    actionButtons.appendChild(el);
  }
}

// Listen for flashcard update events from overlay (sent via app.emit() in Rust)
void listen(`update-flashcard-${instanceId}`, (event: any) => {
  const { visible, flashcard, flipped, buttons } = event.payload;

  if (!visible) {
    fcWrapper.classList.remove('visible');
    setTimeout(() => { void win.hide(); }, 350);
    return;
  }

  // Fixed portrait card width
  const BASE_W = 170;
  fcContainer.style.setProperty('--fc-w', `${BASE_W}px`);

  // Populate content
  if (flashcard) {
    fcWordFront.textContent   = flashcard.word;
    fcTypeFront.textContent   = flashcard.type;
    fcIpaFront.textContent    = flashcard.ipa;
    fcWordBack.textContent    = flashcard.word;
    fcMeaningBack.textContent = flashcard.meaning;
    fcExampleBack.textContent = flashcard.example;
  }

  // Flip state
  if (flipped) {
    fcCard.classList.add('flipped');
  } else {
    fcCard.classList.remove('flipped');
  }

  // Buttons
  renderButtons(buttons || []);

  // Animate in
  requestAnimationFrame(() => {
    fcWrapper.classList.add('visible');
  });
});
