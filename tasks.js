/* ══════════════════════════════════════
   TASK TRACKER ENGINE — Alan's Brain
   ══════════════════════════════════════ */

// ⚡ IMPORTANT: Replace this URL with your Google Apps Script web app URL
var API_URL = 'https://script.google.com/macros/s/AKfycbw6KVC7l1hgLfDZM64MgjyRIMwJZWyMNcpA-GHHmyELbA_aJxrMZXFElf2LdGA4GaZ3/exec'; // <-- PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE
var API_KEY = '66515f46-97ea-4794-a335-7bb28a5afa0b'; // <-- PASTE A SECRET KEY HERE (must match your Apps Script)

var CATEGORY_COLORS = {
  'Kitchen':      '#f97316',
  'Bathroom':     '#38bdf8',
  'Living Areas': '#a78bfa',
  'Bedroom':      '#f472b6',
  'Basement':     '#34d399',
  'Dining Room':  '#fb7185',
  'Downstairs':   '#2dd4bf'
};
var EXTRA_COLORS = ['#fbbf24', '#f43f5e', '#8b5cf6', '#06b6d4', '#84cc16'];
var PERSON_COLORS = ['#2dd4bf', '#38bdf8', '#a78bfa', '#f472b6', '#fbbf24'];

// Fallback person list if the API hasn't returned any yet
var FALLBACK_PEOPLE = ['Alan', 'Takyra', 'Cassie', 'Zion'];

var currentFilter = 'all';
var currentArea = 'all';
var fadeEnabled = localStorage.getItem('t_fade') === 'true';
var fadeReverse = localStorage.getItem('t_fade_reverse') === 'true';
var cachedData = null;

// Write-back session state
var sessionWriteKey = null;
var lastPerson = null;

function initTaskTracker() {
  // Status filter clicks
  document.getElementById('tFilters').addEventListener('click', function(e) {
    var btn = e.target.closest('.t-filter');
    if (!btn) return;
    document.querySelectorAll('#tFilters .t-filter').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-filter');
    if (cachedData) renderTasks(cachedData);
  });

  // Area filter clicks
  document.getElementById('tAreaFilters').addEventListener('click', function(e) {
    var btn = e.target.closest('.t-area-filter');
    if (!btn) return;
    document.querySelectorAll('.t-area-filter').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentArea = btn.getAttribute('data-area');
    if (cachedData) renderTasks(cachedData);
  });

  // Fade toggle
  var fadeToggle = document.getElementById('tFadeToggle');
  var reverseToggle = document.getElementById('tReverseToggle');
  var reverseWrap = document.getElementById('tReverseWrap');
  fadeToggle.checked = fadeEnabled;
  reverseToggle.checked = fadeReverse;
  reverseWrap.style.display = fadeEnabled ? '' : 'none';

  fadeToggle.addEventListener('change', function() {
    fadeEnabled = this.checked;
    localStorage.setItem('t_fade', fadeEnabled);
    reverseWrap.style.display = fadeEnabled ? '' : 'none';
    if (cachedData) renderTasks(cachedData);
  });
  reverseToggle.addEventListener('change', function() {
    fadeReverse = this.checked;
    localStorage.setItem('t_fade_reverse', fadeReverse);
    if (cachedData) renderTasks(cachedData);
  });

  // Category collapse + task card tap (event delegation on #tList)
  document.getElementById('tList').addEventListener('click', function(e) {
    // Category collapse
    var h = e.target.closest('.t-cat-header');
    if (h) {
      h.closest('.t-category').classList.toggle('collapsed');
      return;
    }
    // Task card tap — open drawer
    var card = e.target.closest('.t-card');
    if (card && card.dataset.task) {
      openDrawer(card.dataset.task, card.dataset.category, card);
    }
  });

  // Drawer: backdrop close
  document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);

  // Drawer: person picker
  document.getElementById('drawerPeople').addEventListener('click', function(e) {
    var chip = e.target.closest('.drawer-person');
    if (!chip) return;
    document.querySelectorAll('.drawer-person').forEach(function(c) { c.classList.remove('selected'); });
    chip.classList.add('selected');
  });

  // Drawer: when toggle
  document.querySelector('.drawer-when-options').addEventListener('click', function(e) {
    var opt = e.target.closest('.drawer-when-opt');
    if (!opt) return;
    var when = opt.getAttribute('data-when');
    document.querySelectorAll('.drawer-when-opt').forEach(function(b) {
      b.classList.toggle('selected', b.getAttribute('data-when') === when);
    });
    document.getElementById('drawerDateRow').classList.toggle('visible', when === 'earlier');
  });

  // Drawer: done button
  document.getElementById('drawerDoneBtn').addEventListener('click', submitDrawer);

  // Drawer: Enter key on PIN field
  document.getElementById('drawerPin').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitDrawer();
    // Clear error when typing
    document.getElementById('drawerError').textContent = '';
  });

  // Initial load + auto-refresh
  loadTasks();
  setInterval(function() { loadTasks(); }, 5 * 60 * 1000);
}

