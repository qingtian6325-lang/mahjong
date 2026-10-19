/**
 * Web Audio API Sound Synthesizer for Mahjong
 * Authentic, zero-dependency, works completely offline and cross-platform (iOS, Android, Web).
 */
(function() {
  'use strict';

  var audioCtx = null;
  var isMuted = false;

  function getAudioContext() {
    if (!audioCtx) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Auto-unlock on first user gesture (critical for iOS Safari and mobile Chrome)
  function unlockAudio() {
    var ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('click', unlockAudio);
  }
  window.addEventListener('touchstart', unlockAudio, { passive: true });
  window.addEventListener('click', unlockAudio, { passive: true });

  var MahjongAudio = {
    get muted() {
      return isMuted;
    },
    set muted(val) {
      isMuted = !!val;
      try {
        localStorage.setItem('mj_muted', isMuted ? '1' : '0');
      } catch (e) {}
    },

    init: function() {
      try {
        isMuted = localStorage.getItem('mj_muted') === '1';
      } catch (e) {}
    },

    // 1. Crisp tile tap / select
    playTileClick: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;

      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.045);
    },

    // 2. Tile discard slap on felt table (啪！/ 哒！)
    playTileDrop: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;

      var now = ctx.currentTime;

      // Heavy body resonance (table thump)
      var osc1 = ctx.createOscillator();
      var gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(260, now);
      osc1.frequency.exponentialRampToValueAtTime(70, now + 0.09);
      gain1.gain.setValueAtTime(0.65, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.095);

      // Sharp ivory click transient
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1600, now);
      osc2.frequency.exponentialRampToValueAtTime(450, now + 0.05);
      gain2.gain.setValueAtTime(0.5, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.055);
    },

    // 3. Chi (吃) - Pleasant rising chime
    playChi: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      [523.25, 659.25].forEach(function(freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.35, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.26);
      });
    },

    // 4. Peng (碰) - Resonant punchy chime
    playPeng: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      [587.33, 880].forEach(function(freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.06);
        gain.gain.setValueAtTime(0.4, now + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.06);
        osc.stop(now + i * 0.06 + 0.36);
      });
    },

    // 5. Gang (杠) - Deep dramatic gong
    playGang: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.5);

      // Lowpass filter for warm gong timbre
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(300, now + 0.5);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.56);
    },

    // 6. Hu (胡) - Celebratory major fanfare
    playHu: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      var notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach(function(freq, idx) {
        var t = now + idx * 0.1;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.46);
      });
    },

    // 7. Zimo (自摸) - Extra grand fanfare with shimmer
    playZimo: function() {
      if (isMuted) return;
      this.playHu();
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      // High shimmering harmonics
      [1318.51, 1567.98, 2093.00].forEach(function(freq, i) {
        var t = now + 0.35 + i * 0.08;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.61);
      });
    },

    // 8. Countdown warning tick (for ≤ 5 seconds)
    playTick: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
    },

    // 9. Standard UI button click
    playButton: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(700, now);
      osc.frequency.exponentialRampToValueAtTime(350, now + 0.035);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    }
  };

  MahjongAudio.init();
  window.MahjongAudio = MahjongAudio;
})();
