import { SpriteRenderer } from "./engine/sprite-renderer";
import { AnimationController } from "./engine/animation-controller";
import { PetStateMachine } from "./engine/pet-state-machine";
import { PETDEX_SPRITE, INTERACTION } from "../../shared/constants";
import { translations, Language } from "../../shared/i18n/translations";
import { FLASHCARDS } from "../../shared/flashcards";

let flashcardTimer: any = null;
let isShowingFlashcard = false;
import {
  getAllWebviewWindows,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";

let statusAlarming = false;
let currentScale = 1.0;
let isSpeechVisible = false;
let isSpeechFlipped = false;
let speechTimeout: NodeJS.Timeout | null = null;
let currentLanguage: Language = "en";
let instanceId: string | null = null;
let lastGlobalSpeechTime = 0;
let controller: AnimationController;
let stateMachine: PetStateMachine;

let currentSpeechText = "";
let isMaster = false;
let currentActivePets: any[] = [];
let speechWindowRef: any = null;
let lastContextKey = "";
let lastCommentTime = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let activePetConfig: any = null;
const isChatActive = false;
const isAnyChatActive = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let cachedSettings: any = null;
let flashcardWindowRef: any = null;
let lastFcW = 240;
let lastFcH = 200;
let lastSpeechW = 200;
let lastSpeechH = 80;
const SPEECH_W = 200;
const SPEECH_H = 80;

// executeTransactionWithWallet removed

async function getOrCreateSpeechWindow() {
  if (speechWindowRef) return speechWindowRef;
  const label = `speech-${instanceId}`;

  const allWindows = await getAllWebviewWindows();
  let win = allWindows.find((w) => w.label === label);

  if (!win) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const createdWin = new WebviewWindow(label, {
      url: `renderer/speech/index.html?id=${instanceId}`,
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      width: SPEECH_W,
      height: SPEECH_H,
      shadow: false,
      // Created hidden; shown by updateSpeechOverlay once positioned.
      visible: false,
    });
    win = createdWin;
    // Wait for the window (and its JS listener) to be ready before we broadcast.
    await new Promise<void>((resolve) => {
      void createdWin.once("tauri://created", () => {
        resolve();
      });
      void createdWin.once("tauri://error", () => {
        resolve();
      });
      setTimeout(() => {
        resolve();
      }, 5000);
    });
    // Brief settle so speech.ts has attached its `update-speech` listener
    // before the first broadcast (otherwise the first message can be missed).
    await new Promise<void>((r) => {
      setTimeout(() => {
        r();
      }, 150);
    });
  }
  if (!speechWindowRef) {
    speechWindowRef = win;
  }
  return speechWindowRef;
}

async function getOrCreateFlashcardWindow() {
  if (flashcardWindowRef) return flashcardWindowRef;
  const label = `flashcard-${instanceId}`;

  const allWindows = await getAllWebviewWindows();
  let win = allWindows.find((w) => w.label === label);

  if (!win) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const createdWin = new WebviewWindow(label, {
      url: `renderer/flashcard/index.html?id=${instanceId}`,
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      width: 240,
      height: 200,
      shadow: false,
      visible: false,
    });
    win = createdWin;
    // MUST wait for window to be fully created before we can interact with it.
    // Requires the `core:webview:allow-create-webview-window` capability.
    await new Promise<void>((resolve) => {
      void createdWin.once("tauri://created", () => {
        resolve();
      });
      void createdWin.once("tauri://error", (e) => {
        console.error("[Flashcard] window creation failed:", e.payload);
        resolve();
      });
      setTimeout(() => {
        resolve();
      }, 5000); // safety fallback
    });
  }
  if (!flashcardWindowRef) {
    flashcardWindowRef = win;
  }
  return flashcardWindowRef;
}

async function syncSpeechWindowPosition(customW?: number, customH?: number) {
  if (!speechWindowRef || !isSpeechVisible) return;

  const appWin = getCurrentWebviewWindow();
  const pos = { x: 0, y: 0 };
  try {
    const outerPos = await appWin.outerPosition();
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor();
    const factor = monitor?.scaleFactor || 1;
    pos.x = outerPos.x / factor;
    pos.y = outerPos.y / factor;
  } catch {
    const cachedPos = window.electronAPI.getLogicalPosition();
    if (cachedPos.x === null || cachedPos.y === null) return;
    pos.x = cachedPos.x;
    pos.y = cachedPos.y;
  }

  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);

  const speechW = customW || lastSpeechW;
  const speechH = customH || lastSpeechH;

  // Center horizontally over the pet sprite width, then shift 20% of the speech window width to the right.
  // Vertically: Anchor the bottom of the speech window (newY + speechH) to a fixed point (pos.y + 64)
  // so the tail pointing at the pet never jumps when the bubble height resizes dynamically.
  const newX = Math.round(pos.x + petWidth / 2 - speechW / 2);
  const newY = Math.round(pos.y + 64 - speechH * 2);

  const { LogicalPosition } = await import("@tauri-apps/api/window");

  isSpeechFlipped = false;

  await speechWindowRef.setPosition(new LogicalPosition(newX, newY));
}

