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
  var TURN_TIME_LIMIT = 60; // 60s (1 minute) thinking time
  var timerRemaining = TURN_TIME_LIMIT;

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
    var hasRecovered = checkMatchRecovery();
    if (!hasRecovered) {
      var hasRoom = checkURLRoom();
      if (!hasRoom) {
        showModal('modalModeSelect');
      }
    }
  });

  function checkMatchRecovery() {
    var savedHost = null;
    var activeMatch = null;
    try {
      savedHost = JSON.parse(localStorage.getItem('mj_host_saved_match'));
    } catch (e) {}
    try {
      activeMatch = JSON.parse(localStorage.getItem('mj_active_match'));
    } catch (e) {}

    var match = savedHost || activeMatch;
    if (!match || !match.code) return false;

    // Only recover matches within the last 2 hours
    if (Date.now() - match.time > 7200000) {
      clearActiveMatch();
      return false;
    }

    var isHost = savedHost ? true : !!match.isHost;
    var code = match.code;
    var name = match.name || '玩家';

    var codeEl = document.getElementById('reconnectRoomCode');
    var roleEl = document.getElementById('reconnectRoleBadge');
    var progEl = document.getElementById('reconnectProgressInfo');

    if (codeEl) codeEl.textContent = code;
    if (roleEl) {
      roleEl.textContent = isHost ? '👑 房主' : '👤 玩家';
      roleEl.style.color = isHost ? 'var(--gold-light)' : '#2ecc71';
    }

    var progressText = '第 1 局进行中';
    if (savedHost && savedHost.S) {
      progressText = '第 ' + savedHost.S.round + ' 局进行中 (对局数据已完整恢复)';
    }
    if (progEl) progEl.textContent = progressText;

    showModal('modalReconnect');

    // Confirm Reconnect
    var btnConfirm = document.getElementById('btnConfirmReconnect');
    if (btnConfirm) {
      btnConfirm.onclick = function() {
        Audio.playButton();
        hideModal('modalReconnect');
        hideModal('modalModeSelect');
        Audio.startBGM();

        if (isHost && savedHost && savedHost.S) {
          restoreHostMatch(savedHost);
        } else {
          connectOnlineRoom(code, false, name);
        }
      };
    }

    // Cancel Reconnect
    var btnCancel = document.getElementById('btnCancelReconnect');
    if (btnCancel) {
      btnCancel.onclick = function() {
        Audio.playButton();
        clearActiveMatch();
        hideModal('modalReconnect');
        showModal('modalModeSelect');
      };
    }

    return true;
  }

  function showReconnectPill(msg) {
    var pill = document.getElementById('reconnectPill');
    var text = document.getElementById('reconnectPillText');
    if (pill) {
      if (text && msg) text.textContent = msg;
      pill.style.display = 'flex';
    }
  }

  function hideReconnectPill() {
    var pill = document.getElementById('reconnectPill');
    if (pill) pill.style.display = 'none';
  }

  function restoreHostMatch(savedHost) {
    showToast('正在重连恢复房间 ' + savedHost.code + ' ...');
    connectOnlineRoom(savedHost.code, true, savedHost.name);

    S = savedHost.S;
    MODE = 'host';
    ME = 0;
    VIEW = 0;

    if (Network.currentSession) {
      Network.currentSession.started = true;
      for (var i = 1; i < 4; i++) {
        var pl = S.players[i];
        if (pl && pl.clientId) {
          Network.currentSession.seats[i] = {
            clientId: pl.clientId,
            name: pl.name,
            online: false,
            ready: true
          };
        }
      }
    }

    render();
    scheduleSync();

    showToast('对局已恢复！正在等待玩家归队...');

    if (!S.over) {
      runTurnLoop(S.gen);
    }
  }

  function saveActiveMatch(code, asHost, name) {
    try {
      localStorage.setItem('mj_active_match', JSON.stringify({
        code: code,
        isHost: asHost,
        name: name,
        time: Date.now()
      }));
    } catch (e) {}
  }

  function clearActiveMatch() {
    try {
      localStorage.removeItem('mj_active_match');
      localStorage.removeItem('mj_host_saved_match');
    } catch (e) {}
  }

  function saveHostGameState() {
    if (MODE !== 'host' || !S || !Network.currentSession) return;
    try {
      var saved = {
        code: Network.currentSession.code,
        name: Network.currentSession.myName,
        time: Date.now(),
        S: {
          gen: S.gen,
          round: S.round,
          dealer: S.dealer,
          scores: S.scores,
          lastDeltas: S.lastDeltas,
          history: S.history,
          wall: S.wall,
          current: S.current,
          lastDiscard: S.lastDiscard,
          over: S.over,
          spec: S.spec,
          players: S.players.map(function(p) {
            return {
              name: p.name,
              isBot: p.isBot,
              ctrl: p.ctrl,
              clientId: p.clientId,
              online: p.online,
              av: p.av,
              hand: p.hand,
              melds: p.melds,
              flowers: p.flowers,
              flowerKong: p.flowerKong,
              discards: p.discards,
              lastDrawn: p.lastDrawn,
              guoshui: p.guoshui
            };
          })
        }
      };
      localStorage.setItem('mj_host_saved_match', JSON.stringify(saved));
    } catch (e) {}
  }

  function checkURLRoom() {
    var params = new URLSearchParams(window.location.search);
    var room = params.get('room');
    if (room) {
      var code = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (code.length === 4) {
        document.getElementById('inputJoinCode').value = code;
        showModal('modalLobby');
        showToast('已加载邀请房间：' + code + '，请点击加入');
        return true;
      }
    }
    return false;
  }

  function singleSpec() {
    var myName = '雀圣';
    try {
      var saved = localStorage.getItem('mj_player_name');
      if (saved && saved.trim()) myName = saved.trim();
    } catch (e) {}
    return [
      { name: myName, ctrl: 'local', av: myName.charAt(0) },
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
    saveHostGameState();

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
      await sleep(p.isBot ? 1000 : 80);
      if (drawTile(pIdx, true) === null) { endRoundDraw(); return { end: true }; }
    } else if (!skip) {
      await sleep(p.isBot ? 1000 : 80);
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
        // Bot turn: realistic human-like thinking delay
        await sleep(1200);
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
    p.guoshui = false; // 出牌后立即解除过水状态！
    p.forbiddenDiscard = null; // 出牌后解除吃牌禁打限制！

    Audio.playTileDrop();
    render();
    scheduleSync();

    // If a bot discarded, give human player clear announcement and 1.6s to observe the tile
    if (p.isBot) {
      showSpeechBubble(pIdx, '打出 ' + Engine.tileName(dTile));
      showToast(p.name + ' 打出【' + Engine.tileName(dTile) + '】');
      await sleep(1600);
    }

    // 4. Claims from other players (吃 / 碰 / 杠 / 胡)
    var claimRes = await processClaims(pIdx, dTile, gen);
    if (gen !== S.gen || S.over) return { end: true };
    if (claimRes) return claimRes;

    if (p.isBot) {
      await sleep(300);
    }

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

    // =========================================================================
    // 动作仲裁优先级规则：胡最大 ＞ 杠 ＞ 碰 ＞ 吃
    // =========================================================================

    // 优先级 1: 胡 (Hu) —— 最高裁决权，胡牌胜出（截胡/一炮双响）
    for (var h = 0; h < answers.length; h++) {
      if (answers[h].act === 'hu') {
        endRoundWin(responders[h], discarder, false);
        return { end: true };
      }
    }

    // 优先级 2: 杠 (Gang) —— 次高裁决权，优先于碰与吃
    for (var g = 0; g < answers.length; g++) {
      if (answers[g].act === 'gang') {
        var gs = responders[g];
        var gp = S.players[gs];
        removeFromHand(gp, tile, 3);
        gp.melds.push({ kind: 'kong', tiles: [tile, tile, tile, tile], from: discarder });
        markDiscardClaimed(discarder, tile, 'gang', gs);
        settleInstant(gs, 2, '明杠');
        showVFX('杠');
        Audio.playGang();
        scheduleSync();
        return { next: gs, skip: 'kong' };
      }
    }

    // 优先级 3: 碰 (Peng) —— 优先于吃
    for (var p = 0; p < answers.length; p++) {
      if (answers[p].act === 'peng') {
        var ps = responders[p];
        var pp = S.players[ps];
        removeFromHand(pp, tile, 2);
        pp.melds.push({ kind: 'pon', tiles: [tile, tile, tile], from: discarder });
        markDiscardClaimed(discarder, tile, 'peng', ps);
        pp.justPeng = true;
        showVFX('碰');
        Audio.playPeng();
        scheduleSync();
        return { next: ps, skip: true };
      }
    }

    // 优先级 4: 吃 (Chi) —— 最低裁决权（仅下家，且其余三家均无人胡、杠、碰时方可吃牌）
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
        markDiscardClaimed(discarder, tile, 'chi', cs);
        // 规则限制：吃牌后本回合必须出牌，且严禁打出刚吃进的牌！
        cp.forbiddenDiscard = tile;
        showVFX('吃');
        Audio.playChi();
        scheduleSync();
        return { next: cs, skip: true };
      }
    }

    // 优先级 5: 全部弃权 / 过水记录（若可胡但点了过，记入过水状态）
    for (var qs = 0; qs < answers.length; qs++) {
      if (answers[qs].couldHu && answers[qs].act === 'pass') {
        S.players[responders[qs]].guoshui = true;
      }
    }

    return null;
  }

  /* 标记桌面上（弃牌池中）被吃/碰/杠走的牌为暗化状态 */
  function markDiscardClaimed(discarderSeat, tile, claimType, claimerSeat) {
    if (!S || !S.players) return;
    var dp = S.players[discarderSeat];
    if (!dp || !dp.discards || dp.discards.length === 0) return;
    for (var i = dp.discards.length - 1; i >= 0; i--) {
      var d = dp.discards[i];
      var t = (typeof d === 'object' && d !== null) ? d.tile : d;
      var alreadyClaimed = (typeof d === 'object' && d !== null) && d.claimed;
      if (t === tile && !alreadyClaimed) {
        dp.discards[i] = {
          tile: tile,
          claimed: true,
          claimType: claimType,
          by: claimerSeat
        };
        break;
      }
    }
  }

  function askClaim(seat, options, gen) {
    var p = S.players[seat];
    if (p.isBot) {
      return new Promise(function(resolve) {
        setTimeout(function() {
          // 机器人选择逻辑同样严格遵循：胡 > 杠 > 碰 > 吃 > 过
          if (options.canHu) {
            resolve({ act: 'hu' });
          } else if (options.canGang && Math.random() < 0.85) {
            resolve({ act: 'gang' });
          } else if (options.canPeng && Math.random() < 0.65) {
            resolve({ act: 'peng' });
          } else if (options.canChi && Math.random() < 0.5) {
            var chiOpts = Engine.findChiOptions(p.hand, options.tile);
            if (chiOpts.length > 0) {
              resolve({ act: 'chi', meld: chiOpts[0] });
            } else {
              resolve({ act: 'pass', couldHu: options.canHu });
            }
          } else {
            resolve({ act: 'pass', couldHu: options.canHu });
          }
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
        payload: payload,
        resolve: resolve,
        timer: null,
        resend: null
      };

      // Fallback timer: 65s for timeout -> bot takeover
      pending.timer = setTimeout(function() {
        if (hostPending[seat] === pending) {
          clearHostPending(seat);
          showToast(p.name + ' 超时，由机器人代打出牌');
          resolve(botTurnDecision(p));
        }
      }, p.online ? 65000 : 8000);

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
        payload: payload,
        resolve: resolve,
        timer: null,
        resend: null
      };

      pending.timer = setTimeout(function() {
        if (hostPending[seat] === pending) {
          clearHostPending(seat);
          resolve({ act: 'pass', couldHu: options.canHu });
        }
      }, p.online ? 25000 : 6000);

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
    saveHostGameState();
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
      } else {
        if (p.forbiddenDiscard !== null && p.forbiddenDiscard !== undefined) {
          showTurnPromptBanner('🔔 吃牌成功！请点击手牌打出一张牌 ⬆（禁打刚吃进的【' + Engine.tileName(p.forbiddenDiscard) + '】）');
        } else if (p.justPeng) {
          p.justPeng = false;
          showTurnPromptBanner('🔔 碰牌成功！请点击手牌打出一张牌 ⬆');
        } else {
          showTurnPromptBanner('🔔 轮到您出牌，请点击手牌打出一张牌 ⬆');
        }
      }

      S.pendingDiscardResolve = function(tile) {
        clearActionBar();
        hideTingTooltip();
        hideTurnPromptBanner();
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
    var chosen = Engine.aiChooseDiscard(p);
    // 机器人也严格遵守吃牌禁打同张规则
    if (p.forbiddenDiscard !== null && p.forbiddenDiscard !== undefined && chosen === p.forbiddenDiscard) {
      var altTiles = p.hand.filter(function(x) { return x !== p.forbiddenDiscard; });
      if (altTiles.length > 0) chosen = altTiles[0];
    }
    return { type: 'discard', tile: chosen };
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

  /* ================= 60s (1 Minute) Turn Timer ================= */
  function startTurnTimer(seat) {
    stopTurnTimer();
    timerRemaining = TURN_TIME_LIMIT;
    updateTimerUI(timerRemaining);

    timerInterval = setInterval(function() {
      timerRemaining--;
      if (timerRemaining <= 0) {
        stopTurnTimer();
        onTimerExpire(seat);
      } else {
        updateTimerUI(timerRemaining);
        if (timerRemaining <= 8 && seat === ME) {
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
    var offset = totalCircumference * (1 - sec / TURN_TIME_LIMIT);
    ringEl.style.strokeDashoffset = offset;

    if (sec <= 8) {
      numEl.className = 'timer-number urgent';
      ringEl.setAttribute('class', 'timer-ring-progress urgent');
    } else if (sec <= 15) {
      numEl.className = 'timer-number';
      ringEl.setAttribute('class', 'timer-ring-progress warning');
    } else {
      numEl.className = 'timer-number';
      ringEl.setAttribute('class', 'timer-ring-progress');
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
      pl.discards.forEach(function(d) {
        var t = (typeof d === 'object' && d !== null) ? d.tile : d;
        counts[t] = (counts[t] || 0) + 1;
      });
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

  /* ================= Turn Prompt Banner ================= */
  function showTurnPromptBanner(text) {
    var el = document.getElementById('turnPromptBanner');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'flex';
  }

  function hideTurnPromptBanner() {
    var el = document.getElementById('turnPromptBanner');
    if (el) el.style.display = 'none';
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
      bar.appendChild(createActionBtn('杠', 'gang', function() {
        if (opts.canHu) {
          showHuOrPengChoicePopup(opts, 'gang', function() { opts.onAction('gang'); });
        } else {
          opts.onAction('gang');
        }
      }));
    }
    if (opts.canPeng) {
      bar.appendChild(createActionBtn('碰', 'peng', function() {
        if (opts.canHu) {
          // 能胡牌时若玩家点击碰牌，提供明确二选一，绝不误操作丢胡！
          showHuOrPengChoicePopup(opts, 'peng', function() { opts.onAction('peng'); });
        } else {
          opts.onAction('peng');
        }
      }));
    }
    if (opts.canChi) {
      var options = Engine.findChiOptions(S.players[ME].hand, opts.tile);
      bar.appendChild(createActionBtn('吃', 'chi', function() {
        if (opts.canHu) {
          showHuOrPengChoicePopup(opts, 'chi', function() {
            if (options.length === 1) opts.onAction('chi', options[0]);
            else showChiChoicePopup(options, opts.onAction);
          });
        } else {
          if (options.length === 1) {
            opts.onAction('chi', options[0]);
          } else {
            showChiChoicePopup(options, opts.onAction);
          }
        }
      }));
    }

    bar.appendChild(createActionBtn('过', 'pass', function() {
      if (opts.canHu) {
        showHuOrPengChoicePopup(opts, 'pass', function() { opts.onAction('pass'); });
      } else {
        opts.onAction('pass');
      }
    }));
  }

  /* 能胡时点击碰/吃/过的防误触二次确认与主动决策选择弹窗 */
  function showHuOrPengChoicePopup(opts, actType, onConfirm) {
    var modal = document.getElementById('choiceConfirmModal');
    var titleEl = document.getElementById('choiceConfirmTitle');
    var subEl = document.getElementById('choiceConfirmSub');
    var btnHu = document.getElementById('choiceBtnHu');
    var btnAlt = document.getElementById('choiceBtnAlt');
    var btnCancel = document.getElementById('choiceBtnCancel');
    if (!modal) {
      onConfirm();
      return;
    }

    var actName = (actType === 'peng' ? '碰牌' : (actType === 'gang' ? '杠牌' : (actType === 'chi' ? '吃牌' : '过牌')));
    titleEl.textContent = '⚡ 雀仙提示：您当前可以直接【胡牌】胜出！';
    if (actType === 'pass') {
      subEl.textContent = '您当前手牌已可胡牌，刚才点击了【过牌】。确定要放弃本次胡牌机会吗？（过水后需等自己出牌后方可再次胡其他家）';
      btnAlt.textContent = '⚠️ 确定过牌（放弃胡牌）';
    } else {
      subEl.textContent = '您当前手牌已可胡牌，刚才点击了【' + actName + '】。您希望立即胡牌胜出，还是确定放弃胡牌改选' + actName + '？（' + actName + '后必须打出一张手牌）';
      btnAlt.textContent = (actType === 'peng' ? '✋ 确定碰牌并出牌' : (actType === 'gang' ? '🀄 确定杠牌' : '🥢 确定吃牌并出牌'));
    }

    modal.style.display = 'flex';

    btnHu.onclick = function() {
      modal.style.display = 'none';
      opts.onAction('hu');
    };

    btnAlt.onclick = function() {
      modal.style.display = 'none';
      onConfirm();
    };

    btnCancel.onclick = function() {
      modal.style.display = 'none';
    };
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
    discards.forEach(function(d, idx) {
      var t = (typeof d === 'object' && d !== null) ? d.tile : d;
      var isClaimed = (typeof d === 'object' && d !== null) && d.claimed;
      var claimType = (isClaimed && d.claimType) ? d.claimType : '';
      var isLast = (S.lastDiscard && S.lastDiscard.tile === t && idx === discards.length - 1 && absSeatAt(pos) === S.lastDiscard.seat);

      var extra = '';
      if (isLast) extra += 'last-discard ';
      if (isClaimed) extra += 'claimed-pool-tile ';

      var tileStr = Engine.tileHTML(t, extra.trim());
      if (isClaimed) {
        var claimLabel = (claimType === 'peng' ? '碰' : (claimType === 'chi' ? '吃' : '杠'));
        var badgeHtml = '<span class="claimed-badge">' + claimLabel + '</span>';
        tileStr = tileStr.replace('</div></div>', badgeHtml + '</div></div>');
      }
      html += tileStr;
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
      var meldList = player.melds || [];
      if (meldList.length > 0) {
        var totalTiles = 0;
        var pCount = 0, cCount = 0, gCount = 0;
        meldList.forEach(function(m) {
          totalTiles += m.tiles.length;
          if (m.kind === 'pon') pCount++;
          else if (m.kind === 'chi') cCount++;
          else if (m.kind === 'kong') gCount++;
        });
        var summary = [];
        if (pCount > 0) summary.push('碰×' + pCount);
        if (cCount > 0) summary.push('吃×' + cCount);
        if (gCount > 0) summary.push('杠×' + gCount);
        meldHTML += '<span class="melds-counter-pill opp">' + summary.join(' ') + ' · 共' + totalTiles + '张</span>';
      }
      meldList.forEach(function(m) {
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
      var isSelected = (S.selectedHandIndex === i);
      var isDrawn = (player.lastDrawn === t && i === player.hand.length - 1);
      var isForbidden = (player.forbiddenDiscard !== null && player.forbiddenDiscard !== undefined && t === player.forbiddenDiscard);
      var extra = (isSelected ? 'selected ' : '') + (isDrawn ? 'drawn-tile ' : '') + (isForbidden ? 'forbidden-discard ' : '');
      var pillHtml = (isSelected && S.current === ME && S.pendingDiscardResolve && !isForbidden) ? '<div class="discard-tap-pill" data-discard="' + t + '">出牌 ⬆</div>' : '';
      var forbiddenBadge = isForbidden ? '<span class="forbidden-discard-badge">🚫禁打</span>' : '';
      var tileStr = Engine.tileHTML(t, extra.trim());
      html += tileStr.replace('data-tile="', 'data-index="' + i + '" data-tile="').replace('</div></div>', pillHtml + forbiddenBadge + '</div></div>');
    });
    handRow.innerHTML = html;

    // Attach tile tap / click listeners & Touch drag to discard
    var tileEls = handRow.querySelectorAll('.mj-tile');
    tileEls.forEach(function(el) {
      var t = parseInt(el.getAttribute('data-tile'), 10);
      var idx = parseInt(el.getAttribute('data-index'), 10);

      // Tap click
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        onHumanTileClick(t, idx);
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
        if (player.forbiddenDiscard !== null && player.forbiddenDiscard !== undefined && dt === player.forbiddenDiscard) {
          showToast('⚠️ 吃牌禁打同张：本回合不能打出刚吃的【' + Engine.tileName(dt) + '】！');
          return;
        }
        if (S.pendingDiscardResolve) {
          var res = S.pendingDiscardResolve;
          S.selectedHandIndex = -1;
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
      var meldList = player.melds || [];
      if (meldList.length > 0) {
        var totalTiles = 0;
        var pCount = 0, cCount = 0, gCount = 0;
        meldList.forEach(function(m) {
          totalTiles += m.tiles.length;
          if (m.kind === 'pon') pCount++;
          else if (m.kind === 'chi') cCount++;
          else if (m.kind === 'kong') gCount++;
        });
        var summary = [];
        if (pCount > 0) summary.push('碰×' + pCount);
        if (cCount > 0) summary.push('吃×' + cCount);
        if (gCount > 0) summary.push('杠×' + gCount);
        mHtml += '<span class="melds-counter-pill">' + summary.join(' ') + ' · 共' + totalTiles + '张</span>';
      }
      meldList.forEach(function(m) {
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
      var mePlayer = S.players[ME];
      if (mePlayer && mePlayer.forbiddenDiscard !== null && mePlayer.forbiddenDiscard !== undefined && tile === mePlayer.forbiddenDiscard) {
        return;
      }
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
        var mePlayer = S.players[ME];
        if (mePlayer && mePlayer.forbiddenDiscard !== null && mePlayer.forbiddenDiscard !== undefined && tile === mePlayer.forbiddenDiscard) {
          showToast('⚠️ 吃牌禁打同张：本回合不能打出刚吃的【' + Engine.tileName(tile) + '】！');
          return;
        }
        var resolve = S.pendingDiscardResolve;
        S.selectedHandIndex = -1;
        S.selectedTile = null;
        hideTingTooltip();
        clearHighlightMatchingTiles();
        resolve(tile);
      }
    });
  }

  function onHumanTileClick(t, i) {
    var mePlayer = S.players[ME];
    if (mePlayer && mePlayer.forbiddenDiscard !== null && mePlayer.forbiddenDiscard !== undefined && t === mePlayer.forbiddenDiscard) {
      showToast('⚠️ 吃牌禁打同张：本回合不能打出刚吃的【' + Engine.tileName(t) + '】！请打出其他手牌');
      highlightMatchingTiles(t);
      Audio.playTileClick();
      return;
    }

    if (S.current !== ME || !S.pendingDiscardResolve) {
      highlightMatchingTiles(t);
      Audio.playTileClick();
      return;
    }

    if (S.selectedHandIndex === i) {
      // Double tap -> Discard!
      var resolve = S.pendingDiscardResolve;
      S.selectedHandIndex = -1;
      S.selectedTile = null;
      hideTingTooltip();
      clearHighlightMatchingTiles();
      resolve(t);
    } else {
      // First tap -> Select & Ting hint & Highlight
      S.selectedHandIndex = i;
      S.selectedTile = t;
      Audio.playTileClick();
      render();
      highlightMatchingTiles(t);
      showTingTooltip(t);
    }
  }

  function highlightMatchingTiles(t) {
    clearHighlightMatchingTiles();
    // 仅高亮桌面上（弃牌池与对手明牌区）已打出的同名牌帮助算牌，绝不高亮手牌中的同名牌，防止手牌多张一起发光的误导！
    var tableTiles = document.querySelectorAll('.discard-pool .mj-tile[data-tile="' + t + '"], .opp-melds .mj-tile[data-tile="' + t + '"], .opp-flowers .mj-tile[data-tile="' + t + '"]');
    tableTiles.forEach(function(el) {
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
    var welcomeInput = document.getElementById('inputWelcomeName');
    var lobbyInput = document.getElementById('inputMyName');
    var defaultNames = ['雀圣', '十三幺', '逢赌必赢', '天胡一色', '九莲宝灯', '自摸手软', '海底捞月', '杠上开花', '雀仙发哥', '大四喜', '一把自摸', '清一色雀王'];

    var currentName = '雀圣';
    try {
      var savedTheme = localStorage.getItem('mj_theme') || 'emerald';
      document.body.setAttribute('data-theme', savedTheme);
      document.querySelectorAll('.theme-choice-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-theme') === savedTheme);
      });

      var savedName = localStorage.getItem('mj_player_name');
      if (savedName && savedName.trim()) currentName = savedName.trim();
    } catch (e) {}

    function updatePlayerName(val) {
      val = (val || '').trim() || '雀圣';
      currentName = val;
      if (welcomeInput) welcomeInput.value = val;
      if (lobbyInput) lobbyInput.value = val;
      try { localStorage.setItem('mj_player_name', val); } catch (e) {}
    }

    updatePlayerName(currentName);

    if (welcomeInput) {
      welcomeInput.addEventListener('change', function() { updatePlayerName(this.value); });
      welcomeInput.addEventListener('input', function() { updatePlayerName(this.value); });
    }
    if (lobbyInput) {
      lobbyInput.addEventListener('change', function() { updatePlayerName(this.value); });
      lobbyInput.addEventListener('input', function() { updatePlayerName(this.value); });
    }

    // Random nickname generator button
    var btnRandom = document.getElementById('btnRandomName');
    if (btnRandom) {
      btnRandom.addEventListener('click', function() {
        Audio.playButton();
        var pick = defaultNames[Math.floor(Math.random() * defaultNames.length)];
        updatePlayerName(pick);
        showToast('已随机生成昵称：' + pick);
      });
    }

    // Toolbar buttons
    var btnChooseMode = document.getElementById('btnChooseMode');
    if (btnChooseMode) {
      btnChooseMode.addEventListener('click', function() {
        Audio.playButton();
        showModal('modalModeSelect');
      });
    }

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

    // BGM (Background Music) Controls
    var btnBgm = document.getElementById('btnBgmToggle');
    var btnSettingsBgm = document.getElementById('btnSettingsBgmToggle');
    var sliderBgmVol = document.getElementById('sliderBgmVolume');

    function syncBgmDisplay() {
      var active = !Audio.bgmMuted;
      if (btnBgm) btnBgm.textContent = active ? '🎵 音乐' : '🔇 音乐';
      if (btnSettingsBgm) btnSettingsBgm.textContent = active ? '🎵 开启' : '🔇 关闭';
      if (sliderBgmVol) sliderBgmVol.value = Audio.bgmVolume;
    }
    syncBgmDisplay();

    if (btnBgm) {
      btnBgm.addEventListener('click', function() {
        Audio.toggleBGM();
        syncBgmDisplay();
        Audio.playButton();
      });
    }
    if (btnSettingsBgm) {
      btnSettingsBgm.addEventListener('click', function() {
        Audio.toggleBGM();
        syncBgmDisplay();
        Audio.playButton();
      });
    }
    if (sliderBgmVol) {
      sliderBgmVol.addEventListener('input', function() {
        Audio.bgmVolume = parseFloat(this.value);
      });
    }

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
      var inRoom = (MODE !== 'single');
      document.getElementById('lobbyCreateJoinArea').style.display = inRoom ? 'none' : 'flex';
      document.getElementById('lobbyRoomActiveArea').style.display = inRoom ? 'block' : 'none';
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
      if (MODE === 'single') {
        if (S) S.round++;
        startRound();
      } else if (MODE === 'host') {
        if (S) S.round++;
        Network.resetAllReady();
        showModal('modalLobby');
        showToast('请等待全员准备后开启第 ' + (S ? S.round : 1) + ' 局');
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

    // Start Single Player button in Welcome Mode Modal
    var btnStartSingle = document.getElementById('btnStartSingle');
    if (btnStartSingle) {
      btnStartSingle.addEventListener('click', function() {
        Audio.playButton();
        if (welcomeInput) updatePlayerName(welcomeInput.value);
        hideModal('modalModeSelect');
        Audio.startBGM();
        MODE = 'single';
        ME = 0;
        VIEW = 0;
        startNewGame();
      });
    }

    // Start Multiplayer button in Welcome Mode Modal
    var btnStartMulti = document.getElementById('btnStartMulti');
    if (btnStartMulti) {
      btnStartMulti.addEventListener('click', function() {
        Audio.playButton();
        if (welcomeInput) updatePlayerName(welcomeInput.value);
        hideModal('modalModeSelect');
        Audio.startBGM();
        var inRoom = (MODE !== 'single');
        document.getElementById('lobbyCreateJoinArea').style.display = inRoom ? 'none' : 'flex';
        document.getElementById('lobbyRoomActiveArea').style.display = inRoom ? 'block' : 'none';
        showModal('modalLobby');
      });
    }

    // Quick toggles in Welcome Mode Modal footer
    var btnModeQuickBgm = document.getElementById('btnModeQuickBgm');
    var btnModeQuickSfx = document.getElementById('btnModeQuickSfx');
    var btnModeQuickRules = document.getElementById('btnModeQuickRules');

    function syncModeQuickToggles() {
      if (btnModeQuickBgm) btnModeQuickBgm.textContent = Audio.bgmMuted ? '🎵 音乐: 关' : '🎵 音乐: 开';
      if (btnModeQuickSfx) btnModeQuickSfx.textContent = Audio.muted ? '🔇 音效: 关' : '🔊 音效: 开';
    }
    syncModeQuickToggles();

    if (btnModeQuickBgm) {
      btnModeQuickBgm.addEventListener('click', function() {
        Audio.toggleBGM();
        syncBgmDisplay();
        syncModeQuickToggles();
        Audio.playButton();
      });
    }
    if (btnModeQuickSfx) {
      btnModeQuickSfx.addEventListener('click', function() {
        Audio.muted = !Audio.muted;
        document.getElementById('btnSoundToggle').textContent = Audio.muted ? '🔇 静音' : '🔊 音效';
        document.getElementById('btnSettingsSoundToggle').textContent = Audio.muted ? '🔇 关闭' : '🔊 开启';
        syncModeQuickToggles();
        Audio.playButton();
      });
    }
    if (btnModeQuickRules) {
      btnModeQuickRules.addEventListener('click', function() {
        Audio.playButton();
        showModal('modalRules');
      });
    }

    var btnManualReconnect = document.getElementById('btnManualReconnect');
    if (btnManualReconnect) {
      btnManualReconnect.addEventListener('click', function() {
        Audio.playButton();
        var sess = Network.currentSession;
        if (sess && sess.code) {
          showToast('正在重新连线...');
          connectOnlineRoom(sess.code, sess.isHost, sess.myName);
        } else {
          var activeMatch = null;
          try {
            activeMatch = JSON.parse(localStorage.getItem('mj_active_match'));
          } catch (e) {}
          if (activeMatch && activeMatch.code) {
            connectOnlineRoom(activeMatch.code, activeMatch.isHost, activeMatch.name);
          } else {
            hideReconnectPill();
            showModal('modalModeSelect');
          }
        }
      });
    }

    // Do NOT automatically start game here - wait for user to select mode!
  }

  /* ================= Multiplayer Connection ================= */
  function connectOnlineRoom(code, asHost, name) {
    showToast('正在连接房间 ' + code + ' ...');

    Network.connect(code, asHost, name, {
      onConnected: function(isHost, roomCode) {
        MODE = isHost ? 'host' : 'guest';
        ME = isHost ? 0 : -1;
        VIEW = isHost ? 0 : 0;
        saveActiveMatch(roomCode, isHost, name);
        hideReconnectPill();

        document.getElementById('lobbyRoomCode').textContent = roomCode;
        var shareLink = Network.getShareLink(roomCode);
        document.getElementById('lobbyShareLink').value = shareLink;
        document.getElementById('btnLeaveRoom').style.display = 'inline-flex';

        document.getElementById('lobbyCreateJoinArea').style.display = 'none';
        document.getElementById('lobbyRoomActiveArea').style.display = 'block';

        // Render QR Code
        var qrCanvas = document.getElementById('lobbyQRCodeCanvas');
        if (window.drawQRCode && qrCanvas) {
          window.drawQRCode(shareLink, qrCanvas, 110);
        }

        if (!S || S.over) {
          showModal('modalLobby');
        }
        showToast('已进入房间 ' + roomCode);
      },
      onChannelConnected: function() {
        hideReconnectPill();
      },
      onChannelDisconnected: function() {
        showReconnectPill('⚠️ 网络连接中断，正在自动重连...');
      },
      onHostTemporaryGone: function(seconds) {
        showReconnectPill('⏳ 房主暂时掉线，等待重连中 (' + seconds + 's)...');
        showToast('房主网络波动暂时离开，保留席位等待重连...');
      },
      onHostRestored: function() {
        hideReconnectPill();
        showToast('🟢 房主已重新连回，对局继续！');
      },
      onLobbyUpdate: function(payload) {
        renderLobbyUI(payload);
      },
      onSeatAssigned: function(seat) {
        ME = seat;
        VIEW = seat;
        hideModal('modalLobby');
        hideModal('modalModeSelect');
        hideModal('modalReconnect');
        hideReconnectPill();
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
        // Find offline seat matching clientId or name
        if (S) {
          for (var i = 1; i < 4; i++) {
            var pl = S.players[i];
            if (pl.clientId === clientId || pl.name === rejoinName) {
              pl.clientId = clientId;
              pl.online = true;
              pl.ctrl = 'remote';
              pl.isBot = false;
              if (Network.currentSession && Network.currentSession.seats[i]) {
                Network.currentSession.seats[i].clientId = clientId;
                Network.currentSession.seats[i].online = true;
                Network.currentSession.seats[i].ready = true;
              }
              showToast(pl.name + ' 成功重新连回对局！');
              render();
              doSync();

              var pd = hostPending[i];
              if (pd) {
                if (pd.type === 'discard') {
                  Network.send('turn', {
                    to: clientId,
                    wid: pd.wid,
                    canTsumo: Engine.canWinHand(pl.hand, pl.melds.length),
                    kongs: S.wall.length ? Engine.findKongs(pl) : []
                  });
                } else if (pd.type === 'claim' && pd.payload) {
                  pd.payload.to = clientId;
                  Network.send('claim', pd.payload);
                }
              }

              return i;
            }
          }
        }
        return -1;
      },
      onChatReceived: function(msg) {
        showSpeechBubble(msg.seat, msg.content);
      },
      onGameStarted: function() {
        hideModal('modalLobby');
        hideModal('modalSettle');
        hideModal('modalModeSelect');
        hideModal('modalReconnect');
        hideReconnectPill();
        showToast('全员已就绪，游戏开始！');
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

    var isHost = (Network.currentSession && Network.currentSession.isHost);
    var startBtn = document.getElementById('btnStartOnlineGame');
    var readyBtn = document.getElementById('btnToggleReady');
    var hintEl = document.getElementById('lobbyStatusHint');

    // 1. Render Seat Cards with Ready Badges
    var html = '';
    payload.seats.forEach(function(s, idx) {
      if (!s) {
        html += '<div class="lobby-seat-card empty">' +
          '<div class="seat-avatar" style="background:#555;">' + (idx + 1) + '</div>' +
          '<div><div style="font-size:13px;color:#aaa;">空位</div><span class="status-tag">🤖 机器人补位</span></div>' +
        '</div>';
      } else if (idx === 0) {
        html += '<div class="lobby-seat-card host">' +
          '<div class="seat-avatar av-0">' + s.name.charAt(0) + '</div>' +
          '<div><div style="font-weight:bold;">' + s.name + '</div>' +
          '<span class="status-tag" style="background:#d4af37;color:#111;font-weight:bold;">👑 房主 (已就绪)</span>' +
          '</div></div>';
      } else {
        var isReady = !!s.ready;
        var cardClass = 'lobby-seat-card ' + (isReady ? 'ready' : 'unready');
        var tagHtml = isReady ?
          '<span class="status-tag" style="background:#2ecc71;color:#fff;font-weight:bold;">✅ 已准备</span>' :
          '<span class="status-tag" style="background:rgba(231,76,60,0.25);color:#ff7675;font-weight:bold;">⏳ 未准备</span>';

        html += '<div class="' + cardClass + '">' +
          '<div class="seat-avatar av-' + idx + '">' + s.name.charAt(0) + '</div>' +
          '<div><div style="font-weight:bold;">' + s.name + '</div>' +
          tagHtml +
          '</div></div>';
      }
    });
    seatsEl.innerHTML = html;

    // 2. Check ready status of all seated human guests (seats 1, 2, 3)
    var seatedGuests = payload.seats.filter(function(s, i) { return s && i !== 0; });
    var unreadyGuests = seatedGuests.filter(function(s) { return !s.ready; });
    var allReady = (unreadyGuests.length === 0);

    // 3. Host Controls: must wait until all players are ready!
    if (isHost) {
      if (startBtn) startBtn.style.display = 'block';
      if (readyBtn) readyBtn.style.display = 'none';

      if (allReady) {
        startBtn.disabled = false;
        startBtn.classList.remove('disabled');
        startBtn.textContent = '🚀 开始游戏（全员已就绪' + (seatedGuests.length > 0 ? '' : '，空位由机器人补齐') + '）';
        if (hintEl) {
          hintEl.textContent = '✨ 所有玩家均已准备完毕，房主可随时开局！';
          hintEl.style.color = '#2ecc71';
        }
      } else {
        startBtn.disabled = true;
        startBtn.classList.add('disabled');
        var readyCount = seatedGuests.length - unreadyGuests.length;
        startBtn.textContent = '⏳ 等待玩家准备中 (' + readyCount + '/' + seatedGuests.length + ' 就绪)';
        if (hintEl) {
          hintEl.textContent = '还有 ' + unreadyGuests.length + ' 位玩家尚未准备，须等待全员准备后方可开始对战';
          hintEl.style.color = '#ff9f43';
        }
      }

      startBtn.onclick = function() {
        if (!allReady) {
          Audio.playButton();
          showToast('尚有玩家未准备，请等待全员准备！');
          return;
        }
        Audio.playButton();
        hideModal('modalLobby');
        Network.broadcastStartGame();
        startNewGame();
      };
    } else {
      // 4. Guest Controls: show Ready Toggle Button
      if (startBtn) startBtn.style.display = 'none';
      if (readyBtn) readyBtn.style.display = 'block';

      var mySeatObj = (ME >= 0 && payload.seats[ME]) ? payload.seats[ME] : null;
      var amIReady = mySeatObj ? !!mySeatObj.ready : false;

      if (amIReady) {
        readyBtn.className = 'ghost-btn';
        readyBtn.textContent = '✅ 已准备 (点击取消准备)';
        readyBtn.style.background = 'rgba(46, 204, 113, 0.2)';
        readyBtn.style.borderColor = '#2ecc71';
        readyBtn.style.color = '#2ecc71';
        readyBtn.style.width = '100%';
        readyBtn.style.padding = '12px 20px';
        readyBtn.style.fontSize = '16px';
        readyBtn.style.fontWeight = 'bold';

        if (hintEl) {
          if (allReady) {
            hintEl.textContent = '✨ 全员准备完毕，等待房主开始对战...';
            hintEl.style.color = '#2ecc71';
          } else {
            hintEl.textContent = '你已准备，正在等待其他玩家准备 (' + (seatedGuests.length - unreadyGuests.length) + '/' + seatedGuests.length + ')';
            hintEl.style.color = 'var(--text-muted)';
          }
        }
      } else {
        readyBtn.className = 'primary-btn orange';
        readyBtn.textContent = '✋ 点击准备 (Ready)';
        readyBtn.style.background = '';
        readyBtn.style.borderColor = '';
        readyBtn.style.color = '';
        readyBtn.style.width = '100%';
        readyBtn.style.padding = '12px 20px';
        readyBtn.style.fontSize = '16px';
        readyBtn.style.fontWeight = 'bold';

        if (hintEl) {
          hintEl.textContent = '⚠️ 请先点击上方按钮准备，全员就绪后房主才可开局';
          hintEl.style.color = '#ff9f43';
        }
      }

      readyBtn.onclick = function() {
        Audio.playButton();
        Network.setMyReady(!amIReady);
      };
    }
  }

  function leaveOnlineRoom() {
    clearActiveMatch();
    hideReconnectPill();
    Network.leave();
    MODE = 'single';
    ME = 0;
    VIEW = 0;
    document.getElementById('btnLeaveRoom').style.display = 'none';
    document.getElementById('lobbyCreateJoinArea').style.display = 'flex';
    document.getElementById('lobbyRoomActiveArea').style.display = 'none';
    hideModal('modalLobby');
    showToast('已退出房间，返回模式选择');
    showModal('modalModeSelect');
  }

  window.MahjongApp = {
    startNewGame: startNewGame,
    render: render
  };
})();
