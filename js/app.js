(() => {
  'use strict';

  /* ---------------- Categories ---------------- */
  const EXPENSE_CATEGORIES = [
    { id: 'groceries', name: 'Groceries', emoji: '🛒' },
    { id: 'housing', name: 'Housing', emoji: '🏠' },
    { id: 'utilities', name: 'Utilities', emoji: '💡' },
    { id: 'transport', name: 'Transport', emoji: '🚗' },
    { id: 'dining', name: 'Dining Out', emoji: '🍽️' },
    { id: 'health', name: 'Health', emoji: '🏥' },
    { id: 'shopping', name: 'Shopping', emoji: '🛍️' },
    { id: 'entertainment', name: 'Fun', emoji: '🎬' },
    { id: 'subscriptions', name: 'Subscriptions', emoji: '🔁' },
    { id: 'debt', name: 'Debt', emoji: '💳' },
    { id: 'family', name: 'Family', emoji: '👨‍👩‍👧' },
    { id: 'other_exp', name: 'Other', emoji: '➕' },
  ];

  const INCOME_CATEGORIES = [
    { id: 'salary', name: 'Salary', emoji: '💼' },
    { id: 'freelance', name: 'Freelance', emoji: '🧾' },
    { id: 'gift', name: 'Gift', emoji: '🎁' },
    { id: 'refund', name: 'Refund', emoji: '↩️' },
    { id: 'investment', name: 'Investment', emoji: '📈' },
    { id: 'other_inc', name: 'Other', emoji: '➕' },
  ];

  const CAT_BY_ID = {};
  [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].forEach((c) => (CAT_BY_ID[c.id] = c));

  /* ---------------- Storage ---------------- */
  const STORE_KEY = 'hb_transactions_v1';
  const SETTINGS_KEY = 'hb_settings_v1';
  const TASKS_KEY = 'hb_tasks_v1';
  const RECURRING_KEY = 'hb_recurring_v1';

  const Store = {
    load() {
      try {
        return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
      } catch (e) {
        return [];
      }
    },
    save(list) {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    },
    loadTasks() {
      try {
        return JSON.parse(localStorage.getItem(TASKS_KEY)) || [];
      } catch (e) {
        return [];
      }
    },
    saveTasks(list) {
      localStorage.setItem(TASKS_KEY, JSON.stringify(list));
    },
    loadRecurring() {
      try {
        return JSON.parse(localStorage.getItem(RECURRING_KEY)) || [];
      } catch (e) {
        return [];
      }
    },
    saveRecurring(list) {
      localStorage.setItem(RECURRING_KEY, JSON.stringify(list));
    },
    loadSettings() {
      try {
        return Object.assign(
          { currency: 'USD', goal: 0 },
          JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
        );
      } catch (e) {
        return { currency: 'USD', goal: 0 };
      }
    },
    saveSettings(s) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    },
  };

  let transactions = Store.load();
  let settings = Store.loadSettings();
  let tasks = Store.loadTasks();
  let recurring = Store.loadRecurring();

  const CURRENCIES = {
    USD: '$', EUR: '€', GBP: '£', EGP: 'E£', SAR: '﷼', AED: 'د.إ', INR: '₹', JPY: '¥', CAD: '$', AUD: '$',
  };

  function fmt(amount) {
    const sym = CURRENCIES[settings.currency] || settings.currency + ' ';
    const n = Math.round((amount + Number.EPSILON) * 100) / 100;
    const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? '-' : ''}${sym}${abs}`;
  }

  function uid() {
    return 'tx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function monthKey(dateStr) {
    return dateStr.slice(0, 7); // YYYY-MM
  }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function daysInMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function isoFromDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function formatShortDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function freqLabel(rule) {
    return rule.frequency === 'monthly'
      ? `Monthly on day ${rule.dayOfMonth}`
      : `Weekly on ${WEEKDAY_NAMES[rule.weekday]}`;
  }

  /* ---------------- Recurring engine ---------------- */
  function nextOccurrence(rule, fromDateStr) {
    if (rule.frequency === 'monthly') {
      const [y, m] = fromDateStr.split('-').map(Number);
      const total = m; // (m - 1) zero-based months elapsed, plus 1 to advance a month
      const ny = y + Math.floor(total / 12);
      const nm = ((total % 12) + 12) % 12;
      const dim = new Date(ny, nm + 1, 0).getDate();
      const day = Math.min(rule.dayOfMonth, dim);
      return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const d = new Date(fromDateStr + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    return isoFromDate(d);
  }

  function runRecurringEngine() {
    const today = todayISO();
    let generated = 0;
    recurring.forEach((rule) => {
      if (!rule.active) return;
      let guard = 0;
      let next = nextOccurrence(rule, rule.lastRun);
      while (next <= today && guard < 60) {
        transactions.push({
          id: uid(),
          type: rule.type,
          amount: rule.amount,
          category: rule.category,
          date: next,
          note: rule.note,
          createdAt: Date.now(),
          recurringId: rule.id,
        });
        rule.lastRun = next;
        generated++;
        guard++;
        next = nextOccurrence(rule, rule.lastRun);
      }
    });
    if (generated > 0) {
      Store.save(transactions);
      Store.saveRecurring(recurring);
    }
    return generated;
  }

  function upcomingRecurring(limit) {
    return recurring
      .filter((r) => r.active)
      .map((r) => ({ rule: r, date: nextOccurrence(r, r.lastRun) }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, limit);
  }

  /* ---------------- State ---------------- */
  const state = {
    view: 'home',
    homeMonth: monthKey(todayISO()),
    historyMonth: monthKey(todayISO()),
    historyType: 'all',
    historyCat: 'all',
    editingId: null,
    formType: 'expense',
    formCat: EXPENSE_CATEGORIES[0].id,
    formRepeat: 'none',
    openSheetEl: null,
  };

  /* ---------------- DOM refs ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');

  /* ================= RENDER: HOME ================= */
  function summarize(mKey) {
    let income = 0, expense = 0;
    const byCat = {};
    transactions.forEach((t) => {
      if (monthKey(t.date) !== mKey) return;
      if (t.type === 'income') {
        income += t.amount;
      } else {
        expense += t.amount;
        byCat[t.category] = (byCat[t.category] || 0) + t.amount;
      }
    });
    return { income, expense, saved: income - expense, byCat };
  }

  function renderHome() {
    const mKey = state.homeMonth;
    const { income, expense, saved, byCat } = summarize(mKey);
    const rate = income > 0 ? Math.max(0, Math.min(100, (saved / income) * 100)) : 0;

    const isCurrentMonth = mKey === monthKey(todayISO());
    let insight = '';
    if (isCurrentMonth) {
      const now = new Date();
      const elapsed = now.getDate();
      const total = daysInMonth(mKey);
      if (expense > 0 && elapsed > 0) {
        const dailyAvg = expense / elapsed;
        const projected = dailyAvg * total;
        insight = `<div class="insight-box"><span class="emoji">📊</span><div>Spending <b>${fmt(dailyAvg)}</b>/day so far. At this pace you'll spend about <b>${fmt(projected)}</b> this month.</div></div>`;
      }
    }

    let goalBlock = '';
    if (settings.goal > 0) {
      const goalPct = Math.max(0, Math.min(100, (saved / settings.goal) * 100));
      goalBlock = `
        <div class="progress-track"><div class="progress-fill" style="width:${goalPct}%"></div></div>
        <div style="font-size:12px;opacity:.85;margin-top:6px;">${fmt(Math.max(0, saved))} of ${fmt(settings.goal)} savings goal (${Math.round(goalPct)}%)</div>
      `;
    }

    const catRows = Object.keys(byCat)
      .sort((a, b) => byCat[b] - byCat[a])
      .slice(0, 6)
      .map((cid) => {
        const cat = CAT_BY_ID[cid] || { name: cid, emoji: '➕' };
        const pct = expense > 0 ? Math.round((byCat[cid] / expense) * 100) : 0;
        return `
          <div class="cat-row">
            <div class="cat-row-top">
              <div class="cat-name"><span class="cat-emoji">${cat.emoji}</span>${cat.name}</div>
              <div class="cat-amount">${fmt(byCat[cid])}</div>
            </div>
            <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
          </div>`;
      })
      .join('');

    // trend: last 6 months
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(mKey, -i));
    const trendData = months.map((mk) => summarize(mk).saved);
    const maxAbs = Math.max(1, ...trendData.map((v) => Math.abs(v)));
    const trendCols = months
      .map((mk, i) => {
        const v = trendData[i];
        const h = Math.max(3, (Math.abs(v) / maxAbs) * 80);
        const cls = v < 0 ? 'neg' : 'pos';
        const [, m] = mk.split('-');
        const mName = new Date(2000, Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
        return `<div class="trend-col"><div class="trend-bar ${cls}" style="height:${h}px" title="${fmt(v)}"></div><div class="trend-month">${mName}</div></div>`;
      })
      .join('');

    const recent = transactions
      .filter((t) => monthKey(t.date) === mKey)
      .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
      .slice(0, 5);

    let upcomingBlock = '';
    if (isCurrentMonth) {
      const items = upcomingRecurring(4);
      if (items.length) {
        const rows = items
          .map(({ rule, date }) => {
            const cat = CAT_BY_ID[rule.category] || { name: rule.category, emoji: '➕' };
            return `
              <div class="cat-row">
                <div class="cat-row-top" style="margin-bottom:0;">
                  <div class="cat-name"><span class="cat-emoji">${cat.emoji}</span>${cat.name} <span style="color:var(--text-dim);font-weight:500;">· ${formatShortDate(date)}</span></div>
                  <div class="cat-amount">${rule.type === 'income' ? '+' : '-'}${fmt(rule.amount)}</div>
                </div>
              </div>`;
          })
          .join('');
        upcomingBlock = `<div class="section-title">Upcoming</div><div class="cat-list">${rows}</div>`;
      }
    }

    $('#home-view').innerHTML = `
      <div class="month-switch">
        <button class="icon-btn" id="home-prev">${chevronLeft()}</button>
        <div class="label">${monthLabel(mKey)}</div>
        <button class="icon-btn" id="home-next" ${mKey >= monthKey(todayISO()) ? 'style="visibility:hidden"' : ''}>${chevronRight()}</button>
      </div>

      <div class="summary-card">
        <div class="saved-label">${isCurrentMonth ? 'Saved so far this month' : 'Saved this month'}</div>
        <div class="saved-amount ${saved < 0 ? 'negative' : ''}">${fmt(saved)}</div>
        <div class="summary-row">
          <div class="summary-col">
            <div class="lbl"><span class="dot income"></span>Income</div>
            <div class="val">${fmt(income)}</div>
          </div>
          <div class="summary-col">
            <div class="lbl"><span class="dot expense"></span>Expenses</div>
            <div class="val">${fmt(expense)}</div>
          </div>
          <div class="summary-col">
            <div class="lbl">Savings rate</div>
            <div class="val">${income > 0 ? Math.round(rate) : 0}%</div>
          </div>
        </div>
        ${goalBlock}
      </div>

      ${insight ? `<div style="margin-top:14px;">${insight}</div>` : ''}

      ${upcomingBlock}

      <div class="section-title">6-Month Trend</div>
      <div class="trend-chart">${trendCols}</div>

      <div class="section-title">Top Categories</div>
      ${catRows ? `<div class="cat-list">${catRows}</div>` : emptyState('📁', 'No expenses logged this month yet')}

      <div class="section-title">Recent Activity</div>
      ${recent.length ? `<div class="tx-list">${recent.map(txItem).join('')}</div>` : emptyState('🧾', 'No transactions yet — tap + to add one')}
    `;

    $('#home-prev').onclick = () => { state.homeMonth = shiftMonth(state.homeMonth, -1); renderHome(); };
    const nextBtn = $('#home-next');
    if (nextBtn) nextBtn.onclick = () => { state.homeMonth = shiftMonth(state.homeMonth, 1); renderHome(); };
    $('#home-view').querySelectorAll('.tx-item').forEach((el) => {
      el.onclick = () => openForm(el.dataset.id);
    });
  }

  function emptyState(emoji, text) {
    return `<div class="empty-state"><span class="emoji">${emoji}</span>${text}</div>`;
  }

  function txItem(t) {
    const cat = CAT_BY_ID[t.category] || { name: t.category, emoji: '➕' };
    const d = new Date(t.date + 'T00:00:00');
    const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    const repeatBadge = t.recurringId ? '<span class="tx-repeat-badge" title="Recurring">↻</span>' : '';
    return `
      <div class="tx-item" data-id="${t.id}">
        <div class="tx-icon">${cat.emoji}${repeatBadge}</div>
        <div class="tx-mid">
          <div class="tx-cat">${cat.name}</div>
          <div class="tx-note">${t.note ? escapeHtml(t.note) : dayLabel}</div>
        </div>
        <div class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</div>
      </div>`;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /* ================= RENDER: HISTORY ================= */
  function renderHistory() {
    const mKey = state.historyMonth;
    let list = transactions.filter((t) => monthKey(t.date) === mKey);
    if (state.historyType !== 'all') list = list.filter((t) => t.type === state.historyType);
    if (state.historyCat !== 'all') list = list.filter((t) => t.category === state.historyCat);
    list.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

    const groups = {};
    list.forEach((t) => {
      (groups[t.date] = groups[t.date] || []).push(t);
    });
    const dateKeys = Object.keys(groups).sort().reverse();

    const catChips = state.historyType === 'income' ? INCOME_CATEGORIES : state.historyType === 'expense' ? EXPENSE_CATEGORIES : [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
    const seenCatIds = new Set();
    const uniqueCatChips = catChips.filter((c) => (seenCatIds.has(c.id) ? false : (seenCatIds.add(c.id), true)));

    const body = dateKeys.length
      ? dateKeys
          .map((dk) => {
            const d = new Date(dk + 'T00:00:00');
            const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
            const dayTotal = groups[dk].reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
            return `
              <div class="tx-date-group">
                <div class="tx-date-label" style="display:flex;justify-content:space-between;">
                  <span>${label}</span><span>${fmt(dayTotal)}</span>
                </div>
                <div class="tx-list">${groups[dk].map(txItem).join('')}</div>
              </div>`;
          })
          .join('')
      : emptyState('🔍', 'No transactions match this filter');

    $('#history-view').innerHTML = `
      <div class="month-switch">
        <button class="icon-btn" id="hist-prev">${chevronLeft()}</button>
        <div class="label">${monthLabel(mKey)}</div>
        <button class="icon-btn" id="hist-next" ${mKey >= monthKey(todayISO()) ? 'style="visibility:hidden"' : ''}>${chevronRight()}</button>
      </div>
      <div class="filter-row" id="type-filter">
        <button class="chip ${state.historyType === 'all' ? 'active' : ''}" data-t="all">All</button>
        <button class="chip ${state.historyType === 'expense' ? 'active' : ''}" data-t="expense">Expenses</button>
        <button class="chip ${state.historyType === 'income' ? 'active' : ''}" data-t="income">Income</button>
      </div>
      <div class="filter-row" id="cat-filter">
        <button class="chip ${state.historyCat === 'all' ? 'active' : ''}" data-c="all">All categories</button>
        ${uniqueCatChips.map((c) => `<button class="chip ${state.historyCat === c.id ? 'active' : ''}" data-c="${c.id}">${c.emoji} ${c.name}</button>`).join('')}
      </div>
      ${body}
    `;

    $('#hist-prev').onclick = () => { state.historyMonth = shiftMonth(state.historyMonth, -1); renderHistory(); };
    const nextBtn = $('#hist-next');
    if (nextBtn) nextBtn.onclick = () => { state.historyMonth = shiftMonth(state.historyMonth, 1); renderHistory(); };
    $('#type-filter').querySelectorAll('.chip').forEach((el) => {
      el.onclick = () => { state.historyType = el.dataset.t; state.historyCat = 'all'; renderHistory(); };
    });
    $('#cat-filter').querySelectorAll('.chip').forEach((el) => {
      el.onclick = () => { state.historyCat = el.dataset.c; renderHistory(); };
    });
    $('#history-view').querySelectorAll('.tx-item').forEach((el) => {
      el.onclick = () => openForm(el.dataset.id);
    });
  }

  /* ================= RENDER: TASKS ================= */
  function renderTasks() {
    const active = tasks.filter((t) => !t.done).sort((a, b) => a.createdAt - b.createdAt);
    const done = tasks.filter((t) => t.done).sort((a, b) => b.createdAt - a.createdAt);

    const row = (t) => `
      <div class="task-item ${t.done ? 'done' : ''}" data-id="${t.id}">
        <div class="task-check" data-action="toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <div class="task-text" data-action="toggle">${escapeHtml(t.text)}</div>
        <button class="task-del" data-action="delete" aria-label="Delete task">${trashIconSmall()}</button>
      </div>`;

    const body = tasks.length
      ? `
        <div class="task-list">${active.map(row).join('')}</div>
        ${done.length ? `<div class="section-title">Completed (${done.length})</div><div class="task-list">${done.map(row).join('')}</div>` : ''}
      `
      : emptyState('✅', 'No tasks yet — add your first one above');

    $('#tasks-view').innerHTML = `
      <div class="task-add-row">
        <input type="text" id="task-input" placeholder="Add a task..." maxlength="120">
        <button id="task-add-btn" aria-label="Add task">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      ${body}
    `;

    const input = $('#task-input');
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      tasks.push({ id: uid(), text, done: false, createdAt: Date.now() });
      Store.saveTasks(tasks);
      renderTasks();
    };
    $('#task-add-btn').onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };

    $('#tasks-view').querySelectorAll('.task-item').forEach((el) => {
      const id = el.dataset.id;
      el.querySelectorAll('[data-action="toggle"]').forEach((t) => {
        t.onclick = () => {
          const task = tasks.find((x) => x.id === id);
          task.done = !task.done;
          Store.saveTasks(tasks);
          renderTasks();
        };
      });
      el.querySelector('[data-action="delete"]').onclick = () => {
        tasks = tasks.filter((x) => x.id !== id);
        Store.saveTasks(tasks);
        renderTasks();
      };
    });
  }

  /* ================= RENDER: SETTINGS ================= */
  function renderSettings() {
    const total = transactions.length;
    $('#settings-view').innerHTML = `
      <div class="settings-list">
        <div class="settings-row">
          <div class="label-block"><div class="t">Currency</div><div class="d">Used for all amounts</div></div>
          <select id="set-currency">
            ${Object.keys(CURRENCIES).map((c) => `<option value="${c}" ${settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="settings-row">
          <div class="label-block"><div class="t">Monthly savings goal</div><div class="d">Shown as progress on Home</div></div>
          <input type="number" id="set-goal" min="0" step="1" value="${settings.goal || ''}" placeholder="0">
        </div>
        <div class="settings-row" id="recurring-row">
          <div class="label-block"><div class="t">Recurring expenses</div><div class="d">${recurring.filter((r) => r.active).length} active · manage repeats</div></div>
          <span>${repeatIconSmall()}</span>
        </div>
        <div class="settings-row" id="export-row">
          <div class="label-block"><div class="t">Export backup</div><div class="d">${total} transaction${total === 1 ? '' : 's'} · save as JSON file</div></div>
          <span>${downloadIcon()}</span>
        </div>
        <div class="settings-row" id="import-row">
          <div class="label-block"><div class="t">Import backup</div><div class="d">Restore from a JSON file</div></div>
          <span>${uploadIcon()}</span>
        </div>
        <div class="settings-row" id="clear-row">
          <div class="label-block"><div class="t" style="color:var(--red)">Delete all data</div><div class="d">Erase everything on this device</div></div>
          <span>${trashIcon()}</span>
        </div>
      </div>
      <input type="file" id="import-input" accept="application/json" style="display:none">
      <p style="font-size:12px;color:var(--text-dim);text-align:center;margin-top:22px;line-height:1.5;">
        All data is stored only on this device (browser local storage).<br>Nothing is uploaded anywhere. Export regularly to keep a backup.
      </p>
    `;

    $('#set-currency').onchange = (e) => { settings.currency = e.target.value; Store.saveSettings(settings); renderAll(); };
    $('#set-goal').onchange = (e) => { settings.goal = parseFloat(e.target.value) || 0; Store.saveSettings(settings); };
    $('#recurring-row').onclick = openRecurringSheet;
    $('#export-row').onclick = exportData;
    $('#import-row').onclick = () => $('#import-input').click();
    $('#import-input').onchange = importData;
    $('#clear-row').onclick = () => {
      if (confirm('Delete all transactions? This cannot be undone.')) {
        transactions = [];
        Store.save(transactions);
        renderAll();
        toast('All data deleted');
      }
    };
  }

  function exportData() {
    const payload = { exportedAt: new Date().toISOString(), settings, transactions, recurring };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `home-budget-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.transactions)) throw new Error('bad format');
        if (confirm(`Import ${data.transactions.length} transactions? This will replace your current data.`)) {
          transactions = data.transactions;
          if (data.settings) settings = Object.assign(settings, data.settings);
          if (Array.isArray(data.recurring)) recurring = data.recurring;
          Store.save(transactions);
          Store.saveSettings(settings);
          Store.saveRecurring(recurring);
          renderAll();
          toast('Backup restored');
        }
      } catch (err) {
        alert('Could not read this file. Make sure it is a Home Budget backup JSON.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  /* ================= RECURRING SHEET ================= */
  function openRecurringSheet() {
    renderRecurringList();
    openSheet($('#recurring-sheet'));
  }

  function renderRecurringList() {
    const rows = recurring.length
      ? recurring
          .map((r) => {
            const cat = CAT_BY_ID[r.category] || { name: r.category, emoji: '➕' };
            const next = nextOccurrence(r, r.lastRun);
            return `
              <div class="recur-row ${r.active ? '' : 'paused'}" data-id="${r.id}">
                <div class="recur-icon">${cat.emoji}</div>
                <div class="recur-mid">
                  <div class="recur-name">${cat.name}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
                  <div class="recur-sub">${freqLabel(r)} · next ${formatShortDate(next)}</div>
                </div>
                <div class="recur-right">
                  <div class="recur-amount ${r.type}">${r.type === 'income' ? '+' : '-'}${fmt(r.amount)}</div>
                  <div class="recur-actions">
                    <label class="switch">
                      <input type="checkbox" data-action="toggle-active" ${r.active ? 'checked' : ''}>
                      <span class="switch-track"></span>
                    </label>
                    <button class="task-del" data-action="delete-rule" aria-label="Delete recurring">${trashIconSmall()}</button>
                  </div>
                </div>
              </div>`;
          })
          .join('')
      : emptyState('🔁', 'No recurring expenses yet. Turn on "Repeat" when adding a transaction.');

    $('#recurring-list').innerHTML = rows;
    if (!recurring.length) return;

    $('#recurring-list').querySelectorAll('.recur-row').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('[data-action="toggle-active"]').onchange = (e) => {
        const rule = recurring.find((r) => r.id === id);
        rule.active = e.target.checked;
        Store.saveRecurring(recurring);
        renderRecurringList();
        renderHome();
      };
      el.querySelector('[data-action="delete-rule"]').onclick = () => {
        if (confirm('Stop this recurring expense? Past transactions stay in your history.')) {
          recurring = recurring.filter((r) => r.id !== id);
          Store.saveRecurring(recurring);
          renderRecurringList();
          renderHome();
          renderSettings();
        }
      };
    });
  }

  /* ================= FORM (sheet) ================= */
  function openForm(id) {
    state.editingId = id || null;
    const editing = id ? transactions.find((t) => t.id === id) : null;
    state.formType = editing ? editing.type : 'expense';
    state.formCat = editing ? editing.category : EXPENSE_CATEGORIES[0].id;

    $('#form-title').textContent = editing ? 'Edit Transaction' : 'Add Transaction';
    $('#f-amount').value = editing ? editing.amount : '';
    $('#f-date').value = editing ? editing.date : todayISO();
    $('#f-note').value = editing ? editing.note || '' : '';
    $('#delete-btn').style.display = editing ? 'block' : 'none';

    state.formRepeat = 'none';
    $('#repeat-field').style.display = editing ? 'none' : 'block';

    renderTypeToggle();
    renderCatGrid();
    renderRepeatToggle();
    openSheet($('#form-sheet'));
    setTimeout(() => $('#f-amount').focus(), 250);
  }

  function renderTypeToggle() {
    $('#type-toggle').innerHTML = `
      <button class="${state.formType === 'expense' ? 'active expense' : ''}" data-type="expense">Expense</button>
      <button class="${state.formType === 'income' ? 'active income' : ''}" data-type="income">Income</button>
    `;
    $('#type-toggle').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.formType = b.dataset.type;
        const cats = state.formType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        state.formCat = cats[0].id;
        renderTypeToggle();
        renderCatGrid();
      };
    });
  }

  function renderCatGrid() {
    const cats = state.formType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    $('#cat-grid').innerHTML = cats
      .map((c) => `
        <div class="cat-pick ${state.formCat === c.id ? 'active' : ''}" data-cat="${c.id}">
          <div class="em">${c.emoji}</div>
          <div class="nm">${c.name}</div>
        </div>`)
      .join('');
    $('#cat-grid').querySelectorAll('.cat-pick').forEach((el) => {
      el.onclick = () => { state.formCat = el.dataset.cat; renderCatGrid(); };
    });
  }

  function renderRepeatToggle() {
    $('#repeat-toggle').innerHTML = `
      <button class="${state.formRepeat === 'none' ? 'active' : ''}" data-repeat="none">None</button>
      <button class="${state.formRepeat === 'weekly' ? 'active' : ''}" data-repeat="weekly">Weekly</button>
      <button class="${state.formRepeat === 'monthly' ? 'active' : ''}" data-repeat="monthly">Monthly</button>
    `;
    $('#repeat-toggle').querySelectorAll('button').forEach((b) => {
      b.onclick = () => { state.formRepeat = b.dataset.repeat; renderRepeatToggle(); };
    });
  }

  function saveForm() {
    const amount = parseFloat($('#f-amount').value);
    if (!amount || amount <= 0) { toast('Enter a valid amount'); return; }
    const date = $('#f-date').value || todayISO();
    const note = $('#f-note').value.trim();

    if (state.editingId) {
      const t = transactions.find((x) => x.id === state.editingId);
      Object.assign(t, { amount, date, note, type: state.formType, category: state.formCat });
    } else {
      const newTx = {
        id: uid(),
        type: state.formType,
        amount,
        category: state.formCat,
        date,
        note,
        createdAt: Date.now(),
      };
      if (state.formRepeat !== 'none') {
        const ruleId = uid();
        recurring.push({
          id: ruleId,
          type: state.formType,
          amount,
          category: state.formCat,
          note,
          frequency: state.formRepeat,
          dayOfMonth: Number(date.split('-')[2]),
          weekday: new Date(date + 'T00:00:00').getDay(),
          startDate: date,
          active: true,
          lastRun: date,
        });
        Store.saveRecurring(recurring);
        newTx.recurringId = ruleId;
      }
      transactions.push(newTx);
    }
    Store.save(transactions);
    closeSheet();
    renderAll();
    toast(state.editingId ? 'Transaction updated' : (state.formRepeat !== 'none' ? 'Recurring transaction added' : 'Transaction added'));
  }

  function deleteCurrent() {
    if (!state.editingId) return;
    if (!confirm('Delete this transaction?')) return;
    transactions = transactions.filter((t) => t.id !== state.editingId);
    Store.save(transactions);
    closeSheet();
    renderAll();
    toast('Transaction deleted');
  }

  function openSheet(el) {
    $('#sheet-backdrop').classList.add('open');
    el.classList.add('open');
    state.openSheetEl = el;
  }
  function closeSheet() {
    $('#sheet-backdrop').classList.remove('open');
    if (state.openSheetEl) state.openSheetEl.classList.remove('open');
    state.openSheetEl = null;
    state.editingId = null;
  }

  /* ================= Toast ================= */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ================= Icons ================= */
  function chevronLeft() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'; }
  function chevronRight() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'; }
  function downloadIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>'; }
  function uploadIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>'; }
  function trashIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'; }
  function trashIconSmall() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'; }
  function repeatIconSmall() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'; }

  /* ================= Navigation ================= */
  function setView(v) {
    state.view = v;
    document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
    $('#' + v + '-view').classList.add('active');
    document.querySelectorAll('nav.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $('#fab-add').style.display = v === 'tasks' ? 'none' : 'flex';
    if (v === 'home') renderHome();
    if (v === 'tasks') renderTasks();
    if (v === 'history') renderHistory();
    if (v === 'settings') renderSettings();
  }

  function renderAll() {
    renderHome();
    renderTasks();
    renderHistory();
    renderSettings();
  }

  /* ================= Init ================= */
  function init() {
    document.querySelectorAll('nav.bottom-nav button[data-view]').forEach((b) => {
      b.onclick = () => setView(b.dataset.view);
    });
    $('#fab-add').onclick = () => openForm(null);
    $('#sheet-backdrop').onclick = closeSheet;
    $('#form-close').onclick = closeSheet;
    $('#save-btn').onclick = saveForm;
    $('#delete-btn').onclick = deleteCurrent;
    $('#recurring-close').onclick = closeSheet;

    const generated = runRecurringEngine();

    setView('home');
    if (generated > 0) toast(`${generated} recurring transaction${generated === 1 ? '' : 's'} added`);

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
