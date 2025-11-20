/* game.js — complete Simon game JS (use with index.html and styles.css from earlier)
   Requires sound files in ./sounds/:
     piano-green.wav, piano-red.wav, piano-yellow.wav, piano-blue.wav
*/

(() => {
  // --- config & state ---
  const PADS = ["green", "red", "yellow", "blue"];
  const keyMap = { a: "green", s: "red", d: "yellow", f: "blue" };

  let audioCtx = null;
  const sampleMap = {
    green: 'sounds/piano-green.wav',
    red:   'sounds/piano-red.wav',
    yellow:'sounds/piano-yellow.wav',
    blue:  'sounds/piano-blue.wav'
  };
  const audioBuffers = {}; // decoded AudioBuffer per pad
  let samplesLoaded = false;

  // DOM refs
  const startBtn = document.getElementById("startBtn");
  const levelEl = document.getElementById("level");
  const highScoreEl = document.getElementById("highScore");
  const rulesBtn = document.getElementById("rulesBtn");
  const rulesModal = document.getElementById("rulesModal");
  const closeRules = document.getElementById("closeRules");
  const gotIt = document.getElementById("gotIt");
  const muteBtn = document.getElementById("muteBtn");
  const srLive = document.getElementById("srLive");
  const padEls = Array.from(document.querySelectorAll(".pad"));

  // Game-over overlay refs (ensure these exist in your HTML)
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const finalScoreEl = document.getElementById('finalScore');
  const retryBtn = document.getElementById('retryBtn');
  const closeGameOver = document.getElementById('closeGameOver');

  // state
  let sequence = [];
  let playerIndex = 0;
  let level = 0;
  let isPlayingSequence = false;
  let muted = false;
  let highScore = Number(localStorage.getItem("simon_highscore") || 0);
  let lastTap = 0;

  // initialize UI values (safe guards)
  if (highScoreEl) highScoreEl.textContent = highScore;
  if (levelEl) levelEl.textContent = level;
  if (srLive) srLive.textContent = "Press Start or Space to begin.";

  // --- Audio helpers (samples + fallback oscillator) ---
  async function ensureAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        audioCtx = null;
        console.warn('AudioContext unavailable:', e);
      }
    }
    return audioCtx;
  }

  async function preloadSamples() {
    const ctx = await ensureAudioCtx();
    if (!ctx) return;
    const names = Object.keys(sampleMap);
    await Promise.all(names.map(async (name) => {
      try {
        const res = await fetch(sampleMap[name]);
        const arrayBuffer = await res.arrayBuffer();
        // decodeAudioData returns a promise in modern browsers, but some use callback
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        audioBuffers[name] = decoded;
      } catch (err) {
        console.warn('Failed to load sample for', name, err);
        audioBuffers[name] = null;
      }
    }));
    samplesLoaded = true;
  }

  // start preloading after a user gesture (avoids autoplay policy issues)
  document.addEventListener('click', () => {
    if (!audioCtx || !samplesLoaded) preloadSamples();
  }, { once: true });

  function playSample(color, when = 0) {
    if (muted) return;
    if (!audioCtx) return;
    const buffer = audioBuffers[color];
    if (!buffer) {
      playOscillatorTone(color); // fallback
      return;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const gain = audioCtx.createGain();
    // set gentle gain to avoid clipping
    gain.gain.setValueAtTime(0.9, audioCtx.currentTime + when);
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start(audioCtx.currentTime + when);
  }

  function playOscillatorTone(color, duration = 300) {
    if (muted) return;
    if (!audioCtx) ensureAudioCtx();
    if (!audioCtx) return;
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const fallbackFreq = { green: 392, red: 523.25, yellow: 329.63, blue: 261.63 };
    osc.frequency.value = fallbackFreq[color] || 440;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);
      setTimeout(() => osc.stop(), 30);
    }, duration);
  }

  function playWrongTone() {
    if (muted) return;
    if (!audioCtx) ensureAudioCtx();
    if (!audioCtx) return;
    const ctx = audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 150;
    o.type = "sawtooth";
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + 0.01);
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);
      setTimeout(() => o.stop(), 40);
    }, 350);
  }

  // --- UI helpers (game over overlay) ---
  function showGameOverOverlay(score) {
    if (!gameOverOverlay || !finalScoreEl) return;
    finalScoreEl.textContent = score;
    gameOverOverlay.setAttribute('aria-hidden','false');
    gameOverOverlay.style.display = 'flex';
  }

  function hideGameOverOverlay() {
    if (!gameOverOverlay) return;
    gameOverOverlay.setAttribute('aria-hidden','true');
    gameOverOverlay.style.display = 'none';
  }

  // --- game helpers ---
  function saveHighScore(v) {
    highScore = Math.max(highScore, v);
    localStorage.setItem("simon_highscore", String(highScore));
    if (highScoreEl) highScoreEl.textContent = highScore;
  }

  function flashPad(color, duration = 300) {
    const el = padEls.find(p => p.dataset.pad === color);
    if (!el) return;
    el.classList.add("active");
    // play sample (with oscillator fallback inside)
    playSample(color);
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("active"), Math.max(duration - 40, 80));
  }

  async function playSequence(seq) {
    isPlayingSequence = true;
    if (srLive) srLive.textContent = `Level ${seq.length}`;
    const baseDelay = Math.max(500 - seq.length * 8, 160);
    for (let i = 0; i < seq.length; i++) {
      flashPad(seq[i], Math.max(baseDelay - i * 8, 120));
      await new Promise(r => setTimeout(r, Math.max(baseDelay - i * 8, 140)));
    }
    isPlayingSequence = false;
  }

  function nextRound() {
    const next = PADS[Math.floor(Math.random() * PADS.length)];
    sequence.push(next);
    level = sequence.length;
    if (levelEl) levelEl.textContent = level;
    // save previous highscore (optional)
    saveHighScore(level - 1);
    playSequence(sequence);
  }

  function startGame() {
    sequence = [];
    playerIndex = 0;
    level = 0;
    if (levelEl) levelEl.textContent = 0;
    if (srLive) srLive.textContent = "Get ready";
    setTimeout(() => nextRound(), 350);
  }

  function gameOver() {
    // play wrong tone (if not muted)
    playWrongTone();
    if (srLive) srLive.textContent = `Game Over. You reached ${level}.`;
    saveHighScore(level);
    showGameOverOverlay(level);
    // reset
    sequence = [];
    playerIndex = 0;
    level = 0;
    if (levelEl) levelEl.textContent = 0;
    isPlayingSequence = false;
  }

  function handlePlayerPress(color) {
    const now = Date.now();
    if (now - lastTap < 100) return; // debounce
    lastTap = now;

    if (isPlayingSequence) return;
    if (!sequence.length) return;

    flashPad(color, 200);

    const expected = sequence[playerIndex];
    if (color === expected) {
      playerIndex++;
      if (playerIndex === sequence.length) {
        playerIndex = 0;
        setTimeout(() => nextRound(), 450);
      }
    } else {
      gameOver();
    }
  }

  // --- event bindings ---
  padEls.forEach(pad => {
    pad.addEventListener("pointerdown", e => {
      e.preventDefault();
      handlePlayerPress(pad.dataset.pad);
    });
    pad.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handlePlayerPress(pad.dataset.pad);
      }
    });
  });

  window.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (keyMap[k]) handlePlayerPress(keyMap[k]);
    if ((e.key === " " || e.key === "Enter") && level === 0) startGame();
  });

  if (startBtn) startBtn.addEventListener("click", startGame);

  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      muted = !muted;
      muteBtn.textContent = muted ? "🔇" : "🔊";
      muteBtn.setAttribute("aria-pressed", String(muted));
      if (!muted) ensureAudioCtx(); // ensure audio exists if unmuting
    });
  }

  // rules modal
  if (rulesBtn && rulesModal && closeRules && gotIt) {
    rulesBtn.addEventListener("click", () => {
      rulesModal.setAttribute("aria-hidden", "false");
      rulesModal.style.display = "flex";
      closeRules.focus();
    });
    closeRules.addEventListener("click", () => {
      rulesModal.setAttribute("aria-hidden", "true");
      rulesModal.style.display = "none";
      rulesBtn.focus();
    });
    gotIt.addEventListener("click", () => {
      rulesModal.setAttribute("aria-hidden", "true");
      rulesModal.style.display = "none";
      if (startBtn) startBtn.focus();
    });
    rulesModal.addEventListener("click", (e) => {
      if (e.target === rulesModal) {
        rulesModal.setAttribute("aria-hidden", "true");
        rulesModal.style.display = "none";
        rulesBtn.focus();
      }
    });
  }

  // game over overlay buttons (safe guards)
  if (retryBtn && closeGameOver && gameOverOverlay) {
    retryBtn.addEventListener('click', () => {
      hideGameOverOverlay();
      startGame();
    });
    closeGameOver.addEventListener('click', () => hideGameOverOverlay());
    gameOverOverlay.addEventListener('click', (e) => {
      if (e.target === gameOverOverlay) hideGameOverOverlay();
    });
  }

  // expose helpful message
  if (srLive) srLive.textContent = "Press Start or Space to begin.";
})();
