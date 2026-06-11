/* 
 * DFJK Leaderboard Chrome extension script
 * Scores are saved to Supabase (RLS configured)
 */
console.log('[DFJK-LB] content script running');
(function () {
  'use strict';

  // CONFIG
  const SUPABASE_URL      = 'https://ypteejjhqhlluwfzqcwq.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_FIFsXjeKSRN1Y3YXzAoxYg_n7TwPvsN';
  const MAX_ENTRIES       = 3;                            // number of scores to show
  const GLOBAL_ENTRIES    = 5;                            // number of top users
  const CHART_PANEL_SIDE   = 'right';
  const GLOBAL_PANEL_SIDE = 'left';                             

  // BACKEND
  const REST = `${SUPABASE_URL}/rest/v1/scores`;
  const HEADERS = {
    apikey: SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
 
  async function fetchTop(chartId) {
    try {
      const url = `${REST}?chart_id=eq.${chartId}` +
        `&select=username,time_ms,accuracy,cps&order=time_ms.asc&limit=${MAX_ENTRIES}`;
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
    return { chartId, time_ms: Math.round(timeS * 1000), accuracy: acc, cps };
  }
 
  // read active chart number
  function getCurrentChartId() {
    let t = '';
    for (const n of document.body.children) {
      if (n.id === 'dfjk-lb-side' || n.id === 'dfjk-lb-global') continue;
      t += (n.innerText || '') + '\n';
    }
    const m = t.match(/Chart\s*#?\s*(\d+)/) || t.match(/DFJK\s*#?\s*(\d+)/);
    return m ? +m[1] : null;
  }
  // UI
  const fmt = ms => (ms / 1000).toFixed(2) + 's';
 
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
 
  // chart leaderboard panel
  let sidePanel = null;
  function ensureSidePanel() {
    if (sidePanel && document.body.contains(sidePanel)) return sidePanel;
    sidePanel = document.createElement('div');
    sidePanel.id = 'dfjk-lb-side';
    sidePanel.style.cssText =
      'position:fixed;top:100px;' +
      (CHART_PANEL_SIDE === 'right' ? 'right:16px;' : 'left:16px;') +
      'width:230px;max-height:80vh;overflow:auto;z-index:99999;pointer-events:none;' +
      'font-family:inherit;font-size:20px;color:#333;text-align:left;line-height:1.3;padding-left:24px;';
    document.body.appendChild(sidePanel);
    return sidePanel;
  }
 
  function renderSidePanel(chartId, rows, highlightTimeMs) {
    const p = ensureSidePanel();
    p.style.display = '';
    p.innerHTML = '';
 
    const title = document.createElement('div');
    title.textContent = `Leaderboard · #${chartId} `; //
    title.style.cssText = 'font-weight:700;margin-bottom:10px;text-align:left;';
    p.appendChild(title);
 
    if (!rows || !rows.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No scores yet.';
      empty.style.cssText = 'text-align:left;color:#999;padding:6px 0;';
      p.appendChild(empty);
      return;
    }
 
    rows.forEach((row, i) => {
      const hot = highlightTimeMs && row.time_ms === highlightTimeMs;
      const acc = Number.isFinite(row.accuracy) ? row.accuracy.toFixed(0) + '%' : '—';
      const cps = Number.isFinite(row.cps) ? row.cps.toFixed(1) : '—';
 
      const item = document.createElement('div');
      item.style.cssText = 'padding:3px 0;' + (hot ? 'background:#fde68a;' : '');
 
      const main = document.createElement('div');
      main.style.cssText = 'display:flex;gap:8px;align-items:baseline;' + (hot ? 'font-weight:700;' : '');
      main.innerHTML =
        `<span style="color:#999;width:18px;flex:none">${i + 1}.</span>` +
        `<span style="flex:0 1 auto;min-width:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">` +
        `${escapeHtml(row.username)}</span>` +
        `<span>${fmt(row.time_ms)}</span>`;
 
      const sub = document.createElement('div');
      sub.style.cssText = 'color:#999;font-size:18px;margin-left:26px;';
      sub.textContent = `${acc} · ${cps} cps`;
 
      item.appendChild(main);
      item.appendChild(sub);
      p.appendChild(item);
    });
  }
 
  // username + save button on completion screen
  function injectSaveUI(card, run, qualifies) {
    card.querySelector('.dfjk-lb-save')?.remove();
    if (!qualifies) return;
 
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
    btn.textContent = 'Save score';
    btn.style.cssText =
      'padding:6px 14px;border:none;border-radius:8px;background:#fbbf24;' +
      'font:inherit;font-weight:700;cursor:pointer;font-size:20px;';
 
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:8px;font-weight:700;font-size:20px'; //color:#16a34a;
 
    const send = async () => {
      const username = input.value.trim();
      if (!username) { input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      localStorage.setItem('dfjk_lb_username', username);
      const ok = await submitScore({
        chart_id: run.chartId, username,
        time_ms: run.time_ms, accuracy: run.accuracy, cps: run.cps,
      });
      row.remove();
      if (ok) {
        sidePanelChartId = run.chartId;
        sidePanelRows = await fetchTop(run.chartId);
        renderSidePanel(run.chartId, sidePanelRows, run.time_ms);
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
 
  // make chart leaderboard persist
  let sidePanelChartId = null;
  let sidePanelRows = [];
  async function refreshSidePanel() {
    const id = getCurrentChartId();
    if (!id) {
      if (sidePanel) sidePanel.style.display = 'none';
      sidePanelChartId = null;
      return;
    }
    const detached = !sidePanel || !document.body.contains(sidePanel);
    if (id !== sidePanelChartId) {
      sidePanelChartId = id;
      sidePanelRows = await fetchTop(id);
      renderSidePanel(id, sidePanelRows);
    } else if (detached) {
      renderSidePanel(id, sidePanelRows);
    } else {
      sidePanel.style.display = '';
    }
  }
  // add save button on result screen
  let lastResultKey = null;
  async function tickResult() {
    const card = findResultCard();
    if (!card) { lastResultKey = null; return; }
    const run = parseRun(card.textContent || '');
    if (!run) return;
    const key = `${run.chartId}:${run.time_ms}`;
    if (key === lastResultKey) return;
    lastResultKey = key;
 
    const board = await fetchTop(run.chartId);
    sidePanelRows = board;
    const qualifies = board.length < MAX_ENTRIES || run.time_ms < board[board.length - 1].time_ms;
    sidePanelChartId = run.chartId;
    renderSidePanel(run.chartId, board);
    injectSaveUI(card, run, qualifies);
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
    let gPanel = null;
    function ensureG() {
      if (gPanel && document.body.contains(gPanel)) return gPanel;
      gPanel = document.createElement('div');
      gPanel.style.cssText =
        'position:fixed;top:100px;' + 
        (GLOBAL_PANEL_SIDE === 'right' ? 'right:16px;' : 'left:28px;') + 
        'width:230px;max-height:80vh;overflow:auto;' +
        'z-index:99999;pointer-events:none;font-family:inherit;font-size:20px;color:#333;' +
        //'background:#fff;border-radius:14px;padding:8px 8px;' + // border:2px solid #1a1a1a;
        'text-align:left;line-height:1.3;padding-left:12px';
      document.body.appendChild(gPanel);
      return gPanel;
    }
    async function fetchG() {
      try {
        const url = `${REST}?select=username,time_ms,accuracy,cps,chart_id` +
          `&order=time_ms.asc&limit=${GLOBAL_ENTRIES}`;
        const r = await fetch(url, { headers: HEADERS });
        return r.ok ? await r.json() : [];
      } catch { return []; }
    }
    function renderG(rows) {
      const p = ensureG();
      p.innerHTML = '<div style="font-weight:700;margin-bottom:8px">Global Standings</div>';
      if (!rows.length) { p.innerHTML += '<div style="color:#999">No scores yet.</div>'; return; }
      rows.forEach((row, i) => {
        const acc = Number.isFinite(row.accuracy) ? row.accuracy.toFixed(0) + '%' : '—';
        const cps = Number.isFinite(row.cps) ? row.cps.toFixed(1) : '—';
        const item = document.createElement('div');
        item.style.cssText = 'padding:3px 0;';
        item.innerHTML =
          '<div style="display:flex;gap:6px;align-items:baseline">' +
            `<span style="color:#999;flex:none;width:18px">${i + 1}.</span>` +
            `<span style="flex:0 1 auto;min-width:0;max-width:110px;overflow:hidden;` +
            `text-overflow:ellipsis;white-space:nowrap">${escapeHtml(row.username)}</span>` +
            `<span style="flex:none;margin-left:2px">${fmt(row.time_ms)}</span>` +
          '</div>' +
          `<div style="color:#999;font-size:18px;margin-left:20px">${acc} · ${cps} cps · #${row.chart_id}</div>`;
        p.appendChild(item);
      });
    }
    async function refreshG() { renderG(await fetchG()); }
    refreshGlobalBoard = refreshG;
    refreshG();
    setInterval(refreshG, 20000);
  })();
})();