function manualRefresh() {
  var btn = document.getElementById('tRefresh');
  btn.classList.add('spinning');
  loadTasks(function() { btn.classList.remove('spinning'); });
}

function loadTasks(callback) {
  if (!API_URL) {
    document.getElementById('tLoading').innerHTML =
      '<div style="font-size:1.3rem;margin-bottom:8px">🔧</div>' +
      '<div style="color:var(--text-muted);font-size:0.9rem;line-height:1.5">' +
        'Set your <strong>API_URL</strong> in tasks.js to connect to Google Sheets.' +
        '<br><span style="font-size:0.78rem;color:var(--text-dim)">See the deployment guide for instructions.</span>' +
      '</div>';
    if (callback) callback();
    return;
  }

  var fetchUrl = API_URL;
  if (API_KEY) fetchUrl += (API_URL.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(API_KEY);

  fetch(fetchUrl)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      cachedData = data;
      renderTasks(data);
      document.getElementById('tLoading').style.display = 'none';
      var now = new Date();
      document.getElementById('tUpdated').textContent = 'Updated ' + now.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
      if (callback) callback();
    })
    .catch(function(err) {
      console.error(err);
      document.getElementById('tLoading').innerHTML =
        '<div style="font-size:1.3rem;margin-bottom:8px">😕</div>' +
        '<div style="color:var(--text-muted)">Failed to load tasks</div>' +
        '<button onclick="loadTasks()" style="margin-top:12px;padding:10px 20px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:10px;font-family:inherit;font-size:0.85rem;cursor:pointer">Retry</button>';
      if (callback) callback();
    });
}