async function syncFlashcardWindowPosition(customW?: number, customH?: number) {
  if (!flashcardWindowRef) return;

  const appWin = getCurrentWebviewWindow();
  const pos = { x: 0, y: 0 };
  try {
    const outerPos = await appWin.outerPosition();
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor();
    const factor = monitor?.scaleFactor || 1;
    pos.x = outerPos.x / factor;
    pos.y = outerPos.y / factor;
  } catch {
    const cachedPos = window.electronAPI.getLogicalPosition();
    if (cachedPos.x === null || cachedPos.y === null) return;
    pos.x = cachedPos.x;
    pos.y = cachedPos.y;
  }

  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);
  const petHeight = Math.ceil(PETDEX_SPRITE.FRAME_HEIGHT * safeScale);

  const fcW = customW || lastFcW;
  const fcH = customH || lastFcH;
  const MARGIN = 8;

  // Default: centered horizontally over the pet, bottom 8px above the pet top.
  let newX = Math.round(pos.x + petWidth / 2 - fcW / 2);
  let newY = Math.round(pos.y - fcH - MARGIN);

  const { LogicalPosition, currentMonitor } =
    await import("@tauri-apps/api/window");

  // Clamp to the work area of the monitor the pet is on so the card is never
  // cut off (e.g. when the pet is near the top/edge of the screen).
  try {
    const mon = await currentMonitor();
    if (mon) {
      const sf = mon.scaleFactor || 1;
      const monLeft = mon.position.x / sf;
      const monTop = mon.position.y / sf;
      const monW = mon.size.width / sf;
      const monH = mon.size.height / sf;

      // Not enough room above the pet → flip the card below it.
      if (newY < monTop + MARGIN) {
        newY = Math.round(pos.y + petHeight + MARGIN);
      }
      newY = Math.min(newY, Math.round(monTop + monH - fcH - MARGIN));
      newY = Math.max(newY, Math.round(monTop + MARGIN));
      newX = Math.min(newX, Math.round(monLeft + monW - fcW - MARGIN));
      newX = Math.max(newX, Math.round(monLeft + MARGIN));
    }
  } catch {
    // Monitor lookup failed — fall back to the unclamped position.
  }

  await flashcardWindowRef.setPosition(new LogicalPosition(newX, newY));
}

function isChosenToSpeak(seedStr: string): boolean {
  if (!currentActivePets || currentActivePets.length === 0) return true;
  const sortedIds = currentActivePets.map((p) => p.id).sort();
  const myIndex = sortedIds.indexOf(instanceId ?? "");
  if (myIndex === -1) return true;

  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const targetIndex = Math.abs(hash) % sortedIds.length;
  return myIndex === targetIndex;
}

/**
 * Helper to pick a random item from an array using cryptographically strong random values
 * to ensure independence across multiple WebView instances.
 */
function pickUniqueRandom(opt: string | string[]): string {
  if (!Array.isArray(opt)) return opt;
  if (opt.length === 0) return "";

  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  const randomIndex = array[0] % opt.length;

  return opt[randomIndex];
}

/**
 * Initializes the overlay pet instance.
 */
