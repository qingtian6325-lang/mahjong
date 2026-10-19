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

  /* ================= Traditional Authentic Tile Art (Matching Reference Set) ================= */
  var NAVY = '#1b2d69';   // Traditional cobalt / navy blue
  var RED = '#c0392b';    // Vermilion / crimson red
  var GREEN = '#1b7a43';  // Jade green
  var GOLD = '#d4af37';   // Imperial gold
  var SERIF = "'KaiTi', 'STKaiti', 'Kaiti SC', 'SimSun', serif";

  // Concentric target dot for 筒子 (Pins / Dots)
  function concentricDot(x, y, r, color) {
    var r1 = r;
    var r2 = (r * 0.58).toFixed(1);
    var r3 = (r * 0.25).toFixed(1);
    var sw1 = (r * 0.28).toFixed(1);
    var sw2 = (r * 0.16).toFixed(1);
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r1 + '" fill="none" stroke="' + color + '" stroke-width="' + sw1 + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + r2 + '" fill="none" stroke="' + color + '" stroke-width="' + sw2 + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + r3 + '" fill="' + color + '"/>';
  }

  // 1筒: Ornate concentric rosette mandala
  function rosette1Tong() {
    return '<g transform="translate(20,28)">' +
      '<circle cx="0" cy="0" r="14.8" fill="none" stroke="' + GREEN + '" stroke-width="2.2"/>' +
      '<circle cx="0" cy="0" r="13.2" fill="none" stroke="' + GREEN + '" stroke-width="0.8" stroke-dasharray="2 1.4"/>' +
      '<circle cx="0" cy="0" r="10.2" fill="none" stroke="' + RED + '" stroke-width="2.6"/>' +
      '<circle cx="0" cy="0" r="8.2" fill="none" stroke="' + RED + '" stroke-width="0.8" stroke-dasharray="1.5 1.5"/>' +
      '<circle cx="0" cy="0" r="5.6" fill="none" stroke="' + GREEN + '" stroke-width="1.8"/>' +
      '<circle cx="0" cy="0" r="3.2" fill="' + RED + '"/>' +
      '<circle cx="0" cy="0" r="1.2" fill="#ffffff"/>' +
      '</g>';
  }

  // Notched authentic bamboo stick for 条子 (Bamboos)
  function bambooStick(x, y, color, scale, angle) {
    var tr = 'translate(' + x + ',' + y + ')';
    if (scale && scale !== 1) tr += ' scale(' + scale + ')';
    if (angle) tr += ' rotate(' + angle + ')';
    return '<g transform="' + tr + '">' +
      '<path d="M-2.2 -6.2 C-2.4 -4.5, -2.8 -2.2, -1.8 -0.6 C-1.3 0, -1.3 0, -1.8 0.6 C-2.8 2.2, -2.4 4.5, -2.2 6.2 C-1.3 7, 1.3 7, 2.2 6.2 C2.4 4.5, 2.8 2.2, 1.8 0.6 C1.3 0, 1.3 0, 1.8 -0.6 C2.8 -2.2, 2.4 -4.5, 2.2 -6.2 C1.3 -7, -1.3 -7, -2.2 -6.2 Z" fill="' + color + '"/>' +
      '<line x1="-1.8" y1="0" x2="1.8" y2="0" stroke="rgba(0,0,0,0.3)" stroke-width="0.8"/>' +
      '<line x1="-0.7" y1="-5.5" x2="-0.7" y2="5.5" stroke="rgba(255,255,255,0.45)" stroke-width="0.7"/>' +
      '</g>';
  }

  // 1条: Authentic Chinese Sparrow / Peacock (幺鸡)
  function bird1Tiao() {
    return '<g transform="translate(20, 27) scale(0.92)">' +
      // Branch perch
      '<path d="M -15 10 L 15 10" stroke="' + GREEN + '" stroke-width="2.4" stroke-linecap="round"/>' +
      '<line x1="-8" y1="10" x2="-6" y2="13" stroke="' + GREEN + '" stroke-width="1.5"/>' +
      // Red feet
      '<line x1="-3" y1="5" x2="-5" y2="10" stroke="' + RED + '" stroke-width="1.8"/>' +
      '<line x1="2" y1="5" x2="4" y2="10" stroke="' + RED + '" stroke-width="1.8"/>' +
      // Long sweeping tail feathers
      '<path d="M -2 7 C -7 14, -13 18, -14 24 C -11 21, -6 16, 0 8" fill="' + GREEN + '"/>' +
      '<path d="M 1 6 C 0 14, 2 20, 3 25 C 2 19, 2 13, 3 7" fill="' + NAVY + '"/>' +
      '<path d="M -7 18 C -11 22, -14 25, -15 26 C -12 24, -8 20, -5 16" fill="' + RED + '"/>' +
      // Breast & body
      '<path d="M -7 -4 C -8 3, -4 7, 1 7 C 6 7, 9 3, 7 -4 Z" fill="' + NAVY + '"/>' +
      '<path d="M -6 -1 C -3 2, 2 3, 6 0" fill="none" stroke="#ffffff" stroke-width="1.2"/>' +
      '<path d="M -5 3 C -2 5, 2 5, 5 3" fill="none" stroke="#ffffff" stroke-width="1.2"/>' +
      // Green wing back
      '<path d="M -1 -6 C 6 -8, 12 -4, 10 3 C 8 8, 3 8, 0 5 Z" fill="' + GREEN + '"/>' +
      '<path d="M 2 -3 C 6 -3, 8 0, 7 4" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>' +
      // Head & eye
      '<circle cx="-4" cy="-8" r="4.5" fill="' + NAVY + '"/>' +
      '<circle cx="-5.5" cy="-8.5" r="1.3" fill="#ffffff"/>' +
      '<circle cx="-5.8" cy="-8.5" r="0.6" fill="#000000"/>' +
      // Red beak
      '<polygon points="-8,-9.5 -13,-8 -8,-6.5" fill="' + RED + '"/>' +
      // Red comb
      '<path d="M -3 -12 C -5 -15, -8 -13, -7 -10 C -8 -10, -9 -11, -8 -9 Z" fill="' + RED + '"/>' +
      '</g>';
  }

  // 8条: Authentic M-shape curved bamboo shoots (青八条)
  function stems8Tiao() {
    return (
      // Top M
      bambooStick(10.5, 18, GREEN, 0.82, 28) +
      bambooStick(17, 13, GREEN, 0.82, -28) +
      bambooStick(23, 13, GREEN, 0.82, 28) +
      bambooStick(29.5, 18, GREEN, 0.82, -28) +
      // Bottom M
      bambooStick(10.5, 39, GREEN, 0.82, 28) +
      bambooStick(17, 34, GREEN, 0.82, -28) +
      bambooStick(23, 34, GREEN, 0.82, 28) +
      bambooStick(29.5, 39, GREEN, 0.82, -28)
    );
  }

  // Flower / Season Tile SVG (35 - 42)
  function flowerTileSVG(t) {
    var idx = t - 35; // 0 to 7
    var names = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'];
    var numChars = ['一', '二', '三', '四', '1', '2', '3', '4'];
    var name = names[idx];
    var num = numChars[idx];
    var isSeason = idx < 4;
    var badgeCol = isSeason ? RED : NAVY;

    var out = '';
    // Top Numeral & Name Badge
    out += '<text x="9" y="14" font-size="12" font-weight="900" fill="' + badgeCol + '" font-family="' + SERIF + '">' + num + '</text>';
    out += '<rect x="23" y="5" width="13" height="12" rx="3" fill="' + badgeCol + '" opacity="0.12"/>';
    out += '<text x="29.5" y="14.5" text-anchor="middle" font-size="9.5" font-weight="bold" fill="' + badgeCol + '" font-family="' + SERIF + '">' + name + '</text>';

    // Beautiful Botanical Illustration in Center
    if (idx === 0) { // 春 (Spring Plum)
      out += '<g transform="translate(20,35)">' +
        '<path d="M -6 16 Q -2 4 4 -6 Q 6 -10 10 -14" stroke="' + NAVY + '" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
        '<circle cx="-2" cy="2" r="4.5" fill="' + RED + '"/>' +
        '<circle cx="-2" cy="2" r="1.5" fill="#f5cd79"/>' +
        '<circle cx="6" cy="-4" r="3.6" fill="' + RED + '"/>' +
        '<circle cx="6" cy="-4" r="1.2" fill="#f5cd79"/>' +
        '<path d="M 2 8 Q 8 6 10 0" stroke="' + GREEN + '" stroke-width="1.5" fill="none"/>' +
        '</g>';
    } else if (idx === 1) { // 夏 (Summer Lotus)
      out += '<g transform="translate(20,35)">' +
        '<path d="M 0 16 L 0 -2" stroke="' + GREEN + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M 0 -2 C -7 -6, -9 -14, 0 -16 C 9 -14, 7 -6, 0 -2 Z" fill="' + RED + '"/>' +
        '<path d="M -4 -4 C -11 -6, -11 -12, -4 -13" fill="none" stroke="' + RED + '" stroke-width="1.5"/>' +
        '<path d="M 4 -4 C 11 -6, 11 -12, 4 -13" fill="none" stroke="' + RED + '" stroke-width="1.5"/>' +
        '<ellipse cx="-6" cy="10" rx="6" ry="2.5" fill="' + GREEN + '"/>' +
        '</g>';
    } else if (idx === 2) { // 秋 (Autumn Chrysanthemum)
      out += '<g transform="translate(20,35)">' +
        '<path d="M 0 16 Q -4 6 2 -2" stroke="' + NAVY + '" stroke-width="1.8" fill="none"/>' +
        '<circle cx="2" cy="-6" r="7" fill="' + RED + '"/>' +
        '<circle cx="2" cy="-6" r="4.5" fill="#e67e22"/>' +
        '<circle cx="2" cy="-6" r="2.2" fill="#f1c40f"/>' +
        '<path d="M -2 6 C -8 4, -8 0, -4 0" fill="' + GREEN + '"/>' +
        '<path d="M 3 4 C 9 2, 9 -2, 5 -2" fill="' + GREEN + '"/>' +
        '</g>';
    } else if (idx === 3) { // 冬 (Winter Pine / Bamboo)
      out += '<g transform="translate(20,35)">' +
        '<path d="M -4 16 L -4 -12" stroke="' + GREEN + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '<path d="M 5 16 L 5 -8" stroke="' + GREEN + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M -4 4 Q -12 2 -10 -4" stroke="' + GREEN + '" stroke-width="1.5" fill="none"/>' +
        '<path d="M -4 -4 Q -12 -6 -10 -12" stroke="' + GREEN + '" stroke-width="1.5" fill="none"/>' +
        '<path d="M 5 2 Q 13 0 11 -6" stroke="' + GREEN + '" stroke-width="1.5" fill="none"/>' +
        '</g>';
    } else if (idx === 4) { // 梅 (Plum Flower)
      out += '<g transform="translate(20,35)">' +
        '<path d="M -8 16 Q 0 4 6 -8" stroke="' + NAVY + '" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
        '<circle cx="4" cy="-8" r="5" fill="' + RED + '"/>' +
        '<circle cx="-3" cy="2" r="4.2" fill="' + RED + '"/>' +
        '<circle cx="4" cy="-8" r="1.5" fill="#ffd32a"/>' +
        '<circle cx="-3" cy="2" r="1.3" fill="#ffd32a"/>' +
        '<path d="M 3 6 Q 10 4 8 -1" stroke="' + GREEN + '" stroke-width="1.5" fill="none"/>' +
        '</g>';
    } else if (idx === 5) { // 兰 (Orchid)
      out += '<g transform="translate(20,35)">' +
        '<path d="M -6 16 Q -2 6 2 -2" stroke="' + GREEN + '" stroke-width="1.8" fill="none"/>' +
        '<path d="M 2 -2 C -5 -6, -6 -14, 2 -16 C 10 -14, 9 -6, 2 -2 Z" fill="' + NAVY + '"/>' +
        '<circle cx="2" cy="-9" r="2" fill="' + RED + '"/>' +
        '<path d="M -8 16 C -12 6, -6 -6, 2 -8" stroke="' + GREEN + '" stroke-width="1.4" fill="none"/>' +
        '<path d="M -2 16 C 8 8, 12 -2, 8 -12" stroke="' + GREEN + '" stroke-width="1.4" fill="none"/>' +
        '</g>';
    } else if (idx === 6) { // 竹 (Bamboo)
      out += '<g transform="translate(20,35)">' +
        '<path d="M -3 16 L -3 -14" stroke="' + GREEN + '" stroke-width="2.6" stroke-linecap="round"/>' +
        '<line x1="-5" y1="2" x2="-1" y2="2" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>' +
        '<line x1="-5" y1="-6" x2="-1" y2="-6" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>' +
        '<path d="M 5 16 L 5 -6" stroke="' + GREEN + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M -3 -6 Q -11 -8 -10 -14 Q -6 -10 -3 -7" fill="' + GREEN + '"/>' +
        '<path d="M -3 2 Q -11 0 -9 -6 Q -5 -2 -3 1" fill="' + GREEN + '"/>' +
        '<path d="M 5 2 Q 13 0 11 -6 Q 7 -2 5 1" fill="' + GREEN + '"/>' +
        '</g>';
    } else if (idx === 7) { // 菊 (Chrysanthemum)
      out += '<g transform="translate(20,35)">' +
        '<path d="M 0 16 L 0 4" stroke="' + GREEN + '" stroke-width="2"/>' +
        '<circle cx="0" cy="-4" r="8" fill="' + RED + '"/>' +
        '<circle cx="0" cy="-4" r="5.5" fill="#f39c12"/>' +
        '<circle cx="0" cy="-4" r="3" fill="#f1c40f"/>' +
        '<path d="M -2 10 C -8 8, -9 2, -4 4" fill="' + GREEN + '"/>' +
        '<path d="M 2 8 C 8 6, 9 0, 4 2" fill="' + GREEN + '"/>' +
        '</g>';
    }

    return out;
  }

  function faceSVG(t) {
    var s = '<svg viewBox="0 0 40 56" class="tile-face-svg" aria-hidden="true">';

    // 1. 飞牌 (Wild Tile - 34)
    if (t === WILD) {
      return s +
        '<defs>' +
        '<linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#fff099"/><stop offset="50%" stop-color="#e5a91e"/><stop offset="100%" stop-color="#9e6d04"/>' +
        '</linearGradient>' +
        '</defs>' +
        '<rect x="2" y="2" width="36" height="52" rx="3.5" fill="none" stroke="url(#goldGrad)" stroke-width="1.6" stroke-dasharray="3 1.5"/>' +
        '<text x="20" y="36" text-anchor="middle" font-size="28" font-weight="900" fill="' + RED + '" font-family="' + SERIF + '">飛</text>' +
        '<rect x="8" y="42" width="24" height="9" rx="4.5" fill="#f5c242"/>' +
        '<text x="20" y="49" text-anchor="middle" font-size="7.5" font-weight="900" fill="#5c3800">万能</text>' +
        '</svg>';
    }

    // 2. 花牌 (Flowers - 35 to 42)
    if (isFlower(t)) {
      return s + flowerTileSVG(t) + '</svg>';
    }

    // 3. 万子 (Wan - 0 to 8)
    if (t < 9) {
      var wanNum = ['一', '二', '三', '四', '伍', '六', '七', '八', '九'][t];
      return s +
        '<text x="20" y="24" text-anchor="middle" font-size="19" font-weight="900" fill="' + NAVY + '" font-family="' + SERIF + '">' + wanNum + '</text>' +
        '<text x="20" y="47" text-anchor="middle" font-size="20" font-weight="900" fill="' + RED + '" font-family="' + SERIF + '">萬</text>' +
        '</svg>';
    }

    // 4. 条子 (Bamboo / Sou - 9 to 17)
    if (t < 18) {
      var n = t - 8;
      if (n === 1) { // 1条: 幺鸡神鸟
        return s + bird1Tiao() + '</svg>';
      }
      if (n === 2) {
        return s + bambooStick(20, 17, GREEN) + bambooStick(20, 39, GREEN) + '</svg>';
      }
      if (n === 3) {
        return s + bambooStick(20, 15, GREEN) + bambooStick(13, 38, GREEN) + bambooStick(27, 38, GREEN) + '</svg>';
      }
      if (n === 4) {
        return s +
          bambooStick(13, 17, GREEN) + bambooStick(27, 17, GREEN) +
          bambooStick(13, 39, GREEN) + bambooStick(27, 39, GREEN) +
          '</svg>';
      }
      if (n === 5) { // 4 green corners + 1 RED center
        return s +
          bambooStick(13, 16, GREEN) + bambooStick(27, 16, GREEN) +
          bambooStick(20, 28, RED) +
          bambooStick(13, 40, GREEN) + bambooStick(27, 40, GREEN) +
          '</svg>';
      }
      if (n === 6) { // 3 top green, 3 bottom green
        return s +
          bambooStick(12, 17, GREEN) + bambooStick(20, 17, GREEN) + bambooStick(28, 17, GREEN) +
          bambooStick(12, 39, GREEN) + bambooStick(20, 39, GREEN) + bambooStick(28, 39, GREEN) +
          '</svg>';
      }
      if (n === 7) { // 1 RED top, 6 green below (3 middle, 3 bottom)
        return s +
          bambooStick(20, 13, RED) +
          bambooStick(12, 28, GREEN) + bambooStick(20, 28, GREEN) + bambooStick(28, 28, GREEN) +
          bambooStick(12, 43, GREEN) + bambooStick(20, 43, GREEN) + bambooStick(28, 43, GREEN) +
          '</svg>';
      }
      if (n === 8) { // 两个 M 形双弯八条 (青八条)
        return s + stems8Tiao() + '</svg>';
      }
      if (n === 9) { // 3 green left, 3 RED middle, 3 green right
        return s +
          bambooStick(12, 14, GREEN) + bambooStick(12, 28, GREEN) + bambooStick(12, 42, GREEN) +
          bambooStick(20, 14, RED) + bambooStick(20, 28, RED) + bambooStick(20, 42, RED) +
          bambooStick(28, 14, GREEN) + bambooStick(28, 28, GREEN) + bambooStick(28, 42, GREEN) +
          '</svg>';
      }
    }

    // 5. 筒子 (Dots / Pin - 18 to 26)
    if (t < 27) {
      var n2 = t - 17;
      if (n2 === 1) { // 1筒: 大饼曼陀罗同心圆
        return s + rosette1Tong() + '</svg>';
      }
      if (n2 === 2) { // 2筒: 垂直绿+蓝
        return s + concentricDot(20, 16, 6.4, GREEN) + concentricDot(20, 40, 6.4, NAVY) + '</svg>';
      }
      if (n2 === 3) { // 3筒: 对角绿、红、蓝
        return s + concentricDot(11, 13, 5.2, GREEN) + concentricDot(20, 28, 5.2, RED) + concentricDot(29, 43, 5.2, NAVY) + '</svg>';
      }
      if (n2 === 4) { // 4筒: 蓝绿/绿蓝
        return s +
          concentricDot(13, 16, 5.2, NAVY) + concentricDot(27, 16, 5.2, GREEN) +
          concentricDot(13, 40, 5.2, GREEN) + concentricDot(27, 40, 5.2, NAVY) +
          '</svg>';
      }
      if (n2 === 5) { // 5筒: 4角 + 红中心
        return s +
          concentricDot(12, 15, 4.8, NAVY) + concentricDot(28, 15, 4.8, GREEN) +
          concentricDot(20, 28, 5.8, RED) +
          concentricDot(12, 41, 4.8, GREEN) + concentricDot(28, 41, 4.8, NAVY) +
          '</svg>';
      }
      if (n2 === 6) { // 6筒: 上2绿，下4红
        return s +
          concentricDot(13, 14, 4.8, GREEN) + concentricDot(27, 14, 4.8, GREEN) +
          concentricDot(13, 29, 4.8, RED) + concentricDot(27, 29, 4.8, RED) +
          concentricDot(13, 43, 4.8, RED) + concentricDot(27, 43, 4.8, RED) +
          '</svg>';
      }
      if (n2 === 7) { // 7筒: 上3斜绿，下4红
        return s +
          concentricDot(11, 12, 4.2, GREEN) + concentricDot(20, 17, 4.2, GREEN) + concentricDot(29, 22, 4.2, GREEN) +
          concentricDot(13, 34, 4.5, RED) + concentricDot(27, 34, 4.5, RED) +
          concentricDot(13, 46, 4.5, RED) + concentricDot(27, 46, 4.5, RED) +
          '</svg>';
      }
      if (n2 === 8) { // 8筒: 全蓝 (2列各4)
        return s +
          concentricDot(13, 11, 4.2, NAVY) + concentricDot(13, 22, 4.2, NAVY) +
          concentricDot(13, 33, 4.2, NAVY) + concentricDot(13, 44, 4.2, NAVY) +
          concentricDot(27, 11, 4.2, NAVY) + concentricDot(27, 22, 4.2, NAVY) +
          concentricDot(27, 33, 4.2, NAVY) + concentricDot(27, 44, 4.2, NAVY) +
          '</svg>';
      }
      if (n2 === 9) { // 9筒: 上3绿，中3红，下3蓝
        return s +
          concentricDot(11, 13, 4.2, GREEN) + concentricDot(20, 13, 4.2, GREEN) + concentricDot(29, 13, 4.2, GREEN) +
          concentricDot(11, 28, 4.2, RED) + concentricDot(20, 28, 4.2, RED) + concentricDot(29, 28, 4.2, RED) +
          concentricDot(11, 43, 4.2, NAVY) + concentricDot(20, 43, 4.2, NAVY) + concentricDot(29, 43, 4.2, NAVY) +
          '</svg>';
      }
    }

    // 6. 字牌 (Honors - 27 to 33)
    var h = t - 27;
    // 31: 中 (红)
    if (h === 4) {
      return s + '<text x="20" y="38" text-anchor="middle" font-size="28" font-weight="900" fill="' + RED + '" font-family="' + SERIF + '">中</text></svg>';
    }
    // 32: 發 (绿)
    if (h === 5) {
      return s + '<text x="20" y="38" text-anchor="middle" font-size="28" font-weight="900" fill="' + GREEN + '" font-family="' + SERIF + '">發</text></svg>';
    }
    // 33: 白 / 白板 (深蓝双线框)
    if (h === 6) {
      return s +
        '<rect x="8" y="9" width="24" height="38" rx="3.5" fill="none" stroke="' + NAVY + '" stroke-width="2"/>' +
        '<rect x="11.5" y="12.5" width="17" height="31" rx="2" fill="none" stroke="' + NAVY + '" stroke-width="1"/>' +
        '</svg>';
    }
    // 27: 東, 28: 南, 29: 西, 30: 北 (深蓝书法体)
    var windChars = ['東', '南', '西', '北'];
    return s + '<text x="20" y="38" text-anchor="middle" font-size="28" font-weight="900" fill="' + NAVY + '" font-family="' + SERIF + '">' + windChars[h] + '</text></svg>';
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
