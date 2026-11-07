/**
 * Web Audio API Sound Synthesizer for Mahjong
 * Authentic, zero-dependency, works completely offline and cross-platform (iOS, Android, Web).
 */
(function() {
  'use strict';

  var audioCtx = null;
  var isMuted = false;
  var isVoiceMuted = false;
  var chineseVoice = null;

  function scoreVoiceQuality(v) {
    var name = (v.name || '').toLowerCase();
    var lang = (v.lang || '').toLowerCase();
    var score = 0;
    if (lang.indexOf('cn') !== -1 || lang.indexOf('hans') !== -1 || lang === 'zh-cn' || lang === 'zh_cn') score += 30;
    else if (lang.indexOf('tw') !== -1 || lang.indexOf('hk') !== -1) score += 15;
    if (name.indexOf('natural') !== -1 || name.indexOf('neural') !== -1 || name.indexOf('online') !== -1) score += 100;
    if (name.indexOf('xiaoxiao') !== -1 || name.indexOf('晓晓') !== -1 || name.indexOf('yunxi') !== -1 || name.indexOf('云希') !== -1 || name.indexOf('xiaoyi') !== -1) score += 90;
    if (name.indexOf('premium') !== -1 || name.indexOf('enhanced') !== -1 || name.indexOf('siri') !== -1) score += 80;
    if (name.indexOf('ting-ting') !== -1 || name.indexOf('tingting') !== -1 || name.indexOf('婷婷') !== -1 || name.indexOf('meijia') !== -1 || name.indexOf('美佳') !== -1) score += 65;
    if (name.indexOf('google') !== -1) score += 55;
    if (v.localService === false) score += 20;
    return score;
  }

  function updateChineseVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      var voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return;
      var zhVoices = voices.filter(function(v) {
        return v.lang && (v.lang.toLowerCase().indexOf('zh') === 0 || v.lang.toLowerCase().indexOf('cmn') === 0);
      });
      if (zhVoices.length > 0) {
        zhVoices.sort(function(a, b) {
          return scoreVoiceQuality(b) - scoreVoiceQuality(a);
        });
        chineseVoice = zhVoices[0];
      }
    } catch (e) {}
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = updateChineseVoice;
      }
      updateChineseVoice();
    } catch (e) {}
  }

  var isBgmMuted = false;
  var bgmVolume = 0.35;
  var bgmMasterGain = null;
  var bgmInterval = null;
  var bgmStep = 0;
  var bgmDroneOsc1 = null;
  var bgmDroneOsc2 = null;

  var PENTA = {
    C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.00, A3: 220.00,
    C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.00, A4: 440.00,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00
  };

  // 32-step traditional Chinese leisure pentatonic melody pattern
  var BGM_PATTERN = [
    ['E4', 'C3'], null, ['G4', null], null, ['A4', 'G3'], null, ['G4', null], null,
    ['E4', 'C3'], null, ['D4', null], null, ['C4', 'A3'], null, ['D4', null], ['E4', null],
    ['G4', 'E3'], null, ['C5', null], null, ['D5', 'G3'], null, ['C5', null], null,
    ['A4', 'A3'], null, ['G4', null], null, ['E4', 'C3'], ['D4', null], ['C4', 'G3'], null
  ];

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

  function getBgmMasterGain(ctx) {
    if (!bgmMasterGain && ctx) {
      bgmMasterGain = ctx.createGain();
      bgmMasterGain.gain.setValueAtTime(isBgmMuted ? 0 : bgmVolume, ctx.currentTime);
      bgmMasterGain.connect(ctx.destination);
    }
    return bgmMasterGain;
  }

  function playPluckNote(ctx, freq, dest, vol, decayTime) {
    if (!freq) return;
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.2, now);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.9, now + (decayTime || 0.65));

    gain.gain.setValueAtTime(vol || 0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + (decayTime || 0.65));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + (decayTime || 0.68));
  }

  function tickBgm() {
    if (isBgmMuted) return;
    var ctx = getAudioContext();
    if (!ctx) return;
    var master = getBgmMasterGain(ctx);

    var item = BGM_PATTERN[bgmStep % BGM_PATTERN.length];
    bgmStep++;

    if (item) {
      var melodyKey = item[0];
      var bassKey = item[1];
      if (melodyKey && PENTA[melodyKey]) {
        playPluckNote(ctx, PENTA[melodyKey], master, 0.26, 0.65);
      }
      if (bassKey && PENTA[bassKey]) {
        playPluckNote(ctx, PENTA[bassKey], master, 0.18, 0.85);
      }
    }
  }

  function startBgmDrone(ctx, master) {
    if (bgmDroneOsc1) return;
    try {
      bgmDroneOsc1 = ctx.createOscillator();
      bgmDroneOsc2 = ctx.createOscillator();
      var droneGain = ctx.createGain();
      var filter = ctx.createBiquadFilter();

      bgmDroneOsc1.type = 'sine';
      bgmDroneOsc1.frequency.setValueAtTime(PENTA.C3, ctx.currentTime);
      bgmDroneOsc2.type = 'sine';
      bgmDroneOsc2.frequency.setValueAtTime(PENTA.G3, ctx.currentTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(260, ctx.currentTime);

      droneGain.gain.setValueAtTime(0.045, ctx.currentTime);

      bgmDroneOsc1.connect(filter);
      bgmDroneOsc2.connect(filter);
      filter.connect(droneGain);
      droneGain.connect(master);

      bgmDroneOsc1.start();
      bgmDroneOsc2.start();
    } catch (e) {}
  }

  function stopBgmDrone() {
    if (bgmDroneOsc1) {
      try {
        bgmDroneOsc1.stop();
        bgmDroneOsc2.stop();
      } catch (e) {}
      bgmDroneOsc1 = null;
      bgmDroneOsc2 = null;
    }
  }

  // Auto-unlock on first user gesture (critical for iOS Safari and mobile Chrome)
  function unlockAudio() {
    var ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    if (!MahjongAudio.bgmMuted) {
      MahjongAudio.startBGM();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        var dummy = new SpeechSynthesisUtterance('');
        dummy.volume = 0;
        window.speechSynthesis.speak(dummy);
      } catch (e) {}
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
      if (isMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    },

    get voiceMuted() {
      return isVoiceMuted;
    },
    set voiceMuted(val) {
      isVoiceMuted = !!val;
      try {
        localStorage.setItem('mj_voice_muted', isVoiceMuted ? '1' : '0');
      } catch (e) {}
      if (isVoiceMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    },

    get bgmMuted() {
      return isBgmMuted;
    },
    set bgmMuted(val) {
      isBgmMuted = !!val;
      try {
        localStorage.setItem('mj_bgm_muted', isBgmMuted ? '1' : '0');
      } catch (e) {}
      var ctx = getAudioContext();
      if (ctx && bgmMasterGain) {
        bgmMasterGain.gain.setValueAtTime(isBgmMuted ? 0 : bgmVolume, ctx.currentTime);
      }
      if (isBgmMuted) {
        this.stopBGM();
      } else {
        this.startBGM();
      }
    },

    get bgmVolume() {
      return bgmVolume;
    },
    set bgmVolume(val) {
      bgmVolume = Math.max(0, Math.min(1, parseFloat(val) || 0.35));
      try {
        localStorage.setItem('mj_bgm_vol', String(bgmVolume));
      } catch (e) {}
      var ctx = getAudioContext();
      if (ctx && bgmMasterGain && !isBgmMuted) {
        bgmMasterGain.gain.setValueAtTime(bgmVolume, ctx.currentTime);
      }
    },

    startBGM: function() {
      if (isBgmMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var master = getBgmMasterGain(ctx);
      master.gain.setValueAtTime(isBgmMuted ? 0 : bgmVolume, ctx.currentTime);

      startBgmDrone(ctx, master);

      if (!bgmInterval) {
        bgmStep = 0;
        bgmInterval = setInterval(tickBgm, 290);
      }
    },

    stopBGM: function() {
      if (bgmInterval) {
        clearInterval(bgmInterval);
        bgmInterval = null;
      }
      stopBgmDrone();
    },

    toggleBGM: function() {
      this.bgmMuted = !this.bgmMuted;
      return !this.bgmMuted;
    },

    init: function() {
      try {
        isMuted = (localStorage.getItem('mj_muted') === '1');
        isBgmMuted = (localStorage.getItem('mj_bgm_muted') === '1');
        isVoiceMuted = (localStorage.getItem('mj_voice_muted') === '1');
        var v = localStorage.getItem('mj_bgm_vol');
        if (v !== null) bgmVolume = parseFloat(v) || 0.35;
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
      osc.frequency.setValueAtTime(2200, now);
      osc.frequency.exponentialRampToValueAtTime(450, now + 0.035);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    },

    // 2. Authentic bone porcelain tile discard slap on felt table (清脆骨瓷扣桌啪！带台呢回响)
    playTileDrop: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;

      var now = ctx.currentTime;

      // Heavy body resonance (table thump / 台呢沉厚共鸣)
      var osc1 = ctx.createOscillator();
      var gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(320, now);
      osc1.frequency.exponentialRampToValueAtTime(55, now + 0.085);
      gain1.gain.setValueAtTime(0.75, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.09);

      // Sharp porcelain ivory click transient (清脆骨牌接触瞬间高频爆音)
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(2800, now);
      osc2.frequency.exponentialRampToValueAtTime(650, now + 0.035);
      gain2.gain.setValueAtTime(0.6, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.04);

      // Wood table click overtone
      var osc3 = ctx.createOscillator();
      var gain3 = ctx.createGain();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(1150, now);
      osc3.frequency.exponentialRampToValueAtTime(280, now + 0.045);
      gain3.gain.setValueAtTime(0.35, now);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now);
      osc3.stop(now + 0.05);
    },

    // 3. Chi (吃) - Pleasant rising musical chime with vibrato
    playChi: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      [523.25, 659.25, 783.99].forEach(function(freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.065);
        gain.gain.setValueAtTime(0.38, now + i * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.065);
        osc.stop(now + i * 0.065 + 0.29);
      });
    },

    // 4. Peng (碰) - Resonant punchy chime (清脆铜钟碰牌音)
    playPeng: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      [659.25, 987.77, 1318.51].forEach(function(freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.05);
        gain.gain.setValueAtTime(0.42, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.38);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.05);
        osc.stop(now + i * 0.05 + 0.39);
      });
    },

    // 5. Gang (杠) - Deep dramatic bronze gong with golden shimmer
    playGang: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      // Deep gong fundamental
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(360, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.65);

      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(260, now + 0.65);

      gain.gain.setValueAtTime(0.65, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.72);

      // Shimmering bronze overtone
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1440, now);
      osc2.frequency.exponentialRampToValueAtTime(480, now + 0.4);
      gain2.gain.setValueAtTime(0.3, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.42);
    },

    // 6. Hu (胡) - Celebratory Chinese pentatonic victory fanfare
    playHu: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      var notes = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5, E5, G5, C6, E6
      notes.forEach(function(freq, idx) {
        var t = now + idx * 0.085;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.45, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.56);
      });
    },

    // 7. Zimo (自摸) - Grand celebratory jackpot cascade fanfare with shimmer & bells
    playZimo: function() {
      if (isMuted) return;
      this.playHu();
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;

      // Sparkling ascending cascade
      [659.25, 783.99, 987.77, 1046.50, 1318.51, 1567.98, 2093.00].forEach(function(freq, i) {
        var t = now + 0.28 + i * 0.06;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.32, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.51);
      });

      // Warm celebration bass gong hit
      var bOsc = ctx.createOscillator();
      var bGain = ctx.createGain();
      bOsc.type = 'triangle';
      bOsc.frequency.setValueAtTime(220, now + 0.25);
      bOsc.frequency.exponentialRampToValueAtTime(60, now + 0.85);
      bGain.gain.setValueAtTime(0.5, now + 0.25);
      bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
      bOsc.connect(bGain);
      bGain.connect(ctx.destination);
      bOsc.start(now + 0.25);
      bOsc.stop(now + 0.86);
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
    },

    // 10. Voice Speech Synthesis (真人语音报牌、碰杠胡、快捷短句，赋予生动起伏语调与个性)
    speak: function(text, seat, customOpts) {
      if (isMuted || isVoiceMuted) return;
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      if (!text) return;

      try {
        if (!chineseVoice) updateChineseVoice();

        // Cancel previous utterance if specified to ensure prompt timing
        if (!customOpts || customOpts.cancelPrevious !== false) {
          window.speechSynthesis.cancel();
        }

        var u = new SpeechSynthesisUtterance(text);
        u.lang = (chineseVoice && chineseVoice.lang) ? chineseVoice.lang : 'zh-CN';
        if (chineseVoice) u.voice = chineseVoice;

        // Natural, pleasant pitch and pacing per seat (avoiding extreme pitch-shift formant distortion)
        var SEAT_VOICES = [
          { pitch: 1.04, rate: 1.12 }, // Seat 0 (自己: 自然清亮、吐字清晰)
          { pitch: 0.95, rate: 1.08 }, // Seat 1 (雀神阿强: 沉稳豪爽)
          { pitch: 1.10, rate: 1.10 }, // Seat 2 (千王小美: 柔和轻快)
          { pitch: 0.92, rate: 1.05 }  // Seat 3 (稳健老王: 醇厚从容)
        ];

        var sIdx = (seat !== undefined && seat !== null ? seat : 0) % 4;
        var seatCfg = SEAT_VOICES[sIdx];

        u.pitch = (customOpts && customOpts.pitch !== undefined) ? customOpts.pitch : seatCfg.pitch;
        u.rate = (customOpts && customOpts.rate !== undefined) ? customOpts.rate : seatCfg.rate;
        u.volume = (customOpts && customOpts.volume !== undefined) ? customOpts.volume : 1.0;

        window.speechSynthesis.speak(u);
      } catch (e) {
        console.warn('SpeechSynthesis error:', e);
      }
    },

    // 语音报牌（有调有感情的麻将桌报牌声调）
    speakTile: function(tile, seat) {
      var TILE_SPOKEN_NAMES = [
        // 0-8: 万子
        '一万', '二万', '三万', '四万', '五万', '六万', '七万', '八万', '九万',
        // 9-17: 条子 (用户明确要求：打二条 就会说2条/二条)
        '一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条',
        // 18-26: 筒子
        '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
        // 27-33: 字牌
        '东风', '南风', '西风', '北风', '红中', '发财', '白板',
        // 34: 飞牌 (百搭牌)
        '飞牌',
        // 35-42: 花牌
        '春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'
      ];
      if (tile >= 0 && tile < TILE_SPOKEN_NAMES.length) {
        var sIdx = (seat !== undefined && seat !== null ? seat : 0) % 4;
        this.speak(TILE_SPOKEN_NAMES[tile], sIdx, { rate: 1.15 });
      }
    },

    // 动作报语音（碰！杠！吃！胡牌！自摸！花杠！—— 生动有调的语音与语调）
    speakAction: function(action, seat) {
      var sIdx = (seat !== undefined && seat !== null ? seat : 0) % 4;
      var actKey = (action || '').toLowerCase().replace('！', '').trim();
      if (actKey === 'pon' || actKey === '碰') actKey = 'peng';
      if (actKey === 'kong' || actKey === '明杠' || actKey === '暗杠') actKey = 'gang';
      if (actKey === 'hu' || actKey === '胡') actKey = 'hu';
      if (actKey === 'tsumo' || actKey === '自摸') actKey = 'zimo';

      var map = {
        'peng': '碰！',
        'gang': '杠！',
        'chi': '吃！',
        'hu': '胡牌！',
        'zimo': '自摸！',
        'flower': '花杠！'
      };
      var text = map[actKey] || (action + '！');
      this.speak(text, sIdx, { volume: 1.0 });
    },

    // 快捷短句语音播报（自然柔和真人语调 + 悦耳气泡和弦伴音，过滤波浪号等特殊字符）
    speakPhrase: function(phrase, seat) {
      if (!phrase) return;
      // 播放轻柔悦耳的双音木琴/古筝气泡前奏，让短句听感更温润饱满
      if (!isMuted) {
        try {
          var ctx = getAudioContext();
          if (ctx) {
            var now = ctx.currentTime;
            [523.25, 659.25].forEach(function(freq, idx) {
              var osc = ctx.createOscillator();
              var gain = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(freq, now + idx * 0.055);
              gain.gain.setValueAtTime(0.001, now + idx * 0.055);
              gain.gain.linearRampToValueAtTime(0.08, now + idx * 0.055 + 0.015);
              gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.24);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(now + idx * 0.055);
              osc.stop(now + idx * 0.055 + 0.25);
            });
          }
        } catch (e) {}
      }
      // 过滤表情符号及特殊波浪号（防止TTS读出“波浪号”）
      var cleanText = phrase
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
        .replace(/[\u2600-\u27BF]/g, '')
        .replace(/[～~]/g, '！')
        .trim();
      if (cleanText) {
        var sIdx = (seat !== undefined && seat !== null ? seat : 0) % 4;
        var PHRASE_VOICES = [
          { pitch: 1.01, rate: 1.02 }, // 自己: 最自然柔和的原声语调，无电音失真
          { pitch: 0.96, rate: 1.00 }, // 阿强: 自然稳重
          { pitch: 1.05, rate: 1.03 }, // 小美: 自然清甜
          { pitch: 0.94, rate: 0.98 }  // 老王: 自然醇厚
        ];
        var pCfg = PHRASE_VOICES[sIdx];
        this.speak(cleanText, sIdx, { pitch: pCfg.pitch, rate: pCfg.rate, volume: 0.95, cancelPrevious: true });
      }
    },

    // 11. 互动表情音效合成器 (Web Audio API)
    playCoinSound: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;
      [1760, 2637, 3520].forEach(function(freq, i) {
        var t = now + i * 0.05;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.19);
      });
    },

    playBombSound: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.45);
      gain.gain.setValueAtTime(0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.46);
    },

    playFireSound: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var filter = ctx.createBiquadFilter();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.3);
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.31);
    },

    playTeaSound: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;
      [880, 1320].forEach(function(freq, i) {
        var t = now + i * 0.08;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.23);
      });
    },

    playLaughSound: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;
      [523.25, 659.25, 783.99, 659.25, 783.99].forEach(function(freq, i) {
        var t = now + i * 0.07;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.095);
      });
    },

    playThumbsSound: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;
      [783.99, 1046.50].forEach(function(freq, i) {
        var t = now + i * 0.09;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    },

    playCrownSound: function() {
      if (isMuted) return;
      var ctx = getAudioContext();
      if (!ctx) return;
      var now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach(function(freq, i) {
        var t = now + i * 0.08;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.36);
      });
    },

    playEmojiSound: function(emoji) {
      if (!emoji) return;
      if (emoji.indexOf('🤑') !== -1) this.playCoinSound();
      else if (emoji.indexOf('💣') !== -1) this.playBombSound();
      else if (emoji.indexOf('🔥') !== -1) this.playFireSound();
      else if (emoji.indexOf('☕') !== -1) this.playTeaSound();
      else if (emoji.indexOf('😂') !== -1) this.playLaughSound();
      else if (emoji.indexOf('👍') !== -1) this.playThumbsSound();
      else if (emoji.indexOf('👑') !== -1) this.playCrownSound();
      else this.playTileClick();
    }
  };

  MahjongAudio.init();
  window.MahjongAudio = MahjongAudio;
})();
