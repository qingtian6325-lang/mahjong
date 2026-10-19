/**
 * Mahjong Game Engine & Rules
 * Implements 4-Player Mahjong with 4 Wild "飞" Tiles, 8 Flowers, Flower Kongs, Over-water (过水),
 * Advanced Ting (听牌) Detection, and AI heuristics.
 */
(function() {
  'use strict';

  var WILD = 34;
  var HONORS = ['东', '南', '西', '北', '中', '发', '白'];
  var FLOWER_NAMES = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'];
  var FLOWER_COLORS = ['#178a4c', '#cf2e1f', '#c46a12', '#1f4e9c', '#c2437e', '#2a7f8f', '#178a4c', '#c46a12'];
  var WINDS = ['东', '南', '西', '北'];
  var BOT_NAMES = ['雀神阿强', '千王小美', '稳健老王'];
  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function isFlower(t) { return t >= 35 && t <= 42; }
  function isWild(t) { return t === WILD; }
  function isHonor(t) { return t >= 27 && t <= 33; }
  function isSuit(t) { return t >= 0 && t < 27; }

  function tileName(t) {
    if (t === WILD) return '飞';
    if (isFlower(t)) return FLOWER_NAMES[t - 35];
    if (t < 9) return CN_NUM[t] + '万';
    if (t < 18) return (t - 8) + '条';
    if (t < 27) return (t - 17) + '筒';
    return HONORS[t - 27];
  }

  function tileSuit(t) {
    if (t === WILD) return 'wild';
    if (isFlower(t)) return 'flower';
    if (t < 9) return 'wan';
    if (t < 18) return 'tiao';
    if (t < 27) return 'tong';
    return 'zi';
  }

  /* ================= Enhanced SVG Tile Faces ================= */
  var SERIF = "KaiTi,STKaiti,'Kaiti SC','SimSun',serif";

  function dotSVG(x, y, r, color) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + color + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.62).toFixed(1) + '" fill="#fdfaf2"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.3).toFixed(1) + '" fill="' + color + '"/>';
  }

  function stickInner(color) {
    return '<rect x="-3.2" y="-6.6" width="6.4" height="13.2" rx="3.1" fill="' + color + '"/>' +
      '<rect x="-3.2" y="-1.1" width="6.4" height="2.2" fill="rgba(0,0,0,.18)"/>' +
      '<rect x="-1.7" y="-5.6" width="1.7" height="11.2" rx=".85" fill="rgba(255,255,255,.45)"/>';
  }

  function stickSVG(x, y, color, s) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + (s || 1) + ')">' + stickInner(color) + '</g>';
  }

  function posFor(n) {
    switch (n) {
      case 1: return [[20, 28]];
      case 2: return [[13, 15], [27, 41]];
      case 3: return [[11, 13], [20, 28], [29, 43]];
      case 4: return [[12, 15], [28, 15], [12, 41], [28, 41]];
      case 5: return [[12, 14], [28, 14], [20, 28], [12, 42], [28, 42]];
      case 6: return [[12, 12], [28, 12], [12, 28], [28, 28], [12, 44], [28, 44]];
      case 7: return [[10, 10], [20, 14], [30, 18], [12, 32], [28, 32], [12, 46], [28, 46]];
      case 8: return [[12, 10], [28, 10], [12, 22], [28, 22], [12, 34], [28, 34], [12, 46], [28, 46]];
      case 9: return [[11, 12], [20, 12], [29, 12], [11, 28], [20, 28], [29, 28], [11, 44], [20, 44], [29, 44]];
    }
    return [[20, 28]];
  }

  var DOT_COLORS = {
    2: ['#1f4e9c', '#178a4c'],
    3: ['#1f4e9c', '#cf2e1f', '#178a4c'],
    4: ['#1f4e9c', '#178a4c', '#178a4c', '#1f4e9c'],
    5: ['#1f4e9c', '#178a4c', '#cf2e1f', '#178a4c', '#1f4e9c'],
    6: ['#178a4c', '#178a4c', '#1f4e9c', '#1f4e9c', '#cf2e1f', '#cf2e1f'],
    7: ['#178a4c', '#178a4c', '#178a4c', '#1f4e9c', '#1f4e9c', '#1f4e9c', '#1f4e9c'],
    9: ['#178a4c', '#178a4c', '#178a4c', '#cf2e1f', '#cf2e1f', '#cf2e1f', '#1f4e9c', '#1f4e9c', '#1f4e9c']
  };

  function faceSVG(t) {
    var s = '<svg viewBox="0 0 40 56" class="tile-face-svg" aria-hidden="true">';
    if (t === WILD) {
      return s +
        '<defs>' +
        '<linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#fff099"/><stop offset="50%" stop-color="#e5a91e"/><stop offset="100%" stop-color="#9e6d04"/>' +
        '</linearGradient>' +
        '</defs>' +
        '<rect x="2" y="2" width="36" height="52" rx="3" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" stroke-dasharray="3 1.5"/>' +
        '<text x="20" y="36" text-anchor="middle" font-size="27" font-weight="900" fill="#cf2e1f" font-family="' + SERIF + '">飛</text>' +
        '<rect x="8" y="42" width="24" height="9" rx="4.5" fill="#f5c242"/>' +
        '<text x="20" y="49" text-anchor="middle" font-size="7" font-weight="bold" fill="#5c3800">万能</text>' +
        '</svg>';
    }
    if (isFlower(t)) {
      var col = FLOWER_COLORS[t - 35];
      return s +
        '<text x="20" y="32" text-anchor="middle" font-size="22" font-weight="bold" fill="' + col + '" font-family="' + SERIF + '">' + FLOWER_NAMES[t - 35] + '</text>' +
        '<path d="M20 38 Q16 43 13 47 M20 38 Q24 43 27 47" stroke="#178a4c" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        '<text x="20" y="52" text-anchor="middle" font-size="8" font-weight="bold" fill="' + col + '">花</text></svg>';
    }
    if (t < 9) { // 万
      return s +
        '<text x="20" y="23" text-anchor="middle" font-size="16" font-weight="bold" fill="#1b306b" font-family="' + SERIF + '">' + CN_NUM[t] + '</text>' +
        '<text x="20" y="47" text-anchor="middle" font-size="19" font-weight="bold" fill="#cf2e1f" font-family="' + SERIF + '">萬</text></svg>';
    }
    if (t < 18) { // 条
      var n = t - 8;
      if (n === 1) { // 1条: 孔雀/神鸟图腾
        return s +
          '<path d="M14 14 q-6.5 -6.5 -12 -5.5 q3 6.5 9.5 7.5 Z" fill="#2fae5f"/>' +
          '<path d="M26 14 q6.5 -6.5 12 -5.5 q-3 6.5 -9.5 7.5 Z" fill="#2fae5f"/>' +
          '<g transform="translate(20,29) scale(1.85)">' + stickInner('#178a4c') + '</g>' +
          '<circle cx="20" cy="18" r="3.2" fill="#cf2e1f"/>' +
          '</svg>';
      }
      var pos = posFor(n);
      var out = s;
      for (var i = 0; i < pos.length; i++) {
        var bc = ((n === 5 && i === 2) || (n === 9 && i === 4)) ? '#cf2e1f' : '#178a4c';
        out += stickSVG(pos[i][0], pos[i][1], bc, n === 8 ? 0.82 : 1);
      }
      return out + '</svg>';
    }
    if (t < 27) { // 筒
      var n2 = t - 17;
      if (n2 === 1) {
        return s +
          '<circle cx="20" cy="28" r="13" fill="none" stroke="#178a4c" stroke-width="2.8"/>' +
          '<circle cx="20" cy="28" r="9" fill="none" stroke="#cf2e1f" stroke-width="2.2"/>' +
          '<circle cx="20" cy="28" r="5" fill="#1f4e9c"/><circle cx="20" cy="28" r="2.2" fill="#fdfaf2"/></svg>';
      }
      var pos2 = posFor(n2);
      var cols = DOT_COLORS[n2] || ['#1f4e9c'];
      var r = n2 === 8 ? 4.6 : (n2 === 7 ? 4.9 : 5.3);
      var out2 = s;
      for (var j = 0; j < pos2.length; j++) {
        out2 += dotSVG(pos2[j][0], pos2[j][1], r, cols[j % cols.length]);
      }
      return out2 + '</svg>';
    }
    // 字牌
    var h = t - 27;
    if (h === 6) { // 白板
      return s + '<rect x="9" y="10" width="22" height="36" rx="3" fill="none" stroke="#1f4e9c" stroke-width="3"/></svg>';
    }
    var hcol = h === 4 ? '#cf2e1f' : (h === 5 ? '#178a4c' : '#222222');
    var hchar = h === 5 ? '發' : (h === 4 ? '中' : HONORS[h]);
    return s + '<text x="20" y="38" text-anchor="middle" font-size="27" font-weight="bold" fill="' + hcol + '" font-family="' + SERIF + '">' + hchar + '</text></svg>';
  }

  function tileHTML(t, extraClass) {
    var cls = 'mj-tile' + (extraClass ? ' ' + extraClass : '');
    var suit = tileSuit(t);
    cls += ' suit-' + suit;
    if (t === WILD) cls += ' is-wild';
    return '<div class="' + cls + '" data-tile="' + t + '">' +
      '<div class="tile-3d-wrap">' +
        '<div class="tile-face">' + faceSVG(t) + '</div>' +
        '<div class="tile-edge"></div>' +
        '<div class="tile-back"></div>' +
      '</div>' +
    '</div>';
  }

  function backHTML(extraClass) {
    var cls = 'mj-tile tile-covered' + (extraClass ? ' ' + extraClass : '');
    return '<div class="' + cls + '">' +
      '<div class="tile-3d-wrap">' +
        '<div class="tile-back-only"></div>' +
      '</div>' +
    '</div>';
  }

  /* ================= Win Detection (with 4 Wild "飞") ================= */
  function countsOf(hand) {
    var c = new Array(34).fill(0), w = 0;
    for (var i = 0; i < hand.length; i++) {
      if (hand[i] === WILD) w++;
      else if (hand[i] < 34) c[hand[i]]++;
    }
    return { c: c, w: w };
  }

  function meldsOk(c, w) {
    var i = -1;
    for (var k = 0; k < 34; k++) {
      if (c[k] > 0) { i = k; break; }
    }
    if (i === -1) return w % 3 === 0;

    // 1. Try Triplet anchored at i
    var useReal = Math.min(c[i], 3), need = 3 - useReal;
    if (need <= w) {
      var c2 = c.slice();
      c2[i] -= useReal;
      if (meldsOk(c2, w - need)) return true;
    }

    // 2. Try Sequence anchored at i (suits only, no honors)
    if (i < 27 && (i % 9) <= 6) {
      var c3 = c.slice();
      c3[i] -= 1;
      var wNeed = 0;
      for (var d = 1; d <= 2; d++) {
        if (c3[i + d] > 0) c3[i + d] -= 1;
        else wNeed++;
      }
      if (wNeed <= w && meldsOk(c3, w - wNeed)) return true;
    }

    return false;
  }

  function canWinCounts(c0, w0, meldCount) {
    var sum = 0;
    for (var k = 0; k < 34; k++) sum += c0[k];
    var total = sum + w0;
    if (total + meldCount * 3 !== 14 || total % 3 !== 2) return false;

    // Standard Form: 1 pair + Melds
    for (var t = 0; t < 34; t++) {
      if (c0[t] >= 2) {
        var c = c0.slice(); c[t] -= 2;
        if (meldsOk(c, w0)) return true;
      }
      if (c0[t] >= 1 && w0 >= 1) {
        var c2 = c0.slice(); c2[t] -= 1;
        if (meldsOk(c2, w0 - 1)) return true;
      }
    }
    if (w0 >= 2 && meldsOk(c0.slice(), w0 - 2)) return true;

    // Seven Pairs (七对) - closed hand with 0 melds
    if (meldCount === 0 && total === 14) {
      var pairs = 0, odd = 0;
      for (var t2 = 0; t2 < 34; t2++) {
        pairs += Math.floor(c0[t2] / 2);
        if (c0[t2] % 2) odd++;
      }
      var wLeft = w0, used = Math.min(odd, wLeft);
      pairs += used;
      wLeft -= used;
      pairs += Math.floor(wLeft / 2);
      if (pairs >= 7) return true;
    }

    return false;
  }

  function canWinHand(hand, meldCount) {
    var o = countsOf(hand);
    return canWinCounts(o.c, o.w, meldCount);
  }

  function canWinWithTile(hand, meldCount, tile) {
    if (tile === WILD) {
      var o = countsOf(hand);
      return canWinCounts(o.c, o.w + 1, meldCount);
    }
    return canWinHand(hand.concat([tile]), meldCount);
  }

  /* ================= Advanced Ting (听牌) Detection ================= */
  /**
   * Analyzes the hand to find which discards lead to Ting, and what tiles win.
   * @param {Array<number>} hand - Current hand of player (14 tiles when waiting to discard, or 13 tiles)
   * @param {number} meldCount - Number of melds already exposed
   * @param {Object} visibleCounts - Map of tile index -> count visible on table (in discards, melds, hand)
   * @returns {Object} tingMap: { [discardTile]: [{ tile: winTile, remaining: count }], ... }
   */
  function analyzeTing(hand, meldCount, visibleCounts) {
    var result = {};
    if (!hand || !hand.length) return result;
    visibleCounts = visibleCounts || {};

    if (hand.length % 3 === 2) {
      // 14 tiles: check discarding each unique tile
      var checkedDiscards = {};
      for (var i = 0; i < hand.length; i++) {
        var dTile = hand[i];
        if (dTile === WILD || checkedDiscards[dTile]) continue;
        checkedDiscards[dTile] = true;

        var subHand = hand.slice();
        subHand.splice(i, 1);

        var winTiles = [];
        // Test all possible winning tiles 0..34 (including WILD)
        for (var w = 0; w <= 34; w++) {
          if (canWinWithTile(subHand, meldCount, w)) {
            var seen = visibleCounts[w] || 0;
            // deduct the copy in hand if we're holding it
            var totalAvailable = 4;
            var remaining = Math.max(0, totalAvailable - seen);
            winTiles.push({ tile: w, remaining: remaining, name: tileName(w) });
          }
        }
        if (winTiles.length > 0) {
          result[dTile] = winTiles;
        }
      }
    } else if (hand.length % 3 === 1) {
      // 13 tiles: directly calculate what tiles we're waiting on
      var waits = [];
      for (var w2 = 0; w2 <= 34; w2++) {
        if (canWinWithTile(hand, meldCount, w2)) {
          var seen2 = visibleCounts[w2] || 0;
          var remaining2 = Math.max(0, 4 - seen2);
          waits.push({ tile: w2, remaining: remaining2, name: tileName(w2) });
        }
      }
      if (waits.length > 0) {
        result['current'] = waits;
      }
    }
    return result;
  }

  /* ================= Chi (吃) Combinations ================= */
  function findChiOptions(hand, discardTile) {
    if (discardTile >= 27 || discardTile === WILD || isFlower(discardTile)) return [];
    var r = discardTile % 9;
    var base = Math.floor(discardTile / 9) * 9;
    var set = {};
    for (var i = 0; i < hand.length; i++) set[hand[i]] = true;

    var options = [];
    // 1. [discard-2, discard-1, discard]
    if (r >= 2 && set[discardTile - 2] && set[discardTile - 1]) {
      options.push([discardTile - 2, discardTile - 1, discardTile]);
    }
    // 2. [discard-1, discard, discard+1]
    if (r >= 1 && r <= 7 && set[discardTile - 1] && set[discardTile + 1]) {
      options.push([discardTile - 1, discardTile, discardTile + 1]);
    }
    // 3. [discard, discard+1, discard+2]
    if (r <= 6 && set[discardTile + 1] && set[discardTile + 2]) {
      options.push([discardTile, discardTile + 1, discardTile + 2]);
    }
    return options;
  }

  /* ================= Kong (杠) Search ================= */
  function findKongs(player) {
    var o = countsOf(player.hand);
    var res = [];
    // Concealed Kong (暗杠)
    for (var t = 0; t < 34; t++) {
      if (o.c[t] === 4) res.push({ kind: 'concealed', tile: t });
    }
    // Added Kong (补杠)
    for (var m = 0; m < player.melds.length; m++) {
      if (player.melds[m].kind === 'pon' && o.c[player.melds[m].tiles[0]] >= 1) {
        res.push({ kind: 'added', tile: player.melds[m].tiles[0] });
      }
    }
    return res;
  }

  /* ================= AI Heuristics ================= */
  function handValue(c, w, meldCount) {
    var v = w * 5 + meldCount * 9;
    for (var t = 0; t < 34; t++) {
      var n = c[t];
      if (!n) continue;
      if (n >= 2) v += 4 + (n - 2) * 5;
      if (t < 27) {
        var r = t % 9;
        if (r <= 7 && c[t + 1]) v += 2;
        if (r <= 6 && c[t + 2]) v += 2;
      }
    }
    return v;
  }

  function aiChooseDiscard(player) {
    var o = countsOf(player.hand);
    var best = null, bestScore = -1e9;
    var seen = {};

    for (var i = 0; i < player.hand.length; i++) {
      var t = player.hand[i];
      if (t === WILD || seen[t]) continue;
      seen[t] = 1;

      var c = o.c.slice();
      c[t]--;
      var v = handValue(c, o.w, player.melds.length);

      var conn = 0;
      if (o.c[t] > 1) conn += 3;
      if (t < 27) {
        var r = t % 9;
        if (r > 0 && o.c[t - 1]) conn += 2;
        if (r < 8 && o.c[t + 1]) conn += 2;
        if (r > 1 && o.c[t - 2]) conn += 1;
        if (r < 7 && o.c[t + 2]) conn += 1;
      }
      var score = v * 10 - conn + (t >= 27 ? 0.5 : 0) + Math.random() * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best === null) best = player.hand[player.hand.length - 1];
    return best;
  }

  window.MahjongEngine = {
    WILD: WILD,
    HONORS: HONORS,
    FLOWER_NAMES: FLOWER_NAMES,
    WINDS: WINDS,
    BOT_NAMES: BOT_NAMES,
    CN_NUM: CN_NUM,
    isFlower: isFlower,
    isWild: isWild,
    isHonor: isHonor,
    isSuit: isSuit,
    tileName: tileName,
    tileSuit: tileSuit,
    faceSVG: faceSVG,
    tileHTML: tileHTML,
    backHTML: backHTML,
    countsOf: countsOf,
    canWinHand: canWinHand,
    canWinWithTile: canWinWithTile,
    analyzeTing: analyzeTing,
    findChiOptions: findChiOptions,
    findKongs: findKongs,
    aiChooseDiscard: aiChooseDiscard
  };
})();
