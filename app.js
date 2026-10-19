/**
 * Mahjong Master - Main Controller & Game Engine Link
 * Complete Host-Authoritative Multiplayer Sync via Supabase Realtime,
 * Drag-to-Discard on Mobile, Ting Assistant, 15s Countdown, and SFX.
 */
(function() {
  'use strict';

  var Engine = window.MahjongEngine;
  var Audio = window.MahjongAudio;
  var Network = window.MahjongNetwork;

  var MODE = 'single'; // 'single' | 'host' | 'guest'
  var ME = 0;          // absolute seat (0..3)
  var VIEW = 0;        // view rotation (ME is at screen bottom)

  function screenPos(absSeat) {
    return (absSeat - VIEW + 4) % 4; // 0: bottom, 1: right, 2: top, 3: left
  }

  function absSeatAt(pos) {
    return (pos + VIEW) % 4;
  }

  var S = null; // Local game state
  var timerInterval = null;
  var timerRemaining = 15;

  // Host-side pending waits for remote guests
  var hostPending = {};
  var hostWaitSeq = 0;
  var hostSyncTimer = null;

  // Guest-side cache
  var guestMyHand = [];
  var guestMyDrawn = null;
  var guestLastSeq = 0;

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
        showModal('modalLobby');
        showToast('已加载邀请房间：' + code + '，请点击加入');
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
    clearHostPending();
    spec = spec || (MODE === 'single' ? singleSpec() : buildMultiplayerSpec());

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
      pendingDiscardResolve: null,
      spec: spec
    };

    startRound();
  }

  function buildMultiplayerSpec() {
    var sess = Network.currentSession;
    if (!sess) return singleSpec();

    var bi = 0;
    return sess.seats.map(function(s, idx) {
      if (idx === 0) {
        return { name: sess.myName, ctrl: 'local', av: sess.myName.charAt(0), clientId: sess.myId, online: true };
      }
      if (s && s.online !== false) {
        return { name: s.name, ctrl: 'remote', av: s.name.charAt(0), clientId: s.clientId, online: true };
      }
      // Fill empty with bot
      var bName = Engine.BOT_NAMES[bi++ % 3];
      return { name: bName, ctrl: 'bot', av: bName.charAt(2) };
    });
  }

  function startRound() {
    var wall = [];
    for (var t = 0; t < 34; t++) for (var n = 0; n < 4; n++) wall.push(t);
    for (var wI = 0; wI < 4; wI++) wall.push(Engine.WILD);
    for (var f = 35; f <= 42; f++) wall.push(f);

    // Shuffle
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

    // Deal 13 tiles
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
      checkFlowerSettle(p2, true); // 天花杠
    }

    showToast('第 ' + S.round + ' 局开始，' + S.players[S.dealer].name + ' 坐庄');
    render();
    scheduleSync();

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
    var skip = false;

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
    scheduleSync();
    startTurnTimer(pIdx);

    // 1. Draw Phase
    if (skip === 'kong') {
      await sleep(p.isBot ? 800 : 80);
      if (drawTile(pIdx, true) === null) { endRoundDraw(); return { end: true }; }
    } else if (!skip) {
      await sleep(p.isBot ? 800 : 80);
      if (drawTile(pIdx, false) === null) { endRoundDraw(); return { end: true }; }
    }
    render();
    scheduleSync();

    // 2. Action / Discard Phase
    var discardResult;
    while (true) {
      if (gen !== S.gen) return { end: true };

      if (!p.isBot && p.ctrl === 'local') {
        discardResult = await humanTurnAction(pIdx, gen);
      } else if (p.ctrl === 'remote' && MODE === 'host') {
        discardResult = await remoteDiscardWait(pIdx, gen);
      } else {
        // Bot turn
        await sleep(750);
        discardResult = botTurnDecision(p);
      }

      if (gen !== S.gen) return { end: true };

      if (discardResult.type === 'tsumo') {
        endRoundWin(pIdx, pIdx, true);
        return { end: true };
      } else if (discardResult.type === 'kong') {
        executeOwnKong(pIdx, discardResult.kong);
        render();
        scheduleSync();
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
    scheduleSync();

    // 4. Claims from other players (吃 / 碰 / 杠 / 胡)
    var claimRes = await processClaims(pIdx, dTile, gen);
    if (gen !== S.gen || S.over) return { end: true };
    if (claimRes) return claimRes;

    return { next: (pIdx + 1) % 4, skip: false };
  }

  function drawTile(pIdx, fromTail) {
    var p = S.players[pIdx];
    if (!S.wall.length) return null;
    var t = fromTail ? S.wall.pop() : S.wall.shift();

    var guard = 0;
    while (Engine.isFlower(t) && guard++ < 24) {
      p.flowers.push(t);
      checkFlowerSettle(pIdx, false);
      showToast(p.name + ' 补花【' + Engine.tileName(t) + '】');
      if (!S.wall.length) return null;
      t = S.wall.pop();
    }

    p.hand.push(t);
    p.lastDrawn = t;
    p.guoshui = false; // Over-water clears upon drawing a tile

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
    scheduleSync();
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
        settleInstant(s, 2, '明杠');
        scheduleSync();
        return { next: s, skip: 'kong' };
      } else if (ans.act === 'peng') {
        removeFromHand(pObj, tile, 2);
        pObj.melds.push({ kind: 'pon', tiles: [tile, tile, tile], from: discarder });
        showVFX('碰');
        Audio.playPeng();
        scheduleSync();
        return { next: s, skip: true };
      }
    }

    // Priority 3: Chi (吃)
    for (var c = 0; c < answers.length; c++) {
      if (answers[c].act === 'chi' && answers[c].meld) {
        var cs = responders[c];
        var cp = S.players[cs];
        var mTiles = answers[c].meld;
        var toRemove = mTiles.slice();
        var tIdx = toRemove.indexOf(tile);
        if (tIdx >= 0) toRemove.splice(tIdx, 1);
        toRemove.forEach(function(t) { removeFromHand(cp, t, 1); });
        cp.melds.push({ kind: 'chi', tiles: mTiles, from: discarder });
        showVFX('吃');
        Audio.playChi();
        scheduleSync();
        return { next: cs, skip: true };
      }
    }

    // Over-water recording if passed on Hu
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

    // Remote player on Host
    if (p.ctrl === 'remote' && MODE === 'host') {
      return remoteClaimWait(seat, options, gen);
    }

    return Promise.resolve({ act: 'pass' });
  }

  /* ================= Host-Authoritative Remote Waits ================= */
  function remoteDiscardWait(seat, gen) {
    return new Promise(function(resolve) {
      var p = S.players[seat];
      if (!p.clientId) {
        resolve(botTurnDecision(p));
        return;
      }

      var wid = ++hostWaitSeq;
      var payload = {
        to: p.clientId,
        wid: wid,
        canTsumo: Engine.canWinHand(p.hand, p.melds.length),
        kongs: S.wall.length ? Engine.findKongs(p) : []
      };

      var pending = {
        type: 'discard',
        seat: seat,
        wid: wid,
        resolve: resolve,
        timer: null,
        resend: null
      };

      // Fallback timer: 25s for timeout -> bot takeover
      pending.timer = setTimeout(function() {
        if (hostPending[seat] === pending) {
          clearHostPending(seat);
          showToast(p.name + ' 超时，由机器人代打出牌');
          resolve(botTurnDecision(p));
        }
      }, p.online ? 25000 : 8000);

      // Resend every 3.5s in case packets are dropped
      pending.resend = setInterval(function() {
        if (!hostPending[seat] || hostPending[seat] !== pending) {
          clearInterval(pending.resend);
          return;
        }
        Network.send('turn', payload);
        var pl = S.players[seat];
        if (pl && pl.clientId) {
          Network.send('hand', { to: pl.clientId, hand: pl.hand.slice(), lastDrawn: pl.lastDrawn });
        }
      }, 3500);

      hostPending[seat] = pending;
      Network.send('turn', payload);
      Network.send('hand', { to: p.clientId, hand: p.hand.slice(), lastDrawn: p.lastDrawn });
    });
  }

  function remoteClaimWait(seat, options, gen) {
    return new Promise(function(resolve) {
      var p = S.players[seat];
      if (!p.clientId) {
        resolve({ act: 'pass' });
        return;
      }

      var wid = ++hostWaitSeq;
      var payload = {
        to: p.clientId,
        wid: wid,
        canHu: options.canHu,
        canGang: options.canGang,
        canPeng: options.canPeng,
        canChi: options.canChi,
        tile: options.tile
      };

      var pending = {
        type: 'claim',
        seat: seat,
        wid: wid,
        resolve: resolve,
        timer: null,
        resend: null
      };

      pending.timer = setTimeout(function() {
        if (hostPending[seat] === pending) {
          clearHostPending(seat);
          resolve({ act: 'pass', couldHu: options.canHu });
        }
      }, p.online ? 16000 : 6000);

      pending.resend = setInterval(function() {
        if (!hostPending[seat] || hostPending[seat] !== pending) {
          clearInterval(pending.resend);
          return;
        }
        Network.send('claim', payload);
      }, 3500);

      hostPending[seat] = pending;
      Network.send('claim', payload);
    });
  }

  function clearHostPending(seat) {
    if (seat !== undefined) {
      var pd = hostPending[seat];
      if (pd) {
        if (pd.timer) clearTimeout(pd.timer);
        if (pd.resend) clearInterval(pd.resend);
        delete hostPending[seat];
      }
    } else {
      Object.keys(hostPending).forEach(function(k) {
        var p = hostPending[k];
        if (p) {
          if (p.timer) clearTimeout(p.timer);
          if (p.resend) clearInterval(p.resend);
        }
      });
      hostPending = {};
    }
  }

  /* Host receives guest action */
  function onHostGuestAction(p) {
    if (!S || MODE !== 'host') return;
    var seat = seatOfClient(p.from);
    if (seat < 0) return;
    var pd = hostPending[seat];
    if (!pd || pd.type !== 'discard') return;

    var pl = S.players[seat];
    var act = p.act || {};
    var out = null;

    if (act.type === 'tsumo' && Engine.canWinHand(pl.hand, pl.melds.length)) {
      out = { type: 'tsumo' };
    } else if (act.type === 'kong' && act.kong) {
      out = { type: 'kong', kong: act.kong };
    } else if (act.type === 'discard' && pl.hand.indexOf(act.tile) >= 0) {
      out = { type: 'discard', tile: act.tile };
    }

    if (out) {
      clearHostPending(seat);
      pd.resolve(out);
    }
  }

  /* Host receives guest claim answer */
  function onHostGuestClaimAnswer(p) {
    if (!S || MODE !== 'host') return;
    var seat = seatOfClient(p.from);
    if (seat < 0) return;
    var pd = hostPending[seat];
    if (!pd || pd.type !== 'claim') return;

    clearHostPending(seat);
    pd.resolve({ act: p.act || 'pass', meld: p.meld, couldHu: !!p.couldHu });
  }

  function seatOfClient(clientId) {
    if (!S) return -1;
    for (var i = 0; i < 4; i++) {
      if (S.players[i].clientId === clientId) return i;
    }
    return -1;
  }

  /* ================= State Sync (Host -> Guests) ================= */
  function scheduleSync() {
    if (MODE !== 'host' || hostSyncTimer) return;
    hostSyncTimer = setTimeout(function() {
      hostSyncTimer = null;
      doSync();
    }, 60);
  }

  function doSync() {
    if (MODE !== 'host' || !S) return;
    var snap = {
      round: S.round,
      dealer: S.dealer,
      current: S.current,
      wallCount: S.wall.length,
      over: S.over,
      scores: S.scores,
      lastDeltas: S.lastDeltas,
      history: S.history,
      lastDiscard: S.lastDiscard,
      players: S.players.map(function(p) {
        return {
          name: p.name,
          ctrl: p.ctrl,
          online: p.online,
          av: p.av,
          handCount: p.hand.length,
          melds: p.melds,
          flowers: p.flowers,
          flowerKong: p.flowerKong,
          discards: p.discards,
          guoshui: !!p.guoshui
        };
      }),
      reveal: S.over ? S.players.map(function(p) { return p.hand.slice(); }) : null
    };

    Network.send('state', snap);

    // Private hand broadcasts
    for (var i = 0; i < 4; i++) {
      var pl = S.players[i];
      if (pl.ctrl === 'remote' && pl.clientId) {
        Network.send('hand', {
          to: pl.clientId,
          hand: pl.hand.slice(),
          lastDrawn: pl.lastDrawn
        });
      }
    }
  }

  /* ================= Guest Handling ================= */
  function onGuestStateReceived(snap) {
    if (!snap || MODE !== 'guest') return;

    if (!S) {
      S = {
        gen: 1,
        scores: [0, 0, 0, 0],
        lastDeltas: null,
        history: [],
        round: 1,
        dealer: 0,
        wall: [],
        players: [],
        current: -1,
        lastDiscard: null,
        over: false,
        selectedTile: null,
        tingMap: {},
        spec: singleSpec()
      };
    }

    S.round = snap.round;
    S.dealer = snap.dealer;
    S.current = snap.current;
    S.over = snap.over;
    S.scores = snap.scores;
    S.lastDeltas = snap.lastDeltas;
    S.history = snap.history;
    S.lastDiscard = snap.lastDiscard;
    S.wall = new Array(snap.wallCount || 0);

    S.players = snap.players.map(function(sp, idx) {
      var hand;
      if (snap.reveal) {
        hand = snap.reveal[idx].slice();
      } else if (idx === ME) {
        hand = guestMyHand ? guestMyHand.slice() : [];
      } else {
        hand = [];
        for (var k = 0; k < sp.handCount; k++) hand.push(0);
      }

      return {
        name: sp.name,
        isBot: sp.ctrl === 'bot',
        ctrl: (idx === ME ? 'local' : (sp.ctrl === 'bot' ? 'bot' : 'remote')),
        clientId: null,
        online: sp.online,
        av: sp.av,
        hand: hand,
        melds: sp.melds,
        flowers: sp.flowers,
        flowerKong: sp.flowerKong,
        discards: sp.discards,
        guoshui: !!sp.guoshui,
        lastDrawn: (idx === ME ? guestMyDrawn : null)
      };
    });

    startTurnTimer(S.current);
    render();

    if (snap.over && !document.getElementById('modalSettle').classList.contains('show')) {
      var winnerSeat = -1;
      if (snap.lastDeltas) {
        for (var d = 0; d < 4; d++) {
          if (snap.lastDeltas[d] > 0) winnerSeat = d;
        }
      }
      showSettlementModal(winnerSeat, false, snap.lastDeltas || [0, 0, 0, 0]);
    }
  }

  function onGuestHandReceived(hand, lastDrawn) {
    guestMyHand = hand || [];
    guestMyDrawn = lastDrawn;
    if (S && S.players[ME]) {
      S.players[ME].hand = guestMyHand.slice();
      S.players[ME].lastDrawn = guestMyDrawn;
      render();
    }
  }

  function onGuestTurnReceived(payload) {
    if (!S || MODE !== 'guest') return;

    var mePlayer = S.players[ME];
    updateTingAssistant(mePlayer);

    renderOwnTurnActionBar({
      canHu: !!payload.canTsumo,
      kongs: payload.kongs || [],
      onAction: function(type, kongObj) {
        clearActionBar();
        hideTingTooltip();
        Network.send('action', {
          from: Network.currentSession.myId,
          act: { type: type, kong: kongObj }
        });
      }
    });

    S.pendingDiscardResolve = function(tile) {
      clearActionBar();
      hideTingTooltip();
      S.pendingDiscardResolve = null;
      Network.send('action', {
        from: Network.currentSession.myId,
        act: { type: 'discard', tile: tile }
      });
    };
  }

  function onGuestClaimReceived(payload) {
    if (!S || MODE !== 'guest') return;

    renderActionBar({
      canHu: payload.canHu,
      canGang: payload.canGang,
      canPeng: payload.canPeng,
      canChi: payload.canChi,
      tile: payload.tile,
      onAction: function(act, data) {
        clearActionBar();
        Network.send('claim-answer', {
          from: Network.currentSession.myId,
          act: act,
          meld: data,
          couldHu: payload.canHu
        });
      }
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
      for (var i = 0; i < 4; i++) {
        if (i !== winnerSeat) { deltas[i] = -4; deltas[winnerSeat] += 4; }
      }
      showVFX('自摸！');
      Audio.playZimo();
      showToast('🎉 ' + winName + ' 自摸胡牌！');
    } else {
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
    scheduleSync();

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
    scheduleSync();

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
    var totalCircumference = 314;
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
    if (S && S.pendingDiscardResolve) {
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
      bar.appendChild(createActionBtn('胡', 'hu', function() { opts.onAction('hu'); }));
    }
    if (opts.canGang) {
      bar.appendChild(createActionBtn('杠', 'gang', function() { opts.onAction('gang'); }));
    }
    if (opts.canPeng) {
      bar.appendChild(createActionBtn('碰', 'peng', function() { opts.onAction('peng'); }));
    }
    if (opts.canChi) {
      var options = Engine.findChiOptions(S.players[ME].hand, opts.tile);
      bar.appendChild(createActionBtn('吃', 'chi', function() {
        if (options.length === 1) {
          opts.onAction('chi', options[0]);
        } else {
          showChiChoicePopup(options, opts.onAction);
        }
      }));
    }

    bar.appendChild(createActionBtn('过', 'pass', function() { opts.onAction('pass'); }));
  }

  function renderOwnTurnActionBar(opts) {
    var bar = document.getElementById('actionBar');
    if (!bar) return;
    bar.innerHTML = '';

    if (opts.canHu) {
      bar.appendChild(createActionBtn('自摸', 'hu', function() { opts.onAction('hu'); }));
    }
    if (opts.kongs && opts.kongs.length > 0) {
      bar.appendChild(createActionBtn('杠', 'gang', function() {
        if (opts.kongs.length === 1) {
          opts.onAction('kong', opts.kongs[0]);
        } else {
          opts.onAction('kong', opts.kongs[0]);
        }
      }));
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
    document.getElementById('wallCountBadge').textContent = '余 ' + (S.wall ? S.wall.length : 0) + ' 张';
    var winds = ['bottom', 'right', 'top', 'left'];
    var windChars = ['东', '南', '西', '北'];
    winds.forEach(function(posClass, i) {
      var el = document.getElementById('windMarker' + i);
      if (el) {
        var windSeat = absSeatAt(i);
        var windIdx = (windSeat - (S ? S.dealer : 0) + 4) % 4;
        el.textContent = windChars[windIdx];
        el.className = 'wind-marker ' + posClass + (windSeat === S.current ? ' active-turn' : '');
      }
    });

    // 2. Player Seat Cards
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
      if (scoreEl) scoreEl.textContent = S.scores[absSeat] || 0;

      var dealerTag = document.getElementById('dealerTag_' + prefix);
      if (dealerTag) dealerTag.style.display = (absSeat === S.dealer ? 'block' : 'none');

      // 3. Discard Pools
      renderDiscardPool(pos, p.discards || []);

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
      (player.melds || []).forEach(function(m) {
        meldHTML += '<div class="meld-group" style="display:flex;gap:1px;margin-right:4px;">';
        m.tiles.forEach(function(t) { meldHTML += Engine.tileHTML(t); });
        meldHTML += '</div>';
      });
      meldsEl.innerHTML = meldHTML;
    }

    var flowersEl = document.getElementById('oppFlowers_' + prefix);
    if (flowersEl) {
      var flowerHTML = '';
      (player.flowers || []).forEach(function(f) { flowerHTML += Engine.tileHTML(f); });
      flowersEl.innerHTML = flowerHTML;
    }
  }

  function renderHumanHand(player) {
    if (!player) return;
    var handRow = document.getElementById('humanHandRow');
    if (!handRow) return;

    var html = '';
    player.hand.forEach(function(t, i) {
      var isSelected = (S.selectedTile === t);
      var isDrawn = (player.lastDrawn === t && i === player.hand.length - 1);
      var extra = (isSelected ? 'selected ' : '') + (isDrawn ? 'drawn-tile ' : '');
      var pillHtml = (isSelected && S.current === ME && S.pendingDiscardResolve) ? '<div class="discard-tap-pill" data-discard="' + t + '">出牌 ⬆</div>' : '';
      var tileStr = Engine.tileHTML(t, extra);
      html += tileStr.replace('</div></div>', pillHtml + '</div></div>');
    });
    handRow.innerHTML = html;

    // Attach tile tap / click listeners & Touch drag to discard
    var tileEls = handRow.querySelectorAll('.mj-tile');
    tileEls.forEach(function(el) {
      var t = parseInt(el.getAttribute('data-tile'), 10);

      // Tap click
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        onHumanTileClick(t);
      });

      // Mobile Touch drag-to-discard
      attachDragToDiscard(el, t);
    });

    // Attach discard pill click
    var pills = handRow.querySelectorAll('.discard-tap-pill');
    pills.forEach(function(pEl) {
      pEl.addEventListener('click', function(e) {
        e.stopPropagation();
        var dt = parseInt(pEl.getAttribute('data-discard'), 10);
        if (S.pendingDiscardResolve) {
          var res = S.pendingDiscardResolve;
          S.selectedTile = null;
          hideTingTooltip();
          clearHighlightMatchingTiles();
          res(dt);
        }
      });
    });

    // Human Melds
    var meldsEl = document.getElementById('humanMeldsArea');
    if (meldsEl) {
      var mHtml = '';
      (player.melds || []).forEach(function(m) {
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
      (player.flowers || []).forEach(function(f) { fHtml += Engine.tileHTML(f); });
      flowersEl.innerHTML = fHtml;
    }

    renderHandTingBadges();
  }

  function attachDragToDiscard(tileEl, tile) {
    var startY = 0;
    var startX = 0;
    var isDragging = false;

    tileEl.addEventListener('touchstart', function(e) {
      if (S.current !== ME || !S.pendingDiscardResolve) return;
      var touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      isDragging = true;
    }, { passive: true });

    tileEl.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      var touch = e.touches[0];
      var deltaY = touch.clientY - startY;
      if (deltaY < -15) {
        tileEl.style.transform = 'translateY(' + deltaY + 'px)';
      }
    }, { passive: true });

    tileEl.addEventListener('touchend', function(e) {
      if (!isDragging) return;
      isDragging = false;
      var touch = e.changedTouches[0];
      var deltaY = touch.clientY - startY;
      tileEl.style.transform = '';

      // Dragged up by > 45px -> Discard immediately!
      if (deltaY < -45 && S.current === ME && S.pendingDiscardResolve) {
        var resolve = S.pendingDiscardResolve;
        S.selectedTile = null;
        hideTingTooltip();
        clearHighlightMatchingTiles();
        resolve(tile);
      }
    });
  }

  function onHumanTileClick(t) {
    if (S.current !== ME || !S.pendingDiscardResolve) {
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
    void banner.offsetWidth;
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

  /* ================= History Scoreboard Table ================= */
  function renderHistoryTable() {
    var tbody = document.getElementById('historyTableBody');
    if (!tbody || !S) return;
    if (!S.history || S.history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:16px;">暂无历史对局记录</td></tr>';
      return;
    }

    var html = '';
    S.history.forEach(function(item) {
      html += '<tr>' +
        '<td>第 ' + item.round + ' 局</td>' +
        '<td style="text-align:left;font-weight:bold;">' + item.label + '</td>';
      for (var s = 0; s < 4; s++) {
        var d = item.deltas ? item.deltas[s] : 0;
        var dStr = (d > 0 ? '+' + d : String(d));
        var col = (d > 0 ? '#2ecc71' : (d < 0 ? '#e74c3c' : 'var(--text-muted)'));
        html += '<td style="color:' + col + ';font-weight:bold;">' + dStr + '</td>';
      }
      html += '</tr>';
    });

    // Summary row
    html += '<tr style="background:rgba(212,175,55,0.18);font-weight:bold;">' +
      '<td colspan="2">当前总分</td>';
    for (var s2 = 0; s2 < 4; s2++) {
      var total = S.scores ? S.scores[s2] : 0;
      var col2 = (total > 0 ? '#2ecc71' : (total < 0 ? '#e74c3c' : '#fff'));
      html += '<td style="color:' + col2 + ';font-size:14px;">' + total + '</td>';
    }
    html += '</tr>';
    tbody.innerHTML = html;
  }

  /* ================= UI Wiring & Listeners ================= */
  function initUI() {
    // Restore Theme & Nickname from LocalStorage
    try {
      var savedTheme = localStorage.getItem('mj_theme') || 'emerald';
      document.body.setAttribute('data-theme', savedTheme);
      document.querySelectorAll('.theme-choice-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-theme') === savedTheme);
      });

      var savedName = localStorage.getItem('mj_player_name');
      if (savedName) document.getElementById('inputMyName').value = savedName;
    } catch (e) {}

    document.getElementById('inputMyName').addEventListener('change', function() {
      try { localStorage.setItem('mj_player_name', this.value); } catch (e) {}
    });

    // Toolbar buttons
    document.getElementById('btnStartNew').addEventListener('click', function() {
      Audio.playButton();
      startNewGame();
    });

    document.getElementById('btnRules').addEventListener('click', function() {
      Audio.playButton();
      showModal('modalRules');
    });

    document.getElementById('btnHistory').addEventListener('click', function() {
      Audio.playButton();
      renderHistoryTable();
      showModal('modalHistory');
    });

    document.getElementById('btnSettings').addEventListener('click', function() {
      Audio.playButton();
      showModal('modalSettings');
    });

    document.getElementById('btnSoundToggle').addEventListener('click', function() {
      Audio.muted = !Audio.muted;
      this.textContent = Audio.muted ? '🔇 静音' : '🔊 音效';
      document.getElementById('btnSettingsSoundToggle').textContent = Audio.muted ? '🔇 关闭' : '🔊 开启';
      Audio.playButton();
    });

    document.getElementById('btnSettingsSoundToggle').addEventListener('click', function() {
      Audio.muted = !Audio.muted;
      this.textContent = Audio.muted ? '🔇 关闭' : '🔊 开启';
      document.getElementById('btnSoundToggle').textContent = Audio.muted ? '🔇 静音' : '🔊 音效';
      Audio.playButton();
    });

    // Theme selector buttons
    document.querySelectorAll('.theme-choice-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.theme-choice-btn').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        var theme = this.getAttribute('data-theme');
        document.body.setAttribute('data-theme', theme);
        try { localStorage.setItem('mj_theme', theme); } catch (e) {}
        Audio.playButton();
      });
    });

    document.getElementById('btnLobby').addEventListener('click', function() {
      Audio.playButton();
      showModal('modalLobby');
    });

    document.getElementById('btnLeaveRoom').addEventListener('click', function() {
      Audio.playButton();
      leaveOnlineRoom();
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
      if (MODE !== 'guest') {
        if (S) S.round++;
        startRound();
      }
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
        showToast('请输入正确的4位房号');
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
        showToast('长按链接即可复制');
      }
    });

    // Start single player by default
    startNewGame();
  }

  /* ================= Multiplayer Connection ================= */
  function connectOnlineRoom(code, asHost, name) {
    showToast('正在连接房间 ' + code + ' ...');

    Network.connect(code, asHost, name, {
      onConnected: function(isHost, roomCode) {
        MODE = isHost ? 'host' : 'guest';
        ME = isHost ? 0 : -1;
        VIEW = isHost ? 0 : 0;

        document.getElementById('lobbyRoomCode').textContent = roomCode;
        var shareLink = Network.getShareLink(roomCode);
        document.getElementById('lobbyShareLink').value = shareLink;
        document.getElementById('btnLeaveRoom').style.display = 'inline-flex';

        // Render QR Code
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
        showToast('分配到座位：' + (seat + 1) + '号位');
      },
      onStateReceived: function(snap) {
        onGuestStateReceived(snap);
      },
      onHandReceived: function(hand, lastDrawn) {
        onGuestHandReceived(hand, lastDrawn);
      },
      onGuestTurn: function(payload) {
        onGuestTurnReceived(payload);
      },
      onGuestClaim: function(payload) {
        onGuestClaimReceived(payload);
      },
      onGuestAction: function(payload) {
        onHostGuestAction(payload);
      },
      onGuestClaimAnswer: function(payload) {
        onHostGuestClaimAnswer(payload);
      },
      onGuestBye: function(payload) {
        if (MODE === 'host' && S) {
          var seat = seatOfClient(payload.from);
          if (seat >= 0) {
            S.players[seat].ctrl = 'bot';
            S.players[seat].isBot = true;
            showToast(S.players[seat].name + ' 离线，转由机器人代打');
            render();
            scheduleSync();
          }
        }
      },
      onPlayerOnlineChange: function(seat, isOnline, pName) {
        if (MODE === 'host' && S && S.players[seat]) {
          S.players[seat].online = isOnline;
          showToast(pName + (isOnline ? ' 回来了' : ' 暂时掉线'));
          render();
          scheduleSync();
        }
      },
      onGuestRejoin: function(rejoinName, clientId) {
        // Find offline seat matching name
        if (S) {
          for (var i = 1; i < 4; i++) {
            if (S.players[i].name === rejoinName) {
              S.players[i].clientId = clientId;
              S.players[i].online = true;
              S.players[i].ctrl = 'remote';
              S.players[i].isBot = false;
              scheduleSync();
              return i;
            }
          }
        }
        return -1;
      },
      onChatReceived: function(msg) {
        showSpeechBubble(msg.seat, msg.content);
      },
      onHostGone: function() {
        showToast('房主已离开，房间已关闭');
        leaveOnlineRoom();
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
          (s.host ? '<span class="status-tag" style="background:#d4af37;color:#111;">房主</span>' : '<span class="status-tag">在线</span>') +
          '</div></div>';
      }
    });
    seatsEl.innerHTML = html;

    var startBtn = document.getElementById('btnStartOnlineGame');
    if (startBtn) {
      var isHost = (Network.currentSession && Network.currentSession.isHost);
      startBtn.style.display = isHost ? 'block' : 'none';
      startBtn.onclick = function() {
        hideModal('modalLobby');
        if (Network.currentSession) Network.currentSession.started = true;
        Network.broadcastLobby();
        startNewGame();
      };
    }
  }

  function leaveOnlineRoom() {
    Network.leave();
    MODE = 'single';
    ME = 0;
    VIEW = 0;
    document.getElementById('btnLeaveRoom').style.display = 'none';
    showToast('已回到单机模式');
    startNewGame();
  }

  window.MahjongApp = {
    startNewGame: startNewGame,
    render: render
  };
})();
