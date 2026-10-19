/**
 * Mahjong Online Networking & Room Management
 * Powered by Supabase Realtime Broadcast & Presence.
 * Supports room creation, 4-letter room codes, QR code invitation, quick chat & emojis,
 * latency-tolerant re-sending, and auto-bot takeover on disconnect.
 */
(function() {
  'use strict';

  var SB_URL = 'https://hlfnvlyouhsvwhufxxqu.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZm52bHlvdWhzdndodWZ4eHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNzI5NDQsImV4cCI6MjEwNjc0ODk0NH0.k05JdhRfPDZYIe4ppkR8cUiXTIWJyrKQsMP5paiIvJg';

  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function genRoomCode() {
    var s = '';
    for (var i = 0; i < 4; i++) {
      s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return s;
  }

  function getShareLink(code) {
    var loc = window.location;
    var base = loc.protocol + '//' + loc.host + loc.pathname;
    return base + '?room=' + code;
  }

  function cleanName(s) {
    return (s || '').replace(/[<>&"'\s]/g, '').slice(0, 8);
  }

  function getMyClientId() {
    var id = null;
    try {
      id = localStorage.getItem('mj_client_id');
      if (!id) {
        id = 'c_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
        localStorage.setItem('mj_client_id', id);
      }
    } catch (e) {
      id = 'c_' + Math.random().toString(36).slice(2, 9);
    }
    return id;
  }

  var session = null;

  var MahjongNetwork = {
    get currentSession() {
      return session;
    },

    genRoomCode: genRoomCode,
    getShareLink: getShareLink,
    cleanName: cleanName,
    getMyClientId: getMyClientId,

    connect: function(code, asHost, name, handlers) {
      if (!window.supabase) {
        if (handlers.onError) handlers.onError('Supabase SDK 未能加载，请检查网络后刷新重试');
        return;
      }
      this.leave();

      var myId = getMyClientId();
      session = {
        code: code,
        isHost: asHost,
        myName: cleanName(name) || (asHost ? '房主' : '玩家'),
        myId: myId,
        mySeat: asHost ? 0 : -1,
        seats: [null, null, null, null],
        started: false,
        seq: 0,
        fxSeq: 0,
        fxText: '',
        endSeq: 0,
        endInfo: null,
        endShownSeq: 0,
        pending: {},
        presenceKeys: {},
        hostSeen: false,
        hostGoneTimer: null,
        guestInLobby: false,
        myHand: null,
        myDrawn: null,
        lastRoundSeen: -1,
        lastHistLen: 0,
        lobbySeats: null,
        syncTimer: null,
        lastSeq: 0,
        lobbySeq: 0,
        answered: null,
        waitSeq: 0,
        client: null,
        channel: null,
        handlers: handlers || {}
      };

      if (asHost) {
        session.seats[0] = { clientId: myId, name: session.myName, online: true, host: true, ready: true };
      }

      var client = window.supabase.createClient(SB_URL, SB_KEY);
      session.client = client;

      var ch = client.channel('room-' + code, {
        config: {
          broadcast: { self: false },
          presence: { key: myId }
        }
      });
      session.channel = ch;

      // Event listeners
      ch.on('presence', { event: 'sync' }, function() {
        MahjongNetwork.onPresenceSync();
      });

      ch.on('broadcast', { event: 'join' }, function(m) {
        if (session && session.isHost && m.payload) MahjongNetwork.onHostJoin(m.payload);
      });

      ch.on('broadcast', { event: 'ready' }, function(m) {
        if (session && session.isHost && m.payload) MahjongNetwork.onHostGuestReady(m.payload);
      });

      ch.on('broadcast', { event: 'start-game' }, function(m) {
        if (session && !session.isHost && session.handlers.onGameStarted) {
          session.handlers.onGameStarted(m.payload);
        }
      });

      ch.on('broadcast', { event: 'lobby' }, function(m) {
        if (session && !session.isHost && m.payload) {
          session.lobbySeats = m.payload.seats;
          session.started = !!m.payload.started;
          if (session.handlers.onLobbyUpdate) session.handlers.onLobbyUpdate(m.payload);
        }
      });

      ch.on('broadcast', { event: 'assign' }, function(m) {
        if (session && !session.isHost && m.payload && m.payload.to === session.myId) {
          session.mySeat = m.payload.seat;
          if (session.handlers.onSeatAssigned) session.handlers.onSeatAssigned(session.mySeat);
        }
      });

      ch.on('broadcast', { event: 'state' }, function(m) {
        if (session && !session.isHost && m.payload && session.handlers.onStateReceived) {
          session.handlers.onStateReceived(m.payload);
        }
      });

      ch.on('broadcast', { event: 'hand' }, function(m) {
        if (session && !session.isHost && m.payload && m.payload.to === session.myId) {
          session.myHand = m.payload.hand;
          session.myDrawn = m.payload.lastDrawn;
          if (session.handlers.onHandReceived) session.handlers.onHandReceived(m.payload.hand, m.payload.lastDrawn);
        }
      });

      ch.on('broadcast', { event: 'turn' }, function(m) {
        if (session && !session.isHost && m.payload && m.payload.to === session.myId) {
          if (session.handlers.onGuestTurn) session.handlers.onGuestTurn(m.payload);
        }
      });

      ch.on('broadcast', { event: 'claim' }, function(m) {
        if (session && !session.isHost && m.payload && m.payload.to === session.myId) {
          if (session.handlers.onGuestClaim) session.handlers.onGuestClaim(m.payload);
        }
      });

      ch.on('broadcast', { event: 'action' }, function(m) {
        if (session && session.isHost && m.payload && session.handlers.onGuestAction) {
          session.handlers.onGuestAction(m.payload);
        }
      });

      ch.on('broadcast', { event: 'claim-answer' }, function(m) {
        if (session && session.isHost && m.payload && session.handlers.onGuestClaimAnswer) {
          session.handlers.onGuestClaimAnswer(m.payload);
        }
      });

      ch.on('broadcast', { event: 'bye' }, function(m) {
        if (session && session.isHost && m.payload && session.handlers.onGuestBye) {
          session.handlers.onGuestBye(m.payload);
        }
      });

      ch.on('broadcast', { event: 'chat' }, function(m) {
        if (session && m.payload && session.handlers.onChatReceived) {
          session.handlers.onChatReceived(m.payload);
        }
      });

      ch.on('broadcast', { event: 'room-note' }, function(m) {
        if (session && !session.isHost && m.payload && m.payload.to === session.myId) {
          if (session.handlers.onToast) session.handlers.onToast(m.payload.text);
        }
      });

      ch.subscribe(function(status) {
        if (!session) return;
        if (status === 'SUBSCRIBED') {
          ch.track({ name: session.myName, role: asHost ? 'host' : 'guest' });
          if (asHost) {
            MahjongNetwork.broadcastLobby();
          } else {
            MahjongNetwork.send('join', { clientId: session.myId, name: session.myName });
          }
          if (session.handlers.onConnected) session.handlers.onConnected(asHost, code);
          if (session.handlers.onChannelConnected) session.handlers.onChannelConnected();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (session.handlers.onChannelDisconnected) session.handlers.onChannelDisconnected();
        }
      });
    },

    send: function(event, payload) {
      if (session && session.channel) {
        session.channel.send({ type: 'broadcast', event: event, payload: payload });
      }
    },

    sendChat: function(type, content, senderName, senderSeat) {
      if (!session) return;
      this.send('chat', {
        type: type, // 'phrase' | 'emoji'
        content: content,
        name: senderName || session.myName,
        seat: senderSeat !== undefined ? senderSeat : session.mySeat,
        time: Date.now()
      });
    },

    onPresenceSync: function() {
      if (!session || !session.channel) return;
      var st = session.channel.presenceState();
      var keys = {};
      Object.keys(st).forEach(function(k) { keys[k] = true; });
      session.presenceKeys = keys;

      if (session.isHost) {
        var changed = false;
        for (var i = 1; i < 4; i++) {
          var s = session.seats[i];
          if (!s) continue;
          var on = !!keys[s.clientId];
          if (on === (s.online !== false)) continue;
          s.online = on;
          changed = true;
          if (session.handlers.onPlayerOnlineChange) {
            session.handlers.onPlayerOnlineChange(i, on, s.name);
          }
        }
        if (changed) {
          MahjongNetwork.broadcastLobby();
        }
      } else {
        var hostHere = false;
        Object.keys(st).forEach(function(k) {
          (st[k] || []).forEach(function(m) {
            if (m.role === 'host') hostHere = true;
          });
        });
        if (hostHere) {
          session.hostSeen = true;
          if (session.hostGoneTimer) {
            clearTimeout(session.hostGoneTimer);
            session.hostGoneTimer = null;
            if (session.handlers.onHostRestored) session.handlers.onHostRestored();
          }
        } else if (session.hostSeen && !session.hostGoneTimer) {
          if (session.handlers.onHostTemporaryGone) session.handlers.onHostTemporaryGone(60);
          session.hostGoneTimer = setTimeout(function() {
            session.hostGoneTimer = null;
            session.hostSeen = false;
            if (session.handlers.onHostGone) session.handlers.onHostGone();
          }, 60000);
        }
      }
    },

    onHostJoin: function(p) {
      if (!p || !p.clientId || typeof p.name !== 'string' || !session) return;
      var clean = cleanName(p.name) || '玩家';

      // 1. Mid-game rejoin (match by clientId or name)
      if (session.started && session.handlers.onGuestRejoin) {
        var seat = session.handlers.onGuestRejoin(clean, p.clientId);
        if (seat >= 0) {
          this.send('assign', { to: p.clientId, seat: seat });
          this.broadcastLobby();
          return;
        }
        this.send('room-note', { to: p.clientId, text: '这局游戏已经开始，座位不匹配' });
        return;
      }

      // 2. Already in lobby (matched by clientId)
      for (var i = 0; i < 4; i++) {
        var s = session.seats[i];
        if (s && s.clientId === p.clientId) {
          s.online = true;
          this.send('assign', { to: p.clientId, seat: i });
          this.broadcastLobby();
          return;
        }
      }

      // 3. Reconnect lobby slot with same name or clientId
      for (var j = 1; j < 4; j++) {
        var s2 = session.seats[j];
        if (s2 && (s2.name === clean || s2.clientId === p.clientId)) {
          s2.clientId = p.clientId;
          s2.online = true;
          this.send('assign', { to: p.clientId, seat: j });
          this.broadcastLobby();
          return;
        }
      }

      // 4. Fresh empty seat
      for (var k = 1; k < 4; k++) {
        if (!session.seats[k]) {
          session.seats[k] = { clientId: p.clientId, name: clean, online: true, host: false, ready: false };
          this.send('assign', { to: p.clientId, seat: k });
          this.broadcastLobby();
          return;
        }
      }

      this.send('room-note', { to: p.clientId, text: '房间已满（4人），无法加入' });
    },

    onHostGuestReady: function(p) {
      if (!session || !session.isHost || !p || !p.clientId) return;
      for (var i = 1; i < 4; i++) {
        var s = session.seats[i];
        if (s && s.clientId === p.clientId) {
          s.ready = !!p.ready;
          this.broadcastLobby();
          return;
        }
      }
    },

    setMyReady: function(ready) {
      if (!session) return;
      session.myReady = !!ready;
      if (session.isHost) {
        this.broadcastLobby();
      } else {
        this.send('ready', {
          clientId: session.myId,
          seat: session.mySeat,
          ready: session.myReady
        });
      }
    },

    broadcastStartGame: function() {
      if (!session || !session.isHost) return;
      session.started = true;
      this.send('start-game', { code: session.code, time: Date.now() });
      this.broadcastLobby();
    },

    resetAllReady: function() {
      if (!session || !session.isHost) return;
      for (var i = 1; i < 4; i++) {
        if (session.seats[i]) session.seats[i].ready = false;
      }
      this.broadcastLobby();
    },

    broadcastLobby: function() {
      if (!session || !session.isHost) return;
      var payload = {
        code: session.code,
        started: session.started,
        seats: session.seats.map(function(s, i) {
          if (!s) return null;
          return {
            name: s.name,
            clientId: s.clientId,
            online: !!(session.presenceKeys && session.presenceKeys[s.clientId]) || i === 0,
            host: i === 0,
            ready: i === 0 ? true : !!s.ready
          };
        })
      };
      this.send('lobby', payload);
      if (session.handlers.onLobbyUpdate) session.handlers.onLobbyUpdate(payload);
    },

    leave: function() {
      if (session) {
        if (session.hostGoneTimer) {
          clearTimeout(session.hostGoneTimer);
          session.hostGoneTimer = null;
        }
        if (!session.isHost && session.channel) {
          this.send('bye', { from: session.myId });
        }
        if (session.channel && session.client) {
          try { session.channel.untrack(); } catch (e) {}
          try { session.client.removeChannel(session.channel); } catch (e) {}
        }
      }
      session = null;
    }
  };

  window.MahjongNetwork = MahjongNetwork;
})();
