/* Exploration harness shared by the three directions: URL state
   (#screen=1-3&mode=light|dark), keys 1-3 and D, scaling, and the app
   chrome around the review page. &labels=asked shows the needs/info labels in red and
   green as first asked; the default keeps the signal meanings. Screens: 1 plan waits for Plan Go,
   2 the same plan while it runs (demo progress), 3 spec waits for Spec OK.
   Add &shot to hide the control bar for screenshots. */

(function () {
  const P = {
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7"/><path d="M18 10.5c0 4-6 3-11 5.5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chev: '<path d="m9 18 6-6-6-6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const lamp = (signal) => `<span class="lamp${signal === 'idle' ? ' ring' : ''}"></span>`;
  const label = (signal, text) => `<span class="label sig-${signal}">${lamp(signal)}${text}</span>`;

  function readState() {
    const h = new URLSearchParams(location.hash.slice(1));
    const screen = Math.min(3, Math.max(1, parseInt(h.get('screen') || '1', 10) || 1));
    const mode = h.get('mode') === 'light' ? 'light' : 'dark';
    const labels = h.get('labels') === 'asked' ? 'asked' : 'signal';
    return { screen, mode, labels, shot: h.has('shot') };
  }

  function sessionList(screen) {
    const R = window.REVIEW;
    return R.sessions.map((g) => `
      <div class="group-name">${g.project}</div>
      ${g.items.map((s, i) => {
        let word = s.word, signal = s.signal, progress = s.progress;
        if (s.name === 'm1-walking-skeleton') {
          if (screen === 2) { word = 'Running · task 7'; signal = 'running'; progress = '9 of 17'; }
          if (screen === 3) { word = 'Spec waits'; progress = 'spec'; }
        }
        const sel = s.name === 'm1-walking-skeleton' ? ' sel' : '';
        return `<div class="srow${sel}"><span class="n">${s.name}</span><span class="p">${progress}</span><span class="w sig-${signal}">${lamp(signal)}${word}</span></div>`;
      }).join('')}`).join('');
  }

  function titlebar(screen) {
    const doc = screen === 3 ? 'Spec' : 'Plan';
    const note = screen === 2
      ? `<span class="note">${label('running', 'Nothing needs you')}</span>`
      : `<span class="note">${label('plan', '1 needs you')}<span>${doc} for m1-walking-skeleton</span></span>`;
    return `<div class="titlebar"><span class="brand">Orchtopus</span>
      <span class="crumbs">${icon('chev', 't')}<b>orchtopus</b>${icon('chev', 't')}<b>m1-walking-skeleton</b>${icon('chev', 't')}<b>${doc}</b></span>
      ${note}
      <span class="tb-btn">${icon('inbox', 's')}Inbox 1</span><span class="tb-btn">${icon('settings', 's')}</span></div>`;
  }

  function statusbar(screen, hints) {
    const counts = screen === 2
      ? `<span class="c sig-running">${lamp('running')}3 running</span><span class="c sig-done">${lamp('done')}1 PR draft</span>`
      : `<span class="c sig-plan">${lamp('plan')}1 needs you</span><span class="c sig-running">${lamp('running')}2 running</span><span class="c sig-done">${lamp('done')}1 PR draft</span>`;
    return `<div class="status">${counts}<span class="c">Claude Code connected</span><span class="c">Git updated 3 s ago</span>
      <span class="hints">${hints.map(([k, t]) => `<span><span class="key">${k}</span>${t}</span>`).join('')}</span></div>`;
  }

  function sourceLine(doc) {
    return `<span class="source">${icon('shield', 't')}<span>Page written by the session from template <span class="mono">${doc.template}</span></span>
      <span class="ok">${icon('check', 't')}Matches the Markdown</span><span class="mono">sha256 ${doc.sha256.slice(0, 12)}</span></span>`;
  }

  function controls(state) {
    const b = (k, v, t) => `<button data-k="${k}" data-v="${v}" aria-pressed="${String(state[k]) === String(v)}">${t}</button>`;
    return `<div class="xctl" role="toolbar" aria-label="Exploration controls">${b('screen', 1, '1 Plan')}${b('screen', 2, '2 Running')}${b('screen', 3, '3 Spec')}${b('mode', 'light', 'Light')}${b('mode', 'dark', 'Dark')}${b('labels', 'asked', 'Red and green')}${b('labels', 'signal', 'Signal labels')}</div>`;
  }

  function fit() {
    const w = document.querySelector('.window');
    if (!w) return;
    const s = Math.min(1, innerWidth / w.offsetWidth, innerHeight / w.offsetHeight);
    w.style.transform = s < 1 ? `scale(${s})` : '';
  }

  function start(render) {
    function draw() {
      const st = readState();
      document.documentElement.dataset.mode = st.mode;
      document.documentElement.dataset.labels = st.labels;
      document.documentElement.classList.toggle('shot', st.shot);
      document.getElementById('app').innerHTML = render(st) + controls(st);
      document.querySelectorAll('.xctl button').forEach((btn) => btn.addEventListener('click', () => set(btn.dataset.k, btn.dataset.v)));
      fit();
    }
    function set(k, v) {
      const h = new URLSearchParams(location.hash.slice(1));
      h.set(k, v);
      location.hash = h.toString().replace('shot=', 'shot');
    }
    addEventListener('hashchange', draw);
    addEventListener('resize', fit);
    addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      if (['1', '2', '3'].includes(e.key)) set('screen', e.key);
      if (e.key === 'd' || e.key === 'D') set('mode', readState().mode === 'dark' ? 'light' : 'dark');
    });
    draw();
  }

  window.X = { icon, lamp, label, sessionList, titlebar, statusbar, sourceLine, start };
})();