async function init(): Promise<void> {
  // Setup Tauri API shim before any window.electronAPI calls
  const { setupElectronShim } = await import("../../lib/electron-shim");
  setupElectronShim();

  // Deep link listener removed

  const params = new URLSearchParams(window.location.search);
  instanceId = params.get("id");

  if (!instanceId) {
    console.error("[Overlay] No instanceId provided.");
    return;
  }

  const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;

  // 1. Fetch pet instance configuration
  let petData: any;
  try {
    petData = await window.electronAPI.getInstanceConfig(instanceId);
    activePetConfig = petData;
  } catch (e) {
    console.error("[Overlay] getInstanceConfig failed:", e);
    return;
  }
  if (!petData) {
    console.error("[Overlay] petData is null");
    return;
  }

  // 2. Initialize the sprite renderer
  const renderer = new SpriteRenderer(
    canvas,
    PETDEX_SPRITE.FRAME_WIDTH,
    PETDEX_SPRITE.FRAME_HEIGHT,
  );

  // 3. Load the pet spritesheet
  if (petData?.spritesheetPath) {
    try {
      let finalPath = petData.spritesheetPath;
      // Only add cache buster for local files, not remote URLs
      // (cache busting remote URLs forces re-download and causes blank frames during load)
      if (
        !finalPath.startsWith("asset://") &&
        !finalPath.startsWith("data:") &&
        !finalPath.startsWith("http")
      ) {
        const cacheBuster = `?t=${Date.now()}`;
        finalPath += cacheBuster;
      }
      await renderer.loadSpritesheet(finalPath);
    } catch (err) {
      console.error("[Overlay] Failed to load spritesheet:", err);
    }
  }

  // 4. Initialize animation controllers and state machine
  const savedSettings: any = await window.electronAPI.getSettings();
  cachedSettings = savedSettings;
  currentActivePets = savedSettings?.activePets || [];
  const initialScale = Number(petData.scale || savedSettings?.scale) || 1.0;
  const isWalkingEnabled = savedSettings?.enableWalking !== false;
  currentLanguage = savedSettings?.language || "en";

  controller = new AnimationController(renderer, instanceId ?? "");
  stateMachine = new PetStateMachine(
    controller,
    initialScale,
    isWalkingEnabled,
  );
  if (petData?.animations) {
    stateMachine.updateAnimations(petData.animations);
  }
  controller.setWalkingEnabled(isWalkingEnabled);
  stateMachine.start();

  currentScale = initialScale;

  // Force window to be interactive at startup
  window.electronAPI.setIgnoreMouseEvents(false);
  window.electronAPI.focus();

  // Sync window dimensions with pet scale
  void syncWindowSize();

  // --- Multi-Pet: Chasing Logic ---
  window.electronAPI.onPositionsUpdate((data: any) => {
    const { positions } = data;
    // Identify other pet instances
    const otherPets = positions.filter((p: any) => p.id !== instanceId);
    if (otherPets.length > 0) {
      // Small chance (5%) for a pet to "chase" another when walking
      if (Math.random() < 0.05 && stateMachine.getState() === "walk") {
        const target = otherPets[Math.floor(Math.random() * otherPets.length)];
        controller.setTarget(target.x, target.y);
      }
    }
  });

  // --- Global IPC Events ---
  window.electronAPI.onPing(() => {
    stateMachine.notify();
    // Use crypto for unique delays across windows
    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    const delay = randomBuffer[0] % 1800; // 0 to 1.8s

    setTimeout(() => {
      showSpeech(
        getRandomPingSpeech(),
        INTERACTION.SPEECH_DURATION_DEFAULT,
        false,
        "Ping",
      );
    }, delay);
  });

  window.electronAPI.onStartAlarm(() => {
    statusAlarming = true;
    stateMachine.startAlarm();
  });

  window.electronAPI.onStopAlarm(() => {
    statusAlarming = false;
    stateMachine.stopAlarm();
  });

  window.electronAPI.onPomoTick((_state: any) => {
    // Regular tick updates (currently handled by settings window)
  });

  (window.electronAPI as any).onPomoFinished((sessionType: string) => {
    if (!isChosenToSpeak(`pomo_${sessionType}`)) return;
    const t = translations[currentLanguage];
    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    const delay = randomBuffer[0] % 2500;

    setTimeout(() => {
      const choices =
        sessionType === "focus" ? t.pomoFinishedWork : t.pomoFinishedBreak;
      const msg = pickUniqueRandom(choices);
      if (msg) showSpeech(msg, INTERACTION.SPEECH_DURATION_LONG, false, "Pomo");
    }, delay);
  });

  setupRandomSpeech(stateMachine);
  setupContextMonitoring();
  setupFlashcardLoop();

  // Pre-warm the flashcard + speech windows early so they're ready instantly when
  // needed (the speech window must be listening before the first broadcast).
  setTimeout(() => {
    void getOrCreateFlashcardWindow().catch(() => {
      /* silent */
    });
    void getOrCreateSpeechWindow().catch(() => {
      /* silent */
    });
  }, 200);

  // --- Settings Update Handling ---
  window.electronAPI.onSettingsUpdate((data: any) => {
    void (async () => {
      const { settings } = data;
      cachedSettings = settings;
      currentActivePets = settings.activePets || [];
      currentLanguage = settings.language || "en";

      // Find this instance's specific configuration
      const myInstance = settings.activePets.find(
        (p: any) => p.id === instanceId,
      );
      if (myInstance) {
        currentScale = myInstance.scale || settings.scale;
        stateMachine.setScale(currentScale);
        stateMachine.setWalkingEnabled(settings.enableWalking);
        controller.setWalkingEnabled(settings.enableWalking);
        void syncWindowSize();
      } else if (settings.activePets.length > 0) {
        // This window's instanceId is no longer in activePets — a new pet was spawned.
        // Navigate to the new instance's URL so the overlay re-inits with the new pet.
        const newInstance = settings.activePets[0];
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("id", newInstance.id);
        window.location.href = newUrl.toString();
      }
      setupFlashcardLoop();
    })();
  });

  (window.electronAPI as any).onCustomEvent("trigger-flashcard-test", () => {
    // Force-reset state so test always works even if previous card wasn't dismissed
    if (isShowingFlashcard) {
      isShowingFlashcard = false;
      hideSpeech();
    }
    // Small delay so hideSpeech animation completes
    setTimeout(() => {
      void triggerFlashcard();
    }, 400);
  });

  // --- Intelligence & Sync ---
  window.electronAPI.onPetSay(
    (payload: string | { text: string; priority?: boolean }) => {
      let text: string;
      let priority = false;
      if (typeof payload === "object" && payload !== null) {
        text = payload.text;
        priority = !!payload.priority;
      } else {
        text = payload;
      }

      if (!isChosenToSpeak(text)) return;

      if (!priority) {
        const timeSinceLastSpeech = Date.now() - lastGlobalSpeechTime;
        if (timeSinceLastSpeech < INTERACTION.SPEECH_SYNC_COOLDOWN) return;
      }

      const t = translations[currentLanguage];
      let speechToSay = text;

      if (text in t && Array.isArray(t[text])) {
        speechToSay = pickUniqueRandom(t[text]);
      } else {
        const categories = [
          "intelWebYoutube",
          "intelWebSocial",
          "intelWebDev",
          "intelWebAI",
          "intelWebDesign",
          "intelAppCode",
          "intelAppWeb",
          "intelAppMusic",
          "intelAppChat",
          "intelAppTerminal",
          "intelAppDesign",
          "intelAppMeeting",
          "intelAppProductivity",
          "intelAppFinder",
          "intelAppDefault",
          "intelTimeLate",
          "intelTimeLunch",
        ];

        for (const cat of categories) {
          const variants = t[cat];
          if (Array.isArray(variants) && variants.includes(text)) {
            speechToSay = pickUniqueRandom(variants);
            break;
          }
        }
      }

      showSpeech(
        speechToSay,
        INTERACTION.SPEECH_DURATION_DEFAULT,
        priority,
        "Intel",
      );
    },
  );

  window.electronAPI.onSomeoneSpeaking(() => {
    lastGlobalSpeechTime = Date.now();
  });

  setupMouseInteraction(canvas, stateMachine);

  // --- Master Election ---
  void setupMasterElection();

  // Expose a global sync function so that AnimationController can update
  // speech/flashcard window coordinates on every frame while the pet is walking.
  (window as any).syncAllAttachedWindows = () => {
    if (isSpeechVisible && currentSpeechText) {
      void syncSpeechWindowPosition(lastSpeechW, lastSpeechH);
    }
    if (isShowingFlashcard) {
      void syncFlashcardWindowPosition(lastFcW, lastFcH);
    }
  };

  // --- Real-time Speech Sync (Event Driven) ---
  window.electronAPI.onWindowMoved((_x: number, _y: number) => {
    if (typeof (window as any).syncAllAttachedWindows === "function") {
      (window as any).syncAllAttachedWindows();
    }
  });

  // The speech window measures its own content and reports the exact size it
  // needs. Resize the window dynamically (so long text is never clipped)
  // and reposition it relative to the pet.
  void listen(`speech-size-${instanceId}`, (event: any) => {
    const w = Math.round(Number(event.payload?.w));
    const h = Math.round(Number(event.payload?.h));
    if (!w || !h) return;
    lastSpeechW = w;
    lastSpeechH = h;
    void (async () => {
      if (!speechWindowRef || !isSpeechVisible) return;
      const { LogicalSize } = await import("@tauri-apps/api/window");
      await speechWindowRef.setSize(new LogicalSize(w, h));
      await syncSpeechWindowPosition(w, h);
    })();
  });

  // The flashcard window measures its own content and reports the exact size it
  // needs. Resize the window to fit (so buttons/long text are never clipped)
  // and reposition it (clamped to the screen).
  void listen(`flashcard-size-${instanceId}`, (event: any) => {
    void (async () => {
      if (!flashcardWindowRef || !isShowingFlashcard) return;
      const w = Math.round(Number(event.payload?.w));
      const h = Math.round(Number(event.payload?.h));
      if (!w || !h) return;
      lastFcW = w;
      lastFcH = h;
      const { LogicalSize } = await import("@tauri-apps/api/window");
      await flashcardWindowRef.setSize(new LogicalSize(w, h));
      await syncFlashcardWindowPosition(w, h);
    })();
  });

  // Greeting on startup (delay slightly to ensure coordinates and windows are ready)
  setTimeout(() => {
    const t = translations[currentLanguage];
    stateMachine.forceState("greet");
    showSpeech(pickUniqueRandom(t.hello), 4000, true, "Startup");
    // Force double sync after startup speech is triggered to guarantee correct starting position
    setTimeout(() => {
      if (isSpeechVisible)
        void syncSpeechWindowPosition(lastSpeechW, lastSpeechH);
    }, 200);
  }, 2200);
}

