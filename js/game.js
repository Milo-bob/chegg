/* CHEGG - UI layer (canvas). Rules live in rules.js. chess.com-inspired UI. */
(function () {
  'use strict';
  const C = Chegg;
  const W = 1600, H = 900, COLS = C.COLS, ROWS = C.ROWS, CELL = 72, BX = 444, BY = 18;
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
  ['basalt', 'calcite', 'blueconcrete', 'lightblueconcrete', 'redconcrete', 'orangeconcrete']
    .forEach(t => load(t, 'assets/tiles/' + t + '.jpg'));
  ['redstone_lamp', 'redstone_lamp_on'].forEach(t => load(t, 'assets/tiles/' + t + '.png'));

  /* ---------- state ---------- */
  let screen = 'menu';            // menu | help | deck | place | play
  let mode = 'ai';                // ai | local
  let deckCounts = [{}, {}];
  let buildFor = 0;
  let deckTab = 'classic';        // classic | extra
  let deckScroll = 0, sbDrag = null, sbGeom = null;
  const DECK_VIEW = { y: 112, h: 676 };
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
  let ol = null;                  // online match state (see online section)
  let queue = null, resumeRow = null;
  // planning arrows (right-click drag, like chess.com) and square marks
  let arrows = [], marks = [], drag = null;
  // chess clock: timeCtl = seconds per player (0 = untimed)
  let timeCtl = 0;
  const clock = { on: false, ms: [0, 0], last: 0 };

  try {
    const saved = JSON.parse(localStorage.getItem('chegg_deck_v1') || 'null');
    if (saved && typeof saved === 'object') deckCounts[0] = saved;
  } catch (e) { /* storage unavailable */ }
  function saveDeck() {
    try { localStorage.setItem('chegg_deck_v1', JSON.stringify(deckCounts[0])); } catch (e) { /* ignore */ }
  }

  const G = () => C.G;
  const total = c => Object.keys(c).reduce((a, k) => a + c[k], 0);
  const mySide = () => (mode === 'online' && ol ? ol.side : 0);
  const isHumanTurn = () => mode === 'local' || (G().cur === mySide() && !(ol && ol.pending));
  const viewer = () => (mode === 'local' ? G().cur : mySide());
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
    const px = vx(x), py = vy(y);
    let t, dim = 0;
    if (y >= ROWS - 2) { t = (x + y) % 2 ? 'blueconcrete' : 'lightblueconcrete'; dim = 0.32; }
    else if (y < 2) { t = (x + y) % 2 ? 'redconcrete' : 'orangeconcrete'; dim = 0.32; }
    else { t = C.dark(x, y) ? 'basalt' : 'calcite'; dim = C.dark(x, y) ? 0 : 0.18; }
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
  const MB = { x: 340, w: 76 };
  function drawManaBar(x, w, mana, max, cost) {
    const n = Math.max(6, max);
    const gap = 6, size = w;
    const total = n * size + (n - 1) * gap;
    const y = BY + (ROWS * CELL - total) / 2;
    rr(x - 8, y - 8, w + 16, total + 16, 8); ctx.fillStyle = '#1f1e1b'; ctx.fill();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      const ly = y + total - (i + 1) * size - i * gap;
      const lit = i < mana;
      const im = img[lit ? 'redstone_lamp_on' : 'redstone_lamp'];
      if (lit) {
        const g = ctx.createRadialGradient(x + size / 2, ly + size / 2, size * 0.3, x + size / 2, ly + size / 2, size * 0.85);
        g.addColorStop(0, 'rgba(255,200,90,0.35)'); g.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = g; ctx.fillRect(x - size * 0.4, ly - size * 0.4, size * 1.8, size * 1.8);
      }
      if (im && im.complete && im.naturalWidth) ctx.drawImage(im, x, ly, size, size);
      else rect(x, ly, size, size, lit ? '#e0a050' : '#4a3a2a');
      if (i >= max) rect(x, ly, size, size, 'rgba(8,10,22,0.6)');
      if (lit && cost > 0 && i >= mana - cost) rect(x, ly, size, size, 'rgba(255,120,20,0.45)', '#ffb347', 3);
      else rect(x, ly, size, size, null, '#000', 2);
    }
    txt('MANA', x + w / 2, y - 22, 16, DIM, 'center');
    txt(mana + '/' + max, x + w / 2, y + total + 40, 26, '#ffd27a', 'center');
  }

  /* ---------- screens ---------- */
  function drawBackdrop(tiled) {
    ctx.fillStyle = '#302e2b'; ctx.fillRect(0, 0, W, H);
    if (!tiled) return;
    // main menu: the board's checker pattern, darkened and flattened so it stays calm
    const dk = img.basalt, lt = img.calcite;
    for (let x = 0; x < 20; x++) for (let y = 0; y < 12; y++) {
      const i = (x + y) % 2 ? dk : lt;
      if (i && i.complete && i.naturalWidth) ctx.drawImage(i, x * 80, y * 80, 80, 80);
    }
    rect(0, 0, W, H, 'rgba(38,36,33,0.84)');
  }

  function drawMenu() {
    drawBackdrop(true);
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
    button(540, 424, 520, 66, 'Play vs Computer', () => startDeckBuild('ai'), { size: 26, col: '#81b64c', hot: '#95c95d' });
    button(540, 500, 520, 66, 'Play Online', openOnline, { size: 26 });
    button(540, 576, 520, 66, 'Local 2 Players', () => startDeckBuild('local'), { size: 26 });
    button(540, 652, 520, 66, 'How to Play', () => { screen = 'help'; }, { size: 26 });
    txt('Time control', W / 2, 752, 16, DIM, 'center');
    [[0, 'Untimed'], [180, '3 min'], [300, '5 min'], [600, '10 min']].forEach((t, i) => {
      const on = timeCtl === t[0];
      button(540 + i * 133, 764, 121, 44, t[1], () => { timeCtl = t[0]; },
        { size: 18, col: on ? '#81b64c' : '#454441', hot: on ? '#95c95d' : '#55534f' });
    });
    drawAccountChip();
    txt('Based on the Minecraft minigame CHEGG by Gerg', W / 2, 850, 16, DIM, 'center');
  }

  const HELP = [
    ['Goal', 'Hunt down the enemy Villager (your king). Lose yours and you lose the match.'],
    ['Board', '8×12 checkerboard. The two back rows on each side are the spawn zones (blue at the bottom, red at the top). New minions can only be placed there. Each player starts by placing their Villager in their own zone.'],
    ['Deck', 'A deck is 15 minions (max 2 Frogs, max 1 Wither). You start with 3 cards in hand and draw 1 at the start of each turn.'],
    ['Mana', 'Turn 1 gives 1 mana, turn 2 gives 2 ... capped at 6. Mana refreshes each turn, unspent mana is lost. Each Cat on the board adds +1.'],
    ['Spending', 'Spawn a minion for its cost. Attacking costs 1 mana (Wither: 2), once per minion per turn. Every minion has 1 free move per turn; moving again ("dash") costs 1 mana. A minion cannot dash and attack in the same turn, and cannot move after attacking. The Villager always pays 1 mana to move.'],
    ['Timing', 'A freshly spawned minion sits out the turn it is placed (shown with zZ). Area attacks hurt your own minions too!'],
    ['Planning', 'Right-click and drag on the board to draw an arrow (Shift = green, Ctrl = red, Alt = blue). Right-click a square to mark it. A left-click clears everything.'],
    ['Clock', 'Pick a time control in the main menu. Only your own turn uses your clock; run out of time and you lose.'],
    ['Controls', 'Click a card, then a highlighted square to spawn it. Click one of your minions: dots are moves, red rings are attacks. Area attacks (Creeper, Puffer-Fish) use the red star badge on the piece, sweeps and shots (Iron Golem, Wither) are fired by clicking an enemy they would hit, and specials (Frog, Enderman) by clicking the target, or the purple badge if it clashes with an attack. Enter or Space ends the turn, P pauses, Backspace goes back.']
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
    mode = m; buildFor = 0; screen = 'deck'; deckTab = 'classic'; deckScroll = 0;
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
    if (deckTab === 'classic') list.push(C.DEF.villager); // king: info card only, always in your deck
    const nExtra = C.MIN.filter(d => d.extra).length;
    button(560, 30, 170, 46, 'Classic', () => { deckTab = 'classic'; deckScroll = 0; }, { size: 20, col: deckTab === 'classic' ? '#81b64c' : '#454441', hot: deckTab === 'classic' ? '#95c95d' : '#55534f' });
    button(744, 30, 190, 46, 'Extras (' + nExtra + ')', () => { deckTab = 'extra'; deckScroll = 0; }, { size: 20, col: deckTab === 'extra' ? '#81b64c' : '#454441', hot: deckTab === 'extra' ? '#95c95d' : '#55534f' });
    let hov = null;
    const contentH = Math.ceil(list.length / 6) * 205 + 8;
    const maxScroll = Math.max(0, contentH - DECK_VIEW.h);
    deckScroll = Math.max(0, Math.min(maxScroll, deckScroll));
    ctx.save();
    ctx.beginPath(); ctx.rect(30, DECK_VIEW.y, 980, DECK_VIEW.h); ctx.clip();
    list.forEach((d, i) => {
      const col = i % 6, row = Math.floor(i / 6);
      const x = 40 + col * 163, y = 120 + row * 205 - deckScroll, w = 153, h = 195;
      if (y + h < DECK_VIEW.y || y > DECK_VIEW.y + DECK_VIEW.h) return;
      const nb = btns.length;
      const over = inRect(mouse.x, mouse.y, x, y, w, h) && mouse.y >= DECK_VIEW.y && mouse.y <= DECK_VIEW.y + DECK_VIEW.h;
      if (over) hov = d;
      if (d.id === 'villager') {
        panel(x, y, w, h);
        slot(x + w / 2 - 38, y + 14, 76, 76);
        sprite(d.id, x + w / 2, y + 52, 62);
        txt(d.name, x + w / 2, y + 116, 20, TX, 'center');
        txt('Your king', x + w / 2, y + 138, 16, ACC, 'center');
        txt('always in play', x + w / 2, y + 162, 15, DIM, 'center');
        txt('free', x + w - 8, y + 24, 14, GREEN, 'right');
        return;
      }
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
      // buttons clipped by the scroll area must not be clickable
      for (let bi = btns.length - 1; bi >= nb; bi--) {
        const b = btns[bi];
        if (b.y < DECK_VIEW.y || b.y + b.h > DECK_VIEW.y + DECK_VIEW.h) btns.splice(bi, 1);
      }
    });
    ctx.restore();
    if (maxScroll > 0) {
      const tx = 1013, tw = 10;
      rr(tx, DECK_VIEW.y, tw, DECK_VIEW.h, 5); ctx.fillStyle = '#262522'; ctx.fill();
      const th = Math.max(60, DECK_VIEW.h * DECK_VIEW.h / contentH);
      const ty = DECK_VIEW.y + (DECK_VIEW.h - th) * (deckScroll / maxScroll);
      const hot = sbDrag || inRect(mouse.x, mouse.y, tx - 6, DECK_VIEW.y, tw + 12, DECK_VIEW.h);
      rr(tx, ty, tw, th, 5); ctx.fillStyle = hot ? '#95c95d' : '#81b64c'; ctx.fill();
      sbGeom = { tx, tw, ty, th, maxScroll };
    } else sbGeom = null;
    hoverNext = hov;
    panel(1030, 110, 550, 660);
    if (hov) drawInfo(hov, 1058, 135, 500);
    else txt('Hover a minion for details', 1305, 440, 22, DIM, 'center');
    button(40, 800, 200, 60, 'Back', () => { screen = 'menu'; });
    button(260, 800, 220, 60, 'Random', () => { deckCounts[buildFor] = C.randomDeck(deckTab === 'extra'); });
    button(500, 800, 220, 60, 'Clear', () => { deckCounts[buildFor] = {}; });
    if (mode === 'online') {
      const ok = n === C.DECK_SIZE;
      button(740, 800, 190, 60, 'Private game', () => startSearch('private'), { enabled: ok, size: 20 });
      button(942, 800, 170, 60, 'Join code', () => askCode(), { enabled: ok, size: 20 });
      button(1130, 800, 450, 60, 'Find Match', () => startSearch('queue'), { enabled: ok, size: 26, col: '#81b64c', hot: '#95c95d' });
      return;
    }
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
    clock.on = false; arrows = []; marks = [];
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
    sel = null; spawnCard = null; arrows = []; marks = [];
    clock.on = timeCtl > 0; clock.ms = [timeCtl * 1000, timeCtl * 1000]; clock.last = Date.now();
    say('Your turn. Click a card to spawn, or a minion to move or attack.');
    post({ type: 'ready' });
  }
  function submit(a) {
    if (!ol || ol.pending) return;
    ol.pending = true;
    Online.send(ol.side, a).then(r => {
      if (ol) ol.pending = false;
      if (!r.ok) say('Could not send the move: ' + r.error);
    });
  }
  function doOpt(o) {
    if (mode === 'online') { submit({ t: 'opt', p: mySide(), k: C.optKey(o) }); return; }
    C.perform(o); afterAction();
  }
  function endTurn() {
    if (G().winner !== null) return;
    if (mode === 'online') { if (isHumanTurn()) submit({ t: 'end', p: mySide() }); return; }
    sel = null; spawnCard = null; selMode = 'normal'; arrows = []; marks = [];
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
      arrows = []; marks = [];
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
    if (queue) { if (queue.stop) queue.stop(); queue = null; }
    if (ol) { Online.closeMatch(); ol = null; }
    mode = 'ai'; clock.on = false;
    refreshResume();
  }

  /* ---- play screen ---- */
  function curOptions() {
    if (!isHumanTurn() || G().winner !== null || pass) return [];
    if (spawnCard !== null) return C.spawnOptions(G().cur, spawnCard);
    if (sel && sel.alive) {
      if (selMode === 'special') return C.actionsFor(sel, 'special');
      const o = C.actionsFor(sel, 'normal');
      if (C.hasSpecial(sel)) {
        for (const q of C.actionsFor(sel, 'special')) if (!o.some(n => n.click && sameCell(n.click, q.click))) o.push(q);
      }
      return o;
    }
    return [];
  }
  // best option for a clicked square (moves, targets, enemies inside a sweep ...)
  function optAt(opts, cell) {
    let best = null, bs = -1e9;
    for (const q of opts) {
      const hit = (q.click && sameCell(q.click, cell)) || (q.clicks && q.clicks.some(c => sameCell(c, cell)));
      if (!hit) continue;
      let sc = q.kind === 'attack' ? 10 : q.kind === 'special' ? 5 : 0;
      if (q.victims) sc += q.victims.reduce((a, v) => a + (v.owner === (q.m ? q.m.owner : G().cur) ? -1.2 : 1), 0);
      if (sc > bs) { bs = sc; best = q; }
    }
    return best;
  }
  // small badges on the selected piece: area attacks and the special-mode switch
  function badgesFor(opts) {
    const list = [];
    if (!sel || !sel.alive || !isHumanTurn() || pass || G().winner !== null || spawnCard !== null) return list;
    for (const o of opts) if (o.badge) list.push({ opt: o, color: '#c0392b', glyph: 'star' });
    if (C.hasSpecial(sel)) {
      const sp = C.actionsFor(sel, 'special');
      const normal = selMode === 'normal' ? C.actionsFor(sel, 'normal') : [];
      const conflict = sp.some(q => normal.some(n => n.click && sameCell(n.click, q.click)));
      if (selMode === 'special' || conflict) list.push({ toggle: true, color: selMode === 'special' ? '#8366cc' : '#6b52b0', glyph: '\u2194' });
    }
    list.forEach((b, i) => { b.x = vx(sel.x) + CELL - 28; b.y = vy(sel.y) + 2 + i * 28; b.s = 26; });
    return list;
  }
  const flip = () => mode === 'online' && !!ol && ol.side === 1;
  const vx = x => BX + (flip() ? COLS - 1 - x : x) * CELL;
  const vy = y => BY + (flip() ? ROWS - 1 - y : y) * CELL;
  function cellAt(px, py) {
    const x = Math.floor((px - BX) / CELL), y = Math.floor((py - BY) / CELL);
    if (!C.inb(x, y) || px < BX || py < BY) return null;
    return flip() ? { x: COLS - 1 - x, y: ROWS - 1 - y } : { x, y };
  }

  const ctr = q => ({ x: vx(q.x) + CELL / 2, y: vy(q.y) + CELL / 2 });
  function drawArrow(a, b, c) {
    const A = ctr(a), B = ctr(b);
    const dx = b.x - a.x, dy = b.y - a.y;
    let pts = [A, B];
    if (Math.abs(dx) === 1 && Math.abs(dy) === 2) pts = [A, ctr({ x: a.x, y: b.y }), B];
    else if (Math.abs(dx) === 2 && Math.abs(dy) === 1) pts = [A, ctr({ x: b.x, y: a.y }), B];
    const last = pts[pts.length - 2];
    const ang = Math.atan2(B.y - last.y, B.x - last.x);
    const head = CELL * 0.36;
    const tail = { x: B.x - Math.cos(ang) * head * 0.8, y: B.y - Math.sin(ang) * head * 0.8 };
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = 'rgb(' + c + ')'; ctx.fillStyle = 'rgb(' + c + ')';
    ctx.lineWidth = CELL * 0.16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(B.x, B.y);
    ctx.lineTo(B.x - Math.cos(ang - 0.5) * head, B.y - Math.sin(ang - 0.5) * head);
    ctx.lineTo(B.x - Math.cos(ang + 0.5) * head, B.y - Math.sin(ang + 0.5) * head);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const sameCell = (p, q) => p.x === q.x && p.y === q.y;
  function arrowColor(e) { return e.shiftKey ? '129,182,76' : e.ctrlKey ? '224,60,50' : e.altKey ? '66,135,245' : '255,170,0'; }

  function drawPlay() {
    const g = G();
    drawBackdrop();
    const placing = screen === 'place';
    const opts = placing ? [] : curOptions();
    const hc = cellAt(mouse.x, mouse.y);
    let preview = hoverBtnPreview;
    const badges = placing ? [] : badgesFor(opts);
    const hb = badges.find(b => inRect(mouse.x, mouse.y, b.x, b.y, b.s, b.s));
    const inBadge = !!hb;
    if (hb && hb.opt) { preview = hb.opt.affected; hoverCostNext = hb.opt.cost; }
    if (!preview && hc) {
      const o = optAt(opts, hc);
      if (o && !inBadge) { preview = o.affected; hoverCostNext = o.cost; }
    }
    if (hc && C.at(hc.x, hc.y)) hoverNext = C.at(hc.x, hc.y).def;
    // board frame
    rr(BX - 6, BY - 6, COLS * CELL + 12, ROWS * CELL + 12, 6); ctx.fillStyle = '#1f1e1b'; ctx.fill();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(x, y);
    if (placing && (mode !== 'online' || placeFor === mySide())) {
      for (const y of C.zoneOf(placeFor)) for (let x = 0; x < COLS; x++) {
        if (!C.at(x, y)) { ctx.beginPath(); ctx.arc(vx(x) + CELL / 2, vy(y) + CELL / 2, CELL * 0.17, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill(); }
      }
    }
    if (sel && sel.alive) rect(vx(sel.x), vy(sel.y), CELL, CELL, 'rgba(247,236,89,0.55)');
    if (preview) for (const q of preview) rect(vx(q.x), vy(q.y), CELL, CELL, 'rgba(235,97,80,0.5)');
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const m = g.board[y][x];
      if (m) drawMinion(m, vx(x), vy(y));
    }
    // chess.com style hints: dots for free squares, rings for captures
    for (const o of opts) {
      const sq = o.clicks || (o.click ? [o.click] : []);
      for (const c of sq) {
        const cx = vx(c.x) + CELL / 2, cy = vy(c.y) + CELL / 2;
        const hit = !!C.at(c.x, c.y) && o.kind !== 'spawn';
        ctx.beginPath();
        if (hit) {
          ctx.arc(cx, cy, CELL * 0.45, 0, Math.PI * 2); ctx.lineWidth = 6;
          ctx.strokeStyle = o.kind === 'special' ? 'rgba(150,110,255,0.85)' : 'rgba(224,60,50,0.85)'; ctx.stroke();
        } else {
          ctx.arc(cx, cy, CELL * 0.17, 0, Math.PI * 2);
          ctx.fillStyle = o.kind === 'special' ? 'rgba(150,110,255,0.85)' : 'rgba(10,10,10,0.42)'; ctx.fill();
        }
        if (hc && sameCell(hc, c) && !inBadge) {
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.strokeRect(vx(hc.x) + 2, vy(hc.y) + 2, CELL - 4, CELL - 4);
        }
      }
    }
    // badges (area attack / special switch) on the selected piece
    for (const b of badges) {
      rr(b.x, b.y, b.s, b.s, 6); ctx.fillStyle = b.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = (hb === b) ? '#fff' : 'rgba(0,0,0,0.5)'; ctx.stroke();
      if (b.glyph === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = i * Math.PI / 8, rad = i % 2 ? 5 : 10;
          const px = b.x + 13 + Math.cos(a) * rad, py = b.y + 13 + Math.sin(a) * rad;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
      } else txt(b.glyph, b.x + 13, b.y + 20, 18, '#fff', 'center');
    }
    for (const o of opts) {
      if (o.click && o.cost > 0 && o.kind !== 'spawn') txt(String(o.cost), vx(o.click.x) + CELL - 6, vy(o.click.y) + CELL - 6, 18, '#fff', 'right');
    }
    // planning marks and arrows
    for (const m of marks) rect(vx(m.x), vy(m.y), CELL, CELL, 'rgba(' + m.c + ',0.5)');
    for (const a of arrows) drawArrow(a.a, a.b, a.c);
    if (drag && hc && (hc.x !== drag.from.x || hc.y !== drag.from.y)) drawArrow(drag.from, hc, drag.c);
    // fx
    const now = Date.now();
    g.fx = g.fx.filter(f => now - f.t < 600);
    for (const f of g.fx) {
      const k = (now - f.t) / 600, cx = vx(f.x) + CELL / 2, cy = vy(f.y) + CELL / 2;
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

  const LP = { x: 12, y: 10, w: 308, h: 880 };
  const HP = { x: 1034, y: 10, w: 190, h: 880 };
  const RP = { x: 1232, y: 10, w: 356, h: 880 };

  function drawSidePanels(placing) {
    const g = G();
    panel(LP.x, LP.y, LP.w, LP.h);
    panel(RP.x, RP.y, RP.w, RP.h);
    panel(HP.x, HP.y, HP.w, HP.h);
    if (placing) {
      txt(C.NAMES[placeFor] + ' places the king', LP.x + LP.w / 2, 70, 30, PCOL[placeFor], 'center');
      drawRight(false);
      return;
    }
    const P = g.players[viewer()];
    const lx = LP.x + 24;
    txt(C.NAMES[g.cur] + "'s turn", lx, 58, 30, g.cur === 0 ? '#3f7ae8' : '#e04a42', 'left');
    txt('Turn ' + g.players[g.cur].turn, LP.x + LP.w - 20, 58, 20, DIM, 'right');
    let cost = hoverCost;
    if (!cost && spawnCard !== null) cost = (C.DEF[P.hand[spawnCard]] || { cost: 0 }).cost;
    drawManaBar(MB.x, MB.w, P.mana, P.maxMana, Math.min(cost, P.mana));
    // info
    const human = isHumanTurn();
    let d = hoverDef;
    if (!d && sel && sel.alive) d = sel.def;
    if (!d && spawnCard !== null) d = C.DEF[P.hand[spawnCard]];
    if (d) drawInfo(d, lx, 84, LP.w - 40);
    else txt('Hover a card or minion', LP.x + LP.w / 2, 380, 18, DIM, 'center');
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
    const name = mode === 'online' && ol ? (pi === ol.side ? 'You' : '') + (ol.names[pi] ? (pi === ol.side ? ' (' + ol.names[pi] + ')' : ol.names[pi]) : C.NAMES[pi]) : mode === 'ai' ? (pi === 0 ? 'You' : 'Computer') : C.NAMES[pi];
    txt(name, rx + 86, y + 38, 22, TX, 'left');
    txt('Hand ' + P.hand.length + '  \u00B7  Deck ' + P.deck.length, rx + 86, y + 62, 15, DIM, 'left');
    if (clock.on) {
      const ms = clock.ms[pi];
      rr(rx + w - 100, y + 20, 86, 44, 6);
      ctx.fillStyle = active ? '#fff' : '#1f1e1b'; ctx.fill();
      txt(fmtClock(ms), rx + w - 57, y + 51, 26, active ? (ms < 30000 ? '#c0392b' : '#262522') : (ms < 30000 ? '#e0584b' : DIM), 'center');
    } else if (active) { ctx.beginPath(); ctx.arc(rx + w - 20, y + 20, 6, 0, Math.PI * 2); ctx.fillStyle = GREEN; ctx.fill(); }
  }

  const bottomSide = () => (mode === 'online' && ol ? ol.side : 0);
  function drawRight(human) {
    const g = G();
    const rx = RP.x + 16, w = RP.w - 32;
    playerBar(1 - bottomSide(), RP.y + 14);
    playerBar(bottomSide(), RP.y + RP.h - 14 - 56 - 12 - 84);
    const placing = screen === 'place';
    const text = placing ? (mode === 'online' && placeFor !== mySide() ? 'Waiting for the opponent to place their Villager...' : 'Place your Villager (king) on a free square in your spawn zone.') : (msg && Date.now() - msgT < 8000 ? msg : '');
    if (text) {
      slot(rx, RP.y + 116, w, 120, '#2d2b28');
      wrap(text, rx + 16, RP.y + 150, w - 32, 18, 24, TX);
    }
    button(rx, RP.y + 256, w, 48, 'Menu', () => { confirmMenu = true; }, { size: 18 });
    button(rx, RP.y + RP.h - 14 - 56, w, 56, 'End Turn', endTurn,
      { enabled: !placing && human && !pass && g.winner === null && !aiBusy, size: 26, col: '#81b64c', hot: '#95c95d' });
  }

  function afterAction() {
    arrows = []; marks = [];
    if (sel && !sel.alive) sel = null;
    selMode = 'normal';
    spawnCard = null;
    if (G().winner !== null) onWin();
  }
  function onWin() {
    if (!overSent) { overSent = true; post({ type: 'gameOver', score: G().turnNo }); }
  }

  // hand: a vertical column to the right of the board, mirroring the mana gauge
  function cardRects() {
    const P = G().players[viewer()];
    const n = P.hand.length, gap = 6;
    const ch = Math.min(74, Math.floor((ROWS * CELL - Math.max(0, n - 1) * gap) / Math.max(n, 1)));
    return P.hand.map((id, i) => ({ id, i, x: HP.x + 10, y: BY + i * (ch + gap), w: HP.w - 20, h: ch }));
  }
  function drawHand() {
    const g = G(), P = g.players[viewer()];
    const live = isHumanTurn() && !pass && g.winner === null;
    let hov = null;
    for (const c of cardRects()) {
      const d = C.DEF[c.id];
      const aff = live && d.cost <= P.mana;
      const sl = live && spawnCard === c.i;
      const over = live && inRect(mouse.x, mouse.y, c.x, c.y, c.w, c.h);
      if (over) { hov = d; if (aff) hoverCostNext = d.cost; }
      slot(c.x, c.y, c.w, c.h, over ? '#4a4744' : aff ? '#3d3a37' : '#2d2b28');
      if (sl) { rr(c.x - 2, c.y - 2, c.w + 4, c.h + 4, 8); ctx.lineWidth = 3; ctx.strokeStyle = GREEN; ctx.stroke(); }
      const cy = c.y + c.h / 2;
      ctx.globalAlpha = aff ? 1 : 0.5;
      sprite(d.id, c.x + 62, cy, Math.min(54, c.h - 10));
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(c.x + 20, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = aff ? '#e8a43a' : '#4a4744'; ctx.fill();
      txt(String(d.cost), c.x + 20, cy + 6, 17, aff ? '#2b1a00' : '#8a8885', 'center');
      setFont(15);
      const avail = c.w - 96;
      const fs = ctx.measureText(d.name).width > avail ? Math.max(11, Math.floor(15 * avail / ctx.measureText(d.name).width)) : 15;
      txt(d.name, c.x + 94, cy + 5, fs, aff ? TX : '#7d7b78', 'left');
      if (live) btns.push({ x: c.x, y: c.y, w: c.w, h: c.h, enabled: true, fn: () => selectCard(c.i) });
    }
    if (hov) hoverNext = hov;
    if (!P.hand.length) txt('Hand empty', HP.x + HP.w / 2, 60, 18, DIM, 'center');
  }

  function selectCard(i) {
    const g = G(), P = g.players[viewer()];
    if (spawnCard === i) { spawnCard = null; return; }
    sel = null; selMode = 'normal';
    const d = C.DEF[P.hand[i]];
    if (d.cost > P.mana) { say('Not enough mana for ' + d.name + ' (costs ' + d.cost + ').'); spawnCard = null; return; }
    spawnCard = i;
    say(d.name + ': click a highlighted square in your spawn zone.');
  }

  function onBoardClick(cell) {
    const g = G();
    if (screen === 'place' && mode === 'online') {
      if (placeFor !== mySide()) say('Waiting for the opponent to place their Villager...');
      else if (!ol.pending) submit({ t: 'place', p: mySide(), x: cell.x, y: cell.y });
      return;
    }
    if (screen === 'place') {
      if (C.placeVillager(placeFor, cell.x, cell.y)) afterPlace();
      else say('Pick a free square in your own spawn zone.');
      return;
    }
    if (!isHumanTurn() || pass || g.winner !== null) return;
    const opts = curOptions();
    const bd = badgesFor(opts).find(b => inRect(mouse.x, mouse.y, b.x, b.y, b.s, b.s));
    if (bd) {
      if (bd.opt) doOpt(bd.opt); else selMode = selMode === 'special' ? 'normal' : 'special';
      return;
    }
    const o = optAt(opts, cell);
    if (o) { doOpt(o); return; }
    const m = C.at(cell.x, cell.y);
    if (m && m.owner === g.cur) {
      spawnCard = null; selMode = 'normal';
      sel = sel === m ? null : m;
      if (sel && m.sick) say('This minion was just spawned and cannot act until your next turn.');
      else if (sel && badgesFor(curOptions()).length) say('Use the badge in the corner of the piece: red star = area attack, purple arrows = special ability.');
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
      const online = mode === 'online' && ol;
      const t = online ? (g.winner === ol.side ? 'You win!' : 'You lose') : human ? (g.winner === 0 ? 'You win!' : 'Computer wins') : C.NAMES[g.winner] + ' wins!';
      txt(t, W / 2, 370, 100, (online ? g.winner === ol.side : g.winner === 0) ? '#8fb2ff' : '#ff8d86', 'center');
      txt(g.timeout ? 'Someone ran out of time.' : g.resigned ? 'A player resigned.' : 'The enemy Villager was eliminated.', W / 2, 420, 26, '#ddd', 'center');
      if (online) {
        const r = ol.row;
        if (r && r.status === 'finished') {
          const line = r.winner === null || r.winner === undefined ? 'Result disputed - no rating change.'
            : 'Rating ' + (r.winner === ol.side ? '+' : '-') + (r.rating_delta || 0) + (Online.profile ? '  (now ' + Online.profile.rating + ')' : '');
          txt(line, W / 2, 462, 24, ACC, 'center');
        } else txt('Saving the result...', W / 2, 462, 20, DIM, 'center');
        button(685, 490, 230, 70, 'Menu', toMenu, { size: 28 });
      } else {
        button(560, 470, 230, 70, 'Rematch', () => beginMatch(), { size: 28 });
        button(810, 470, 230, 70, 'Menu', toMenu, { size: 28 });
      }
      return;
    }
    if (confirmMenu) {
      rect(0, 0, W, H, 'rgba(0,0,0,0.7)');
      const onl = mode === 'online' && ol && G().winner === null;
      txt(onl ? 'Resign the match?' : 'Leave the match?', W / 2, 380, 54, '#fff', 'center');
      button(560, 430, 230, 70, onl ? 'Resign' : 'Leave', onl ? resignOnline : toMenu, { size: 28, col: '#b83b32', hot: '#cf4b41' });
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
  function tickClock() {
    const now = Date.now(), dt = now - clock.last;
    clock.last = now;
    if (mode === 'online' && ol && (screen === 'play' || screen === 'place')) { tickOnlineClock(); return; }
    if (!clock.on || screen !== 'play') return;
    const g = G();
    if (g.winner !== null || pass || paused || confirmMenu) return;
    clock.ms[g.cur] -= dt;
    if (clock.ms[g.cur] <= 0) {
      clock.ms[g.cur] = 0;
      g.loser = g.cur; g.winner = 1 - g.cur; g.timeout = true;
    }
  }
  function fmtClock(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function frame() {
    tickClock();
    btns = [];
    hoverBtnPreview = null;
    hoverNext = null;
    hoverCostNext = 0;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    if (screen === 'menu') drawMenu();
    else if (screen === 'help') drawHelp();
    else if (screen === 'deck') drawDeck();
    else if (screen === 'queue') drawQueue();
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
  canvas.addEventListener('pointermove', e => {
    mouse = pos(e);
    if (sbDrag && sbGeom) {
      const track = DECK_VIEW.h - sbGeom.th;
      deckScroll = Math.max(0, Math.min(sbGeom.maxScroll, sbDrag.start + (mouse.y - sbDrag.y0) * sbGeom.maxScroll / track));
    }
  });
  canvas.addEventListener('wheel', e => {
    if (screen !== 'deck') return;
    e.preventDefault();
    deckScroll += e.deltaY * (e.deltaMode === 1 ? 30 : 1);
  }, { passive: false });
  window.addEventListener('pointerup', () => { sbDrag = null; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerup', e => {
    if (e.button !== 2 || !drag) return;
    mouse = pos(e);
    const cell = cellAt(mouse.x, mouse.y), d = drag;
    drag = null;
    if (!cell) return;
    if (sameCell(cell, d.from)) {
      const i = marks.findIndex(m => sameCell(m, cell));
      if (i >= 0) marks.splice(i, 1); else marks.push({ x: cell.x, y: cell.y, c: d.c });
    } else {
      const i = arrows.findIndex(a => sameCell(a.a, d.from) && sameCell(a.b, cell));
      if (i >= 0) arrows.splice(i, 1); else arrows.push({ a: d.from, b: cell, c: d.c });
    }
  });
  canvas.addEventListener('pointerdown', e => {
    mouse = pos(e);
    if (e.button === 2) {
      if ((screen === 'play') && !pass && !confirmMenu && !paused) {
        const cell = cellAt(mouse.x, mouse.y);
        if (cell) drag = { from: cell, c: arrowColor(e) };
      }
      return;
    }
    if (pending > 0) return;
    if (screen === 'deck' && sbGeom && inRect(mouse.x, mouse.y, sbGeom.tx - 8, DECK_VIEW.y, sbGeom.tw + 16, DECK_VIEW.h)) {
      if (mouse.y < sbGeom.ty || mouse.y > sbGeom.ty + sbGeom.th) {
        const track = DECK_VIEW.h - sbGeom.th;
        deckScroll = Math.max(0, Math.min(sbGeom.maxScroll, (mouse.y - DECK_VIEW.y - sbGeom.th / 2) / track * sbGeom.maxScroll));
      }
      sbDrag = { y0: mouse.y, start: deckScroll };
      return;
    }
    for (let i = prevBtns.length - 1; i >= 0; i--) {
      const b = prevBtns[i];
      if (inRect(mouse.x, mouse.y, b.x, b.y, b.w, b.h)) { if (b.enabled) b.fn(); return; }
    }
    if ((screen === 'play' || screen === 'place') && !pass && !confirmMenu && !paused) {
      const cell = cellAt(mouse.x, mouse.y);
      if (cell) { arrows = []; marks = []; onBoardClick(cell); }
    }
  });
  canvas.addEventListener('pointerleave', () => { mouse = { x: -1, y: -1 }; drag = null; });
  window.addEventListener('keydown', e => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (screen === 'play' || screen === 'place') {
        if (G() && G().winner !== null) toMenu(); else confirmMenu = !confirmMenu;
      } else if (screen === 'queue') cancelQueue();
      else if (screen === 'deck' || screen === 'help') screen = 'menu';
    } else if (e.key === 'p' || e.key === 'P') {
      if (screen === 'play' && !pass && mode !== 'online') paused = !paused;
    } else if ((e.key === 'Enter' || e.key === ' ') && screen === 'play') {
      e.preventDefault();
      if (!pass && !confirmMenu && !paused && isHumanTurn() && !aiBusy && G().winner === null) endTurn();
    }
  });

  /* ================= online (Supabase) ================= */
  const dlg = document.getElementById('dlg');
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function dlgOpen(html, wire) {
    dlg.innerHTML = '<div class="card">' + html + '</div>';
    dlg.classList.add('on');
    wire(dlg.querySelector('.card'));
    const f = dlg.querySelector('input'); if (f) f.focus();
  }
  function dlgClose() { dlg.classList.remove('on'); dlg.innerHTML = ''; }
  function infoDialog(title, text) {
    dlgOpen('<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="row"><button class="go">OK</button></div>',
      c => { c.querySelector('.go').onclick = dlgClose; });
  }

  function showAuth(onDone) {
    let tab = 'in';
    const render = () => {
      dlgOpen(
        '<h2>Play online</h2>' +
        '<div class="tabs"><button data-t="in" class="' + (tab === 'in' ? 'on' : '') + '">Sign in</button>' +
        '<button data-t="up" class="' + (tab === 'up' ? 'on' : '') + '">Create account</button></div>' +
        (tab === 'up' ? '<input id="a-name" maxlength="16" placeholder="Username (3-16 letters, digits, _)" autocomplete="username">' : '') +
        '<input id="a-mail" type="email" placeholder="Email" autocomplete="email">' +
        '<input id="a-pass" type="password" placeholder="Password (6+ characters)" autocomplete="' + (tab === 'up' ? 'new-password' : 'current-password') + '">' +
        '<div class="err" id="a-err"></div>' +
        '<div class="row"><button class="go">' + (tab === 'up' ? 'Create account' : 'Sign in') + '</button></div>' +
        '<div class="row"><button class="alt" id="a-guest">Play as guest</button><button class="alt" id="a-x">Cancel</button></div>',
        c => {
          c.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => { tab = b.dataset.t; render(); }; });
          const err = m => { c.querySelector('#a-err').textContent = m || ''; };
          const val = id => (c.querySelector(id) || { value: '' }).value.trim();
          const done = r => { if (!r.ok) { err(r.error); return; } if (r.needsConfirm) { err('Check your inbox and confirm your email, then sign in.'); return; } dlgClose(); onDone(); };
          c.querySelector('.go').onclick = async () => {
            err('Working...');
            if (tab === 'up') {
              if (!/^[A-Za-z0-9_]{3,16}$/.test(val('#a-name'))) { err('Username: 3-16 letters, digits or _.'); return; }
              done(await Online.signUp(val('#a-mail'), c.querySelector('#a-pass').value, val('#a-name')));
            } else done(await Online.signIn(val('#a-mail'), c.querySelector('#a-pass').value));
          };
          c.querySelector('#a-guest').onclick = async () => { err('Working...'); done(await Online.guest()); };
          c.querySelector('#a-x').onclick = dlgClose;
          c.addEventListener('keydown', e => { if (e.key === 'Enter') c.querySelector('.go').click(); });
        });
    };
    render();
  }

  function askCode() {
    dlgOpen('<h2>Join with a code</h2><input id="c-code" maxlength="8" placeholder="Invite code" style="text-transform:uppercase"><div class="err" id="c-err"></div>' +
      '<div class="row"><button class="go">Join</button><button class="alt" id="c-x">Cancel</button></div>', c => {
      c.querySelector('#c-x').onclick = dlgClose;
      c.querySelector('.go').onclick = () => { const v = c.querySelector('#c-code').value.trim(); if (v) { dlgClose(); startSearch('code', v); } };
      c.addEventListener('keydown', e => { if (e.key === 'Enter') c.querySelector('.go').click(); });
    });
  }

  function showLeaderboard() {
    dlgOpen('<h2>Leaderboard</h2><div id="lb">Loading...</div><div class="row"><button class="go">Close</button></div>', c => {
      c.querySelector('.go').onclick = dlgClose;
      Online.leaderboard().then(r => {
        const el = c.querySelector('#lb');
        if (!r.ok) { el.textContent = r.error; return; }
        el.innerHTML = '<table>' + r.rows.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(p.username) + '</td><td>' + p.rating + '</td><td>' + p.wins + ' W / ' + p.losses + ' L</td></tr>').join('') + '</table>';
      });
    });
  }

  function openOnline() {
    if (!Online.enabled) {
      infoDialog('Online play is not set up yet', 'Add your Supabase URL and anon key to js/config.js (see supabase/SETUP.md).');
      return;
    }
    if (!Online.signedIn) { showAuth(() => startDeckBuild('online')); return; }
    startDeckBuild('online');
  }

  function drawAccountChip() {
    if (!Online.enabled) return;
    if (Online.signedIn) {
      const p = Online.profile;
      txt((p ? p.username : '...') + (p ? '  \u00B7  ' + p.rating : ''), W - 24, 40, 20, TX, 'right');
      button(W - 24 - 112, 54, 112, 38, 'Sign out', () => { Online.signOut(); resumeRow = null; }, { size: 15 });
      button(W - 24 - 112 - 130, 54, 120, 38, 'Leaderboard', showLeaderboard, { size: 15 });
      if (resumeRow) button(W - 24 - 262, 102, 262, 44, 'Resume online match', () => enterMatch(resumeRow), { size: 17, col: '#81b64c', hot: '#95c95d' });
    } else {
      button(W - 24 - 130, 20, 130, 44, 'Sign in', () => showAuth(() => {}), { size: 18 });
    }
  }
  function refreshResume() {
    if (Online.enabled && Online.signedIn) Online.activeMatch().then(r => { resumeRow = r; });
  }

  /* ---- matchmaking ---- */
  async function startSearch(kind, code) {
    saveDeck();
    queue = { id: null, code: null, kind, stop: null };
    screen = 'queue';
    const deck = deckCounts[0];
    const r = kind === 'code' ? await Online.joinCode(code, deck)
      : kind === 'private' ? await Online.createPrivate(deck, timeCtl)
        : await Online.findMatch(deck, timeCtl);
    if (!queue) return;                       // cancelled while waiting for the server
    if (!r.ok) { queue = null; screen = 'deck'; infoDialog('Could not start', r.error); return; }
    const row = r.data;
    if (row.status === 'active') { enterMatch(row); return; }
    queue.id = row.id; queue.code = row.code;
    queue.stop = Online.waitForOpponent(row.id, enterMatch);
  }
  function cancelQueue() {
    if (queue) { if (queue.stop) queue.stop(); if (queue.id) Online.cancel(queue.id); }
    queue = null; screen = 'deck';
  }
  function drawQueue() {
    drawBackdrop(true);
    const dots = '.'.repeat(1 + Math.floor(Date.now() / 400) % 3);
    txt('Looking for an opponent' + dots, W / 2, 300, 44, '#fff', 'center');
    const tl = timeCtl ? timeCtl / 60 + ' min per player' : 'untimed';
    txt('Time control: ' + tl, W / 2, 346, 20, DIM, 'center');
    if (queue && queue.code) {
      txt('Invite code', W / 2, 430, 22, DIM, 'center');
      txt(queue.code, W / 2, 510, 84, ACC, 'center');
      txt('Send this code to your friend. They pick "Join code".', W / 2, 556, 20, DIM, 'center');
    }
    button(650, 620, 300, 64, 'Cancel', cancelQueue, { size: 24 });
  }

  /* ---- live match ---- */
  async function enterMatch(row) {
    if (queue && queue.stop) queue.stop();
    queue = null;
    mode = 'online';
    ol = { row, side: row.p0 === Online.userId ? 0 : 1, used: [0, 0], lastTs: Date.parse(row.started_at), moves: 0, pending: false, reported: false, names: ['', ''] };
    C.newGame([row.deck0, row.deck1], row.seed);
    screen = 'place'; placeFor = 0; sel = null; spawnCard = null; selMode = 'normal'; arrows = []; marks = [];
    overSent = false; confirmMenu = false; paused = false; pass = null; clock.on = false;
    say(ol.side === 0 ? 'Place your Villager (king) in your spawn zone.' : 'Waiting for the opponent to place their Villager...');
    await Online.syncClock();
    const res = await Online.openMatch(row.id, { onMove: onOnlineMove, onMatch: r => { if (ol) ol.row = r; } });
    if (!res.ok) { infoDialog('Could not open the match', res.error); toMenu(); return; }
    if (ol) {
      ol.names[0] = (res.profiles[row.p0] || {}).username || 'Blue';
      ol.names[1] = (res.profiles[row.p1] || {}).username || 'Red';
    }
  }

  function onOnlineMove(r) {
    if (!ol) return;
    const mine = r.player === ol.side;
    const ts = Date.parse(r.created_at);
    ol.used[r.player] += Math.max(0, ts - ol.lastTs);
    ol.lastTs = ts;
    const res = C.applyAction(r.action);
    if (!res.ok) {
      if (!mine && !ol.reported) {
        ol.reported = true;
        Online.report(ol.row.id, ol.side, 'illegal move');
        infoDialog('Illegal move', 'Your opponent sent a move the rules do not allow. The match was reported.');
      }
      return;
    }
    ol.moves++;
    arrows = []; marks = [];
    spawnCard = null; selMode = 'normal';
    if (!mine || (sel && !sel.alive)) sel = null;
    const g = G();
    if (g.phase === 'place') {
      placeFor = g.players[0].villager ? 1 : 0;
      say(placeFor === ol.side ? 'Place your Villager (king) in your spawn zone.' : 'Waiting for the opponent to place their Villager...');
    } else if (screen === 'place') {
      screen = 'play';
      say(g.cur === ol.side ? 'Your turn.' : "Opponent's turn.");
      post({ type: 'ready' });
    } else if (r.action.t === 'end') say(g.cur === ol.side ? 'Your turn.' : "Opponent's turn.");
    if (g.winner !== null) onlineFinished();
  }

  function onlineFinished() {
    if (!ol || ol.finished) return;
    ol.finished = true;
    onWin();
    if (ol.reported) return;
    ol.reported = true;
    const g = G();
    Online.report(ol.row.id, g.winner, g.timeout ? 'timeout' : g.resigned ? 'resign' : 'villager')
      .then(() => setTimeout(() => Online.loadProfile(), 1500));
  }

  function tickOnlineClock() {
    const g = G(), base = ol.row.time_ctl * 1000;
    clock.on = base > 0;
    if (!clock.on) return;
    const mover = screen === 'place' ? placeFor : g.cur;
    const live = g.winner === null ? Math.max(0, Online.serverNow() - ol.lastTs) : 0;
    for (let p = 0; p < 2; p++) clock.ms[p] = Math.max(0, base - ol.used[p] - (p === mover ? live : 0));
    if (g.winner === null && clock.ms[mover] <= 0) {
      g.loser = mover; g.winner = 1 - mover; g.timeout = true;
      onlineFinished();
    }
  }

  function resignOnline() {
    confirmMenu = false;
    if (!ol || G().winner !== null) { toMenu(); return; }
    Online.send(ol.side, { t: 'resign', p: ol.side }).then(() => setTimeout(toMenu, 400));
  }

  if (Online.enabled) {
    Online.init();
    Online.onChange(() => refreshResume());
  }

  post({ type: 'ready' });
  requestAnimationFrame(frame);
})();
