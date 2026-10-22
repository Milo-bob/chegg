/* CHEGG rules engine (no DOM). Board: 8 columns (x) x 12 rows (y).
   Player 0 (Blue) sits at the bottom and attacks upwards, player 1 (Red) at the top attacks downwards.
   Patterns in data.js are [row, col] with row -1 = "forward"; see offs(). */
const Chegg = (function () {
  const MIN = (typeof MINIONS !== 'undefined') ? MINIONS : require('./data.js').MINIONS;
  const DEF = {};
  MIN.forEach(d => { DEF[d.id] = d; });

  const COLS = 8, ROWS = 12, MAX_MANA = 6, DECK_SIZE = 15, OPENING_HAND = 3;
  const NAMES = ['Blue', 'Red'];
  const LIMITS = { frog: 2, wither: 1, warden: 1, allay: 2, ghast: 1, enderdragon: 1, sulfurcube: 2, wanderingtrader: 2 };
  const ATK = {
    villager: 'target', zombie: 'target', creeper: 'area', pufferfish: 'area', irongolem: 'dir',
    enderman: 'target', skeleton: 'target', blaze: 'target', phantom: 'target', slime: 'target',
    shulkerbox: 'target', wither: 'dir',
    wolf: 'target', bee: 'target', spider: 'target', snowgolem: 'target', horse: 'target', warden: 'target',
    cavespider: 'target', bat: 'target', goat: 'target', camel: 'target', breeze: 'target', armadillo: 'target', bogged: 'target', ghast: 'target',
    coppergolem: 'target', fox: 'target', zombievillager: 'target', evoker: 'target', enderdragon: 'target'
  };
  const LANDS = { villager: 1, slime: 1, shulkerbox: 1, horse: 1, goat: 1 }; // attacker moves onto the target square
  const DIRS = [[1, 0, '→'], [-1, 0, '←'], [0, -1, '↑'], [0, 1, '↓']];

  let G = null;
  let uid = 1;
  let rng = Math.random;          // seeded per match so online clients stay in lockstep
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const inb = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  const at = (x, y) => (inb(x, y) ? G.board[y][x] : null);
  const dark = (x, y) => (x + y) % 2 === 1;
  const fwd = p => (p === 0 ? 1 : -1);
  const zoneOf = p => (p === 0 ? [ROWS - 2, ROWS - 1] : [0, 1]); // spawn rows
  const inZone = (p, y) => zoneOf(p).indexOf(y) >= 0;
  const other = p => 1 - p;

  function offs(m, pattern) {
    const f = fwd(m.owner);
    const out = [];
    for (const [r, c] of pattern) {
      const x = m.x + c * f, y = m.y + r * f;
      if (inb(x, y)) out.push({ x, y });
    }
    return out;
  }
  const around = (x, y) => {
    const o = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if ((dx || dy) && inb(x + dx, y + dy)) o.push({ x: x + dx, y: y + dy });
    }
    return o;
  };

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // allowed: optional {id: true} set restricting which extra minions may appear (unlocks)
  function randomDeck(includeExtras, allowed) {
    const counts = {};
    let total = 0;
    const ids = MIN.filter(d => d.id !== 'villager' && (!d.extra || (includeExtras && (!allowed || allowed[d.id])))).map(d => d.id);
    let guard = 0;
    while (total < DECK_SIZE && guard++ < 1000) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      const lim = LIMITS[id] || 99;
      if ((counts[id] || 0) >= lim) continue;
      // keep expensive cards rare
      if (DEF[id].cost >= 5 && Math.random() < 0.5) continue;
      counts[id] = (counts[id] || 0) + 1;
      total++;
    }
    return counts;
  }
  // classic-only lobbies: every extra minion is swapped for a classic one of similar cost (deterministic)
  const SWAP = { 1: 'zombie', 2: 'pufferfish', 3: 'skeleton', 4: 'slime', 5: 'parrot', 6: 'parrot' };
  function classicOnly(counts) {
    const out = {};
    for (const id of Object.keys(counts)) {
      if (!DEF[id]) continue;
      const to = DEF[id].extra ? SWAP[DEF[id].cost] : id;
      out[to] = (out[to] || 0) + counts[id];
    }
    return out;
  }
  function countsToList(counts) {
    const l = [];
    for (const id of Object.keys(counts).sort()) for (let i = 0; i < counts[id]; i++) l.push(id);
    return l;
  }

  function log(s) { G.log.push(s); if (G.log.length > 60) G.log.shift(); }

  function newGame(deckCounts, seed) {
    uid = 1;
    rng = (seed === undefined || seed === null) ? Math.random : mulberry32(seed);
    G = {
      board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      players: [0, 1].map(i => ({
        deck: shuffle(countsToList(deckCounts[i])), hand: [], mana: 0, turn: 0, villager: null
      })),
      cur: 0, phase: 'place', winner: null, log: [], fx: [], turnNo: 0
    };
    for (const p of G.players) for (let i = 0; i < OPENING_HAND; i++) draw(G.players.indexOf(p), 1, true);
    return G;
  }

  function draw(pi, n, silent) {
    const P = G.players[pi];
    for (let i = 0; i < n; i++) {
      if (!P.deck.length) { if (!silent) log(NAMES[pi] + ' has no cards left to draw.'); return; }
      P.hand.push(P.deck.pop());
    }
  }

  function addFx(kind, x, y) { G.fx.push({ kind, x, y, t: Date.now() }); }

  function spawnMinion(pi, id, x, y) {
    const m = { uid: uid++, id, def: DEF[id], owner: pi, x, y, sick: true, moved: 0, acted: false, dashed: false, alive: true };
    G.board[y][x] = m;
    return m;
  }

  function placeVillager(pi, x, y) {
    if (!inZone(pi, y) || at(x, y)) return false;
    const m = spawnMinion(pi, 'villager', x, y);
    m.sick = false;
    G.players[pi].villager = m;
    return true;
  }

  function startMatch() {
    G.phase = 'play';
    G.cur = 0;
    beginTurn();
  }

  function catCount(pi) {
    let n = 0;
    forEachMinion(m => { if (m.owner === pi && m.id === 'cat') n++; });
    return n;
  }
  function forEachMinion(fn) {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const m = G.board[y][x]; if (m) fn(m); }
  }
  function minionsOf(pi) { const l = []; forEachMinion(m => { if (m.owner === pi) l.push(m); }); return l; }

  function beginTurn() {
    const P = G.players[G.cur];
    P.turn++;
    G.turnNo++;
    P.maxMana = Math.min(MAX_MANA, P.turn) + catCount(G.cur);
    P.mana = P.maxMana;
    if (P.frenzy) { P.mana += 2 * P.frenzy; log(NAMES[G.cur] + ' frenzy: +' + 2 * P.frenzy + ' mana.'); P.frenzy = 0; }
    if (!(G.cur === 0 && P.turn === 1)) draw(G.cur, 1);
    forEachMinion(m => {
      if (m.owner === G.cur) { m.sick = false; m.moved = 0; m.acted = false; m.dashed = false; }
    });
    log(NAMES[G.cur] + "'s turn " + P.turn + ' (' + P.mana + ' mana)');
  }

  function endTurn() {
    if (G.winner !== null) return;
    G.cur = other(G.cur);
    beginTurn();
  }

  /* ---------- removal & effects ---------- */
  function kill(m, by) {
    if (!m || !m.alive) return;
    if (m.id === 'sulfurcube') return;                       // indestructible
    if (m.id === 'coppergolem' && G.aoe) return;             // lightning rod: immune to area damage
    if (m.id === 'evoker' && m.totem !== false) {            // Totem of Undying
      m.totem = false;
      addFx('flash', m.x, m.y);
      log(NAMES[m.owner] + ' Evoker popped its Totem of Undying.');
      return;
    }
    if (m.id === 'armadillo' && m.shell !== false && by && by !== m) {
      m.shell = false;
      addFx('flash', m.x, m.y);
      log(NAMES[m.owner] + ' Armadillo\'s shell absorbed the hit.');
      return;
    }
    m.alive = false;
    G.board[m.y][m.x] = null;
    addFx('boom', m.x, m.y);
    log(NAMES[m.owner] + ' ' + m.def.name + ' was destroyed.');
    if (m.id === 'pig') draw(m.owner, 1);
    if (m.id === 'zombifiedpiglin') {
      const P = G.players[m.owner];
      P.frenzy = (P.frenzy || 0) + 1;
      log(NAMES[m.owner] + ' Zombified Piglin: frenzy! +2 mana next turn.');
      if (G.cur === m.owner) {
        forEachMinion(o => { if (o.owner === m.owner) { o.moved = 0; o.acted = false; o.dashed = false; } });
      }
    }
    if (m.id === 'sniffer') {
      const h = G.players[m.owner].hand;
      for (let i = 0; i < 2 && h.length; i++) h.splice(Math.floor(rng() * h.length), 1);
    }
  }

  function checkWin() {
    const dead = [0, 1].filter(p => !G.players[p].villager.alive);
    if (!dead.length) return;
    // both villagers gone at once: the player who acted loses
    G.loser = dead.length === 2 ? G.cur : dead[0];
    G.winner = other(G.loser);
    log(NAMES[G.winner] + ' wins!');
  }

  // sliding pieces (Ender Dragon) can't pass through other minions
  function pathBlocked(m, sq) {
    if (m.id !== 'enderdragon') return false;
    const sx = Math.sign(sq.x - m.x), sy = Math.sign(sq.y - m.y);
    for (let x = m.x + sx, y = m.y + sy; x !== sq.x || y !== sq.y; x += sx, y += sy) if (at(x, y)) return true;
    return false;
  }
  const ownArmy = (pi, except) => { const l = []; forEachMinion(o => { if (o.owner === pi && o.id !== 'villager' && o !== except) l.push(o); }); return l; };

  function relocate(m, x, y) {
    G.board[m.y][m.x] = null;
    m.x = x; m.y = y;
    G.board[y][x] = m;
  }

  /* ---------- options ---------- */
  function moveOptions(m) {
    const P = G.players[m.owner];
    const out = [];
    if (m.acted) return out;
    const cost = (m.moved > 0 ? 1 : 0) + (m.id === 'villager' ? 1 : 0);
    if (P.mana < cost) return out;
    for (const sq of offs(m, m.def.movePattern)) {
      if (at(sq.x, sq.y)) continue;
      if (pathBlocked(m, sq)) continue;
      if (m.id === 'phantom' && !dark(sq.x, sq.y)) continue;
      const midX = (m.x + sq.x) / 2, midY = (m.y + sq.y) / 2;
      const jump = m.id === 'rabbit' && Number.isInteger(midX) && Number.isInteger(midY) && !!at(midX, midY);
      out.push({
        kind: 'move', m, cost, click: sq, affected: [],
        run() {
          relocate(m, sq.x, sq.y);
          m.moved++;
          if (m.moved > 1) m.dashed = true;
          if (jump) { draw(m.owner, 1); log('Rabbit hopped over a minion: card drawn.'); }
        }
      });
    }
    return out;
  }

  function shulkerBlocked(m, sq) {
    const dx = sq.x - m.x, dy = sq.y - m.y;
    if ((dx === 0 || dy === 0) && Math.abs(dx + dy) === 2) {
      return !!at(m.x + dx / 2, m.y + dy / 2);
    }
    return false;
  }

  function attackOptions(m, sd, via) {
    const out = [];
    const kind = ATK[sd.id];
    if (!kind) return out;
    const P = G.players[m.owner];
    const cost = sd.id === 'wither' ? 2 : 1;
    if (P.mana < cost) return out;
    const enemy = t => t && t.owner !== m.owner;
    const tag = via ? ' (' + sd.name + ')' : '';
    const darkOnly = m.id === 'phantom' || sd.id === 'phantom';

    if (kind === 'target') {
      for (const sq of offs(m, sd.attackPattern)) {
        const t = at(sq.x, sq.y);
        if (!enemy(t)) continue;
        if (pathBlocked(m, sq)) continue;
        if (darkOnly && !dark(sq.x, sq.y)) continue;
        if (sd.id === 'shulkerbox' && shulkerBlocked(m, sq)) continue;
        out.push({
          kind: 'attack', m, cost, click: sq, affected: [sq], victims: [t],
          run() {
            kill(t, m);
            if (!t.alive && sd.id === 'fox') { draw(m.owner, 1); log('Fox stole a card.'); }
            if (!t.alive && sd.id === 'zombievillager' && t.id !== 'villager' && !at(sq.x, sq.y)) {
              spawnMinion(m.owner, 'zombie', sq.x, sq.y);
              log('Zombie Villager infected a ' + t.def.name + ': a Zombie rises.');
            }
            if (LANDS[sd.id] && !at(sq.x, sq.y)) relocate(m, sq.x, sq.y);
            if (sd.id === 'bee') kill(m, m);
          }
        });
      }
    } else if (kind === 'area') {
      const aff = offs(m, sd.attackPattern).filter(sq => at(sq.x, sq.y));
      if (!aff.some(sq => enemy(at(sq.x, sq.y)))) return out;
      const victims = aff.map(sq => at(sq.x, sq.y));
      const self = sd.id === 'creeper';
      out.push({
        kind: 'attack', m, cost, badge: true, label: (self ? 'Detonate' : 'Burst') + ' (' + cost + ')' + tag,
        affected: aff.slice(), victims: self ? victims.concat([m]) : victims,
        run() {
          addFx('flash', m.x, m.y);
          G.aoe = true; victims.forEach(v => kill(v, m)); G.aoe = false;
          if (self) kill(m, m);
        }
      });
    } else if (kind === 'dir') {
      for (const [dx, dy, arrow] of DIRS) {
        const tiles = [];
        if (sd.id === 'irongolem') {
          const nx = m.x + dx, ny = m.y + dy;
          for (let t = -1; t <= 1; t++) tiles.push({ x: nx + t * dy, y: ny + t * dx });
        } else {
          for (let k = 1; k <= 3; k++) {
            const px = m.x + k * dx, py = m.y + k * dy;
            tiles.push({ x: px, y: py }, { x: px + dy, y: py + dx }, { x: px - dy, y: py - dx });
          }
        }
        const aff = tiles.filter(s => inb(s.x, s.y));
        const victims = aff.map(s => at(s.x, s.y)).filter(Boolean);
        if (!victims.some(enemy)) continue;
        out.push({
          kind: 'attack', m, cost,
          clicks: aff.filter(s => enemy(at(s.x, s.y))),
          label: (sd.id === 'irongolem' ? 'Sweep ' : 'Fire ') + arrow + ' (' + cost + ')' + tag,
          affected: aff, victims,
          run() { addFx('flash', m.x + dx, m.y + dy); G.aoe = true; victims.forEach(v => kill(v, m)); G.aoe = false; }
        });
      }
    }
    return out;
  }

  function allAttackOptions(m) {
    if (m.acted || m.dashed) return [];
    if (m.id === 'parrot') {
      let out = [];
      for (const [dx, dy] of DIRS) {
        const n = at(m.x + dx, m.y + dy);
        if (n && n.id !== 'parrot') out = out.concat(attackOptions(m, n.def, true));
      }
      return out;
    }
    return attackOptions(m, m.def, false);
  }

  function lineTargets(m) {
    const l = [];
    for (const [dx, dy] of DIRS) {
      let x = m.x + dx, y = m.y + dy;
      while (inb(x, y)) { const t = at(x, y); if (t) l.push(t); x += dx; y += dy; }
    }
    return l;
  }

  function specialOptions(m) {
    const out = [];
    const P = G.players[m.owner];
    if (m.acted || P.mana < 1) return out;
    if (m.id === 'frog') {
      for (const t of lineTargets(m)) {
        const dx = Math.sign(m.x - t.x), dy = Math.sign(m.y - t.y);
        const dist = Math.abs(m.x - t.x) + Math.abs(m.y - t.y);
        let steps = 0, x = t.x, y = t.y;
        while (steps < Math.min(2, dist - 1) && !at(x + dx, y + dy)) { x += dx; y += dy; steps++; }
        if (!steps) continue;
        const tx = x, ty = y;
        out.push({
          kind: 'special', m, cost: 1, click: { x: t.x, y: t.y }, affected: [{ x: tx, y: ty }],
          run() { relocate(t, tx, ty); m.acted = true; log('Frog pulled a ' + t.def.name + '.'); }
        });
      }
    } else if (m.id === 'witch') {
      forEachMinion(t => {
        if (t === m || t.owner !== m.owner || t.id === 'witch' || Math.max(Math.abs(t.x - m.x), Math.abs(t.y - m.y)) > 2) return;
        if (!t.moved && !t.acted && !t.dashed) return;
        out.push({
          kind: 'special', m, cost: 1, click: { x: t.x, y: t.y }, affected: [{ x: t.x, y: t.y }],
          run() { t.moved = 0; t.acted = false; t.dashed = false; t.sick = false; m.acted = true; log('Witch refreshed a ' + t.def.name + '.'); }
        });
      });
    } else if (m.id === 'enderman') {
      for (const t of lineTargets(m)) {
        if (t.id === 'villager') continue;
        out.push({
          kind: 'special', m, cost: 1, click: { x: t.x, y: t.y }, affected: [{ x: m.x, y: m.y }],
          run() {
            const ax = m.x, ay = m.y, bx = t.x, by = t.y;
            G.board[ay][ax] = null; G.board[by][bx] = null;
            m.x = bx; m.y = by; t.x = ax; t.y = ay;
            G.board[by][bx] = m; G.board[ay][ax] = t;
            m.acted = true;
            log('Enderman teleported.');
          }
        });
      }
    }
    return out;
  }
  const hasSpecial = m => m.id === 'frog' || m.id === 'enderman' || m.id === 'witch';

  function actionsFor(m, mode) {
    if (!m || !m.alive || m.sick || G.winner !== null) return [];
    if (mode === 'special') return specialOptions(m);
    return moveOptions(m).concat(allAttackOptions(m));
  }

  function spawnOptions(pi, ci) {
    const P = G.players[pi];
    const id = P.hand[ci];
    if (!id) return [];
    const d = DEF[id];
    if (d.cost > P.mana) return [];
    const out = [];
    for (const y of zoneOf(pi)) for (let x = 0; x < COLS; x++) {
      if (at(x, y)) continue;
      if (id === 'phantom' && !dark(x, y)) continue;
      out.push({
        kind: 'spawn', cost: d.cost, click: { x, y }, card: ci, id,
        affected: id === 'wither' ? around(x, y) : id === 'enderdragon' ? ownArmy(pi).map(o => ({ x: o.x, y: o.y })) : [],
        victims: id === 'wither' ? around(x, y).map(s => at(s.x, s.y)).filter(Boolean) : id === 'enderdragon' ? ownArmy(pi) : []
      });
    }
    return out;
  }

  function doSpawn(opt) {
    const pi = G.cur, P = G.players[pi];
    P.mana -= opt.cost;
    P.hand.splice(opt.card, 1);
    const m = spawnMinion(pi, opt.id, opt.click.x, opt.click.y);
    log(NAMES[pi] + ' spawned ' + m.def.name + '.');
    if (opt.id === 'pig') draw(pi, 1);
    if (opt.id === 'chicken') { P.mana += 1; log('Chicken laid an egg: 1 mana refunded.'); }
    if (opt.id === 'wanderingtrader') {
      draw(pi, 2);
      if (P.hand.length) P.hand.splice(Math.floor(rng() * P.hand.length), 1);
      log('Wandering Trader: traded cards.');
    }
    if (opt.id === 'allay') { P.mana += 2; log('Allay: +2 mana.'); }
    if (opt.id === 'sniffer') {
      const opp = G.players[other(pi)];
      for (let i = 0; i < 2 && opp.deck.length; i++) P.hand.push(opp.deck.pop());
      log('Sniffer stole cards from the enemy deck.');
    }
    if (opt.id === 'enderdragon') {
      addFx('flash', m.x, m.y);
      G.aoe = true;
      ownArmy(pi, m).forEach(o => kill(o));
      G.aoe = false;
      log('Ender Dragon devoured its own army.');
    }
    if (opt.id === 'wither') {
      addFx('flash', m.x, m.y);
      G.aoe = true;
      around(m.x, m.y).forEach(s => kill(at(s.x, s.y)));
      G.aoe = false;
    }
    checkWin();
    return m;
  }

  function perform(opt) {
    if (G.winner !== null) return;
    if (opt.kind === 'spawn') { doSpawn(opt); return; }
    const P = G.players[opt.m.owner];
    P.mana -= opt.cost;
    if (opt.kind === 'attack') opt.m.acted = true;
    opt.run();
    checkWin();
  }

  /* ---------- action API (online lockstep) ---------- */
  function optKey(o) {
    return [o.kind, o.m ? o.m.uid : '', o.kind === 'spawn' ? o.card : '', o.click ? o.click.x + ',' + o.click.y : '', o.label || ''].join('|');
  }
  function allOptions() {
    const pi = G.cur, P = G.players[pi];
    let out = [];
    for (let i = 0; i < P.hand.length; i++) out = out.concat(spawnOptions(pi, i));
    for (const m of minionsOf(pi)) {
      out = out.concat(actionsFor(m, 'normal'));
      if (hasSpecial(m)) out = out.concat(actionsFor(m, 'special'));
    }
    return out;
  }
  const BAD = err => ({ ok: false, err });
  // a = {t:'place',p,x,y} | {t:'opt',p,k} | {t:'end',p} | {t:'resign',p}
  function applyAction(a) {
    if (!G || G.winner !== null) return BAD('game over');
    if (a.t === 'resign') {
      G.loser = a.p; G.winner = other(a.p); G.resigned = true; log(NAMES[a.p] + ' resigned.');
      return { ok: true };
    }
    if (a.t === 'place') {
      if (G.phase !== 'place') return BAD('not placing');
      const p = G.players[0].villager ? 1 : 0;
      if (a.p !== p || !placeVillager(p, a.x, a.y)) return BAD('bad placement');
      if (G.players[0].villager && G.players[1].villager) startMatch();
      return { ok: true };
    }
    if (G.phase !== 'play' || a.p !== G.cur) return BAD('not your turn');
    if (a.t === 'end') { endTurn(); return { ok: true }; }
    if (a.t === 'opt') {
      const o = allOptions().find(q => optKey(q) === a.k);
      if (!o) return BAD('illegal action');
      perform(o);
      return { ok: true };
    }
    return BAD('unknown action');
  }

  /* ---------- AI ---------- */
  function value(m) { return m.id === 'villager' ? 1000 : m.def.cost + 2; }

  function threatSquares(owner) {
    // squares the enemy of `owner` could hit (approximation by raw patterns)
    const set = {};
    forEachMinion(e => {
      if (e.owner === owner) return;
      let sqs = [];
      const k = ATK[e.id];
      if (k === 'dir') {
        if (e.id === 'irongolem') sqs = around(e.x, e.y);
        else for (const [dx, dy] of DIRS) for (let q = 1; q <= 3; q++) sqs.push({ x: e.x + dx * q, y: e.y + dy * q });
      } else if (k) sqs = offs(e, e.def.attackPattern);
      sqs.forEach(s => { set[s.x + ',' + s.y] = (set[s.x + ',' + s.y] || 0) + 1; });
    });
    return set;
  }

  function enemyVillager(pi) { return G.players[other(pi)].villager; }
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  function score(opt, pi, threats) {
    const ev = enemyVillager(pi);
    if (opt.kind === 'spawn') {
      const P0 = G.players[pi];
      let s = 2 + opt.cost * 1.6;
      const id = opt.id;
      if (id === 'cat') s = catCount(pi) ? -5 : 7;
      if (id === 'pig') s = 4;
      if (id === 'chicken') s = 3.5;
      if (id === 'allay') s =P0.mana >= 5 ? 5 : 3;
      if (id === 'sniffer') s = 3;
      if (id === 'parrot' || id === 'frog' || id === 'enderman') s -= 2;
      if (id === 'creeper') s -= 1;
      if (id === 'shulkerbox') s += 1;
      if (opt.victims.length) {
        for (const v of opt.victims) s += (v.owner === pi ? -1 : 1) * value(v) * 1.2;
      }
      // frontline bias: prefer squares facing the enemy
      const adv = pi === 0 ? ROWS - 1 - opt.click.y : opt.click.y;
      s += adv * 0.3 + Math.random() * 0.4;
      return s;
    }
    const m = opt.m;
    const key = m.x + ',' + m.y;
    if (opt.kind === 'attack' || opt.kind === 'special') {
      let s = 0;
      if (opt.kind === 'attack') {
        for (const v of opt.victims) s += (v.owner === pi ? -1.2 : 1.3) * value(v);
        if (!opt.victims.length) return -9;
        s += 1;
      } else {
        // special: reward bringing enemies close to our attackers, small otherwise
        s = m.id === 'frog' ? 1.2 : 0.8;
        const t = at(opt.click.x, opt.click.y);
        if (t && t.owner === pi) s -= 3;
        if (t && t.owner !== pi && t.id === 'villager') s += 2;
      }
      if (opt.cost > 1) s -= 0.5;
      return s + Math.random() * 0.2;
    }
    // move
    let s = 0;
    const before = dist(m, ev), after = dist(opt.click, ev);
    if (m.id === 'villager') {
      const nowT = threats[key] || 0, newT = threats[opt.click.x + ',' + opt.click.y] || 0;
      s = (nowT - newT) * 6 - (nowT ? 0 : 8);
    } else if (['pig', 'sniffer', 'frog', 'parrot', 'shulkerbox'].indexOf(m.id) >= 0) {
      s = (before - after) * 0.3;
    } else {
      s = (before - after) * (1.4 + G.players[pi].turn / 20);
      const nowT = threats[key] || 0, newT = threats[opt.click.x + ',' + opt.click.y] || 0;
      s += (nowT - newT) * (m.def.cost + 1) * 0.6 * Math.max(0, 1 - G.players[pi].turn / 25);
    }
    if (m.id === 'creeper' && after <= 2) s += 1;
    s -= opt.cost * 1.1;
    if (m.moved > 0) s -= 0.8;
    return s + Math.random() * 0.3;
  }

  function aiNext() {
    const pi = G.cur, P = G.players[pi];
    const threats = threatSquares(pi);
    let best = null, bestS = 0.5;
    const consider = o => { const s = score(o, pi, threats); if (s > bestS) { bestS = s; best = o; } };
    for (let i = 0; i < P.hand.length; i++) spawnOptions(pi, i).forEach(consider);
    for (const m of minionsOf(pi)) {
      actionsFor(m, 'normal').forEach(consider);
      if (hasSpecial(m)) actionsFor(m, 'special').forEach(consider);
    }
    return best;
  }

  return {
    DEF, MIN, COLS, ROWS, DECK_SIZE, NAMES, LIMITS, DIRS,
    get G() { return G; },
    newGame, applyAction, allOptions, optKey, placeVillager, startMatch, endTurn, perform, actionsFor, spawnOptions, hasSpecial,
    randomDeck, classicOnly, zoneOf, dark, inb, at, minionsOf, aiNext, checkWin, countsToList
  };
})();

if (typeof module !== 'undefined') module.exports = Chegg;
