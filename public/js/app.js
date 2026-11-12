// app.js — the demo's pretend back end and its screens.
//
// Everything runs in this browser tab. There are no API keys and no network
// calls: the "model", "GitHub", "email" and "hosting" are scripted stand-ins,
// and state lives in localStorage so a visitor can reload without losing their
// place. Reset (in the demo bar) wipes it and reseeds a fresh, believable month.
//
// The parts of the real system that decide what Jarvis is *allowed* to do are
// ported as-is from scripts/proposeFix.js: the route-to-file lookup, the
// find-and-replace snippet rule, the line counter and the 15-line limit. They
// run for real against the fictional repo files in data.js.

(function () {
  const D = window.DEMO_DATA;
  const KEY = 'jarvis-demo:v1';
  const CHECK_EVERY_MS = 20000; // production: every 15 minutes
  const POINTS = 48;
  const STEP_MS = 1400;
  const MAX_CHANGED_LINES = 15; // same constant as proposeFix.js
  const FROM = 'Jarvis <alerts@jarvis.example>';
  const TO = 'you@studio.example';
  const REAL_REPO = 'https://github.com/cianmccaul/site-monitor';

  // ---------- small helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const siteById = (id) => D.SITES.find((s) => s.id === id);
  const scenarioById = (id) => D.SCENARIOS.find((s) => s.id === id);
  const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const shortDate = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const longDate = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const prUrl = (pr) => `https://git.example/${pr.repo}/pull/${pr.number}`;
  const prHref = (pr) => `#/pr/${pr.siteId}/${pr.number}`;
  const prKey = (siteId, n) => `${siteId}#${n}`;

  // Same wording as the production dashboard's timeAgo().
  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.round(hrs / 24);
    return days === 1 ? 'Yesterday' : days + 'd ago';
  }

  function rng(seed) { // mulberry32: deterministic, so a reset looks the same each time
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  const jitter = (site, r = Math.random) => Math.max(40, Math.round(site.baseMs + (r() - 0.5) * 2 * site.spread + (r() < 0.06 ? site.spread * 2.5 : 0)));

  // ---------- ported from scripts/proposeFix.js (unchanged logic) ----------
  function candidatePathsFromUrl(url) {
    let pathname;
    try { pathname = new URL(url).pathname; } catch { return []; }
    const trimmed = pathname.replace(/^\/+|\/+$/g, '');
    if (!trimmed) return [];
    return [
      `${trimmed}.js`, `${trimmed}.ts`,
      `pages/${trimmed}.js`, `pages/${trimmed}.ts`,
      `app/${trimmed}/route.js`, `app/${trimmed}/route.ts`,
    ];
  }
  function countChangedLines(oldContent, newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const lenDiff = Math.abs(oldLines.length - newLines.length);
    let changed = lenDiff;
    const shorter = Math.min(oldLines.length, newLines.length);
    for (let i = 0; i < shorter; i++) if (oldLines[i] !== newLines[i]) changed++;
    return changed;
  }

  // ---------- state ----------
  let S;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode: fine, state just won't survive a reload */ } }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; }
    } catch { /* fall through to a fresh seed */ }
    return seed();
  }
  function healthyRepos() {
    const out = {};
    for (const [repo, files] of Object.entries(D.REPOS)) {
      out[repo] = {};
      for (const [p, f] of Object.entries(files)) out[repo][p] = f.healthy;
    }
    return out;
  }
  function lastMondayReportTime(now) {
    const d = new Date(now);
    d.setUTCHours(9, 13, 0, 0); // weeklyReport.yml: cron '13 9 * * 1'
    while (d.getUTCDay() !== 1 || d.getTime() > now) d.setUTCDate(d.getUTCDate() - 1);
    return d.getTime();
  }

  function seed() {
    const now = Date.now();
    const { MIN, DAY } = D;
    const s = {
      v: 1, seededAt: now, lastChecked: new Date(now).toISOString(), seq: 1,
      sites: {}, incidents: [], emails: [], prs: {}, runs: [], chats: {}, reports: {},
      repos: healthyRepos(),
      nextPr: { northbank: 14, cafe: 7, painting: 3, sandbox: 23 },
      dismissedInsight: null,
    };
    const id = () => 'x' + (s.seq++);

    for (const site of D.SITES) {
      const r = rng(hash(site.id));
      const checks = [];
      for (let i = 0; i < POINTS; i++) checks.push({ t: new Date(now - (POINTS - 1 - i) * 15 * MIN).toISOString(), ms: jitter(site, r), ok: true, code: 200 });
      s.sites[site.id] = { up: true, since: new Date(now - 41 * DAY).toISOString(), checks, uptime: Array(30).fill(100) };
    }

    // Past incidents, oldest first, so the dashboard has a believable history.
    const hist = D.HISTORY.slice().sort((a, b) => b.ago - a.ago);
    for (const h of hist) {
      const site = siteById(h.siteId);
      const downAt = now - h.ago, upAt = downAt + h.downFor;
      const downId = id();
      const down = {
        id: downId, siteId: site.id, site: site.name, url: site.url, event: 'down', type: h.type,
        timestamp: new Date(downAt).toISOString(), explanation: h.explanation,
        statusCode: h.statusCode, responseTimeMs: h.responseTimeMs, error: h.error || null,
      };
      if (h.pr) {
        const after = h.pr.before.replace(h.pr.oldStr, h.pr.newStr);
        const pr = makePr({
          site, number: h.pr.number, incidentId: downId, file: h.pr.file, before: h.pr.before, after,
          explanation: h.explanation, openedAt: downAt + 40 * 1000, branchTs: downAt + 38 * 1000, title: h.pr.title,
        });
        pr.state = 'merged'; pr.mergedAt = new Date(upAt - 3 * MIN).toISOString(); pr.approvedFrom = 'the email';
        s.prs[prKey(site.id, pr.number)] = pr;
        down.prKey = prKey(site.id, pr.number);
        down.resolvedBy = 'pr';
      } else {
        down.noFixReason = h.noFixReason;
        down.guard = guardNoFile(site, h.noFixReason);
        down.resolvedBy = h.type === 'generic-timeout' ? 'self' : 'redeploy';
      }
      s.incidents.push(down);
      s.emails.push({ id: id(), kind: 'down', incidentId: downId, siteId: site.id, at: down.timestamp, read: true });
      const up = { id: id(), siteId: site.id, site: site.name, url: site.url, event: 'up', type: 'up', timestamp: new Date(upAt).toISOString(), explanation: null, downId, downSince: down.timestamp };
      s.incidents.push(up);
      s.emails.push({ id: id(), kind: 'up', incidentId: up.id, siteId: site.id, at: up.timestamp, read: true });
      const dayIdx = 29 - Math.floor(h.ago / DAY);
      if (dayIdx >= 0) s.sites[site.id].uptime[dayIdx] = Math.max(0, 100 - (h.downFor / DAY) * 100);
      s.sites[site.id].since = up.timestamp;
    }

    // Last Monday's weekly reports, one email per site, as weeklyReport.js sends them.
    const reportAt = lastMondayReportTime(now);
    D.SITES.forEach((site, i) => {
      const at = new Date(reportAt + i * 41 * 1000).toISOString();
      s.reports[site.id] = { at, ...JSON.parse(JSON.stringify(D.REPORTS[site.id])) };
      s.emails.push({ id: id(), kind: 'weekly', siteId: site.id, at, read: false });
    });
    return s;
  }

  const nextId = () => 'x' + (S.seq++);
  const incidentById = (id) => S.incidents.find((i) => i.id === id);
  const runFor = (siteId) => S.runs.filter((r) => r.siteId === siteId).slice(-1)[0];
  const activeRun = (siteId) => { const r = runFor(siteId); return r && r.phase !== 'done' ? r : null; };
  const busyRun = () => S.runs.find((r) => r.phase === 'running' || r.phase === 'recovering');

  // ---------- guard rails (README: "enforced in code, not just written into a prompt") ----------
  const RAILS = [
    'Never touches main',
    'One file only',
    `${MAX_CHANGED_LINES} changed lines or fewer`,
    'Token scoped to the monitored sites’ repos',
    'Fails closed',
  ];
  const tokenDetail = (site) => `The token can only reach the ${D.SITES.length} monitored sites’ repos, and ${site.repo} is one of them. It can’t modify Jarvis itself.`;
  function guardPassed(site, file, changed, branch) {
    return [
      { state: 'pass', detail: `Opened as a pull request on ${branch}. main is untouched until you approve.` },
      { state: 'pass', detail: `Only ${file} changes. The snippet was found exactly once.` },
      { state: 'pass', detail: `~${changed} changed line${changed === 1 ? '' : 's'} by Jarvis’s cautious line count (limit ${MAX_CHANGED_LINES}).` },
      { state: 'pass', detail: tokenDetail(site) },
      { state: 'pass', detail: 'Not needed: every step succeeded, so a PR was opened for you to review.' },
    ];
  }
  function guardNoFile(site, reason) {
    return [
      { state: 'pass', detail: 'Nothing was committed anywhere.' },
      { state: 'skip', detail: reason },
      { state: 'skip', detail: 'Not reached.' },
      { state: 'pass', detail: tokenDetail(site) },
      { state: 'held', detail: 'Failed closed: no PR. The reason is noted in the alert email.' },
    ];
  }
  function guardTwoFiles(site, files) {
    return [
      { state: 'pass', detail: 'Nothing was committed anywhere.' },
      { state: 'fail', detail: `The fix would touch ${files.length} files: ${files.join(' and ')}. Rejected.` },
      { state: 'skip', detail: 'Not reached: the fix was already rejected.' },
      { state: 'pass', detail: tokenDetail(site) },
      { state: 'held', detail: 'Failed closed: flagged for manual review, no PR opened. Noted in the alert email.' },
    ];
  }

  function makePr({ site, number, incidentId, file, before, after, explanation, openedAt, branchTs, title }) {
    const changedLines = countChangedLines(before, after);
    const branch = `jarvis/fix-${branchTs}`;
    return {
      number, siteId: site.id, repo: site.repo, incidentId, file, before, after, changedLines, branch,
      title: title || `Jarvis auto-fix: ${site.name} down`,
      commit: `Jarvis auto-fix: ${explanation.slice(0, 60)}`,
      explanation, state: 'open', openedAt: new Date(openedAt).toISOString(), mergedAt: null,
      checks: guardPassed(site, file, changedLines, branch),
    };
  }

  // ---------- live checks ----------
  function pushCheck(siteId, check) {
    const st = S.sites[siteId];
    st.checks.push({ t: new Date().toISOString(), ...check });
    if (st.checks.length > POINTS) st.checks.splice(0, st.checks.length - POINTS);
    S.lastChecked = new Date().toISOString();
  }
  function scheduledCheck() {
    for (const site of D.SITES) {
      const run = activeRun(site.id);
      if (run && run.phase !== 'awaiting') continue; // the scenario is driving this site's checks
      const st = S.sites[site.id];
      if (st.up) pushCheck(site.id, { ms: jitter(site), ok: true, code: 200 });
      else {
        const sc = scenarioById(run && run.scenarioId);
        pushCheck(site.id, { ms: sc ? Math.round(sc.responseTimeMs * (0.85 + Math.random() * 0.3)) : 200, ok: false, code: sc ? sc.statusCode : 500 });
      }
    }
    commit();
  }

  // ---------- the loop, step by step ----------
  function log(run, text, state = 'ok') {
    run.log.forEach((l) => { if (l.state === 'run') l.state = 'ok'; });
    run.log.push({ t: new Date().toISOString(), text, state });
  }
  function setDown(site, sc) {
    const st = S.sites[site.id];
    st.up = false; st.since = new Date().toISOString();
    pushCheck(site.id, { ms: sc.responseTimeMs, ok: false, code: sc.statusCode });
  }
  function setUp(site, ms) {
    const st = S.sites[site.id];
    const downSince = st.since;
    st.up = true; st.since = new Date().toISOString();
    pushCheck(site.id, { ms, ok: true, code: 200 });
    const mins = (Date.now() - new Date(downSince).getTime()) / D.DAY * 100;
    st.uptime[29] = Math.max(0, st.uptime[29] - mins);
    return downSince;
  }
  const checkLine = (site, code, ms) => `Health check: GET ${site.url} → ${code ?? 'no response'} in ${fmtMs(ms)}`;

  const STEPS = {
    break(run, sc, site) {
      S.repos[site.repo] = healthyRepos()[site.repo];
      if (sc.id === 'await' || sc.id === 'deleted') {
        for (const [p, f] of Object.entries(D.REPOS[site.repo])) if ('broken' in f) S.repos[site.repo][p] = f.broken;
      }
      const what = {
        await: `Deploy “${sc.commit}” went live on ${site.shortUrl}. It removed one await in api/health.js.`,
        deleted: `Deploy “${sc.commit}” went live on ${site.shortUrl}. It deleted api/health.js.`,
        slow: `${site.name}’s homepage is getting slower. Nothing has been deployed.`,
        twofiles: `Deploy “${sc.commit}” went live. The hosting settings now have POSTGRES_URL instead of DATABASE_URL.`,
      }[sc.id];
      log(run, what, 'info');
      return STEP_MS;
    },
    slow0: (run, sc, site) => slowCheck(run, sc, site, 0),
    slow1: (run, sc, site) => slowCheck(run, sc, site, 1),
    slow2: (run, sc, site) => slowCheck(run, sc, site, 2),
    fail(run, sc, site) {
      setDown(site, sc);
      log(run, sc.statusCode ? checkLine(site, sc.statusCode, sc.responseTimeMs) : `Health check: GET ${site.url} → no response after 10 s (timed out)`, 'bad');
      log(run, 'State change: up → down. Investigating…', 'run');
      return STEP_MS;
    },
    explain(run) {
      log(run, 'Sent the symptoms (status, error, response time) to the model and got a plain-English explanation back.');
      return STEP_MS;
    },
    locate(run, sc, site) {
      const repo = S.repos[site.repo];
      const cands = candidatePathsFromUrl(site.url);
      const path = new URL(site.url).pathname;
      if (!cands.length) {
        log(run, `Looking for the file to fix: the monitored URL is the homepage (${path}), so there’s no route to map to a file.`, 'info');
      } else {
        const found = cands.find((p) => repo[p] != null);
        if (found) { run.file = found; log(run, `Found the file without asking the model: ${path} → ${found} on main (read-only).`); }
        else log(run, `Tried the ${cands.length} usual places for ${path} (${cands.slice(0, 3).join(', ')}…). None exist on main.`, 'info');
      }
      return run.file ? STEP_MS : 900;
    },
    guess(run, sc, site) {
      if (run.file) return 0;
      const guess = { deleted: 'vercel.json', slow: 'UNKNOWN' }[sc.id] || 'UNKNOWN';
      if (guess === 'UNKNOWN') {
        run.noFixReason = 'Could not confidently identify a single file to check.';
        run.guard = guardNoFile(site, run.noFixReason);
        log(run, 'Asked the model for the one file most likely responsible. It answered UNKNOWN.', 'info');
        log(run, `Failed closed: ${run.noFixReason} No PR.`, 'held');
        return STEP_MS;
      }
      run.file = guess;
      log(run, `Asked the model for the one file most likely responsible: ${guess}. Fetched it from main (read-only).`);
      return STEP_MS;
    },
    propose(run, sc) {
      if (sc.proposed) {
        const files = [...new Set(sc.proposed.map((p) => p.file))];
        log(run, `The model’s fix renames DATABASE_URL in ${files.join(' and ')}.`, 'info');
        return STEP_MS;
      }
      log(run, `The model proposed a small find-and-replace fix for ${run.file}.`);
      return STEP_MS;
    },
    guard(run, sc, site) {
      if (sc.proposed) {
        const files = [...new Set(sc.proposed.map((p) => p.file))];
        run.noFixReason = `The fix would touch ${files.length} files (${files.join(', ')}). Flagged for manual review, no PR opened.`;
        run.guard = guardTwoFiles(site, files);
        log(run, `Guard rail 2, one file only: ${files.length} files. Rejected.`, 'bad');
        log(run, 'Failed closed: flagged for manual review, no PR opened. Nothing was committed.', 'held');
        return STEP_MS;
      }
      // The real gates, run against the fictional file.
      const before = S.repos[site.repo][run.file];
      const occurrences = before.split(sc.fix.oldStr).length - 1;
      if (occurrences !== 1) { run.noFixReason = 'fix rejected: snippet not uniquely found'; run.guard = guardNoFile(site, run.noFixReason); log(run, run.noFixReason, 'held'); return STEP_MS; }
      const after = before.replace(sc.fix.oldStr, sc.fix.newStr);
      const changed = countChangedLines(before, after);
      if (changed > MAX_CHANGED_LINES) { run.noFixReason = `Proposed fix changes ~${changed} lines — over the ${MAX_CHANGED_LINES}-line auto-fix limit.`; run.guard = guardNoFile(site, run.noFixReason); log(run, run.noFixReason, 'held'); return STEP_MS; }
      run.before = before; run.after = after; run.changed = changed;
      log(run, `Guard rails passed: one file (${run.file}), snippet found once, ~${changed} changed line${changed === 1 ? '' : 's'} (limit ${MAX_CHANGED_LINES}), token scoped to ${site.repo}.`);
      return STEP_MS;
    },
    openPr(run, sc, site) {
      if (!run.after) return 0;
      const number = S.nextPr[site.id]++;
      const now = Date.now();
      const pr = makePr({ site, number, incidentId: null, file: run.file, before: run.before, after: run.after, explanation: sc.explanation, openedAt: now, branchTs: now - 2000 });
      S.prs[prKey(site.id, number)] = pr;
      run.prKey = prKey(site.id, number);
      log(run, `Opened PR #${number} on ${pr.branch}. Not merged: it needs you.`);
      return STEP_MS;
    },
    email(run, sc, site) {
      const inc = {
        id: nextId(), siteId: site.id, site: site.name, url: site.url, event: 'down', type: sc.id,
        timestamp: new Date().toISOString(), explanation: sc.explanation, statusCode: sc.statusCode,
        responseTimeMs: sc.responseTimeMs, error: sc.error, runId: run.id,
      };
      if (run.prKey) { inc.prKey = run.prKey; S.prs[run.prKey].incidentId = inc.id; }
      else { inc.noFixReason = run.noFixReason; inc.guard = run.guard; }
      S.incidents.push(inc);
      run.incidentId = inc.id;
      S.dismissedInsight = null;
      const mail = { id: nextId(), kind: 'down', incidentId: inc.id, siteId: site.id, at: inc.timestamp, read: false };
      S.emails.push(mail);
      log(run, `Emailed you: 🔴 ${site.name} is down`);
      toast(`New email · 🔴 ${site.name} is down`, `#/inbox/${mail.id}`);
      if (sc.id === 'slow') {
        run.phase = 'recovering';
        log(run, 'Still checking. Production checks every 15 minutes; this demo checks every few seconds.', 'run');
        return 2600;
      }
      run.phase = 'awaiting';
      if (run.prKey) log(run, `Waiting for you: approve & merge PR #${S.prs[run.prKey].number} from the email, the PR page or Ask Jarvis.`, 'wait');
      else log(run, 'Waiting for a manual fix. Jarvis won’t touch this one.', 'wait');
      return null;
    },
    merge(run) {
      const pr = S.prs[run.prKey];
      pr.state = 'merged'; pr.mergedAt = new Date().toISOString();
      S.repos[pr.repo][pr.file] = pr.after;
      log(run, `You approved PR #${pr.number} from ${run.approvedFrom || 'the dashboard'}. Merged into main (squash).`);
      return 900;
    },
    manual(run, sc, site) {
      S.repos[site.repo] = healthyRepos()[site.repo];
      log(run, 'You fixed it by hand: DATABASE_URL added back in the hosting settings.');
      return 900;
    },
    redeploy(run) {
      log(run, 'Redeploying the site…', 'run');
      return 2800;
    },
    recheck(run, sc, site) {
      log(run, 'Deploy finished. Rechecking now instead of waiting for the next scheduled run.');
      return 1100;
    },
    up(run, sc, site) { return recover(run, sc, site, jitter(site), true); },
    rec0: (run, sc, site) => recover(run, sc, site, sc.recover[0], false),
    rec1(run, sc, site) { pushCheck(site.id, { ms: sc.recover[1], ok: true, code: 200 }); log(run, checkLine(site, 200, sc.recover[1])); return 2200; },
    rec2(run, sc, site) { pushCheck(site.id, { ms: sc.recover[2], ok: true, code: 200 }); log(run, `${checkLine(site, 200, sc.recover[2])}. Back to normal.`); run.phase = 'done'; return null; },
  };

  function slowCheck(run, sc, site, i) {
    const ms = sc.ramp[i];
    pushCheck(site.id, { ms, ok: true, code: 200 });
    log(run, `${checkLine(site, 200, ms)}. Slow, but still up: logged, no alert.`, 'info');
    return 1900;
  }

  function recover(run, sc, site, ms, final) {
    const downSince = setUp(site, ms);
    const down = incidentById(run.incidentId);
    const up = { id: nextId(), siteId: site.id, site: site.name, url: site.url, event: 'up', type: 'up', timestamp: new Date().toISOString(), explanation: null, downId: down.id, downSince };
    S.incidents.push(up);
    down.resolvedBy = run.prKey ? 'pr' : sc.id === 'slow' ? 'self' : 'manual';
    const mail = { id: nextId(), kind: 'up', incidentId: up.id, siteId: site.id, at: up.timestamp, read: false };
    S.emails.push(mail);
    log(run, `${checkLine(site, 200, ms)}.${final ? '' : ' Under 10 s, so it counts as up again.'}`);
    log(run, `Recovered. Emailed you: ✅ ${site.name} is back up`);
    chatSystem(down, `Recheck: 200 in ${fmtMs(ms)}. ${site.name} is back up.`);
    toast(`New email · ✅ ${site.name} is back up`, `#/inbox/${mail.id}`);
    if (final) { run.phase = 'done'; return null; }
    return 2200;
  }

  const FLOWS = {
    await: ['break', 'fail', 'explain', 'locate', 'propose', 'guard', 'openPr', 'email', 'merge', 'redeploy', 'recheck', 'up'],
    deleted: ['break', 'fail', 'explain', 'locate', 'guess', 'propose', 'guard', 'openPr', 'email', 'merge', 'redeploy', 'recheck', 'up'],
    slow: ['break', 'slow0', 'slow1', 'slow2', 'fail', 'explain', 'locate', 'guess', 'email', 'rec0', 'rec1', 'rec2'],
    twofiles: ['break', 'fail', 'explain', 'locate', 'propose', 'guard', 'email', 'manual', 'redeploy', 'recheck', 'up'],
  };

  const timers = {};
  function schedule(run, delay) {
    clearTimeout(timers[run.id]);
    timers[run.id] = setTimeout(() => execStep(run.id), delay);
  }
  function execStep(runId) {
    const run = S.runs.find((r) => r.id === runId);
    if (!run || run.phase === 'done' || run.phase === 'awaiting') return;
    const sc = scenarioById(run.scenarioId), site = siteById(run.siteId);
    const name = FLOWS[sc.id][run.step];
    if (!name) { run.phase = 'done'; commit(); return; }
    run.step++;
    const delay = STEPS[name](run, sc, site);
    commit();
    if (delay != null && run.phase !== 'done' && run.phase !== 'awaiting') schedule(run, delay);
  }

  function startScenario(scId) {
    const sc = scenarioById(scId);
    if (busyRun() || activeRun(sc.siteId)) return;
    const run = { id: nextId(), scenarioId: sc.id, siteId: sc.siteId, step: 0, phase: 'running', startedAt: new Date().toISOString(), log: [] };
    S.runs.push(run);
    if (S.runs.length > 12) S.runs.splice(0, S.runs.length - 12);
    commit();
    execStep(run.id);
    document.getElementById('loopFeed').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function approve(key, from) {
    const pr = S.prs[key];
    if (!pr || pr.state !== 'open') return false;
    const run = S.runs.find((r) => r.prKey === key && r.phase === 'awaiting');
    if (!run) return false;
    pr.state = 'merging';
    run.approvedFrom = from;
    run.phase = 'recovering';
    commit();
    schedule(run, 500);
    return true;
  }

  function manualFix(runId) {
    const run = S.runs.find((r) => r.id === runId);
    if (!run || run.phase !== 'awaiting' || run.prKey) return;
    run.phase = 'recovering';
    commit();
    schedule(run, 300);
  }

  // ---------- chat bridge (chat.js reads and writes through this) ----------
  function chatKey(inc) { return `jarvis-chat:${inc.site}:${inc.timestamp}`; }
  function chatSystem(inc, text) {
    const k = chatKey(inc);
    S.chats[k] = S.chats[k] || (inc.explanation ? [{ role: 'assistant', content: inc.explanation }] : []);
    S.chats[k].push({ role: 'system', content: text });
  }

  // ---------- rendering ----------
  let route = { view: 'overview', args: [] };

  function commit() { save(); render(); window.dispatchEvent(new Event('jarvis:state')); }

  function render() {
    renderChrome();
    renderOverview();
    if (route.view === 'sites') renderSitesFull();
    if (route.view === 'incidents') $('feedAll').innerHTML = feedHTML(S.incidents.slice().reverse());
    if (route.view === 'inbox') renderInbox();
    if (route.view === 'pr') renderPr();
    if (route.view === 'reports') renderReports();
  }

  function uptime30(siteId) {
    const u = S.sites[siteId].uptime;
    return u.reduce((a, b) => a + b, 0) / u.length;
  }
  const fmtPct = (p) => (p >= 99.995 ? '100%' : p.toFixed(2) + '%');
  const lastCheck = (siteId) => S.sites[siteId].checks.slice(-1)[0];

  function renderChrome() {
    const down = D.SITES.filter((s) => !S.sites[s.id].up).length;
    $('liveText').textContent = 'Live · checked ' + timeAgo(S.lastChecked);
    $('sidebarFootTitle').textContent = down === 0 ? 'All systems normal' : down + ' site' + (down > 1 ? 's' : '') + ' need attention';
    $('sidebarFootDetail').textContent = 'Last check ran ' + timeAgo(S.lastChecked) + ' across ' + D.SITES.length + ' sites.';
    const unread = S.emails.filter((e) => !e.read).length;
    $('demoInboxLink').textContent = unread ? `Inbox (${unread})` : 'Inbox';
    $('navInboxCount').textContent = unread ? ` ${unread}` : '';
    $('notifPing').style.display = unread || down ? '' : 'none';
    const recent = S.incidents.slice(-4).reverse();
    $('notifDropdown').innerHTML = '<div class="h">Notifications</div>' + (recent.length === 0
      ? '<div class="feed-row"><div class="feed-text" style="color:var(--text-muted);font-size:12.5px;">No notifications yet.</div></div>'
      : recent.map((i) => `
        <div class="feed-row" style="cursor:pointer;" data-chat="${i.id}">
          <div class="feed-dot ${i.event === 'down' ? 'red' : 'green'}"></div>
          <div class="feed-text" style="font-size:12.5px;"><span class="site">${esc(i.site)}</span> <span class="desc">— ${i.event === 'down' ? 'health check failed' : 'recovered'}</span></div>
        </div>`).join(''));
  }

  function sparkSVG(checks, h = 34, cls = '', fit = false) {
    const w = 200;
    const vals = checks.map((c) => c.ms);
    const median = vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)] || 1;
    const lo = fit ? Math.min(...vals) - 3 : 0;
    const top = fit ? Math.max(...vals) + 3 : Math.max(...vals, median * 2.2);
    const x = (i) => (i / Math.max(1, checks.length - 1)) * w;
    const y = (v) => h - 3 - ((v - lo) / (top - lo)) * (h - 6);
    const line = checks.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.ms).toFixed(1)}`).join('');
    const area = `${line}L${w},${h}L0,${h}Z`;
    const dots = checks.map((c, i) => (c.ok ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(c.ms).toFixed(1)}" r="2.6" class="spark-bad"/>`)).join('');
    return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" class="spark-area"/><path d="${line}" class="spark-line" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
  }

  function uptimeBars(siteId) {
    const u = S.sites[siteId].uptime;
    return `<div class="uptime-bars" aria-label="Uptime, last 30 days">${u.map((p, i) => {
      const d = new Date(Date.now() - (29 - i) * D.DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `<span class="${p < 99.995 ? 'dip' : ''}" title="${d} · ${fmtPct(p)}"></span>`;
    }).join('')}</div>`;
  }

  function statusDot(up) {
    const color = up ? 'var(--green)' : 'var(--red)';
    const glow = `;box-shadow:0 0 4px ${color}, 0 0 20px 4px ${up ? 'var(--green-glow)' : 'var(--red-glow)'}`;
    return `<div class="dot" style="background:${color}${glow}"></div>`;
  }

  // Production site card, plus uptime and response time.
  function siteCardHTML(site) {
    const st = S.sites[site.id];
    const count = S.incidents.filter((i) => i.siteId === site.id && i.event === 'down').length;
    const lc = lastCheck(site.id);
    return `
      <div class="site-card" data-name="${esc(site.name.toLowerCase())}" data-url="${esc(site.url)}">
        <div class="site-top">
          <div><div class="site-name">${esc(site.name)}</div><div class="site-url">${esc(site.shortUrl)}</div></div>
          ${statusDot(st.up)}
        </div>
        <div class="site-metrics">
          <div class="metric"><div class="metric-num">${st.up ? 'Up' : 'Down'}</div><div class="metric-lbl">Status</div></div>
          <div class="metric"><div class="metric-num">${count}</div><div class="metric-lbl">Incidents</div></div>
          <div class="metric"><div class="metric-num">${fmtPct(uptime30(site.id))}</div><div class="metric-lbl">Uptime, 30 days</div></div>
          <div class="metric"><div class="metric-num">${lc.ok ? fmtMs(lc.ms) : (lc.code ?? 'Timeout')}</div><div class="metric-lbl">${lc.ok ? 'Response' : 'Last check'}</div></div>
        </div>
        <div class="site-chart">${sparkSVG(st.checks)}</div>
        <button class="btn" style="width:100%;margin-top:12px;" data-reports="${site.id}">View reports</button>
      </div>`;
  }

  function feedHTML(list) {
    if (list.length === 0) return '<div class="feed-row"><div class="feed-text" style="color:var(--text-muted);">No incidents yet.</div></div>';
    return list.map((i) => {
      const pr = i.prKey && S.prs[i.prKey];
      return `
      <div class="feed-row" style="cursor:pointer;" data-chat="${i.id}">
        <div class="feed-dot ${i.event === 'down' ? 'red' : 'green'}"></div>
        <div class="feed-text"><span class="site">${esc(i.site)}</span> <span class="desc">— ${i.event === 'down' ? 'health check failed' : 'recovered'}${pr ? ` · fix PR #${pr.number}${pr.state === 'merged' ? ' merged' : ''}` : ''}</span></div>
        <div class="feed-time">${timeAgo(i.timestamp)}</div>
      </div>`;
    }).join('');
  }

  function renderOverview() {
    const healthy = D.SITES.filter((s) => S.sites[s.id].up).length;
    $('statHealthy').textContent = healthy;
    $('statOpen').textContent = D.SITES.length - healthy;
    const up = D.SITES.reduce((a, s) => a + uptime30(s.id), 0) / D.SITES.length;
    $('statUptime').textContent = up.toFixed(2) + '%';
    const live = D.SITES.map((s) => lastCheck(s.id)).filter((c) => c.ok);
    $('statResponse').textContent = live.length ? fmtMs(live.reduce((a, c) => a + c.ms, 0) / live.length) : '—';

    renderInsight();
    renderScenarios();
    renderLoop();

    const cards = D.SITES.map(siteCardHTML).join('');
    $('siteGrid').innerHTML = cards;
    filterSites($('searchInput').value);
    $('feedRecent').innerHTML = feedHTML(S.incidents.slice(-8).reverse());
  }

  // Same rules as the production renderInsight().
  function renderInsight() {
    const card = $('insightCard');
    const latestDown = [...S.incidents].reverse().find((i) => i.event === 'down');
    if (!latestDown || S.dismissedInsight === latestDown.id) { card.style.display = 'none'; return; }
    const recoveredAfter = S.incidents.some((i) => i.siteId === latestDown.siteId && i.event === 'up' && new Date(i.timestamp) > new Date(latestDown.timestamp));
    $('insightTag').textContent = recoveredAfter ? 'Solved' : (latestDown.prKey ? 'Fix proposed' : 'Investigated');
    $('insightTime').textContent = timeAgo(latestDown.timestamp);
    $('insightTitle').textContent = `${latestDown.site} — health check failed`;
    $('insightBody').textContent = latestDown.explanation || 'No explanation recorded.';
    const pr = latestDown.prKey && S.prs[latestDown.prKey];
    $('insightActions').innerHTML =
      `<button class="btn primary" data-chat="${latestDown.id}">Ask Jarvis</button>` +
      (pr ? `<a class="btn" href="${prHref(pr)}">${pr.state === 'merged' ? 'View' : 'Review'} fix PR #${pr.number}</a>` : '') +
      `<button class="btn" data-act="dismiss-insight" data-id="${latestDown.id}">Dismiss</button>`;
    card.style.display = '';
  }

  function renderScenarios() {
    const busy = busyRun();
    $('scenarioList').innerHTML = D.SCENARIOS.map((sc) => {
      const site = siteById(sc.siteId);
      const run = activeRun(sc.siteId);
      let action;
      if (run && run.scenarioId === sc.id && run.phase === 'awaiting' && run.prKey) {
        const pr = S.prs[run.prKey];
        action = `<a class="btn primary" href="${prHref(pr)}">Review PR #${pr.number}</a>`;
      } else if (run && run.scenarioId === sc.id && run.phase === 'awaiting') {
        action = `<button class="btn primary" data-act="manual-fix" data-run="${run.id}">Fix it by hand</button>`;
      } else if (run) {
        action = `<button class="btn" disabled>${run.scenarioId === sc.id ? 'Playing…' : 'Site busy'}</button>`;
      } else {
        action = `<button class="btn" data-act="break" data-sc="${sc.id}" ${busy ? 'disabled' : ''}>Break it</button>`;
      }
      return `
        <div class="feed-row scenario-row">
          <div class="feed-dot ${S.sites[site.id].up ? 'green' : 'red'}"></div>
          <div class="feed-text"><span class="site">${esc(sc.title)}</span><br><span class="desc">${esc(site.name)} · ${esc(sc.short)}</span></div>
          <div class="scenario-action">${action}</div>
        </div>`;
    }).join('');
  }

  const DOT = { ok: 'green', bad: 'red', info: 'muted', held: 'blue', wait: 'blue pulse', run: 'blue pulse' };
  function renderLoop() {
    const run = S.runs.slice(-1)[0];
    const el = $('loopFeed');
    if (!run) {
      el.innerHTML = `<div class="feed-row"><div class="feed-dot muted"></div><div class="feed-text"><span class="desc">Pick a scenario above and watch Jarvis work through it here: detect, explain, look for a fix, check the guard rails, email you, and recover once you approve.</span></div></div>`;
      return;
    }
    const sc = scenarioById(run.scenarioId), site = siteById(run.siteId);
    const head = `<div class="feed-row loop-head"><div class="feed-text"><span class="site">${esc(site.name)}</span> <span class="desc">— ${esc(sc.title)}</span></div><div class="feed-time">${run.phase === 'done' ? 'Finished' : run.phase === 'awaiting' ? 'Waiting for you' : 'Running'}</div></div>`;
    const rows = run.log.map((l) => `
      <div class="feed-row loop-row">
        <div class="feed-dot ${DOT[l.state] || 'green'}"></div>
        <div class="feed-text"><span class="desc">${esc(l.text)}</span></div>
        <div class="feed-time">${clock(l.t)}</div>
      </div>`).join('');
    let actions = '';
    const inc = run.incidentId && incidentById(run.incidentId);
    if (run.phase === 'awaiting' && run.prKey) {
      const pr = S.prs[run.prKey];
      const mail = S.emails.find((e) => e.incidentId === run.incidentId);
      actions = `<a class="btn primary" href="${prHref(pr)}">Review fix PR #${pr.number}</a><button class="btn" data-act="approve" data-pr="${run.prKey}">Approve &amp; merge</button>${mail ? `<a class="btn" href="#/inbox/${mail.id}">Open the email</a>` : ''}`;
    } else if (run.phase === 'awaiting') {
      actions = `<button class="btn primary" data-act="manual-fix" data-run="${run.id}">Fix it by hand</button><button class="btn" data-act="guard" data-inc="${run.incidentId}">See the guard rails</button>`;
    } else if (run.phase === 'done' && inc) {
      actions = `<button class="btn" data-chat="${inc.id}">Ask Jarvis about it</button>` + (run.prKey ? `<a class="btn" href="${prHref(S.prs[run.prKey])}">View PR #${S.prs[run.prKey].number}</a>` : `<button class="btn" data-act="guard" data-inc="${inc.id}">See the guard rails</button>`);
    }
    el.innerHTML = head + rows + (actions ? `<div class="feed-row loop-actions"><div class="insight-actions">${actions}</div></div>` : '');
  }

  function renderSitesFull() {
    $('siteGridFull').innerHTML = D.SITES.map((site) => {
      const st = S.sites[site.id];
      const checks = st.checks.slice(-5).reverse();
      const vals = st.checks.filter((c) => c.ok).map((c) => c.ms).sort((a, b) => a - b);
      const p50 = vals[Math.floor(vals.length / 2)], p95 = vals[Math.floor(vals.length * 0.95)];
      return `
      <div class="site-card">
        <div class="site-top">
          <div><div class="site-name">${esc(site.name)}</div><div class="site-url">${esc(site.url)}</div></div>
          ${statusDot(st.up)}
        </div>
        <div class="site-metrics">
          <div class="metric"><div class="metric-num">${st.up ? 'Up' : 'Down'}</div><div class="metric-lbl">${st.up ? 'Up' : 'Down'} since ${timeAgo(st.since).replace(' ago', '')}</div></div>
          <div class="metric"><div class="metric-num">${fmtPct(uptime30(site.id))}</div><div class="metric-lbl">Uptime, 30 days</div></div>
          <div class="metric"><div class="metric-num">${fmtMs(p50)}</div><div class="metric-lbl">Median response</div></div>
          <div class="metric"><div class="metric-num">${fmtMs(p95)}</div><div class="metric-lbl">95th percentile</div></div>
        </div>
        <div class="chart-label">Response time · last ${st.checks.length} checks</div>
        <div class="site-chart">${sparkSVG(st.checks, 64, 'tall')}</div>
        <div class="chart-label">Uptime · last 30 days</div>
        ${uptimeBars(site.id)}
        <div class="chart-label">Latest checks</div>
        <div class="check-list">${checks.map((c) => `<div><span class="feed-dot ${c.ok ? 'green' : 'red'}"></span>${c.code ?? 'timeout'} · ${fmtMs(c.ms)}<span class="when">${clock(c.t)}</span></div>`).join('')}</div>
        <div class="insight-actions" style="margin-top:14px;">
          <button class="btn" data-reports="${site.id}">View reports</button>
          <a class="btn" href="#/reports/${site.id}">Weekly report</a>
        </div>
      </div>`;
    }).join('');
  }

  // ---------- inbox ----------
  function mailSubject(m) {
    const site = siteById(m.siteId);
    return m.kind === 'down' ? `🔴 ${site.name} is down` : m.kind === 'up' ? `✅ ${site.name} is back up` : `📋 Weekly report: ${site.name}`;
  }
  function mailSnippet(m) {
    if (m.kind === 'weekly') { const r = S.reports[m.siteId]; return `Performance ${r.pageSpeed.performance} · Accessibility ${r.pageSpeed.accessibility} · SEO ${r.pageSpeed.seo}`; }
    const inc = incidentById(m.incidentId);
    if (m.kind === 'up') return 'Responding normally again.';
    return `Status code: ${inc.statusCode ?? 'none'}${inc.prKey ? ' · fix PR opened' : ' · no fix PR'}`;
  }
  function renderInbox() {
    const list = S.emails.slice().sort((a, b) => b.at.localeCompare(a.at));
    const selId = route.args[0];
    $('mailLayout').classList.toggle('has-selection', !!selId);
    $('mailList').innerHTML = list.map((m) => `
      <a class="feed-row mail-row ${m.read ? '' : 'unread'} ${m.id === selId ? 'selected' : ''}" href="#/inbox/${m.id}">
        <div class="feed-dot ${m.kind === 'down' ? 'red' : m.kind === 'up' ? 'green' : 'blue'}"></div>
        <div class="feed-text"><span class="site">${esc(mailSubject(m))}</span><br><span class="desc">${esc(mailSnippet(m))}</span></div>
        <div class="feed-time">${timeAgo(m.at)}</div>
      </a>`).join('');
    const m = S.emails.find((e) => e.id === selId);
    if (!m) { $('mailView').innerHTML = `<div class="settings-box">Pick an email to read it. New ones arrive here as scenarios play out.</div>`; return; }
    if (!m.read) { m.read = true; save(); renderChrome(); }
    $('mailView').innerHTML = `
      <a class="btn mail-back" href="#/inbox">← Inbox</a>
      <div class="mail-card">
        <div class="mail-head">
          <div class="mail-subject">${esc(mailSubject(m))}</div>
          <div class="mail-meta">From ${esc(FROM)}<br>To ${esc(TO)} · ${esc(longDate(m.at))}</div>
        </div>
        <div class="mail-body">${mailBody(m)}</div>
      </div>`;
  }

  // Same content and order as the emails check.js and weeklyReport.js send.
  function mailBody(m) {
    const site = siteById(m.siteId);
    if (m.kind === 'down') {
      const inc = incidentById(m.incidentId);
      const pr = inc.prKey && S.prs[inc.prKey];
      return `
        <p><strong>${esc(site.name)}</strong> (${esc(site.url)}) failed its health check at ${esc(inc.timestamp)}.</p>
        <p>Status code: ${inc.statusCode ?? 'none'} ${inc.error ? `— ${esc(inc.error)}` : ''}</p>
        <hr/>
        <p><strong>What Jarvis thinks happened:</strong></p>
        <p>${esc(inc.explanation)}</p>
        ${pr ? `<hr/><p><strong>Jarvis opened a fix PR:</strong> <a href="${prHref(pr)}">${esc(prUrl(pr))}</a></p>
        <p><a class="btn primary" href="#" data-act="approve-confirm" data-pr="${inc.prKey}" data-from="the email">Approve &amp; merge this fix</a></p>`
        : `<hr/><p><strong>No fix PR:</strong> ${esc(inc.noFixReason || 'Fix-PR not attempted.')}</p>`}
        <p><a class="btn" href="#" data-chat="${inc.id}">Discuss this incident in Jarvis</a></p>`;
    }
    if (m.kind === 'up') {
      const inc = incidentById(m.incidentId);
      return `
        <p><strong>${esc(site.name)}</strong> (${esc(site.url)}) is responding normally again.</p>
        <p>It had been down since approximately ${esc(inc.downSince)}.</p>`;
    }
    const r = S.reports[m.siteId];
    const p = r.pageSpeed;
    return `
      <p><strong>${esc(site.name)}</strong> weekly report is ready.</p>
      <p>Performance ${p.performance} · Accessibility ${p.accessibility} · SEO ${p.seo} · Best Practices ${p.bestPractices}</p>
      <p>${esc(r.client).replace(/\n/g, '<br/>')}</p>
      <hr/>
      <p><a href="#/reports/${site.id}">Full technical report</a> · <a href="#" data-act="raw" data-site="${site.id}">Raw data</a></p>`;
  }

  // ---------- PR view (Jarvis's own design, not a copy of any code host) ----------
  function diffLines(a, b) {
    const A = a.replace(/\n$/, '').split('\n'), B = b.replace(/\n$/, '').split('\n');
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: ' ', s: A[i], o: i + 1, n: j + 1 }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', s: A[i], o: i + 1 }); i++; }
      else { out.push({ t: '+', s: B[j], n: j + 1 }); j++; }
    }
    while (i < n) { out.push({ t: '-', s: A[i], o: i + 1 }); i++; }
    while (j < m) { out.push({ t: '+', s: B[j], n: j + 1 }); j++; }
    return out;
  }

  function guardRowsHTML(checks) {
    const word = { pass: 'Passed', fail: 'Failed', skip: 'Not reached', held: 'Held' };
    const dot = { pass: 'green', fail: 'red', skip: 'muted', held: 'blue' };
    return checks.map((c, i) => `
      <div class="feed-row guard-row">
        <div class="feed-dot ${dot[c.state]}"></div>
        <div class="feed-text"><span class="site">${i + 1}. ${esc(RAILS[i])}</span><br><span class="desc">${esc(c.detail)}</span></div>
        <div class="feed-time guard-${c.state}">${word[c.state]}</div>
      </div>`).join('');
  }

  function renderPr() {
    const [siteId, num] = route.args;
    const pr = S.prs[prKey(siteId, Number(num))];
    const el = $('view-pr');
    if (!pr) { el.innerHTML = `<div class="settings-box">That pull request doesn’t exist in this demo. It may have been cleared by Reset.</div>`; return; }
    const site = siteById(pr.siteId);
    const lines = diffLines(pr.before, pr.after);
    const adds = lines.filter((l) => l.t === '+').length, dels = lines.filter((l) => l.t === '-').length;
    const tag = pr.state === 'merged' ? 'Merged' : pr.state === 'merging' ? 'Merging' : 'Fix proposed';
    const actions = pr.state === 'open'
      ? `<button class="btn primary" data-act="approve-confirm" data-pr="${prKey(siteId, pr.number)}" data-from="the PR page">Approve &amp; merge</button>`
      : `<button class="btn primary" disabled>${pr.state === 'merged' ? 'Merged ✓' : 'Merging…'}</button>`;
    el.innerHTML = `
      <div class="insight-card pr-head">
        <div class="insight-top">
          <span class="insight-tag ${pr.state === 'merged' ? 'tag-green' : ''}">${tag}</span>
          <span class="insight-time">Opened by Jarvis ${timeAgo(pr.openedAt)}${pr.mergedAt ? ` · merged ${timeAgo(pr.mergedAt)}` : ''}</span>
        </div>
        <div class="insight-title">${esc(pr.title)}</div>
        <div class="pr-meta">
          <span>${esc(pr.repo)} · PR #${pr.number}</span>
          <span><code>${esc(pr.branch)}</code> → <code>main</code></span>
          <span>1 file · <span class="add">+${adds}</span> <span class="del">−${dels}</span></span>
        </div>
        <div class="insight-actions">
          ${actions}
          ${pr.incidentId ? `<button class="btn" data-chat="${pr.incidentId}">Discuss in Jarvis</button>` : ''}
        </div>
      </div>

      <div class="section-label">Detected issue</div>
      <div class="settings-box prose">
        <p>${esc(pr.explanation)}</p>
        <p><strong>File changed:</strong> <code>${esc(pr.file)}</code> (~${pr.changedLines} line${pr.changedLines === 1 ? '' : 's'})</p>
        <p class="muted">This PR was opened automatically after passing safety checks (single file, small diff). It has ${pr.state === 'merged' ? 'been merged after your approval' : 'NOT been merged. Review the diff, then approve it here, from the email or from Ask Jarvis'}.</p>
      </div>

      <div class="section-label">Guard-rail checks</div>
      <div class="feed">${guardRowsHTML(pr.checks)}</div>

      <div class="section-label">Change · <code>${esc(pr.file)}</code></div>
      <div class="diff" role="table" aria-label="Diff of ${esc(pr.file)}">
        ${lines.map((l) => `<div class="diff-line ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}" role="row"><span class="ln">${l.o ?? ''}</span><span class="ln">${l.n ?? ''}</span><span class="sign">${l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}</span><span class="code">${esc(l.s) || ' '}</span></div>`).join('')}
      </div>
      <div class="pr-foot">Commit: ${esc(pr.commit)} · ${site.name}</div>`;
  }

  // ---------- weekly report ----------
  function trendDelta(t) { const d = t[t.length - 1] - t[0]; return d === 0 ? 'No change' : (d > 0 ? '+' : '−') + Math.abs(d) + ' pts'; }
  function scoreClass(n) { return n >= 90 ? 'green' : n < 60 ? 'red' : ''; }
  function mdToHTML(md) {
    let html = '', inList = false;
    for (const raw of md.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('- ')) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${esc(line.slice(2))}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (line.startsWith('## ')) html += `<h4>${esc(line.slice(3))}</h4>`;
      else if (line) html += `<p>${esc(line)}</p>`;
    }
    return html + (inList ? '</ul>' : '');
  }
  let reportRunning = null;
  function renderReports() {
    const siteId = route.args[0] && siteById(route.args[0]) ? route.args[0] : D.SITES[0].id;
    const site = siteById(siteId);
    const r = S.reports[siteId];
    const p = r.pageSpeed;
    const trendChecks = r.trend.map((v) => ({ ms: v, ok: true }));
    $('view-reports').innerHTML = `
      <div class="report-bar">
        <div class="report-tabs" role="tablist">${D.SITES.map((s) => `<a class="btn ${s.id === siteId ? 'primary' : ''}" href="#/reports/${s.id}" role="tab" aria-selected="${s.id === siteId}">${esc(s.name)}</a>`).join('')}</div>
        <button class="btn" data-act="run-report" ${reportRunning ? 'disabled' : ''}>${reportRunning || 'Run weekly report now'}</button>
      </div>
      <div class="report-sub">${esc(longDate(r.at))} · mobile audit of ${esc(site.pageUrl)}</div>

      <div class="status-strip">
        <div class="status-cell"><div class="num ${scoreClass(p.performance)}">${p.performance}</div><div class="lbl">Performance</div></div>
        <div class="status-cell"><div class="num ${scoreClass(p.accessibility)}">${p.accessibility}</div><div class="lbl">Accessibility</div></div>
        <div class="status-cell"><div class="num ${scoreClass(p.seo)}">${p.seo}</div><div class="lbl">SEO</div></div>
        <div class="status-cell"><div class="num ${scoreClass(p.bestPractices)}">${p.bestPractices}</div><div class="lbl">Best Practices</div></div>
      </div>

      <div class="section-label">For the client</div>
      <div class="insight-card">
        <div class="insight-top"><span class="insight-tag">Client summary</span><span class="insight-time">Emailed ${timeAgo(r.at)}</span></div>
        <div class="insight-body">${esc(r.client).replace(/\n\n/g, '<br><br>')}</div>
      </div>

      <div class="section-label">Checks</div>
      <div class="sites">
        <div class="site-card">
          <div class="site-top"><div><div class="site-name">PageSpeed</div><div class="site-url">Google PageSpeed audit, mobile</div></div></div>
          <div class="site-metrics">
            <div class="metric"><div class="metric-num">${fmtMs(p.lcpMs)}</div><div class="metric-lbl">Largest Contentful Paint</div></div>
            <div class="metric"><div class="metric-num">${p.clsScore}</div><div class="metric-lbl">Cumulative Layout Shift</div></div>
            <div class="metric"><div class="metric-num">${fmtMs(p.tbtMs)}</div><div class="metric-lbl">Total Blocking Time</div></div>
            <div class="metric"><div class="metric-num">${trendDelta(r.trend)}</div><div class="metric-lbl">Performance, 6 weeks</div></div>
          </div>
          <div class="site-chart">${sparkSVG(trendChecks, 34, '', true)}</div>
        </div>
        <div class="site-card">
          <div class="site-top"><div><div class="site-name">Security headers</div><div class="site-url">${r.headers.present.length} of 5 present</div></div>${statusDot(r.headers.missing.length === 0)}</div>
          <div class="check-list">${[...r.headers.present.map((h) => [h, true]), ...r.headers.missing.map((h) => [h, false])].map(([h, ok]) => `<div><span class="feed-dot ${ok ? 'green' : 'red'}"></span>${esc(h)}<span class="when">${ok ? 'present' : 'missing'}</span></div>`).join('')}</div>
        </div>
        <div class="site-card">
          <div class="site-top"><div><div class="site-name">Smoke test</div><div class="site-url">Loaded in a real browser</div></div>${statusDot(r.smoke.loaded && !r.smoke.brokenLinks.length && !r.smoke.consoleErrors.length)}</div>
          <div class="site-metrics">
            <div class="metric"><div class="metric-num">${r.smoke.loaded ? 'Yes' : 'No'}</div><div class="metric-lbl">Page loaded</div></div>
            <div class="metric"><div class="metric-num">${r.smoke.consoleErrors.length}</div><div class="metric-lbl">Console errors</div></div>
            <div class="metric"><div class="metric-num">${r.smoke.brokenLinks.length} / ${r.smoke.linksChecked}</div><div class="metric-lbl">Broken links</div></div>
          </div>
          ${r.smoke.brokenLinks.map((b) => `<div class="report-note">${b.status}: ${esc(b.link)}</div>`).join('')}
        </div>
        <div class="site-card">
          <div class="site-top"><div><div class="site-name">Visual check</div><div class="site-url">Screenshot compared with last week’s</div></div></div>
          <div class="site-metrics"><div class="metric"><div class="metric-num">${r.visual.diffPercent == null ? 'New baseline' : r.visual.diffPercent + '%'}</div><div class="metric-lbl">Pixels changed</div></div></div>
          <div class="report-note">${esc(r.visual.note)}</div>
        </div>
      </div>

      <div class="section-label">Technical report</div>
      <div class="settings-box prose">${mdToHTML(r.technical)}<p><a href="#" data-act="raw" data-site="${siteId}">Raw data</a></p></div>`;
  }

  function runWeeklyReport() {
    if (reportRunning) return;
    const stages = ['Running PageSpeed…', 'Checking headers…', 'Smoke testing…', 'Comparing screenshots…', 'Writing reports…'];
    let i = 0;
    const tick = () => {
      if (i < stages.length) { reportRunning = stages[i++]; render(); setTimeout(tick, 650); return; }
      reportRunning = null;
      const base = Date.now();
      D.SITES.forEach((site, k) => {
        const r = S.reports[site.id];
        const at = new Date(base + k * 1000).toISOString();
        const d = Math.round((Math.random() - 0.5) * 4);
        r.pageSpeed.performance = Math.max(1, Math.min(100, r.pageSpeed.performance + d));
        r.trend = [...r.trend.slice(1), r.pageSpeed.performance];
        r.at = at;
        S.emails.push({ id: nextId(), kind: 'weekly', siteId: site.id, at, read: false });
      });
      commit();
      toast(`4 new emails · 📋 Weekly reports`, '#/inbox');
    };
    tick();
  }

  // ---------- modals, toast ----------
  function openModal(title, bodyHTML, extraHTML = '', closeLabel = 'Close') {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHTML;
    $('modalExtra').innerHTML = extraHTML;
    $('modalClose').textContent = closeLabel;
    $('modalBackdrop').classList.add('open');
  }
  const closeModal = () => $('modalBackdrop').classList.remove('open');

  // Production "View reports" modal: this site's incident history.
  function openReportsModal(siteId) {
    const site = siteById(siteId);
    const reports = S.incidents.filter((i) => i.siteId === siteId).slice().reverse();
    openModal(site.name + ' — Reports', reports.length === 0
      ? 'No reports yet for this site.'
      : reports.map((i) => {
          const label = i.event === 'down' ? 'Down' : 'Recovered';
          const detail = i.explanation ? ' — ' + esc(i.explanation) : '';
          const pr = i.prKey ? ` <a href="${prHref(S.prs[i.prKey])}">View fix PR</a>` : '';
          return `<strong>${label}</strong> · ${timeAgo(i.timestamp)}${detail}${pr}<br/><br/>`;
        }).join(''));
  }

  // Mirrors api/approve.js: a link never merges on its own; you confirm first.
  function confirmMerge(key, from) {
    const pr = S.prs[key];
    if (!pr) return;
    if (pr.state !== 'open') {
      openModal('Already merged', `PR #${pr.number} on ${esc(pr.repo)} has already been merged.`);
      return;
    }
    openModal(`Merge fix for ${pr.repo}?`,
      `This merges PR #${pr.number} into main and redeploys the site. Review the diff first if you haven’t already.`,
      `<div class="insight-actions modal-actions"><button class="btn primary" data-act="approve" data-pr="${key}" data-from="${esc(from)}">Confirm merge</button><a class="btn" href="${prHref(pr)}">Review the diff</a></div>`,
      'Cancel');
  }

  function showGuard(incId) {
    const inc = incidentById(incId);
    if (!inc || !inc.guard) return;
    openModal(`Guard rails · ${inc.site}`, esc(inc.noFixReason || ''), `<div class="feed modal-feed">${guardRowsHTML(inc.guard)}</div>`);
  }

  function showRaw(siteId) {
    const r = S.reports[siteId];
    const raw = { pageSpeed: r.pageSpeed, headers: r.headers, smoke: r.smoke, visual: r.visual };
    openModal(`${siteById(siteId).name} — raw.json`, 'What the weekly report stores alongside the two write-ups.', `<pre class="raw">${esc(JSON.stringify(raw, null, 2))}</pre>`);
  }

  function showAbout() {
    openModal('About this demo',
      `Jarvis is a real site monitor I built and run for small-business sites. This is a fully simulated copy: four fictional sites, a pretend model, pretend GitHub, pretend email. Nothing here makes a network request, and nothing real is monitored or changed.`,
      `<div class="about">
        <p><strong>Real:</strong> the dashboard’s design, the alert email layout, the order of the loop, and Jarvis’s guard-rail code (route-to-file lookup, one-file find-and-replace fixes, the 15-line limit) running against fictional files.</p>
        <p><strong>Simulated:</strong> health checks, the model’s explanations and Ask Jarvis replies (scripted), pull requests, merges, redeploys, emails and weekly audits.</p>
        <p><a href="${REAL_REPO}" target="_blank" rel="noopener">See the real code on GitHub →</a></p>
      </div>`);
  }

  let toastTimer;
  function toast(text, href) {
    const el = $('toast');
    el.textContent = text;
    el.dataset.href = href || '';
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  // ---------- router ----------
  const TITLES = { overview: 'Overview', sites: 'Sites', incidents: 'Incidents', inbox: 'Inbox', pr: 'Fix PR', reports: 'Weekly report' };
  function onRoute() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'overview').split('/');
    const view = TITLES[parts[0]] ? parts[0] : 'overview';
    const prev = route.view;
    route = { view, args: parts.slice(1) };
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    const navView = view === 'pr' ? 'incidents' : view;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === navView));
    $('topbarTitle').textContent = view === 'pr' && route.args[1] ? `Fix PR #${route.args[1]}` : TITLES[view];
    closeModal();
    render();
    if (prev !== view || view === 'pr' || (view === 'inbox' && innerWidth <= 780)) window.scrollTo(0, 0);
  }

  function filterSites(query) {
    const q = query.trim().toLowerCase();
    const cards = document.querySelectorAll('#siteGrid .site-card');
    let visibleCount = 0;
    cards.forEach((card) => {
      const match = card.dataset.name.includes(q);
      card.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });
    $('noResults').style.display = visibleCount === 0 ? 'block' : 'none';
  }

  function reset() {
    Object.values(timers).forEach(clearTimeout);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    S = seed();
    save();
    reportRunning = null;
    if (location.hash === '#/overview') onRoute(); else location.hash = '#/overview';
    window.dispatchEvent(new Event('jarvis:state'));
    window.dispatchEvent(new Event('jarvis:reset'));
    toast('Demo reset · fresh fictional data');
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-chat],[data-reports]');
    const inBell = $('notifBtn').contains(e.target);
    if (inBell && !t) { $('notifDropdown').classList.toggle('open'); return; }
    $('notifDropdown').classList.remove('open');
    if (!t) return;
    if (t.dataset.chat) { e.preventDefault(); const inc = incidentById(t.dataset.chat); if (inc && window.jarvisOpenChatFor) { closeModal(); window.jarvisOpenChatFor(inc.site, inc.timestamp); } return; }
    if (t.dataset.reports) { openReportsModal(t.dataset.reports); return; }
    const act = t.dataset.act;
    if (act === 'break') startScenario(t.dataset.sc);
    else if (act === 'approve') {
      if (approve(t.dataset.pr, t.dataset.from || 'the Jarvis loop')) {
        const pr = S.prs[t.dataset.pr];
        openModal('Merged', `PR #${pr.number} was merged and the site is redeploying now. Watch it recover in the Jarvis loop.`, `<div class="insight-actions modal-actions"><a class="btn" href="#/overview" data-act="goto-loop">Watch the loop</a></div>`, 'Close');
      }
    } else if (act === 'approve-confirm') { e.preventDefault(); confirmMerge(t.dataset.pr, t.dataset.from); }
    else if (act === 'manual-fix') manualFix(t.dataset.run);
    else if (act === 'guard') showGuard(t.dataset.inc);
    else if (act === 'raw') { e.preventDefault(); showRaw(t.dataset.site); }
    else if (act === 'run-report') runWeeklyReport();
    else if (act === 'dismiss-insight') { S.dismissedInsight = t.dataset.id; commit(); }
    else if (act === 'about') showAbout();
    else if (act === 'reset') reset();
    else if (act === 'goto-break' || act === 'goto-loop') {
      e.preventDefault();
      closeModal();
      if (route.view !== 'overview') location.hash = '#/overview';
      setTimeout(() => $(act === 'goto-break' ? 'breakSection' : 'loopFeed').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  });
  $('notifBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('notifDropdown').classList.toggle('open'); } });
  $('modalClose').addEventListener('click', closeModal);
  $('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  $('searchInput').addEventListener('input', (e) => filterSites(e.target.value));
  $('toast').addEventListener('click', () => { const h = $('toast').dataset.href; $('toast').classList.remove('show'); if (h) location.hash = h; });
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('storage', (e) => { if (e.key === KEY) { S = load(); render(); } });

  // ---------- boot ----------
  S = load();
  $('topbarSub').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  // A first check right away so the badge reads "Live" at once, then on a timer.
  setTimeout(scheduledCheck, 1500);
  setInterval(scheduledCheck, CHECK_EVERY_MS);
  setInterval(renderChrome, 15000);
  // Resume anything that was mid-scenario when the page was closed or reloaded.
  S.runs.filter((r) => r.phase === 'running' || r.phase === 'recovering').forEach((r) => schedule(r, 800));
  onRoute();

  // What chat.js needs.
  window.JarvisDemo = {
    incidents: () => S.incidents,
    incidentByKey: (k) => S.incidents.find((i) => chatKey(i) === k),
    chatKey,
    history: (k) => S.chats[k] || [],
    setHistory: (k, h) => { S.chats[k] = h; save(); },
    pr: (k) => S.prs[k],
    prHref,
    approve: (k) => approve(k, 'Ask Jarvis'),
    QA: D.QA,
    FALLBACK: D.FALLBACK,
    timeAgo, fmtMs,
  };
})();
