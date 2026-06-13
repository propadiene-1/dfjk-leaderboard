/*
 * DFJK Leaderboard Chrome extension script
 * Scores are saved to Supabase (RLS configured)
 */
(function () {
  'use strict';

  // only run once
  if (window.__dfjkLeaderboard) return;
  window.__dfjkLeaderboard = true;
  console.log('[DFJK-LB] content script running');

  // CONFIG
  const SUPABASE_URL      = 'https://ypteejjhqhlluwfzqcwq.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_FIFsXjeKSRN1Y3YXzAoxYg_n7TwPvsN';
  const MAX_ENTRIES       = 5;                            // number of scores to show
  const GLOBAL_ENTRIES    = 5;                            // number of top scores
  const RECENT_ENTRIES    = 12;                           // number of recent scores
  const REFRESH_MS        = 20000;                        // board refresh interval
  const LENGTH_OPTIONS    = [20, 50, 75, 100];            // key counts in the dropdowns
  const DEFAULT_LENGTH    = 50;                           // standings length shown first
  const CHART_PANEL_SIDE   = 'right';
  const GLOBAL_PANEL_SIDE = 'left';

  // BACKEND
  const REST = `${SUPABASE_URL}/rest/v1/scores`;
  const REST_BEST = `${SUPABASE_URL}/rest/v1/best_scores`;  // view: best row per player per length
  const HEADERS = {
    apikey: SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  async function fetchTop(chartId, length) {
    try {
      const L = length || DEFAULT_LENGTH;
      const url = `${REST}?chart_id=eq.${chartId}&length=eq.${L}` +
        `&select=username,time_ms,accuracy,cps&order=time_ms.asc&limit=${MAX_ENTRIES}`;
      const r = await fetch(url, { headers: HEADERS });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  }

  // best_scores already holds one row per player per length, so just take the fastest few
  async function fetchGlobal(length) {
    try {
      const url = `${REST_BEST}?select=username,time_ms,accuracy,cps,chart_id` +
        `&length=eq.${length}&order=time_ms.asc&limit=${GLOBAL_ENTRIES}`;
      const r = await fetch(url, { headers: HEADERS });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  }

  async function submitScore(row) {
    try {
      const r = await fetch(REST, {
        method: 'POST',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify(row),
      });
      return r.ok;
    } catch { return false; }
  }

  // local personal bests (disabled for now, browser only)
  // const PB_KEY = 'dfjk_lb_pb';
  // function getPB(chartId) {
  //   try { return (JSON.parse(localStorage.getItem(PB_KEY)) || {})[chartId] ?? null; }
  //   catch { return null; }
  // }
  // function setPB(chartId, timeMs) {
  //   let map = {};
  //   try { map = JSON.parse(localStorage.getItem(PB_KEY)) || {}; } catch {}
  //   map[chartId] = timeMs;
  //   localStorage.setItem(PB_KEY, JSON.stringify(map));
  // }

  // DOM DETECTION
  function findResultCard() {
    const isResult = el => {
      const t = (el && el.textContent) || '';
      return /DFJK #\d+/.test(t) && /CPS/.test(t);
    };
    const candidates = document.querySelectorAll('div, section, article');
    for (const el of candidates) {
      if (isResult(el)) {
        const tighter = [...el.querySelectorAll('div, section, article')].find(isResult);
        return tighter || el;
      }
    }
    return null;
  }

  function parseRun(text) {
    const chartId = +(text.match(/DFJK #(\d+)/) || [])[1];
    const timeS   = parseFloat((text.match(/(\d+\.\d+)\s*s/) || [])[1]);
    const acc     = parseFloat((text.match(/Accuracy:\s*([\d.]+)\s*%/) || [])[1]);
    const cps     = parseFloat((text.match(/([\d.]+)\s*CPS/) || [])[1]);
    if (!chartId || !Number.isFinite(timeS)) return null;
    // key count is shown as (N) in the chart label, e.g. "DFJK #123 (50)"
    let length = +(text.match(/\((\d+)\)/) || [])[1];
    if (!length && Number.isFinite(cps)) length = Math.round(cps * timeS); // cps*time == length
    return { chartId, time_ms: Math.round(timeS * 1000), accuracy: acc, cps, length: length || null };
  }

  // read active chart number
  function getCurrentChartId() {
    let t = '';
    for (const n of document.body.children) {
      if (n.id && n.id.startsWith('dfjk-lb')) continue;
      t += (n.innerText || '') + '\n';
    }
    const m = t.match(/Chart\s*#?\s*(\d+)/) || t.match(/DFJK\s*#?\s*(\d+)/);
    return m ? +m[1] : null;
  }
  // UI
  const fmt = ms => (ms / 1000).toFixed(2) + 's';
  // const myName = () => (localStorage.getItem('dfjk_lb_username') || '').toLowerCase();
  const rankSpan = rank =>
    `<span style="color:#999;width:18px;flex:none">${rank}.</span>`;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // custom "50 keys ▾" dropdown used by both boards (a native <select> popup can't be themed)
  function makeLengthDropdown(initial, onSelect, fmtLabel) {
    const fmtL = fmtLabel || (L => L + ' keys');  // closed-label text; menu always shows "N keys"
    const wrap = document.createElement('span');
    wrap.style.cssText = 'position:relative;display:inline-block';
    const text = document.createElement('span');
    text.textContent = fmtL(initial);
    const arrow = document.createElement('span');
    arrow.textContent = 'arrow_drop_down';
    arrow.style.cssText = 'font-family:var(--icon-font);font-size:24px;vertical-align:-5px;margin:0 -4px 0 -2px';
    const label = document.createElement('span');
    label.style.cssText = 'pointer-events:auto;cursor:pointer;white-space:nowrap';
    label.append(text, arrow);
    // options menu, themed like the game dialogs. position:fixed (placed on open) so it
    // isn't clipped by the panel's overflow when the board is short / empty
    const menu = document.createElement('div');
    menu.style.cssText =
      'position:fixed;display:none;z-index:1;' +
      'pointer-events:auto;font-weight:400;background-color:var(--bg);color:var(--fg);' +
      'border:2px solid var(--fg);border-radius:0.5rem;box-shadow:0 2px 6px rgba(0,0,0,0.25);' +
      'padding:4px 0;overflow:hidden';
    LENGTH_OPTIONS.forEach(L => {
      const opt = document.createElement('div');
      opt.textContent = L + ' keys';
      opt.style.cssText = 'padding:4px 16px;cursor:pointer;white-space:nowrap';
      opt.addEventListener('mouseenter', () => { opt.style.backgroundColor = 'var(--blue)'; });
      opt.addEventListener('mouseleave', () => { opt.style.backgroundColor = 'transparent'; });
      opt.addEventListener('click', () => {
        text.textContent = fmtL(L);
        menu.style.display = 'none';
        onSelect(L);
      });
      menu.appendChild(opt);
    });
    label.addEventListener('click', e => {
      e.stopPropagation();
      if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
      const r = label.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.display = '';
    });
    document.addEventListener('click', () => { menu.style.display = 'none'; });
    wrap.append(label, menu);
    return { wrap, setValue: L => { text.textContent = fmtL(L); } };
  }

  // new best banner (disabled for now)
  // let bestBanner = null;
  // function showNewBest() {
  //   hideNewBest();
  //   bestBanner = document.createElement('div');
  //   bestBanner.id = 'dfjk-lb-best';
  //   bestBanner.textContent = 'New best!';
  //   bestBanner.style.cssText =
  //     'position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:100000;' +
  //     'pointer-events:none;background:#fbbf24;color:#1a1a1a;font-family:inherit;' +
  //     'font-weight:700;font-size:24px;padding:10px 22px;border-radius:12px;' +
  //     'box-shadow:0 2px 8px rgba(0,0,0,.15);';
  //   document.body.appendChild(bestBanner);
  // }
  // function hideNewBest() {
  //   if (bestBanner) { bestBanner.remove(); bestBanner = null; }
  // }
  // document.addEventListener('click', hideNewBest, true);

  // chart leaderboard panel
  let sidePanel = null, sideTitleEl = null, sideRowsEl = null, sideDd = null;
  let chartLength = DEFAULT_LENGTH;
  function ensureSidePanel() {
    if (sidePanel && document.body.contains(sidePanel)) return sidePanel;
    sidePanel = document.createElement('div');
    sidePanel.id = 'dfjk-lb-side';
    sidePanel.style.cssText =
      'position:fixed;top:100px;' +
      (CHART_PANEL_SIDE === 'right' ? 'right:16px;' : 'left:16px;') +
      'width:300px;max-height:80vh;overflow:auto;pointer-events:none;' +
      'font-family:inherit;font-size:20px;color:#333;text-align:left;line-height:1.3;padding-left:24px;';

    // header: "Leaderboard · #123 (50 keys ▾)" on one row
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom:10px;font-weight:700';
    sideTitleEl = document.createElement('span');
    const open = document.createElement('span'); open.textContent = ' (';
    sideDd = makeLengthDropdown(chartLength, L => { chartLength = L; sidePanelLength = null; refreshSidePanel(); }, L => '' + L);
    const close = document.createElement('span'); close.textContent = ')';
    header.append(sideTitleEl, open, sideDd.wrap, close);
    sidePanel.appendChild(header);

    sideRowsEl = document.createElement('div');
    sidePanel.appendChild(sideRowsEl);

    // insert first so game dialogs paint on top
    document.body.insertBefore(sidePanel, document.body.firstChild);
    return sidePanel;
  }

  function makeEntry(rank, row, { hot = false, subText, subMargin }) {
    const item = document.createElement('div');
    item.style.cssText = 'padding:3px 0;' + (hot ? 'background:#fde68a;' : '');

    const main = document.createElement('div');
    main.style.cssText = 'display:flex;gap:8px;align-items:baseline;' +
      (hot ? 'font-weight:700;' : '');
    main.innerHTML =
      rankSpan(rank) +
      `<span style="flex:0 1 auto;min-width:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">` +
      `${escapeHtml(row.username)}</span>` +
      `<span>${fmt(row.time_ms)}</span>`;

    const sub = document.createElement('div');
    sub.style.cssText = `color:#999;font-size:18px;margin-left:${subMargin};`;
    sub.textContent = subText;

    item.appendChild(main);
    item.appendChild(sub);
    return item;
  }

  function renderSidePanel(chartId, rows, highlightTimeMs, length) {
    ensureSidePanel();
    sidePanel.style.display = '';
    sideTitleEl.textContent = `Leaderboard · #${chartId}`;
    if (length) sideDd.setValue(length);
    sideRowsEl.innerHTML = '';

    // const pb = getPB(chartId);
    // if (pb != null) {
    //   const pbLine = document.createElement('div');
    //   pbLine.textContent = `your best · ${fmt(pb)}`;
    //   pbLine.style.cssText = 'color:#999;font-size:18px;margin:0 0 8px;';
    //   sideRowsEl.appendChild(pbLine);
    // }

    if (!rows || !rows.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No scores yet.';
      empty.style.cssText = 'text-align:left;color:#999;padding:6px 0;';
      sideRowsEl.appendChild(empty);
      return;
    }

    const subFor = row => {
      const acc = Number.isFinite(row.accuracy) ? row.accuracy.toFixed(0) + '%' : '—';
      const cps = Number.isFinite(row.cps) ? row.cps.toFixed(1) : '—';
      return `${acc} · ${cps} cps`;
    };

    rows.slice(0, MAX_ENTRIES).forEach((row, i) => {
      sideRowsEl.appendChild(makeEntry(i + 1, row, {
        hot: highlightTimeMs && row.time_ms === highlightTimeMs,
        subText: subFor(row),
        subMargin: '26px',
      }));
    });

    // show your rank if below the cutoff (disabled for now)
    // const me = myName();
    // const meIdx = me ? rows.findIndex(r => r.username.toLowerCase() === me) : -1;
    // if (meIdx >= MAX_ENTRIES) {
    //   const gap = document.createElement('div');
    //   gap.textContent = '···';
    //   gap.style.cssText = 'color:#999;padding:2px 0;margin-left:2px;';
    //   sideRowsEl.appendChild(gap);
    //   sideRowsEl.appendChild(makeEntry(meIdx + 1, rows[meIdx], {
    //     hot: highlightTimeMs && rows[meIdx].time_ms === highlightTimeMs,
    //     subText: subFor(rows[meIdx]),
    //     subMargin: '26px',
    //   }));
    // }
  }

  // username + save button on completion screen
  function injectSaveUI(card, run) {
    card.querySelector('.dfjk-lb-save')?.remove();

    const wrap = document.createElement('div');
    wrap.className = 'dfjk-lb-save';
    wrap.style.cssText = 'margin-top:22px;text-align:center;font-family:inherit;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;';

    const input = document.createElement('input');
    input.maxLength = 20;
    input.placeholder = 'Enter username';
    input.value = localStorage.getItem('dfjk_lb_username') || '';
    input.style.cssText =
      'flex:0 1 180px;padding:6px 10px;border:1px solid #ccc;border-radius:8px;font:inherit;font-size:20px;';
    ['keydown', 'keyup', 'keypress'].forEach(evt =>
      input.addEventListener(evt, e => e.stopPropagation()));

    const btn = document.createElement('button');
    btn.className = 'dfjk-lb-save-btn';
    btn.textContent = 'Save score';
    btn.style.cssText =
      'padding:6px 14px;border:none;border-radius:8px;background:#fbbf24;' +
      'font:inherit;font-weight:700;cursor:pointer;font-size:20px;';

    const note = document.createElement('div');
    note.style.cssText = 'margin-top:8px;font-weight:700;font-size:20px';

    const send = async () => {
      const username = input.value.trim();
      if (!username) { input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      localStorage.setItem('dfjk_lb_username', username);
      const ok = await submitScore({
        chart_id: run.chartId, username,
        time_ms: run.time_ms, accuracy: run.accuracy, cps: run.cps, length: run.length,
      });
      row.remove();
      if (ok) {
        sidePanelChartId = run.chartId;
        sidePanelLength = run.length;
        sidePanelRows = await fetchTop(run.chartId, run.length);
        sidePanelFetchedAt = Date.now();
        renderSidePanel(run.chartId, sidePanelRows, run.time_ms, run.length);
        refreshGlobalBoard();
        note.textContent = 'Score Saved!';
      } else {
        note.style.color = '#dc2626';
        note.textContent = 'Could not save. Try again.';
      }
    };
    btn.addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

    row.appendChild(input);
    row.appendChild(btn);
    wrap.appendChild(row);
    wrap.appendChild(note);
    card.appendChild(wrap);
  }

  // press s to save
  document.addEventListener('keydown', e => {
    if (e.key !== 's' && e.key !== 'S') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const btn = document.querySelector('.dfjk-lb-save-btn');
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  });

  // make chart leaderboard persist
  let sidePanelChartId = null;
  let sidePanelLength = null;
  let sidePanelRows = [];
  let sidePanelFetchedAt = 0;
  async function refreshSidePanel() {
    const id = getCurrentChartId();
    if (!id) {
      if (sidePanel) sidePanel.style.display = 'none';
      sidePanelChartId = null;
      return;
    }
    const len = chartLength;
    const detached = !sidePanel || !document.body.contains(sidePanel);
    const stale = Date.now() - sidePanelFetchedAt > REFRESH_MS;
    if (id !== sidePanelChartId || len !== sidePanelLength || stale) {
      sidePanelChartId = id;
      sidePanelLength = len;
      sidePanelFetchedAt = Date.now();
      const rows = await fetchTop(id, len);
      if (sidePanelChartId !== id || sidePanelLength !== len) return; // changed while fetching
      sidePanelRows = rows;
      renderSidePanel(id, sidePanelRows, undefined, len);
    } else if (detached) {
      renderSidePanel(id, sidePanelRows, undefined, len);
    } else {
      sidePanel.style.display = '';
    }
  }
  // add save button on result screen
  let lastResultKey = null;
  async function tickResult() {
    const card = findResultCard();
    if (!card) { lastResultKey = null; /* hideNewBest(); */ return; }
    const run = parseRun(card.textContent || '');
    if (!run) return;
    const key = `${run.chartId}:${run.time_ms}`;
    if (key === lastResultKey) return;
    lastResultKey = key;

    // new best check (disabled for now)
    // const prevBest = getPB(run.chartId);
    // if (prevBest == null || run.time_ms < prevBest) {
    //   setPB(run.chartId, run.time_ms);
    //   if (prevBest != null) showNewBest();
    // }

    chartLength = run.length || DEFAULT_LENGTH;  // show the board for the length just played
    const board = await fetchTop(run.chartId, chartLength);
    sidePanelRows = board;
    sidePanelChartId = run.chartId;
    sidePanelLength = chartLength;
    sidePanelFetchedAt = Date.now();
    renderSidePanel(run.chartId, board, undefined, chartLength);
    injectSaveUI(card, run);
  }

  setInterval(refreshSidePanel, 500);
  refreshSidePanel();

  // result save box
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; tickResult(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  tickResult();

  let refreshGlobalBoard = () => {};

  // GLOBAL LEADERBOARD
  (function initGlobalBoard() {
    let gPanel = null, rowsEl = null;
    let selectedLength = DEFAULT_LENGTH;
    function ensureG() {
      if (gPanel && document.body.contains(gPanel)) return gPanel;
      gPanel = document.createElement('div');
      gPanel.id = 'dfjk-lb-global';
      gPanel.style.cssText =
        'position:fixed;top:100px;' +
        (GLOBAL_PANEL_SIDE === 'right' ? 'right:16px;' : 'left:28px;') +
        'width:300px;max-height:80vh;overflow:auto;' +
        'pointer-events:none;font-family:inherit;font-size:20px;color:#333;' +
        'text-align:left;line-height:1.3;padding-left:12px';

      // title + key-count dropdown, shown inline as "Global Standings (50 keys ▾)"
      const header = document.createElement('div');
      header.style.cssText = 'margin-bottom:8px;font-weight:700';
      const title = document.createElement('span');
      title.textContent = 'Global Standings (';
      const dd = makeLengthDropdown(selectedLength, L => { selectedLength = L; refreshG(); });
      const close = document.createElement('span');
      close.textContent = ')';
      header.append(title, dd.wrap, close);
      gPanel.appendChild(header);

      rowsEl = document.createElement('div');
      gPanel.appendChild(rowsEl);

      // insert first so game dialogs paint on top
      document.body.insertBefore(gPanel, document.body.firstChild);
      return gPanel;
    }
    function renderG(rows) {
      ensureG();
      rowsEl.innerHTML = '';
      if (!rows.length) { rowsEl.innerHTML = '<div style="color:#999">No scores yet.</div>'; return; }
      rows.forEach((row, i) => {
        const acc = Number.isFinite(row.accuracy) ? row.accuracy.toFixed(0) + '%' : '—';
        const cps = Number.isFinite(row.cps) ? row.cps.toFixed(1) : '—';
        const item = document.createElement('div');
        item.style.cssText = 'padding:3px 0;';
        item.innerHTML =
          '<div style="display:flex;gap:6px;align-items:baseline">' +
            rankSpan(i + 1) +
            `<span style="flex:0 1 auto;min-width:0;max-width:130px;overflow:hidden;` +
            `text-overflow:ellipsis;white-space:nowrap">${escapeHtml(row.username)}</span>` +
            `<span style="flex:none;margin-left:2px">${fmt(row.time_ms)}</span>` +
          '</div>' +
          `<div style="color:#999;font-size:18px;margin-left:20px">${acc} · ${cps} cps · #${row.chart_id}</div>`;
        rowsEl.appendChild(item);
      });
    }
    async function refreshG() { renderG(await fetchGlobal(selectedLength)); }
    refreshGlobalBoard = refreshG;
    refreshG();
    setInterval(refreshG, REFRESH_MS);
  })();

  // PLAYER LOOKUP
  (function initLookup() {
    const fmtDate = s => {
      const d = new Date(s);
      return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const statsOf = r => {
      const acc = Number.isFinite(r.accuracy) ? r.accuracy.toFixed(0) + '%' : '—';
      const cps = Number.isFinite(r.cps) ? r.cps.toFixed(1) : '—';
      return `#${r.chart_id} · ${acc} · ${cps} cps · ${fmtDate(r.created_at)}`;
    };

    // bar chart icon, sits left of the settings icon
    const btn = document.createElement('button');
    btn.id = 'dfjk-lb-lookup-btn';
    btn.className = 'status-bar-button';
    btn.tabIndex = -1;
    btn.textContent = 'bar_chart';
    btn.style.right = 'var(--status-height)';
    btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = '#0003'; });
    btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = 'transparent'; });
    document.body.appendChild(btn);

    // styled and centered like the settings dialog
    const panel = document.createElement('div');
    panel.id = 'dfjk-lb-lookup';
    panel.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'width:24rem;height:60vh;box-sizing:border-box;' +
      'background-color:var(--bg);color:var(--fg);border:2px solid var(--fg);' +
      'border-radius:0.5rem;padding:1.25rem 2rem 2rem;box-shadow:0 0 10px rgba(0,0,0,0.5);' +
      'font-family:inherit;font-size:1.25rem;text-align:left;line-height:1.4;' +
      'flex-direction:column;display:none;';
    document.body.appendChild(panel);

    const title = document.createElement('h1');
    title.textContent = 'Player Lookup';
    title.style.cssText =
      'font-size:2.5rem;margin:0 0 0.75rem;padding:0.25rem;text-align:center;user-select:none;';
    panel.appendChild(title);

    // search icon with an underline input
    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;';
    const searchIcon = document.createElement('span');
    searchIcon.textContent = 'search';
    searchIcon.style.cssText =
      'font-family:var(--icon-font);font-size:1.75rem;color:var(--mid);user-select:none;';
    const input = document.createElement('input');
    input.maxLength = 20;
    input.placeholder = 'search player...';
    input.style.cssText =
      'flex:1;min-width:0;padding:0.25rem 0;border:none;border-bottom:2px solid var(--mid);' +
      'background-color:transparent;color:var(--fg);font-family:inherit;font-size:1.25rem;outline:none;';
    input.addEventListener('focus', () => { input.style.borderBottomColor = 'var(--fg)'; });
    input.addEventListener('blur', () => { input.style.borderBottomColor = 'var(--mid)'; });
    ['keydown', 'keyup', 'keypress'].forEach(evt =>
      input.addEventListener(evt, e => e.stopPropagation()));
    searchRow.appendChild(searchIcon);
    searchRow.appendChild(input);
    panel.appendChild(searchRow);

    // only the results list scrolls, title and search bar stay put
    const results = document.createElement('div');
    results.style.cssText = 'overflow:auto;flex:1;min-height:0;';
    panel.appendChild(results);

    async function fetchRows(query) {
      try {
        const r = await fetch(`${REST}?${query}`, { headers: HEADERS });
        return r.ok ? await r.json() : [];
      } catch { return []; }
    }

    function render(header, rows, mainOf, ranked) {
      results.innerHTML = `<div style="font-weight:700;margin-bottom:6px">${header}</div>`;
      if (!rows.length) {
        results.innerHTML += '<div style="color:var(--mid)">No scores found.</div>';
        return;
      }
      rows.forEach((r, i) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:4px 0;';
        item.innerHTML = ranked
          ? '<div style="display:flex;gap:0.5rem;align-items:baseline">' +
              `<span style="color:var(--mid);flex:none;min-width:1.75rem">${i + 1}.</span>` +
              `<div>${mainOf(r)}</div>` +
            '</div>' +
            `<div style="color:var(--mid);font-size:1rem;margin-left:2.25rem">${statsOf(r)}</div>`
          : `<div>${mainOf(r)}</div>` +
            `<div style="color:var(--mid);font-size:1rem;margin-left:10px">${statsOf(r)}</div>`;
        results.appendChild(item);
      });
    }

    async function showRecent() {
      results.innerHTML = '<div style="color:var(--mid)">Loading…</div>';
      const rows = await fetchRows(
        'select=username,chart_id,time_ms,accuracy,cps,created_at' +
        `&order=created_at.desc&limit=${RECENT_ENTRIES}`);
      render('Recent scores', rows, r =>
        `${escapeHtml(r.username)} · ${fmt(r.time_ms)}`);
    }

    async function showUser(name) {
      results.innerHTML = '<div style="color:var(--mid)">Loading…</div>';
      const rows = await fetchRows(
        `username=ilike.${encodeURIComponent(name)}` +
        '&select=username,chart_id,time_ms,accuracy,cps,created_at' +
        '&order=time_ms.asc&limit=200');
      render(`${escapeHtml(name)} · ${rows.length} score${rows.length === 1 ? '' : 's'}`, rows, r =>
        `${escapeHtml(r.username)} · ${fmt(r.time_ms)}`, true);
    }

    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const name = input.value.trim();
      name ? showUser(name) : showRecent();
    });

    // load results before showing so everything appears at once
    let open = false;
    btn.addEventListener('click', async () => {
      open = !open;
      if (!open) { panel.style.display = 'none'; return; }
      const name = input.value.trim();
      await (name ? showUser(name) : showRecent());
      if (open) panel.style.display = 'flex';
    });
    // clicking outside the panel (or its button) closes it
    document.addEventListener('click', e => {
      if (!open || panel.contains(e.target) || btn.contains(e.target)) return;
      open = false;
      panel.style.display = 'none';
    });
  })();
})();