function renderTasks(data) {
  var tasks = data.tasks;
  var stats = data.weeklyStats;
  tasks.sort(function(a, b) { return b.urgency - a.urgency; });

  // Alert
  var oCount = tasks.filter(function(t){return t.status==='overdue'}).length;
  var dCount = tasks.filter(function(t){return t.status==='due-soon'}).length;
  var alert = document.getElementById('tAlert');
  if (oCount > 0) {
    var m = [];
    if (oCount) m.push(oCount + ' overdue');
    if (dCount) m.push(dCount + ' due soon');
    document.getElementById('tAlertText').textContent = m.join(' · ');
    alert.classList.add('visible');
  } else {
    alert.classList.remove('visible');
  }

  // Stats
  var okC = tasks.filter(function(t){return t.status==='ok'}).length;
  var nC = tasks.filter(function(t){return t.status==='never'}).length;
  document.getElementById('tStats').innerHTML =
    stat(oCount,'Overdue','var(--red)') +
    stat(dCount,'Due Soon','var(--yellow)') +
    stat(okC,'On Track','var(--green)') +
    stat(nC,'Not Done','var(--gray)');

  // Build area filter pills (from all tasks, not filtered)
  var allCats = {};
  tasks.forEach(function(t) { allCats[t.category] = true; });
  var areaBar = document.getElementById('tAreaFilters');
  var areaHtml = '<button class="t-filter t-area-filter' + (currentArea === 'all' ? ' active' : '') + '" data-area="all">All Areas</button>';
  Object.keys(allCats).sort().forEach(function(cat) {
    areaHtml += '<button class="t-filter t-area-filter' + (currentArea === cat ? ' active' : '') + '" data-area="' + esc(cat) + '">' + esc(cat) + '</button>';
  });
  areaBar.innerHTML = areaHtml;

  // Filter by status
  var filtered = tasks;
  if (currentFilter !== 'all') {
    filtered = tasks.filter(function(t){return t.status === currentFilter});
  }
  // Filter by area
  if (currentArea !== 'all') {
    filtered = filtered.filter(function(t){return t.category === currentArea});
  }

  // Group
  var cats = {}, catOrder = [];
  filtered.forEach(function(t) {
    if (!cats[t.category]) { cats[t.category] = []; catOrder.push(t.category); }
    cats[t.category].push(t);
  });
  catOrder.sort();

  var list = document.getElementById('tList');
  var empty = document.getElementById('tEmpty');
  list.innerHTML = '';
  empty.style.display = filtered.length === 0 ? 'block' : 'none';

  var delay = 0;
  catOrder.forEach(function(cat) {
    var ct = cats[cat];
    var okN = ct.filter(function(t){return t.status==='ok'}).length;
    var color = CATEGORY_COLORS[cat] || EXTRA_COLORS[catOrder.indexOf(cat) % EXTRA_COLORS.length];

    var sec = document.createElement('div');
    sec.className = 't-category anim';
    sec.style.animationDelay = delay + 'ms';
    delay += 40;

    sec.innerHTML =
      '<div class="t-cat-header">' +
        '<div class="t-cat-dot" style="background:'+color+'"></div>' +
        '<div class="t-cat-name">'+esc(cat)+'</div>' +
        '<div class="t-cat-line"></div>' +
        '<div class="t-cat-count">'+okN+'/'+ct.length+'</div>' +
        '<div class="t-cat-arrow">▼</div>' +
      '</div><div class="t-cat-tasks"></div>';

    var container = sec.querySelector('.t-cat-tasks');
    ct.forEach(function(t) {
      var card = document.createElement('div');
      card.className = 't-card s-'+t.status+' tappable anim';
      card.style.animationDelay = delay + 'ms';
      card.setAttribute('data-task', t.task);
      card.setAttribute('data-category', t.category);
      delay += 25;

      var bc = 'b-'+t.status;
      var bt = '';
      if (t.status==='overdue') bt = t.daysOverdue+'d over';
      else if (t.status==='due-soon') bt = Math.max(1, Math.round(t.hoursLeft/24))+'d left';
      else if (t.status==='ok') bt = '✓ '+Math.round(t.hoursLeft/24)+'d';
      else bt = 'Not done';

      // Progress fade: compute fill percentage (0% = just done, 100% = due now)
      var fadeStyle = '';
      if (fadeEnabled && t.status !== 'never') {
        var pct = 0;
        if (t.status === 'overdue') {
          pct = 100;
        } else if (t.hoursLeft != null && t.cycleDays) {
          var totalH = t.cycleDays * 24;
          var elapsed = totalH - t.hoursLeft;
          pct = Math.max(0, Math.min(100, Math.round((elapsed / totalH) * 100)));
        }
        if (fadeReverse) pct = 100 - pct;
        var fadeHex = t.status === 'overdue' ? '#fb718522' :
                      t.status === 'due-soon' ? '#fbbf2422' : '#34d39922';
        fadeStyle = 'background:linear-gradient(to right, ' + fadeHex + ' 0%, ' + fadeHex + ' ' + pct + '%, transparent ' + pct + '%, transparent 100%);';
      }

      var mp = ['Every '+t.cycleDays+'d'];
      if (t.lastPerson && t.status!=='never') mp.push('✓ '+esc(t.lastPerson));
      if (t.lastDone) mp.push(timeAgo(new Date(t.lastDone)));

      card.innerHTML =
        (fadeStyle ? '<div class="t-card-fade" style="' + fadeStyle + '"></div>' : '') +
        '<div class="t-card-top">' +
          '<div class="t-card-name">'+esc(t.task)+'</div>' +
          '<div class="t-badge '+bc+'">'+bt+'</div>' +
        '</div>' +
        '<div class="t-card-meta">'+mp.map(function(m){return '<span>'+m+'</span>'}).join('')+'</div>';

      container.appendChild(card);
    });
    list.appendChild(sec);
  });

  // Weekly
  var wb = document.getElementById('tWeeklyBars');
  var ws = document.getElementById('tWeekly');
  var people = Object.keys(stats);
  if (!people.length) { ws.style.display = 'none'; return; }
  ws.style.display = 'block';
  var mx = Math.max.apply(null, people.map(function(p){return stats[p]}));
  wb.innerHTML = '';
  people.sort(function(a,b){return stats[b]-stats[a]});
  people.forEach(function(p,i) {
    var pct = mx > 0 ? Math.round((stats[p]/mx)*100) : 0;
    var c = PERSON_COLORS[i % PERSON_COLORS.length];
    wb.innerHTML +=
      '<div class="t-bar-row anim" style="animation-delay:'+(delay+i*40)+'ms">' +
        '<div class="t-bar-name">'+esc(p)+'</div>' +
        '<div class="t-bar-track"><div class="t-bar-fill" style="width:'+pct+'%;background:'+c+'">'+stats[p]+'</div></div>' +
      '</div>';
  });
}