/**
 * Ensures only one pet window runs the SuiMonitor to stay within RPC rate limits.
 * The window with the alphabetically lowest label is elected as Master.
 */
async function setupMasterElection() {
  const checkMaster = async () => {
    try {
      const allWindows = await getAllWebviewWindows();
      const overlayWindows = allWindows.filter((w) =>
        w.label.startsWith("overlay-"),
      );
      const sortedLabels = overlayWindows.map((w) => w.label).sort();
      const currentWin = getCurrentWebviewWindow();
      const myLabel = currentWin.label;

      isMaster = myLabel === sortedLabels[0];
    } catch (err) {
      console.error("[Overlay] Master election failed:", err);
    }
  };

  // Initial check
  await checkMaster();

  // Re-elect every 10 seconds in case windows are closed/opened
  setInterval(() => {
    void checkMaster();
  }, 10000);
}

/**
 * Sets up mouse and drag-and-drop interactions.
 */
function setupMouseInteraction(
  canvas: HTMLCanvasElement,
  stateMachine: PetStateMachine,
): void {
  let isDragging = false;
  let wasDragged = false;
  let startX = 0;
  let startY = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      e.preventDefault();

      // 1. Instant response: focus and pause autonomous movement
      window.electronAPI.focus();
      controller.pauseMovement(true);

      isDragging = true;
      wasDragged = false;
      startX = e.screenX;
      startY = e.screenY;

      // 2. UI state
      stateMachine.forceState("dazed");
      window.electronAPI.setIgnoreMouseEvents(false);
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (isDragging) {
      const dx = e.screenX - startX;
      const dy = e.screenY - startY;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        wasDragged = true;
        window.electronAPI.moveWindow(dx, dy);
        startX = e.screenX;
        startY = e.screenY;
      }
    }
  });

  const stopDragging = () => {
    if (isDragging) {
      isDragging = false;
      stateMachine.transitionTo("idle");
      controller.resetPosition();
      controller.pauseMovement(false);

      if (instanceId) {
        window.electronAPI.savePosition(instanceId);
      }
    }
  };

  window.addEventListener("mouseup", stopDragging);
  window.addEventListener("blur", stopDragging);

  let clickCount = 0;
  let clickTimer: NodeJS.Timeout | null = null;

  canvas.addEventListener("click", () => {
    if (statusAlarming) {
      window.electronAPI.stopAlarm();
      hideSpeech();
      return;
    }

    if (wasDragged) return;

    clickCount++;
    if (clickTimer) clearTimeout(clickTimer);

    const t = translations[currentLanguage];

    if (clickCount === 1) {
      stateMachine.forceState("greet");
      showSpeech(pickUniqueRandom(t.hello));
    } else if (clickCount >= 2) {
      if (stateMachine.getWalkingEnabled()) {
        stateMachine.forceState("run");
        showSpeech(pickUniqueRandom(t.run));
      } else {
        stateMachine.forceState("greet");
        showSpeech(t.movingDisabled);
      }
    }

    clickTimer = setTimeout(() => {
      clickCount = 0;
      clickTimer = null;
    }, 600);
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.electronAPI.openSettings();
  });

  // --- Click-through management removed for reliability ---
  // Since the window is now tightly fitted to the pet size,
  // we no longer need complex ignore logic which was causing focus issues.

  /**
   * Drag-and-drop file eating handlers using native Tauri events.
   */
  window.electronAPI.onDragDrop((type: string, paths: string[]) => {
    void (async () => {
      if (type === "enter") {
        stateMachine.forceState("dazed");
      } else if (type === "leave") {
        stateMachine.transitionTo("idle");
      } else if (type === "drop") {
        if (!paths || paths.length === 0) {
          stateMachine.transitionTo("idle");
          return;
        }

        const t = translations[currentLanguage];
        stateMachine.forceState("eat");
        showSpeech(
          pickUniqueRandom(t.eating),
          INTERACTION.SPEECH_DURATION_DEFAULT,
          false,
          "Eat",
        );

        try {
          const result: any = await window.electronAPI.eatFile(paths);
          if (result && !result.success) {
            showSpeech(
              pickUniqueRandom(t.hello),
              INTERACTION.SPEECH_DURATION_DEFAULT,
              false,
              "EatError",
            );
          }
        } catch (err) {
          console.error("Overlay: Failed to eat file:", err);
        } finally {
          setTimeout(() => {
            stateMachine.transitionTo("idle");
          }, 1000);
        }
      }
    })();
  });
}

