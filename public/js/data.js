// data.js — the fictional world the demo runs on.
//
// Every site, repository, file, person and number here is made up. Domains use
// the reserved .example TLD, so none of them can resolve to a real server.
// Nothing in this file is copied from the private Jarvis instance.

window.DEMO_DATA = (function () {
  const NB = ' '; // narrow no-break space, as the model writes "212 ms"

  // ---------- The four monitored sites (stand-in for sites.json) ----------
  const SITES = [
    {
      id: 'northbank',
      name: 'Northbank Physio booking',
      url: 'https://book.northbank.example/api/health',
      shortUrl: 'book.northbank.example',
      pageUrl: 'https://book.northbank.example/',
      repo: 'northbank/booking',
      baseMs: 190,
      spread: 45,
    },
    {
      id: 'cafe',
      name: 'Harbour Lane Café',
      url: 'https://harbourlane-cafe.example/api/health',
      shortUrl: 'harbourlane-cafe.example',
      pageUrl: 'https://harbourlane-cafe.example/',
      repo: 'harbour-lane/cafe-site',
      baseMs: 135,
      spread: 30,
    },
    {
      id: 'painting',
      name: 'Brushline Painting',
      url: 'https://brushline-painting.example/',
      shortUrl: 'brushline-painting.example',
      pageUrl: 'https://brushline-painting.example/',
      repo: 'brushline/website',
      baseMs: 430,
      spread: 90,
    },
    {
      id: 'sandbox',
      name: 'Jarvis Sandbox',
      url: 'https://sandbox.jarvis.example/api/health',
      shortUrl: 'sandbox.jarvis.example',
      pageUrl: 'https://sandbox.jarvis.example/',
      repo: 'jarvis/sandbox',
      baseMs: 160,
      spread: 35,
    },
  ];

  // ---------- Fictional repository contents (what Jarvis can "read") ----------
  // `healthy` is main before the scenario breaks it; the scenario swaps in
  // `broken`. Paths not listed don't exist in that repo.
  const REPOS = {
    'northbank/booking': {
      'api/health.js': {
        healthy:
`// Health check for the booking site: confirms the clinic diary is reachable.
import { getDiaryStatus } from '../lib/diary.js';

export default async function handler(req, res) {
  const diary = await getDiaryStatus();
  res.status(200).json({
    ok: true,
    diaryReachable: diary.reachable,
    openSlotsToday: diary.slots.length,
  });
}
`,
        broken:
`// Health check for the booking site: confirms the clinic diary is reachable.
import { getDiaryStatus } from '../lib/diary.js';

export default async function handler(req, res) {
  const diary = getDiaryStatus();
  res.status(200).json({
    ok: true,
    diaryReachable: diary.reachable,
    openSlotsToday: diary.slots.length,
  });
}
`,
      },
      'lib/diary.js': {
        healthy:
`// Talks to the clinic diary. Every call is async: it goes over the network.
export async function getDiaryStatus() {
  const res = await fetch(process.env.DIARY_URL + '/status');
  return res.json();
}
`,
      },
    },

    'harbour-lane/cafe-site': {
      // api/health.js existed before the break; the scenario deletes it.
      'api/health.js': {
        healthy:
`// Kept so the uptime monitor's URL keeps working. Same as /api/status.
export { default } from './status.js';
`,
        broken: null,
      },
      'api/status.js': {
        healthy:
`// Returns 200 while the site and today's menu are being served.
export default function handler(req, res) {
  res.status(200).json({ ok: true, menu: 'loaded' });
}
`,
      },
      'vercel.json': {
        healthy:
`{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/menu", "destination": "/menu.html" }
  ]
}
`,
      },
    },

    'brushline/website': {
      'index.html': { healthy: '<!-- static homepage: hero photos, quote widget, reviews feed -->\n' },
    },

    'jarvis/sandbox': {
      'api/health.js': {
        healthy:
`import { db } from '../lib/db.js';

export default async function handler(req, res) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const { rows } = await db.query('select 1 as ok');
  res.status(200).json({ ok: rows[0].ok === 1 });
}
`,
      },
      'lib/db.js': {
        healthy:
`import { createPool } from './pool.js';

export const db = createPool(process.env.DATABASE_URL);
`,
      },
    },
  };

  // ---------- The four "Break a site" scenarios ----------
  const SCENARIOS = [
    {
      id: 'await',
      siteId: 'northbank',
      title: 'Missing await crashes the health check',
      short: 'A deploy drops one await. The health check returns 500.',
      commit: 'Tidy health check',
      statusCode: 500,
      responseTimeMs: 212,
      error: null,
      // What the model is asked to fix, in the real old_str/new_str format.
      fix: {
        file: 'api/health.js',
        oldStr: '  const diary = getDiaryStatus();',
        newStr: '  const diary = await getDiaryStatus();',
      },
      explanation:
`A 500 status means the server hit an unhandled error while processing the health‑check request, and the 212${NB}ms response time shows the request actually reached your code before it crashed. This most often points to a runtime exception in the /api/health handler itself, such as a value being used before it's ready or a failed connection to the diary, rather than a hosting or network problem. First, look at the function logs for the exact error stack trace at the time of the failure. Then check what changed in api/health.js, or anything it imports, in the most recent deploy.`,
      logError: "TypeError: Cannot read properties of undefined (reading 'length')\n    at handler (api/health.js:9:34)",
    },
    {
      id: 'deleted',
      siteId: 'cafe',
      title: 'Health file deleted',
      short: 'A clean-up commit deletes api/health.js. The check gets a 404.',
      commit: 'Remove duplicate API route',
      statusCode: 404,
      responseTimeMs: 96,
      error: null,
      fix: {
        file: 'vercel.json',
        oldStr: '  "rewrites": [',
        newStr: '  "rewrites": [\n    { "source": "/api/health", "destination": "/api/status" },',
      },
      explanation:
`A 404 from the /api/health URL means the request is reaching the host but the route isn't defined any more, so the server can't find the endpoint at all. The quick 96${NB}ms response fits that: nothing crashed, there is simply nothing at that path. This usually points to a missing or renamed file (for example api/health.js) or a routing or rewrite rule that changed in the latest deploy. First, check whether the health‑check file still exists in the repository. Then look at vercel.json to make sure /api/health is still mapped to a handler.`,
    },
    {
      id: 'slow',
      siteId: 'painting',
      title: 'Slow response (latency spike)',
      short: 'The homepage slows down until a check times out. Alert only.',
      statusCode: null,
      responseTimeMs: 10003,
      error: 'The operation was aborted due to timeout',
      ramp: [1910, 4620, 8740],
      recover: [3120, 880, 440],
      explanation:
`No status code came back because the request was still waiting when the 10‑second timeout hit, so the site isn't throwing an error, it's answering too slowly to count as up. Response times had been climbing over the previous checks (1.9${NB}s, 4.6${NB}s, 8.7${NB}s), which points to something slow outside the code, such as an overloaded host, a third‑party script or API the homepage waits on, like the quote widget or reviews feed, or a very heavy uncached page. First, open the homepage yourself and see whether it hangs on one element. Then check the host's status page and any third‑party services the page calls before changing any code.`,
    },
    {
      id: 'twofiles',
      siteId: 'sandbox',
      title: 'A fix that would touch two files',
      short: 'An env var is renamed. A proper fix needs two files, so Jarvis refuses.',
      commit: 'Switch to the managed Postgres integration',
      statusCode: 500,
      responseTimeMs: 148,
      error: null,
      // What the model came back with. It needs two files, so it's rejected.
      proposed: [
        { file: 'api/health.js', oldStr: "  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');", newStr: "  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is not set');" },
        { file: 'lib/db.js', oldStr: 'export const db = createPool(process.env.DATABASE_URL);', newStr: 'export const db = createPool(process.env.POSTGRES_URL);' },
      ],
      explanation:
`A 500 status means the health‑check handler threw an error, and the quick 148${NB}ms response shows it failed early, before doing any real work, rather than timing out. Failing that fast usually means something the handler needs at start‑up is missing, most often an environment variable, a database connection string or a secret that was renamed or removed. First, check the function logs for the exact error message at the time of the failure. Then compare the environment variables in the hosting settings with the names the code reads, especially anything changed in the latest deploy.`,
    },
  ];

  // ---------- Ask Jarvis: scripted answers ----------
  // Each incident type has three suggested questions. Free text is matched on
  // keywords; anything else gets an honest "scripted demo" reply.
  const QA = {
    await: [
      { q: 'Why a 500 and not a 404?', k: ['404', '500', 'why a'], a: "A 404 would mean nothing exists at /api/health. Here the route exists and your code ran: it got 212 ms in and then threw. getDiaryStatus() is async, and without await, diary is still a Promise. diary.slots is undefined, so reading .length throws a TypeError, and an uncaught error in a handler becomes a 500." },
      { q: 'Is it safe to merge?', k: ['safe', 'merge', 'approve', 'risk'], a: "Yes. The PR changes one line in one file, api/health.js, putting back the await in front of getDiaryStatus(). Nothing else moves, so the response shape is exactly what it was before the last deploy. It's on its own branch and nothing reaches main until you approve. Once merged, the site redeploys and I recheck straight away." },
      { q: 'What should I check first?', k: ['check', 'first', 'log', 'look'], a: "The function logs for /api/health around the failure time. You should see \"Cannot read properties of undefined (reading 'length')\" at api/health.js line 9. Then look at the \"Tidy health check\" commit: it's the only change to that file and it removed the await." },
    ],
    deleted: [
      { q: 'Why a 404 and not a 500?', k: ['404', '500', 'why a'], a: "Nothing crashed. The host answered in 96 ms and said there's no route at /api/health. A 500 needs code to run and fail; a 404 means there was no code to run. That matches the \"Remove duplicate API route\" commit, which deleted api/health.js." },
      { q: 'Why not just restore the file?', k: ['restore', 'file', 'delete', 'why not', 'rewrite'], a: "I only ever edit a file that already exists, as a small find-and-replace. I never create or rewrite whole files. api/health.js was a one-line re-export of api/status.js, so the smallest safe fix is one line in vercel.json that sends /api/health to /api/status. Same response, no new file. If you'd rather restore the file, close the PR and do it by hand." },
      { q: 'Is it safe to merge?', k: ['safe', 'merge', 'approve', 'risk'], a: "Yes. It adds one rewrite to vercel.json and leaves the /menu rewrite as it is. api/status.js already returns { ok: true }, so the monitor gets a 200 again. It's one file, well under the 15-line limit, and on its own branch until you approve." },
    ],
    slow: [
      { q: 'Why no fix PR?', k: ['pr', 'fix', 'why no', 'why not', 'code'], a: "A timeout doesn't point at a file. The monitored URL is the homepage, so there's no route-to-file match, and when I asked the model for the single most likely file it said UNKNOWN. With no confident file, I fail closed: an alert, no PR. Slowness like this is usually the host, a third-party script or a heavy page, not a line of code." },
      { q: 'Why did it only alert at 10 seconds?', k: ['10', 'second', 'alert', 'timeout', 'only', 'slow'], a: "Each check waits up to 10 seconds. A slow page that still returns a 200 counts as up, so the 1.9 s, 4.6 s and 8.7 s checks were logged but didn't email you. When a check passes 10 s, it counts as down with no status code. I only email on a change, from up to down or down to up, so a long slow spell doesn't fill your inbox." },
      { q: 'What should I check first?', k: ['check', 'first', 'log', 'look'], a: "Open the homepage on your phone and watch what loads last. The quote widget and reviews feed are the usual suspects on Brushline. Then check the host's status page. If it settled down by itself, as it did here, look at last week's report too: Performance was 58 with a 4.6 s LCP, so the hero photos are worth compressing anyway." },
    ],
    twofiles: [
      { q: "Why didn't you open a PR?", k: ['pr', 'why', 'open', 'didn'], a: "The model's fix needed two files: api/health.js and lib/db.js both read DATABASE_URL, and the hosting settings now only have POSTGRES_URL. Rule 2 says a fix may change one file only. Patching just one of them would hide the problem, so I failed closed: flagged for manual review, no PR opened." },
      { q: 'What should I check first?', k: ['check', 'first', 'log', 'look', 'env'], a: "The environment variables in the sandbox's hosting settings. The \"Switch to the managed Postgres integration\" deploy replaced DATABASE_URL with POSTGRES_URL. The quickest fix is to add DATABASE_URL back with the same value and redeploy. The tidier fix is renaming it in both files, and that's a change for you to make, not me." },
      { q: 'Which guard rail stopped it?', k: ['guard', 'rail', 'rule', 'stop', 'safe'], a: "Rule 2: one file only. Rule 5 then decided what happened next: when anything is ambiguous or fails, no PR, just a note in the email. The other rules held too: main was never touched, the token can only reach the monitored sites' repos, and nothing was committed anywhere." },
    ],
    // Seeded history and recoveries
    'generic-500': [
      { q: 'Why a 500 and not a 404?', k: ['404', '500', 'why a'], a: "A 404 means there's no route. A 500 means the route exists and the code behind it threw. The fast response time says it failed early in the handler rather than waiting on something slow." },
      { q: 'What fixed it?', k: ['fix', 'merge', 'pr', 'resolved'], a: "The fix PR linked above changed one line in one file. It was approved and merged, the site redeployed, and the next check came back 200." },
      { q: 'What should I check first?', k: ['check', 'first', 'log', 'look'], a: "If it comes back: the function logs for /api/health at the failure time, then the last deploy's changes to the health handler or anything it imports." },
    ],
    'generic-404': [
      { q: 'Why a 404 and not a 500?', k: ['404', '500', 'why a'], a: "The host answered quickly and said there's nothing at that path. No code ran, so nothing could crash. It's a routing or missing-file problem, not a runtime error." },
      { q: 'Why was there no fix PR?', k: ['pr', 'why', 'fix'], a: "I couldn't narrow it to one file with confidence, so I failed closed and left it to you. It recovered a few minutes later after a redeploy." },
      { q: 'What should I check first?', k: ['check', 'first', 'log', 'look'], a: "Whether the health-check file is in the latest deploy, then any routing or rewrite changes made around the same time." },
    ],
    'generic-timeout': [
      { q: 'Why no fix PR?', k: ['pr', 'fix', 'why'], a: "A timeout has no status code and no file to point at, so there was nothing safe to change. I sent the alert and left it there." },
      { q: 'Why did it recover on its own?', k: ['recover', 'own', 'itself', 'back'], a: "Nothing in the code changed, so the slowness was outside it: most likely the host or a third-party service the homepage waits on. Once that cleared, checks came back well under a second." },
      { q: 'What should I check first?', k: ['check', 'first', 'log', 'look'], a: "The host's status history for that window, then the homepage's third-party scripts. The weekly report's LCP figure is a good early warning for this." },
    ],
    up: [
      { q: 'How long was it down?', k: ['long', 'down', 'time', 'duration'], a: null }, // filled in at runtime
      { q: 'What fixed it?', k: ['fix', 'what', 'resolved'], a: null },
      { q: 'Could it happen again?', k: ['again', 'happen', 'prevent'], a: null },
    ],
  };

  const FALLBACK = "This demo uses scripted answers, so I can only cover a few questions about each incident. Try one of the suggestions below. In the real dashboard, your question goes to the model along with this incident's details.";

  // ---------- Seeded history (relative to when the demo is first opened) ----------
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const HISTORY = [
    {
      siteId: 'cafe', ago: 19 * DAY + 3 * HOUR, downFor: 4 * MIN, type: 'generic-404', statusCode: 404, responseTimeMs: 88,
      explanation: `A 404 from /api/health means the host answered but there's no route at that path, so the request never reached any of your code. That usually follows a deploy where a file was renamed or moved, or a rewrite rule changed. First, confirm the health‑check file is in the latest deploy. Then check whether a build or routing change around that time stopped /api/health from being served.`,
      noFixReason: 'Could not confidently identify a single file to check.',
    },
    {
      siteId: 'northbank', ago: 12 * DAY + 6 * HOUR, downFor: 21 * MIN, type: 'generic-500', statusCode: 500, responseTimeMs: 189,
      explanation: `A 500 status means the server hit an unhandled error while processing the health‑check request, and the 189${NB}ms response time shows the request reached your code before it failed. That usually means a runtime exception in the handler or something it depends on, such as the diary connection, an expired API key or a missing environment variable. First, look at the function logs for the exact stack trace at the time of the failure. Then check whether anything the health check depends on changed in the most recent deploy.`,
      pr: { number: 13, file: 'api/health.js', title: 'Jarvis auto-fix: Northbank Physio booking down',
        before: `import { getDiaryStatus } from '../lib/diary.js';\n\nexport default async function handler(req, res) {\n  const diary = await getDiaryStatus();\n  res.status(200).json({ ok: true, diaryReachable: diary.reachable, openSlotsToday: diary.slot.length });\n}\n`,
        oldStr: 'openSlotsToday: diary.slot.length', newStr: 'openSlotsToday: diary.slots.length' },
    },
    {
      siteId: 'sandbox', ago: 9 * DAY + 2 * HOUR, downFor: 14 * MIN, type: 'generic-500', statusCode: 500, responseTimeMs: 143,
      explanation: `A 500 status means the health‑check handler threw an error, and the quick 143${NB}ms response shows it failed early rather than timing out. That usually points to a code change that throws, like calling something that isn't defined or reading a property of a missing value. First, check the function logs for the stack trace. Then compare api/health.js with the previous deploy.`,
      pr: { number: 22, file: 'api/health.js', title: 'Jarvis auto-fix: Jarvis Sandbox down',
        before: `import { db } from '../lib/db.js';\n\nexport default async function handler(req, res) {\n  const { rows } = await db.query('select 1 as ok');\n  res.status(200).json({ ok: rows[0].ok === 1, checkedAt: new Date().toISOStrin() });\n}\n`,
        oldStr: 'new Date().toISOStrin()', newStr: 'new Date().toISOString()' },
    },
    {
      siteId: 'painting', ago: 5 * DAY + 4 * HOUR, downFor: 34 * MIN, type: 'generic-timeout', statusCode: null, responseTimeMs: 10004, error: 'The operation was aborted due to timeout',
      explanation: `No status code came back because the request was still waiting when the 10‑second timeout hit, so the page didn't fail with an error, it just didn't finish in time. That pattern usually points to a slow host, a slow third‑party script or API the homepage waits on, or a very heavy uncached page. First, load the homepage yourself and see whether it hangs on one element. Then check the host's status page and any third‑party services the page calls.`,
      noFixReason: 'Could not confidently identify a single file to check.',
    },
    {
      siteId: 'sandbox', ago: 2 * DAY + 5 * HOUR, downFor: 6 * MIN, type: 'generic-404', statusCode: 404, responseTimeMs: 74,
      explanation: `A 404 from /api/health means the request reached the host but no route matches it, so none of your code ran. The fast response time fits a missing route rather than a crash. This usually follows a deploy that renamed or moved the handler, or a routing change. First, check the latest deploy's file list for api/health.js. Then look for any rewrite or framework routing change made at the same time.`,
      noFixReason: 'Could not confidently identify a single file to check.',
    },
  ];

  // ---------- Weekly reports (stand-in for weeklyReport.js output) ----------
  const REPORTS = {
    northbank: {
      pageSpeed: { performance: 94, accessibility: 100, seo: 100, bestPractices: 100, lcpMs: 1420, clsScore: 0.01, tbtMs: 40 },
      headers: { present: ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy', 'referrer-policy'], missing: [] },
      smoke: { loaded: true, title: 'Book an appointment · Northbank Physio', consoleErrors: [], brokenLinks: [], linksChecked: 8 },
      visual: { diffPercent: 0.3, note: '0.3% of pixels changed since last week.' },
      trend: [91, 93, 92, 94, 93, 94],
      client:
`Your booking site had a good week. It stayed up, loaded quickly on phones, and every page we tested worked as expected.

There were no outages this week, and the page looks the same as last week apart from the "next available" date.

Nothing needs doing from your side this week.`,
      technical:
`## Summary
Healthy. No action needed.

## Performance (mobile)
- Performance 94, Accessibility 100, SEO 100, Best Practices 100
- LCP 1.4 s, CLS 0.01, TBT 40 ms

## Security headers
All five expected headers present.

## Smoke test
Page loaded, 0 console errors, 0 broken links out of 8 checked.

## Visual regression
0.3% of pixels changed (the date in the "next available" banner). Expected.`,
    },
    cafe: {
      pageSpeed: { performance: 78, accessibility: 92, seo: 91, bestPractices: 96, lcpMs: 2890, clsScore: 0.08, tbtMs: 120 },
      headers: { present: ['strict-transport-security', 'x-content-type-options'], missing: ['x-frame-options', 'content-security-policy', 'referrer-policy'] },
      smoke: { loaded: true, title: 'Harbour Lane Café · Coffee & brunch', consoleErrors: ['Failed to load resource: the server responded with a status of 404 (/menu/autumn.pdf)'], brokenLinks: [{ link: 'https://harbourlane-cafe.example/menu/autumn.pdf', status: 404 }], linksChecked: 8 },
      visual: { diffPercent: 6.2, note: '6.2% of pixels changed since last week.' },
      trend: [80, 79, 81, 78, 77, 78],
      client:
`The café site is up and loads reasonably quickly, though photos on the menu page could load faster on phones.

One thing to fix: the "Autumn menu" link points to a PDF that isn't there any more, so anyone tapping it sees an error page. The homepage also looks a little different from last week, which we think is the new seasonal banner.

We'd also like to add a few standard security settings to the site. It's a small change with no visible difference to customers.`,
      technical:
`## Summary
Up, with two items to action.

## Needs action
- Broken link: /menu/autumn.pdf returns 404 (also logged as a console error)
- Missing security headers: x-frame-options, content-security-policy, referrer-policy

## Performance (mobile)
- Performance 78, Accessibility 92, SEO 91, Best Practices 96
- LCP 2.9 s (menu hero image, 640 KB JPEG), CLS 0.08, TBT 120 ms

## Visual regression
6.2% of pixels changed, concentrated in the header. Consistent with the new seasonal banner. Confirm it was intended.`,
    },
    painting: {
      pageSpeed: { performance: 58, accessibility: 88, seo: 92, bestPractices: 92, lcpMs: 4620, clsScore: 0.21, tbtMs: 380 },
      headers: { present: ['strict-transport-security', 'x-content-type-options', 'x-frame-options'], missing: ['content-security-policy', 'referrer-policy'] },
      smoke: { loaded: true, title: 'Brushline Painting · Interior & exterior painting', consoleErrors: [], brokenLinks: [], linksChecked: 8 },
      visual: { diffPercent: 0, note: '0% of pixels changed since last week.' },
      trend: [64, 61, 60, 59, 57, 58],
      client:
`The website is up and working, but it's slow to load on phones. That's mostly the large project photos at the top of the homepage, and it can cost you enquiries from people who give up waiting.

There was also a half-hour spell last week when the site was too slow to load at all. It recovered without any changes, which points to the hosting or the reviews widget rather than the site itself.

We recommend compressing the homepage photos. It's a quick job and should make a noticeable difference.`,
      technical:
`## Summary
Up, but slow. Performance has dropped six points over six weeks.

## Needs action
- LCP 4.6 s: hero carousel loads three full-size JPEGs (2.1 MB total). Serve resized WebP versions and lazy-load slides 2 and 3.
- CLS 0.21: the reviews widget injects above the fold without reserved space.
- TBT 380 ms: the third-party quote widget's script blocks the main thread.

## Security headers
Missing: content-security-policy, referrer-policy.

## Smoke test
Page loaded, 0 console errors, 0 broken links out of 8 checked.

## Visual regression
No change since last week.`,
    },
    sandbox: {
      pageSpeed: { performance: 99, accessibility: 100, seo: 100, bestPractices: 100, lcpMs: 610, clsScore: 0, tbtMs: 0 },
      headers: { present: ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy'], missing: ['content-security-policy'] },
      smoke: { loaded: true, title: 'Jarvis sandbox', consoleErrors: [], brokenLinks: [], linksChecked: 2 },
      visual: { diffPercent: null, note: 'Page dimensions changed since last week — skipping pixel comparison, new baseline stored.' },
      trend: [99, 100, 99, 99, 100, 99],
      client:
`The sandbox is the test site Jarvis is tried out on, so it's broken on purpose from time to time. This week it's up and fast.`,
      technical:
`## Summary
Healthy. Sandbox site, broken deliberately to test Jarvis.

## Performance (mobile)
- Performance 99, Accessibility 100, SEO 100, Best Practices 100

## Security headers
Missing: content-security-policy.

## Visual regression
Page dimensions changed, so no pixel comparison was made and a new baseline was stored.`,
    },
  };

  return { SITES, REPOS, SCENARIOS, QA, FALLBACK, HISTORY, REPORTS, MIN, HOUR, DAY };
})();