// ── Drawer Logic ──

var _activeCard = null;

function getPersonList() {
  // Merge API people, weeklyStats names, and fallback list — deduplicated, order preserved
  var seen = {};
  var result = [];
  function add(name) {
    if (name && name !== 'Unknown' && !seen[name]) {
      seen[name] = true;
      result.push(name);
    }
  }
  // API-provided people first
  if (cachedData && cachedData.people) {
    cachedData.people.forEach(add);
  }
  // Then weekly stats names
  if (cachedData && cachedData.weeklyStats) {
    Object.keys(cachedData.weeklyStats).forEach(add);
  }
  // Always include the full household
  FALLBACK_PEOPLE.forEach(add);
  return result;
}

function openDrawer(taskName, category, cardEl) {
  _activeCard = cardEl;
  document.getElementById('drawerTaskName').textContent = taskName;
  document.getElementById('drawer').setAttribute('data-task', taskName);
  document.getElementById('drawer').setAttribute('data-category', category);
  document.getElementById('drawerError').textContent = '';

  // Person picker
  var people = getPersonList();
  var peopleHtml = '';
  people.forEach(function(name) {
    var sel = (name === lastPerson) ? ' selected' : '';
    peopleHtml += '<button class="drawer-person' + sel + '" data-person="' + esc(name) + '">' + esc(name) + '</button>';
  });
  document.getElementById('drawerPeople').innerHTML = peopleHtml;

  // Reset when-toggle
  document.querySelectorAll('.drawer-when-opt').forEach(function(b) {
    b.classList.toggle('selected', b.getAttribute('data-when') === 'now');
  });
  document.getElementById('drawerDateRow').classList.remove('visible');
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  document.getElementById('drawerDate').value = yesterday.toISOString().split('T')[0];
  document.getElementById('drawerTime').value = '12:00';

  // PIN field: hide if already stored this session
  var pinWrap = document.getElementById('drawerPinWrap');
  if (sessionWriteKey) {
    pinWrap.style.display = 'none';
  } else {
    pinWrap.style.display = '';
    document.getElementById('drawerPin').value = '';
  }

  // Reset button
  var btn = document.getElementById('drawerDoneBtn');
  btn.disabled = false;
  btn.textContent = 'Done ✓';

  // Open — lock page scroll
  document.body.style.overflow = 'hidden';
  document.getElementById('drawerBackdrop').classList.add('open');
  document.getElementById('drawer').classList.add('open');

  // Focus PIN if needed, otherwise leave it
  if (!sessionWriteKey) {
    setTimeout(function() { document.getElementById('drawerPin').focus(); }, 350);
  }
}