/**
 * Updates the internal speech bubble text and visibility.
 */
async function updateSpeechOverlay(text: string, visible: boolean) {
  try {
    const win = await getOrCreateSpeechWindow();
    if (visible) {
      isSpeechVisible = true;
      const { LogicalSize } = await import("@tauri-apps/api/window");
      await win.setSize(new LogicalSize(lastSpeechW, lastSpeechH));
      await syncSpeechWindowPosition(lastSpeechW, lastSpeechH);
      await win.show();
      // Ensure the OS window manager finishes showing before we sync coordinates again
      setTimeout(() => {
        void syncSpeechWindowPosition(lastSpeechW, lastSpeechH);
      }, 100);
    }

    void window.electronAPI.broadcastPetEvent(`update-speech-${instanceId}`, {
      text,
      visible,
      flipped: isSpeechFlipped,
    });

    if (!visible) {
      // Reset speech size when hidden so the next message starts with clean bounds
      // eslint-disable-next-line require-atomic-updates
      lastSpeechW = 200;
      // eslint-disable-next-line require-atomic-updates
      lastSpeechH = 80;
      setTimeout(() => {
        void win.hide();
      }, 350);
    }
  } catch (err) {
    console.error("Failed to update speech window:", err);
  }
}

async function syncWindowSize(): Promise<void> {
  const safeScale = Number(currentScale) || 1.0;
  const petWidth = Math.ceil(PETDEX_SPRITE.FRAME_WIDTH * safeScale);
  const petHeight = Math.ceil(PETDEX_SPRITE.FRAME_HEIGHT * safeScale);

  const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
  if (canvas) {
    canvas.style.width = `${petWidth}px`;
    canvas.style.height = `${petHeight}px`;
  }

  // Khung xanh bây giờ chỉ bao bọc đúng con Pet (khung đỏ)
  const winWidth = petWidth;
  const winHeight = petHeight;

  try {
    window.electronAPI.resizeKeepBottom(winWidth, winHeight);
  } catch (err) {
    console.error("Failed to resize window:", err);
  }

  if (isSpeechVisible) {
    void syncSpeechWindowPosition(lastSpeechW, lastSpeechH);
    setTimeout(() => {
      void syncSpeechWindowPosition(lastSpeechW, lastSpeechH);
    }, 100);
  }
  if (isShowingFlashcard) {
    void syncFlashcardWindowPosition(lastFcW, lastFcH);
  }
}

/**
 * Displays a speech bubble with the given text for a specific duration.
 */
function showSpeech(
  text: string,
  duration: number = INTERACTION.SPEECH_DURATION_DEFAULT,
  priority: boolean = false,
  _source: string = "unknown",
): void {
  if (isChatActive || isAnyChatActive) {
    return;
  }
  if (speechTimeout) clearTimeout(speechTimeout);
  if (!priority && isSpeechVisible) {
    if ((window as any).isCurrentSpeechPriority) {
      return;
    }
  }

  isSpeechVisible = true;
  currentSpeechText = text;
  (window as any).isCurrentSpeechPriority = priority;

  // Use separate speech window
  void updateSpeechOverlay(text, true);
  void syncWindowSize(); // Phình to cửa sổ ra để chứa chữ

  // Notify other pets to stay silent
  window.electronAPI.notifySpeaking();

  if (!isChatActive) {
    speechTimeout = setTimeout(hideSpeech, duration);
  }
}

