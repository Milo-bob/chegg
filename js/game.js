/* CHEGG - UI layer (canvas). Rules live in rules.js. */
(function () {
  'use strict';
  const C = Chegg;
  const W = 1600, H = 900, COLS = C.COLS, ROWS = C.ROWS, CELL = 80, BX = 400, BY = 30;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const PCOL = ['#3f7ae8', '#e04a42'];
  const PCOL_D = ['#1b3b8a', '#8a1f1b'];
  const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

  /* ---------- assets ---------- */
  const img = {};
  let pending = 0;
  function load(key, src) {
    const i = new Image();
    pending++;
    i.onload = i.onerror = () => { pending--; };
    i.src = src;
    img[key] = i;
  }
  C.MIN.forEach(d => load(d.id, d.img));
  ['basalt', 'calcite', 'blueconcrete', 'lightblueconcrete', 'redconcrete', 'orangeconcrete', 'lightgrayconcrete']
    .forEach(t => load(t, 'assets/tiles/' + t + '.jpg'));

  /* ---------- state ---------- */
  let screen = 'menu';            // menu | help | deck | place | play
  let mode = 'ai';                // ai | local
  let deckCounts = [{}, {}];
  let buildFor = 0;
  let placeFor = 0;
  let pass = null;                // {text, cb} hotseat hand-over overlay
  let confirmMenu = false, paused = false;
  let sel = null, selMode = 'normal', spawnCard = null;
  let msg = '', msgT = 0;
  let mouse = { x: -1, y: -1 };
  let hoverDef = null, hoverNext = null, hoverBtnPreview = null;
  let btns = [], prevBtns = [];
  let aiBusy = false, aiToken = 0;
  let overSent = false;

  try {
    const saved = JSON.parse(localStorage.getItem('chegg_deck_v1') || 'null');
    if (saved && typeof saved === 'object') deckCounts[0] = saved;
  } catch (e) { /* storage unavailable */ }
  function saveDeck() {
    try { localStorage.setItem('chegg_deck_v1', JSON.stringify(deckCounts[0])); } catch (e) { /* ignore */ }
  }

  const G = () => C.G;
  const total = c => Object.keys(c).reduce((a, k) => a + c[k], 0);
  const isHumanTurn = () => mode === 'local' || G().cur === 0;
  function say(s) { msg = s; msgT = Date.now(); }
  function post(o) { try { window.parent.postMessage(o, '*'); } catch (e) { /* ignore */ } }

  /* ---------- drawing helpers ---------- */
  function txt(s, x, y, size, color, align, bold) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT;
    ctx.fillStyle = color || '#fff';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }
  function wrap(s, x, y, w, size, lh, color) {
    ctx.font = size + 'px ' + FONT;
    ctx.fillStyle = color || '#ddd';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let line = '';
    for (const word of s.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > w && line) { ctx.fillText(line, x, y); y += lh; line = word; } else line = t;
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }
  function rect(x, y, w, h, fill, stroke, lw) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); }
  }
  const inRect = (px, py, x, y, w, h) => px >= x && px < x + w && py >= y && py < y + h;
  function sprite(id, cx, cy, size) {
    const i = img[id];
    if (i && i.complete && i.naturalWidth) ctx.drawImage(i, cx - size / 2, cy - size / 2, size, size);
  }
  function button(x, y, w, h, label, fn, o) {
    o = o || {};
    const en = o.enabled !== false;
    const hov = en && inRect(mouse.x, mouse.y, x, y, w, h);
    rect(x, y, w, h, !en ? '#2a2a33' : hov ? (o.hot || '#4a6fd0') : (o.col || '#34457e'), en ? '#9fb4ff' : '#444', 2);
    txt(label, x + w / 2, y + h / 2 + (o.size || 20) * 0.35, o.size || 20, en ? '#fff' : '#777', 'center', true);
    btns.push({ x, y, w, h, fn, enabled: en, preview: o.preview });
    if (hov && o.preview) hoverBtnPreview = o.preview;
  }

  function drawTile(x, y) {
    const px = BX + x * CELL, py = BY + y * CELL;
    let t;
    if (x < 2) t = (x + y) % 2 ? 'blueconcrete' : 'lightblueconcrete';
    else if (x >= COLS - 2) t = (x + y) % 2 ? 'redconcrete' : 'orangeconcrete';
    else t = C.dark(x, y) ? 'basalt' : 'calcite';
    const i = img[t];
    ctx.imageSmoothingEnabled = false;
    if (i && i.complete && i.naturalWidth) ctx.drawImage(i, px, py, CELL, CELL);
    else rect(px, py, CELL, CELL, '#444');
  }

  function drawMinion(m, x, y, size) {
    const cx = x + CELL / 2, cy = y + CELL / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = PCOL_D[m.owner] + 'cc';
    ctx.fill();
    ctx.lineWidth = m.id === 'villager' ? 4 : 3;
    ctx.strokeStyle = m.id === 'villager' ? '#ffd23f' : PCOL[m.owner];
    ctx.stroke();
    sprite(m.id, cx, cy, size * 0.82);
    if (m.sick) txt('zZ', cx + 14, cy - 18, 15, '#fff', 'left', true);
    if (m.id === 'villager') txt('♚', cx - 30, cy - 20, 18, '#ffd23f', 'center', true);
  }

  function drawPattern(d, x, y, cell) {
    // 7x7 diagram; "forward" is up
    for (let r = -3; r <= 3; r++) for (let c = -3; c <= 3; c++) {
      rect(x + (c + 3) * cell, y + (r + 3) * cell, cell, cell, (r + c) % 2 ? '#2a2a33' : '#34343f');
    }
    const mark = (p, col, inset) => {
      for (const [r, c] of p) {
        if (Math.abs(r) > 3 || Math.abs(c) > 3) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + (c + 3) * cell + inset, y + (r + 3) * cell + inset, cell - 2 * inset, cell - 2 * inset);
      }
    };
    mark(d.movePattern, '#3fcf6a', 1);
    mark(d.attackPattern, '#ee4b4b', d.movePattern.length ? 6 : 1);
    sprite(d.id, x + 3.5 * cell, y + 3.5 * cell, cell * 0.95);
  }

  function drawInfo(d, x, y, w) {
    sprite(d.id, x + 30, y + 30, 60);
    txt(d.name, x + 70, y + 28, 26, '#fff', 'left', true);
    txt('Cost ' + d.cost + '  •  ' + d.tier.toUpperCase(), x + 70, y + 52, 15, '#ffd23f', 'left', true);
    const cell = 24;
    drawPattern(d, x, y + 72, cell);
    const lx = x + 7 * cell + 14;
    rect(lx, y + 80, 16, 16, '#3fcf6a'); txt('Move', lx + 24, y + 93, 15, '#ddd');
    rect(lx, y + 104, 16, 16, '#ee4b4b'); txt('Attack', lx + 24, y + 117, 15, '#ddd');
    txt('(up = toward enemy)', lx, y + 146, 13, '#888');
    let ty = y + 72 + 7 * cell + 24;
    const block = (head, body) => {
      txt(head, x, ty, 14, '#9fb4ff', 'left', true); ty += 17;
      ty = wrap(body, x, ty, w, 14, 17, '#ddd') + 5;
    };
    block('MOVE', d.move);
    block('ATTACK', d.attack);
    block('ABILITY', d.ability + (d.copyLimit ? ' (' + d.copyLimit + ')' : ''));
  }

  /* ---------- screens ---------- */
  function drawBackdrop() {
    ctx.imageSmoothingEnabled = false;
    for (let x = 0; x < 20; x++) for (let y = 0; y < 12; y++) {
      const i = img[(x + y) % 2 ? 'basalt' : 'calcite'];
      if (i && i.complete) ctx.drawImage(i, x * 80, y * 80, 80, 80);
    }
    rect(0, 0, W, H, 'rgba(8,8,16,0.8)');
  }

  function drawMenu() {
    drawBackdrop();
    const ids = ['creeper', 'zombie', 'enderman', 'villager', 'wither', 'pig', 'cat'];
    ids.forEach((id, i) => sprite(id, 480 + i * 100, 250 + Math.sin(Date.now() / 600 + i) * 8, 84));
    txt('CHEGG', W / 2, 190, 120, '#fff', 'center', true);
    txt('Chess × Egg — the deck-building duel', W / 2, 340, 28, '#ffd23f', 'center', true);
    button(600, 400, 400, 70, 'Play vs Computer', () => startDeckBuild('ai'), { size: 28 });
    button(600, 490, 400, 70, 'Local 2 Players', () => startDeckBuild('local'), { size: 28 });
    button(600, 580, 400, 70, 'How to Play', () => { screen = 'help'; }, { size: 28 });
    txt('Based on the Minecraft minigame CHEGG by Gerg', W / 2, 840, 16, '#888', 'center');
  }

  const HELP = [
    ['Goal', 'Hunt down the enemy Villager (your king). Lose yours and you lose the match.'],
    ['Board', '10×8 checkerboard. The two back columns on each side are the spawn zones (blue left, red right). New minions can only be placed there. Each player starts by placing their Villager in their own zone.'],
    ['Deck', 'A deck is 15 minions (max 2 Frogs, max 1 Wither). You start with 3 cards in hand and draw 1 at the start of each turn.'],
    ['Mana', 'Turn 1 gives 1 mana, turn 2 gives 2 ... capped at 6. Mana refreshes each turn, unspent mana is lost. Each Cat on the board adds +1.'],
    ['Spending', 'Spawn a minion for its cost. Attacking costs 1 mana (Wither: 2), once per minion per turn. Every minion has 1 free move per turn; moving again ("dash") costs 1 mana. A minion cannot dash and attack in the same turn, and cannot move after attacking. The Villager always pays 1 mana to move.'],
    ['Timing', 'A freshly spawned minion sits out the turn it is placed (shown with zZ). Area attacks hurt your own minions too!'],
    ['Controls', 'Click a card, then a highlighted square to spawn it. Click one of your minions: green squares are moves, red squares are attacks, area attacks and specials appear as buttons on the left. Enter or Space ends the turn, P pauses, Backspace goes back.']
  ];
  function drawHelp() {
    drawBackdrop();
    txt('How to Play', W / 2, 90, 54, '#fff', 'center', true);
    let y = 150;
    for (const [h, b] of HELP) {
      txt(h, 200, y, 22, '#ffd23f', 'left', true);
      const ny = wrap(b, 340, y, 1050, 20, 27, '#eee');
      y = Math.max(ny, y + 30) + 14;
    }
    button(650, 800, 300, 60, 'Back', () => { screen = 'menu'; });
  }

  /* ---- deck builder ---- */
  function startDeckBuild(m) {
    mode = m; buildFor = 0; screen = 'deck';
    if (!total(deckCounts[0])) deckCounts[0] = C.randomDeck();
    deckCounts[1] = {};
  }
  function drawDeck() {
    drawBackdrop();
    const counts = deckCounts[buildFor];
    const n = total(counts);
    const who = mode === 'local' ? 'Player ' + (buildFor + 1) + ' (' + C.NAMES[buildFor] + ')' : 'Your';
    txt(who + ' deck', 40, 70, 38, PCOL[buildFor] === '#3f7ae8' ? '#8fb2ff' : '#ff8d86', 'left', true);
    txt('Pick ' + C.DECK_SIZE + ' minions — ' + n + '/' + C.DECK_SIZE + '   (your Villager king is added for free)', 40, 100, 20, n === C.DECK_SIZE ? '#6dff8f' : '#ddd');
    const list = C.MIN.filter(d => d.id !== 'villager');
    let hov = null;
    list.forEach((d, i) => {
      const col = i % 6, row = Math.floor(i / 6);
      const x = 40 + col * 163, y = 125 + row * 205, w = 153, h = 195;
      const over = inRect(mouse.x, mouse.y, x, y, w, h);
      if (over) hov = d;
      const cnt = counts[d.id] || 0;
      rect(x, y, w, h, over ? '#2b2f4a' : '#1d2033', cnt ? '#ffd23f' : '#3b4066', 2);
      sprite(d.id, x + w / 2, y + 62, 84);
      txt(d.name, x + w / 2, y + 120, 18, '#fff', 'center', true);
      txt('Cost ' + d.cost, x + w / 2, y + 140, 15, '#ffd23f', 'center');
      const lim = C.LIMITS[d.id] || 99;
      button(x + 8, y + 150, 38, 36, '−', () => { if (cnt > 0) { counts[d.id] = cnt - 1; if (!counts[d.id]) delete counts[d.id]; } }, { enabled: cnt > 0, size: 24 });
      button(x + w - 46, y + 150, 38, 36, '+', () => { if (cnt < lim && n < C.DECK_SIZE) counts[d.id] = cnt + 1; }, { enabled: cnt < lim && n < C.DECK_SIZE, size: 24 });
      txt(String(cnt), x + w / 2, y + 177, 26, cnt ? '#ffd23f' : '#777', 'center', true);
      if (lim < 99) txt('max ' + lim, x + w - 6, y + 16, 13, '#ff9d6b', 'right');
    });
    hoverNext = hov;
    rect(1040, 120, 540, 640, '#161827', '#3b4066', 2);
    if (hov) drawInfo(hov, 1060, 140, 500);
    else txt('Hover a minion for details', 1310, 440, 20, '#777', 'center');
    button(40, 800, 200, 60, 'Back', () => { screen = 'menu'; });
    button(260, 800, 220, 60, 'Random', () => { deckCounts[buildFor] = C.randomDeck(); });
    button(500, 800, 220, 60, 'Clear', () => { deckCounts[buildFor] = {}; });
    const last = mode === 'ai' || buildFor === 1;
    button(1180, 800, 400, 60, last ? 'Start Match' : 'Next: Player 2 deck', () => {
      if (buildFor === 0) saveDeck();
      if (mode === 'ai') { deckCounts[1] = C.randomDeck(); beginMatch(); }
      else if (buildFor === 0) { buildFor = 1; }
      else beginMatch();
    }, { enabled: n === C.DECK_SIZE, size: 24, col: '#2f7a46', hot: '#3fa860' });
  }

  /* ---- match flow ---- */
  function beginMatch() {
    C.newGame([deckCounts[0], deckCounts[1]]);
    screen = 'place'; placeFor = 0; sel = null; spawnCard = null; overSent = false; aiBusy = false; aiToken++;
    confirmMenu = false; paused = false;
    say('Blue: place your Villager (king) in your spawn zone.');
    if (mode === 'local') pass = { text: 'Player 1 (Blue): place your Villager', cb: () => {} };
  }
  function afterPlace() {
    if (placeFor === 0) {
      placeFor = 1;
      if (mode === 'ai') {
        const z = C.zoneOf(1);
        let ok = false;
        while (!ok) ok = C.placeVillager(1, z[Math.floor(Math.random() * 2)], Math.floor(Math.random() * ROWS));
        startPlay();
      } else {
        pass = { text: 'Player 2 (Red): place your Villager', cb: () => { say('Red: place your Villager in your spawn zone.'); } };
      }
    } else {
      pass = { text: 'Player 1 (Blue): your turn', cb: () => {} };
      startPlay();
    }
  }
  function startPlay() {
    screen = 'play';
    C.startMatch();
    sel = null; spawnCard = null;
    say('Your turn. Click a card to spawn, or a minion to move or attack.');
    post({ type: 'ready' });
  }
  function endTurn() {
    if (G().winner !== null) return;
    sel = null; spawnCard = null; selMode = 'normal';
    C.endTurn();
    if (mode === 'local') {
      const p = G().cur;
      pass = { text: 'Player ' + (p + 1) + ' (' + C.NAMES[p] + '): your turn', cb: () => {} };
    } else if (G().cur === 1) {
      aiBusy = true; const tok = ++aiToken; say('Red is thinking...');
      setTimeout(() => aiStep(tok, 0), 700);
    } else say('Your turn.');
  }
  function aiStep(tok, n) {
    if (tok !== aiToken || screen !== 'play') return;
    if (G().winner !== null) { aiBusy = false; return; }
    const o = n < 40 ? C.aiNext() : null;
    if (o) {
      C.perform(o);
      setTimeout(() => aiStep(tok, n + 1), 650);
    } else {
      aiBusy = false;
      C.endTurn();
      say('Your turn.');
    }
  }
  function toMenu() {
    aiToken++; aiBusy = false; screen = 'menu'; confirmMenu = false; paused = false; pass = null; sel = null; spawnCard = null;
  }

  /* ---- play screen ---- */
  function curOptions() {
    if (!isHumanTurn() || G().winner !== null || pass) return [];
    if (spawnCard !== null) return C.spawnOptions(G().cur, spawnCard);
    if (sel && sel.alive) return C.actionsFor(sel, selMode);
    return [];
  }
  function cellAt(px, py) {
    const x = Math.floor((px - BX) / CELL), y = Math.floor((py - BY) / CELL);
    return C.inb(x, y) && px >= BX && py >= BY ? { x, y } : null;
  }

  function drawPlay() {
    const g = G();
    ctx.fillStyle = '#15151c'; ctx.fillRect(0, 0, W, H);
    const placing = screen === 'place';
    const opts = placing ? [] : curOptions();
    const hc = cellAt(mouse.x, mouse.y);
    let preview = hoverBtnPreview;
    if (!preview && hc) {
      const o = opts.find(q => q.click && q.click.x === hc.x && q.click.y === hc.y);
      if (o) preview = o.affected;
    }
    if (hc && C.at(hc.x, hc.y)) hoverNext = C.at(hc.x, hc.y).def;
    // board
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(x, y);
    // placement highlights
    if (placing) {
      for (const x of C.zoneOf(placeFor)) for (let y = 0; y < ROWS; y++) {
        if (!C.at(x, y)) rect(BX + x * CELL, BY + y * CELL, CELL, CELL, 'rgba(255,255,255,0.25)', '#fff', 3);
      }
    }
    // option highlights
    for (const o of opts) {
      if (!o.click) continue;
      const px = BX + o.click.x * CELL, py = BY + o.click.y * CELL;
      const col = o.kind === 'move' ? '63,207,106' : o.kind === 'attack' ? '238,75,75' : o.kind === 'special' ? '190,110,255' : '90,160,255';
      rect(px, py, CELL, CELL, 'rgba(' + col + ',0.35)', 'rgb(' + col + ')', 3);
    }
    // minions
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const m = g.board[y][x];
      if (m) drawMinion(m, BX + x * CELL, BY + y * CELL, 66);
    }
    for (const o of opts) {
      if (o.click && o.cost > 0 && o.kind !== 'spawn') txt(String(o.cost), BX + o.click.x * CELL + CELL - 8, BY + o.click.y * CELL + CELL - 6, 18, '#fff', 'right', true);
    }
    if (sel && sel.alive) rect(BX + sel.x * CELL, BY + sel.y * CELL, CELL, CELL, null, '#ffd23f', 4);
    if (preview) for (const s of preview) rect(BX + s.x * CELL, BY + s.y * CELL, CELL, CELL, 'rgba(255,150,40,0.35)', '#ff9628', 3);
    // grid border
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeRect(BX, BY, COLS * CELL, ROWS * CELL);
    // fx
    const now = Date.now();
    g.fx = g.fx.filter(f => now - f.t < 600);
    for (const f of g.fx) {
      const k = (now - f.t) / 600, cx = BX + f.x * CELL + CELL / 2, cy = BY + f.y * CELL + CELL / 2;
      ctx.beginPath(); ctx.arc(cx, cy, 14 + k * 46, 0, Math.PI * 2);
      ctx.strokeStyle = (f.kind === 'boom' ? 'rgba(255,140,30,' : 'rgba(255,255,255,') + (1 - k) + ')';
      ctx.lineWidth = 8 * (1 - k) + 1; ctx.stroke();
    }
    if (placing) {
      txt('Place your Villager (king) in your spawn zone', BX + COLS * CELL / 2, BY + ROWS * CELL + 34, 22, '#ffd23f', 'center', true);
      drawSidePanels(true);
      return;
    }
    // status line
    if (msg && now - msgT < 6000) txt(msg, BX + COLS * CELL / 2, BY + ROWS * CELL + 34, 20, '#ffd23f', 'center', true);
    drawSidePanels(false, opts);
    drawHand();
  }

  function drawSidePanels(placing, opts) {
    const g = G();
    rect(10, 10, 380, 700, '#161827', '#3b4066', 2);
    rect(1210, 10, 380, 700, '#161827', '#3b4066', 2);
    if (placing) {
      txt(C.NAMES[placeFor] + ' places the king', 200, 60, 24, PCOL[placeFor], 'center', true);
      return;
    }
    const P = g.players[g.cur];
    txt(C.NAMES[g.cur] + "'s turn", 30, 50, 28, g.cur === 0 ? '#8fb2ff' : '#ff8d86', 'left', true);
    txt('Turn ' + P.turn, 370, 50, 18, '#aaa', 'right');
    for (let i = 0; i < Math.max(P.maxMana, 6); i++) {
      const x = 40 + i * 34;
      ctx.beginPath(); ctx.arc(x, 85, 12, 0, Math.PI * 2);
      if (i < P.mana) { ctx.fillStyle = '#4db3ff'; ctx.fill(); }
      ctx.strokeStyle = i < P.maxMana ? '#9fd8ff' : '#444'; ctx.lineWidth = 2; ctx.stroke();
    }
    txt('Mana ' + P.mana + '/' + P.maxMana, 370, 92, 18, '#9fd8ff', 'right', true);
    // info
    const human = isHumanTurn();
    let d = hoverDef;
    if (!d && sel && sel.alive) d = sel.def;
    if (!d && spawnCard !== null) d = C.DEF[P.hand[spawnCard]];
    if (d) drawInfo(d, 24, 120, 350);
    else txt('Hover a card or minion for details', 200, 380, 16, '#777', 'center');
    // action buttons for selected minion
    if (human && sel && sel.alive && !pass && g.winner === null) {
      let by = 560;
      const normal = C.actionsFor(sel, 'normal');
      if (selMode === 'normal') {
        normal.filter(o => o.button).slice(0, 4).forEach(o => {
          button(24, by, 350, 34, o.label, () => { C.perform(o); afterAction(); }, { preview: o.affected, size: 17, col: '#7a2f2f', hot: '#b04545' });
          by += 40;
        });
      }
      if (C.hasSpecial(sel)) {
        const sp = C.actionsFor(sel, 'special');
        const label = selMode === 'special' ? 'Cancel special' : (sel.id === 'frog' ? 'Special: Pull (1)' : 'Special: Teleport (1)');
        button(24, by, 350, 34, label, () => { selMode = selMode === 'special' ? 'normal' : 'special'; },
          { enabled: selMode === 'special' || sp.length > 0, size: 17, col: '#59307a', hot: '#8147b5' });
      }
    }
    // right panel
    const opp = g.players[1 - g.cur];
    txt('Opponent', 1230, 50, 22, '#fff', 'left', true);
    txt('Hand ' + opp.hand.length + '   Deck ' + opp.deck.length, 1230, 78, 18, '#bbb');
    txt('You', 1230, 120, 22, '#fff', 'left', true);
    txt('Deck ' + P.deck.length, 1230, 148, 18, '#bbb');
    txt('Log', 1230, 195, 18, '#9fb4ff', 'left', true);
    const lines = g.log.slice(-13);
    lines.forEach((l, i) => { ctx.font = '14px ' + FONT; wrap(l, 1230, 220 + i * 25, 340, 14, 16, i === lines.length - 1 ? '#fff' : '#aaa'); });
    button(1230, 612, 340, 62, 'End Turn', endTurn, { enabled: human && !pass && g.winner === null && !aiBusy, size: 26, col: '#2f7a46', hot: '#3fa860' });
    button(1500, 18, 80, 30, 'Menu', () => { confirmMenu = true; }, { size: 14 });
  }

  function afterAction() {
    if (sel && !sel.alive) sel = null;
    selMode = 'normal';
    spawnCard = null;
    if (G().winner !== null) onWin();
  }
  function onWin() {
    if (!overSent) { overSent = true; post({ type: 'gameOver', score: G().turnNo }); }
  }

  function cardRects() {
    const P = G().players[G().cur];
    const n = P.hand.length, cw = 118, ch = 150;
    const gap = Math.min(10, n > 1 ? (1560 - n * cw) / (n - 1) : 10);
    const startX = Math.max(20, (W - (n * cw + (n - 1) * gap)) / 2);
    return P.hand.map((id, i) => ({ id, i, x: startX + i * (cw + gap), y: 728, w: cw, h: ch }));
  }
  function drawHand() {
    const g = G(), P = g.players[g.cur];
    const human = isHumanTurn() && !pass;
    if (!human) {
      txt(mode === 'ai' ? 'Computer is playing...' : 'Hand hidden', W / 2, 810, 24, '#888', 'center', true);
      return;
    }
    let hov = null;
    for (const c of cardRects()) {
      const d = C.DEF[c.id];
      const aff = d.cost <= P.mana;
      const sl = spawnCard === c.i;
      const y = c.y - (sl ? 14 : 0);
      const over = inRect(mouse.x, mouse.y, c.x, y, c.w, c.h);
      if (over) hov = d;
      rect(c.x, y, c.w, c.h, over ? '#2b2f4a' : '#1d2033', sl ? '#ffd23f' : aff ? '#6a78c8' : '#444', sl ? 4 : 2);
      sprite(d.id, c.x + c.w / 2, y + 62, 76);
      txt(d.name, c.x + c.w / 2, y + 120, 16, aff ? '#fff' : '#888', 'center', true);
      txt(d.tier, c.x + c.w / 2, y + 140, 12, '#888', 'center');
      ctx.beginPath(); ctx.arc(c.x + 18, y + 18, 15, 0, Math.PI * 2);
      ctx.fillStyle = aff ? '#2f86d6' : '#3a3a44'; ctx.fill();
      txt(String(d.cost), c.x + 18, y + 25, 20, '#fff', 'center', true);
      btns.push({ x: c.x, y, w: c.w, h: c.h, enabled: true, fn: () => selectCard(c.i) });
    }
    if (hov) hoverNext = hov;
    if (!P.hand.length) txt('Your hand is empty', W / 2, 810, 22, '#888', 'center');
  }

  function selectCard(i) {
    const g = G(), P = g.players[g.cur];
    if (spawnCard === i) { spawnCard = null; return; }
    sel = null; selMode = 'normal';
    const d = C.DEF[P.hand[i]];
    if (d.cost > P.mana) { say('Not enough mana for ' + d.name + ' (costs ' + d.cost + ').'); spawnCard = null; return; }
    spawnCard = i;
    say(d.name + ': click a highlighted square in your spawn zone.');
  }

  function onBoardClick(cell) {
    const g = G();
    if (screen === 'place') {
      if (C.placeVillager(placeFor, cell.x, cell.y)) afterPlace();
      else say('Pick a free square in your own spawn zone.');
      return;
    }
    if (!isHumanTurn() || pass || g.winner !== null) return;
    const opts = curOptions();
    const o = opts.find(q => q.click && q.click.x === cell.x && q.click.y === cell.y);
    if (o) { C.perform(o); afterAction(); return; }
    const m = C.at(cell.x, cell.y);
    if (m && m.owner === g.cur) {
      spawnCard = null; selMode = 'normal';
      sel = sel === m ? null : m;
      if (sel && m.sick) say('This minion was just spawned and cannot act until your next turn.');
      return;
    }
    sel = null; spawnCard = null; selMode = 'normal';
  }

  /* ---- overlays ---- */
  function drawOverlays() {
    const g = screen === 'play' || screen === 'place' ? G() : null;
    if (pass) {
      rect(0, 0, W, H, 'rgba(6,6,12,0.97)');
      txt(pass.text, W / 2, 400, 48, '#fff', 'center', true);
      txt('Pass the device. The other player should look away.', W / 2, 450, 22, '#aaa', 'center');
      button(600, 500, 400, 80, 'Ready', () => { const cb = pass.cb; pass = null; cb(); }, { size: 30, col: '#2f7a46', hot: '#3fa860' });
      return;
    }
    if (g && g.winner !== null) {
      onWin();
      rect(0, 0, W, H, 'rgba(0,0,0,0.6)');
      const human = mode === 'ai';
      const t = human ? (g.winner === 0 ? 'You win!' : 'Computer wins') : C.NAMES[g.winner] + ' wins!';
      txt(t, W / 2, 370, 90, g.winner === 0 ? '#8fb2ff' : '#ff8d86', 'center', true);
      txt('The enemy Villager was eliminated.', W / 2, 420, 24, '#ddd', 'center');
      button(560, 470, 230, 70, 'Rematch', () => beginMatch(), { size: 26 });
      button(810, 470, 230, 70, 'Menu', toMenu, { size: 26 });
      return;
    }
    if (confirmMenu) {
      rect(0, 0, W, H, 'rgba(0,0,0,0.7)');
      txt('Leave the match?', W / 2, 380, 50, '#fff', 'center', true);
      button(560, 430, 230, 70, 'Leave', toMenu, { size: 26, col: '#7a2f2f', hot: '#b04545' });
      button(810, 430, 230, 70, 'Keep playing', () => { confirmMenu = false; }, { size: 24 });
      return;
    }
    if (paused) {
      rect(0, 0, W, H, 'rgba(0,0,0,0.7)');
      txt('Paused', W / 2, 420, 70, '#fff', 'center', true);
      txt('Press P to continue', W / 2, 470, 24, '#ccc', 'center');
    }
  }

  /* ---------- loop & input ---------- */
  function frame() {
    btns = [];
    hoverBtnPreview = null;
    hoverNext = null;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    if (screen === 'menu') drawMenu();
    else if (screen === 'help') drawHelp();
    else if (screen === 'deck') drawDeck();
    else drawPlay();
    const before = btns.length;
    drawOverlays();
    prevBtns = btns.length > before ? btns.slice(before) : btns;
    hoverDef = hoverNext;
    requestAnimationFrame(frame);
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  canvas.addEventListener('pointermove', e => { mouse = pos(e); });
  canvas.addEventListener('pointerdown', e => {
    mouse = pos(e);
    if (pending > 0) return;
    for (let i = prevBtns.length - 1; i >= 0; i--) {
      const b = prevBtns[i];
      if (inRect(mouse.x, mouse.y, b.x, b.y, b.w, b.h)) { if (b.enabled) b.fn(); return; }
    }
    if ((screen === 'play' || screen === 'place') && !pass && !confirmMenu && !paused) {
      const cell = cellAt(mouse.x, mouse.y);
      if (cell) onBoardClick(cell);
    }
  });
  canvas.addEventListener('pointerleave', () => { mouse = { x: -1, y: -1 }; });
  window.addEventListener('keydown', e => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (screen === 'play' || screen === 'place') {
        if (G() && G().winner !== null) toMenu(); else confirmMenu = !confirmMenu;
      } else if (screen === 'deck' || screen === 'help') screen = 'menu';
    } else if (e.key === 'p' || e.key === 'P') {
      if (screen === 'play' && !pass) paused = !paused;
    } else if ((e.key === 'Enter' || e.key === ' ') && screen === 'play') {
      e.preventDefault();
      if (!pass && !confirmMenu && !paused && isHumanTurn() && !aiBusy && G().winner === null) endTurn();
    }
  });

  post({ type: 'ready' });
  requestAnimationFrame(frame);
})();
