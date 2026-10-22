/* CHEGG online layer: Supabase auth, matchmaking and lockstep move sync.
   Needs js/config.js (URL + anon key) and js/vendor/supabase.js. All functions resolve to {ok, ...}. */
const Online = (function () {
  const cfg = window.CHEGG_CONFIG || {};
  const enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  let sb = null, session = null, profile = null, offset = 0;
  const listeners = [];
  let match = null, expected = 0, buffer = {}, handlers = null, channel = null, poll = null, sending = false;

  const fail = e => ({ ok: false, error: (e && (e.message || e.error_description)) || String(e) });
  const notify = () => listeners.forEach(f => { try { f(); } catch (e) { /* ignore */ } });

  function init() {
    if (!enabled || sb) return;
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    sb.auth.getSession().then(({ data }) => {
      session = data.session;
      if (session) loadProfile().then(notify); else notify();
    });
    sb.auth.onAuthStateChange((ev, sess) => {
      session = sess;
      // never call supabase from inside this callback directly
      setTimeout(() => { if (sess) loadProfile().then(notify); else { profile = null; notify(); } }, 0);
    });
  }

  async function refresh() {
    const { data } = await sb.auth.getSession();
    session = data.session;
    await loadProfile();
    notify();
  }
  // align our clock with the server's (for the chess clock)
  async function syncClock() {
    try {
      const t0 = Date.now();
      const { data, error } = await sb.rpc('server_time');
      if (error || !data) return;
      offset = Date.parse(data) - (t0 + (Date.now() - t0) / 2);
    } catch (e) { /* keep the old offset */ }
  }

  async function loadProfile() {
    if (!session) return null;
    const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    profile = data || null;
    return profile;
  }

  /* ---------- auth ---------- */
  async function signUp(email, password, username) {
    try {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
      if (error) {
        const m = /database error/i.test(error.message) ? 'That username is taken or invalid (3-16 letters, digits or _).' : error.message;
        return { ok: false, error: m };
      }
      if (!data.session) return { ok: true, needsConfirm: true };
      await refresh();
      return { ok: true };
    } catch (e) { return fail(e); }
  }
  async function signIn(email, password) {
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return fail(error);
      await refresh();
      return { ok: true };
    } catch (e) { return fail(e); }
  }
  async function guest() {
    try {
      const { error } = await sb.auth.signInAnonymously();
      if (error) return fail(error);
      await refresh();
      return { ok: true };
    } catch (e) { return fail(e); }
  }
  async function signOut() { try { await sb.auth.signOut(); } catch (e) { /* ignore */ } session = null; profile = null; notify(); }

  /* ---------- matchmaking ---------- */
  async function rpc(name, args) {
    try {
      const { data, error } = await sb.rpc(name, args);
      return error ? fail(error) : { ok: true, data };
    } catch (e) { return fail(e); }
  }
  const findMatch = (deck, time) => rpc('find_match', { p_deck: deck, p_time: time });
  const createPrivate = (deck, time) => rpc('create_private', { p_deck: deck, p_time: time });
  const joinCode = (code, deck) => rpc('join_code', { p_code: code, p_deck: deck });
  const cancel = id => rpc('cancel_match', { p_id: id });
  const report = (id, winner, reason) => rpc('report_result', { p_match: id, p_winner: winner, p_reason: reason });
  const claimIdle = id => rpc('claim_idle_win', { p_match: id });

  // wait until somebody joins our open game (or we get paired by polling); cb(row) fires once it is active
  function waitForOpponent(id, cb) {
    let done = false, t1 = null, t2 = null, ch = null;
    const stop = () => { clearInterval(t1); clearInterval(t2); if (ch) sb.removeChannel(ch); };
    const finish = row => { if (done) return; done = true; stop(); cb(row); };
    const check = async () => {
      if (done) return;
      const { data } = await sb.from('matches').select('*').eq('id', id).maybeSingle();
      if (data && data.status === 'active') finish(data);
    };
    // pairing with another waiting player only happens when somebody calls find_match / poll_match
    const poll = async () => {
      if (done) return;
      const r = await rpc('poll_match', { p_id: id });
      if (r.ok && r.data && r.data.status === 'active') finish(r.data);
    };
    ch = sb.channel('wait:' + id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: 'id=eq.' + id }, check)
      .subscribe();
    t1 = setInterval(check, 3000);
    t2 = setInterval(poll, 4000);
    return () => { done = true; stop(); };
  }

  const startBot = (id, deck) => rpc('start_bot_match', { p_id: id, p_bot_deck: deck });
  async function profileOf(id) {
    const { data } = await sb.from('profiles').select('id,username,rating,wins,losses').eq('id', id).maybeSingle();
    return data;
  }
  async function getMatch(id) {
    const { data } = await sb.from('matches').select('*').eq('id', id).maybeSingle();
    return data;
  }

  /* ---------- live match ---------- */
  async function profilesOf(ids) {
    const { data } = await sb.from('profiles').select('id,username,rating,wins,losses').in('id', ids);
    const o = {};
    (data || []).forEach(p => { o[p.id] = p; });
    return o;
  }

  function feed(row) {
    if (!row || row.idx < expected || buffer[row.idx]) return;
    buffer[row.idx] = row;
    while (buffer[expected]) {
      const r = buffer[expected];
      delete buffer[expected];
      expected++;
      if (handlers && handlers.onMove) handlers.onMove(r);
    }
  }

  async function fetchMoves() {
    if (!match) return;
    const { data } = await sb.from('match_moves').select('*').eq('match_id', match.id).gte('idx', expected).order('idx');
    (data || []).forEach(feed);
  }

  async function openMatch(id, h) {
    closeMatch();
    try {
      const { data: m, error } = await sb.from('matches').select('*').eq('id', id).single();
      if (error) return fail(error);
      match = m; handlers = h; expected = 0; buffer = {};
      const profs = await profilesOf([m.p0, m.p1].filter(Boolean));
      channel = sb.channel('match:' + id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_moves', filter: 'match_id=eq.' + id }, p => feed(p.new))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: 'id=eq.' + id }, p => {
          match = p.new; if (handlers && handlers.onMatch) handlers.onMatch(p.new);
        })
        .subscribe();
      poll = setInterval(async () => {
        await fetchMoves();
        const { data: mm } = await sb.from('matches').select('*').eq('id', id).maybeSingle();
        if (mm && mm.status !== match.status && handlers && handlers.onMatch) { match = mm; handlers.onMatch(mm); }
      }, 4000);
      await fetchMoves();
      return { ok: true, match: m, profiles: profs };
    } catch (e) { return fail(e); }
  }

  async function send(player, action) {
    if (!match || sending) return { ok: false, error: 'busy' };
    sending = true;
    try {
      const { data, error } = await sb.from('match_moves')
        .insert({ match_id: match.id, idx: expected, player, action }).select().single();
      if (error) { await fetchMoves(); return fail(error); }
      offset = Date.parse(data.created_at) - Date.now();
      feed(data);
      return { ok: true };
    } catch (e) { return fail(e); } finally { sending = false; }
  }

  function closeMatch() {
    if (channel && sb) sb.removeChannel(channel);
    if (poll) clearInterval(poll);
    channel = null; poll = null; match = null; handlers = null; expected = 0; buffer = {};
  }

  async function leaderboard() {
    try {
      const { data, error } = await sb.from('profiles').select('username,rating,wins,losses').order('rating', { ascending: false }).limit(20);
      return error ? fail(error) : { ok: true, rows: data };
    } catch (e) { return fail(e); }
  }
  async function activeMatch() {
    if (!session) return null;
    const uid = session.user.id;
    const { data } = await sb.from('matches').select('*').eq('status', 'active').eq('vs_bot', false).or('p0.eq.' + uid + ',p1.eq.' + uid)
      .order('created_at', { ascending: false }).limit(1);
    return data && data[0] ? data[0] : null;
  }

  return {
    enabled, init, refresh, syncClock, signUp, signIn, guest, signOut, loadProfile,
    findMatch, createPrivate, joinCode, cancel, report, claimIdle, waitForOpponent, startBot, profileOf, getMatch,
    openMatch, send, closeMatch, leaderboard, activeMatch,
    onChange: f => listeners.push(f),
    get signedIn() { return !!session; },
    get userId() { return session ? session.user.id : null; },
    get profile() { return profile; },
    get isGuest() { return !!(session && session.user.is_anonymous); },
    serverNow: () => Date.now() + offset
  };
})();
