/* Agente Opzioni — logica frontend (nessuna dipendenza) */

import * as standalone from './agent/standalone.js';

(() => {
  'use strict';

  // Con un server Node davanti si usano le API; nell'app Android (o aprendo i
  // file senza server) l'agente gira dentro la pagina e parla direttamente col
  // sistema multiagentico.
  let autonoma = false;

  const TOKEN_KEY = 'opzioni.appToken';
  const $ = (id) => document.getElementById(id);

  const state = {
    schema: null,
    config: null,
    query: null,
    stream: null,
    answerRaw: '',
    agents: [],
  };

  const EXAMPLES = [
    'Analizza un iron condor su NVDA a 30 giorni: che succede se la volatilità scende del 10%?',
    'Cerca put spread in credito su SPY con probabilità di profitto sopra il 70% e rischio definito',
    'Confronta covered call e cash secured put su AAPL a 45 giorni, max 2000 € di capitale',
    'Monitora la posizione aperta: straddle su TSLA, 12 giorni alla scadenza, in gain del 25%',
  ];

  // ---------------------------------------------------------------- API ----

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  /** Token passato nel link (comodo per aprire l'app dal telefono): lo salva e ripulisce l'URL. */
  function adoptTokenFromUrl() {
    const params = new URLSearchParams(location.search);
    const supplied = params.get('token');
    if (!supplied) return;
    localStorage.setItem(TOKEN_KEY, supplied);
    params.delete('token');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
  }

  async function api(path, options = {}) {
    if (autonoma) return standalone.handle(path, options);

    const headers = Object.assign({ 'content-type': 'application/json' }, options.headers || {});
    if (token()) headers['x-app-token'] = token();
    const res = await fetch(path, Object.assign({}, options, { headers }));
    if (res.status === 401) {
      openSettings('Serve il token di accesso a questa app.');
      throw new Error('Non autorizzato');
    }
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail.slice(0, 200) || `Errore ${res.status}`);
    }
    return res.json();
  }

  // ------------------------------------------------------------- Stato ----

  function setStatus(connector) {
    const dot = $('status-dot');
    const text = $('status-text');
    dot.className = 'dot';
    if (!connector) {
      text.textContent = 'sconosciuto';
      return;
    }
    if (connector.mode === 'mock') {
      dot.classList.add('warn');
      text.textContent = 'simulazione';
    } else if (connector.ok) {
      dot.classList.add('ok');
      text.textContent = `${connector.mode} · ${hostOf(connector.url)}`;
    } else {
      dot.classList.add('err');
      text.textContent = 'non raggiungibile';
    }
    $('status-pill').title = connector.detail || '';
  }

  /**
   * Copia negli appunti anche fuori da HTTPS: su http:// (es. http://umbrel.local)
   * navigator.clipboard non esiste, quindi si ripiega sul vecchio execCommand.
   */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // si prova il metodo legacy qui sotto
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  /** Segnala al server un errore mostrato all'utente, così entra nella diagnostica. */
  function reportError(where, message, detail) {
    const headers = { 'content-type': 'application/json' };
    if (token()) headers['x-app-token'] = token();
    fetch('/api/client-error', {
      method: 'POST',
      headers,
      body: JSON.stringify({ where, message: String(message), detail: detail ? String(detail) : undefined }),
    }).catch(() => {});
  }

  /** Avviso visibile in cima alla pagina: sul telefono la console non si guarda. */
  function showBanner(text, kind) {
    const banner = $('banner');
    if (!text) {
      banner.classList.add('hidden');
      return;
    }
    banner.textContent = text;
    banner.className = `banner${kind === 'error' ? ' error' : ''}`;
    if (kind === 'error') reportError('banner', text);
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return url || 'mini';
    }
  }

  // ------------------------------------------------------ Inizializzazione -

  async function init() {
    adoptTokenFromUrl();
    bindUi();
    renderExamples();
    try {
      await rilevaModalita();
      const data = await api('/api/config');
      state.schema = data.schema;
      state.config = data.config;
      setStatus(data.connector);
      buildForm();
      state.query = readForm();
      renderBuilderJson();
      if (data.storage && data.storage.reason) showBanner(data.storage.reason, data.storage.ok ? 'warn' : 'error');
      else if (data.connector && !data.connector.ok) showBanner(data.connector.detail, 'error');
    } catch (err) {
      setStatus(null);
      showBanner(`Impossibile contattare il server dell'app: ${err.message}`, 'error');
      console.error(err);
    }
    loadHistory();
    loadPresets();
  }

  /** C'è un server dell'app dietro questa pagina, o dobbiamo fare tutto qui? */
  async function rilevaModalita() {
    if (window.OPZIONI_STANDALONE === true || location.protocol === 'file:') {
      autonoma = true;
    } else {
      try {
        const res = await fetch('/api/config', {
          method: 'HEAD',
          signal: AbortSignal.timeout(3000),
          headers: token() ? { 'x-app-token': token() } : {},
        });
        // 404/405 significa comunque che qualcosa risponde: contano gli errori di rete
        autonoma = res.status >= 500;
      } catch {
        autonoma = true;
      }
    }
    if (autonoma) $('brand-sub').textContent = 'collegamento diretto al mac';
  }

  function renderExamples() {
    const box = $('examples');
    box.innerHTML = '';
    for (const example of EXAMPLES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = example.length > 62 ? `${example.slice(0, 60)}…` : example;
      chip.title = example;
      chip.addEventListener('click', () => {
        $('ask-input').value = example;
        $('ask-input').focus();
      });
      box.appendChild(chip);
    }
  }

  function fillSelect(select, items, selected) {
    select.innerHTML = '';
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      if (item.id === selected) option.selected = true;
      select.appendChild(option);
    }
  }

  function fillChips(container, items, selected) {
    container.innerHTML = '';
    for (const item of items) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (selected.includes(item.id) ? ' on' : '');
      chip.dataset.id = item.id;
      chip.textContent = item.label;
      chip.addEventListener('click', () => {
        chip.classList.toggle('on');
        onFormChange();
      });
      container.appendChild(chip);
    }
  }

  function buildForm() {
    const s = state.schema;
    fillSelect($('f-objective'), s.objectives, 'analyze');
    fillSelect($('f-strategy'), s.strategies, 'custom');
    fillChips($('metrics'), s.metrics, s.defaults.metrics || []);
    fillChips($('agents'), s.agents, []);
  }

  // ----------------------------------------------------------- Builder ----

  function legRow(leg = {}) {
    const row = document.createElement('div');
    row.className = 'leg-row';
    row.innerHTML = `
      <select class="leg-side">
        <option value="buy">compra</option>
        <option value="sell">vendi</option>
      </select>
      <select class="leg-type">
        <option value="call">call</option>
        <option value="put">put</option>
        <option value="stock">sottostante</option>
      </select>
      <input class="leg-strike" type="number" step="0.5" placeholder="strike" />
      <input class="leg-qty" type="number" min="1" value="1" placeholder="q.tà" />
      <button class="remove" type="button" aria-label="Rimuovi">×</button>`;
    row.querySelector('.leg-side').value = leg.side || 'buy';
    row.querySelector('.leg-type').value = leg.type || 'call';
    if (leg.strike !== undefined && leg.strike !== null) row.querySelector('.leg-strike').value = leg.strike;
    row.querySelector('.leg-qty').value = leg.qty || 1;
    row.querySelector('.remove').addEventListener('click', () => {
      row.remove();
      onFormChange();
    });
    row.addEventListener('input', onFormChange);
    row.addEventListener('change', onFormChange);
    return row;
  }

  function scenarioRow(scenario = {}) {
    const row = document.createElement('div');
    row.className = 'scenario-row';
    row.innerHTML = `
      <input class="sc-spot" type="number" step="1" placeholder="spot %" />
      <input class="sc-iv" type="number" step="1" placeholder="IV %" />
      <input class="sc-days" type="number" min="0" placeholder="+giorni" />
      <input class="sc-label" type="text" placeholder="etichetta" />
      <button class="remove" type="button" aria-label="Rimuovi">×</button>`;
    if (scenario.spot_change_pct != null) row.querySelector('.sc-spot').value = scenario.spot_change_pct;
    if (scenario.iv_change_pct != null) row.querySelector('.sc-iv').value = scenario.iv_change_pct;
    if (scenario.days_forward != null) row.querySelector('.sc-days').value = scenario.days_forward;
    if (scenario.label) row.querySelector('.sc-label').value = scenario.label;
    row.querySelector('.remove').addEventListener('click', () => {
      row.remove();
      onFormChange();
    });
    row.addEventListener('input', onFormChange);
    return row;
  }

  function numberOrNull(el) {
    const value = el.value.trim();
    if (value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function readForm() {
    const chipsOn = (id) => [...$(id).querySelectorAll('.chip.on')].map((c) => c.dataset.id || c.dataset.flag);

    const legs = [...$('legs').children].map((row) => ({
      side: row.querySelector('.leg-side').value,
      type: row.querySelector('.leg-type').value,
      strike: numberOrNull(row.querySelector('.leg-strike')),
      qty: numberOrNull(row.querySelector('.leg-qty')) || 1,
    }));

    const scenarios = [...$('scenarios').children].map((row) => ({
      spot_change_pct: numberOrNull(row.querySelector('.sc-spot')),
      iv_change_pct: numberOrNull(row.querySelector('.sc-iv')),
      days_forward: numberOrNull(row.querySelector('.sc-days')),
      label: row.querySelector('.sc-label').value.trim() || null,
    }));

    const constraints = {};
    const maxRisk = numberOrNull($('c-max-risk'));
    if (maxRisk !== null) constraints.max_risk = maxRisk;
    const minCredit = numberOrNull($('c-min-credit'));
    if (minCredit !== null) constraints.min_credit = minCredit;
    const minPop = numberOrNull($('c-min-pop'));
    if (minPop !== null) constraints.min_pop = minPop;
    const targetDelta = numberOrNull($('c-target-delta'));
    if (targetDelta !== null) constraints.target_delta = targetDelta;
    const oi = numberOrNull($('c-oi'));
    if (oi !== null) constraints.min_open_interest = oi;
    constraints.currency = $('c-currency').value;
    for (const flag of chipsOn('flags')) constraints[flag] = true;

    return {
      objective: $('f-objective').value,
      strategy: $('f-strategy').value,
      underlyings: $('f-underlyings').value.split(/[,\s]+/).filter(Boolean),
      legs,
      horizon: { dte: numberOrNull($('f-dte')), expiry: $('f-expiry').value || null },
      scenarios,
      metrics: chipsOn('metrics'),
      agents: chipsOn('agents'),
      constraints,
      risk_profile: $('f-risk').value,
      notes: $('f-notes').value.trim(),
      prompt: state.query ? state.query.prompt || '' : '',
    };
  }

  function writeForm(query) {
    $('f-objective').value = query.objective || 'analyze';
    $('f-strategy').value = query.strategy || 'custom';
    $('f-underlyings').value = (query.underlyings || []).join(', ');
    $('f-dte').value = query.horizon && query.horizon.dte != null ? query.horizon.dte : '';
    $('f-expiry').value = (query.horizon && query.horizon.expiry) || '';
    $('f-risk').value = query.risk_profile || 'moderato';
    $('f-notes').value = query.notes || '';

    const constraints = query.constraints || {};
    $('c-max-risk').value = constraints.max_risk ?? '';
    $('c-min-credit').value = constraints.min_credit ?? '';
    $('c-min-pop').value = constraints.min_pop ?? '';
    $('c-target-delta').value = constraints.target_delta ?? '';
    $('c-oi').value = constraints.min_open_interest ?? '';
    $('c-currency').value = constraints.currency || 'EUR';
    for (const chip of $('flags').querySelectorAll('.chip')) {
      chip.classList.toggle('on', Boolean(constraints[chip.dataset.flag]));
    }

    for (const chip of $('metrics').querySelectorAll('.chip')) {
      chip.classList.toggle('on', (query.metrics || []).includes(chip.dataset.id));
    }
    for (const chip of $('agents').querySelectorAll('.chip')) {
      chip.classList.toggle('on', (query.agents || []).includes(chip.dataset.id));
    }

    $('legs').innerHTML = '';
    for (const leg of query.legs || []) $('legs').appendChild(legRow(leg));
    $('scenarios').innerHTML = '';
    for (const scenario of query.scenarios || []) $('scenarios').appendChild(scenarioRow(scenario));

    state.query = query;
    renderBuilderJson();
  }

  function onFormChange() {
    const prompt = state.query ? state.query.prompt : '';
    state.query = readForm();
    state.query.prompt = prompt || '';
    renderBuilderJson();
  }

  function renderBuilderJson() {
    $('builder-json').textContent = JSON.stringify(state.query, null, 2);
  }

  // --------------------------------------------------------- Risposta -----

  function escapeHtml(text) {
    return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  /** Rendering leggero: blocchi di codice, grassetto, `codice`, righe [agente]. */
  function renderAnswer(raw) {
    const parts = raw.replace(/^\s+/, '').split(/```/);
    let html = '';
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        html += `<span class="block">${escapeHtml(part.replace(/^\w*\n/, ''))}</span>`;
        return;
      }
      let text = escapeHtml(part);
      text = text.replace(/^\[([a-z0-9_\- ]{2,30})\]$/gim, '<span class="agent-line">[$1]</span>');
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
      html += text;
    });
    return html;
  }

  let renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      const box = $('answer');
      box.innerHTML = renderAnswer(state.answerRaw);
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 220;
      if (nearBottom) window.scrollTo({ top: document.body.scrollHeight });
    });
  }

  function showQueryCard(event) {
    $('query-card').classList.remove('hidden');
    $('query-summary').textContent = event.summary || '';
    $('query-source').textContent =
      event.source === 'llm' ? `pianificata · ${event.provider || 'llm'}` : event.source === 'manual' ? 'builder' : 'regole';
    $('query-json').textContent = JSON.stringify(event.query, null, 2);
    $('query-prompt').textContent = event.prompt || '';
    const note = $('query-note');
    if (event.note) {
      note.textContent = event.note;
      note.classList.remove('hidden');
    } else {
      note.classList.add('hidden');
    }
    state.query = event.query;
  }

  function addAgentTag(name) {
    if (state.agents.includes(name)) return;
    state.agents.push(name);
    const tag = document.createElement('span');
    tag.className = 'agent-tag';
    tag.textContent = name;
    $('agent-track').appendChild(tag);
  }

  // ------------------------------------------------------------ Invio -----

  async function send({ text, query, refine }) {
    if (state.stream) state.stream.abort();
    const controller = new AbortController();
    state.stream = controller;

    switchTab('ask');
    state.answerRaw = '';
    state.agents = [];
    $('agent-track').innerHTML = '';
    $('answer').innerHTML = '';
    $('answer').classList.add('cursor');
    $('output-card').classList.remove('hidden');
    $('output-meta').textContent = 'in corso…';
    $('send-btn').disabled = true;

    const headers = { 'content-type': 'application/json' };
    if (token()) headers['x-app-token'] = token();

    try {
      if (autonoma) {
        await standalone.run({ text, query }, handleEvent, controller.signal);
        return;
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({ text, query, refine: Boolean(refine) }),
      });
      if (!res.ok || !res.body) throw new Error(`Errore ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            handleEvent(JSON.parse(line.slice(5).trim()));
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        reportError('invio', err.message);
        state.answerRaw += `\n\n⚠️ ${err.message}`;
        scheduleRender();
      }
    } finally {
      $('answer').classList.remove('cursor');
      $('send-btn').disabled = false;
      state.stream = null;
    }
  }

  function handleEvent(event) {
    if (event.type === 'status') {
      $('output-meta').textContent = event.text;
    } else if (event.type === 'query') {
      showQueryCard(event);
    } else if (event.type === 'followup') {
      state.answerRaw += `\n\n— approfondimento: ${event.reason} (${event.summary}) —\n`;
      scheduleRender();
    } else if (event.type === 'agent') {
      addAgentTag(event.name);
    } else if (event.type === 'token') {
      state.answerRaw += event.text;
      scheduleRender();
    } else if (event.type === 'done') {
      $('output-meta').textContent = `${(event.elapsed_ms / 1000).toFixed(1)}s · ${event.steps} passaggio/i`;
      loadHistory();
    } else if (event.type === 'error') {
      reportError('stream', event.message);
      state.answerRaw += `\n\n⚠️ ${event.message}`;
      scheduleRender();
      $('output-meta').textContent = 'errore';
    }
  }

  // ---------------------------------------------------- Storico/preset ----

  async function loadHistory() {
    try {
      const data = await api('/api/history');
      const box = $('history');
      box.innerHTML = '';
      if (!data.items.length) {
        box.innerHTML = '<p class="hint">Nessuna query ancora inviata.</p>';
        return;
      }
      for (const item of data.items) {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
          <span class="title">${escapeHtml(item.summary || 'query')}</span>
          <span class="sub">${new Date(item.created_at).toLocaleString('it-IT')} · ${item.mode || '—'}</span>
          <span class="sub">${escapeHtml(item.preview || '')}</span>`;
        el.addEventListener('click', () => openHistory(item.id));
        box.appendChild(el);
      }
    } catch (err) {
      showBanner(`Storico non disponibile: ${err.message}`, 'error');
    }
  }

  async function openHistory(id) {
    const item = await api(`/api/history/${id}`);
    switchTab('ask');
    showQueryCard({
      query: item.query,
      summary: item.summary,
      source: 'storico',
      prompt: '',
      note: `Eseguita il ${new Date(item.created_at).toLocaleString('it-IT')}`,
    });
    state.answerRaw = item.answer || '';
    state.agents = [];
    $('agent-track').innerHTML = '';
    $('output-card').classList.remove('hidden');
    $('output-meta').textContent = `${item.steps || 1} passaggio/i · ${item.mode || '—'}`;
    scheduleRender();
    writeForm(item.query);
  }

  async function loadPresets() {
    try {
      const data = await api('/api/presets');
      const box = $('presets');
      box.innerHTML = '';
      if (!data.items.length) {
        box.innerHTML = '<p class="hint">Nessun preset. Salvane uno dal builder.</p>';
        return;
      }
      for (const item of data.items) {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `<span class="title">${escapeHtml(item.name)}</span>`;
        const actions = document.createElement('div');
        actions.className = 'actions';
        const use = document.createElement('button');
        use.className = 'link';
        use.textContent = 'carica';
        use.addEventListener('click', (e) => {
          e.stopPropagation();
          writeForm(item.query);
        });
        const del = document.createElement('button');
        del.className = 'link';
        del.textContent = 'elimina';
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api(`/api/presets/${item.id}`, { method: 'DELETE' });
          loadPresets();
        });
        actions.append(use, del);
        el.appendChild(actions);
        box.appendChild(el);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // -------------------------------------------------------- Impostazioni --

  function openSettings(message) {
    const config = state.config || { multiagent: {}, planner: {} };
    $('s-url').value = config.multiagent.url || '';
    $('s-mode').value = config.multiagent.mode || 'auto';
    $('s-path').value = config.multiagent.path || '';
    $('s-model').value = config.multiagent.model || '';
    $('s-token').value = '';
    $('s-apptoken').value = token();
    $('settings-status').textContent = message || '';
    $('settings').showModal();
  }

  async function saveSettings() {
    localStorage.setItem(TOKEN_KEY, $('s-apptoken').value.trim());
    const payload = {
      multiagent: {
        url: $('s-url').value.trim(),
        mode: $('s-mode').value,
        path: $('s-path').value.trim(),
        model: $('s-model').value.trim(),
      },
    };
    if ($('s-token').value) payload.multiagent.token = $('s-token').value;
    try {
      const data = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
      state.config = data.config;
      setStatus(data.connector);
      $('settings-status').textContent = data.connector.ok
        ? `Collegato: ${data.connector.detail}`
        : `Attenzione: ${data.connector.detail}`;
    } catch (err) {
      $('settings-status').textContent = err.message;
    }
  }

  async function copyDiagnostics() {
    const hint = $('diagnostics-hint');
    hint.textContent = 'raccolgo…';
    try {
      const report = await api('/api/diagnostics');
      const text = JSON.stringify(report, null, 2);
      $('diagnostics').textContent = text;
      $('diagnostics').classList.remove('hidden');
      const copied = await copyText(text);
      hint.textContent = copied
        ? 'copiata negli appunti: incollala in chat'
        : 'appunti non disponibili: copia a mano il testo qui sotto';
    } catch (err) {
      hint.textContent = `diagnostica non disponibile: ${err.message}`;
    }
  }

  async function testConnection() {
    $('settings-status').textContent = 'provo…';
    try {
      const connector = await api('/api/status?refresh=1');
      setStatus(connector);
      showBanner(connector.ok ? '' : connector.detail, 'error');
      $('settings-status').textContent = `${connector.ok ? 'OK' : 'KO'} · ${connector.detail} (${connector.latencyMs}ms)`;
    } catch (err) {
      $('settings-status').textContent = err.message;
    }
  }

  // -------------------------------------------------------------- UI -----

  function switchTab(name) {
    for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.tab === name);
    for (const panel of document.querySelectorAll('.panel')) {
      panel.classList.toggle('active', panel.id === `panel-${name}`);
    }
  }

  function bindUi() {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    }

    $('plan-btn').addEventListener('click', async () => {
      const text = $('ask-input').value.trim();
      if (!text) return;
      $('plan-btn').disabled = true;
      try {
        const result = await api('/api/plan', { method: 'POST', body: JSON.stringify({ text }) });
        showQueryCard(Object.assign({ source: result.source }, result));
        writeForm(result.query);
        switchTab('ask');
      } catch (err) {
        alert(err.message);
      } finally {
        $('plan-btn').disabled = false;
      }
    });

    $('send-btn').addEventListener('click', () => {
      const text = $('ask-input').value.trim();
      if (!text) return;
      send({ text, refine: $('refine-toggle').checked });
    });

    $('ask-input').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('send-btn').click();
    });

    $('stop-btn').addEventListener('click', () => {
      if (state.stream) state.stream.abort();
    });

    $('copy-btn').addEventListener('click', async () => {
      const ok = await copyText(state.answerRaw);
      $('copy-btn').textContent = ok ? 'Copiato' : 'Copia non riuscita';
      setTimeout(() => ($('copy-btn').textContent = 'Copia'), 1800);
    });
    $('toggle-json').addEventListener('click', () => $('query-json').classList.toggle('hidden'));
    $('show-prompt').addEventListener('click', () => $('query-prompt').classList.toggle('hidden'));
    $('edit-in-builder').addEventListener('click', () => {
      if (state.query) writeForm(state.query);
      switchTab('builder');
    });

    $('add-leg').addEventListener('click', () => {
      $('legs').appendChild(legRow());
      onFormChange();
    });
    $('add-scenario').addEventListener('click', () => {
      $('scenarios').appendChild(scenarioRow());
      onFormChange();
    });

    for (const id of ['f-objective', 'f-strategy', 'f-underlyings', 'f-dte', 'f-expiry', 'f-risk', 'f-notes',
      'c-max-risk', 'c-min-credit', 'c-min-pop', 'c-target-delta', 'c-oi', 'c-currency']) {
      $(id).addEventListener('input', onFormChange);
      $(id).addEventListener('change', onFormChange);
    }
    for (const chip of $('flags').querySelectorAll('.chip')) {
      chip.addEventListener('click', () => {
        chip.classList.toggle('on');
        onFormChange();
      });
    }

    $('builder-send').addEventListener('click', () => send({ query: readForm(), refine: $('refine-toggle').checked }));
    $('builder-copy').addEventListener('click', async () => {
      const ok = await copyText(JSON.stringify(readForm(), null, 2));
      $('builder-copy').textContent = ok ? 'Copiato' : 'Copia non riuscita';
      setTimeout(() => ($('builder-copy').textContent = 'Copia JSON'), 1800);
    });
    $('builder-preset').addEventListener('click', async () => {
      const name = prompt('Nome del preset');
      if (!name) return;
      await api('/api/presets', { method: 'POST', body: JSON.stringify({ name, query: readForm() }) });
      loadPresets();
    });

    $('refresh-history').addEventListener('click', loadHistory);
    $('open-settings').addEventListener('click', () => openSettings());
    $('status-pill').addEventListener('click', testConnection);
    $('save-settings').addEventListener('click', saveSettings);
    $('test-conn').addEventListener('click', testConnection);
    $('copy-diagnostics').addEventListener('click', copyDiagnostics);
  }

  init();
})();
