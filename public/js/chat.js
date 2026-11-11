// chat.js — the "Ask Jarvis" chat panel.
//
// The production panel from site-monitor/dashboard/chat.js: same injected
// styles (unchanged), same button, panel, incident picker and actions. The one
// difference is where answers come from. Production posts the incident and the
// conversation to /api/chat, which asks the model. Here, replies are scripted
// per incident, with three suggested questions, and nothing leaves the browser.
// History lives in the demo's state, so Reset clears it.

(function () {
  const STYLE = `
    #jarvis-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #3d7fff, #7c5cff);
      border: none; cursor: pointer; box-shadow: 0 4px 20px rgba(61,127,255,0.4);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Sora', sans-serif; font-size: 22px; color: #fff;
      transition: transform 0.15s ease;
    }
    #jarvis-chat-btn:hover { transform: scale(1.08); }
    @media (max-width: 780px) {
      #jarvis-chat-btn { bottom: calc(88px + env(safe-area-inset-bottom)); right: 16px; width: 50px; height: 50px; font-size: 19px; }
    }
    #jarvis-chat-panel {
      position: fixed; bottom: 92px; right: 24px; z-index: 9999;
      width: 360px; max-width: calc(100vw - 32px); height: 480px;
      max-height: calc(100vh - 140px);
      background: #06060a; border: 1px solid rgba(124,92,255,0.25);
      border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      display: none; flex-direction: column; overflow: hidden;
      font-family: 'Inter', sans-serif; color: #eee;
      transition: bottom 0.15s ease;
    }
    #jarvis-chat-panel.open { display: flex; }
    @media (max-width: 780px) {
      #jarvis-chat-panel {
        left: 12px; right: 12px; width: auto;
        bottom: calc(148px + env(safe-area-inset-bottom));
        max-height: calc(100vh - 200px);
      }
    }
    #jarvis-chat-header {
      padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
      font-family: 'Sora', sans-serif; font-weight: 600; font-size: 14px;
      display: flex; justify-content: space-between; align-items: center;
    }
    #jarvis-chat-close { background: none; border: none; color: #888; cursor: pointer; font-size: 18px; }
    #jarvis-incident-select {
      margin: 10px 14px; padding: 8px 10px; border-radius: 8px;
      background: #0d0d14; border: 1px solid rgba(255,255,255,0.1);
      color: #eee; font-size: 13px; font-family: 'Inter', sans-serif;
    }
    #jarvis-messages {
      flex: 1; overflow-y: auto; padding: 8px 14px; display: flex;
      flex-direction: column; gap: 10px; -webkit-overflow-scrolling: touch;
    }
    .jarvis-msg { max-width: 88%; padding: 9px 12px; border-radius: 12px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
    .jarvis-msg.user { align-self: flex-end; background: linear-gradient(135deg, #3d7fff, #4c8bff); color: #fff; }
    .jarvis-msg.assistant { align-self: flex-start; background: #12121a; border: 1px solid rgba(255,255,255,0.08); }
    .jarvis-msg.system { align-self: center; background: none; border: 1px dashed rgba(255,255,255,0.15); color: #9696a5; font-size: 12px; }
    .jarvis-msg a { color: #8a6bff; }
    #jarvis-input-row { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.08); align-items: flex-end; }
    #jarvis-input {
      flex: 1; background: #0d0d14; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; padding: 8px 10px; color: #eee; font-size: 16px; resize: none;
      font-family: 'Inter', sans-serif; max-height: 100px; overflow-y: auto; line-height: 1.4;
    }
    #jarvis-send {
      background: linear-gradient(135deg, #3d7fff, #7c5cff); border: none;
      border-radius: 8px; padding: 9px 14px; color: #fff; cursor: pointer; font-size: 13px; flex-shrink: 0;
    }
    #jarvis-send:disabled { opacity: 0.5; cursor: default; }
    .jarvis-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 14px 10px; }
    .jarvis-pr-link, .jarvis-approve-btn {
      font-size: 12px; text-decoration: none; border-radius: 6px; padding: 6px 10px; cursor: pointer;
    }
    .jarvis-pr-link { color: #8a6bff; border: 1px solid rgba(138,107,255,0.4); background: none; }
    .jarvis-approve-btn { color: #fff; border: none; background: linear-gradient(135deg, #2ed4a3, #22b98c); font-family: inherit; }
    .jarvis-approve-btn:disabled { opacity: 0.5; }
  `;

  const J = () => window.JarvisDemo;
  let currentIncidents = [];
  let currentKey = null;
  let typing = false;

  function storageKey(inc) {
    return `jarvis-chat:${inc.site}:${inc.timestamp}`;
  }
  function loadHistory(inc) { return J().history(storageKey(inc)).slice(); }
  function saveHistory(inc, history) { J().setHistory(storageKey(inc), history); }

  function renderMessages(history) {
    const el = document.getElementById('jarvis-messages');
    el.innerHTML = '';
    history.forEach((m) => {
      const div = document.createElement('div');
      div.className = `jarvis-msg ${m.role === 'system' ? 'system' : m.role === 'user' ? 'user' : 'assistant'}`;
      div.textContent = m.content;
      el.appendChild(div);
    });
    if (typing) {
      const div = document.createElement('div');
      div.className = 'jarvis-msg assistant jarvis-typing';
      div.setAttribute('aria-label', 'Jarvis is typing');
      div.innerHTML = '<span></span><span></span><span></span>';
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  }

  function findIncident(key) {
    return currentIncidents.find((inc) => storageKey(inc) === key);
  }

  function loadIncidents() {
    currentIncidents = J().incidents().slice().reverse();
    const select = document.getElementById('jarvis-incident-select');
    select.innerHTML = '';
    if (currentIncidents.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No incidents recorded yet';
      select.appendChild(opt);
      return;
    }
    currentIncidents.forEach((inc) => {
      const opt = document.createElement('option');
      opt.value = storageKey(inc);
      opt.textContent = `${inc.site} — ${inc.event} — ${new Date(inc.timestamp).toLocaleString()}`;
      select.appendChild(opt);
    });
    return select;
  }

  function renderActions(inc) {
    const existing = document.getElementById('jarvis-actions');
    if (existing) existing.remove();
    if (!inc.prKey) return;
    const pr = J().pr(inc.prKey);
    if (!pr) return;
    const wrap = document.createElement('div');
    wrap.id = 'jarvis-actions';
    wrap.className = 'jarvis-actions';

    const a = document.createElement('a');
    a.href = J().prHref(pr);
    a.className = 'jarvis-pr-link';
    a.textContent = `Review fix PR #${pr.number}`;
    a.addEventListener('click', () => { if (window.innerWidth <= 780) closePanel(); });
    wrap.appendChild(a);

    const btn = document.createElement('button');
    btn.className = 'jarvis-approve-btn';
    btn.textContent = pr.state === 'merged' ? 'Merged ✓' : pr.state === 'merging' ? 'Merging...' : 'Approve & Merge';
    btn.disabled = pr.state !== 'open';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Merging...';
      const history = loadHistory(inc);
      if (J().approve(inc.prKey)) {
        history.push({ role: 'system', content: `PR #${pr.number} merged. The site is redeploying now.` });
        btn.textContent = 'Merged ✓';
      } else {
        history.push({ role: 'system', content: 'Merge failed: this PR is no longer open.' });
      }
      saveHistory(inc, history);
      renderMessages(history);
    });
    wrap.appendChild(btn);

    document.getElementById('jarvis-incident-select').insertAdjacentElement('afterend', wrap);
  }

  // ---------- scripted answers ----------
  function qaFor(inc) {
    const QA = J().QA;
    if (inc.event === 'up') return upAnswers(inc, QA.up);
    return QA[inc.type] || QA['generic-500'];
  }

  function upAnswers(up, template) {
    const down = J().incidents().find((i) => i.id === up.downId);
    const mins = down ? Math.max(1, Math.round((new Date(up.timestamp) - new Date(down.timestamp)) / 60000)) : null;
    const t = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const pr = down && down.prKey && J().pr(down.prKey);
    const how = !down ? 'I don’t have the matching outage on record.'
      : down.resolvedBy === 'pr' && pr ? `Fix PR #${pr.number}: a ${pr.changedLines === 1 ? 'one-line' : 'small'} change to ${pr.file}, approved by you and merged. The site redeployed and the next check came back 200.`
      : down.resolvedBy === 'manual' ? 'You fixed it by hand. I flagged it for manual review because a proper fix needed two files, so I opened no PR. After your change and a redeploy, the next check came back 200.'
      : down.resolvedBy === 'self' ? 'Nothing in the code. It was a timeout, and once whatever was slow cleared, checks came back fast. No PR was needed.'
      : 'A redeploy on your side. I didn’t change any code for this one.';
    const again = !down ? 'Hard to say without the original incident.'
      : down.type === 'slow' || down.type === 'generic-timeout' ? 'Possibly. Slowness from the host or a third-party script tends to come back. The weekly report’s LCP number is the early warning, so compressing the homepage photos would buy headroom.'
      : down.type === 'twofiles' ? 'Only if the variable is renamed again. Renaming it in both files, in one reviewed change, would stop the two names drifting apart.'
      : 'The same mistake could come back in a future deploy. The check runs every 15 minutes either way, so you’d hear about it quickly, and a one-line fix like this one would come back as a PR again.';
    const long = down ? `About ${mins} minute${mins === 1 ? '' : 's'}: down at ${t(down.timestamp)}, back up at ${t(up.timestamp)}.` : 'I don’t have the start of this outage on record.';
    return [
      { ...template[0], a: long },
      { ...template[1], a: how },
      { ...template[2], a: again },
    ];
  }

  function answerFor(inc, text) {
    const list = qaFor(inc);
    const exact = list.find((x) => x.q === text);
    if (exact) return exact.a;
    const lower = text.toLowerCase();
    let best = null, bestScore = 0;
    list.forEach((x) => {
      const score = x.k.reduce((n, k) => n + (lower.includes(k) ? 1 : 0), 0);
      if (score > bestScore) { best = x; bestScore = score; }
    });
    return best ? best.a : J().FALLBACK;
  }

  function renderSuggestions(inc) {
    let wrap = document.getElementById('jarvis-suggest');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'jarvis-suggest';
      wrap.className = 'jarvis-actions';
      document.getElementById('jarvis-input-row').insertAdjacentElement('beforebegin', wrap);
    }
    wrap.innerHTML = '';
    if (!inc) return;
    const asked = new Set(loadHistory(inc).filter((m) => m.role === 'user').map((m) => m.content));
    qaFor(inc).filter((x) => !asked.has(x.q)).forEach((x) => {
      const b = document.createElement('button');
      b.className = 'jarvis-pr-link';
      b.textContent = x.q;
      b.addEventListener('click', () => ask(x.q));
      wrap.appendChild(b);
    });
  }

  function loadIncidentIntoPanel(key) {
    currentKey = key;
    const inc = findIncident(key);
    if (!inc) return;
    document.getElementById('jarvis-incident-select').value = key;
    let history = loadHistory(inc);
    if (history.length === 0 && inc.explanation) {
      history = [{ role: 'assistant', content: inc.explanation }];
      saveHistory(inc, history);
    } else if (history.length === 0 && inc.event === 'up') {
      history = [{ role: 'system', content: `${inc.site} recovered ${J().timeAgo(inc.timestamp)}. Ask about it below.` }];
      saveHistory(inc, history);
    }
    renderMessages(history);
    renderActions(inc);
    renderSuggestions(inc);
  }

  function ask(text) {
    if (!text || !currentKey || typing) return;
    const inc = findIncident(currentKey);
    if (!inc) return;
    const history = loadHistory(inc);
    history.push({ role: 'user', content: text });
    saveHistory(inc, history);
    typing = true;
    renderMessages(history);
    renderSuggestions(inc);
    const sendBtn = document.getElementById('jarvis-send');
    sendBtn.disabled = true;
    const reply = answerFor(inc, text);
    setTimeout(() => {
      typing = false;
      const h = loadHistory(inc);
      h.push({ role: 'assistant', content: reply });
      saveHistory(inc, h);
      if (currentKey === storageKey(inc)) { renderMessages(h); renderSuggestions(inc); }
      sendBtn.disabled = false;
    }, 650 + Math.min(900, reply.length * 2));
  }

  function sendMessage() {
    const input = document.getElementById('jarvis-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    ask(text);
  }

  let panel;
  function closePanel() { panel.classList.remove('open'); }

  function build() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'jarvis-chat-btn';
    btn.textContent = '💬';
    btn.title = 'Ask Jarvis about an incident';
    btn.setAttribute('aria-label', 'Ask Jarvis about an incident');
    document.body.appendChild(btn);

    panel = document.createElement('div');
    panel.id = 'jarvis-chat-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ask Jarvis');
    panel.innerHTML = `
      <div id="jarvis-chat-header">
        <span>Ask Jarvis</span>
        <button id="jarvis-chat-close" aria-label="Close">✕</button>
      </div>
      <select id="jarvis-incident-select" aria-label="Incident"></select>
      <div id="jarvis-messages"></div>
      <div id="jarvis-input-row">
        <textarea id="jarvis-input" rows="1" placeholder="Ask about this incident..." aria-label="Your question"></textarea>
        <button id="jarvis-send">Send</button>
      </div>
    `;
    document.body.appendChild(panel);

    function openPanel(preselectKey) {
      panel.classList.add('open');
      loadIncidents();
      const key = preselectKey && findIncident(preselectKey) ? preselectKey : (currentIncidents[0] ? storageKey(currentIncidents[0]) : null);
      if (key) loadIncidentIntoPanel(key);
    }

    btn.addEventListener('click', () => {
      if (panel.classList.contains('open')) {
        panel.classList.remove('open');
      } else {
        openPanel();
      }
    });
    document.getElementById('jarvis-chat-close').addEventListener('click', closePanel);
    document.getElementById('jarvis-incident-select').addEventListener('change', (e) => loadIncidentIntoPanel(e.target.value));
    document.getElementById('jarvis-send').addEventListener('click', sendMessage);

    const input = document.getElementById('jarvis-input');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Keeps the panel pinned above the iOS keyboard instead of drifting or
    // getting overlapped — iOS doesn't update layout viewport height when
    // the keyboard shows, so we track visualViewport directly.
    if (window.visualViewport) {
      const reposition = () => {
        const keyboardInset = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
        panel.style.bottom = keyboardInset > 60 ? `${keyboardInset + 8}px` : '';
      };
      window.visualViewport.addEventListener('resize', reposition);
      window.visualViewport.addEventListener('scroll', reposition);
    }

    // Keep an open panel in step with the demo (new incidents, merges, recoveries).
    window.addEventListener('jarvis:state', () => {
      if (!panel.classList.contains('open') || !currentKey) return;
      const keep = currentKey;
      loadIncidents();
      if (findIncident(keep)) loadIncidentIntoPanel(keep);
    });
    window.addEventListener('jarvis:reset', () => { currentKey = null; typing = false; closePanel(); });

    // Exposed so other parts of the dashboard (incident rows, notifications,
    // emails) can open the chat pre-loaded to a specific incident.
    window.jarvisOpenChatFor = function (site, timestamp) {
      const key = `jarvis-chat:${site}:${timestamp}`;
      openPanel(key);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
