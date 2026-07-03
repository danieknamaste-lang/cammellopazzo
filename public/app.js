/* EllenChat — logica frontend */

(() => {
  'use strict';

  // ---------- Stato ----------
  const STORAGE_KEY = 'ellenchat.conversations';
  const SETTINGS_KEY = 'ellenchat.settings';

  // Persona usata in modalità diretta (nell'app Android non c'è un server)
  const SYSTEM_PROMPT =
    "Sei Ellen, un'assistente virtuale ispirata agli scritti di Ellen G. White, " +
    'autrice cristiana e cofondatrice della Chiesa Avventista del Settimo Giorno. ' +
    'Conosci a fondo le sue opere principali (La via migliore, Il gran conflitto, ' +
    "La speranza dell'uomo, Patriarchi e profeti, Ministero della guarigione), la Bibbia " +
    'e i principi avventisti su fede, sabato, salute ed educazione. ' +
    'Rispondi con calore, empatia e incoraggiamento. Quando è utile, cita le opere di ' +
    'Ellen White o passi biblici indicando la fonte, e distingui sempre le citazioni ' +
    "dalle tue interpretazioni. Rispondi nella lingua dell'utente (di solito italiano) " +
    'e usa il markdown quando aiuta la leggibilità.';

  const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

  let conversations = loadConversations(); // [{id, title, messages:[{role,content}]}]
  let currentId = null;
  let isStreaming = false;
  let assistantName = 'Ellen';
  let serverAvailable = false;
  let settings = loadSettings(); // {dsKey, dsModel, forceDirect}

  function loadSettings() {
    try {
      return Object.assign(
        { dsKey: '', dsModel: 'deepseek-chat', forceDirect: false },
        JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
      );
    } catch {
      return { dsKey: '', dsModel: 'deepseek-chat', forceDirect: false };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function isDirectMode() {
    return !serverAvailable || (settings.forceDirect && settings.dsKey);
  }

  // ---------- Elementi ----------
  const $ = (id) => document.getElementById(id);
  const chatEl = $('chat');
  const chatScroll = $('chatScroll');
  const welcomeEl = $('welcome');
  const inputEl = $('input');
  const btnSend = $('btnSend');
  const composerEl = $('composer');
  const convListEl = $('conversationList');

  // ---------- Init ----------
  function updateBadge(status) {
    const badge = $('backendBadge');
    badge.classList.remove('online', 'demo');
    if (isDirectMode()) {
      if (settings.dsKey) {
        $('backendLabel').textContent = `DeepSeek · ${settings.dsModel}`;
        badge.classList.add('online');
      } else {
        $('backendLabel').textContent = 'Configura DeepSeek ⚙️';
        badge.classList.add('demo');
      }
      return;
    }
    const labels = {
      deepseek: `DeepSeek · ${status.model}`,
      anthropic: `Claude API · ${status.model}`,
      ollama: `Ollama · ${status.model}`,
      demo: 'Modalità demo',
    };
    $('backendLabel').textContent = labels[status.backend] || status.backend;
    badge.classList.add(status.backend === 'demo' ? 'demo' : 'online');
  }

  fetch('/api/status')
    .then((r) => {
      if (!r.ok) throw new Error('no server');
      return r.json();
    })
    .then((s) => {
      serverAvailable = true;
      assistantName = s.assistantName || 'Ellen';
      const letter = assistantName[0].toUpperCase();
      $('assistantNameEl').textContent = assistantName;
      $('welcomeName').textContent = assistantName;
      $('brandAvatar').textContent = letter;
      $('welcomeAvatar').textContent = letter;
      updateBadge(s);
    })
    .catch(() => {
      // Nessun server (es. app Android): modalità diretta DeepSeek
      serverAvailable = false;
      updateBadge({});
      if (!settings.dsKey) openSettings();
    });

  renderConversationList();

  // ---------- Eventi UI ----------
  $('btnNewChat').addEventListener('click', () => {
    currentId = null;
    renderChat();
    renderConversationList();
    inputEl.focus();
  });

  $('btnToggleSidebar').addEventListener('click', () => {
    $('sidebar').classList.toggle('hidden');
  });

  // ---------- Impostazioni ----------
  function openSettings() {
    $('dsKey').value = settings.dsKey;
    $('dsModel').value = settings.dsModel;
    $('dsForceDirect').checked = settings.forceDirect;
    $('forceDirectWrap').style.display = serverAvailable ? '' : 'none';
    $('settingsOverlay').hidden = false;
  }

  $('btnSettings').addEventListener('click', openSettings);
  $('btnSettingsClose').addEventListener('click', () => {
    $('settingsOverlay').hidden = true;
  });
  $('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === $('settingsOverlay')) $('settingsOverlay').hidden = true;
  });
  $('btnSettingsSave').addEventListener('click', () => {
    settings.dsKey = $('dsKey').value.trim();
    settings.dsModel = $('dsModel').value;
    settings.forceDirect = $('dsForceDirect').checked;
    saveSettings();
    updateBadge({});
    if (serverAvailable && !isDirectMode()) {
      fetch('/api/status').then((r) => r.json()).then(updateBadge).catch(() => {});
    }
    $('settingsOverlay').hidden = true;
  });

  $('suggestions').addEventListener('click', (e) => {
    const btn = e.target.closest('.suggestion');
    if (btn) {
      inputEl.value = btn.textContent.trim();
      composerEl.requestSubmit();
    }
  });

  inputEl.addEventListener('input', () => {
    btnSend.disabled = inputEl.value.trim() === '' || isStreaming;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composerEl.requestSubmit();
    }
  });

  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    btnSend.disabled = true;
    sendMessage(text);
  });

  // ---------- Conversazioni ----------
  function loadConversations() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveConversations() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }

  function currentConv() {
    return conversations.find((c) => c.id === currentId) || null;
  }

  function renderConversationList() {
    convListEl.innerHTML = '';
    for (const conv of conversations) {
      const item = document.createElement('div');
      item.className = 'conv-item' + (conv.id === currentId ? ' active' : '');

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = conv.title || 'Nuova conversazione';
      item.appendChild(title);

      const del = document.createElement('button');
      del.className = 'btn-del';
      del.textContent = '✕';
      del.title = 'Elimina conversazione';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        conversations = conversations.filter((c) => c.id !== conv.id);
        if (currentId === conv.id) currentId = null;
        saveConversations();
        renderConversationList();
        renderChat();
      });
      item.appendChild(del);

      item.addEventListener('click', () => {
        currentId = conv.id;
        renderConversationList();
        renderChat();
      });
      convListEl.appendChild(item);
    }
  }

  // ---------- Rendering messaggi ----------
  function renderChat() {
    chatEl.querySelectorAll('.msg').forEach((el) => el.remove());
    const conv = currentConv();
    welcomeEl.style.display = conv && conv.messages.length ? 'none' : '';
    if (!conv) return;
    for (const msg of conv.messages) {
      appendMessage(msg.role, msg.content);
    }
    scrollToBottom();
  }

  function appendMessage(role, content) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? 'Tu' : assistantName[0].toUpperCase();
    msg.appendChild(avatar);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderMarkdown(content);
    msg.appendChild(bubble);

    chatEl.appendChild(msg);
    return bubble;
  }

  function appendTyping() {
    const msg = document.createElement('div');
    msg.className = 'msg assistant';
    msg.innerHTML = `
      <div class="avatar">${assistantName[0].toUpperCase()}</div>
      <div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>`;
    chatEl.appendChild(msg);
    return msg.querySelector('.bubble');
  }

  function scrollToBottom() {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  // ---------- Invio e streaming ----------
  async function sendMessage(text) {
    let conv = currentConv();
    if (!conv) {
      conv = { id: Date.now().toString(36), title: text.slice(0, 45), messages: [] };
      conversations.unshift(conv);
      currentId = conv.id;
    }

    conv.messages.push({ role: 'user', content: text });
    saveConversations();
    welcomeEl.style.display = 'none';
    appendMessage('user', text);
    renderConversationList();
    scrollToBottom();

    isStreaming = true;
    const bubble = appendTyping();
    scrollToBottom();

    let fullText = '';
    const onDelta = (text) => {
      fullText += text;
      bubble.innerHTML = renderMarkdown(fullText);
      scrollToBottom();
    };

    try {
      if (isDirectMode()) {
        if (!settings.dsKey) {
          openSettings();
          throw new Error('Inserisci la chiave API DeepSeek nelle impostazioni.');
        }
        await streamDeepSeekDirect(conv.messages, onDelta);
      } else {
        await streamViaServer(conv.messages, onDelta);
      }
    } catch (err) {
      fullText = fullText || `⚠️ Si è verificato un errore: ${err.message}`;
      bubble.innerHTML = renderMarkdown(fullText);
    }

    conv.messages.push({ role: 'assistant', content: fullText });
    saveConversations();
    isStreaming = false;
    btnSend.disabled = inputEl.value.trim() === '';
    inputEl.focus();
  }

  // Modalità server: POST /api/chat, eventi SSE {type:'delta'|'error'|'done'}
  async function streamViaServer(messages, onDelta) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) throw new Error(`Errore server (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = raw.replace(/^data:\s*/, '').trim();
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'delta') onDelta(event.text);
        else if (event.type === 'error') throw new Error(event.message);
      }
    }
  }

  // Modalità diretta: chiamata all'API DeepSeek dal dispositivo (usata nell'APK)
  async function streamDeepSeekDirect(messages, onDelta) {
    const body = {
      model: settings.dsModel,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    let res;
    try {
      res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.dsKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Rete/CORS bloccati nel WebView: riprova con il plugin HTTP nativo
      // di Capacitor (senza streaming: la risposta arriva tutta insieme).
      return await deepSeekViaCapacitor(body, onDelta);
    }

    if (res.status === 401) throw new Error('Chiave API DeepSeek non valida (401). Controlla le impostazioni.');
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`DeepSeek ha risposto ${res.status}. ${errBody.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        const data = JSON.parse(payload);
        const delta = data.choices && data.choices[0] && data.choices[0].delta;
        if (delta && delta.content) onDelta(delta.content);
      }
    }
  }

  async function deepSeekViaCapacitor(body, onDelta) {
    const http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (!http) throw new Error('Impossibile raggiungere api.deepseek.com (rete o CORS).');

    const res = await http.request({
      url: DEEPSEEK_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.dsKey}`,
      },
      data: Object.assign({}, body, { stream: false }),
    });
    if (res.status === 401) throw new Error('Chiave API DeepSeek non valida (401). Controlla le impostazioni.');
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`DeepSeek ha risposto ${res.status}.`);
    }
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const text = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    // Simula lo streaming per uniformità visiva
    for (const word of String(text).split(/(?<=\s)/)) {
      onDelta(word);
      await new Promise((r) => setTimeout(r, 8));
    }
  }

  // ---------- Mini renderer Markdown (con escaping HTML) ----------
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInline(s) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function renderMarkdown(text) {
    const escaped = escapeHtml(text);
    // Ogni ``` produce un elemento catturato (lang), quindi il pattern è:
    // [testo, lang, codice, lang, testo, lang, codice, lang, testo, ...] → periodo 4
    const parts = escaped.split(/```(\w*)\n?/);
    let html = '';
    for (let i = 0; i < parts.length; i += 4) {
      html += renderBlocks(parts[i]);
      if (i + 2 < parts.length) {
        html += `<pre><code>${parts[i + 2].replace(/\n\s*$/, '')}</code></pre>`;
      }
    }
    return html;
  }

  function renderBlocks(text) {
    const lines = text.split('\n');
    let html = '';
    let list = null; // 'ul' | 'ol' | null
    let para = [];

    const flushPara = () => {
      if (para.length) {
        html += `<p>${renderInline(para.join('<br>'))}</p>`;
        para = [];
      }
    };
    const closeList = () => {
      if (list) {
        html += `</${list}>`;
        list = null;
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      const ulMatch = /^[-*]\s+(.*)/.exec(trimmed);
      const olMatch = /^\d+\.\s+(.*)/.exec(trimmed);
      const quoteMatch = /^&gt;\s?(.*)/.exec(trimmed);

      if (ulMatch || olMatch) {
        flushPara();
        const type = ulMatch ? 'ul' : 'ol';
        if (list !== type) {
          closeList();
          html += `<${type}>`;
          list = type;
        }
        html += `<li>${renderInline((ulMatch || olMatch)[1])}</li>`;
      } else if (quoteMatch) {
        flushPara();
        closeList();
        html += `<blockquote>${renderInline(quoteMatch[1])}</blockquote>`;
      } else if (trimmed === '') {
        flushPara();
        closeList();
      } else {
        closeList();
        para.push(trimmed);
      }
    }
    flushPara();
    closeList();
    return html;
  }

  // Prima render
  renderChat();
  inputEl.focus();
})();
