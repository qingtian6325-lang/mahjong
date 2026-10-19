/**
 * Mahjong App Controller & UI Renderer
 * Handles Game State, Turn Cycle, 15s Countdown, Ting Assistant,
 * 3D Tile Rendering, Action Bar, SFX, Quick Chat, and Multiplayer Sync.
 */
(function() {
  'use strict';

  var Engine = window.MahjongEngine;
  var Audio = window.MahjongAudio;
  var Network = window.MahjongNetwork;

  var MODE = 'single'; // 'single' | 'host' | 'guest'
  var ME = 0;          // absolute seat index (0..3)
  var VIEW = 0;        // viewing rotation so ME is always at bottom

  function screenPos(absSeat) {
    return (absSeat - VIEW + 4) % 4; // 0: bottom, 1: right, 2: top, 3: left
  }

  function absSeatAt(pos) {
    return (pos + VIEW) % 4;
  }

  var S = null; // Game state
  var timerInterval = null;
  var timerRemaining = 15;

  /* ================= Initialization ================= */
  window.addEventListener('DOMContentLoaded', function() {
    initUI();
    checkURLRoom();
  });

  function checkURLRoom() {
    var params = new URLSearchParams(window.location.search);
    var room = params.get('room');
    if (room) {
      var code = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (code.length === 4) {
        document.getElementById('inputJoinCode').value = code;
        showModal('modalJoin');
      }
    }
  }

  function singleSpec() {
    return [
      { name: '你', ctrl: 'local', av: '你' },
      { name: Engine.BOT_NAMES[0], ctrl: 'bot', av: '强' },
      { name: Engine.BOT_NAMES[1], ctrl: 'bot', av: '美' },
      { name: Engine.BOT_NAMES[2], ctrl: 'bot', av: '王' }
    ];
  }

  function startNewGame(spec) {
    spec = spec || singleSpec();
    S = {
      gen: (S ? S.gen + 1 : 1),
      round: (S && S.round ? S.round : 1),
      dealer: 0,
      scores: (S && S.scores ? S.scores : [0, 0, 0, 0]),
      lastDeltas: null,
      history: (S && S.history ? S.history : []),
      wall: [],
      players: [],
      current: -1,
      lastDiscard: null,
      over: false,
      selectedTile: null,
      tingMap: {},
      pendingWait: null,
      spec: spec
    };
    startRound();
  }

  function startRound() {
    var wall = [];
    for (var t = 0; t < 34; t++) for (var n = 0; n < 4; n++) wall.push(t);
    for (var wI = 0; wI < 4; wI++) wall.push(Engine.WILD);
    for (var f = 35; f <= 42; f++) wall.push(f);

    // Fisher-Yates shuffle
    for (var i = wall.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = wall[i]; wall[i] = wall[j]; wall[j] = tmp;
    }

    S.wall = wall;
    S.over = false;
    S.lastDiscard = null;
    S.lastDeltas = null;
    S.selectedTile = null;

    S.players = S.spec.map(function(sp) {
      return {
        name: sp.name,
        isBot: sp.ctrl === 'bot',
        ctrl: sp.ctrl,
        clientId: sp.clientId || null,
        online: sp.online !== false,
        av: sp.av || sp.name.charAt(0),
        hand: [],
        melds: [],
        flowers: [],
        flowerKong: [false, false],
        discards: [],
        lastDrawn: null,
        guoshui: false
      };
    });

    // Deal 13 tiles to each player
    for (var p = 0; p < 4; p++) {
      for (var d = 0; d < 13; d++) S.players[p].hand.push(S.wall.shift());
    }

    // Flower replacement at deal
    for (var p2 = 0; p2 < 4; p2++) {
      var pl = S.players[p2];
      var guard = 0;
      while (pl.hand.some(Engine.isFlower) && S.wall.length && guard++ < 24) {
        var fi = pl.hand.findIndex(Engine.isFlower);
        pl.flowers.push(pl.hand.splice(fi, 1)[0]);
        pl.hand.push(S.wall.pop());
      }
      sortHand(pl);
      checkFlowerSettle(p2, true); // Deal-time flower kong (天花杠: 4 from each)
    }

    showToast('第 ' + S.round + ' 局开始，' + S.players[S.dealer].name + ' 坐庄');
    render();

    if (MODE !== 'guest') {
      runTurnLoop(S.gen);
    }
  }

  function sortHand(p) {
    p.hand.sort(function(a, b) { return a - b; });
  }

  /* ================= Turn Cycle Engine ================= */
  async function runTurnLoop(gen) {
    var cur = S.dealer;
    var skip = false; // false | true (after chi/pon) | 'kong'

    while (gen === S.gen && !S.over) {
      if (S.wall.length === 0) {
        endRoundDraw();
        return;
      }
      var r = await doTurn(cur, skip, gen);
      if (gen !== S.gen || S.over) return;
      if (r.end) return;
      cur = r.next;
      skip = r.skip;
    }
  }

  async function doTurn(pIdx, skip, gen) {
    var p = S.players[pIdx];
    S.current = pIdx;
    startTurnTimer(pIdx);

    // 1. Draw Phase
    if (skip === 'kong') {
      await sleep(p.isBot ? 800 : 50);
      if (drawTile(pIdx, true) === null) { endRoundDraw(); return { end: true }; }
    } else if (!skip) {
      await sleep(p.isBot ? 800 : 50);
      if (drawTile(pIdx, false) === null) { endRoundDraw(); return { end: true }; }
    }
    render();

    // 2. Action / Discard Phase
    var discardResult;
    while (true) {
      if (gen !== S.gen) return { end: true };

      if (!p.isBot && p.ctrl === 'local') {
        discardResult = await humanTurnAction(pIdx, gen);
      } else if (p.ctrl === 'remote' && MODE === 'host') {
        discardResult = await remoteTurnAction(pIdx, gen);
      } else {
        // Bot turn
        await sleep(700);
        discardResult = botTurnDecision(p);
      }

      if (gen !== S.gen) return { end: true };

      if (discardResult.type === 'tsumo') {
        // Self-draw Win!
        endRoundWin(pIdx, pIdx, true);
        return { end: true };
      } else if (discardResult.type === 'kong') {
        // Kong performed on own turn (暗杠 or 补杠)
        executeOwnKong(pIdx, discardResult.kong);
        render();
        // Kong gives replacement tile from wall tail
        return { next: pIdx, skip: 'kong' };
      } else if (discardResult.type === 'discard') {
        break;
      }
    }

    stopTurnTimer();

    // 3. Discard execution
    var dTile = discardResult.tile;
    removeFromHand(p, dTile, 1);
    p.lastDrawn = null;
    sortHand(p);
    p.discards.push(dTile);
    S.lastDiscard = { seat: pIdx, tile: dTile };

    Audio.playTileDrop();
    render();

    // 4. Claims from other players (吃 / 碰 / 杠 / 胡)
    var claimRes = await processClaims(pIdx, dTile, gen);
    if (gen !== S.gen || S.over) return { end: true };
    if (claimRes) return claimRes;

    // Normal next player: clockwise (downstream = (pIdx + 1) % 4)
    return { next: (pIdx + 1) % 4, skip: false };
  }

  function drawTile(pIdx, fromTail) {
    var p = S.players[pIdx];
    if (!S.wall.length) return null;
    var t = fromTail ? S.wall.pop() : S.wall.shift();

    var guard = 0;
    while (Engine.isFlower(t) && guard++ < 20) {
      p.flowers.push(t);
      checkFlowerSettle(pIdx, false);
      showToast(p.name + ' 补花【' + Engine.tileName(t) + '】');
      if (!S.wall.length) return null;
      t = S.wall.pop();
    }

    p.hand.push(t);
    p.lastDrawn = t;
    p.guoshui = false; // drawing tile clears over-water (过水解除)

    if (pIdx === ME) {
      Audio.playTileClick();
    }
    return t;
  }

  function removeFromHand(p, tile, count) {
    var n = count || 1;
    for (var i = 0; i < n; i++) {
      var idx = p.hand.indexOf(tile);
      if (idx >= 0) p.hand.splice(idx, 1);
    }
    if (p.lastDrawn === tile && p.hand.indexOf(tile) < 0) {
      p.lastDrawn = null;
    }
  }

  /* ================= Kong & Flower Settlements ================= */
  function settleInstant(pIdx, perPlayer, label) {
    var deltas = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) {
      if (i !== pIdx) {
        deltas[i] = -perPlayer;
        deltas[pIdx] += perPlayer;
      }
    }
    for (var s = 0; s < 4; s++) S.scores[s] += deltas[s];
    S.lastDeltas = deltas;
    S.history.push({ round: S.round, label: S.players[pIdx].name + ' ' + label, deltas: deltas.slice() });

    showVFX(label.indexOf('花') >= 0 ? '花杠' : '杠');
    Audio.playGang();
    showToast(S.players[pIdx].name + ' ' + label + '，每家给 ' + perPlayer + ' 分');
    render();
  }

  function checkFlowerSettle(pIdx, atDeal) {
    var p = S.players[pIdx];
    if (!p) return;
    for (var g = 0; g < 2; g++) {
      if (p.flowerKong[g]) continue;
      var base = 35 + g * 4;
      var ok = true;
      for (var k = 0; k < 4; k++) {
        if (p.flowers.indexOf(base + k) < 0) { ok = false; break; }
      }
      if (ok) {
        p.flowerKong[g] = true;
        settleInstant(pIdx, atDeal ? 4 : 2, atDeal ? '天花杠' : '花杠');
      }
    }
  }

  function executeOwnKong(pIdx, kong) {
    var p = S.players[pIdx];
    if (kong.kind === 'concealed') {
      removeFromHand(p, kong.tile, 4);
      p.melds.push({ kind: 'concealed', tiles: [kong.tile, kong.tile, kong.tile, kong.tile] });
      settleInstant(pIdx, 4, '暗杠');
    } else if (kong.kind === 'added') {
      removeFromHand(p, kong.tile, 1);
      for (var i = 0; i < p.melds.length; i++) {
        if (p.melds[i].kind === 'pon' && p.melds[i].tiles[0] === kong.tile) {
          p.melds[i].kind = 'kong';
          p.melds[i].tiles.push(kong.tile);
          break;
        }
      }
      settleInstant(pIdx, 2, '补杠');
    }
  }

  /* ================= Discard Claims (吃 / 碰 / 杠 / 胡) ================= */
  async function processClaims(discarder, tile, gen) {
    var promises = [];
    var responders = [];

    for (var i = 1; i <= 3; i++) {
      var seat = (discarder + i) % 4;
      var pl = S.players[seat];

      var canHu = !pl.guoshui && Engine.canWinWithTile(pl.hand, pl.melds.length, tile);
      var canPeng = pl.hand.filter(function(x) { return x === tile; }).length >= 2;
      var canGang = pl.hand.filter(function(x) { return x === tile; }).length >= 3 && S.wall.length > 0;
      var canChi = (i === 1) && (Engine.findChiOptions(pl.hand, tile).length > 0);

      if (canHu || canPeng || canGang || canChi) {
        responders.push(seat);
        promises.push(askClaim(seat, {
          canHu: canHu, canPeng: canPeng, canGang: canGang, canChi: canChi,
          tile: tile, from: discarder
        }, gen));
      }
    }

    if (promises.length === 0) return null;

    var answers = await Promise.all(promises);
    if (gen !== S.gen || S.over) return null;

    // Priority 1: Hu (胡)
    for (var h = 0; h < answers.length; h++) {
      if (answers[h].act === 'hu') {
        endRoundWin(responders[h], discarder, false);
        return { end: true };
      }
    }

    // Priority 2: Kong (杠) or Peng (碰)
    for (var kp = 0; kp < answers.length; kp++) {
      var ans = answers[kp];
      var s = responders[kp];
      var pObj = S.players[s];

      if (ans.act === 'gang') {
        removeFromHand(pObj, tile, 3);
        pObj.melds.push({ kind: 'kong', tiles: [tile, tile, tile, tile], from: discarder });
        pObj.discards = pObj.discards || [];
        settleInstant(s, 2, '明杠');
        return { next: s, skip: 'kong' };
      } else if (ans.act === 'peng') {
        removeFromHand(pObj, tile, 2);
        pObj.melds.push({ kind: 'pon', tiles: [tile, tile, tile], from: discarder });
        showVFX('碰');
        Audio.playPeng();
        return { next: s, skip: true };
      }
    }

    // Priority 3: Chi (吃) - left player only
    for (var c = 0; c < answers.length; c++) {
      if (answers[c].act === 'chi' && answers[c].meld) {
        var cs = responders[c];
        var cp = S.players[cs];
        var mTiles = answers[c].meld;
        // remove the two tiles from hand
        var toRemove = mTiles.slice();
        var tIdx = toRemove.indexOf(tile);
        if (tIdx >= 0) toRemove.splice(tIdx, 1);
        toRemove.forEach(function(t) { removeFromHand(cp, t, 1); });
        cp.melds.push({ kind: 'chi', tiles: mTiles, from: discarder });
        showVFX('吃');
        Audio.playChi();
        return { next: cs, skip: true };
      }
    }

    // Pass: record over-water (过水) if player passed on Hu
    for (var p = 0; p < answers.length; p++) {
      if (answers[p].couldHu && answers[p].act === 'pass') {
        S.players[responders[p]].guoshui = true;
      }
    }

    return null;
  }

  function askClaim(seat, options, gen) {
    var p = S.players[seat];
    if (p.isBot) {
      return new Promise(function(resolve) {
        setTimeout(function() {
          if (options.canHu) resolve({ act: 'hu' });
          else if (options.canGang && Math.random() < 0.8) resolve({ act: 'gang' });
          else if (options.canPeng && Math.random() < 0.6) resolve({ act: 'peng' });
          else resolve({ act: 'pass', couldHu: options.canHu });
        }, 500);
      });
    }

    if (p.ctrl === 'local') {
      return new Promise(function(resolve) {
        renderActionBar({
          canHu: options.canHu,
          canGang: options.canGang,
          canPeng: options.canPeng,
          canChi: options.canChi,
          tile: options.tile,
          onAction: function(act, data) {
            clearActionBar();
            resolve({ act: act, meld: data, couldHu: options.canHu });
          }
        });
      });
    }

    // Remote multiplayer player
    return new Promise(function(resolve) {
      // Handled via Supabase broadcast
      resolve({ act: 'pass' });
    });
  }

  /* ================= Turn Action Prompts ================= */
  function humanTurnAction(pIdx, gen) {
    return new Promise(function(resolve) {
      var p = S.players[pIdx];
      var canHu = Engine.canWinHand(p.hand, p.melds.length);
      var kongs = Engine.findKongs(p);

      updateTingAssistant(p);

      var actions = {
        canHu: canHu,
        kongs: kongs,
        onAction: function(type, kongObj) {
          clearActionBar();
          hideTingTooltip();
          if (type === 'hu') resolve({ type: 'tsumo' });
          else if (type === 'kong') resolve({ type: 'kong', kong: kongObj });
        }
      };

      if (canHu || kongs.length > 0) {
        renderOwnTurnActionBar(actions);
      }

      // Discard selection handler
      S.pendingDiscardResolve = function(tile) {
        clearActionBar();
        hideTingTooltip();
        S.pendingDiscardResolve = null;
        resolve({ type: 'discard', tile: tile });
      };
    });
  }

  function botTurnDecision(p) {
    if (Engine.canWinHand(p.hand, p.melds.length)) {
      return { type: 'tsumo' };
    }
    var kongs = Engine.findKongs(p);
    if (kongs.length && S.wall.length > 0) {
      return { type: 'kong', kong: kongs[0] };
    }
    return { type: 'discard', tile: Engine.aiChooseDiscard(p) };
  }

  /* ================= Round End & Scoring ================= */
  function endRoundWin(winnerSeat, loserSeat, isZimo) {
    S.over = true;
    stopTurnTimer();

    var deltas = [0, 0, 0, 0];
    var winName = S.players[winnerSeat].name;

    if (isZimo) {
      // Zimo: 4 from each other player (+12 total)
      for (var i = 0; i < 4; i++) {
        if (i !== winnerSeat) { deltas[i] = -4; deltas[winnerSeat] += 4; }
      }
      showVFX('自摸！');
      Audio.playZimo();
      showToast('🎉 ' + winName + ' 自摸胡牌！');
    } else {
      // Dian Pao: 4 from discarder, 2 from other two (+8 total)
      deltas[loserSeat] -= 4;
      deltas[winnerSeat] += 4;
      for (var j = 0; j < 4; j++) {
        if (j !== winnerSeat && j !== loserSeat) {
          deltas[j] -= 2;
          deltas[winnerSeat] += 2;
        }
      }
      showVFX('胡牌！');
      Audio.playHu();
      showToast('🎉 ' + winName + ' 胡牌！由 ' + S.players[loserSeat].name + ' 点炮');
    }

    for (var s = 0; s < 4; s++) S.scores[s] += deltas[s];
    S.lastDeltas = deltas;
    S.history.push({
      round: S.round,
      label: winName + (isZimo ? ' 自摸' : ' 点炮胡'),
      deltas: deltas.slice()
    });

    render();
    setTimeout(function() {
      showSettlementModal(winnerSeat, isZimo, deltas);
    }, 1200);
  }

  function endRoundDraw() {
    S.over = true;
    stopTurnTimer();
    showVFX('流局');
    showToast('牌墙已摸完，本局流局（不计分）');
    render();
    setTimeout(function() {
      showSettlementModal(-1, false, [0, 0, 0, 0]);
    }, 1200);
  }

  /* ================= 15s Turn Timer ================= */
  function startTurnTimer(seat) {
    stopTurnTimer();
    timerRemaining = 15;
    updateTimerUI(timerRemaining);

    timerInterval = setInterval(function() {
      timerRemaining--;
      if (timerRemaining <= 0) {
        stopTurnTimer();
        onTimerExpire(seat);
      } else {
        updateTimerUI(timerRemaining);
        if (timerRemaining <= 5 && seat === ME) {
          Audio.playTick();
        }
      }
    }, 1000);
  }

  function stopTurnTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerUI(sec) {
    var numEl = document.getElementById('timerNumber');
    var ringEl = document.getElementById('timerProgressRing');
    if (!numEl || !ringEl) return;

    numEl.textContent = sec;
    var totalCircumference = 314; // 2 * PI * 50
    var offset = totalCircumference * (1 - sec / 15);
    ringEl.style.strokeDashoffset = offset;

    if (sec <= 4) {
      numEl.className = 'timer-number urgent';
      ringEl.className = 'timer-ring-progress urgent';
    } else if (sec <= 8) {
      numEl.className = 'timer-number';
      ringEl.className = 'timer-ring-progress warning';
    } else {
      numEl.className = 'timer-number';
      ringEl.className = 'timer-ring-progress';
    }
  }

  function onTimerExpire(seat) {
    if (S.pendingDiscardResolve) {
      var pl = S.players[seat];
      var discardTile = Engine.aiChooseDiscard(pl);
      S.pendingDiscardResolve(discardTile);
    }
  }

  /* ================= Ting Assistant (听牌推荐) ================= */
  function updateTingAssistant(player) {
    var visibleCounts = getVisibleTileCounts();
    S.tingMap = Engine.analyzeTing(player.hand, player.melds.length, visibleCounts);
    renderHandTingBadges();
  }

  function getVisibleTileCounts() {
    var counts = {};
    if (!S) return counts;
    // Discard pools
    for (var i = 0; i < 4; i++) {
      var pl = S.players[i];
      if (!pl) continue;
      pl.discards.forEach(function(t) { counts[t] = (counts[t] || 0) + 1; });
      pl.melds.forEach(function(m) {
        m.tiles.forEach(function(t) { counts[t] = (counts[t] || 0) + 1; });
      });
      if (i === ME) {
        pl.hand.forEach(function(t) { counts[t] = (counts[t] || 0) + 1; });
      }
    }
    return counts;
  }

  function renderHandTingBadges() {
    var handContainer = document.getElementById('humanHandRow');
    if (!handContainer) return;
    var tileEls = handContainer.querySelectorAll('.mj-tile');

    tileEls.forEach(function(el) {
      var t = parseInt(el.getAttribute('data-tile'), 10);
      var oldBadge = el.querySelector('.ting-badge');
      if (oldBadge) oldBadge.remove();

      if (S.tingMap && S.tingMap[t]) {
        var badge = document.createElement('span');
        badge.className = 'ting-badge';
        badge.textContent = '听';
        el.appendChild(badge);
      }
    });
  }

  function showTingTooltip(tile) {
    var hintCard = document.getElementById('tingHintCard');
    if (!hintCard) return;

    if (!S.tingMap || !S.tingMap[tile]) {
      hintCard.style.display = 'none';
      return;
    }

    var winList = S.tingMap[tile];
    var totalRemaining = 0;
    var html = '<div class="ting-hint-title">打出此牌听：</div><div class="ting-hint-items">';

    winList.forEach(function(item) {
      totalRemaining += item.remaining;
      html += '<span class="ting-hint-pill">' + item.name + ' <b>' + item.remaining + '张</b></span>';
    });
    html += '<span style="color:var(--gold-light);font-size:12px;margin-left:4px;">(共 ' + totalRemaining + ' 张)</span></div>';

    hintCard.innerHTML = html;
    hintCard.style.display = 'flex';
  }

  function hideTingTooltip() {
    var hintCard = document.getElementById('tingHintCard');
    if (hintCard) hintCard.style.display = 'none';
  }

  /* ================= Action Bar Rendering ================= */
  function renderActionBar(opts) {
    var bar = document.getElementById('actionBar');
    if (!bar) return;
    bar.innerHTML = '';

    if (opts.canHu) {
      var huBtn = createActionBtn('胡', 'hu', function() { opts.onAction('hu'); });
      bar.appendChild(huBtn);
    }
    if (opts.canGang) {
      var gangBtn = createActionBtn('杠', 'gang', function() { opts.onAction('gang'); });
      bar.appendChild(gangBtn);
    }
    if (opts.canPeng) {
      var pengBtn = createActionBtn('碰', 'peng', function() { opts.onAction('peng'); });
      bar.appendChild(pengBtn);
    }
    if (opts.canChi) {
      var options = Engine.findChiOptions(S.players[ME].hand, opts.tile);
      var chiBtn = createActionBtn('吃', 'chi', function() {
        if (options.length === 1) {
          opts.onAction('chi', options[0]);
        } else {
          showChiChoicePopup(options, opts.onAction);
        }
      });
      bar.appendChild(chiBtn);
    }

    var passBtn = createActionBtn('过', 'pass', function() { opts.onAction('pass'); });
    bar.appendChild(passBtn);
  }

  function renderOwnTurnActionBar(opts) {
    var bar = document.getElementById('actionBar');
    if (!bar) return;
    bar.innerHTML = '';

    if (opts.canHu) {
      var huBtn = createActionBtn('自摸', 'hu', function() { opts.onAction('hu'); });
      bar.appendChild(huBtn);
    }
    if (opts.kongs && opts.kongs.length > 0) {
      var gangBtn = createActionBtn('杠', 'gang', function() {
        if (opts.kongs.length === 1) {
          opts.onAction('kong', opts.kongs[0]);
        } else {
          // choice popup if multiple kongs
          opts.onAction('kong', opts.kongs[0]);
        }
      });
      bar.appendChild(gangBtn);
    }
  }

  function createActionBtn(text, cls, onClick) {
    var btn = document.createElement('button');
    btn.className = 'action-btn ' + cls;
    btn.textContent = text;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      Audio.playButton();
      onClick();
    });
    return btn;
  }

  function clearActionBar() {
    var bar = document.getElementById('actionBar');
    if (bar) bar.innerHTML = '';
  }

  function showChiChoicePopup(options, onAction) {
    var bar = document.getElementById('actionBar');
    var overlay = document.createElement('div');
    overlay.className = 'meld-choice-overlay';

    options.forEach(function(meld) {
      var optEl = document.createElement('div');
      optEl.className = 'meld-choice-option';
      meld.forEach(function(t) {
        optEl.innerHTML += Engine.tileHTML(t);
      });
      optEl.addEventListener('click', function() {
        overlay.remove();
        onAction('chi', meld);
      });
      overlay.appendChild(optEl);
    });

    bar.appendChild(overlay);
  }

  /* ================= UI Rendering ================= */
  function render() {
    if (!S) return;

    // 1. Center Compass & Wall
    document.getElementById('wallCountBadge').textContent = '余 ' + S.wall.length + ' 张';
    var winds = ['top', 'right', 'bottom', 'left'];
    winds.forEach(function(posClass, i) {
      var el = document.getElementById('windMarker' + (i));
      if (el) {
        var windSeat = absSeatAt(i);
        el.className = 'wind-marker ' + posClass + (windSeat === S.current ? ' active-turn' : '');
      }
    });

    // 2. Player Seat Cards (0: Bottom, 1: Right, 2: Top, 3: Left)
    for (var pos = 0; pos < 4; pos++) {
      var absSeat = absSeatAt(pos);
      var p = S.players[absSeat];
      if (!p) continue;

      var prefix = (pos === 0 ? 'human' : (pos === 1 ? 'right' : (pos === 2 ? 'top' : 'left')));
      var seatBadge = document.getElementById('seatBadge_' + prefix);
      if (seatBadge) {
        seatBadge.className = 'seat-badge' + (absSeat === S.current ? ' active-turn' : '');
      }

      var nameEl = document.getElementById('seatName_' + prefix);
      if (nameEl) nameEl.textContent = p.name;

      var scoreEl = document.getElementById('seatScore_' + prefix);
      if (scoreEl) scoreEl.textContent = S.scores[absSeat];

      var dealerTag = document.getElementById('dealerTag_' + prefix);
      if (dealerTag) dealerTag.style.display = (absSeat === S.dealer ? 'block' : 'none');

      // 3. Discard Pools
      renderDiscardPool(pos, p.discards);

      // 4. Opponent Hand Backs and Melds
      if (pos !== 0) {
        renderOpponentHand(prefix, p);
      }
    }

    // 5. Human Player Hand & Melds
    renderHumanHand(S.players[ME]);
  }

  function renderDiscardPool(pos, discards) {
    var prefix = (pos === 0 ? 'bottom' : (pos === 1 ? 'right' : (pos === 2 ? 'top' : 'left')));
    var poolEl = document.getElementById('discardPool_' + prefix);
    if (!poolEl) return;

    var html = '';
    discards.forEach(function(t, idx) {
      var isLast = (S.lastDiscard && S.lastDiscard.tile === t && idx === discards.length - 1 && absSeatAt(pos) === S.lastDiscard.seat);
      html += Engine.tileHTML(t, isLast ? 'last-discard' : '');
    });
    poolEl.innerHTML = html;
  }

  function renderOpponentHand(prefix, player) {
    var backsEl = document.getElementById('oppHand_' + prefix);
    if (backsEl) {
      var count = player.hand.length;
      var html = '';
      for (var i = 0; i < count; i++) {
        html += Engine.backHTML();
      }
      backsEl.innerHTML = html;
    }

    var meldsEl = document.getElementById('oppMelds_' + prefix);
    if (meldsEl) {
      var meldHTML = '';
      player.melds.forEach(function(m) {
        meldHTML += '<div class="meld-group" style="display:flex;gap:1px;margin-right:4px;">';
        m.tiles.forEach(function(t) { meldHTML += Engine.tileHTML(t); });
        meldHTML += '</div>';
      });
      meldsEl.innerHTML = meldHTML;
    }

    var flowersEl = document.getElementById('oppFlowers_' + prefix);
    if (flowersEl) {
      var flowerHTML = '';
      player.flowers.forEach(function(f) { flowerHTML += Engine.tileHTML(f); });
      flowersEl.innerHTML = flowerHTML;
    }
  }

  function renderHumanHand(player) {
    var handRow = document.getElementById('humanHandRow');
    if (!handRow) return;

    var html = '';
    player.hand.forEach(function(t, i) {
      var isSelected = (S.selectedTile === t);
      var isDrawn = (player.lastDrawn === t && i === player.hand.length - 1);
      var extra = (isSelected ? 'selected ' : '') + (isDrawn ? 'drawn-tile ' : '');
      html += Engine.tileHTML(t, extra);
    });
    handRow.innerHTML = html;

    // Attach tile tap / click listeners
    var tileEls = handRow.querySelectorAll('.mj-tile');
    tileEls.forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var t = parseInt(el.getAttribute('data-tile'), 10);
        onHumanTileClick(t);
      });
    });

    // Human Melds
    var meldsEl = document.getElementById('humanMeldsArea');
    if (meldsEl) {
      var mHtml = '';
      player.melds.forEach(function(m) {
        mHtml += '<div class="meld-group" style="display:flex;gap:1px;margin-right:6px;">';
        m.tiles.forEach(function(t) { mHtml += Engine.tileHTML(t); });
        mHtml += '</div>';
      });
      meldsEl.innerHTML = mHtml;
    }

    // Human Flowers
    var flowersEl = document.getElementById('humanFlowersArea');
    if (flowersEl) {
      var fHtml = '';
      player.flowers.forEach(function(f) { fHtml += Engine.tileHTML(f); });
      flowersEl.innerHTML = fHtml;
    }

    renderHandTingBadges();
  }

  function onHumanTileClick(t) {
    if (S.current !== ME || !S.pendingDiscardResolve) {
      // Just preview highlight
      highlightMatchingTiles(t);
      Audio.playTileClick();
      return;
    }

    if (S.selectedTile === t) {
      // Double tap -> Discard!
      var resolve = S.pendingDiscardResolve;
      S.selectedTile = null;
      hideTingTooltip();
      clearHighlightMatchingTiles();
      resolve(t);
    } else {
      // First tap -> Select & Ting hint & Highlight
      S.selectedTile = t;
      Audio.playTileClick();
      render();
      highlightMatchingTiles(t);
      showTingTooltip(t);
    }
  }

  function highlightMatchingTiles(t) {
    clearHighlightMatchingTiles();
    var allTiles = document.querySelectorAll('.table-surface .mj-tile[data-tile="' + t + '"]');
    allTiles.forEach(function(el) {
      el.classList.add('highlight-match');
    });
  }

  function clearHighlightMatchingTiles() {
    var highlighted = document.querySelectorAll('.highlight-match');
    highlighted.forEach(function(el) {
      el.classList.remove('highlight-match');
    });
  }

  /* ================= Cinematic VFX Callout Banner ================= */
  var vfxTimer = null;
  function showVFX(text) {
    var banner = document.getElementById('vfxBanner');
    if (!banner) return;
    banner.textContent = text;
    banner.classList.remove('play');
    void banner.offsetWidth; // re-trigger reflow
    banner.classList.add('play');

    clearTimeout(vfxTimer);
    vfxTimer = setTimeout(function() {
      banner.classList.remove('play');
    }, 1100);
  }

  /* ================= Floating Chat Bubbles & Speech ================= */
  function showSpeechBubble(seat, text) {
    var pos = screenPos(seat);
    var prefix = (pos === 0 ? 'human' : (pos === 1 ? 'right' : (pos === 2 ? 'top' : 'left')));
    var avatarEl = document.getElementById('avatar_' + prefix);
    if (!avatarEl) return;

    var oldBubble = avatarEl.parentElement.querySelector('.speech-bubble');
    if (oldBubble) oldBubble.remove();

    var bubble = document.createElement('div');
    bubble.className = 'speech-bubble';
    bubble.textContent = text;

    avatarEl.parentElement.style.position = 'relative';
    avatarEl.parentElement.appendChild(bubble);

    setTimeout(function() {
      bubble.remove();
    }, 2800);
  }

  /* ================= Toast Notification ================= */
  var toastTimer = null;
  function showToast(msg) {
    var el = document.getElementById('toastMsg');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
      el.classList.remove('show');
    }, 2000);
  }

  /* ================= Settlement Modal ================= */
  function showSettlementModal(winnerSeat, isZimo, deltas) {
    var modal = document.getElementById('modalSettle');
    var titleEl = document.getElementById('settleTitle');
    var subEl = document.getElementById('settleSub');
    var listEl = document.getElementById('settleList');

    if (winnerSeat < 0) {
      titleEl.textContent = '流 局';
      subEl.textContent = '牌墙摸完未有人胡牌，本局不计分';
    } else {
      var isMe = (winnerSeat === ME);
      titleEl.textContent = (isMe ? '🎉 你胡牌了！' : S.players[winnerSeat].name + ' 胡牌！');
      subEl.textContent = (isZimo ? '自摸胡 · 三家各付 4 分' : '点炮胡');
    }

    var html = '';
    for (var i = 0; i < 4; i++) {
      var pl = S.players[i];
      var isWin = (i === winnerSeat);
      var delta = deltas[i];
      var deltaStr = (delta > 0 ? '+' + delta : String(delta));
      var deltaCls = (delta > 0 ? 'plus' : (delta < 0 ? 'minus' : ''));

      html += '<div class="settle-row' + (isWin ? ' winner' : '') + '">' +
        '<div class="seat-avatar av-' + i + '">' + pl.av + '</div>' +
        '<div style="width:70px;font-weight:bold;">' + pl.name + '</div>' +
        '<div class="settle-hand-display">';
      pl.hand.forEach(function(t) { html += Engine.tileHTML(t); });
      html += '</div>' +
        '<div class="settle-score-delta ' + deltaCls + '">' + deltaStr + '</div>' +
      '</div>';
    }
    listEl.innerHTML = html;
    showModal('modalSettle');
  }

  /* ================= Modals Management ================= */
  function showModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('show');
  }

  function hideModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('show');
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  /* ================= UI Wiring & Listeners ================= */
  function initUI() {
    // Toolbar buttons
    document.getElementById('btnStartNew').addEventListener('click', function() {
      Audio.playButton();
      startNewGame();
    });

    document.getElementById('btnRules').addEventListener('click', function() {
      Audio.playButton();
      showModal('modalRules');
    });

    document.getElementById('btnSoundToggle').addEventListener('click', function() {
      Audio.muted = !Audio.muted;
      this.textContent = Audio.muted ? '🔇 静音' : '🔊 音效';
      Audio.playButton();
    });

    document.getElementById('btnLobby').addEventListener('click', function() {
      Audio.playButton();
      showModal('modalLobby');
    });

    // Close buttons for modals
    document.querySelectorAll('.close-btn, .modal-close-action').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var modal = this.closest('.modal-overlay');
        if (modal) modal.classList.remove('show');
      });
    });

    // Settle Continue button
    document.getElementById('btnSettleNext').addEventListener('click', function() {
      hideModal('modalSettle');
      if (S) S.round++;
      startRound();
    });

    // Quick Chat UI
    var chatPillBtn = document.getElementById('chatPillBtn');
    var chatPopup = document.getElementById('chatPopup');
    chatPillBtn.addEventListener('click', function() {
      Audio.playButton();
      chatPopup.classList.toggle('show');
    });

    document.addEventListener('click', function(e) {
      if (!e.target.closest('#chatPopup') && !e.target.closest('#chatPillBtn')) {
        chatPopup.classList.remove('show');
      }
    });

    // Chat tabs
    document.getElementById('tabChatPhrases').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabChatEmojis').classList.remove('active');
      document.getElementById('chatPhrasesList').style.display = 'flex';
      document.getElementById('chatEmojiGrid').style.display = 'none';
    });

    document.getElementById('tabChatEmojis').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabChatPhrases').classList.remove('active');
      document.getElementById('chatPhrasesList').style.display = 'none';
      document.getElementById('chatEmojiGrid').style.display = 'grid';
    });

    // Chat items click
    document.querySelectorAll('.chat-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var text = this.textContent;
        chatPopup.classList.remove('show');
        showSpeechBubble(ME, text);
        if (MODE !== 'single') {
          Network.sendChat('phrase', text, S.players[ME].name, ME);
        }
      });
    });

    document.querySelectorAll('.chat-emoji-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var emoji = this.textContent;
        chatPopup.classList.remove('show');
        showSpeechBubble(ME, emoji);
        if (MODE !== 'single') {
          Network.sendChat('emoji', emoji, S.players[ME].name, ME);
        }
      });
    });

    // Online Room Actions (Create & Join)
    document.getElementById('btnCreateRoom').addEventListener('click', function() {
      var code = Network.genRoomCode();
      var name = document.getElementById('inputMyName').value || '房主';
      connectOnlineRoom(code, true, name);
    });

    document.getElementById('btnJoinRoom').addEventListener('click', function() {
      var code = (document.getElementById('inputJoinCode').value || '').toUpperCase().trim();
      var name = document.getElementById('inputMyName').value || '玩家';
      if (code.length !== 4) {
        showToast('请输入正确的4位房间号');
        return;
      }
      connectOnlineRoom(code, false, name);
    });

    document.getElementById('btnCopyLink').addEventListener('click', function() {
      var link = document.getElementById('lobbyShareLink').value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function() {
          showToast('房间邀请链接已复制！');
        });
      } else {
        showToast('请长按复制链接');
      }
    });

    // Start initial single player game
    startNewGame();
  }

  /* ================= Multiplayer Connection ================= */
  function connectOnlineRoom(code, asHost, name) {
    showToast('正在连接房间 ' + code + ' ...');

    Network.connect(code, asHost, name, {
      onConnected: function(isHost, roomCode) {
        MODE = isHost ? 'host' : 'guest';
        document.getElementById('lobbyRoomCode').textContent = roomCode;
        var shareLink = Network.getShareLink(roomCode);
        document.getElementById('lobbyShareLink').value = shareLink;

        // Draw QR Code
        var qrCanvas = document.getElementById('lobbyQRCodeCanvas');
        if (window.drawQRCode && qrCanvas) {
          window.drawQRCode(shareLink, qrCanvas, 140);
        }

        showModal('modalLobby');
        showToast('已进入房间 ' + roomCode);
      },
      onLobbyUpdate: function(payload) {
        renderLobbyUI(payload);
      },
      onSeatAssigned: function(seat) {
        ME = seat;
        VIEW = seat;
        render();
      },
      onChatReceived: function(msg) {
        showSpeechBubble(msg.seat, msg.content);
      },
      onError: function(err) {
        showToast(err);
      }
    });
  }

  function renderLobbyUI(payload) {
    var seatsEl = document.getElementById('lobbySeatsGrid');
    if (!seatsEl || !payload.seats) return;

    var html = '';
    payload.seats.forEach(function(s, idx) {
      if (!s) {
        html += '<div class="lobby-seat-card empty">' +
          '<div class="seat-avatar" style="background:#555;">' + (idx + 1) + '</div>' +
          '<div><div style="font-size:13px;color:#aaa;">空位</div><div class="status-tag">机器人补位</div></div>' +
        '</div>';
      } else {
        html += '<div class="lobby-seat-card">' +
          '<div class="seat-avatar av-' + idx + '">' + s.name.charAt(0) + '</div>' +
          '<div><div style="font-weight:bold;">' + s.name + '</div>' +
          (s.host ? '<span class="status-tag" style="background:#d4af37;color:#111;">房主</span>' : '<span class="status-tag">玩家</span>') +
          '</div></div>';
      }
    });
    seatsEl.innerHTML = html;

    var startBtn = document.getElementById('btnStartOnlineGame');
    if (startBtn) {
      startBtn.style.display = (Network.currentSession && Network.currentSession.isHost) ? 'block' : 'none';
      startBtn.onclick = function() {
        hideModal('modalLobby');
        startNewGame();
      };
    }
  }

  window.MahjongApp = {
    startNewGame: startNewGame,
    render: render
  };
})();