function hideSpeech(): void {
  isSpeechVisible = false;
  currentSpeechText = "";
  (window as any).isCurrentSpeechPriority = false;
  void updateSpeechOverlay("", false);
  void syncWindowSize();

  if (speechTimeout) {
    clearTimeout(speechTimeout);
    speechTimeout = null;
  }
}

/**
 * Returns a random speech text for ping responses.
 */
function getRandomPingSpeech(): string {
  const lang =
    currentLanguage && translations[currentLanguage] ? currentLanguage : "en";
  const t = translations[lang];
  const choices = Array.isArray(t.pingResponses)
    ? t.pingResponses
    : Array.isArray(t.hello)
      ? t.hello
      : ["🐾", "❤️", "✨"];
  return pickUniqueRandom(choices);
}

/**
 * Sets up a background interval for occasional random speech.
 */
function setupRandomSpeech(stateMachine: PetStateMachine): void {
  setInterval(() => {
    // Only speak randomly if no one has spoken recently across all instances
    const timeSinceLastSpeech = Date.now() - lastGlobalSpeechTime;

    if (
      !isSpeechVisible &&
      !statusAlarming &&
      timeSinceLastSpeech > INTERACTION.SPEECH_SYNC_COOLDOWN &&
      Math.random() < INTERACTION.RANDOM_SPEECH_CHANCE
    ) {
      const state = stateMachine.getState();
      const t = translations[currentLanguage];

      if (state === "sleep") {
        showSpeech("Zzz...");
      } else {
        const choices = t.randomSpeeches || ["🐾", "❤️", "✨"];
        showSpeech(
          pickUniqueRandom(choices),
          INTERACTION.SPEECH_DURATION_DEFAULT,
          false,
          "Random",
        );
      }
    }
  }, INTERACTION.RANDOM_SPEECH_INTERVAL);
}

function setupFlashcardLoop(): void {
  // Clear existing timer if any
  if (flashcardTimer) {
    clearTimeout(flashcardTimer);
    flashcardTimer = null;
  }

  if (!cachedSettings || !cachedSettings.flashcardEnabled) {
    return;
  }

  const intervalMins = cachedSettings.flashcardInterval || 15;
  const isRandom = cachedSettings.flashcardMode === "random";

  const triggerNext = () => {
    if (
      isShowingFlashcard ||
      isChatActive ||
      isAnyChatActive ||
      statusAlarming
    ) {
      scheduleNext();
      return;
    }
    void triggerFlashcard().then(() => {
      scheduleNext();
    });
  };

  const scheduleNext = () => {
    if (flashcardTimer) {
      clearTimeout(flashcardTimer);
    }
    if (!cachedSettings || !cachedSettings.flashcardEnabled) return;

    if (isRandom) {
      const minMs = intervalMins * 60 * 1000 * 0.5;
      const maxMs = intervalMins * 60 * 1000 * 1.5;
      const randomDelay = Math.random() * (maxMs - minMs) + minMs;
      flashcardTimer = setTimeout(triggerNext, randomDelay);
    } else {
      flashcardTimer = setTimeout(triggerNext, intervalMins * 60 * 1000);
    }
  };

  scheduleNext();
}

async function triggerFlashcard(): Promise<void> {
  if (FLASHCARDS.length === 0) return;
  const randomIndex = Math.floor(Math.random() * FLASHCARDS.length);
  const card = FLASHCARDS[randomIndex];
  await showFlashcard(card);
}

function playNotificationSound(): void {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.1, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    playTone(659.25, ctx.currentTime, 0.35);
    playTone(880.0, ctx.currentTime + 0.12, 0.45);
  } catch (e) {
    console.error("Failed to play notification sound:", e);
  }
}

