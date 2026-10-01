import { FIG_ELEMENTS, elementName } from '../skills/fig/elements';
// The core of the i18n module, not its React bindings: this page is plain script.
import {
  LANGUAGE_NAMES,
  LOCALES,
  formatNumber,
  formatPercent,
  getLocale,
  lower,
  setLocale,
  subscribeLocale,
  t,
} from '../i18n/core';

(function () {
  const $ = (id) => document.getElementById(id);
  // Everyone who uses the app may review, so the page uses the app's own service URL and token: nothing to type.
  const API = (import.meta.env.VITE_REVIEW_API_URL || '').replace(/\/+$/, '');
  const token = import.meta.env.VITE_REVIEW_INGEST_TOKEN || '';

  const TABS = [
    { status: 'auto' },
    { status: 'confirmed' },
    { status: 'corrected' },
    { status: 'unknown' },
    { status: 'bad-data' },
  ];
  const tabLabel = (status) => t('rv.tab.' + status);
  const verdictText = (status) => (status in STATUS_OF_VERDICT ? t('rv.verdict.' + status) : status);
  const STATUS_OF_VERDICT = { confirmed: 1, corrected: 1, unknown: 1, 'bad-data': 1 };
  const TWIST_LABELS = { 0: '0', 0.5: '½', 1: '1', 1.5: '1½', 2: '2', 2.5: '2½', 3: '3' };
  const POSITIONS = ['tuck', 'pike', 'straight'];

  let mode = 'auto';
  let counts = {};
  let list = [];
  let current = null;
  let rec = null;
  let u = 0;
  let timer = 0;
  let loadSeq = 0;
  let pick = null; // the figure the chips currently describe
  let cands = []; // candidate figure ids, in key order
  let toastTimer = 0;

  const byId = new Map(FIG_ELEMENTS.map((e) => [e.id, e]));
  const nameOf = (id) => (byId.get(id) ? elementName(byId.get(id)) : id || t('skill.unclassified'));
  const pct = (v) => formatPercent(v);
  const shortVideo = (id) => String(id).slice(0, 8);

  function api(path, init) {
    init = init || {};
    init.headers = Object.assign(
      { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      init.headers || {},
    );
    return fetch(API + path, init).then((r) => {
      if (r.status === 401) {
        signOut('rv.badToken');
        throw new Error('unauthorized');
      }
      return r.json().then((b) => {
        if (!r.ok) throw new Error(b.error || r.status);
        return b;
      });
    });
  }
  // The page cannot work: say why (a message key) instead of showing an empty queue.
  let loginKey = '';
  function signOut(key) {
    loginKey = key || '';
    $('app').hidden = true;
    document.body.classList.add('out');
    $('login').hidden = false;
    $('loginerr').textContent = loginKey ? t(loginKey) : '';
  }
  function showErr(e) {
    $('err').textContent = e && e.message ? e.message : String(e);
  }
  function toast(text) {
    const box = $('toast');
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.hidden = true;
    }, 2200);
  }

  // ---- start ----
  function start() {
    $('login').hidden = true;
    document.body.classList.remove('out');
    $('app').hidden = false;
    try {
      $('who').value = localStorage.getItem('trampovision.reviewer') || '';
      const saved = localStorage.getItem('trampovision.reviewMode');
      if (TABS.some((tab) => tab.status === saved)) mode = saved;
    } catch {
      /* the name and tab are not remembered */
    }
    renderTabs();
    buildChips();
    load();
  }

  function renderTabs() {
    const box = $('tabs');
    box.textContent = '';
    TABS.forEach((tab) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab.status === mode));
      b.appendChild(document.createTextNode(tabLabel(tab.status)));
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = counts[tab.status] == null ? '' : String(counts[tab.status]);
      b.appendChild(n);
      b.onclick = () => {
        mode = tab.status;
        try {
          localStorage.setItem('trampovision.reviewMode', mode);
        } catch {
          /* fine */
        }
        renderTabs();
        load();
      };
      box.appendChild(b);
    });
  }

  function loadStats() {
    return api('/stats')
      .then((b) => {
        counts = {};
        TABS.forEach((tab) => (counts[tab.status] = 0));
        b.stats.forEach((s) => (counts[s.status] = s.n));
        renderTabs();
        renderList();
      })
      .catch(() => {});
  }

  function load() {
    const seq = ++loadSeq;
    const path = mode === 'auto' ? '/jumps?queue=1&limit=100' : '/jumps?status=' + mode + '&limit=100';
    $('listtitle').textContent = tabLabel(mode);
    loadStats();
    api(path)
      .then((b) => {
        if (seq !== loadSeq) return;
        list = b.jumps;
        renderList();
        if (list.length) select(list[0].id);
        else {
          current = null;
          rec = null;
          stop();
          $('detail').hidden = true;
        }
      })
      .catch(showErr);
  }

  function renderList() {
    const ul = $('queue');
    ul.textContent = '';
    $('empty').hidden = list.length > 0;
    $('empty').textContent = t(mode === 'auto' ? 'rv.nothingReview' : 'rv.nothingHere');
    list.forEach((j) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(current === j.id));
      const dot = document.createElement('span');
      dot.className = 'dot ' + j.status;
      const a = document.createElement('span');
      a.className = 'li-name';
      a.textContent = j.review_element_id ? nameOf(j.review_element_id) : nameOf(j.auto_element_id);
      const m = document.createElement('span');
      m.className = 'li-sub muted';
      m.textContent = t('rv.jumpVideoConf', {
        n: j.jump_id,
        video: shortVideo(j.video_id),
        conf: pct(j.auto_confidence),
      });
      b.append(dot, a, m);
      b.onclick = () => select(j.id);
      li.appendChild(b);
      ul.appendChild(li);
      if (current === j.id) requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest' }));
    });
  }

  function select(id) {
    current = id;
    document.body.classList.remove('listopen', 'fixopen');
    renderList();
    $('err').textContent = '';
    api('/jumps/' + encodeURIComponent(id))
      .then((row) => {
        if (current !== id) return;
        rec = row;
        show(row);
      })
      .catch(showErr);
  }

  // ---- the jump on screen ----
  // The words on the screen for one jump: they are drawn again when the language changes, so nothing typed or playing is touched.
  function renderTexts(row) {
    const r = row.record;
    const p = r.prediction;
    const idx = list.findIndex((j) => j.id === row.id);
    $('progress').textContent = t('rv.progress', { n: idx + 1, total: list.length });
    // The name is the element's, in the language of the page; the label the sender wrote is only the fallback.
    $('autoname').textContent = row.auto_element_id
      ? nameOf(row.auto_element_id)
      : p.skill === 'unclassified'
        ? t('skill.unclassified')
        : p.label;
    const tag = $('autotag');
    const cert = p.skill === 'unclassified' ? 'unclassified' : p.certainty || 'confident';
    tag.textContent = cert === 'unclassified' ? t('skill.unclassified') : t('certainty.' + cert);
    tag.className = 'tag ' + cert;
    $('autoconf').textContent = pct(p.confidence);
    $('autoclf').textContent = row.classifier;
    $('ident').textContent = t('rv.jumpVideo', { n: row.jump_id, video: shortVideo(row.video_id) });
    $('autoname').title = p.summary || '';

    const vn = $('verdictnow');
    if (row.status !== 'auto') {
      vn.hidden = false;
      vn.className = row.status;
      vn.textContent =
        verdictText(row.status) +
        (row.status === 'corrected' ? ' ' + nameOf(row.review_element_id) : '') +
        (row.reviewer ? t('rv.by', { who: row.reviewer }) : '');
    } else vn.hidden = true;

    const conf = $('confirm');
    conf.disabled = !row.auto_element_id;
    conf.textContent = row.auto_element_id ? t('rv.confirm', { name: nameOf(row.auto_element_id) }) : t('rv.noAuto');

    const m = p.measured;
    const facts = $('measured');
    facts.textContent = '';
    if (m) {
      [
        [t('picker.somersaults'), m.somersaults == null ? '–' : formatNumber(m.somersaults, 2)],
        [t('picker.direction'), m.direction ? lower(t('dir.' + m.direction)) : '–'],
        [t('picker.twists'), m.twists == null ? t('rv.notMeasured') : formatNumber(m.twists, 2)],
        [t('picker.position'), m.position ? lower(t('pos.' + m.position)) : '–'],
      ].forEach(([k, v]) => {
        const d = document.createElement('div');
        d.className = 'fact';
        const l = document.createElement('span');
        l.className = 'muted';
        l.textContent = k;
        const b = document.createElement('b');
        b.textContent = v;
        d.append(l, b);
        facts.appendChild(d);
      });
    }

    renderCandidates(p, row);
    $('debug').textContent = JSON.stringify(
      { failure: p.failure, evidence: p.evidence, outOfTable: p.outOfTable, dataQuality: p.dataQuality },
      null,
      1,
    );
  }

  function show(row) {
    $('detail').hidden = false;
    renderTexts(row);
    $('note').value = row.review_note || '';
    setPick(row.review_element_id || row.auto_element_id || 'back-1s-0t-tuck');
    u = 0;
    $('scrub').value = 0;
    stop();
    draw();
    // Show the jump moving right away, unless the person asked their system for less motion.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) play();
  }

  // The classifier's own alternatives: one click and one key (1 to 5) each.
  function renderCandidates(p, row) {
    const box = $('cands');
    box.textContent = '';
    cands = [];
    const seen = new Set();
    (p.candidates || []).forEach((cd) => {
      const id = cd.elementId || cd.id;
      if (!id || seen.has(id) || cands.length >= 5) return;
      seen.add(id);
      cands.push(id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'act';
      const k = document.createElement('kbd');
      k.textContent = String(cands.length);
      const n = document.createElement('span');
      n.textContent = byId.get(id) ? nameOf(id) : cd.name || nameOf(id);
      const s = document.createElement('span');
      s.className = 'muted';
      const score = cd.score != null ? cd.score : cd.posterior;
      s.textContent =
        (score != null ? pct(score) : '') +
        (cd.similarity != null ? t('rv.trajectory', { sim: pct(cd.similarity) }) : '');
      b.append(k, n, s);
      b.title = t('rv.itWas', { name: n.textContent });
      b.onclick = () => verdict({ verdict: 'correct', elementId: id });
      box.appendChild(b);
    });
    if (!cands.length) {
      const e = document.createElement('p');
      e.className = 'muted';
      e.style.margin = '0';
      e.textContent = row.auto_element_id ? '' : t('rv.noAlternatives');
      box.appendChild(e);
    }
  }

  // ---- the figure picker: four rows of chips that always land on a real figure of the table ----
  function buildChips() {
    const fill = (field, items) => {
      const box = document.querySelector('.chips[data-field="' + field + '"]');
      box.textContent = '';
      items.forEach(([value, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'act';
        b.textContent = label;
        b.dataset.value = String(value);
        b.onclick = () => chooseChip(field, value);
        box.appendChild(b);
      });
    };
    fill('s', [
      [0, t('rv.somNone')],
      [1, t('rv.somSingle')],
      [2, t('rv.somDouble')],
      [3, t('rv.somTriple')],
    ]);
    fill('d', [
      ['front', t('dir.front')],
      ['back', t('dir.back')],
    ]);
    fill(
      't',
      Object.keys(TWIST_LABELS).map((key) => [Number(key), TWIST_LABELS[key]]),
    );
    fill(
      'p',
      POSITIONS.map((x) => [x, t('pos.' + x)]),
    );
    $('savepick').onclick = () => pick && verdict({ verdict: 'correct', elementId: pick.id });
  }

  const FIELD_KEY = { s: 'somersaults', d: 'direction', t: 'twists', p: 'position' };
  function chooseChip(field, value) {
    const cur = pick;
    const want = { s: cur.somersaults, d: cur.direction, t: cur.twists, p: cur.position };
    want[field] = value;
    if (want.s === 0) want.d = null;
    else if (want.d == null) want.d = 'front';
    // The closest figure that has the value just clicked; the other rows follow if the table has no such combination.
    let best = null;
    let bestMiss = 99;
    FIG_ELEMENTS.forEach((e) => {
      if (e[FIELD_KEY[field]] !== value) return;
      const miss = Object.keys(FIELD_KEY).filter((k) => k !== field && e[FIELD_KEY[k]] !== want[k]).length;
      if (miss < bestMiss) {
        best = e;
        bestMiss = miss;
      }
    });
    if (best) setPick(best.id);
  }

  function setPick(id) {
    pick = byId.get(id) || FIG_ELEMENTS[0];
    const state = { s: pick.somersaults, d: pick.direction, t: pick.twists, p: pick.position };
    document.querySelectorAll('.chips button').forEach((b) => {
      const field = b.parentElement.dataset.field;
      b.setAttribute('aria-pressed', String(String(state[field]) === b.dataset.value));
    });
    const noSomersault = pick.somersaults === 0;
    $('dirlab').hidden = noSomersault;
    document.querySelector('.chips[data-field="d"]').hidden = noSomersault;
    $('savepick').textContent = t('rv.itWas', { name: elementName(pick) });
  }

  // ---- replay: the stored sequence, the body in its own frame ----
  const BONES = [
    ['left_shoulder', 'right_shoulder'],
    ['left_hip', 'right_hip'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['left_ankle', 'left_heel'],
    ['left_ankle', 'left_foot_index'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
    ['right_ankle', 'right_heel'],
    ['right_ankle', 'right_foot_index'],
  ];
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const col = (seq, name) => seq.columns.indexOf(name);
  function rowAt(seq) {
    const i = Math.round(u * (seq.data.length - 1));
    return seq.data[Math.max(0, Math.min(seq.data.length - 1, i))];
  }

  // The skeleton is stored in the body's own frame (hips at the origin, the trunk pointing up), so on its own it never turns. The somersault
  // turns it about the hips as it did in the video, and the twist is shown on a dial: both can be read at a glance, and the figure can be
  // moved and zoomed.
  const view = { x: 0, y: 0, k: 1 };
  const ORIGIN_Y = 0.54;
  const viewMoved = () => view.x !== 0 || view.y !== 0 || view.k !== 1;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function syncReset() {
    $('resetview').hidden = !viewMoved();
  }
  function resetView() {
    view.x = 0;
    view.y = 0;
    view.k = 1;
    syncReset();
    draw();
  }

  // A canvas that follows the size of its box, sharp on dense screens. Returns what to draw with, in CSS pixels.
  function fit(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }

  // Twist since takeoff, in turns, at the position u of the jump; null when the jump has no twist curve.
  function twistTurns(u) {
    const tw = rec && rec.record.twist && rec.record.twist.sequence;
    if (!tw || !tw.data || !tw.data.length) return null;
    const i = col(tw, 'twist_deg');
    if (i < 0) return null;
    const f = clamp(u, 0, 1) * (tw.data.length - 1);
    const a = Math.floor(f);
    const b = Math.min(tw.data.length - 1, a + 1);
    const va = tw.data[a][i];
    const vb = tw.data[b][i];
    if (va == null || !isFinite(va)) return null;
    return (vb == null || !isFinite(vb) ? va : va + (vb - va) * (f - a)) / 360;
  }

  // One dial: a turn counter. `turns` is clockwise from the top; the swept part is filled.
  function dial(g, cx, cy, r, turns, color) {
    g.lineWidth = 1.5;
    g.strokeStyle = css('--line');
    g.beginPath();
    g.arc(cx, cy, r, 0, 2 * Math.PI);
    g.stroke();
    const a = (turns == null ? 0 : turns) * 2 * Math.PI;
    if (turns != null) {
      g.fillStyle = css('--accent-soft');
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + clamp(a, -2 * Math.PI, 2 * Math.PI), a < 0);
      g.closePath();
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
      g.stroke();
    }
    g.strokeStyle = css('--muted');
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx, cy - r);
    g.lineTo(cx, cy - r - 4);
    g.stroke();
  }

  function drawSkeleton() {
    if (!rec) return;
    const seq = rec.record.sequence;
    const { g, w, h } = fit($('skel'));
    if (!w || !h) return;
    if (!seq) {
      g.fillStyle = css('--muted');
      g.font = '14px system-ui';
      g.fillText(t('rv.noSequence'), 12, 24);
      return;
    }
    const row = rowAt(seq);
    const turnsRaw = row[col(seq, 'orient_turns')];
    const salto = turnsRaw == null || !isFinite(turnsRaw) ? 0 : turnsRaw;
    const twist = twistTurns(u);
    const th = salto * 2 * Math.PI;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const S = (Math.min(w, h) / 2.4) * view.k;
    const ox = w / 2 + view.x;
    const oy = h * ORIGIN_Y + view.y;
    const pt = (name) => {
      const x = row[col(seq, name + '_x')];
      const y = row[col(seq, name + '_y')];
      if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
      return [ox + S * (x * cs + y * sn), oy + S * (x * sn - y * cs)];
    };

    // The somersault: a ring around the hips with the turn since takeoff swept on it, and the upright reference.
    const R = S * 1.08;
    g.lineWidth = 1;
    g.strokeStyle = css('--line');
    g.setLineDash([3, 6]);
    g.beginPath();
    g.arc(ox, oy, R, 0, 2 * Math.PI);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(ox, oy - R - 6);
    g.lineTo(ox, oy - R + 6);
    g.stroke();
    if (Math.abs(th) > 0.01) {
      g.strokeStyle = css('--warn');
      g.lineWidth = 3;
      g.beginPath();
      g.arc(ox, oy, R, -Math.PI / 2, -Math.PI / 2 + clamp(th, -2 * Math.PI, 2 * Math.PI), th < 0);
      g.stroke();
    }
    g.fillStyle = css('--warn');
    g.beginPath();
    g.arc(ox + R * Math.sin(th), oy - R * Math.cos(th), 4, 0, 2 * Math.PI);
    g.fill();

    g.lineWidth = Math.max(2.5, S * 0.035);
    g.lineCap = 'round';
    BONES.forEach((b) => {
      const a = pt(b[0]);
      const c = pt(b[1]);
      if (!a || !c) return;
      g.strokeStyle = b[0].indexOf('left') === 0 ? css('--accent') : css('--ink');
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(c[0], c[1]);
      g.stroke();
    });
    const nose = pt('nose');
    if (nose) {
      g.fillStyle = css('--ink');
      g.beginPath();
      g.arc(nose[0], nose[1], Math.max(5, S * 0.06), 0, 2 * Math.PI);
      g.fill();
    }

    // The counters, in the corner of the view: they stay where they are when the figure is moved.
    const m = (rec.record.prediction && rec.record.prediction.measured) || {};
    const r = h < 320 ? 17 : 22;
    [
      [t('rv.salto'), salto, m.somersaults, css('--warn')],
      [t('rv.twist'), twist, m.twists, css('--accent')],
    ].forEach(([label, turns, total, color], n) => {
      const cy = 12 + r + n * (2 * r + 8);
      dial(g, 12 + r, cy, r, turns, color);
      g.textAlign = 'left';
      g.fillStyle = css('--muted');
      g.font = '11px system-ui';
      g.fillText(label, 12 + 2 * r + 8, cy - 2);
      g.fillStyle = css('--ink');
      g.font = '600 14px system-ui';
      g.fillText(
        (turns == null ? '–' : formatNumber(turns, 2)) + (total == null ? '' : ' / ' + formatNumber(total, 2)),
        12 + 2 * r + 8,
        cy + 14,
      );
    });

    g.fillStyle = css('--muted');
    g.font = '13px system-ui';
    g.textAlign = 'left';
    g.fillText(
      t('rv.hipsKnees', {
        hip: Math.round(row[col(seq, 'hip_angle_deg')]),
        knee: Math.round(row[col(seq, 'knee_angle_deg')]),
      }),
      10,
      h - 10,
    );
  }

  function draw() {
    drawSkeleton();
    drawCurves();
  }

  // The measured curves, side by side and small; the line is the position in the jump.
  const CURVE_PAD = 6;
  function curveDefs() {
    return [
      ['orient_turns', t('rv.curve.turns')],
      ['hip_angle_deg', t('rv.curve.hip')],
      ['knee_angle_deg', t('rv.curve.knee')],
      ['com_h_m', t('rv.curve.height')],
    ];
  }
  const curveCols = (w) => (w >= 520 ? 4 : 2);
  function drawCurves() {
    const cv = $('curves');
    if (!rec || !rec.record.sequence) return;
    const seq = rec.record.sequence;
    const { g, w, h } = fit(cv);
    if (!w || !h) return;
    const defs = curveDefs();
    const cols = curveCols(w);
    const rows = Math.ceil(defs.length / cols);
    const cw = w / cols;
    const ch = h / rows;
    g.font = '11px system-ui';
    g.textAlign = 'left';
    defs.forEach((d, k) => {
      const x0 = (k % cols) * cw;
      const y0 = Math.floor(k / cols) * ch;
      if (k % cols) {
        g.strokeStyle = css('--line');
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x0, y0 + 2);
        g.lineTo(x0, y0 + ch - 2);
        g.stroke();
      }
      const i = col(seq, d[0]);
      if (i < 0) return;
      const vals = seq.data.map((r) => r[i]).filter((v) => v != null && isFinite(v));
      if (!vals.length) return;
      const lo = Math.min.apply(null, vals);
      let hi = Math.max.apply(null, vals);
      if (hi - lo < 1e-6) hi = lo + 1;
      const left = x0 + CURVE_PAD + 2;
      const width = cw - 2 * CURVE_PAD - 4;
      const top = y0 + 17;
      const bot = y0 + ch - 4;
      g.fillStyle = css('--muted');
      const range = d[1] + '  ' + formatNumber(lo, 1) + ' … ' + formatNumber(hi, 1);
      g.fillText(g.measureText(range).width <= width ? range : d[1], left, y0 + 12, width);
      g.strokeStyle = css('--accent');
      g.lineWidth = 1.75;
      g.beginPath();
      let started = false;
      seq.data.forEach((r, n) => {
        const v = r[i];
        if (v == null || !isFinite(v)) {
          started = false;
          return;
        }
        const x = left + (n / (seq.data.length - 1)) * width;
        const y = bot - ((v - lo) / (hi - lo)) * (bot - top);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      });
      g.stroke();
      const cx = left + u * width;
      g.strokeStyle = css('--ink');
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx, y0 + 14);
      g.lineTo(cx, y0 + ch - 2);
      g.stroke();
    });
  }
  // Pointing at a curve moves the jump to that moment.
  function scrubFromCurves(e) {
    const cv = $('curves');
    const rect = cv.getBoundingClientRect();
    const cw = rect.width / curveCols(rect.width);
    const x = (e.clientX - rect.left) % cw;
    stop();
    u = clamp((x - CURVE_PAD - 2) / (cw - 2 * CURVE_PAD - 4), 0, 1);
    $('scrub').value = u;
    draw();
  }

  function stop() {
    if (timer) {
      cancelAnimationFrame(timer);
      timer = 0;
    }
    $('play').textContent = t('rv.play');
  }
  function play() {
    if (timer) return stop();
    $('play').textContent = t('rv.pause');
    let last = performance.now();
    const seq = rec && rec.record.sequence;
    const dur = seq && seq.durationS ? seq.durationS : 1;
    (function tick(now) {
      u = Math.max(0, u + Math.max(0, now - last) / 1000 / (dur * 2)); // half speed; the first frame can be stamped before `last`
      last = now;
      if (u >= 1) u = 0;
      $('scrub').value = u;
      draw();
      timer = requestAnimationFrame(tick);
    })(last);
  }

  // ---- verdicts ----
  const STATUS_OF = { confirm: 'confirmed', correct: 'corrected', unknown: 'unknown', 'bad-data': 'bad-data' };
  let saving = false;
  function verdict(body) {
    if (!current || saving) return;
    saving = true;
    const id = current;
    const who = $('who').value.trim();
    try {
      localStorage.setItem('trampovision.reviewer', who);
    } catch {
      /* the name is not remembered */
    }
    body.note = $('note').value;
    body.reviewer = who;
    api('/jumps/' + encodeURIComponent(id) + '/review', { method: 'PUT', body: JSON.stringify(body) })
      .then(() => {
        saving = false;
        const status = STATUS_OF[body.verdict];
        const figure =
          body.verdict === 'confirm' ? rec.auto_element_id : body.verdict === 'correct' ? body.elementId : null;
        toast(
          body.verdict === 'confirm'
            ? t('rv.toastConfirmed', { name: nameOf(figure) })
            : body.verdict === 'correct'
              ? t('rv.toastSaved', { name: nameOf(figure) })
              : verdictText(status),
        );
        afterVerdict(id, status, figure);
      })
      .catch((e) => {
        saving = false;
        showErr(e);
      });
  }

  // Move to the next jump. A jump that no longer belongs to the tab leaves the list.
  function afterVerdict(id, status, figure) {
    // A button that kept the focus would swallow the next Enter or Space: the shortcuts must keep working.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const i = list.findIndex((j) => j.id === id);
    const row = list[i];
    if (row) {
      row.status = status;
      row.review_element_id = figure;
    }
    const stays = status === mode;
    if (i >= 0 && !stays) list.splice(i, 1);
    const target = list[stays ? i + 1 : i] || list[Math.max(0, i - 1)];
    loadStats();
    if (target) select(target.id);
    else {
      current = null;
      rec = null;
      stop();
      $('detail').hidden = true;
      renderList();
    }
  }

  function step(delta) {
    const i = list.findIndex((j) => j.id === current);
    const n = list[i + delta];
    if (n) select(n.id);
  }

  // ---- wiring ----
  $('play').onclick = play;
  $('scrub').oninput = (e) => {
    stop();
    u = Number(e.target.value);
    draw();
  };
  $('resetview').onclick = resetView;
  const skel = $('skel');
  const pointers = new Map();
  let pinch = null;
  const local = (e) => {
    const r = skel.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomAt = (p, ratio) => {
    const w = skel.clientWidth;
    const h = skel.clientHeight;
    const k = clamp(view.k * ratio, 0.4, 6);
    const r = k / view.k;
    const o = { x: w / 2 + view.x, y: h * ORIGIN_Y + view.y };
    view.x = p.x - (p.x - o.x) * r - w / 2;
    view.y = p.y - (p.y - o.y) * r - h * ORIGIN_Y;
    view.k = k;
  };
  skel.addEventListener('pointerdown', (e) => {
    skel.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    skel.classList.add('grabbing');
    pinch = null;
  });
  skel.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      view.x += p.x - prev.x;
      view.y += p.y - prev.y;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch && pinch.d > 0) {
        zoomAt(mid, d / pinch.d);
        view.x += mid.x - pinch.mid.x;
        view.y += mid.y - pinch.mid.y;
      }
      pinch = { d, mid };
    }
    syncReset();
    drawSkeleton();
    $('viewhint').hidden = true;
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
    if (!pointers.size) skel.classList.remove('grabbing');
  };
  skel.addEventListener('pointerup', release);
  skel.addEventListener('pointercancel', release);
  skel.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(local(e), Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)));
      $('viewhint').hidden = true;
      syncReset();
      drawSkeleton();
    },
    { passive: false },
  );
  skel.addEventListener('dblclick', resetView);
  const curves = $('curves');
  curves.addEventListener('pointerdown', (e) => {
    curves.setPointerCapture(e.pointerId);
    scrubFromCurves(e);
  });
  curves.addEventListener('pointermove', (e) => {
    if (curves.hasPointerCapture(e.pointerId)) scrubFromCurves(e);
  });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (rec) draw();
    });
    ro.observe($('viewport'));
    ro.observe(curves);
  }
  $('listopen').onclick = () => document.body.classList.add('listopen');
  $('listclose').onclick = () => document.body.classList.remove('listopen');
  $('fixopen').onclick = () => document.body.classList.add('fixopen');
  $('fixclose').onclick = () => document.body.classList.remove('fixopen');
  $('confirm').onclick = () => verdict({ verdict: 'confirm' });
  $('unknown').onclick = () => verdict({ verdict: 'unknown' });
  $('baddata').onclick = () => verdict({ verdict: 'bad-data' });
  $('skip').onclick = () => step(1);
  $('prev').onclick = () => step(-1);
  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || $('detail').hidden) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Enter on a focused button presses that button; only a bare Enter confirms.
    if (e.key === 'Enter' && tag !== 'BUTTON') {
      if (!$('confirm').disabled) verdict({ verdict: 'confirm' });
    } else if (k === 'arrowright' || k === 'n') step(1);
    else if (k === 'arrowleft' || k === 'p') step(-1);
    else if (k === 'r') resetView();
    else if (k === 'escape') document.body.classList.remove('listopen', 'fixopen');
    else if (k === 'u') verdict({ verdict: 'unknown' });
    else if (k === 'b') verdict({ verdict: 'bad-data' });
    else if (k >= '1' && k <= '5' && cands[Number(k) - 1])
      verdict({ verdict: 'correct', elementId: cands[Number(k) - 1] });
    else if (e.key === ' ' && tag !== 'BUTTON') {
      e.preventDefault();
      play();
    }
  });

  if (API && token)
    api('/stats')
      .then(start)
      .catch(() => {});
  else signOut('rv.noService');

  // ---- the language ----
  // Static words carry data-i18n (text) and data-i18n-attr (attribute:key pairs); the rest is drawn by the code above.
  function translateStatic() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr, t(key));
      });
    });
    document.title = t('rv.title');
    if (loginKey) $('loginerr').textContent = t(loginKey);
    if (!timer) $('play').textContent = t('rv.play');
    else $('play').textContent = t('rv.pause');
  }
  const langSelect = $('lang');
  LOCALES.forEach((l) => {
    const o = document.createElement('option');
    o.value = l;
    o.textContent = LANGUAGE_NAMES[l];
    langSelect.appendChild(o);
  });
  langSelect.value = getLocale();
  langSelect.onchange = () => setLocale(langSelect.value);
  translateStatic();
  subscribeLocale(() => {
    langSelect.value = getLocale();
    translateStatic();
    if ($('app').hidden) return;
    renderTabs();
    $('listtitle').textContent = tabLabel(mode);
    buildChips();
    renderList();
    if (rec) {
      renderTexts(rec);
      setPick(pick ? pick.id : rec.review_element_id || rec.auto_element_id || 'back-1s-0t-tuck');
      draw();
    }
  });
})();
