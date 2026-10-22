/* CHEGG - UI layer (canvas). Rules live in rules.js. chess.com-inspired UI. */
(function () {
  'use strict';
  const C = Chegg;
  const W = 1600, H = 900, COLS = C.COLS, ROWS = C.ROWS, CELL = 74, BX = 522, BY = 16;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const PCOL = ['#3f7ae8', '#e04a42'];
  const PCOL_D = ['#1b3b8a', '#8a1f1b'];
  const FONT = '"Noto Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const TX = '#f1f0ee', DIM = '#989795', ACC = '#e8b93a', LINE = '#3d3a37', GREEN = '#81b64c';

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
  ['basalt', 'lightgrayconcrete', 'blueconcrete', 'lightblueconcrete', 'redconcrete', 'orangeconcrete']
    .forEach(t => load(t, 'assets/tiles/' + t + '.jpg'));
  ['redstone_lamp', 'redstone_lamp_on'].forEach(t => load(t, 'assets/tiles/' + t + '.png'));

  /* ---------- state ---------- */
  let screen = 'menu';            // menu | help | deck | place | play
  let mode = 'ai';                // ai | local
  let deckCounts = [{}, {}];
  let buildFor = 0;
  let deckTab = 'classic';        // classic | extra
  let placeFor = 0;
  let pass = null;                // {text, cb} hotseat hand-over overlay
  let confirmMenu = false, paused = false;
  let sel = null, selMode = 'normal', spawnCard = null;
  let msg = '', msgT = 0;
  let mouse = { x: -1, y: -1 };
  let hoverDef = null, hoverNext = null, hoverBtnPreview = null;
  let hoverCost = 0, hoverCostNext = 0;
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
  function setFont(size, bold) { ctx.font = (bold === false ? '' : '600 ') + size + 'px ' + FONT; }
  function txt(s, x, y, size, color, align) {
    setFont(size);
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color || TX;
    ctx.fillText(s, x, y);
  }
  function wrap(s, x, y, w, size, lh, color) {
    setFont(size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color || TX;
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

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function panel(x, y, w, h) {
    rr(x, y, w, h, 8);
    ctx.fillStyle = '#262522'; ctx.fill();
  }
  function slot(x, y, w, h, fill) {
    rr(x, y, w, h, 6);
    ctx.fillStyle = fill || '#1f1e1b'; ctx.fill();
  }
  function sprite(id, cx, cy, size) {
    const i = img[id];
    if (i && i.complete && i.naturalWidth) ctx.drawImage(i, cx - size / 2, cy - size / 2, size, size);
  }
  // chess.com style button: flat face with a darker 4px bottom edge
  function button(x, y, w, h, label, fn, o) {
    o = o || {};
    const en = o.enabled !== false;
    const hov = en && inRect(mouse.x, mouse.y, x, y, w, h);
    const base = o.col || '#454441', hot = o.hot || '#55534f';
    const face = !en ? '#383633' : hov ? hot : base;
    rr(x, y, w, h, 8); ctx.fillStyle = !en ? '#2a2927' : shade(base, -0.45); ctx.fill();
    rr(x, y, w, h - 4, 8); ctx.fillStyle = face; ctx.fill();
    const sz = o.size || 20;
    txt(label, x + w / 2, y + (h - 4) / 2 + sz * 0.34, sz, !en ? '#6f6d6a' : '#fff', 'center');
    btns.push({ x, y, w, h, fn, enabled: en });
    if (hov && o.preview) hoverBtnPreview = o.preview;
    if (hov && o.cost) hoverCostNext = o.cost;
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
    return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  function drawTile(x, y) {
    const px = BX + x * CELL, py = BY + y * CELL;
    let t, dim = 0;
    if (y >= ROWS - 2) { t = (x + y) % 2 ? 'blueconcrete' : 'lightblueconcrete'; dim = 0.32; }
    else if (y < 2) { t = (x + y) % 2 ? 'redconcrete' : 'orangeconcrete'; dim = 0.32; }
    else { t = C.dark(x, y) ? 'basalt' : 'lightgrayconcrete'; dim = C.dark(x, y) ? 0 : 0.12; }
    const i = img[t];
    if (i && i.complete && i.naturalWidth) ctx.drawImage(i, px, py, CELL, CELL);
    else rect(px, py, CELL, CELL, '#444');
    if (dim) rect(px, py, CELL, CELL, 'rgba(8,10,22,' + dim + ')');
  }

  function drawMinion(m, x, y) {
    const cx = x + CELL / 2, cy = y + CELL / 2, r = CELL * 0.41;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = PCOL_D[m.owner] + 'cc';
    ctx.fill();
    ctx.lineWidth = m.id === 'villager' ? 4 : 3;
    ctx.strokeStyle = m.id === 'villager' ? '#ffd23f' : PCOL[m.owner];
    ctx.stroke();
    sprite(m.id, cx, cy + 1, CELL * 0.73);
    if (m.sick) txt('zZ', cx + 12, cy - 14, 13, '#fff', 'left');
    if (m.id === 'villager') txt('♚', cx - 24, cy - 14, 15, '#ffd23f', 'center');
  }

  function drawPattern(d, x, y, cell) {
    // 7x7 diagram; "forward" is up
    rect(x - 2, y - 2, 7 * cell + 4, 7 * cell + 4, LINE);
    for (let r = -3; r <= 3; r++) for (let c = -3; c <= 3; c++) {
      rect(x + (c + 3) * cell, y + (r + 3) * cell, cell, cell, (r + c) % 2 ? '#262522' : '#2e2c29');
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
    slot(x, y, 64, 64);
    sprite(d.id, x + 32, y + 32, 52);
    txt(d.name, x + 80, y + 28, 26, TX, 'left');
    txt('Cost ' + d.cost + '  •  ' + d.tier.toUpperCase(), x + 80, y + 54, 17, ACC, 'left');
    const cell = 24;
    drawPattern(d, x, y + 80, cell);
    const lx = x + 7 * cell + 22;
    rect(lx, y + 90, 16, 16, '#3fcf6a', LINE, 2); txt('Move', lx + 24, y + 104, 16, TX);
    rect(lx, y + 114, 16, 16, '#ee4b4b', LINE, 2); txt('Attack', lx + 24, y + 128, 16, TX);
    txt('(up = forward)', lx, y + 156, 14, DIM);
    let ty = y + 80 + 7 * cell + 28;
    const block = (head, col, body) => {
      txt(head, x, ty, 15, col, 'left'); ty += 18;
      ty = wrap(body, x, ty, w, 15, 18, TX) + 6;
    };
    block('MOVE', '#5fe39a', d.move);
    block('ATTACK', '#ff7f75', d.attack);
    block('ABILITY', '#aaa2ff', d.ability + (d.copyLimit ? ' (' + d.copyLimit + ')' : ''));
  }

  // vertical mana gauge: one redstone lamp per mana point, lit = available
  const MB = { x: 402, y: 76, w: 88, h: 590 };
  function drawManaBar(x, y, w, h, mana, max, cost) {
    const n = Math.max(6, max);
    const gap = 6, size = Math.min(w, Math.floor((h - (n - 1) * gap) / n));
    const lx = x + (w - size) / 2;
    rr(x - 8, y - 8, w + 16, h + 16, 8); ctx.fillStyle = '#1f1e1b'; ctx.fill();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      const ly = y + h - (i + 1) * size - i * gap;
      const lit = i < mana;
      const im = img[lit ? 'redstone_lamp_on' : 'redstone_lamp'];
      if (lit) {
        const g = ctx.createRadialGradient(lx + size / 2, ly + size / 2, size * 0.3, lx + size / 2, ly + size / 2, size * 0.85);
        g.addColorStop(0, 'rgba(255,200,90,0.35)'); g.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = g; ctx.fillRect(lx - size * 0.4, ly - size * 0.4, size * 1.8, size * 1.8);
      }
      if (im && im.complete && im.naturalWidth) ctx.drawImage(im, lx, ly, size, size);
      else rect(lx, ly, size, size, lit ? '#e0a050' : '#4a3a2a');
      if (i >= max) rect(lx, ly, size, size, 'rgba(8,10,22,0.6)');
      if (lit && cost > 0 && i >= mana - cost) rect(lx, ly, size, size, 'rgba(255,120,20,0.45)', '#ffb347', 3);
      else rect(lx, ly, size, size, null, '#000', 2);
    }
    txt('MANA', x + w / 2, y - 22, 16, DIM, 'center');
    txt(mana + '/' + max, x + w / 2, y + h + 38, 26, '#ffd27a', 'center');
  }

  /* ---------- screens ---------- */
  function drawBackdrop() {
    ctx.fillStyle = '#302e2b'; ctx.fillRect(0, 0, W, H);
  }

  function drawMenu() {
    drawBackdrop();
    const ids = ['creeper', 'zombie', 'enderman', 'villager', 'wither', 'pig', 'cat'];
    ids.forEach((id, i) => {
      const cx = 470 + i * 110, cy = 300 + Math.sin(Date.now() / 600 + i) * 8;
      ctx.beginPath(); ctx.ellipse(cx, 352, 30, 7, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      sprite(id, cx, cy, 84);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff'; ctx.font = '800 130px ' + FONT; ctx.fillText('Chegg', W / 2, 205);
    ctx.fillStyle = GREEN; ctx.fillRect(W / 2 - 60, 226, 120, 6);
    txt('Chess × Egg — the deck-building duel', W / 2, 400, 28, ACC, 'center');
    button(540, 440, 520, 72, 'Play vs Computer', () => startDeckBuild('ai'), { size: 28, col: '#81b64c', hot: '#95c95d' });
    button(540, 526, 520, 72, 'Local 2 Players', () => startDeckBuild('local'), { size: 28 });
    button(540, 612, 520, 72, 'How to Play', () => { screen = 'help'; }, { size: 28 });
    txt('Based on the Minecraft minigame CHEGG by Gerg', W / 2, 850, 16, DIM, 'center');
  }

  const HELP = [
    ['Goal', 'Hunt down the enemy Villager (your king). Lose yours and you lose the match.'],
    ['Board', '8×10 checkerboard. The two back rows on each side are the spawn zones (blue at the bottom, red at the top). New minions can only be placed there. Each player starts by placing their Villager in their own zone.'],
    ['Deck', 'A deck is 15 minions (max 2 Frogs, max 1 Wither). You start with 3 cards in hand and draw 1 at the start of each turn.'],
    ['Mana', 'Turn 1 gives 1 mana, turn 2 gives 2 ... capped at 6. Mana refreshes each turn, unspent mana is lost. Each Cat on the board adds +1.'],
    ['Spending', 'Spawn a minion for its cost. Attacking costs 1 mana (Wither: 2), once per minion per turn. Every minion has 1 free move per turn; moving again ("dash") costs 1 mana. A minion cannot dash and attack in the same turn, and cannot move after attacking. The Villager always pays 1 mana to move.'],
    ['Timing', 'A freshly spawned minion sits out the turn it is placed (shown with zZ). Area attacks hurt your own minions too!'],
    ['Controls', 'Click a card, then a highlighted square to spawn it. Click one of your minions: green squares are moves, red squares are attacks, area attacks and specials appear as buttons on the left. Enter or Space ends the turn, P pauses, Backspace goes back.']
  ];
  function drawHelp() {
    drawBackdrop();
    panel(150, 30, 1300, 750);
    txt('How to Play', W / 2, 95, 50, '#fff', 'center');
    let y = 150;
    for (const [h, b] of HELP) {
      txt(h, 190, y, 24, ACC, 'left');
      const ny = wrap(b, 340, y, 1070, 21, 26, TX);
      y = Math.max(ny, y + 30) + 14;
    }
    button(650, 810, 300, 60, 'Back', () => { screen = 'menu'; });
  }

  /* ---- deck builder ---- */
  function startDeckBuild(m) {
    mode = m; buildFor = 0; screen = 'deck'; deckTab = 'classic';
    if (!total(deckCounts[0])) deckCounts[0] = C.randomDeck();
    deckCounts[1] = {};
  }
  function drawDeck() {
    drawBackdrop();
    const counts = deckCounts[buildFor];
    const n = total(counts);
    const who = mode === 'local' ? 'Player ' + (buildFor + 1) + ' (' + C.NAMES[buildFor] + ')' : 'Your';
    txt(who + ' deck', 40, 66, 42, buildFor === 0 ? '#8fb2ff' : '#ff8d86', 'left');
    txt('Pick ' + C.DECK_SIZE + ' minions — ' + n + '/' + C.DECK_SIZE + '   (your Villager king is added for free)', 40, 98, 22, n === C.DECK_SIZE ? '#6dff8f' : '#ddd');
    const list = C.MIN.filter(d => d.id !== 'villager' && !!d.extra === (deckTab === 'extra'));
    const nExtra = C.MIN.filter(d => d.extra).length;
    button(560, 30, 170, 46, 'Classic', () => { deckTab = 'classic'; }, { size: 20, col: deckTab === 'classic' ? '#81b64c' : '#454441', hot: deckTab === 'classic' ? '#95c95d' : '#55534f' });
    button(744, 30, 190, 46, 'Extras (' + nExtra + ')', () => { deckTab = 'extra'; }, { size: 20, col: deckTab === 'extra' ? '#81b64c' : '#454441', hot: deckTab === 'extra' ? '#95c95d' : '#55534f' });
    let hov = null;
    list.forEach((d, i) => {
      const col = i % 6, row = Math.floor(i / 6);
      const x = 40 + col * 163, y = 120 + row * 205, w = 153, h = 195;
      const over = inRect(mouse.x, mouse.y, x, y, w, h);
      if (over) hov = d;
      const cnt = counts[d.id] || 0;
      panel(x, y, w, h);
      if (cnt) { rr(x, y, w, h, 8); ctx.lineWidth = 3; ctx.strokeStyle = GREEN; ctx.stroke(); }
      slot(x + w / 2 - 38, y + 14, 76, 76);
      sprite(d.id, x + w / 2, y + 52, 62);
      txt(d.name, x + w / 2, y + 116, 20, TX, 'center');
      txt('Cost ' + d.cost, x + w / 2, y + 136, 16, ACC, 'center');
      const lim = C.LIMITS[d.id] || 99;
      button(x + 10, y + 148, 38, 36, '−', () => { if (cnt > 0) { counts[d.id] = cnt - 1; if (!counts[d.id]) delete counts[d.id]; } }, { enabled: cnt > 0, size: 24 });
      button(x + w - 48, y + 148, 38, 36, '+', () => { if (cnt < lim && n < C.DECK_SIZE) counts[d.id] = cnt + 1; }, { enabled: cnt < lim && n < C.DECK_SIZE, size: 24 });
      txt(String(cnt), x + w / 2, y + 178, 28, cnt ? ACC : DIM, 'center');
      if (lim < 99) txt('max ' + lim, x + w - 8, y + 24, 14, '#ff7f75', 'right');
    });
    hoverNext = hov;
    panel(1030, 110, 550, 660);
    if (hov) drawInfo(hov, 1058, 135, 500);
    else txt('Hover a minion for details', 1305, 440, 22, DIM, 'center');
    button(40, 800, 200, 60, 'Back', () => { screen = 'menu'; });
    button(260, 800, 220, 60, 'Random', () => { deckCounts[buildFor] = C.randomDeck(deckTab === 'extra'); });
    button(500, 800, 220, 60, 'Clear', () => { deckCounts[buildFor] = {}; });
    const last = mode === 'ai' || buildFor === 1;
    button(1130, 800, 450, 60, last ? 'Start Match' : 'Next: Player 2 deck', () => {
      if (buildFor === 0) saveDeck();
      if (mode === 'ai') { deckCounts[1] = C.randomDeck(C.MIN.some(d => d.extra && deckCounts[0][d.id])); beginMatch(); }
      else if (buildFor === 0) { buildFor = 1; }
      else beginMatch();
    }, { enabled: n === C.DECK_SIZE, size: 26, col: '#81b64c', hot: '#95c95d' });
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
        while (!ok) ok = C.placeVillager(1, Math.floor(Math.random() * COLS), z[Math.floor(Math.random() * 2)]);
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
    drawBackdrop();
    const placing = screen === 'place';
    const opts = placing ? [] : curOptions();
    const hc = cellAt(mouse.x, mouse.y);
    let preview = hoverBtnPreview;
    if (!preview && hc) {
      const o = opts.find(q => q.click && q.click.x === hc.x && q.click.y === hc.y);
      if (o) { preview = o.affected; hoverCostNext = o.cost; }
    }
    if (hc && C.at(hc.x, hc.y)) hoverNext = C.at(hc.x, hc.y).def;
    // board frame
    rr(BX - 6, BY - 6, COLS * CELL + 12, ROWS * CELL + 12, 6); ctx.fillStyle = '#1f1e1b'; ctx.fill();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(x, y);
    if (placing) {
      for (const y of C.zoneOf(placeFor)) for (let x = 0; x < COLS; x++) {
        if (!C.at(x, y)) { ctx.beginPath(); ctx.arc(BX + x * CELL + CELL / 2, BY + y * CELL + CELL / 2, CELL * 0.17, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill(); }
      }
    }
    if (sel && sel.alive) rect(BX + sel.x * CELL, BY + sel.y * CELL, CELL, CELL, 'rgba(247,236,89,0.55)');
    if (preview) for (const q of preview) rect(BX + q.x * CELL, BY + q.y * CELL, CELL, CELL, 'rgba(235,97,80,0.5)');
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const m = g.board[y][x];
      if (m) drawMinion(m, BX + x * CELL, BY + y * CELL);
    }
    // chess.com style hints: dots for free squares, rings for captures
    for (const o of opts) {
      if (!o.click) continue;
      const cx = BX + o.click.x * CELL + CELL / 2, cy = BY + o.click.y * CELL + CELL / 2;
      const hit = !!C.at(o.click.x, o.click.y) && o.kind !== 'spawn';
      ctx.beginPath();
      if (hit) {
        ctx.arc(cx, cy, CELL * 0.45, 0, Math.PI * 2); ctx.lineWidth = 6;
        ctx.strokeStyle = o.kind === 'special' ? 'rgba(150,110,255,0.85)' : 'rgba(224,60,50,0.85)'; ctx.stroke();
      } else {
        ctx.arc(cx, cy, CELL * 0.17, 0, Math.PI * 2);
        ctx.fillStyle = o.kind === 'special' ? 'rgba(150,110,255,0.85)' : 'rgba(10,10,10,0.42)'; ctx.fill();
      }
      if (hc && hc.x === o.click.x && hc.y === o.click.y) {
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeRect(BX + hc.x * CELL + 2, BY + hc.y * CELL + 2, CELL - 4, CELL - 4);
      }
    }
    for (const o of opts) {
      if (o.click && o.cost > 0 && o.kind !== 'spawn') txt(String(o.cost), BX + o.click.x * CELL + CELL - 6, BY + o.click.y * CELL + CELL - 6, 18, '#fff', 'right');
    }
    // fx
    const now = Date.now();
    g.fx = g.fx.filter(f => now - f.t < 600);
    for (const f of g.fx) {
      const k = (now - f.t) / 600, cx = BX + f.x * CELL + CELL / 2, cy = BY + f.y * CELL + CELL / 2;
      ctx.beginPath(); ctx.arc(cx, cy, 12 + k * 40, 0, Math.PI * 2);
      ctx.strokeStyle = (f.kind === 'boom' ? 'rgba(255,140,30,' : 'rgba(255,255,255,') + (1 - k) + ')';
      ctx.lineWidth = 8 * (1 - k) + 1; ctx.stroke();
    }
    if (placing) {
      drawSidePanels(true);
      return;
    }
    drawSidePanels(false);
    drawHand();
  }

  const LP = { x: 20, y: 10, w: 360, h: 750 };
  const RP = { x: 1260, y: 10, w: 320, h: 750 };

  function drawSidePanels(placing) {
    const g = G();
    panel(LP.x, LP.y, LP.w, LP.h);
    panel(RP.x, RP.y, RP.w, RP.h);
    if (placing) {
      txt(C.NAMES[placeFor] + ' places the king', LP.x + LP.w / 2, 70, 30, PCOL[placeFor], 'center');
      drawRight(false);
      return;
    }
    const P = g.players[g.cur];
    const lx = LP.x + 24;
    txt(C.NAMES[g.cur] + "'s turn", lx, 58, 34, g.cur === 0 ? '#3f7ae8' : '#e04a42', 'left');
    txt('Turn ' + P.turn, LP.x + LP.w - 24, 58, 22, DIM, 'right');
    let cost = hoverCost;
    if (!cost && spawnCard !== null) cost = (C.DEF[P.hand[spawnCard]] || { cost: 0 }).cost;
    drawManaBar(MB.x, MB.y, MB.w, MB.h, P.mana, P.maxMana, Math.min(cost, P.mana));
    // info
    const human = isHumanTurn();
    let d = hoverDef;
    if (!d && sel && sel.alive) d = sel.def;
    if (!d && spawnCard !== null) d = C.DEF[P.hand[spawnCard]];
    if (d) drawInfo(d, lx, 84, LP.w - 48);
    else txt('Hover a card or minion for details', LP.x + LP.w / 2, 380, 20, DIM, 'center');
    // action buttons for selected minion
    if (human && sel && sel.alive && !pass && g.winner === null) {
      const normal = C.actionsFor(sel, 'normal');
      const bl = selMode === 'normal' ? normal.filter(o => o.button).slice(0, 4) : [];
      const nb = bl.length + (C.hasSpecial(sel) ? 1 : 0);
      let by = LP.y + LP.h - 18 - nb * 40;
      if (selMode === 'normal') {
        bl.forEach(o => {
          button(lx, by, LP.w - 48, 34, o.label, () => { C.perform(o); afterAction(); }, { preview: o.affected, cost: o.cost, size: 18, col: '#b83b32', hot: '#cf4b41' });
          by += 40;
        });
      }
      if (C.hasSpecial(sel)) {
        const sp = C.actionsFor(sel, 'special');
        const label = selMode === 'special' ? 'Cancel special' : (sel.id === 'frog' ? 'Special: Pull (1)' : 'Special: Teleport (1)');
        button(lx, by, LP.w - 48, 34, label, () => { selMode = selMode === 'special' ? 'normal' : 'special'; },
          { enabled: selMode === 'special' || sp.length > 0, size: 18, col: '#6b52b0', hot: '#8366cc' });
      }
    }
    drawRight(human);
  }

  function playerBar(pi, y) {
    const g = G(), P = g.players[pi];
    const rx = RP.x + 16, w = RP.w - 32;
    const active = g.cur === pi && g.winner === null;
    rr(rx, y, w, 84, 8); ctx.fillStyle = active ? '#3d3a37' : '#2d2b28'; ctx.fill();
    if (active) { ctx.fillStyle = GREEN; ctx.fillRect(rx, y + 12, 4, 60); }
    slot(rx + 16, y + 14, 56, 56, '#1f1e1b');
    sprite('villager', rx + 44, y + 43, 46);
    rr(rx + 16, y + 14, 56, 56, 6); ctx.lineWidth = 3; ctx.strokeStyle = PCOL[pi]; ctx.stroke();
    const name = mode === 'ai' ? (pi === 0 ? 'You' : 'Computer') : C.NAMES[pi];
    txt(name, rx + 86, y + 38, 22, TX, 'left');
    txt('Hand ' + P.hand.length + '  \u00B7  Deck ' + P.deck.length, rx + 86, y + 62, 16, DIM, 'left');
    if (active) { ctx.beginPath(); ctx.arc(rx + w - 20, y + 20, 6, 0, Math.PI * 2); ctx.fillStyle = GREEN; ctx.fill(); }
  }

  function drawRight(human) {
    const g = G();
    const rx = RP.x + 16, w = RP.w - 32;
    playerBar(1, RP.y + 14);
    playerBar(0, RP.y + RP.h - 14 - 56 - 12 - 84);
    const placing = screen === 'place';
    const text = placing ? 'Place your Villager (king) on a free square in your spawn zone.' : (msg && Date.now() - msgT < 8000 ? msg : '');
    if (text) {
      slot(rx, RP.y + 116, w, 120, '#2d2b28');
      wrap(text, rx + 16, RP.y + 150, w - 32, 18, 24, TX);
    }
    button(rx, RP.y + 256, w, 48, 'Menu', () => { confirmMenu = true; }, { size: 18 });
    button(rx, RP.y + RP.h - 14 - 56, w, 56, 'End Turn', endTurn,
      { enabled: !placing && human && !pass && g.winner === null && !aiBusy, size: 26, col: '#81b64c', hot: '#95c95d' });
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

  const HAND = { x: 60, y: 774, w: 1480, h: 120 };
  function cardRects() {
    const P = G().players[G().cur];
    const n = P.hand.length, cw = 104, ch = 100;
    const gap = Math.min(10, n > 1 ? (HAND.w - 40 - n * cw) / (n - 1) : 10);
    const startX = HAND.x + Math.max(20, (HAND.w - (n * cw + (n - 1) * gap)) / 2);
    return P.hand.map((id, i) => ({ id, i, x: startX + i * (cw + gap), y: HAND.y + 10, w: cw, h: ch }));
  }
  function drawHand() {
    const g = G(), P = g.players[g.cur];
    const human = isHumanTurn() && !pass;
    panel(HAND.x, HAND.y, HAND.w, HAND.h);
    if (!human) {
      txt(mode === 'ai' ? 'Computer is playing...' : 'Hand hidden', W / 2, 845, 28, TX, 'center');
      return;
    }
    let hov = null;
    for (const c of cardRects()) {
      const d = C.DEF[c.id];
      const aff = d.cost <= P.mana;
      const sl = spawnCard === c.i;
      const y = c.y - (sl ? 10 : 0);
      const over = inRect(mouse.x, mouse.y, c.x, y, c.w, c.h);
      if (over) { hov = d; if (aff) hoverCostNext = d.cost; }
      slot(c.x, y, c.w, c.h, over ? '#4a4744' : aff ? '#3d3a37' : '#2d2b28');
      if (sl) { rr(c.x - 2, y - 2, c.w + 4, c.h + 4, 8); ctx.lineWidth = 3; ctx.strokeStyle = GREEN; ctx.stroke(); }
      ctx.globalAlpha = aff ? 1 : 0.55;
      sprite(d.id, c.x + c.w / 2, y + 44, 58);
      ctx.globalAlpha = 1;
      txt(d.name, c.x + c.w / 2, y + 92, 16, aff ? TX : '#7d7b78', 'center');
      ctx.beginPath(); ctx.arc(c.x + 18, y + 18, 13, 0, Math.PI * 2);
      ctx.fillStyle = aff ? '#e8a43a' : '#4a4744'; ctx.fill();
      txt(String(d.cost), c.x + 18, y + 24, 17, aff ? '#2b1a00' : '#8a8885', 'center');
      btns.push({ x: c.x, y, w: c.w, h: c.h, enabled: true, fn: () => selectCard(c.i) });
    }
    if (hov) hoverNext = hov;
    if (!P.hand.length) txt('Your hand is empty', W / 2, 845, 26, TX, 'center');
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
      txt(pass.text, W / 2, 400, 52, '#fff', 'center');
      txt('Pass the device. The other player should look away.', W / 2, 450, 24, '#aaa', 'center');
      button(600, 500, 400, 80, 'Ready', () => { const cb = pass.cb; pass = null; cb(); }, { size: 32, col: '#81b64c', hot: '#95c95d' });
      return;
    }
    if (g && g.winner !== null) {
      onWin();
      rect(0, 0, W, H, 'rgba(0,0,0,0.6)');
      const human = mode === 'ai';
      const t = human ? (g.winner === 0 ? 'You win!' : 'Computer wins') : C.NAMES[g.winner] + ' wins!';
      txt(t, W / 2, 370, 100, g.winner === 0 ? '#8fb2ff' : '#ff8d86', 'center');
      txt('The enemy Villager was eliminated.', W / 2, 420, 26, '#ddd', 'center');
      button(560, 470, 230, 70, 'Rematch', () => beginMatch(), { size: 28 });
      button(810, 470, 230, 70, 'Menu', toMenu, { size: 28 });
      return;
    }
    if (confirmMenu) {
      rect(0, 0, W, H, 'rgba(0,0,0,0.7)');
      txt('Leave the match?', W / 2, 380, 54, '#fff', 'center');
      button(560, 430, 230, 70, 'Leave', toMenu, { size: 28, col: '#b83b32', hot: '#cf4b41' });
      button(810, 430, 230, 70, 'Keep playing', () => { confirmMenu = false; }, { size: 24 });
      return;
    }
    if (paused) {
      rect(0, 0, W, H, 'rgba(0,0,0,0.7)');
      txt('Paused', W / 2, 420, 80, '#fff', 'center');
      txt('Press P to continue', W / 2, 470, 26, '#ccc', 'center');
    }
  }

  /* ---------- loop & input ---------- */
  function frame() {
    btns = [];
    hoverBtnPreview = null;
    hoverNext = null;
    hoverCostNext = 0;
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
    hoverCost = hoverCostNext;
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