async function showFlashcard(card: any): Promise<void> {
  if (isShowingFlashcard) return;
  isShowingFlashcard = true;

  // Safety: auto-reset after 60s
  const safetyTimer = setTimeout(() => {
    if (isShowingFlashcard) {
      isShowingFlashcard = false;
      void hideFlashcard();
    }
  }, 60000);

  playNotificationSound();
  stateMachine.forceState("notify");

  try {
    // Card size is fixed (portrait); no user scaling.
    const fcScale = 1.0;
    // Portrait defaults — must match flashcard/index.html (--fc-w / face min-height).
    const BASE_W = 170;
    const BASE_H = 215;
    const cardW = BASE_W;
    const cardH = BASE_H;
    // Initial best-guess size; the flashcard window re-measures its real content
    // and reports back an exact size via `flashcard-size-{id}` (see init()).
    // Buttons live inside the card, so only body padding is added here.
    const winW = cardW + 24; // 12px horizontal padding each side
    const winH = cardH + 24; // 12px vertical padding each side
    lastFcW = winW;
    lastFcH = winH;

    // getOrCreateFlashcardWindow waits for tauri://created internally,
    // so by the time this resolves the window JS is loaded and listening.
    const win = await getOrCreateFlashcardWindow();

    const { LogicalSize } = await import("@tauri-apps/api/window");
    await win.setSize(new LogicalSize(winW, winH));
    await win.show();
    await syncFlashcardWindowPosition(winW, winH);
    // Brief delay for show() + position to settle before sending event
    await new Promise<void>((r) => {
      setTimeout(r, 150);
    });

    const langKey = currentLanguage || "en";
    const meaning = card.translations[langKey] || card.translations["en"] || "";

    const flashcardPayload = {
      word: card.word,
      type: card.type,
      ipa: card.ipa,
      meaning,
      example: card.example,
    };

    const labelReveal = currentLanguage === "vi" ? "Xem Nghĩa" : "Reveal";
    const labelSkip = currentLanguage === "vi" ? "Bỏ qua" : "Skip";

    void window.electronAPI.broadcastPetEvent(
      `update-flashcard-${instanceId}`,
      {
        visible: true,
        flashcard: flashcardPayload,
        flipped: false,
        scale: fcScale,
        buttons: [
          { label: labelReveal, action: "fc_reveal", style: "primary" },
          { label: labelSkip, action: "fc_skip", style: "secondary" },
        ],
      },
    );

    const userChoice = await new Promise<string>((resolve) => {
      let resolved = false;
      const unlistenPromise = listen(
        `flashcard-button-${instanceId}`,
        (event: any) => {
          if (!resolved) {
            resolved = true;
            resolve(event.payload.action);
            void unlistenPromise.then((u) => u());
          }
        },
      );

      if (cachedSettings && cachedSettings.flashcardAutoFlip) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve("fc_reveal");
            void unlistenPromise.then((u) => u());
          }
        }, 5000);
      }
    });

    if (userChoice === "fc_reveal") {
      stateMachine.forceState("happy");
      const labelDone = currentLanguage === "vi" ? "Đã học" : "Got it!";

      void window.electronAPI.broadcastPetEvent(
        `update-flashcard-${instanceId}`,
        {
          visible: true,
          flashcard: flashcardPayload,
          flipped: true,
          scale: fcScale,
          buttons: [{ label: labelDone, action: "fc_done", style: "primary" }],
        },
      );

      await new Promise<string>((resolve) => {
        const unlistenPromise = listen(
          `flashcard-button-${instanceId}`,
          (event: any) => {
            resolve(event.payload.action);
            void unlistenPromise.then((u) => u());
          },
        );
      });
    }
  } catch (err) {
    console.error("Flashcard error:", err);
  } finally {
    clearTimeout(safetyTimer);
    void hideFlashcard();
    // eslint-disable-next-line require-atomic-updates
    isShowingFlashcard = false;
    stateMachine.forceState("idle");
  }
}

async function hideFlashcard(): Promise<void> {
  if (!flashcardWindowRef) return;
  void window.electronAPI.broadcastPetEvent(`update-flashcard-${instanceId}`, {
    visible: false,
  });
  setTimeout(() => flashcardWindowRef?.hide(), 350);
}

function getSpeechCategory(appName: string, tabTitle: string | null): string {
  const appLower = appName.toLowerCase();

  // 1. If it's a browser, check the tab title first
  if (
    appLower.includes("chrome") ||
    appLower.includes("safari") ||
    appLower.includes("arc") ||
    appLower.includes("firefox") ||
    appLower.includes("brave") ||
    appLower.includes("browser")
  ) {
    if (tabTitle) {
      const tabLower = tabTitle.toLowerCase();
      if (tabLower.includes("youtube")) return "intelWebYoutube";
      if (
        tabLower.includes("facebook") ||
        tabLower.includes("twitter") ||
        tabLower.includes("x.com") ||
        tabLower.includes("reddit") ||
        tabLower.includes("instagram") ||
        tabLower.includes("linkedin") ||
        tabLower.includes("tiktok")
      ) {
        return "intelWebSocial";
      }
      if (
        tabLower.includes("github") ||
        tabLower.includes("stack overflow") ||
        tabLower.includes("stackoverflow") ||
        tabLower.includes("npm") ||
        tabLower.includes("localhost") ||
        tabLower.includes("docs") ||
        tabLower.includes("documentation") ||
        tabLower.includes("sui")
      ) {
        return "intelWebDev";
      }
      if (
        tabLower.includes("chatgpt") ||
        tabLower.includes("claude") ||
        tabLower.includes("gemini") ||
        tabLower.includes("openai") ||
        tabLower.includes("v0.dev")
      ) {
        return "intelWebAI";
      }
      if (
        tabLower.includes("figma") ||
        tabLower.includes("canva") ||
        tabLower.includes("dribbble") ||
        tabLower.includes("behance")
      ) {
        return "intelWebDesign";
      }
    }
    return "intelAppWeb";
  }

  // 2. Otherwise, check the app name
  if (
    appLower.includes("visual studio code") ||
    appLower.includes("vscode") ||
    appLower.includes("code") ||
    appLower.includes("xcode") ||
    appLower.includes("cursor") ||
    appLower.includes("intellij") ||
    appLower.includes("android studio") ||
    appLower.includes("sublime")
  ) {
    return "intelAppCode";
  }
  if (
    appLower.includes("spotify") ||
    appLower.includes("music") ||
    appLower.includes("podcast")
  ) {
    return "intelAppMusic";
  }
  if (
    appLower.includes("slack") ||
    appLower.includes("discord") ||
    appLower.includes("telegram") ||
    appLower.includes("whatsapp") ||
    appLower.includes("messages") ||
    appLower.includes("signal")
  ) {
    return "intelAppChat";
  }
  if (
    appLower.includes("terminal") ||
    appLower.includes("iterm") ||
    appLower.includes("warp") ||
    appLower.includes("alacritty") ||
    appLower.includes("console")
  ) {
    return "intelAppTerminal";
  }
  if (
    appLower.includes("figma") ||
    appLower.includes("photoshop") ||
    appLower.includes("illustrator") ||
    appLower.includes("sketch") ||
    appLower.includes("design")
  ) {
    return "intelAppDesign";
  }
  if (
    appLower.includes("zoom") ||
    appLower.includes("teams") ||
    appLower.includes("meet") ||
    appLower.includes("webex")
  ) {
    return "intelAppMeeting";
  }
  if (
    appLower.includes("notion") ||
    appLower.includes("obsidian") ||
    appLower.includes("notes") ||
    appLower.includes("calendar") ||
    appLower.includes("word") ||
    appLower.includes("excel") ||
    appLower.includes("powerpoint")
  ) {
    return "intelAppProductivity";
  }
  if (appLower.includes("finder") || appLower.includes("files")) {
    return "intelAppFinder";
  }

  return "intelAppDefault";
}

