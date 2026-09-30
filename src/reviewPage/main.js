(function () {
  var $ = function (id) {
    return document.getElementById(id);
  };
  // Everyone who uses the app may review, so the page uses the app's own service URL and token: nothing to type.
  var API = (import.meta.env.VITE_REVIEW_API_URL || '').replace(/\/+$/, '');
  var token = import.meta.env.VITE_REVIEW_INGEST_TOKEN || '';
  var elements = [];
  var list = [];
  var current = null;
  var rec = null;
  var u = 0;
  var timer = 0;

  function api(path, init) {
    init = init || {};
    init.headers = Object.assign(
      { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      init.headers || {},
    );
    return fetch(API + path, init).then(function (r) {
      if (r.status === 401) {
        signOut("The review service does not accept this build's token.");
        throw new Error('unauthorized');
      }
      return r.json().then(function (b) {
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
  function pct(v) {
    return Math.round(v * 100) + '%';
  }
  function nameOf(id) {
    for (var i = 0; i < elements.length; i++) if (elements[i].id === id) return elements[i].name;
    return id || 'Unclassified';
  }

  function start() {
    $('login').hidden = true;
    document.body.classList.remove('out');
    $('app').hidden = false;
    try {
      $('who').value = localStorage.getItem('trampovision.reviewer') || '';
    } catch {}
    fetch(API + '/elements')
      .then(function (r) {
        return r.json();
      })
      .then(function (b) {
        elements = b.elements;
        var sel = $('figure');
        sel.textContent = '';
        elements.forEach(function (e) {
          var o = document.createElement('option');
          o.value = e.id;
          o.textContent = e.name;
          sel.appendChild(o);
        });
        load();
      });
  }

  function load() {
    var mode = $('mode').value;
    var path = mode === 'queue' ? '/jumps?queue=1&limit=100' : '/jumps?status=' + mode + '&limit=100';
    $('listtitle').textContent = $('mode').selectedOptions[0].textContent;
    api(path)
      .then(function (b) {
        list = b.jumps;
        renderList();
        if (list.length) select(list[0].id);
        else {
          current = null;
          $('detail').hidden = true;
        }
      })
      .catch(showErr);
    api('/stats')
      .then(function (b) {
        var t = b.stats
          .map(function (s) {
            return s.n + ' ' + s.status;
          })
          .join(' · ');
        $('counts').textContent = t;
      })
      .catch(function () {});
  }

  function renderList() {
    var ul = $('queue');
    ul.textContent = '';
    $('empty').hidden = list.length > 0;
    list.forEach(function (j) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(current === j.id));
      b.dataset.id = j.id;
      var a = document.createElement('div');
      a.textContent = j.review_element_id
        ? nameOf(j.review_element_id) + ' (' + j.status + ')'
        : nameOf(j.auto_element_id);
      var m = document.createElement('div');
      m.className = 'muted';
      m.textContent = 'Jump ' + j.jump_id + ' · ' + j.auto_skill + ' · ' + pct(j.auto_confidence);
      b.appendChild(a);
      b.appendChild(m);
      b.onclick = function () {
        select(j.id);
      };
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function select(id) {
    current = id;
    renderList();
    $('err').textContent = '';
    api('/jumps/' + encodeURIComponent(id))
      .then(function (row) {
        rec = row;
        show(row);
      })
      .catch(showErr);
  }

  function show(row) {
    var r = row.record,
      p = r.prediction;
    $('detail').hidden = false;
    $('autoname').textContent = p.skill === 'unclassified' ? 'Unclassified' : p.label;
    var tag = $('autotag');
    var cert = p.skill === 'unclassified' ? 'unclassified' : p.certainty || 'confident';
    tag.textContent = cert;
    tag.className = 'tag ' + cert;
    $('autoconf').textContent = pct(p.confidence);
    $('autoclf').textContent = row.classifier;
    $('ident').textContent =
      'Jump ' + row.jump_id + ' · video ' + String(row.video_id).slice(0, 8) + ' · ' + row.status;
    $('summary').textContent = p.summary || '';
    $('confirm').disabled = !row.auto_element_id;
    $('note').value = row.review_note || '';
    if (row.review_element_id) $('figure').value = row.review_element_id;
    else if (row.auto_element_id) $('figure').value = row.auto_element_id;

    var m = p.measured,
      t = $('measured');
    t.textContent = '';
    if (m) {
      [
        ['Somersaults', m.somersaults == null ? '–' : m.somersaults.toFixed(2)],
        ['Direction', m.direction || 'not measured'],
        ['Twists', m.twists == null ? 'not measured' : m.twists.toFixed(2)],
        ['Position', m.position || '–'],
      ].forEach(function (kv) {
        var tr = document.createElement('tr'),
          a = document.createElement('th'),
          b = document.createElement('td');
        a.textContent = kv[0];
        b.textContent = kv[1];
        tr.appendChild(a);
        tr.appendChild(b);
        t.appendChild(tr);
      });
    }
    var c = $('cands');
    c.textContent = '';
    (p.candidates || []).forEach(function (cd) {
      var tr = document.createElement('tr');
      var n = document.createElement('td');
      n.textContent = cd.name;
      var s = document.createElement('td');
      s.textContent = pct(cd.score != null ? cd.score : cd.posterior);
      s.className = 'muted';
      var sim = document.createElement('td');
      sim.className = 'muted';
      sim.textContent = cd.similarity != null ? 'trajectory ' + pct(cd.similarity) : '';
      var b = document.createElement('td'),
        btn = document.createElement('button');
      btn.className = 'act';
      btn.type = 'button';
      btn.textContent = 'It was this';
      btn.onclick = function () {
        verdict({ verdict: 'correct', elementId: cd.elementId || cd.id });
      };
      b.appendChild(btn);
      tr.appendChild(n);
      tr.appendChild(s);
      tr.appendChild(sim);
      tr.appendChild(b);
      c.appendChild(tr);
    });
    $('debug').textContent = JSON.stringify(
      { failure: p.failure, evidence: p.evidence, outOfTable: p.outOfTable, dataQuality: p.dataQuality },
      null,
      1,
    );
    u = 0;
    $('scrub').value = 0;
    stop();
    draw();
  }

  // ---- replay: the stored sequence, the body in its own frame ----
  var BONES = [
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
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function col(seq, name) {
    return seq.columns.indexOf(name);
  }
  function rowAt(seq) {
    var i = Math.round(u * (seq.data.length - 1));
    return seq.data[Math.max(0, Math.min(seq.data.length - 1, i))];
  }

  function draw() {
    if (!rec) return;
    var seq = rec.record.sequence;
    var cv = $('skel'),
      g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (!seq) {
      g.fillStyle = css('--muted');
      g.fillText('No pose sequence for this jump.', 12, 24);
      return;
    }
    var row = rowAt(seq),
      S = 90,
      ox = 140,
      oy = 120;
    function pt(name) {
      var x = row[col(seq, name + '_x')],
        y = row[col(seq, name + '_y')];
      return x == null || y == null ? null : [ox + x * S, oy - y * S];
    }
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.strokeStyle = css('--ink');
    BONES.forEach(function (b) {
      var a = pt(b[0]),
        c = pt(b[1]);
      if (!a || !c) return;
      g.strokeStyle = b[0].indexOf('left') === 0 ? css('--accent') : css('--ink');
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(c[0], c[1]);
      g.stroke();
    });
    var nose = pt('nose');
    if (nose) {
      g.fillStyle = css('--ink');
      g.beginPath();
      g.arc(nose[0], nose[1], 7, 0, 6.3);
      g.fill();
    }
    g.fillStyle = css('--muted');
    g.font = '12px system-ui';
    g.fillText(
      'u = ' +
        u.toFixed(2) +
        '   hips ' +
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
    var cv = $('curves'),
      g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    var defs = [
      ['orient_turns', 'Rotation (turns)'],
      ['hip_angle_deg', 'Hip angle'],
      ['knee_angle_deg', 'Knee angle'],
      ['com_h_m', 'Height (m)'],
    ];
    var h = cv.height / defs.length;
    defs.forEach(function (d, k) {
      var i = col(seq, d[0]);
      if (i < 0) return;
      var vals = seq.data
        .map(function (r) {
          return r[i];
        })
        .filter(function (v) {
          return v != null && isFinite(v);
        });
      if (!vals.length) return;
      var lo = Math.min.apply(null, vals),
        hi = Math.max.apply(null, vals);
      if (hi - lo < 1e-6) {
        hi = lo + 1;
      }
      var top = k * h + 16,
        bot = (k + 1) * h - 6;
      g.fillStyle = css('--muted');
      g.font = '12px system-ui';
      g.fillText(d[1] + '  ' + lo.toFixed(1) + ' … ' + hi.toFixed(1), 6, k * h + 12);
      g.strokeStyle = css('--accent');
      g.lineWidth = 2;
      g.beginPath();
      var started = false;
      seq.data.forEach(function (r, n) {
        var v = r[i];
        if (v == null || !isFinite(v)) {
          started = false;
          return;
        }
        var x = 6 + (n / (seq.data.length - 1)) * (cv.width - 12),
          y = bot - ((v - lo) / (hi - lo)) * (bot - top);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else g.lineTo(x, y);
      });
      g.stroke();
    });
    var cx = 6 + u * (cv.width - 12);
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
    var last = performance.now();
    var seq = rec && rec.record.sequence;
    var dur = seq && seq.durationS ? seq.durationS : 1;
    (function tick(now) {
      u += (now - last) / 1000 / (dur * 2); // half speed
      last = now;
      if (u >= 1) {
        u = 0;
      }
      $('scrub').value = u;
      draw();
      timer = requestAnimationFrame(tick);
    })(last);
  }

  // ---- verdicts ----
  function showErr(e) {
    $('err').textContent = e && e.message ? e.message : String(e);
  }
  function verdict(body) {
    if (!current) return;
    var who = $('who').value.trim();
    try {
      localStorage.setItem('trampovision.reviewer', who);
    } catch {}
    body.note = $('note').value;
    body.reviewer = who;
    api('/jumps/' + encodeURIComponent(current) + '/review', { method: 'PUT', body: JSON.stringify(body) })
      .then(function () {
        next(true);
      })
      .catch(showErr);
  }
  function next(remove) {
    var i = list.findIndex(function (j) {
      return j.id === current;
    });
    if (remove && $('mode').value === 'queue') list.splice(i, 1);
    else i++;
    renderList();
    var n = list[Math.min(i, list.length - 1)];
    if (n) select(n.id);
    else {
      current = null;
      $('detail').hidden = true;
      $('empty').hidden = false;
      load();
    }
  }

  $('mode').onchange = load;
  $('play').onclick = play;
  $('scrub').oninput = function (e) {
    stop();
    u = Number(e.target.value);
    draw();
  };
  $('confirm').onclick = function () {
    verdict({ verdict: 'confirm' });
  };
  $('correct').onclick = function () {
    verdict({ verdict: 'correct', elementId: $('figure').value });
  };
  $('unknown').onclick = function () {
    verdict({ verdict: 'unknown' });
  };
  $('baddata').onclick = function () {
    verdict({ verdict: 'bad-data' });
  };
  $('skip').onclick = function () {
    next(false);
  };
  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || $('detail').hidden) return;
    if (e.key === 'Enter' && !$('confirm').disabled) verdict({ verdict: 'confirm' });
    else if (e.key === 'n' || e.key === 'N') next(false);
    else if (e.key === ' ') {
      e.preventDefault();
      play();
    }
  });

  if (API && token)
    api('/stats')
      .then(start)
      .catch(function () {});
  else signOut('This build has no review service configured (VITE_REVIEW_API_URL and VITE_REVIEW_INGEST_TOKEN).');
})();
