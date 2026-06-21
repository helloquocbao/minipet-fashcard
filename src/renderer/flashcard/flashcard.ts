import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const win = getCurrentWebviewWindow();
const label = win.label; // flashcard-{instanceId}
const instanceId = label.replace('flashcard-', '');

const fcWrapper   = document.getElementById('fc-wrapper')!;
const fcContainer = document.getElementById('fc-container')!;
const fcCard      = document.getElementById('fc-card')!;
const fcWordFront = document.getElementById('fc-word-front')!;
const fcTypeFront = document.getElementById('fc-type-front')!;
const fcIpaFront  = document.getElementById('fc-ipa-front')!;
const fcWordBack  = document.getElementById('fc-word-back')!;
const fcMeaningBack  = document.getElementById('fc-meaning-back')!;
const fcExampleBack  = document.getElementById('fc-example-back')!;
const actionButtons  = document.getElementById('action-buttons')!;

// Start transparent — overlay controls visibility
void win.setIgnoreCursorEvents(true);

// Signal overlay that this window is ready to receive events
void emit(`flashcard-ready-${instanceId}`, {});

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
      void emit(`flashcard-button-${instanceId}`, { action: btn.action });
    });
    actionButtons.appendChild(el);
  }
}

// Listen for flashcard update events from overlay
void listen(`update-flashcard-${instanceId}`, (event: any) => {
  const { visible, flashcard, flipped, scale, buttons } = event.payload;

  if (!visible) {
    fcWrapper.classList.remove('visible');
    setTimeout(() => win.hide(), 350);
    return;
  }

  const sc = Number(scale) || 1.0;

  // Set card pixel dimensions
  const BASE_W = 220;
  const BASE_H = 130;
  fcContainer.style.setProperty('--fc-w', `${Math.round(BASE_W * sc)}px`);
  fcContainer.style.setProperty('--fc-h', `${Math.round(BASE_H * sc)}px`);
  fcContainer.style.fontSize = `${sc}em`;

  // Populate content
  if (flashcard) {
    fcWordFront.textContent    = flashcard.word;
    fcTypeFront.textContent    = flashcard.type;
    fcIpaFront.textContent     = flashcard.ipa;
    fcWordBack.textContent     = flashcard.word;
    fcMeaningBack.textContent  = flashcard.meaning;
    fcExampleBack.textContent  = flashcard.example;
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
