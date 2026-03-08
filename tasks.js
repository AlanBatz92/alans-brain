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

var currentFilter = 'all';
var cachedData = null;

function initTaskTracker() {
  // Filter clicks
  document.getElementById('tFilters').addEventListener('click', function(e) {
    var btn = e.target.closest('.t-filter');
    if (!btn) return;
    document.querySelectorAll('.t-filter').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-filter');
    if (cachedData) renderTasks(cachedData);
  });

  // Category collapse
  document.getElementById('tList').addEventListener('click', function(e) {
    var h = e.target.closest('.t-cat-header');
    if (!h) return;
    h.closest('.t-category').classList.toggle('collapsed');
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

  // Filter
  var filtered = tasks;
  if (currentFilter !== 'all') {
    filtered = tasks.filter(function(t){return t.status === currentFilter});
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
      card.className = 't-card s-'+t.status+' anim';
      card.style.animationDelay = delay + 'ms';
      delay += 25;

      var bc = 'b-'+t.status;
      var bt = '';
      if (t.status==='overdue') bt = t.daysOverdue+'d over';
      else if (t.status==='due-soon') bt = t.hoursLeft+'h left';
      else if (t.status==='ok') bt = '✓ '+Math.round(t.hoursLeft/24)+'d';
      else bt = 'Not done';

      var mp = ['Every '+t.cycleDays+'d'];
      if (t.lastPerson && t.status!=='never') mp.push('✓ '+esc(t.lastPerson));
      if (t.lastDone) mp.push(timeAgo(new Date(t.lastDone)));

      card.innerHTML =
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