const PHISHING_BLACKLIST = [
  "sui-reward",
  "sui-claim",
  "cetus-airdrop",
  "cetus-claim",
  "sui-airdrop",
  "suigiveaway",
  "scam-cetus",
  "sui-rewards",
  "cetus-rewards",
  "scam",
  "phishing",
];

function setupContextMonitoring(): void {
  setInterval(() => {
    void (async () => {
      // Only the elected Master window should poll the active app
      if (!isMaster) {
        return;
      }

      try {
        const activeApp = await window.electronAPI.getActiveApp();
        if (!activeApp) return;

        let browserTab: string | null = null;
        let browserUrl: string | null = null;
        const appLower = activeApp.toLowerCase();
        if (
          appLower.includes("chrome") ||
          appLower.includes("safari") ||
          appLower.includes("arc") ||
          appLower.includes("firefox") ||
          appLower.includes("brave") ||
          appLower.includes("browser")
        ) {
          browserTab = await window.electronAPI.getBrowserTab(activeApp);
          browserUrl = await window.electronAPI.getBrowserUrl(activeApp);
        }

        // Check if URL or Tab title matches phishing blacklist
        if (browserUrl || browserTab) {
          const urlLower = (browserUrl || "").toLowerCase();
          const tabLower = (browserTab || "").toLowerCase();
          const isBlacklisted = PHISHING_BLACKLIST.some(
            (keyword) =>
              urlLower.includes(keyword) || tabLower.includes(keyword),
          );
          if (isBlacklisted) {
            const displayUrl = browserUrl || browserTab;
            void window.electronAPI.broadcastPetEvent("pet:say", {
              text: `🚨 DANGER! Potential phishing site detected:\n${displayUrl}\nClose this tab immediately!`,
              priority: true,
            });
            void window.electronAPI.broadcastPetEvent("blockchain:event", {
              event_type: "bonk",
              pet_slug: "Agent",
            });
            return;
          }
        }

        // Check for time-based contexts first (lunch or late night)
        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();
        let category = "";

        if (hour >= 23 || hour < 5) {
          category = "intelTimeLate";
        } else if (
          (hour === 11 && min >= 30) ||
          hour === 12 ||
          (hour === 13 && min === 0)
        ) {
          category = "intelTimeLunch";
        } else {
          category = getSpeechCategory(activeApp, browserTab);
        }

        const contextKey = `${category}_${activeApp}_${browserTab || ""}`;
        const nowTime = Date.now();

        // Comment if:
        // 1. Context changed and last comment was > 60s ago
        // 2. Same context and last comment was > 900s ago (15 minutes)
        if (
          (contextKey !== lastContextKey &&
            nowTime - lastCommentTime > 60000) ||
          (contextKey === lastContextKey && nowTime - lastCommentTime > 900000)
        ) {
          lastContextKey = contextKey;
          lastCommentTime = nowTime;

          // Broadcast the category key to all pet windows
          void window.electronAPI.broadcastPetEvent("pet:say", {
            text: category,
            priority: false,
          });
        }
      } catch (err) {
        console.error("[ContextMonitor] Error polling active app:", err);
      }
    })();
  }, 5000);
}

/** Placeholder for optional level-up transaction append — no-op until contract supports it */
function _maybeAppendLevelUp(_tx: unknown): void {
  /* reserved */
}

init().catch(console.error);

// --- Debug mode (press D to toggle) ---
let debugMode = false;
let debugTimer: ReturnType<typeof setInterval> | null = null;

document.addEventListener("keydown", (e) => {
  if (e.key !== "d" && e.key !== "D") return;
  debugMode = !debugMode;
  const canvas = document.getElementById(
    "pet-canvas",
  ) as HTMLCanvasElement | null;
  const panel = document.getElementById("debug-overlay") as HTMLElement | null;
  if (!canvas || !panel) return;
  canvas.classList.toggle("debug", debugMode);
  panel.classList.toggle("visible", debugMode);
  document.body.classList.toggle("debug", debugMode);

  if (debugMode) {
    debugTimer = setInterval(() => {
      const dpr = window.devicePixelRatio || 1;
      const lx = (window.screenX / dpr).toFixed(1);
      const ly = (window.screenY / dpr).toFixed(1);
      panel.textContent =
        `id: ${instanceId}\n` +
        `pos: ${lx}, ${ly} (logical)\n` +
        `size: ${window.innerWidth}x${window.innerHeight} (logical)\n` +
        `dpr: ${dpr}\n` +
        `scale: ${currentScale.toFixed(2)}`;
    }, 200);
  } else {
    if (debugTimer) {
      clearInterval(debugTimer);
      debugTimer = null;
    }
    panel.textContent = "";
  }
});