function closeDrawer() {
  document.body.style.overflow = '';
  document.getElementById('drawerBackdrop').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
  _activeCard = null;
}

function submitDrawer() {
  var btn = document.getElementById('drawerDoneBtn');
  var errorEl = document.getElementById('drawerError');

  // Get selected person
  var selectedChip = document.querySelector('.drawer-person.selected');
  if (!selectedChip) {
    errorEl.textContent = 'Pick a person first';
    return;
  }
  var person = selectedChip.getAttribute('data-person');

  // Get PIN
  var writeKey = sessionWriteKey;
  if (!writeKey) {
    writeKey = document.getElementById('drawerPin').value.trim();
    if (!writeKey) {
      errorEl.textContent = 'Enter the write PIN';
      document.getElementById('drawerPin').focus();
      return;
    }
  }

  var taskName = document.getElementById('drawer').getAttribute('data-task');
  var category = document.getElementById('drawer').getAttribute('data-category');

  // Disable button to prevent double-tap
  btn.disabled = true;
  btn.textContent = 'Saving...';
  errorEl.textContent = '';

  // Check for backdated completion
  var completedAt = null;
  var whenSelected = document.querySelector('.drawer-when-opt.selected');
  if (whenSelected && whenSelected.getAttribute('data-when') === 'earlier') {
    var d = document.getElementById('drawerDate').value;
    var t = document.getElementById('drawerTime').value || '12:00';
    if (d) completedAt = new Date(d + 'T' + t).toISOString();
  }

  markTaskDone(taskName, category, person, writeKey, completedAt)
    .then(function(result) {
      if (result.error === 'wrong-pin') {
        // Clear stored key if it was from session (it's now invalid)
        sessionWriteKey = null;
        document.getElementById('drawerPinWrap').style.display = '';
        document.getElementById('drawerPin').value = '';
        var pinInput = document.getElementById('drawerPin');
        pinInput.classList.add('shake');
        setTimeout(function() { pinInput.classList.remove('shake'); }, 600);
        errorEl.textContent = 'Wrong PIN';
        btn.disabled = false;
        btn.textContent = 'Done ✓';
        pinInput.focus();
        return;
      }
      if (result.error === 'task-not-found') {
        errorEl.textContent = 'Task not found in sheet — was it renamed?';
        btn.disabled = false;
        btn.textContent = 'Done ✓';
        return;
      }
      if (result.error) {
        errorEl.textContent = 'Error: ' + result.error;
        btn.disabled = false;
        btn.textContent = 'Done ✓';
        return;
      }

      // Success
      sessionWriteKey = writeKey;
      lastPerson = person;
      closeDrawer();

      // Flash the card green
      if (_activeCard) {
        _activeCard.classList.add('success-flash');
        setTimeout(function() {
          if (_activeCard) _activeCard.classList.remove('success-flash');
        }, 1200);
      }

      // Refresh data
      loadTasks();
    })
    .catch(function() {
      errorEl.textContent = "Couldn't reach the server";
      btn.disabled = false;
      btn.textContent = 'Done ✓';
    });
}

function markTaskDone(taskName, category, person, writeKey, completedAt) {
  var payload = {
    action: 'markDone',
    task: taskName,
    category: category,
    person: person,
    writeKey: writeKey,
    key: API_KEY
  };
  if (completedAt) payload.completedAt = completedAt;

  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  }).then(function(r) { return r.json(); });
}

// ── Helpers ──

function stat(n,l,c) {
  return '<div class="t-stat"><div class="t-stat-num" style="color:'+c+'">'+n+'</div><div class="t-stat-label">'+l+'</div></div>';
}

function timeAgo(d) {
  var s = Math.floor((new Date()-d)/1000);
  if (s<60) return 'just now';
  var m = Math.floor(s/60);
  if (m<60) return m+'m ago';
  var h = Math.floor(m/60);
  if (h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}

function esc(s) {
  var el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}
