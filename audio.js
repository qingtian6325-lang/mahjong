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

  function updateChineseVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      var voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return;
      var zhVoices = voices.filter(function(v) {
        return v.lang && (v.lang.toLowerCase().indexOf('zh') === 0 || v.lang.toLowerCase().indexOf('cmn') === 0);
      });
      if (zhVoices.length > 0) {
        var cnVoice = zhVoices.find(function(v) {
          var l = v.lang.toLowerCase();
          return l.indexOf('cn') !== -1 || l.indexOf('hans') !== -1 || l === 'zh_cn' || l === 'zh-cn';
        });
        chineseVoice = cnVoice || zhVoices[0];
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
    },

    // 10. Voice Speech Synthesis (真人语音报牌、碰杠胡、快捷短句)
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

        // Distinct pitch and pacing based on seat to differentiate players at the table
        var SEAT_VOICES = [
          { pitch: 1.05, rate: 1.15 }, // Seat 0 (自己: 自然清脆)
          { pitch: 0.88, rate: 1.12 }, // Seat 1 (雀神阿强: 沉稳男声)
          { pitch: 1.25, rate: 1.18 }, // Seat 2 (干王小美: 甜美女声)
          { pitch: 0.98, rate: 1.14 }  // Seat 3 (德帅老十: 儒雅男声)
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

    // 语音报牌（例如打二条 -> "二条" / "2条"）
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
        this.speak(TILE_SPOKEN_NAMES[tile], seat, { rate: 1.16 });
      }
    },

    // 动作报语音（碰！杠！吃！胡牌！自摸！花杠！）
    speakAction: function(action, seat) {
      var map = {
        'peng': '碰！', '碰': '碰！',
        'gang': '杠！', '杠': '杠！', '明杠': '杠！', '暗杠': '杠！',
        'chi': '吃！', '吃': '吃！',
        'hu': '胡牌！', '胡': '胡牌！', '胡牌': '胡牌！',
        'zimo': '自摸！', '自摸': '自摸！',
        'flower': '花杠！', '花杠': '花杠！'
      };
      var text = map[action] || (action + '！');
      this.speak(text, seat, { rate: 1.25, volume: 1.0 });
    },

    // 快捷短句语音播报
    speakPhrase: function(phrase, seat) {
      if (!phrase) return;
      // 过滤表情符号以获取纯净清晰的文字发音
      var cleanText = phrase.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim();
      if (cleanText) {
        this.speak(cleanText, seat, { rate: 1.12, volume: 1.0, cancelPrevious: true });
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
