import { FIG_ELEMENTS } from '../skills/fig/elements';

(function () {
  const $ = (id) => document.getElementById(id);
  // Everyone who uses the app may review, so the page uses the app's own service URL and token: nothing to type.
  const API = (import.meta.env.VITE_REVIEW_API_URL || '').replace(/\/+$/, '');
  const token = import.meta.env.VITE_REVIEW_INGEST_TOKEN || '';

  const TABS = [
    { status: 'auto', label: 'To review' },
    { status: 'confirmed', label: 'Confirmed' },
    { status: 'corrected', label: 'Corrected' },
    { status: 'unknown', label: 'Unknown' },
    { status: 'bad-data', label: 'Bad data' },
  ];
  const VERDICT_TEXT = {
    confirmed: 'Confirmed',
    corrected: 'Corrected to',
    unknown: 'Marked: cannot tell',
    'bad-data': 'Marked: bad data',
  };
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
  const nameOf = (id) => (byId.get(id) ? byId.get(id).name : id || 'Unclassified');
  const pct = (v) => Math.round(v * 100) + '%';
  const shortVideo = (id) => String(id).slice(0, 8);

  function api(path, init) {
    init = init || {};
    init.headers = Object.assign(
      { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      init.headers || {},
    );
    return fetch(API + path, init).then((r) => {
      if (r.status === 401) {
        signOut("The review service does not accept this build's token.");
        throw new Error('unauthorized');
      }
      return r.json().then((b) => {
        if (!r.ok) throw new Error(b.error || r.status);
        return b;
      });
    });
  }
  // The page cannot work: say why instead of showing an empty queue.
  function signOut(msg) {
    $('app').hidden = true;
    document.body.classList.add('out');
    $('login').hidden = false;
    $('loginerr').textContent = msg || '';
  }
  function showErr(e) {
    $('err').textContent = e && e.message ? e.message : String(e);
  }
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
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
      if (TABS.some((t) => t.status === saved)) mode = saved;
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
    TABS.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.status === mode));
      b.appendChild(document.createTextNode(t.label));
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = counts[t.status] == null ? '' : String(counts[t.status]);
      b.appendChild(n);
      b.onclick = () => {
        mode = t.status;
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
        TABS.forEach((t) => (counts[t.status] = 0));
        b.stats.forEach((s) => (counts[s.status] = s.n));
        renderTabs();
        renderList();
      })
      .catch(() => {});
  }

  function load() {
    const seq = ++loadSeq;
    const path = mode === 'auto' ? '/jumps?queue=1&limit=100' : '/jumps?status=' + mode + '&limit=100';
    $('listtitle').textContent = TABS.find((t) => t.status === mode).label;
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
    $('empty').textContent = mode === 'auto' ? 'Nothing to review. All done!' : 'Nothing here.';
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
      m.textContent = 'Jump ' + j.jump_id + ' · video ' + shortVideo(j.video_id) + ' · ' + pct(j.auto_confidence);
      b.append(dot, a, m);
      b.onclick = () => select(j.id);
      li.appendChild(b);
      ul.appendChild(li);
      if (current === j.id) requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest' }));
    });
  }

  function select(id) {
    current = id;
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
  function show(row) {
    const r = row.record;
    const p = r.prediction;
    $('detail').hidden = false;
    const idx = list.findIndex((j) => j.id === row.id);
    $('progress').textContent = 'Automatic answer · ' + (idx + 1) + ' of ' + list.length;
    $('autoname').textContent = p.skill === 'unclassified' ? 'Unclassified' : p.label;
    const tag = $('autotag');
    const cert = p.skill === 'unclassified' ? 'unclassified' : p.certainty || 'confident';
    tag.textContent = cert;
    tag.className = 'tag ' + cert;
    $('autoconf').textContent = pct(p.confidence);
    $('autoclf').textContent = row.classifier;
    $('ident').textContent = 'Jump ' + row.jump_id + ' · video ' + shortVideo(row.video_id);
    $('summary').textContent = p.summary || '';

    const vn = $('verdictnow');
    if (row.status !== 'auto') {
      vn.hidden = false;
      vn.className = row.status;
      vn.textContent =
        (VERDICT_TEXT[row.status] || row.status) +
        (row.status === 'corrected' ? ' ' + nameOf(row.review_element_id) : '') +
        (row.reviewer ? ' · by ' + row.reviewer : '');
    } else vn.hidden = true;

    const conf = $('confirm');
    conf.disabled = !row.auto_element_id;
    conf.textContent = row.auto_element_id
      ? '✓ Confirm: ' + nameOf(row.auto_element_id) + '  (Enter)'
      : 'No automatic figure: pick one';
    $('note').value = row.review_note || '';

    const m = p.measured;
    const facts = $('measured');
    facts.textContent = '';
    if (m) {
      [
        ['Somersaults', m.somersaults == null ? '–' : m.somersaults.toFixed(2)],
        ['Direction', m.direction || '–'],
        ['Twists', m.twists == null ? 'not measured' : m.twists.toFixed(2)],
        ['Position', m.position || '–'],
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
    setPick(row.review_element_id || row.auto_element_id || 'back-1s-0t-tuck');
    $('debug').textContent = JSON.stringify(
      { failure: p.failure, evidence: p.evidence, outOfTable: p.outOfTable, dataQuality: p.dataQuality },
      null,
      1,
    );
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
      n.textContent = cd.name || nameOf(id);
      const s = document.createElement('span');
      s.className = 'muted';
      const score = cd.score != null ? cd.score : cd.posterior;
      s.textContent =
        (score != null ? pct(score) : '') + (cd.similarity != null ? ' · trajectory ' + pct(cd.similarity) : '');
      b.append(k, n, s);
      b.title = 'It was: ' + n.textContent;
      b.onclick = () => verdict({ verdict: 'correct', elementId: id });
      box.appendChild(b);
    });
    if (!cands.length) {
      const e = document.createElement('p');
      e.className = 'muted';
      e.style.margin = '0';
      e.textContent = row.auto_element_id ? '' : 'The classifier gave no alternatives. Use the pickers below.';
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
      [0, 'None'],
      [1, 'Single'],
      [2, 'Double'],
      [3, 'Triple'],
    ]);
    fill('d', [
      ['front', 'Front'],
      ['back', 'Back'],
    ]);
    fill(
      't',
      Object.keys(TWIST_LABELS).map((t) => [Number(t), TWIST_LABELS[t]]),
    );
    fill(
      'p',
      POSITIONS.map((x) => [x, x.charAt(0).toUpperCase() + x.slice(1)]),
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
    $('savepick').textContent = 'It was: ' + pick.name;
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

  function draw() {
    if (!rec) return;
    const seq = rec.record.sequence;
    const cv = $('skel');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (!seq) {
      g.fillStyle = css('--muted');
      g.fillText('No pose sequence for this jump.', 12, 24);
      return;
    }
    const row = rowAt(seq);
    const S = 90;
    const ox = 140;
    const oy = 120;
    const pt = (name) => {
      const x = row[col(seq, name + '_x')];
      const y = row[col(seq, name + '_y')];
      return x == null || y == null ? null : [ox + x * S, oy - y * S];
    };
    g.lineWidth = 3;
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
      g.arc(nose[0], nose[1], 7, 0, 6.3);
      g.fill();
    }
    g.fillStyle = css('--muted');
    g.font = '15px system-ui';
    g.fillText(
      'hips ' +
        Math.round(row[col(seq, 'hip_angle_deg')]) +
        '°   knees ' +
        Math.round(row[col(seq, 'knee_angle_deg')]) +
        '°',
      8,
      312,
    );
    drawCurves(seq);
  }

  function drawCurves(seq) {
    const cv = $('curves');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const defs = [
      ['orient_turns', 'Rotation (turns)'],
      ['hip_angle_deg', 'Hip angle'],
      ['knee_angle_deg', 'Knee angle'],
      ['com_h_m', 'Height (m)'],
    ];
    const h = cv.height / defs.length;
    defs.forEach((d, k) => {
      const i = col(seq, d[0]);
      if (i < 0) return;
      const vals = seq.data.map((r) => r[i]).filter((v) => v != null && isFinite(v));
      if (!vals.length) return;
      const lo = Math.min.apply(null, vals);
      let hi = Math.max.apply(null, vals);
      if (hi - lo < 1e-6) hi = lo + 1;
      const top = k * h + 16;
      const bot = (k + 1) * h - 6;
      g.fillStyle = css('--muted');
      g.font = '15px system-ui';
      g.fillText(d[1] + '  ' + lo.toFixed(1) + ' … ' + hi.toFixed(1), 6, k * h + 12);
      g.strokeStyle = css('--accent');
      g.lineWidth = 2;
      g.beginPath();
      let started = false;
      seq.data.forEach((r, n) => {
        const v = r[i];
        if (v == null || !isFinite(v)) {
          started = false;
          return;
        }
        const x = 6 + (n / (seq.data.length - 1)) * (cv.width - 12);
        const y = bot - ((v - lo) / (hi - lo)) * (bot - top);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      });
      g.stroke();
    });
    const cx = 6 + u * (cv.width - 12);
    g.strokeStyle = css('--ink');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx, 0);
    g.lineTo(cx, cv.height);
    g.stroke();
  }

  function stop() {
    if (timer) {
      cancelAnimationFrame(timer);
      timer = 0;
    }
    $('play').textContent = 'Play';
  }
  function play() {
    if (timer) return stop();
    $('play').textContent = 'Pause';
    let last = performance.now();
    const seq = rec && rec.record.sequence;
    const dur = seq && seq.durationS ? seq.durationS : 1;
    (function tick(now) {
      u += (now - last) / 1000 / (dur * 2); // half speed
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
            ? 'Confirmed: ' + nameOf(figure)
            : body.verdict === 'correct'
              ? 'Saved: ' + nameOf(figure)
              : VERDICT_TEXT[status],
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
  else signOut('This build has no review service configured (VITE_REVIEW_API_URL and VITE_REVIEW_INGEST_TOKEN).');
})();
