const express = require('express');

// Grist API key: server variable GRIST_API_KEY (no VITE_ prefix, which would
// send it to the browser bundle). Deprecated fallback on the old name.
const GRIST_API_KEY = process.env.GRIST_API_KEY || process.env.VITE_GRIST_API_KEY || '';
if (!GRIST_API_KEY) {
  console.error('[Druid] GRIST_API_KEY missing: set it in docker/druid/.env (no hard-coded fallback).');
} else if (!process.env.GRIST_API_KEY) {
  console.warn('[Druid] VITE_GRIST_API_KEY is deprecated: rename the variable to GRIST_API_KEY in .env and druid.yaml.');
}
const session = require('express-session');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Bypassing SSL verification for internal network proxying to Grist
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Keycloak / OAuth2 config (server-side — no Web Crypto needed)
// Deployment URLs come from the environment (druid.yaml for Nantes); the defaults suit local development.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'crisalid-inst';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'druid';
const APP_URL = process.env.APP_URL || 'http://localhost:3006';
const KC_BASE = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect`;
const KC_ADMIN_BASE = `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}`;
const CALLBACK_URI = `${APP_URL}/auth/callback`;

// Rights management — CRISalid proposal (Keycloak group tree under the
// institution, leaf = role shared by all the apps:
// admin, dashboard_viewer, document_viewer…). Druid assigns no rights,
// it interprets the token's `groups` claim (full group path). See the session
// plan for details: https://crisalid-esr.github.io/SVP-mockups/fr/rights/.
const ESTABLISHMENT_GROUP = process.env.KEYCLOAK_ESTABLISHMENT_GROUP || 'NantesUniversite';
const KEYCLOAK_ADMIN_CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID || '';
const KEYCLOAK_ADMIN_CLIENT_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || '';
// « Generic » lab right (option 2 of the rights work, 2026-09-16): a single
// group `/NantesUniversite/labo_viewer` — the person's lab is not carried
// by Keycloak but derived from their Grist Annuaire record at login
// (resolveAnnuaireLabs: rows with uid_dyna = preferred_username). Coexists with
// the per-lab groups (`/NantesUniversite/<labo>/dashboard_viewer`).
// Since 2026-09-16 this right is also IMPLICIT: any logged-in user without
// any Druid right (neither institution nor lab group) is treated as
// labo_viewer — the LDAP federation imported the university's ~93,000 accounts
// into Keycloak; a default group would only have affected new accounts.
// The group is still accepted (readability) but does not need to be filled.
const LAB_VIEWER_GROUP = process.env.KEYCLOAK_LAB_VIEWER_GROUP || 'labo_viewer';

// Capabilities derived from the present config (docs/plan-architecture-multi-instances.md,
// lot 1) — replaces, on the Centrale side, the old single flag VITE_HIDE_NANTES_FEATURES with
// one flag per integration. Computed once at startup from the variables/volumes actually
// configured on THIS instance (not from the fallback defaults used further down for
// routing, which would hide the missing config). The Cloudflare counterpart
// (functions/api/me.js, Centrale repo) hard-codes everything to false: that runtime
// structurally cannot host these integrations (no LDAP, no child_process).
// Pages of the user help centre (help/src/content/docs, copied into the image by the Dockerfile):
// source of the « Aide Druid » assistant (/api/help-chat, docs/plan-documentation-utilisateur.md lot 8).
const HELP_DOCS_DIR = process.env.HELP_DOCS_DIR || path.join(__dirname, 'help', 'src', 'content', 'docs');
// Public URL of the help centre, for the links cited in the answers (same default as lib/helpLinks.ts).
const HELP_SITE_URL = (process.env.HELP_SITE_URL || 'https://druid-aide.guillaumegodet.workers.dev').replace(/\/+$/, '');

const CAPABILITIES = {
  HAS_LDAP: !!process.env.LDAP_URL,
  HAS_KEYCLOAK_ADMIN: !!(process.env.KEYCLOAK_ADMIN_CLIENT_ID && process.env.KEYCLOAK_ADMIN_CLIENT_SECRET),
  HAS_ETL_API: !!process.env.ETL_API_URL,
  HAS_PIPELINES_CHAT: !!process.env.PIPELINES_API_KEY,
  // « Aide Druid » tab of the assistant: ILAAS answers from the help centre pages.
  HAS_HELP_CHAT: !!process.env.ILAAS_API_KEY && fs.existsSync(HELP_DOCS_DIR),
  HAS_SOVISU_EXPORT: fs.existsSync(path.dirname(process.env.CDB_STRUCT_PATH || '/cdb-data/structures.csv')),
  HAS_SERVER_JOBS: true,
  HAS_BENCHMARK: false,
  // Inter-lab mode of the « Réseau » tab (/api/network, docs/plan-reseau-inter-labos.md): reads the
  // network.json files of druid-biblio — absent on Cloudflare Functions.
  HAS_NETWORK_API: true,
  HAS_QUALINKA: !!process.env.NEO4J_HTTP_URL,
  // Internal/external status + manual validation: enabled by default here (Nantes); an instance
  // that only manages its internal staff disables it with HIDE_STATUS_VALIDATION=true (see lib/auth.ts).
  HAS_STATUS_VALIDATION: process.env.HIDE_STATUS_VALIDATION !== 'true',
  // « À traiter › Tâches » (docs/plan-chantiers-taches.md): /api/tasks routes of this server,
  // backed by Grist with the server key — absent on Cloudflare Functions (functions/api/me.js).
  HAS_TASKS: !!GRIST_API_KEY,
  // Public read-only instance: Cloudflare only (functions/api/me.js, READ_ONLY=true) — the write
  // routes of this server are not guarded by it.
  READ_ONLY: false,
};

// Instance settings sent to the front by /api/me (lib/instanceRuntime.ts,
// docs/plan-architecture-multi-instances.md lot 6 a) — same shape as
// functions/_lib/instance.js::publicInstanceInfo. The browser always reads Grist through the
// /api/grist proxy of this server (no public base).
const INSTANCE_INFO = {
  slug: process.env.DRUID_INSTANCE || 'nantes',
  label: process.env.INSTANCE_LABEL || 'Nantes Université',
  gristDocId: process.env.VITE_GRIST_DOC_ID || '',
  gristPublicBaseUrl: null,
  gristUiUrl: (process.env.VITE_GRIST_UI_URL || 'https://grist.numerique.gouv.fr').replace(/\/+$/, ''),
};

// Parses the token's `groups` claim into Druid access. An `admin` or
// `dashboard_viewer` leaf directly under /NantesUniversite opens every slug
// (+ super admin status for `admin`); a leaf at lab level
// (`/NantesUniversite/<labo>/dashboard_viewer`) only opens that lab. The
// intermediate levels (faculty/department) are not resolved: Druid has no
// structure hierarchy today (sous_structures is empty everywhere).
const parseDruidAccess = (groups) => {
  let isSuperAdmin = false;
  let isMediaAdmin = false;
  let isLabViewer = false;
  let allSlugs = false;
  const labAnchors = [];
  for (const g of groups || []) {
    const segments = String(g).split('/').filter(Boolean);
    if (segments.length < 2) continue;
    const role = segments[segments.length - 1];
    // media_admin: institution-wide leaf (communications officer —
    // administration of the media monitoring sources), independent of the
    // lab/dashboard scope resolved below for admin/dashboard_viewer.
    if (role === 'media_admin') {
      if (segments[segments.length - 2] === ESTABLISHMENT_GROUP) isMediaAdmin = true;
      continue;
    }
    if (role === LAB_VIEWER_GROUP) {
      if (segments[segments.length - 2] === ESTABLISHMENT_GROUP) isLabViewer = true;
      continue;
    }
    if (role !== 'admin' && role !== 'dashboard_viewer') continue;
    const anchor = segments[segments.length - 2];
    if (anchor === ESTABLISHMENT_GROUP) {
      allSlugs = true;
      if (role === 'admin') isSuperAdmin = true;
    } else {
      labAnchors.push(normalizeAcronym(anchor));
    }
  }
  // Implicit lab right (see LAB_VIEWER_GROUP): no explicit scope ⇒ the one from their Annuaire record.
  if (!allSlugs && labAnchors.length === 0) isLabViewer = true;
  return { isSuperAdmin, isMediaAdmin, isLabViewer, allSlugs, labAnchors, annuaireLabs: [] };
};

// Same rule as lib/normalize.ts normalizeAcronym (case, accents, punctuation)
// — scope anchors are compared on the frontend against normalizeAcronym(acronym).
const normalizeAcronym = (s) =>
  String(s).toLowerCase().split('\u00b2').join('2').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');

// ── Reduced-precision dates (server-side twin of lib/dates.ts, kept in sync by hand) ────────
// Canonical fuzzy date: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; Grist cells may still be epochs
// (Date columns not yet migrated by scripts/migrate_fuzzy_dates.cjs). `''` when empty/unreadable.
const FUZZY_DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const normalizeFuzzyDate = (raw) => {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return raw > 0 && Number.isFinite(raw) ? new Date(raw * 1000).toISOString().slice(0, 10) : '';
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  let m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:[T ].*)?$/.exec(s);
  if (m) return [m[1], m[2] && m[2].padStart(2, '0'), m[3] && m[3].padStart(2, '0')].filter(Boolean).join('-');
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  return '';
};
// Bounds of the period as full YYYY-MM-DD: 'start' → first day, 'end' → last day. '' when unknown.
const fuzzyDateBound = (raw, edge) => {
  const m = FUZZY_DATE_RE.exec(normalizeFuzzyDate(raw));
  if (!m) return '';
  const y = +m[1];
  const month = m[2] ? +m[2] : (edge === 'end' ? 12 : 1);
  if (month < 1 || month > 12) return '';
  const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const day = m[3] ? +m[3] : (edge === 'end' ? last : 1);
  if (day < 1 || day > last) return '';
  return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
// Whole period elapsed (an end date `2026` is past only from 2027-01-01 on).
const isFuzzyDatePast = (raw, todayIso) => { const u = fuzzyDateBound(raw, 'end'); return !!u && u < todayIso; };

// Labs of the user's Annuaire record (labo_viewer right): Grist rows whose
// uid_dyna = Keycloak identifier, excluding parking labs (zzz/empty,
// see lib/mergeProposal.PARKING_LABOS), HISTORIQUE affiliations and ended
// memberships (affiliation_end_date in the past). Returns the LABO acronyms
// as they are (display); the caller normalizes them for labAnchors.
const resolveAnnuaireLabs = async (username) => {
  const doc = process.env.VITE_GRIST_DOC_ID;
  if (!doc || !GRIST_API_KEY || !username) return [];
  const filter = encodeURIComponent(JSON.stringify({ uid_dyna: [username] }));
  const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/Annuaire/records?filter=${filter}`, {
    headers: { Authorization: `Bearer ${GRIST_API_KEY}` },
  });
  if (!resp.ok) throw new Error(`Grist HTTP ${resp.status}`);
  const todayIso = new Date().toISOString().slice(0, 10);
  const labs = new Set();
  for (const r of (await resp.json()).records || []) {
    const f = r.fields || {};
    const labo = String(f.LABO || '').trim();
    if (!labo || labo.toLowerCase() === 'zzz') continue;
    if (String(f.rattachement || '').toUpperCase() === 'HISTORIQUE') continue;
    if (isFuzzyDatePast(f.affiliation_end_date, todayIso)) continue;
    labs.add(labo);
  }
  return [...labs];
};

const canAccessSlug = (access, slug) =>
  !!access && (access.allSlugs || access.labAnchors.includes(normalizeAcronym(slug)));

// /api/sync-sovisuplus receives the full Annuaire serialized by the frontend (~11 MB for
// 8,000 records): above the global 10 MB cap, the sync answered 413 and cdb's
// people.csv stayed frozen (review of 2026-09-16, point 6). Dedicated parser mounted
// BEFORE the global parser (body-parser skips a request whose body is already read).
app.use('/api/sync-sovisuplus', express.json({ limit: '64mb' }));
app.use(express.json({ limit: '10mb' }));

// Session. Fixed SESSION_SECRET (druid/.env): without it, random secret and every
// session is lost on each container restart.
if (!process.env.SESSION_SECRET) {
  console.warn('[Session] SESSION_SECRET missing: random secret, sessions lost at every restart');
}
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  // sameSite=lax: the cookie is not sent with cross-site requests (fetch or
  // form from another site), only with top-level GET navigations — including
  // the return from Keycloak on /auth/callback. GETs with side effects
  // (sync triggers) are covered by the anti-CSRF guard below.
  cookie: { secure: false, httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);

// Logger
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

// ── Auth routes (public) ────────────────────────────────────────────────────

// Alias of the Keycloak identity provider for the Nantes Université SSO (CAS via
// idp-epe.univ-nantes.fr, see docs/plan-sso-cas-nantes.md), once configured on the
// crisalid-inst realm. As long as the variable is absent, behavior is unchanged
// (native Keycloak login screen, backed by the federated LDAP).
const KEYCLOAK_IDP_HINT = process.env.KEYCLOAK_IDP_HINT || '';

app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = `${KC_BASE}/auth?response_type=code&client_id=${KEYCLOAK_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(CALLBACK_URI)}` +
    `&state=${state}&scope=openid%20profile%20email` +
    (KEYCLOAK_IDP_HINT ? `&kc_idp_hint=${encodeURIComponent(KEYCLOAK_IDP_HINT)}` : '');
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  // state AND oauthState must both exist: `undefined !== undefined` is false, so
  // a session without a login state (missing or expired cookie) accepted any
  // code — login forced via CSRF (review of 2026-09-16, point 2).
  const expected = req.session.oauthState;
  if (typeof code !== 'string' || !code || typeof state !== 'string' || !state || !expected || state !== expected) {
    return res.status(400).send('Invalid OAuth state');
  }
  try {
    const tokenRes = await fetch(`${KC_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KEYCLOAK_CLIENT_ID,
        code,
        redirect_uri: CALLBACK_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[Auth] Token exchange failed:', tokenData);
      return res.status(401).send('Authentication failed');
    }
    // Decode JWT payload (trusted source — Keycloak)
    const payload = JSON.parse(
      Buffer.from(tokenData.access_token.split('.')[1], 'base64url').toString()
    );
    const access = parseDruidAccess(payload.groups);
    // Generic lab right: scope derived from the Annuaire record (see LAB_VIEWER_GROUP).
    // A Grist failure does not block the login: empty scope, message on the frontend.
    if (access.isLabViewer && !access.allSlugs) {
      try {
        access.annuaireLabs = await resolveAnnuaireLabs(payload.preferred_username);
        for (const l of access.annuaireLabs) {
          const a = normalizeAcronym(l);
          if (a && !access.labAnchors.includes(a)) access.labAnchors.push(a);
        }
      } catch (err) {
        console.error(`[Auth] Annuaire lookup failed for ${payload.preferred_username}:`, err.message);
      }
    }
    // New session at login (anti-fixation: the pre-login identifier, possibly
    // imposed by a third party, is never promoted).
    await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.user = {
      name: payload.name || payload.preferred_username || '',
      email: payload.email || '',
      preferred_username: payload.preferred_username || '',
      roles: payload.realm_access?.roles || [],
      access,
    };
    console.log(`[Auth] Logged in: ${req.session.user.preferred_username}` +
      (access.isLabViewer ? ` (labo_viewer → ${access.annuaireLabs.join(', ') || 'aucun labo'})` : ''));
    res.redirect('/');
  } catch (err) {
    console.error('[Auth] Callback error:', err);
    res.status(500).send('Authentication error');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    const postLogout = encodeURIComponent(APP_URL);
    res.redirect(
      `${KC_BASE}/logout?client_id=${KEYCLOAK_CLIENT_ID}&post_logout_redirect_uri=${postLogout}`
    );
  });
});

// Current user info (used by frontend auth.ts)
// access.allowedSlugs carries the RAW lab anchors of the token ('all' for an
// institution right) — NOT intersected with the /biblio-data slugs: those only
// cover structures with a bibliometric dashboard, whereas allowedSlugs is
// also used to filter the Annuaire/Structures (every Grist lab, dashboard
// or not). The biblio-data intersection remains specific to
// /api/dashboard-structures (see getAllowedSlugs above).
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { name, email, preferred_username, roles, access } = req.session.user;
  res.json({
    name,
    email,
    preferred_username,
    roles,
    access: {
      isSuperAdmin: access?.isSuperAdmin ?? false,
      isMediaAdmin: access?.isMediaAdmin ?? false,
      isLabViewer: access?.isLabViewer ?? false,
      annuaireLabs: access?.annuaireLabs ?? [],
      allowedSlugs: access?.allSlugs ? 'all' : (access?.labAnchors ?? []),
    },
    capabilities: CAPABILITIES,
    instance: INSTANCE_INFO,
  });
});

// ── Auth guard middleware ───────────────────────────────────────────────────
// Applied after auth routes so /auth/* is always reachable
app.use((req, res, next) => {
  const isPublic =
    req.path.startsWith('/auth/') ||
    req.path.startsWith('/assets/') ||
    req.path === '/favicon.ico' ||
    // Public sharing of the dashboard dataviz: embed page, bibliometric
    // data (derived from the open sources OpenAlex/BSO) and base map.
    // Everything else stays behind Keycloak.
    req.path.startsWith('/embed') ||
    req.path.startsWith('/api/public/') ||
    req.path === '/vendor/world.json';
  if (isPublic || req.session.user) return next();
  // API calls get 401, browser navigation gets redirect
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/auth/login');
});

// ── Anti-CSRF ───────────────────────────────────────────────────────────────
// sameSite=lax covers neither navigation GETs (booby-trapped link to
// /api/sync-ldap-trigger…) nor browsers that do not enforce it. Every
// authenticated request to /api/ (or non-GET elsewhere) must come from the
// application itself: Sec-Fetch-Site (sent by every recent browser) must be
// same-origin or none (typed URL); failing that, the Origin header, when
// present, must name the served host. Non-browser clients (curl, scripts)
// send neither and pass through. (Review of 2026-09-16, point 3.)
const rejectCrossSite = (req, res, next) => {
  const guarded = req.path.startsWith('/api/') || !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!guarded || req.path.startsWith('/api/public/')) return next();
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'Cross-site request refused' });
  }
  const origin = req.get('origin');
  if (!site && origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* invalid Origin → refused */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request refused' });
  }
  next();
};
app.use(rejectCrossSite);

// ── Image proxy for anti-bot protected sources (e.g. IETR/Anubis) ────────────
// Some lab websites serve a "you're not a bot" challenge page to browser
// User-Agents (ietr.fr is behind Anubis): their photos then return HTML
// instead of the image and CANNOT be hotlinked in an <img>. We fetch them
// server-side with a non-browser UA (curl passes the challenge) and re-serve
// them same-origin. Public route (the photo is not sensitive) + strict host
// allowlist (anti-SSRF: no arbitrary URL).
const PHOTO_PROXY_HOSTS = new Set(['www.ietr.fr']);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_MAX_REDIRECTS = 3;
const photoUrlAllowed = (u) => u.protocol === 'https:' && PHOTO_PROXY_HOSTS.has(u.hostname);
app.get('/api/public/photo', async (req, res) => {
  let u;
  try { u = new URL(String(req.query.src || '')); } catch { return res.status(400).end('bad src'); }
  if (!photoUrlAllowed(u)) return res.status(403).end('host not allowed');
  try {
    // Redirects followed by hand, each hop re-checked against the allowlist
    // (with redirect:'follow', an upstream 302 to the docker network was relayed —
    // SSRF, review of 2026-09-16, point 5); body capped at PHOTO_MAX_BYTES.
    let upstream;
    for (let hop = 0; ; hop++) {
      upstream = await fetch(u.href, {
        headers: { 'User-Agent': 'curl/8.5.0', 'Accept': 'image/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const loc = upstream.headers.get('location');
      if (!loc || hop >= PHOTO_MAX_REDIRECTS) return res.status(502).end('too many redirects');
      u = new URL(loc, u);
      if (!photoUrlAllowed(u)) return res.status(403).end('redirect not allowed');
    }
    const ct = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !ct.startsWith('image/')) return res.status(502).end('not an image');
    if (parseInt(upstream.headers.get('content-length') || '0', 10) > PHOTO_MAX_BYTES) {
      return res.status(502).end('too large');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of upstream.body) {
      size += chunk.length;
      if (size > PHOTO_MAX_BYTES) return res.status(502).end('too large');
      chunks.push(chunk);
    }
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=1209600');
    return res.end(Buffer.concat(chunks));
  } catch (e) {
    return res.status(502).end('fetch failed');
  }
});

// ── Conversational assistant (chat widget) ─────────────────────────────────
// Streaming relay to the Open WebUI Pipelines server (LangGraph agent
// crisalid_graph_agent_pipeline → MCP toolbox → Neo4j, openwebui profile).
// The API key stays server-side; access is protected by the Keycloak guard
// above. The frontend (ChatWidget.tsx) parses the OpenAI-format SSE as is.
const PIPELINES_URL = process.env.PIPELINES_URL || 'http://crisalid-pipelines:9099';
const PIPELINES_API_KEY = process.env.PIPELINES_API_KEY || '';
const CHAT_MODEL = process.env.CHAT_MODEL || 'crisalid_graph_agent_pipeline';

app.post('/api/chat', (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  // Caps the relayed history (the agent needs no more, and it prevents the
  // LLM prompt from growing over a long conversation).
  const clean = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!clean.length) return res.status(400).json({ error: 'messages[] required' });

  // http.request rather than fetch: Node's undici cuts the response body
  // after 300 s without a chunk (bodyTimeout), yet the agent may stay silent
  // longer during its tool calls. No implicit timeout here; the total
  // duration is explicitly capped below.
  const payload = JSON.stringify({ model: CHAT_MODEL, stream: true, messages: clean });
  let heartbeat;
  // The ping must never land in the middle of an upstream SSE line: it is
  // only sent if the last relayed chunk ended with a line break.
  let atLineBoundary = true;

  const endWithNotice = (msg) => {
    clearInterval(heartbeat);
    if (!res.headersSent) return res.status(502).json({ error: msg });
    if (res.writableEnded) return;
    if (atLineBoundary) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n⚠️ ${msg}` } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    res.end();
  };

  const upstreamReq = http.request(`${PIPELINES_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      Authorization: `Bearer ${PIPELINES_API_KEY}`,
    },
  }, (upstream) => {
    if (upstream.statusCode !== 200) {
      let detail = '';
      upstream.on('data', (c) => { detail += c; });
      upstream.on('end', () => {
        console.error(`[Chat] upstream ${upstream.statusCode}: ${detail.slice(0, 300)}`);
        if (!res.headersSent) res.status(502).json({ error: `Assistant unavailable: upstream ${upstream.statusCode}` });
      });
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // no buffering if an nginx sits in front
    });
    res.flushHeaders();
    // Heartbeat: intermediate proxies (nginx gateway) cut silent
    // connections; a periodic SSE comment keeps them open.
    // The widget's parser ignores lines without `data:`.
    heartbeat = setInterval(() => { if (atLineBoundary) res.write(': ping\n\n'); }, 15000);
    upstream.on('data', (chunk) => {
      atLineBoundary = chunk[chunk.length - 1] === 0x0a;
      res.write(chunk);
    });
    upstream.on('end', () => {
      clearInterval(heartbeat);
      res.end();
    });
    upstream.on('error', (err) => {
      console.error('[Chat] upstream stream error:', err.message);
      endWithNotice('Connexion à l’assistant interrompue — réessayez.');
    });
  });

  // Safety net: the agent may loop on an overly open question.
  const killer = setTimeout(() => {
    console.error('[Chat] response too long, giving up (10 min)');
    endWithNotice('L’assistant n’a pas abouti en 10 minutes — réessayez en précisant la question.');
    upstreamReq.destroy();
  }, 10 * 60 * 1000);
  upstreamReq.on('close', () => clearTimeout(killer));

  upstreamReq.on('error', (err) => {
    console.error('[Chat] relay error:', err.message);
    endWithNotice(`Assistant injoignable : ${err.message}`);
  });
  // Client gone (widget collapsed, page left, stop button) → cut the upstream
  res.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(killer);
    upstreamReq.destroy();
  });
  upstreamReq.end(payload);
});

// ── « Tableau de bord » section: structures that have a dashboard ──────────
// The data/ folder of druid-biblio (ETL) is mounted read-only (druid.yaml);
// a slug = a subfolder with a config.yaml. Used by the « Tableau de bord » button
// of the Structure records. In-memory cache, 5 min.
const BIBLIO_DATA_PATH = process.env.BIBLIO_DATA_PATH || '/biblio-data';
let dashboardSlugsCache = { at: 0, slugs: [], groups: [] };
// Forces a full recompute on the next getDashboardStructures() (at:0 → the 5 min delay
// is always exceeded) after a write that changes the list of structures/groups/hidden
// tabs. A single shape for the 4 invalidation sites (two of them omitted
// `groups`/`tabsHidden` before lot 2 — harmless as long as nothing reads the cache without
// going through getDashboardStructures(), but fragile).
const invalidateDashboardSlugsCache = () => { dashboardSlugsCache = { at: 0, slugs: [], groups: [], tabsHidden: {} }; };
// `druid_tabs_hidden:` list of a config.yaml (PyYAML « - item » block or « [a, b] » flow).
// Read live → the ETL console can hide tabs without regenerating the data.
const parseTabsHidden = (cfg) => {
  const after = cfg.split(/^druid_tabs_hidden:/m)[1];
  if (after === undefined) return [];
  const lines = after.split('\n');
  const inline = lines[0].match(/\[([^\]]*)\]/);
  if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const hidden = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^\s*-\s*['"]?([\w-]+)['"]?\s*$/);
    if (m) hidden.push(m[1]);
    else if (line.trim()) break; // next key → end of block
  }
  return hidden;
};

// Refreshes/re-reads dashboardSlugsCache when needed and returns it (full list,
// not filtered by rights — per-user filtering is done by the caller).
const getDashboardStructures = () => {
  const now = Date.now();
  if (now - dashboardSlugsCache.at > 5 * 60 * 1000) {
    let slugs = [];
    const groups = [];
    const tabsHidden = {};
    try {
      slugs = fs.readdirSync(BIBLIO_DATA_PATH, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_')
          && fs.existsSync(path.join(BIBLIO_DATA_PATH, d.name, 'config.yaml')))
        .map((d) => d.name)
        .sort();
      // Druid groups (config `kind: group`) — the frontend shows them separately.
      for (const slug of slugs) {
        try {
          const cfg = fs.readFileSync(path.join(BIBLIO_DATA_PATH, slug, 'config.yaml'), 'utf8');
          if (/^kind:\s*group\b/m.test(cfg)) groups.push(slug);
          const hidden = parseTabsHidden(cfg);
          if (hidden.length) tabsHidden[slug] = hidden;
        } catch { /* unreadable config → treated as a lab */ }
      }
    } catch {
      // Volume not mounted (local dev…) → no buttons, no error.
    }
    dashboardSlugsCache = { at: now, slugs, groups, tabsHidden };
  }
  return dashboardSlugsCache;
};

// Rights management: intersects the access resolved from the token with the
// slugs actually available — 'all' if the user has an institution right.
const getAllowedSlugs = (access, allSlugs) => {
  if (!access) return [];
  if (access.allSlugs) return 'all';
  return allSlugs.filter((s) => access.labAnchors.includes(normalizeAcronym(s)));
};

app.get('/api/dashboard-structures', (req, res) => {
  const { slugs, groups, tabsHidden } = getDashboardStructures();
  const allowed = getAllowedSlugs(req.session.user?.access, slugs);
  const visibleSlugs = allowed === 'all' ? slugs : allowed;
  const visibleGroups = allowed === 'all' ? groups : groups.filter((g) => visibleSlugs.includes(g));
  res.json({ slugs: visibleSlugs, groups: visibleGroups, tabsHidden: tabsHidden || {} });
});

// ── Rights management (admin tab, read-only) ────────────────────────────────
// Browsing of the Keycloak group tree under the institution —
// NO write (assignment stays in the Keycloak console, see the session
// plan). Authenticated via the druid-rights-viewer service account
// (view-users/query-groups on realm-management), not via the user's
// session — Druid never exposes the visitor's credentials to Keycloak.
let kcAdminTokenCache = { token: '', exp: 0 };
const getKeycloakAdminToken = async () => {
  if (kcAdminTokenCache.token && Date.now() < kcAdminTokenCache.exp - 5000) return kcAdminTokenCache.token;
  if (!KEYCLOAK_ADMIN_CLIENT_ID || !KEYCLOAK_ADMIN_CLIENT_SECRET) {
    throw new Error('KEYCLOAK_ADMIN_CLIENT_ID/SECRET not configured');
  }
  const r = await fetch(`${KC_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: KEYCLOAK_ADMIN_CLIENT_ID,
      client_secret: KEYCLOAK_ADMIN_CLIENT_SECRET,
    }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Keycloak admin auth failed');
  kcAdminTokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 60) * 1000 };
  return kcAdminTokenCache.token;
};

const kcAdminFetch = async (pathSuffix) => {
  const token = await getKeycloakAdminToken();
  const r = await fetch(`${KC_ADMIN_BASE}${pathSuffix}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Keycloak admin API HTTP ${r.status}`);
  return r.json();
};

const ROLE_LEAF_NAMES = new Set(['admin', 'dashboard_viewer', LAB_VIEWER_GROUP]);

// Recursively walks down the group tree: the role leaves
// (admin/dashboard_viewer) carry their member list, the other levels
// (lab, faculty…) are just org-chart nodes.
const fetchGroupTree = async (groupId) => {
  const children = await kcAdminFetch(`/groups/${groupId}/children`);
  return Promise.all(children.map(async (child) => {
    const isRoleLeaf = ROLE_LEAF_NAMES.has(child.name);
    if (isRoleLeaf) {
      const members = await kcAdminFetch(`/groups/${child.id}/members?briefRepresentation=true`);
      return {
        id: child.id,
        name: child.name,
        path: child.path,
        isRoleLeaf: true,
        members: members.map((m) => ({
          id: m.id, username: m.username, email: m.email, firstName: m.firstName, lastName: m.lastName,
        })),
      };
    }
    return {
      id: child.id,
      name: child.name,
      path: child.path,
      isRoleLeaf: false,
      children: await fetchGroupTree(child.id),
    };
  }));
};

const flattenRoleLeaves = (tree) =>
  tree.flatMap((node) => (node.isRoleLeaf ? [node] : flattenRoleLeaves(node.children)));

const requireSuperAdmin = (req, res, next) => {
  if (!req.session.user?.access?.isSuperAdmin) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Media monitoring sources: super admin OR the media_admin shared role
// (communications officer, see parseDruidAccess) — no need to be super admin.
const requireMediaAdmin = (req, res, next) => {
  const access = req.session.user?.access;
  if (!access?.isSuperAdmin && !access?.isMediaAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

// Alignment tools (IdRef, ORCID, HAL, OpenAlex, LDAP candidates): institution-wide
// operations, reserved to institution rights (admins, central
// services — `/NantesUniversite/{admin,dashboard_viewer}`), never to a lab
// right. Counterpart of the frontend hiding (lib/auth.canUseEstablishmentTools).
const requireEstablishmentScope = (req, res, next) => {
  if (!req.session.user?.access?.allSlugs) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const getEstablishmentGroupTree = async () => {
  const roots = await kcAdminFetch(`/groups?search=${encodeURIComponent(ESTABLISHMENT_GROUP)}`);
  const root = roots.find((g) => g.name === ESTABLISHMENT_GROUP);
  if (!root) throw new Error('Establishment group not found');
  return { root, children: await fetchGroupTree(root.id) };
};

app.get('/api/admin/rights/groups', requireSuperAdmin, async (req, res) => {
  try {
    const { root, children } = await getEstablishmentGroupTree();
    res.json({ id: root.id, name: root.name, path: root.path, children });
  } catch (err) {
    console.error('[Rights] groups error:', err);
    res.status(502).json({ error: 'Keycloak admin API unreachable' });
  }
});

app.get('/api/admin/rights/users', requireSuperAdmin, async (req, res) => {
  try {
    const { children } = await getEstablishmentGroupTree();
    const byUser = new Map();
    for (const leaf of flattenRoleLeaves(children)) {
      for (const member of leaf.members) {
        if (!byUser.has(member.id)) byUser.set(member.id, { ...member, groups: [] });
        byUser.get(member.id).groups.push(leaf.path);
      }
    }
    res.json({ users: Array.from(byUser.values()) });
  } catch (err) {
    console.error('[Rights] users error:', err);
    res.status(502).json({ error: 'Keycloak admin API unreachable' });
  }
});

// ── « Tableau de bord » section: publications of a structure (JSON) ────────
// Serves data/<slug>/dashboard.json, produced by the druid-biblio ETL
// (scripts/export_dashboard_json.py). Consumed by the native React dashboard
// (client-side aggregations). Protected by the Keycloak guard above.
const sendDashboardJson = (req, res, cacheControl, isPublic = false) => {
  const { slug } = req.params;
  if (!/^[a-z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  // Rights management: the private variant honors the scope resolved from the
  // token (see parseDruidAccess) — second line of defense behind the
  // filtering of /api/dashboard-structures (an unlisted slug could otherwise
  // be requested directly by guessing its name). The public variant
  // (/embed) deliberately stays open, by design.
  if (!isPublic && !canAccessSlug(req.session.user?.access, slug)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Public variant without the member list (staff = internal data);
  // fallback on the full file for exports that predate this variant.
  const publicFile = path.join(BIBLIO_DATA_PATH, slug, 'dashboard.public.json');
  const file = isPublic && fs.existsSync(publicFile)
    ? publicFile
    : path.join(BIBLIO_DATA_PATH, slug, 'dashboard.json');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'No dashboard data for this structure' });
  }
  res.set('Cache-Control', cacheControl);
  res.set('Vary', 'Accept-Encoding');
  // Variant precompressed by the export (the univ-nantes corpus is ~55 MB uncompressed)
  const gz = `${file}.gz`;
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && fs.existsSync(gz)) {
    res.set('Content-Encoding', 'gzip');
    res.set('Content-Type', 'application/json; charset=utf-8');
    return res.sendFile(gz);
  }
  res.sendFile(file);
};

app.get('/api/dashboard/:slug/publications', (req, res) =>
  sendDashboardJson(req, res, 'private, max-age=300'));

// Public variant (/embed page: dataviz shared externally, without
// authentication). Same data — bibliometric corpus derived from open
// sources (OpenAlex, BSO). Longer public cache: content regenerated by the ETL.
app.get('/api/public/dashboard/:slug/publications', (req, res) =>
  sendDashboardJson(req, res, 'public, max-age=3600', true));

// ── « Réseau » tab, inter-lab mode (docs/plan-reseau-inter-labos.md, lots 2 and 4) ─────────
// Reads the network.json of a composite structure (druid-biblio biblio_etl/network_export.py):
// the structure's own file when it is a composite (univ-nantes, pole-st), otherwise the
// university-wide one (NETWORK_SOURCE_SLUG). Graph computed by scripts/lib/co_network.cjs.
// Rights (decision D1): a user limited to some labs sees their authors, and the authors of the
// other labs only when they co-signed with them; institution rights see everything.
const coNetwork = require('./scripts/lib/co_network.cjs');
const NETWORK_SOURCE_SLUG = process.env.NETWORK_SOURCE_SLUG || 'univ-nantes';
const networkCache = new Map(); // slug -> {mtimeMs, net}
const loadNetwork = (slug) => {
  const file = path.join(BIBLIO_DATA_PATH, slug, 'network.json');
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const cached = networkCache.get(slug);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.net;
  const net = JSON.parse(fs.readFileSync(file, 'utf8'));
  networkCache.set(slug, { mtimeMs: stat.mtimeMs, net });
  return net;
};

// Resolves the network, the focus lab and the rights of a request, or answers the error itself.
const resolveNetworkRequest = (req, res) => {
  const { slug } = req.params;
  if (!/^[a-z0-9_-]+$/.test(slug)) { res.status(400).json({ error: 'Invalid slug' }); return null; }
  const access = req.session.user?.access;
  if (!canAccessSlug(access, slug)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  let net;
  let source;
  try {
    net = loadNetwork(slug);
    source = slug;
    if (!net) { net = loadNetwork(NETWORK_SOURCE_SLUG); source = NETWORK_SOURCE_SLUG; }
  } catch (e) {
    console.error('[Network] unreadable network.json:', e.message);
    res.status(500).json({ error: 'Unreadable network data' });
    return null;
  }
  if (!net) { res.status(404).json({ error: 'No network data' }); return null; }
  const isComposite = source === slug;
  const focus = isComposite ? null : net.labs.find((l) => l.slug === slug)?.acronym ?? null;
  if (!isComposite && !focus) {
    res.status(404).json({ error: 'Structure not in the university network' });
    return null;
  }
  // null = no restriction; composite = its access was just checked on the slug itself.
  const visibleLabs = access.allSlugs || isComposite
    ? null
    : net.labs.filter((l) => l.slug && canAccessSlug(access, l.slug)).map((l) => l.acronym);
  const toAcronyms = (list) => String(list || '').split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => net.labs.find((l) => l.slug === x || l.acronym === x)?.acronym)
    .filter(Boolean);
  const intOr = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
  return { net, source, focus, visibleLabs, toAcronyms, intOr };
};

app.get('/api/network/:slug', (req, res) => {
  const r = resolveNetworkRequest(req, res);
  if (!r) return;
  const { net, source, focus, visibleLabs, toAcronyms, intOr } = r;
  const labs = [...new Set([...(focus ? [focus] : []), ...toAcronyms(req.query.labs)])];
  // meta=1: only the labs and the coverage (lab picker), no graph.
  const graph = labs.length && req.query.meta !== '1'
    ? coNetwork.buildInterLabNetwork(net, {
      labs,
      from: intOr(req.query.from, undefined),
      to: intOr(req.query.to, undefined),
      minPubs: intOr(req.query.minPubs, 1),
      maxAuthors: intOr(req.query.maxAuthors, null),
      crossOnly: req.query.crossOnly === '1',
      aggregateOthers: req.query.aggregateOthers === '1',
      visibleLabs,
      maxNodes: Math.min(intOr(req.query.maxNodes, 400), 1000),
    })
    : { nodes: [], links: [], categories: [], truncated: 0 };
  res.set('Cache-Control', 'private, max-age=300');
  res.json({
    source,
    generatedAt: net.generatedAt,
    focus,
    labs: net.labs,
    coverage: net.coverage,
    restricted: !!visibleLabs,
    ...graph,
  });
});

app.get('/api/network/:slug/publications', (req, res) => {
  const r = resolveNetworkRequest(req, res);
  if (!r) return;
  const { net, visibleLabs, intOr } = r;
  const nodeRe = /^(a:\d+|lab:[\w&.' -]+)$/;
  const { a, b } = req.query;
  if (!nodeRe.test(String(a || '')) || !nodeRe.test(String(b || ''))) {
    return res.status(400).json({ error: 'Invalid node ids' });
  }
  const publications = coNetwork.commonPublications(net, {
    a: String(a),
    b: String(b),
    from: intOr(req.query.from, null),
    to: intOr(req.query.to, null),
    maxAuthors: intOr(req.query.maxAuthors, null),
    requireLabs: visibleLabs,
  });
  res.set('Cache-Control', 'private, max-age=300');
  res.json({ publications: publications.slice(0, 200), total: publications.length });
});

// ── « Tableau de bord » section: monitoring of new publications ────────────
// « Veille » tab of the React dashboard: queries OpenAlex LIVE
// (most recent publications signed by the structure, sorted by descending
// publication date), unlike the other tabs which read the
// dashboard.json produced by the ETL. Ported from the prototype
// guillaumegodet/Dataviz studies/202604-centrale-research-news.
// Behind the Keycloak guard; in-memory cache, 1 h per structure/period.
const NEWS_CACHE_TTL = 60 * 60 * 1000;
const NEWS_MAX_WORKS = 600;
const newsCache = new Map();
// Premium OpenAlex key (subscription): priority rate limit for the live
// monitoring. Absent → fallback on the polite pool (mailto only).
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';

// Minimal read of a druid-biblio config.yaml (flat fields + the groups'
// members list) — regex parsing, like the `kind: group` guard
// of /api/dashboard-structures, to avoid shipping a YAML lib.
const readStructConfig = (slug) => {
  const file = path.join(BIBLIO_DATA_PATH, slug, 'config.yaml');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const get = (key) => {
    const m = raw.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  };
  const cfg = {
    acronym: get('acronym'),
    openalexId: get('openalex_id'),
    mailto: get('mailto'),
    isGroup: /^kind:\s*group\b/m.test(raw),
    memberAuthors: [],
  };
  if (cfg.isGroup) {
    // `members:` block: `- nom: …` entries followed by indented fields,
    // ended by the next root key.
    const block = raw.split(/^members:\s*$/m)[1];
    if (block) {
      let cur = null;
      for (const line of block.split('\n')) {
        if (/^[a-z_]+:/i.test(line)) break; // next root key
        const item = line.match(/^-\s+(\w+):\s*(.*)$/);
        const field = line.match(/^\s+(\w+):\s*(.*)$/);
        if (item) {
          cur = {};
          cfg.memberAuthors.push(cur);
          cur[item[1]] = item[2].trim().replace(/^['"]|['"]$/g, '');
        } else if (field && cur) {
          cur[field[1]] = field[2].trim().replace(/^['"]|['"]$/g, '');
        }
      }
      cfg.memberAuthors = cfg.memberAuthors
        .map((m) => ({
          id: (m.openalex_author_id || '').replace(/^https?:\/\/openalex\.org\//, ''),
          name: [m.prenom, m.nom].filter(Boolean).join(' '),
          labo: m.labo || '',
        }))
        .filter((m) => /^A\d+$/.test(m.id));
    }
  }
  return cfg;
};

// OpenAlex institution id → acronym map, built from the structures' configs
// (same folders as /api/dashboard-structures). Used to identify the labs
// in the affiliations of OpenAlex works (Labo column/filter).
// Institution/pole-level structures are excluded (their id appears in the
// lineage of almost every work → noise in the Labo column).
const NEWS_INSTITUTION_SLUGS = new Set(['univ-nantes', 'ec-nantes', 'pole-st']);
let newsLabMapCache = { at: 0, map: {} };
const getNewsLabMap = () => {
  const now = Date.now();
  if (now - newsLabMapCache.at < NEWS_CACHE_TTL) return newsLabMapCache.map;
  const map = {};
  try {
    for (const d of fs.readdirSync(BIBLIO_DATA_PATH, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('_') || NEWS_INSTITUTION_SLUGS.has(d.name)) continue;
      const cfg = readStructConfig(d.name);
      if (cfg && !cfg.isGroup && cfg.acronym && /^I\d+$/.test(cfg.openalexId)) {
        map[cfg.openalexId] = cfg.acronym;
      }
    }
  } catch { /* volume not mounted (local dev) → no lab mapping */ }
  newsLabMapCache = { at: now, map };
  return map;
};

const oaShortId = (u) => (u ? String(u).split('/').pop() : '');

// Flattens an OpenAlex work to the frontend's NewsItem contract (NewsTab).
const processNewsWork = (w, selfIds, labMap, groupAuthors) => {
  const structAuthors = new Set();
  const labs = new Set();
  const allAuthors = [];
  for (const a of w.authorships || []) {
    const name = a.author?.display_name || '';
    if (name) allAuthors.push(name);
    let matched = false;
    if (groupAuthors) {
      const g = groupAuthors.get(oaShortId(a.author?.id));
      if (g) {
        matched = true;
        if (g.labo) labs.add(g.labo);
      }
    }
    for (const inst of a.institutions || []) {
      const ids = [oaShortId(inst.id), ...(inst.lineage || []).map(oaShortId)];
      for (const id of ids) {
        if (selfIds.has(id)) matched = true;
        if (labMap[id]) {
          labs.add(labMap[id]);
          matched = true;
        }
      }
    }
    if (matched && name) structAuthors.add(name);
  }
  const src = w.primary_location?.source || null;
  return {
    id: oaShortId(w.id),
    title: w.title || null,
    date: w.publication_date || null,
    link: w.doi || w.primary_location?.landing_page_url || w.id || null,
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, '') : null,
    workType: w.type || null,
    sourceName: src?.display_name || null,
    sourceType: src?.type || null,
    issn: src?.issn_l || null,
    isOa: !!w.open_access?.is_oa,
    oaStatus: w.open_access?.oa_status || null,
    citedByCount: w.cited_by_count || 0,
    authors: [...structAuthors],
    allAuthors: allAuthors.slice(0, 8),
    authorsTotal: allAuthors.length,
    labs: [...labs].sort(),
    topics: (w.topics || []).map((t) => t.display_name).filter(Boolean).slice(0, 5),
    subfields: [...new Set((w.topics || []).map((t) => t.subfield?.display_name).filter(Boolean))],
    keywords: (w.keywords || []).map((k) => k.display_name).filter(Boolean),
  };
};

app.get('/api/news/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!/^[a-z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  // Same scope as /api/dashboard/:slug (OpenAlex quota, consistency with the newsletter).
  if (!canAccessSlug(req.session.user?.access, slug)) return res.status(403).json({ error: 'Forbidden' });
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
  const cacheKey = `${slug}:${days}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < NEWS_CACHE_TTL) return res.json(cached.payload);

  const cfg = readStructConfig(slug);
  if (!cfg) return res.status(404).json({ error: 'Unknown structure' });
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let filter;
  let groupAuthors = null;
  const selfIds = new Set(cfg.openalexId.split('|').filter((id) => /^I\d+$/.test(id)));
  if (selfIds.size > 0) {
    // Single or multiple openalex_id (« I…|I… », e.g. pole-st) — the OpenAlex
    // filter natively accepts the union via « | ».
    filter = `institutions.id:${[...selfIds].join('|')},from_publication_date:${from}`;
  } else if (cfg.isGroup && cfg.memberAuthors.length > 0) {
    // Druid groups: no OpenAlex institution → filter by authors (100 max per request).
    groupAuthors = new Map(cfg.memberAuthors.map((m) => [m.id, m]));
    filter = `author.id:${cfg.memberAuthors.slice(0, 100).map((m) => m.id).join('|')},from_publication_date:${from}`;
  } else {
    return res.status(422).json({ error: 'No OpenAlex identifier configured for this structure' });
  }

  try {
    const labMap = getNewsLabMap();
    const works = [];
    let total = 0;
    for (let page = 1; works.length < NEWS_MAX_WORKS; page += 1) {
      const url =
        `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
        `&sort=publication_date:desc&per-page=200&page=${page}` +
        (cfg.mailto ? `&mailto=${encodeURIComponent(cfg.mailto)}` : '') +
        (OPENALEX_API_KEY ? `&api_key=${encodeURIComponent(OPENALEX_API_KEY)}` : '');
      const r = await fetch(url);
      if (!r.ok) throw new Error(`OpenAlex HTTP ${r.status}`);
      const data = await r.json();
      total = data.meta?.count ?? 0;
      const results = data.results || [];
      works.push(...results);
      if (results.length < 200 || works.length >= total) break;
    }
    const items = works
      .slice(0, NEWS_MAX_WORKS)
      .map((w) => processNewsWork(w, selfIds, labMap, groupAuthors));
    const payload = {
      slug,
      days,
      fetchedAt: new Date().toISOString(),
      total,
      truncated: items.length < total,
      items,
    };
    newsCache.set(cacheKey, { at: Date.now(), payload });
    if (newsCache.size > 200) newsCache.delete(newsCache.keys().next().value);
    res.json(payload);
  } catch (err) {
    console.error('[News] OpenAlex error:', err);
    res.status(502).json({ error: `OpenAlex unreachable: ${err.message}` });
  }
});

// ── General-public newsletter: brief generation (POST /api/newsletter/generate) ──────
// Ported from Druid Centrale (Cloudflare Pages Function) to this Express server.
// OpenAlex articles from the last `days` days (type « article ») are
// popularized in French by the ILAAS LLM (hook + brief) then stored in
// the Grist table `Newsletter` (status « genere »). The associated researcher = first
// staff member of the structure found in the Annuaire (normalized name → Email).
// The call is BATCHED (at most `limit` briefs per invocation): the response reports
// `remaining` and the UI (NewsletterPanel) calls the endpoint again until nothing is left.
// Behind the Keycloak guard (mounted after the auth middleware).
const ILAAS_API_KEY = process.env.ILAAS_API_KEY || '';
const ILAAS_API_BASE = (process.env.ILAAS_API_BASE || 'https://llm.ilaas.fr/v1').replace(/\/$/, '');
const ILAAS_MODEL = process.env.ILAAS_MODEL || 'mistral-small-4-119b';
const GRIST_API_BASE = 'https://grist.numerique.gouv.fr/api';

// ── « Aide Druid » assistant (docs/plan-documentation-utilisateur.md, lot 8) ─────────────────
// Retrieval over the help centre pages (scripts/lib/help_search.cjs, BM25 by section), then ILAAS
// answers from the retrieved excerpts only and cites them; the list of the pages consulted is
// always appended to the stream, so the sources show even if the model forgets to cite them.
// Same OpenAI-format SSE as /api/chat, so the ChatWidget reads both the same way.
// One index per language: the interface language picks it (English pages under en/, falling back to
// French when they are absent — docs/plan-aide-anglais.md).
const helpSearch = require('./scripts/lib/help_search.cjs');
const helpIndexes = {};
const getHelpIndex = (lang) => {
  if (!helpIndexes[lang]) {
    helpIndexes[lang] = helpSearch.loadHelpIndex(HELP_DOCS_DIR, lang);
    const { docs, pageCount } = helpIndexes[lang];
    console.log(`[HelpChat] help index (${lang}): ${docs.length} sections, ${pageCount} pages`);
  }
  return helpIndexes[lang];
};

app.post('/api/help-chat', async (req, res) => {
  if (!CAPABILITIES.HAS_HELP_CHAT) return res.status(503).json({ error: 'Help assistant not configured' });
  const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const userTurns = messages.filter((m) => m.role === 'user');
  if (!userTurns.length) return res.status(400).json({ error: 'messages[] required' });
  const lang = req.body?.lang === 'en' && fs.existsSync(path.join(HELP_DOCS_DIR, 'en')) ? 'en' : 'fr';

  let hits;
  try {
    // The previous question gives context to a short follow-up (« et pour un doublon ? »).
    const query = userTurns.slice(-2).map((m) => m.content).join('\n');
    hits = helpSearch.searchHelp(getHelpIndex(lang), query, 6);
  } catch (err) {
    console.error('[HelpChat] help index unavailable:', err.message);
    return res.status(503).json({ error: 'Help assistant not configured' });
  }

  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), 120000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const upstream = await fetch(`${ILAAS_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ILAAS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ILAAS_MODEL,
        stream: true,
        temperature: 0.2,
        messages: [{ role: 'system', content: helpSearch.buildHelpSystemPrompt(hits, HELP_SITE_URL, undefined, lang) }, ...messages],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      console.error(`[HelpChat] ILAAS HTTP ${upstream.status}`);
      return res.status(502).json({ error: `Assistant unavailable: upstream ${upstream.status}` });
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      // Everything but the terminator is relayed; [DONE] is sent after the sources.
      for (const line of lines) if (line.trim() !== 'data: [DONE]') res.write(`${line}\n`);
    }
    const pages = [];
    for (const h of hits) {
      const pageUrl = h.url.split('#')[0];
      if (!pages.some((p) => p.pageUrl === pageUrl)) pages.push({ pageUrl, url: h.url, title: h.pageTitle });
      if (pages.length === 3) break;
    }
    if (pages.length) {
      const list = pages.map((p) => `[${p.title}](${HELP_SITE_URL}${p.url})`).join(' · ');
      const label = lang === 'en' ? 'Help pages consulted:' : 'Pages de l’aide consultées :';
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n*${label} ${list}*` } }] })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (!res.headersSent) return res.status(502).json({ error: `Assistant unavailable: ${err.message}` });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '\n\n⚠️ Réponse interrompue — réessayez.' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } finally {
    clearTimeout(killer);
  }
});

/** Rebuilds the abstract from the OpenAlex abstract_inverted_index. */
const abstractOf = (w, maxLen = 1600) => {
  const inv = w.abstract_inverted_index;
  if (!inv) return '';
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word;
  }
  return words.join(' ').slice(0, maxLen);
};

/** Normalized name for Annuaire matching (accent- and case-insensitive). */
const normName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

/** Authors affiliated with the structure + identified labs (as in the Veille tab). */
const structAuthorsOf = (w, selfIds, labMap) => {
  const authors = [];
  const labs = new Set();
  for (const a of w.authorships || []) {
    const name = a.author?.display_name || '';
    let matched = false;
    for (const inst of a.institutions || []) {
      const ids = [oaShortId(inst.id), ...(inst.lineage || []).map(oaShortId)];
      for (const id of ids) {
        if (selfIds.has(id)) matched = true;
        if (labMap[id]) { labs.add(labMap[id]); matched = true; }
      }
    }
    if (matched && name) authors.push(name);
  }
  return { authors, labs: [...labs].sort() };
};

/** From a LinkedIn profile URL, a pseudo-handle « @vanity » (the /in/<vanity>
 *  segment) to identify the person when publishing. LinkedIn does not tag by
 *  vanity, but it is the public identifier closest to an @mention. */
const linkedinMention = (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  const m = u.match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/i);
  let vanity = m ? m[1] : u.replace(/^https?:\/\//, '').replace(/\/+$/, '').split('/').pop();
  try { vanity = decodeURIComponent(vanity || ''); } catch { /* keep as is */ }
  return vanity ? `@${vanity}` : '';
};

/** Resolves (OpenAlex) author names to the LinkedIn accounts declared in the
 *  Annuaire → [{ name, url, handle }] (LinkedIn column of the profile record). */
const resolveAuthorMentions = async (authorNames) => {
  const names = (Array.isArray(authorNames) ? authorNames : []).filter(Boolean);
  if (names.length === 0) return [];
  const doc = process.env.VITE_GRIST_DOC_ID;
  const gristKey = GRIST_API_KEY;
  if (!doc || !gristKey) return [];
  try {
    const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/Annuaire/records`, {
      headers: { Authorization: `Bearer ${gristKey}` },
    });
    if (!resp.ok) return [];
    const byName = new Map();
    for (const r of (await resp.json()).records || []) {
      const f = r.fields || {};
      const linkedin = String(f.LinkedIn || '').trim();
      if (!linkedin) continue;
      const full = `${f.Prenom || ''} ${f.Nom || ''}`.trim();
      const entry = { name: full, url: linkedin, handle: linkedinMention(linkedin) };
      byName.set(normName(full), entry);
      byName.set(normName(`${f.Nom || ''} ${f.Prenom || ''}`), entry);
    }
    const out = [];
    const seen = new Set();
    for (const n of names) {
      const e = byName.get(normName(n));
      if (e && e.handle && !seen.has(e.name)) { seen.add(e.name); out.push(e); }
    }
    return out;
  } catch { return []; }
};

/** ILAAS call: hook + general-public brief, JSON output. */
const generateBreve = async (title, abstract, chars) => {
  const target = Math.min(1000, Math.max(300, parseInt(chars, 10) || 300));
  const nPhrases = Math.max(2, Math.round(target / 130));
  const system =
    "Tu écris des brèves de vulgarisation scientifique en français pour la newsletter " +
    "grand public d'un établissement de recherche. Réponds UNIQUEMENT en JSON : " +
    '{"accroche": "...", "resume": "..."}. ' +
    "L'accroche : une question ou une phrase courte et concrète, précédée d'un emoji " +
    `pertinent. Le resume : environ ${target} caractères (${nPhrases} phrases), ` +
    "accessibles et rigoureuses, sans jargon, sans superlatifs marketing, qui " +
    "expliquent l'apport concret du travail.";
  const user =
    `Titre : ${title}\n` +
    (abstract ? `Résumé (langue d'origine) : ${abstract}\n` : '(pas de résumé disponible — appuie-toi sur le titre)\n') +
    '\nÉcris la brève.';
  const r = await fetch(`${ILAAS_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ILAAS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ILAAS_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: Math.max(400, Math.round(target / 2) + 200),
      temperature: 0.4,
    }),
  });
  if (!r.ok) throw new Error(`ILAAS HTTP ${r.status}`);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed.resume) {
        return { accroche: String(parsed.accroche || ''), resume: String(parsed.resume), raw: content };
      }
    } catch { /* fallback: raw text */ }
  }
  return { accroche: '', resume: content.trim(), raw: content };
};

app.post('/api/newsletter/generate', async (req, res) => {
  if (!ILAAS_API_KEY) {
    return res.status(500).json({ error: 'ILAAS_API_KEY not configured (druid service env)' });
  }
  const body = req.body || {};
  const slug = String(body.slug || '');
  if (!/^[a-z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  // Scope: a lab right only generates (Newsletter rows, ILAAS quota) for its
  // own structures (review of 2026-09-16, point 8).
  if (!canAccessSlug(req.session.user?.access, slug)) return res.status(403).json({ error: 'Forbidden' });
  const cfg = readStructConfig(slug);
  if (!cfg) return res.status(404).json({ error: 'Unknown structure' });
  const selfIds = new Set(cfg.openalexId.split('|').filter((id) => /^I\d+$/.test(id)));
  if (selfIds.size === 0) {
    return res.status(422).json({ error: 'The newsletter is only available for structures with an OpenAlex identifier (not groups)' });
  }
  const days = Math.min(90, Math.max(7, parseInt(body.days, 10) || 30));
  const limit = Math.min(6, Math.max(1, parseInt(body.limit, 10) || 4));
  const chars = Math.min(1000, Math.max(300, parseInt(body.chars, 10) || 300));

  const doc = process.env.VITE_GRIST_DOC_ID;
  const gristKey = GRIST_API_KEY;
  if (!doc || !gristKey) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID / GRIST_API_KEY not configured' });
  const gristHeaders = { Authorization: `Bearer ${gristKey}`, 'Content-Type': 'application/json' };

  try {
    // 1. Briefs already in the table (any status) → a work_id is never regenerated.
    const existingResp = await fetch(
      `${GRIST_API_BASE}/docs/${doc}/tables/Newsletter/records?filter=${encodeURIComponent(JSON.stringify({ slug: [slug] }))}`,
      { headers: gristHeaders },
    );
    if (!existingResp.ok) throw new Error(`Grist Newsletter HTTP ${existingResp.status}`);
    const existing = new Set(
      ((await existingResp.json()).records || []).map((r) => String(r.fields.work_id || '')),
    );

    // 2. OpenAlex articles of the period (type article only).
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const filter = `institutions.id:${[...selfIds].join('|')},from_publication_date:${from},type:article`;
    const oaUrl =
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
      '&sort=publication_date:desc&per-page=100' +
      '&select=id,title,doi,publication_date,authorships,primary_location,abstract_inverted_index' +
      (cfg.mailto ? `&mailto=${encodeURIComponent(cfg.mailto)}` : '') +
      (OPENALEX_API_KEY ? `&api_key=${encodeURIComponent(OPENALEX_API_KEY)}` : '');
    const oaResp = await fetch(oaUrl);
    if (!oaResp.ok) throw new Error(`OpenAlex HTTP ${oaResp.status}`);
    const worksAll = ((await oaResp.json()).results || []).filter(
      (w) => !existing.has(oaShortId(w.id)),
    );

    // 3. Annuaire: normalized name → { nom, email, photo, url }. Scope =
    //    lab (LABO column = the structure's acronym), except institution/pole.
    const labos = NEWS_INSTITUTION_SLUGS.has(slug) || !cfg.acronym
      ? null
      : [cfg.acronym.toUpperCase()];
    const annuaireResp = await fetch(
      `${GRIST_API_BASE}/docs/${doc}/tables/Annuaire/records`,
      { headers: gristHeaders },
    );
    const byName = new Map();
    if (annuaireResp.ok) {
      for (const r of (await annuaireResp.json()).records || []) {
        const f = r.fields || {};
        if (labos && !labos.includes(String(f.LABO || '').toUpperCase())) continue;
        const full = `${f.Prenom || ''} ${f.Nom || ''}`.trim();
        if (!full) continue;
        const entry = {
          nom: full,
          email: String(f.Email || ''),
          photo: String(f.photo_url || ''),
          url: String(f.annuaire_url || ''),
        };
        byName.set(normName(full), entry);
        byName.set(normName(`${f.Nom || ''} ${f.Prenom || ''}`), entry);
      }
    }

    // Restrict to staff: only articles carried by at least one researcher from
    // the directory are popularized (unfiltered fallback if the directory is empty).
    const effectifsOf = (w) => {
      const seen = new Set();
      const out = [];
      for (const a of w.authorships || []) {
        const entry = byName.get(normName(a.author?.display_name || ''));
        if (entry && !seen.has(entry.nom)) { seen.add(entry.nom); out.push(entry); }
      }
      return out;
    };
    const works = byName.size ? worksAll.filter((w) => effectifsOf(w).length > 0) : worksAll;

    if (works.length === 0) return res.json({ created: [], skipped: existing.size, remaining: 0 });

    // 4. LLM generation, at most `limit` per invocation.
    const numero = new Date().toISOString().slice(0, 7); // YYYY-MM
    const now = new Date().toISOString();
    const labMap = getNewsLabMap();
    const created = [];
    for (const w of works.slice(0, limit)) {
      const title = w.title || '(sans titre)';
      const { authors, labs } = structAuthorsOf(w, selfIds, labMap);
      let breve;
      try {
        breve = await generateBreve(title, abstractOf(w), chars);
      } catch (e) {
        return res.status(created.length ? 200 : 502).json({
          created,
          skipped: existing.size,
          remaining: works.length - created.length,
          error: `Generation interrupted: ${e.message}`,
        });
      }
      const matches = effectifsOf(w);
      const researcher = matches.find((r) => r.email) || matches.find((r) => r.photo) || matches[0];
      const fields = {
        work_id: oaShortId(w.id),
        slug,
        numero,
        titre: title,
        doi: w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//, '') : '',
        date_publication: w.publication_date || '',
        journal: w.primary_location?.source?.display_name || '',
        auteurs: authors.join(', '),
        labs: labs.join(', '),
        accroche: breve.accroche,
        resume: breve.resume,
        resume_genere: breve.raw,
        statut: 'genere',
        chercheur_nom: researcher?.nom || '',
        chercheur_email: researcher?.email || '',
        chercheur_photo: researcher?.photo || '',
        chercheur_url: researcher?.url || '',
        genere_le: now,
        valide_le: '',
        valide_par: '',
        commentaire: '',
      };
      const add = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/Newsletter/records`, {
        method: 'POST',
        headers: gristHeaders,
        body: JSON.stringify({ records: [{ fields }] }),
      });
      if (!add.ok) throw new Error(`Écriture Grist HTTP ${add.status}`);
      const rec = (await add.json()).records?.[0];
      created.push({ id: rec?.id ?? null, fields });
    }

    return res.json({ created, skipped: existing.size, remaining: works.length - created.length });
  } catch (err) {
    console.error('[Newsletter] error:', err);
    return res.status(502).json({ error: err.message });
  }
});

/** ILAAS call: social media post draft (LinkedIn / X) tailored to the
 *  article's content (same engine as the briefs). Returns ready-to-paste
 *  text (no JSON). */
const generateSocialPost = async ({ title, abstract, authors, labs, journal, link, structName, topics, mentions }) => {
  const system =
    "Tu es chargé·e de communication d'un établissement de recherche. Rédige un " +
    "brouillon de post pour les réseaux sociaux (LinkedIn / X) annonçant une nouvelle " +
    "publication scientifique, en français. Ton chaleureux mais rigoureux, sans " +
    "superlatifs marketing ni jargon. Structure : une accroche avec un emoji pertinent, " +
    "2 à 4 phrases qui expliquent concrètement l'apport de l'article pour le grand " +
    "public, la mention des auteur·rices et du laboratoire, le lien de lecture, puis " +
    "3 à 5 hashtags pertinents. Quand des comptes LinkedIn d'auteur·rices sont fournis, " +
    "mentionne-les avec leur handle « @… » pour inviter à interagir avec elles/eux. " +
    "Réponds UNIQUEMENT avec le texte du post (pas de préambule ni de guillemets englobants).";
  const mentionsLine = (mentions || []).filter((m) => m && m.handle).length
    ? `Comptes LinkedIn des auteur·rices (à mentionner, ex. « @vanity », pour les taguer) : ${
        mentions.filter((m) => m && m.handle).map((m) => `${m.name} ${m.handle}`).join(', ')
      }\n`
    : '';
  const user =
    `Établissement : ${structName}\n` +
    `Titre de l'article : ${title}\n` +
    (authors ? `Auteur·rices : ${authors}\n` : '') +
    mentionsLine +
    (labs ? `Laboratoire(s) : ${labs}\n` : '') +
    (journal ? `Revue : ${journal}\n` : '') +
    (topics && topics.length ? `Thématiques : ${topics.join(', ')}\n` : '') +
    (link ? `Lien de lecture : ${link}\n` : '') +
    (abstract ? `\nRésumé (langue d'origine) :\n${abstract}\n` : '\n(pas de résumé disponible — appuie-toi sur le titre)\n') +
    '\nRédige le post.';
  const r = await fetch(`${ILAAS_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ILAAS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ILAAS_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 500,
      temperature: 0.6,
    }),
  });
  if (!r.ok) throw new Error(`ILAAS HTTP ${r.status}`);
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || '').trim();
};

// Social media post draft tailored to the article (button of the Veille tab).
// The Veille feed does not carry the abstract in each item (lighter payload) →
// it is fetched on demand from OpenAlex by work_id, then generated via ILAAS.
app.post('/api/newsletter/post', async (req, res) => {
  if (!ILAAS_API_KEY) {
    return res.status(500).json({ error: 'ILAAS_API_KEY not configured (druid service env)' });
  }
  const body = req.body || {};
  const workId = String(body.workId || '');
  const slug = String(body.slug || '');
  if (!/^[a-z0-9_-]+$/.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
  if (!canAccessSlug(req.session.user?.access, slug)) return res.status(403).json({ error: 'Forbidden' });
  const cfg = readStructConfig(slug);
  try {
    let abstract = '';
    if (/^W\d+$/.test(workId)) {
      const url =
        `https://api.openalex.org/works/${workId}?select=abstract_inverted_index` +
        (cfg?.mailto ? `&mailto=${encodeURIComponent(cfg.mailto)}` : '') +
        (OPENALEX_API_KEY ? `&api_key=${encodeURIComponent(OPENALEX_API_KEY)}` : '');
      const r = await fetch(url);
      if (r.ok) abstract = abstractOf(await r.json());
    }
    // Authors' LinkedIn accounts (Annuaire profile record) → @vanity mentions.
    const mentions = await resolveAuthorMentions(body.authorNames);
    const post = await generateSocialPost({
      title: String(body.title || ''),
      abstract,
      authors: String(body.authors || ''),
      labs: Array.isArray(body.labs) ? body.labs.join(', ') : String(body.labs || ''),
      journal: String(body.journal || ''),
      link: String(body.link || ''),
      structName: String(body.structName || ''),
      topics: Array.isArray(body.topics) ? body.topics : [],
      mentions,
    });
    return res.json({ post, mentions });
  } catch (e) {
    console.error('[Newsletter post] error:', e);
    return res.status(502).json({ error: `Generation failed: ${e.message}` });
  }
});

// ── Thematic analysis of collaborations (LLM) ───────────────────────────────
// Phase 0 of the « analyse IA des thématiques de collaboration » scenario
// (Druid conversation, 2026-09-03), upstream of the partner institution
// picker (PartnerBilanSection). Principle: the LLM never computes nor
// selects the final list of publications — step 1, it chooses ONLY
// among the domains/subfields/topics actually present in the corpus
// already filtered client-side (institution(s) + period); step 2, it
// writes a synthesis from a shortlist of publications already filtered
// deterministically client-side (composition of buildPartnerMatcher +
// topics kept at step 1, see collabAggregates.ts). Any LLM output that
// does not exactly match an item supplied as input is discarded before
// returning to the client (anti-hallucination guard, see the false positives
// observed on the manual Edinburgh analysis of 2026-09-03).

const MAX_THEME_TOPICS = 60; // items offered as input to step 1 (domains+subfields+topics)
const MAX_THEME_PUBLICATIONS = 80; // publications sent at step 2

/** Step 1: match a free-text theme to OpenAlex domains/subfields/topics
 * taken from a CLOSED list supplied by the client. */
const selectThemeTopics = async (theme, { domains, subfields, topics }) => {
  const system =
    "Tu aides à explorer un corpus de publications scientifiques. On te donne une " +
    "thématique décrite librement par l'utilisateur et une liste FERMÉE de domaines, " +
    "sous-disciplines et sujets (topics) OpenAlex réellement présents dans le corpus. " +
    "Choisis UNIQUEMENT parmi les libellés fournis ceux qui correspondent à la " +
    "thématique — n'invente aucun libellé, ne reformule rien, recopie-les à l'identique. " +
    "Si rien ne correspond, réponds avec des listes vides plutôt que de forcer un lien. " +
    'Réponds UNIQUEMENT en JSON : {"domains": [...], "subfields": [...], "topics": [...]}.';
  const user =
    `Thématique recherchée : ${theme}\n\n` +
    `Domaines disponibles : ${domains.join(' | ') || '(aucun)'}\n` +
    `Sous-disciplines disponibles : ${subfields.join(' | ') || '(aucune)'}\n` +
    `Topics disponibles : ${topics.join(' | ') || '(aucun)'}\n`;
  const r = await fetch(`${ILAAS_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ILAAS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ILAAS_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 600,
      temperature: 0.1,
    }),
  });
  if (!r.ok) throw new Error(`ILAAS HTTP ${r.status}`);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  let parsed = {};
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch { /* fallback: empty lists */ }
  }
  // Anti-hallucination guard: only return labels that are actually present
  // in the input lists.
  const keep = (arr, allowed) => {
    const allowedSet = new Set(allowed);
    return (Array.isArray(arr) ? arr : []).filter((v) => allowedSet.has(v));
  };
  return {
    domains: keep(parsed.domains, domains),
    subfields: keep(parsed.subfields, subfields),
    topics: keep(parsed.topics, topics),
  };
};

app.post('/api/collab-theme/select-topics', async (req, res) => {
  if (!ILAAS_API_KEY) {
    return res.status(500).json({ error: 'ILAAS_API_KEY not configured (druid service env)' });
  }
  const body = req.body || {};
  const theme = String(body.theme || '').trim().slice(0, 300);
  if (!theme) return res.status(400).json({ error: 'Missing theme' });
  const clip = (arr) => (Array.isArray(arr) ? arr : []).map(String).slice(0, MAX_THEME_TOPICS);
  const domains = clip(body.domains);
  const subfields = clip(body.subfields);
  const topics = clip(body.topics);
  try {
    const selection = await selectThemeTopics(theme, { domains, subfields, topics });
    return res.json(selection);
  } catch (e) {
    console.error('[Collab theme] select-topics error:', e);
    return res.status(502).json({ error: `Analysis failed: ${e.message}` });
  }
});

/** Step 2: write a synthesis from a shortlist of publications already filtered
 * client-side (selected institution(s) + topics kept at step 1). The LLM
 * can only highlight researchers/titles present in the supplied list —
 * checked afterwards, as in step 1. */
const synthesizeThemeAnalysis = async (theme, institutionLabel, publications, topResearchers) => {
  const system =
    "Tu es analyste bibliométrique pour un établissement de recherche. On te fournit " +
    "une thématique, le nom d'un ou plusieurs partenaires de collaboration, une liste " +
    "de publications communes (titre, année, sous-discipline/topic, auteur·rices " +
    "internes) et les chercheur·euses internes les plus impliqué·es. Rédige une courte " +
    "synthèse en français (2 paragraphes maximum, sobre, sans superlatif) qui décrit la " +
    "nature de cette collaboration sur cette thématique, et mets en avant 2 à 4 " +
    "chercheur·euses ou publications À CITER EXACTEMENT COMME FOURNIS (ne modifie ni " +
    "n'invente aucun nom ni titre). Si la liste de publications est mince ou hors " +
    "sujet par rapport à la thématique demandée, dis-le honnêtement plutôt que " +
    'd\'inventer un lien. Réponds UNIQUEMENT en JSON : {"synthesis": "...", ' +
    '"highlightedResearchers": ["..."], "highlightedTitles": ["..."]}.';
  const pubLines = publications
    .map((p) => {
      const themes = [...(p.subfields || []), ...(p.topics || [])].join(', ');
      return `- [${p.year ?? '?'}] ${p.title || '(sans titre)'} — ${themes} — ${(p.authors || []).join(', ')}`;
    })
    .join('\n');
  const researchersLine = topResearchers.map((r) => `${r.label} (${r.count})`).join(', ');
  const user =
    `Thématique : ${theme}\n` +
    `Partenaire(s) : ${institutionLabel || '(non précisé)'}\n` +
    `Chercheur·euses internes les plus impliqué·es : ${researchersLine || '(aucun)'}\n\n` +
    `Publications (${publications.length}) :\n${pubLines || '(aucune)'}\n`;
  const r = await fetch(`${ILAAS_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ILAAS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ILAAS_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 900,
      temperature: 0.3,
    }),
  });
  if (!r.ok) throw new Error(`ILAAS HTTP ${r.status}`);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  let parsed = {};
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch { /* fallback: raw text */ }
  }
  const allowedResearchers = new Set(topResearchers.map((r) => r.label));
  const allowedTitles = new Set(publications.map((p) => p.title).filter(Boolean));
  const keep = (arr, allowed) => (Array.isArray(arr) ? arr : []).filter((v) => allowed.has(v));
  return {
    synthesis: String(parsed.synthesis || content).trim(),
    highlightedResearchers: keep(parsed.highlightedResearchers, allowedResearchers),
    highlightedTitles: keep(parsed.highlightedTitles, allowedTitles),
  };
};

app.post('/api/collab-theme/synthesize', async (req, res) => {
  if (!ILAAS_API_KEY) {
    return res.status(500).json({ error: 'ILAAS_API_KEY not configured (druid service env)' });
  }
  const body = req.body || {};
  const theme = String(body.theme || '').trim().slice(0, 300);
  const institutionLabel = String(body.institutionLabel || '').trim().slice(0, 300);
  if (!theme) return res.status(400).json({ error: 'Missing theme' });
  const publications = (Array.isArray(body.publications) ? body.publications : [])
    .slice(0, MAX_THEME_PUBLICATIONS)
    .map((p) => ({
      title: String(p?.title || '').slice(0, 300),
      year: Number.isFinite(p?.year) ? p.year : null,
      subfields: Array.isArray(p?.subfields) ? p.subfields.slice(0, 5).map(String) : [],
      topics: Array.isArray(p?.topics) ? p.topics.slice(0, 5).map(String) : [],
      authors: Array.isArray(p?.authors) ? p.authors.slice(0, 10).map(String) : [],
    }));
  const topResearchers = (Array.isArray(body.topResearchers) ? body.topResearchers : [])
    .slice(0, 20)
    .map((r) => ({ label: String(r?.label || ''), count: Number(r?.count) || 0 }))
    .filter((r) => r.label);
  if (publications.length === 0) {
    return res.status(400).json({ error: 'No publication to analyze' });
  }
  try {
    const result = await synthesizeThemeAnalysis(theme, institutionLabel, publications, topResearchers);
    return res.json(result);
  } catch (e) {
    console.error('[Collab theme] synthesize error:', e);
    return res.status(502).json({ error: `Analysis failed: ${e.message}` });
  }
});

// ── Secret shared with druid-etl-api (X-Druid-Dash-Secret header) ──────────
// The API only accepts calls relayed by Druid (Keycloak session). The
// ETL console (admin role) has been the native EtlConsolePage since
// 2026-09-10; the /dashboard proxy to the Streamlit console was removed
// (docs/archive/plan-console-etl-native.md, lot 4).
const DASHBOARD_SHARED_SECRET = process.env.DASHBOARD_SHARED_SECRET || '';
const isDashboardAdmin = (req) => (req.session?.user?.roles || []).includes('admin');

// ── Group dashboards: relay to the druid-etl-api API ───────────────────────
// Generation/refresh of a Druid group's dashboard (ETL by OpenAlex
// authors, scripts/group_api.py on the druid-biblio side). Behind the
// Keycloak guard — open to any logged-in user (decision by the product owner);
// the upstream API only accepts the shared secret.
const ETL_API_URL = process.env.ETL_API_URL || 'http://druid-etl-api:8600';
const GROUP_SLUG_RE = /^groupe-[a-z0-9_-]+$/;

const relayGroupApi = async (res, method, apiPath, body) => {
  try {
    const r = await fetch(`${ETL_API_URL}${apiPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Druid-Dash-Secret': DASHBOARD_SHARED_SECRET,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    res.status(r.status).type('application/json').send(await r.text());
  } catch (e) {
    res.status(502).json({ error: `ETL API (druid-etl-api) unreachable: ${e.message}` });
  }
};
const requireGroupSlug = (req, res) => {
  if (GROUP_SLUG_RE.test(req.params.slug)) return true;
  res.status(400).json({ error: 'Invalid group slug (expected: groupe-…)' });
  return false;
};

app.get('/api/groups/dashboards', (req, res) =>
  relayGroupApi(res, 'GET', '/api/groups'));
app.post('/api/groups/dashboards', (req, res) => {
  // Creation clears the slugs cache: the new group must show up without
  // waiting for the 5 min of the /api/dashboard-structures cache.
  invalidateDashboardSlugsCache();
  relayGroupApi(res, 'POST', '/api/groups', req.body);
});
app.post('/api/groups/dashboards/:slug/etl', (req, res) => {
  if (!requireGroupSlug(req, res)) return;
  relayGroupApi(res, 'POST', `/api/groups/${req.params.slug}/etl`);
});
app.get('/api/groups/dashboards/:slug/status', (req, res) => {
  if (!requireGroupSlug(req, res)) return;
  relayGroupApi(res, 'GET', `/api/groups/${req.params.slug}/status`);
});
app.delete('/api/groups/dashboards/:slug', (req, res) => {
  if (!requireGroupSlug(req, res)) return;
  invalidateDashboardSlugsCache();
  relayGroupApi(res, 'DELETE', `/api/groups/${req.params.slug}`);
});
// OpenAlex author candidates for a member without ORCID (human confirmation).
app.post('/api/groups/authors-search', (req, res) =>
  relayGroupApi(res, 'POST', '/api/authors/search', req.body));

// OpenAlex Topic distribution of a chosen peer group (Benchmark tab,
// truly peer-relative disciplinary signature — phase 7 of the follow-up plan given to
// the benchmark review, the benchmark action plan). Synchronous call,
// capped on the druid-etl-api side (group_api.py, MAX_PEER_TOPIC_RORS).
app.post('/api/benchmark/topic-distribution', (req, res) =>
  relayGroupApi(res, 'POST', '/api/benchmark/topic-distribution', req.body));

// ── Native ETL console (structures): relay to druid-etl-api ────────────────
// Replaces the Streamlit admin page (biblio_etl/admin.py): structure
// config, regeneration, Grist staff, affiliation corrections.
// API-side contract: biblio_etl/structures_api.py; plan: docs/archive/plan-console-etl-native.md.
// Reserved to the admin role (same rule as the old /dashboard proxy).
const requireDashboardAdmin = (req, res, next) => {
  if (!isDashboardAdmin(req)) return res.status(403).json({ error: 'Administrators only' });
  next();
};
const STRUCTURE_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const requireStructureSlug = (req, res) => {
  const s = req.params.slug;
  if (STRUCTURE_SLUG_RE.test(s) && !s.startsWith('groupe-') && !s.startsWith('_')) return true;
  res.status(400).json({ error: 'Invalid structure slug' });
  return false;
};
const etlStructures = express.Router();
etlStructures.use(requireDashboardAdmin);
etlStructures.get('/', (req, res) => relayGroupApi(res, 'GET', '/api/structures'));
etlStructures.get('/meta', (req, res) => relayGroupApi(res, 'GET', '/api/structures/meta'));
etlStructures.post('/', (req, res) => {
  invalidateDashboardSlugsCache(); // new structure visible without waiting
  relayGroupApi(res, 'POST', '/api/structures', req.body);
});
etlStructures.get('/:slug', (req, res) => {
  if (!requireStructureSlug(req, res)) return;
  relayGroupApi(res, 'GET', `/api/structures/${req.params.slug}`);
});
etlStructures.post('/:slug/config', (req, res) => {
  if (!requireStructureSlug(req, res)) return;
  invalidateDashboardSlugsCache(); // hidden tabs/identity re-read
  relayGroupApi(res, 'POST', `/api/structures/${req.params.slug}/config`, req.body);
});
etlStructures.post('/:slug/etl', (req, res) => {
  if (!requireStructureSlug(req, res)) return;
  relayGroupApi(res, 'POST', `/api/structures/${req.params.slug}/etl`, req.body || {});
});
for (const sub of ['status', 'teams', 'effectifs', 'corrections']) {
  etlStructures.get(`/:slug/${sub}`, (req, res) => {
    if (!requireStructureSlug(req, res)) return;
    relayGroupApi(res, 'GET', `/api/structures/${req.params.slug}/${sub}`);
  });
}
etlStructures.post('/:slug/effectifs/sync', (req, res) => {
  if (!requireStructureSlug(req, res)) return;
  relayGroupApi(res, 'POST', `/api/structures/${req.params.slug}/effectifs/sync`, {});
});
etlStructures.post('/:slug/affiliations/detect', (req, res) => {
  if (!requireStructureSlug(req, res)) return;
  relayGroupApi(res, 'POST', `/api/structures/${req.params.slug}/affiliations/detect`, {});
});
etlStructures.post('/:slug/corrections/:id', (req, res) => {
  if (!requireStructureSlug(req, res)) return;
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  relayGroupApi(res, 'POST', `/api/structures/${req.params.slug}/corrections/${req.params.id}`, req.body);
});
app.use('/api/etl/structures', etlStructures);

// ── Saved Benchmark peer lists (Benchmark tab) ─────────────────────────────
// Unlike the Euniwell group (a fixed institutional fact, hard-coded in
// benchmarkAggregates.ts), a list here is a *personal* preference:
// tied to the Keycloak profile (owner = req.session.user.preferred_username,
// never to the request body — otherwise any caller could read/overwrite
// someone else's lists) rather than to the browser's localStorage like
// the rest of the tab (usePersistedState in BenchmarkTab.tsx). Grist table
// BENCHMARK_PEER_GROUPS_TABLE, auto-provisioned on first use (same
// principle as pushIdrefReview in lib/gristService.ts).
const BENCHMARK_PEER_GROUPS_TABLE = 'BenchmarkPeerGroups';
const gristBenchmarkHeaders = () => {
  const key = GRIST_API_KEY;
  if (!key) throw new Error('GRIST_API_KEY non configurée');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};
const ensureBenchmarkPeerGroupsTable = async (doc, headers) => {
  const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables`, { headers });
  if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} (liste des tables)`);
  const { tables } = await resp.json();
  if (tables.some((t) => t.id === BENCHMARK_PEER_GROUPS_TABLE)) return;
  const create = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tables: [{
        id: BENCHMARK_PEER_GROUPS_TABLE,
        columns: [
          { id: 'owner', fields: { label: 'Propriétaire (Keycloak)', type: 'Text' } },
          { id: 'name', fields: { label: 'Nom de la liste', type: 'Text' } },
          { id: 'rors', fields: { label: 'ROR (JSON)', type: 'Text' } },
          { id: 'updated_at', fields: { label: 'Mis à jour le', type: 'Text' } },
        ],
      }],
    }),
  });
  if (!create.ok) throw new Error(`Grist HTTP ${create.status} (création table)`);
};

app.get('/api/benchmark/peer-groups', async (req, res) => {
  const doc = process.env.VITE_GRIST_DOC_ID;
  if (!doc) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID not configured' });
  try {
    const headers = gristBenchmarkHeaders();
    await ensureBenchmarkPeerGroupsTable(doc, headers);
    const owner = req.session.user.preferred_username;
    const resp = await fetch(
      `${GRIST_API_BASE}/docs/${doc}/tables/${BENCHMARK_PEER_GROUPS_TABLE}/records?filter=${
        encodeURIComponent(JSON.stringify({ owner: [owner] }))}`,
      { headers },
    );
    if (!resp.ok) throw new Error(`Grist HTTP ${resp.status}`);
    const records = (await resp.json()).records || [];
    res.json({
      groups: records
        .map((r) => {
          let rors = [];
          try { rors = JSON.parse(r.fields.rors || '[]'); } catch { /* corrupted list → ignored */ }
          return { id: r.id, name: r.fields.name, rors, updatedAt: r.fields.updated_at || null };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/benchmark/peer-groups', async (req, res) => {
  const doc = process.env.VITE_GRIST_DOC_ID;
  if (!doc) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID not configured' });
  const owner = req.session.user.preferred_username;
  const name = String(req.body?.name || '').trim();
  const rors = Array.isArray(req.body?.rors) ? req.body.rors.filter((r) => typeof r === 'string' && r) : [];
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (rors.length === 0) return res.status(400).json({ error: 'Empty list' });
  try {
    const headers = gristBenchmarkHeaders();
    await ensureBenchmarkPeerGroupsTable(doc, headers);
    // Saving again under a name already used by this same user updates the
    // existing list rather than creating a second one with the same name.
    const existingResp = await fetch(
      `${GRIST_API_BASE}/docs/${doc}/tables/${BENCHMARK_PEER_GROUPS_TABLE}/records?filter=${
        encodeURIComponent(JSON.stringify({ owner: [owner], name: [name] }))}`,
      { headers },
    );
    if (!existingResp.ok) throw new Error(`Grist HTTP ${existingResp.status}`);
    const existing = (await existingResp.json()).records || [];
    const fields = { owner, name, rors: JSON.stringify(rors), updated_at: new Date().toISOString() };
    let id;
    if (existing.length > 0) {
      id = existing[0].id;
      const upd = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/${BENCHMARK_PEER_GROUPS_TABLE}/records`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ records: [{ id, fields }] }),
      });
      if (!upd.ok) throw new Error(`Grist HTTP ${upd.status}`);
    } else {
      const add = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/${BENCHMARK_PEER_GROUPS_TABLE}/records`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields }] }),
      });
      if (!add.ok) throw new Error(`Grist HTTP ${add.status}`);
      id = (await add.json()).records?.[0]?.id ?? null;
    }
    res.json({ id, name, rors });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.delete('/api/benchmark/peer-groups/:id', async (req, res) => {
  const doc = process.env.VITE_GRIST_DOC_ID;
  if (!doc) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID not configured' });
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const headers = gristBenchmarkHeaders();
    const owner = req.session.user.preferred_username;
    // Checks ownership before deletion via the owner filter (already used above)
    // rather than a filter on `id` — the Grist API only guarantees filter on
    // columns, not on the row id. A Grist id is anyway a guessable sequential
    // integer, not a secret: never trust the client-supplied id alone.
    const getResp = await fetch(
      `${GRIST_API_BASE}/docs/${doc}/tables/${BENCHMARK_PEER_GROUPS_TABLE}/records?filter=${
        encodeURIComponent(JSON.stringify({ owner: [owner] }))}`,
      { headers },
    );
    if (!getResp.ok) throw new Error(`Grist HTTP ${getResp.status}`);
    const rec = ((await getResp.json()).records || []).find((r) => r.id === id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    const del = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/${BENCHMARK_PEER_GROUPS_TABLE}/data/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify([id]),
    });
    if (!del.ok) throw new Error(`Grist HTTP ${del.status}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── « À traiter › Tâches »: tasks to carry out outside Druid ───────────────
// docs/plan-chantiers-taches.md, lot 1. Grist tables `Taches` +
// `Taches_evenements` (schema shared with the scripts in
// scripts/lib/tasks_schema.cjs, auto-provisioned on first use). Admin-only
// (decision of 2026-09-23, same scope as the « Doublons » page). The author of
// every write is the Keycloak session, never the request body.
const tasksSchema = require('./scripts/lib/tasks_schema.cjs');
const tasksDocId = () => process.env.VITE_GRIST_DOC_ID;
const gristTasksHeaders = () => {
  if (!GRIST_API_KEY) throw new Error('GRIST_API_KEY not configured');
  return { Authorization: `Bearer ${GRIST_API_KEY}`, 'Content-Type': 'application/json' };
};
let tasksTablesReady = false;
const ensureTasksTablesOnce = async (doc, headers) => {
  if (tasksTablesReady) return;
  await tasksSchema.ensureTasksTables({ apiBase: GRIST_API_BASE, doc, headers, log: console.log });
  tasksTablesReady = true;
};
const gristTasksGet = async (doc, headers, table, filter) => {
  const qs = filter ? `?filter=${encodeURIComponent(JSON.stringify(filter))}` : '';
  const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/${table}/records${qs}`, { headers });
  if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} (${table})`);
  return (await resp.json()).records || [];
};
const gristTasksWrite = async (doc, headers, table, method, records) => {
  const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/${table}/records`, {
    method, headers, body: JSON.stringify({ records }),
  });
  if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} (${table} ${method}): ${await resp.text()}`);
  // A records PATCH answers `null` (only POST returns the new ids).
  const data = await resp.json().catch(() => null);
  return data?.records || [];
};
const taskAuthor = (req) => req.session.user.preferred_username || req.session.user.email || req.session.user.name || 'druid';
/** Grist row → API shape (statut normalised: an empty status typed in Grist reads as `a_faire`). */
const taskOut = (r) => ({ id: r.id, ...r.fields, statut: tasksSchema.statusOf(r.fields), chercheur: r.fields.chercheur || 0 });
const taskEventOut = (r) => ({ id: r.id, tache: r.fields.tache, date: r.fields.date, auteur: r.fields.auteur, action: r.fields.action, detail: r.fields.detail || '' });
const appendTaskEvent = (doc, headers, tache, ev) =>
  gristTasksWrite(doc, headers, tasksSchema.EVENTS_TABLE, 'POST', [{ fields: { tache, ...ev } }]);
const taskErrorStatus = (e) => (e instanceof tasksSchema.TaskInputError ? 400 : 502);
/** Loads one task by id (the Grist filter works on columns only, so the id is checked locally). */
const loadTask = async (doc, headers, id) => {
  const rec = (await gristTasksGet(doc, headers, tasksSchema.TASKS_TABLE)).find((r) => r.id === id);
  if (!rec) { const err = new Error('Task not found'); err.status = 404; throw err; }
  return rec;
};
const withTasks = (handler) => async (req, res) => {
  const doc = tasksDocId();
  if (!doc) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID not configured' });
  try {
    const headers = gristTasksHeaders();
    await ensureTasksTablesOnce(doc, headers);
    await handler(req, res, { doc, headers });
  } catch (e) {
    res.status(e.status || taskErrorStatus(e)).json({ error: e.message });
  }
};
const parseTaskId = (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'Invalid id' }); return null; }
  return id;
};

// ── « Mes rapports » (docs/plan-mes-rapports.md, lot 2) ──────────────────────
// Reports, shares and generation history in the Rapports* tables of the Grist doc. Routing,
// access control and validation live in scripts/lib/reports_store.cjs, shared with the
// Cloudflare Pages Function functions/api/reports/[[path]].js. Every authenticated user may
// create reports (decision R9); the rights on the data themselves stay those of each reader.
const reportsStore = require('./scripts/lib/reports_store.cjs');
// Archived PDFs (lot 9): a directory of the container volume (druid.yaml mounts it on the host).
const { fsBlobs } = require('./scripts/lib/reports_blobs_fs.cjs');
const REPORT_PDF_DIR = process.env.REPORT_PDF_DIR || path.join(__dirname, 'report-pdfs');
const reportBlobs = fsBlobs(REPORT_PDF_DIR);
app.all(
  ['/api/reports', '/api/reports/*'],
  // PDF upload of a generation: raw bytes (the JSON parser leaves them aside).
  express.raw({ type: 'application/pdf', limit: reportsStore.LIMITS.maxPdfBytes }),
  async (req, res) => {
    const doc = process.env.VITE_GRIST_DOC_ID;
    if (!doc) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID not configured' });
    if (!GRIST_API_KEY) return res.status(500).json({ error: 'GRIST_API_KEY not configured' });
    const sessionUser = req.session.user;
    if (!sessionUser?.preferred_username) return res.status(401).json({ error: 'Unauthorized' });
    const store = reportsStore.createReportsStore(
      reportsStore.gristClient({ apiBase: GRIST_API_BASE, doc, apiKey: GRIST_API_KEY }),
      { blobs: reportBlobs },
    );
    const user = { id: sessionUser.preferred_username, isSuperAdmin: !!sessionUser.access?.isSuperAdmin };
    const out = await reportsStore.routeReports(store, user, {
      method: req.method,
      segments: req.path.replace(/^\/api\/reports\/?/, '').split('/'),
      body: Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : req.body,
    });
    if (out.binary) {
      return res.status(out.status)
        .type('application/pdf')
        .set('Content-Disposition', `attachment; filename="${out.filename}"`)
        .set('Cache-Control', 'private, no-store')
        .send(Buffer.from(out.binary));
    }
    res.status(out.status).json(out.body);
  },
);

// AI texts of the reports (plan-mes-rapports lot 8): ILAAS writes, the client computes the figures.
// Same module on Cloudflare (functions/api/report-ai.js).
const reportsAi = require('./scripts/lib/reports_ai.cjs');
app.post('/api/report-ai', async (req, res) => {
  if (!ILAAS_API_KEY) return res.status(500).json({ error: 'ILAAS_API_KEY not configured (druid service env)' });
  const ai = reportsAi.createReportAi({ apiBase: ILAAS_API_BASE, apiKey: ILAAS_API_KEY, model: ILAAS_MODEL });
  const out = await ai.run(req.body || {});
  if (out.status >= 500) console.error('[Report AI]', out.body.error);
  res.status(out.status).json(out.body);
});

// Detection rules (docs/plan-chantiers-taches.md, lot 5): scripts/sync_tasks.cjs reads the
// alignment caches + the Annuaire and creates / verifies / auto-resolves the rule-generated
// tasks. Same background-run contract as the alignments (progress file, 409 while running).
// Also scheduled daily by ofelia (docker/ofelia/config.ini, job druid-tasks-detect).
const TASKS_DETECT_PROGRESS = 'tasks_detect_progress.json';
app.get('/api/tasks/detect/trigger', requireSuperAdmin, (req, res) => {
  const running = runningProgress(TASKS_DETECT_PROGRESS);
  if (running) return res.status(409).json({ error: 'Task detection already running', progress: running });
  try {
    console.log('[Sync] Triggering task detection rules...');
    startBackgroundRun('Tasks', TASKS_DETECT_PROGRESS, {}, ['scripts/sync_tasks.cjs', '--apply']);
    res.json({ started: true });
  } catch (err) {
    console.error('[Sync Tasks Error]', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/tasks/detect/progress', requireSuperAdmin, (req, res) => {
  try {
    if (!fs.existsSync(TASKS_DETECT_PROGRESS)) return res.json({ running: false });
    res.json(JSON.parse(fs.readFileSync(TASKS_DETECT_PROGRESS, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ABES export marked as sent (docs/plan-chantiers-taches.md, lot 6): closes the open `lot_abes`
// tasks covered by the exported rows. Body { date, items: [{ rowId, uid, types }] } built by
// AbesExportModal from lib/abesExport.ts abesTaskTypes; matching in tasks_schema.abesSentPatches.
app.post('/api/tasks/abes-sent', requireSuperAdmin, withTasks(async (req, res, { doc, headers }) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? req.body.date : new Date().toISOString().slice(0, 10);
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 20000).map((it) => ({
    rowId: Number.isInteger(it?.rowId) ? it.rowId : 0,
    uid: String(it?.uid || '').slice(0, 64),
    types: (Array.isArray(it?.types) ? it.types : []).filter((x) => tasksSchema.TASK_TYPES[x]),
  }));
  const tasks = await gristTasksGet(doc, headers, tasksSchema.TASKS_TABLE);
  const { patches, events } = tasksSchema.abesSentPatches(tasks, items, { author: taskAuthor(req), date });
  for (let i = 0; i < patches.length; i += 100) await gristTasksWrite(doc, headers, tasksSchema.TASKS_TABLE, 'PATCH', patches.slice(i, i + 100));
  for (let i = 0; i < events.length; i += 100) await gristTasksWrite(doc, headers, tasksSchema.EVENTS_TABLE, 'POST', events.slice(i, i + 100).map((fields) => ({ fields })));
  res.json({ closed: patches.length });
}));

// « À traiter › Affiliations OpenAlex » tab (lot 6): read-only view of the suspicious OpenAlex
// affiliations detected by the ETL console (Grist table Corrections_affiliations_Openalex, edited
// in Administration › ETL console). Missing table ⇒ empty list.
app.get('/api/tasks/openalex-affiliations', requireSuperAdmin, async (req, res) => {
  const doc = tasksDocId();
  if (!doc) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID not configured' });
  try {
    const headers = gristTasksHeaders();
    const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/Corrections_affiliations_Openalex/records`, { headers });
    if (resp.status === 404) return res.json({ corrections: [] });
    if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} (Corrections_affiliations_Openalex)`);
    const corrections = ((await resp.json()).records || []).map((r) => ({ id: r.id, ...r.fields }));
    res.json({ corrections });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// « À traiter › Conflits annuaire <source> »: arbitration of the conflicts left by a directory
// import (Grist tables `Arbitrage_*`, scripts/lib/import_conflicts.cjs). Admin-only, like the
// other « À traiter » tabs; every choice is written with the author of the Keycloak session.
const importConflicts = require('./scripts/lib/import_conflicts.cjs');
/** Annuaire column types + label maps of its Ref columns (id ↔ label). */
const loadAnnuaireMeta = async (doc, headers) => {
  const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables/${importConflicts.ANNUAIRE}/columns`, { headers });
  if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} (Annuaire columns)`);
  const columns = (await resp.json()).columns || [];
  const colTypes = new Map(columns.map((c) => [c.id, c.fields.type]));
  const refLabels = new Map();
  const refIds = new Map();
  for (const c of columns) {
    const target = String(c.fields.type).startsWith('Ref:') ? c.fields.type.slice(4) : '';
    const labelCol = importConflicts.REF_LABEL_COLUMNS[target];
    if (!labelCol) continue;
    const rows = await gristTasksGet(doc, headers, target);
    refLabels.set(c.id, new Map(rows.map((r) => [r.id, String(r.fields[labelCol] ?? '')])));
    refIds.set(c.id, new Map(rows.map((r) => [String(r.fields[labelCol] ?? '').toUpperCase(), r.id])));
  }
  return { colTypes, refLabels, refIds };
};
const loadAnnuaireRecords = async (doc, headers, ids) => {
  if (ids.length === 0) return new Map();
  const rows = await gristTasksGet(doc, headers, importConflicts.ANNUAIRE, { id: [...new Set(ids)] });
  return new Map(rows.map((r) => [r.id, r.fields]));
};
const listConflictTables = async (doc, headers) => {
  const resp = await fetch(`${GRIST_API_BASE}/docs/${doc}/tables`, { headers });
  if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} (tables)`);
  return ((await resp.json()).tables || []).map((t) => t.id).filter(importConflicts.isConflictTable);
};
/** Resolves `:table` against the existing Arbitrage_* tables (never a free table name). */
const conflictTableOf = async (req, doc, headers) => {
  const table = String(req.params.table || '');
  if (!importConflicts.isConflictTable(table) || !(await listConflictTables(doc, headers)).includes(table)) {
    const err = new Error('Conflict table not found'); err.status = 404; throw err;
  }
  return table;
};
const withConflicts = (handler) => async (req, res) => {
  const doc = tasksDocId();
  if (!doc) return res.status(500).json({ error: 'VITE_GRIST_DOC_ID not configured' });
  try {
    await handler(req, res, { doc, headers: gristTasksHeaders() });
  } catch (e) {
    res.status(e.status || (e instanceof importConflicts.ConflictInputError ? 400 : 502)).json({ error: e.message });
  }
};

/** Open rows of a table that still need a decision (same list as the tab shows). */
const actionableConflicts = async (doc, headers, table, meta) => {
  const rows = (await gristTasksGet(doc, headers, table)).filter((r) => importConflicts.isOpen(r.fields));
  const annuaire = await loadAnnuaireRecords(doc, headers, rows.map((r) => r.fields[importConflicts.COL.record]));
  return importConflicts.openConflicts(rows, { ...meta, annuaire });
};

// Tables with their number of actionable conflicts (tab + counter; a settled table stays listed with 0).
app.get('/api/import-conflicts', requireSuperAdmin, withConflicts(async (req, res, { doc, headers }) => {
  const ids = await listConflictTables(doc, headers);
  const meta = ids.length ? await loadAnnuaireMeta(doc, headers) : null;
  const tables = [];
  for (const id of ids) {
    tables.push({ id, source: importConflicts.sourceLabel(id), open: (await actionableConflicts(doc, headers, id, meta)).length });
  }
  res.json({ tables });
}));

app.get('/api/import-conflicts/:table', requireSuperAdmin, withConflicts(async (req, res, { doc, headers }) => {
  const table = await conflictTableOf(req, doc, headers);
  const conflicts = await actionableConflicts(doc, headers, table, await loadAnnuaireMeta(doc, headers));
  res.json({ source: importConflicts.sourceLabel(table), conflicts });
}));

// Body: { decisions: [{ id, choice: 'import'|'current'|'other', value? }] } (≤ 500 per call).
app.post('/api/import-conflicts/:table/resolve', requireSuperAdmin, withConflicts(async (req, res, { doc, headers }) => {
  const table = await conflictTableOf(req, doc, headers);
  const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];
  if (decisions.length === 0 || decisions.length > 500) throw new importConflicts.ConflictInputError('1 to 500 decisions expected');
  const rows = (await gristTasksGet(doc, headers, table)).filter((r) => importConflicts.isOpen(r.fields));
  const targeted = rows.filter((r) => decisions.some((d) => d?.id === r.id));
  const meta = await loadAnnuaireMeta(doc, headers);
  const annuaire = await loadAnnuaireRecords(doc, headers, targeted.map((r) => r.fields[importConflicts.COL.record]));
  const { annuairePatches, rowPatches } = importConflicts.buildWrites(targeted, decisions, {
    ...meta, annuaire, source: importConflicts.sourceLabel(table), author: taskAuthor(req), nowIso: new Date().toISOString(),
  });
  // Annuaire first: a failure leaves the conflicts open, never marked resolved without effect.
  for (const group of importConflicts.groupBySameFields(annuairePatches)) {
    await gristTasksWrite(doc, headers, importConflicts.ANNUAIRE, 'PATCH', group);
  }
  for (const group of importConflicts.groupBySameFields(rowPatches)) {
    await gristTasksWrite(doc, headers, table, 'PATCH', group);
  }
  res.json({ resolved: rowPatches.length, updatedRecords: annuairePatches.length });
}));

// List (all statuses: the client filters, the table stays small).
app.get('/api/tasks', requireSuperAdmin, withTasks(async (req, res, { doc, headers }) => {
  const tasks = (await gristTasksGet(doc, headers, tasksSchema.TASKS_TABLE)).map(taskOut);
  res.json({ tasks });
}));

app.get('/api/tasks/:id/events', requireSuperAdmin, withTasks(async (req, res, { doc, headers }) => {
  const id = parseTaskId(req, res);
  if (id === null) return;
  const events = (await gristTasksGet(doc, headers, tasksSchema.EVENTS_TABLE, { tache: [id] }))
    .map(taskEventOut)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  res.json({ events });
}));

app.post('/api/tasks', requireSuperAdmin, withTasks(async (req, res, { doc, headers }) => {
  const author = taskAuthor(req);
  const nowIso = new Date().toISOString();
  const fields = tasksSchema.normalizeCreate(req.body, { author, nowIso });
  const [added] = await gristTasksWrite(doc, headers, tasksSchema.TASKS_TABLE, 'POST', [{ fields }]);
  await appendTaskEvent(doc, headers, added.id, { date: nowIso, auteur: author, action: 'creation', detail: fields.titre });
  res.json({ task: taskOut({ id: added.id, fields }) });
}));

// Editable fields only (assignee, priorite, canal, description, titre, lien).
app.patch('/api/tasks/:id', requireSuperAdmin, withTasks(async (req, res, { doc, headers }) => {
  const id = parseTaskId(req, res);
  if (id === null) return;
  const patch = tasksSchema.normalizePatch(req.body);
  const rec = await loadTask(doc, headers, id);
  await gristTasksWrite(doc, headers, tasksSchema.TASKS_TABLE, 'PATCH', [{ id, fields: patch }]);
  const author = taskAuthor(req);
  const action = 'assignee' in patch && Object.keys(patch).length === 1 ? 'reassignation' : 'modification';
  const detail = action === 'reassignation' ? patch.assignee : Object.keys(patch).join(', ');
  await appendTaskEvent(doc, headers, id, { date: new Date().toISOString(), auteur: author, action, detail });
  res.json({ task: taskOut({ id, fields: { ...rec.fields, ...patch } }) });
}));

// Workflow: { statut, motif?, resolution? } — transitions checked server-side.
app.post('/api/tasks/:id/transition', requireSuperAdmin, withTasks(async (req, res, { doc, headers }) => {
  const id = parseTaskId(req, res);
  if (id === null) return;
  const rec = await loadTask(doc, headers, id);
  const { patch, event } = tasksSchema.applyTransition(rec.fields, String(req.body?.statut || ''), {
    author: taskAuthor(req), motif: req.body?.motif, resolution: req.body?.resolution,
  });
  await gristTasksWrite(doc, headers, tasksSchema.TASKS_TABLE, 'PATCH', [{ id, fields: patch }]);
  await appendTaskEvent(doc, headers, id, event);
  res.json({ task: taskOut({ id, fields: { ...rec.fields, ...patch } }) });
}));

// Free events: comment, or « email prepared » (lot 3: copied / opened in the mail client).
app.post('/api/tasks/:id/events', requireSuperAdmin, withTasks(async (req, res, { doc, headers }) => {
  const id = parseTaskId(req, res);
  if (id === null) return;
  const action = String(req.body?.action || '');
  if (!['commentaire', 'email_prepare'].includes(action)) return res.status(400).json({ error: 'Unknown event action' });
  const detail = String(req.body?.detail || '').trim().slice(0, 4000);
  if (action === 'commentaire' && !detail) return res.status(400).json({ error: 'Empty comment' });
  await loadTask(doc, headers, id);
  const [added] = await appendTaskEvent(doc, headers, id, { date: new Date().toISOString(), auteur: taskAuthor(req), action, detail });
  res.json({ event: taskEventOut({ id: added.id, fields: { tache: id, date: new Date().toISOString(), auteur: taskAuthor(req), action, detail } }) });
}));

// ── Media monitoring (media_watch): press/video/radio/podcast mentions ──────
// Read-only (phase 1). Collection and matching on the druid-biblio side
// (media_watch/run.py, nightly cron in druid-etl-api); here a simple authenticated relay.
app.get('/api/mentions', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  relayGroupApi(res, 'GET', `/api/mentions${qs ? `?${qs}` : ''}`);
});
// Validation of a mention (« À valider » queue of the « Médias » tab). Open to
// any logged-in user (same decision as the group dashboards);
// the Keycloak identity is recorded in review_by, and the decision is
// propagated to the Grist Mentions table by the upstream API (write-through).
app.post('/api/mentions/:id/review', (req, res) => {
  if (!/^[0-9a-f]{40}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid mention identifier' });
  }
  relayGroupApi(res, 'POST', `/api/mentions/${req.params.id}/review`, {
    ...req.body,
    reviewer: req.session?.user?.preferred_username || 'druid',
  });
});

// ── Administration of the media monitoring sources (Sources page of the
// « Veille > Médias » tab) — media_admin role or super admin, NOT open to any
// logged-in user like /api/mentions above: it writes to the registry of
// collected feeds and publishes mentions without going through the
// automatic matching (see group_api.py::_add_manual_mention, lot 2).
app.get('/api/media-sources', requireMediaAdmin, (req, res) =>
  relayGroupApi(res, 'GET', '/api/media-sources'));
app.post('/api/media-sources', requireMediaAdmin, (req, res) => {
  relayGroupApi(res, 'POST', '/api/media-sources', {
    ...req.body,
    added_by: req.session?.user?.preferred_username || 'druid',
  });
});
app.delete('/api/media-sources/:id', requireMediaAdmin, (req, res) => {
  if (!/^[0-9a-f]{6,32}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid source identifier' });
  }
  relayGroupApi(res, 'DELETE', `/api/media-sources/${req.params.id}`);
});
app.post('/api/media-mentions/manual', requireMediaAdmin, (req, res) => {
  relayGroupApi(res, 'POST', '/api/media-mentions/manual', {
    ...req.body,
    added_by: req.session?.user?.preferred_username || 'druid',
  });
});

// ── SoVisu+ sync (people.csv write) ────────────────────────────────────────
const CSV_PATH = process.env.CDB_DATA_PATH || '/cdb-data/people.csv';
const CSV_HEADERS = [
  'first_names', 'last_name', 'main_research_structure', 'tracking_id', 'local',
  'eppn', 'idhals', 'idhali', 'orcid', 'idref', 'scopus', 'openalex',
  'institution_identifier', 'institution_id_nomenclature', 'position',
  'employment_start_date', 'employment_end_date', 'hdr',
  // Membership of the primary structure (cdb format: membership_*), distinct from employment —
  // Annuaire columns affiliation_start/end_date + membership_type (stat_mmb / assoc_mmb / second_mmb /
  // visit_mmb, empty ⇒ cdb default stat_mmb), added on 2026-09-14.
  'membership_start_date', 'membership_end_date', 'membership_type',
];

function csvEscape(value) {
  const str = (value ?? '').toString();
  // \r included: a lone CR broke the record for pandas on the cdb side (review of 2026-09-16, point 10).
  if (/[,"\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// cdb wants full ISO dates: a fuzzy Druid date (`2026`, `2026-06`) is expanded to the bound of
// its period — start dates to the first day, end dates to the last day (lib/dates.ts).
const isoDate = (v, edge = 'start') => fuzzyDateBound(v, edge);

/**
 * Builds the people.csv CSV (cdb) from the researchers/structures serialized by the
 * frontend — pure (no I/O), extracted from the Express handler to be testable without req/res mocks
 * (lot 2, docs/plan-architecture-multi-instances.md). One row per person: qualified
 * multi-affiliations already arrive grouped (record carried by the PRINCIPAL
 * row); unqualified duplicates are deduplicated on the uid (1st occurrence).
 */
function buildPeopleCsv(researchers, structures) {
  const structureByAcronym = {};
  for (const s of structures) {
    if (s.acronym) structureByAcronym[s.acronym.toUpperCase().trim()] = s;
  }

  const rows = [CSV_HEADERS.join(',')];
  let skipped = 0;
  const seenUids = new Set();
  let dedup = 0;
  for (const r of researchers) {
    if (!r.uid) { skipped++; continue; }
    if (seenUids.has(r.uid)) { dedup++; continue; }
    seenUids.add(r.uid);
    const primary = (r.affiliations || []).find((a) => a && a.isPrimary) || r.affiliations?.[0];
    const labName = primary?.structureName || '';
    const struct = structureByAcronym[labName.toUpperCase().trim()];
    // main_research_structure = the structure's local_id (= supannCodeEntite; used to
    // build the Neo4j uid local-<local_id>). The local_id is now the only structure pivot.
    const mainResearchStructure = struct?.localId || '';
    const uai = r.employment?.institutionId || '';

    const row = [
      r.firstName || '',
      r.lastName || '',
      mainResearchStructure,
      r.uid,
      r.uid,
      r.eppn || '',
      r.identifiers?.halId || '',
      r.identifiers?.halIdNum || '',                // idhali = Annuaire column IdHAL_i (HAL alignment)
      r.identifiers?.orcid || '',
      r.identifiers?.idref || '',
      r.identifiers?.scopusId || '',
      // openalex = Annuaire column OpenAlex_ids (OpenAlex alignment, pipe-separated A-ids). Harmless
      // today: cdb / the IKG ignore an unknown identifier type (« Unknown identifier type »)
      // and keep only one value per type — no effect until the consortium issues A1/A2 are
      // delivered (docs/archive/plan-alignement-openalex.md, lot 4).
      r.identifiers?.openalexIds || '',
      uai,
      uai ? 'UAI' : '',
      r.employment?.grade || '',
      isoDate(r.employment?.startDate, 'start'),
      isoDate(r.employment?.endDate, 'end'),
      // cdb (convert_spreadsheet_people.extract_employment_hdr) only accepts yes/no; empty = unknown.
      r.nuFields?.hdr ? 'yes' : '',
      isoDate(primary?.startDate, 'start'),
      isoDate(primary?.endDate, 'end'),
      ['stat_mmb', 'assoc_mmb', 'second_mmb', 'visit_mmb'].includes(primary?.membershipType) ? primary.membershipType : '',
    ].map(csvEscape);

    rows.push(row.join(','));
  }

  return { csv: rows.join('\n') + '\n', count: rows.length - 1, skipped, dedup };
}

app.post('/api/sync-sovisuplus', requireEstablishmentScope, (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.researchers) || !Array.isArray(body.structures)) {
    return res.status(400).json({ error: 'researchers and structures arrays required' });
  }
  const { csv, count, skipped, dedup } = buildPeopleCsv(body.researchers, body.structures);
  try {
    fs.writeFileSync(CSV_PATH, csv, 'utf8');
    console.log(`[SoVisu+] people.csv written: ${count} rows, ${skipped} skipped (no uid), ${dedup} duplicate uid rows dropped`);
    res.json({ success: true, count, skipped, dedup });
  } catch (err) {
    console.error('[SoVisu+] Write error:', err);
    res.status(500).json({ error: `Cannot write ${CSV_PATH}: ${err.message}` });
  }
});

// ── structures.csv generation (from Grist, for cdb) ────────────────────────
// Structures counterpart of the people.csv generation: Druid (re)produces the
// directory bridge's source file. The Grist « Structures » table maps 1:1 onto the 24
// columns of structures.csv → the Grist values are dumped directly (faithful,
// preserves generic_type / tracking_id / inclusions / participations…).
const STRUCT_CSV_PATH = process.env.CDB_STRUCT_PATH || '/cdb-data/structures.csv';
const STRUCT_HEADERS = [
  'generic_type', 'type', 'local_types', 'main_mission', 'secondary_missions',
  'local_id', 'tracking_id', 'short_labels', 'long_labels', 'descriptions',
  'inclusions', 'participations', 'uai', 'nns', 'ror', 'isni', 'wikidata',
  'scopus', 'erc_research_field', 'hceres_research_areas', 'hal_collection',
  'web', 'signature', 'campus',
];

// Grist returns null for empty cells, 0 for an empty Numeric (e.g. scopus),
// and ["L", ...] for ChoiceLists.
function gristCell(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.filter((x) => x !== 'L').join('|');
  if (typeof v === 'number') return v === 0 ? '' : String(v);
  return String(v);
}

/** Builds the structures.csv CSV (cdb) from the Grist Structures records —
 * pure (no network or file access), extracted from the Express handler (lot 2). */
function buildStructuresCsv(records) {
  const rows = [STRUCT_HEADERS.join(',')];
  for (const rec of records || []) {
    const f = rec.fields || {};
    rows.push(STRUCT_HEADERS.map((h) => csvEscape(gristCell(f[h]))).join(','));
  }
  return { csv: rows.join('\n') + '\n', count: rows.length - 1 };
}

app.post('/api/sync-structures-csv', requireEstablishmentScope, async (req, res) => {
  try {
    const DOC = process.env.VITE_GRIST_DOC_ID;
    const KEY = GRIST_API_KEY;
    if (!DOC || !KEY) throw new Error('VITE_GRIST_DOC_ID / GRIST_API_KEY non configurés');
    const gristUrl = `https://grist.numerique.gouv.fr/api/docs/${DOC}/tables/Structures/records`;
    const gr = await fetch(gristUrl, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!gr.ok) throw new Error(`Grist ${gr.status}: ${await gr.text()}`);
    const { records } = await gr.json();
    const { csv, count } = buildStructuresCsv(records);
    fs.writeFileSync(STRUCT_CSV_PATH, csv, 'utf8');
    console.log(`[cdb] structures.csv written: ${count} rows`);
    res.json({ success: true, count });
  } catch (err) {
    console.error('[cdb] structures.csv write error:', err);
    res.status(500).json({ error: `Cannot write ${STRUCT_CSV_PATH}: ${err.message}` });
  }
});

// ── SoVisu+ export status (Administration) ─────────────────────────────────
// Last generation date and record count of the two cdb files, shown under the
// « Synchronise with SoVisu+ » button so a stale file is visible at a glance
// (structures.csv had not been regenerated since June as of 2026-09-29).

/** Counts the CSV records (header excluded), honouring quoted cells that span
 * several lines (descriptions) — pure. */
function countCsvRecords(text) {
  let records = 0, inQuotes = false, rowHasContent = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    if (c === '\n' && !inQuotes) {
      if (rowHasContent) records++;
      rowHasContent = false;
    } else if (c !== '\r') {
      rowHasContent = true;
    }
  }
  if (rowHasContent) records++;
  return Math.max(0, records - 1);
}

function cdbFileStatus(file) {
  if (!fs.existsSync(file)) return null;
  return {
    updatedAt: fs.statSync(file).mtime.toISOString(),
    count: countCsvRecords(fs.readFileSync(file, 'utf8')),
  };
}

app.get('/api/sovisu-export-status', requireEstablishmentScope, (req, res) => {
  try {
    res.json({ structures: cdbFileStatus(STRUCT_CSV_PATH), people: cdbFileStatus(CSV_PATH) });
  } catch (err) {
    console.error('[cdb] status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Structures hierarchy dataviz (vendored crisalid-directory-bridge tool) ───
// Runs scripts/structures-viz/visualize_structures.py on the current structures.csv
// (/cdb-data/structures.csv) and returns the standalone HTML (Cytoscape.js). Shown in
// the « Dataviz » tab of the Structures page via an <iframe>. Light mtime-based cache.
const STRUCT_VIZ_SCRIPT = path.join(__dirname, 'scripts', 'structures-viz', 'visualize_structures.py');
const STRUCT_VIZ_OUT = '/tmp/structures-hierarchy.html';
app.get('/api/structures-hierarchy.html', (req, res) => {
  try {
    if (!fs.existsSync(STRUCT_CSV_PATH)) {
      return res.status(404).type('text/plain').send(
        "structures.csv introuvable — génère-le d'abord via Administration → « Synchroniser avec SoVisu+ »."
      );
    }
    // Regenerate only if the CSV is newer than the HTML already produced.
    const fresh = !req.query.force && fs.existsSync(STRUCT_VIZ_OUT)
      && fs.statSync(STRUCT_VIZ_OUT).mtimeMs >= fs.statSync(STRUCT_CSV_PATH).mtimeMs;
    if (fresh) return res.sendFile(STRUCT_VIZ_OUT);

    let done = false;
    const fail = (msg) => { if (!done) { done = true; res.status(500).type('text/plain').send(msg); } };
    const child = spawn('python3', [STRUCT_VIZ_SCRIPT, STRUCT_CSV_PATH, STRUCT_VIZ_OUT]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { console.error('[viz] spawn error', err); fail('python3 indisponible : ' + err.message); });
    child.on('close', (code) => {
      if (done) return;
      if (code !== 0 || !fs.existsSync(STRUCT_VIZ_OUT)) {
        console.error('[viz] script failed code=', code, stderr);
        return fail(`Échec génération hiérarchie (code ${code}).\n${stderr}`);
      }
      done = true;
      res.sendFile(STRUCT_VIZ_OUT);
    });
  } catch (err) {
    console.error('[viz] error', err);
    res.status(500).type('text/plain').send('Erreur: ' + err.message);
  }
});

// ── Grist proxy: server-side scope ─────────────────────────────────────────
// The proxy relays with the server key (full rights on the document). Without
// a guard, any logged-in user — i.e. the whole university since the implicit
// lab right (parseDruidAccess) — could read, write or delete any table,
// or even other documents of the key (server.cjs review of
// 2026-09-16, point 1). Rules:
//  - path: docs/<allowed doc>[/tables[/<table>[/records|/columns|/data/delete]]]
//    (docs = VITE_GRIST_DOC_ID + GRIST_EXTRA_DOC_IDS, e.g. the curation doc of the
//    AxesTab axes); the doc root is only relayed for GET (updatedAt, see
//    gristService.getDocUpdatedAt); everything else (orgs, workspaces,
//    attachments, sql…) is refused;
//  - GET: any logged-in user (status quo — the frontend reads the full Annuaire
//    and filters by scope client-side, see lib/auth.canSeeStructure);
//  - structural writes (POST /tables, /columns), tables without a scope
//    column (Alignement_*, Fusions_log, Etablissements…) and side docs:
//    institution right (access.allSlugs);
//  - record writes with a lab right: Annuaire (LABO),
//    Structures (short_labels) and Newsletter (slug) only, and every targeted
//    row must belong to a lab within the scope — sent values checked in
//    the body, existing rows re-read via Grist's SQL endpoint;
//    plus Fusions_log (log without a scope column: the Annuaire rows touched
//    by a merge are, themselves, checked) and the axes curation tables
//    (GRIST_LAB_TABLES_EXTRA, mirror of AxesTab.AXES_GRIST).
const GRIST_ALLOWED_DOCS = new Set(
  [process.env.VITE_GRIST_DOC_ID, ...String(process.env.GRIST_EXTRA_DOC_IDS || '').split(',')]
    .map((s) => String(s || '').trim())
    .filter(Boolean),
);
const GRIST_PATH_RE = /^docs\/([A-Za-z0-9_-]+)(?:\/(tables)(?:\/([A-Za-z0-9_]+)(?:\/(records|columns|data\/delete))?)?)?$/;
// Side-doc tables writable (records, PATCH/POST) by the lab right of the given
// slug — mirror of components/dashboard/AxesTab.tsx AXES_GRIST.
const GRIST_LAB_TABLES_EXTRA = {
  '5aREUrB1kuFAcVY4GTUDfA/Publications_centrale_axes_strategiques2': 'ec-nantes',
};
// Main-doc tables without a scope column but open to record writes
// for the lab right (merge / restore log).
const GRIST_LAB_TABLES_LOG = new Set(['Fusions_log']);
// « LS2N[fr]|LS2N[en] » → « LS2N » (same rule as gristService.parseMultiLabel, fr preferred).
const multiLabelValue = (raw) => {
  const parts = String(raw || '').split('|').map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)\s*\[([a-zA-Z]{2})\]\s*$/);
    return m ? { value: m[1].trim(), lang: m[2].toLowerCase() } : { value: p, lang: '' };
  });
  return (parts.find((p) => p.lang === 'fr') || parts[0] || { value: '' }).value;
};
// Tables writable with a lab right: scope column + normalization to an
// anchor comparable to access.labAnchors (see canAccessSlug).
const GRIST_LAB_SCOPE = {
  Annuaire: { col: 'LABO', anchor: (v) => normalizeAcronym(String(v || '')) },
  Structures: { col: 'short_labels', anchor: (v) => normalizeAcronym(multiLabelValue(v)) },
  Newsletter: { col: 'slug', anchor: (v) => normalizeAcronym(String(v || '')) },
};
// Scope column value of the existing rows (in batches of 500: SQLite
// variable limit). Table/column names come from GRIST_LAB_SCOPE.
const gristScopeOfRows = async (doc, table, col, ids) => {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const r = await fetch(`${GRIST_API_BASE}/docs/${doc}/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GRIST_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `SELECT id, "${col}" AS v FROM "${table}" WHERE id IN (${chunk.map(() => '?').join(',')})`,
        args: chunk,
      }),
    });
    if (!r.ok) throw new Error(`Grist SQL HTTP ${r.status}`);
    for (const row of (await r.json()).records || []) out.set(row.fields.id, row.fields.v);
  }
  return out;
};
/**
 * Authorization decision of the Grist proxy — pure (no direct access to req/res/fetch: the
 * existing rows are read through the injected `fetchRowScopes`). Returns
 * `{ ok: true }` (relay) or `{ ok: false, status, error }`. Extracted from the old
 * Express middleware `gristProxyGuard` (lot 2 of the multi-instance architecture plan,
 * docs/plan-architecture-multi-instances.md) to take the same shape as `gristGuard`
 * in the Centrale repo (functions/api/grist/[[path]].js): raw data in, decision
 * out, testable without Express mocks. The policy itself (per-lab scoping, row by
 * row) remains specific to Nantes — Centrale has no lab scope to check, see
 * docs/archive/lot0-inventaire-derive-2026-09-18.md.
 */
const gristProxyDecision = async ({ method, path, access, body, fetchRowScopes }) => {
  const m = GRIST_PATH_RE.exec(String(path || '').split('?')[0]);
  if (!m || !GRIST_ALLOWED_DOCS.has(m[1])) {
    return { ok: false, status: 403, error: 'Grist path not allowed by the proxy' };
  }
  const [, doc, tablesSeg, table, sub] = m;
  if (method === 'GET') return { ok: true };
  if (!tablesSeg) return { ok: false, status: 403, error: 'Writing to the document root is refused' };
  if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
    return { ok: false, status: 405, error: `Method not relayed: ${method}` };
  }
  if (access?.allSlugs) return { ok: true };
  const anchors = access?.labAnchors || [];
  const mainDoc = doc === process.env.VITE_GRIST_DOC_ID;
  if (anchors.length > 0 && mainDoc && sub === 'records' && GRIST_LAB_TABLES_LOG.has(table) && method !== 'DELETE') {
    return { ok: true };
  }
  const extraSlug = GRIST_LAB_TABLES_EXTRA[`${doc}/${table}`];
  if (extraSlug && sub === 'records' && method !== 'DELETE') {
    if (anchors.includes(normalizeAcronym(extraSlug))) return { ok: true };
    return { ok: false, status: 403, error: `Write outside scope: ${extraSlug}` };
  }
  const scope = mainDoc && (sub === 'records' || sub === 'data/delete') ? GRIST_LAB_SCOPE[table] : null;
  if (!scope || anchors.length === 0) {
    return { ok: false, status: 403, error: 'Grist writes require the institution right' };
  }
  try {
    const ids = [];
    const sent = [];
    if (sub === 'data/delete') {
      if (!Array.isArray(body)) return { ok: false, status: 400, error: 'List of identifiers expected' };
      ids.push(...body);
    } else {
      const records = body?.records;
      if (!Array.isArray(records) || records.length === 0) {
        return { ok: false, status: 400, error: 'Body with a records array expected' };
      }
      for (const rec of records) {
        const fields = rec?.fields;
        if (method === 'POST' && (!fields || fields[scope.col] === undefined)) {
          return { ok: false, status: 403, error: `Creation outside scope: column ${scope.col} missing` };
        }
        if (method === 'PATCH') {
          if (rec?.id === undefined) return { ok: false, status: 400, error: 'Missing id for PATCH' };
          ids.push(rec.id);
        }
        if (fields && fields[scope.col] !== undefined) sent.push(fields[scope.col]);
      }
    }
    if (!ids.every((id) => Number.isInteger(id) && id > 0)) {
      return { ok: false, status: 400, error: 'Invalid Grist identifiers' };
    }
    if (sent.some((v) => !anchors.includes(scope.anchor(v)))) {
      return { ok: false, status: 403, error: `Write outside scope: ${scope.col}` };
    }
    if (ids.length) {
      const current = await fetchRowScopes(doc, table, scope.col, ids);
      if (ids.some((id) => !current.has(id) || !anchors.includes(scope.anchor(current.get(id))))) {
        return { ok: false, status: 403, error: `Rows outside scope or unknown: ${table}` };
      }
    }
    return { ok: true };
  } catch (err) {
    console.error('[Proxy Grist] scope check error:', err);
    return { ok: false, status: 502, error: `Scope check failed: ${err.message}` };
  }
};

// Thin Express middleware around the pure decision above: translates req/res, injects
// the real read of Grist rows (gristScopeOfRows, the guard's only I/O).
const gristProxyGuard = async (req, res, next) => {
  const decision = await gristProxyDecision({
    method: req.method,
    path: req.url.replace('/api/grist/', ''),
    access: req.session.user?.access,
    body: req.body,
    fetchRowScopes: gristScopeOfRows,
  });
  if (decision.ok) return next();
  res.status(decision.status).json({ error: decision.error });
};

// ── Grist proxy ────────────────────────────────────────────────────────────
app.all('/api/grist/*', gristProxyGuard, async (req, res) => {
  const gristPath = req.url.replace('/api/grist/', '');
  const targetUrl = `https://grist.numerique.gouv.fr/api/${gristPath}`;
  const apiKey = GRIST_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GRIST_API_KEY not configured' });

  console.log(`[Proxy] -> ${targetUrl}`);

  try {
    const options = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Druid-CRISalid/1.0',
      },
    };
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      options.body = JSON.stringify(req.body);
    }
    const response = await fetch(targetUrl, options);
    const responseText = await response.text();
    if (!response.ok) console.error(`[Proxy Grist Error Body]: ${responseText}`);
    res.status(response.status).set('Content-Type', 'application/json').send(responseText);
  } catch (err) {
    console.error('[Proxy Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── LDAP sync ──────────────────────────────────────────────────────────────
// Lot 2 (docs/plan-architecture-multi-instances.md): formerly execSync (blocking —
// the whole Druid stack, all institutions together, was frozen for the duration of the
// search over ~93,000 accounts). Aligned with the background-job pattern already in place
// for IdRef/ORCID/HAL/OpenAlex/LDAP candidates (startBackgroundRun + polled progress).
const LDAP_PROGRESS_PATH = 'ldap_status_progress.json';
const STRUCT_LDAP_PROGRESS_PATH = 'structures_ldap_progress.json';

app.get('/api/sync-ldap-trigger', requireEstablishmentScope, (req, res) => {
  const running = runningProgress(LDAP_PROGRESS_PATH);
  if (running) return res.status(409).json({ error: 'An LDAP synchronization is already running', progress: running });
  try {
    console.log('[Sync] Triggering LDAP sync...');
    startBackgroundRun('LDAP', LDAP_PROGRESS_PATH, {}, ['scripts/sync_ldap.cjs', `--progress=${LDAP_PROGRESS_PATH}`]);
    res.json({ started: true });
  } catch (err) {
    console.error('[Sync Error]', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sync-ldap-progress', requireEstablishmentScope, (req, res) => {
  try {
    if (!fs.existsSync(LDAP_PROGRESS_PATH)) return res.json({ running: false });
    const p = JSON.parse(fs.readFileSync(LDAP_PROGRESS_PATH, 'utf8'));
    // Cache copied into dist/ only once the run has finished without error (see the old
    // execSync behavior, kept for deployments that still serve dist/).
    if (!p.running && !p.error && fs.existsSync('ldap_status_cache.json')) {
      try { fs.copyFileSync('ldap_status_cache.json', 'dist/ldap_status_cache.json'); } catch (e) { /* noop */ }
    }
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Single-person LDAP lookup (researcher creation form) ─────────────────────
// « Fill from LDAP » button: live search by uid (scripts/lib/ldap_person.cjs). Open to every
// right that can create an Annuaire record (institution or lab), not only institution tools.
app.get('/api/ldap/person/:uid', async (req, res) => {
  const access = req.session.user?.access;
  if (!access?.allSlugs && !access?.labAnchors?.length && !access?.annuaireLabs?.length) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!process.env.LDAP_URL || !process.env.LDAP_BIND_DN || !process.env.LDAP_BIND_PASSWORD) {
    return res.status(404).json({ error: 'LDAP not configured on this instance' });
  }
  const { lookupLdapPerson, isValidUid } = require('./scripts/lib/ldap_person.cjs');
  const uid = String(req.params.uid || '').trim();
  if (!isValidUid(uid)) return res.status(400).json({ error: 'Invalid uid' });
  try {
    const person = await lookupLdapPerson(uid);
    if (!person) return res.status(404).json({ error: 'No LDAP entry for this uid' });
    res.json(person);
  } catch (err) {
    console.error('[LDAP lookup]', err.message);
    res.status(502).json({ error: 'LDAP directory unreachable' });
  }
});

// ── Career path of a researcher (docs/plan-parcours-affiliations.md, lot 2) ──────
// Output of scripts/sync_affiliation_history.cjs (weekly ofelia job): one file per person in
// AFFILIATION_HISTORY_DIR (bind-mounted cache-data/affiliation_history). Reading follows the record's
// scope (every authenticated right reads the Annuaire); a live refresh calls the external APIs
// (quotas), so it needs the institution scope or a lab right on the record's lab.
const AH_STORE = require('./scripts/lib/affiliation_history_store.cjs');
const AFFILIATION_HISTORY_DIR = process.env.AFFILIATION_HISTORY_DIR || path.join(__dirname, 'affiliation_history');
const AH_REFRESH_TIMEOUT_MS = 120000;
const AH_MAX_PARALLEL_REFRESH = 2;
const ahRefreshing = new Map();   // key → Promise of the running one-person job
const hasAnyRight = (access) => !!(access?.allSlugs || access?.labAnchors?.length || access?.annuaireLabs?.length);
const ahRunInfo = () => {
  const p = AH_STORE.readProgress(AFFILIATION_HISTORY_DIR);
  return p ? { running: !!p.running, done: p.done || 0, total: p.total || 0, startedAt: p.startedAt || null } : null;
};
/** LABO values of the Annuaire rows of a person key (uid_dyna, or g<rowId> for records without uid). */
const annuaireLabosOf = async (key) => {
  const byRow = /^g(\d+)$/.exec(key);
  const r = await fetch(`${GRIST_API_BASE}/docs/${process.env.VITE_GRIST_DOC_ID}/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GRIST_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(byRow
      ? { sql: 'SELECT "LABO" AS v FROM "Annuaire" WHERE id = ?', args: [Number(byRow[1])] }
      : { sql: 'SELECT "LABO" AS v FROM "Annuaire" WHERE "uid_dyna" = ?', args: [key] }),
  });
  if (!r.ok) throw new Error(`Grist SQL HTTP ${r.status}`);
  return ((await r.json()).records || []).map((row) => row.fields.v || '');
};
/** Runs the job for ONE person (index merged on write, full-run progress untouched). */
const refreshAffiliationHistory = (key) => new Promise((resolve, reject) => {
  const child = spawn('node', [path.join(__dirname, 'scripts/sync_affiliation_history.cjs'), `--uid=${key}`, '--force', `--dir=${AFFILIATION_HISTORY_DIR}`],
    { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const keep = (b) => { tail = (tail + b.toString()).slice(-2000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const timer = setTimeout(() => child.kill('SIGTERM'), AH_REFRESH_TIMEOUT_MS);
  child.on('error', (err) => { clearTimeout(timer); reject(err); });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`job ended with ${code ?? signal}: ${tail.split('\n').filter(Boolean).slice(-2).join(' | ')}`));
  });
});

app.get('/api/researchers/:key/affiliation-history', (req, res) => {
  if (!hasAnyRight(req.session.user?.access)) return res.status(403).json({ error: 'Forbidden' });
  const key = String(req.params.key || '');
  if (!AH_STORE.isValidKey(key)) return res.status(400).json({ error: 'Invalid record key' });
  const entry = AH_STORE.readEntry(AFFILIATION_HISTORY_DIR, key);
  if (!entry) return res.status(404).json({ error: 'Career path not computed yet for this record', run: ahRunInfo() });
  res.json({ entry, run: ahRunInfo() });
});

// Signals of every record for the researcher list (filter « Parcours », lot 4): the index written by the
// job, reduced to the signal types; re-read only when the file changes (≈ 1 MB, 7 000 records).
const AH_LIST_SIGNALS = new Set(['depart_confirme', 'depart_declare', 'nouveau_poste_declare', 'depart_observe', 'scopus_courante_non_locale', 'statut_incoherent', 'identifiant_suspect']);
let ahSignalsCache = { mtimeMs: 0, body: null };
app.get('/api/affiliation-history/signals', (req, res) => {
  if (!hasAnyRight(req.session.user?.access)) return res.status(403).json({ error: 'Forbidden' });
  const file = AH_STORE.indexFile(AFFILIATION_HISTORY_DIR);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return res.json({ byKey: {}, run: ahRunInfo() }); }
  if (ahSignalsCache.mtimeMs !== mtimeMs) {
    const index = AH_STORE.readJson(file, {});
    const byKey = {};
    for (const [key, line] of Object.entries(index)) {
      const types = [...new Set((line.signals || []).map((s) => s.type).filter((t) => AH_LIST_SIGNALS.has(t)))];
      if (types.length) byKey[key] = types;
    }
    ahSignalsCache = { mtimeMs, body: { byKey } };
  }
  res.json({ ...ahSignalsCache.body, run: ahRunInfo() });
});

app.post('/api/researchers/:key/affiliation-history/refresh', async (req, res) => {
  const access = req.session.user?.access;
  if (!hasAnyRight(access)) return res.status(403).json({ error: 'Forbidden' });
  const key = String(req.params.key || '');
  if (!AH_STORE.isValidKey(key)) return res.status(400).json({ error: 'Invalid record key' });
  let labos;
  try { labos = await annuaireLabosOf(key); }
  catch (err) { console.error('[affiliation-history] Grist', err.message); return res.status(502).json({ error: 'Grist unreachable' }); }
  if (!labos.length) return res.status(404).json({ error: 'No Annuaire record for this key' });
  if (!AH_STORE.canRefresh(access, labos, normalizeAcronym)) return res.status(403).json({ error: 'Refresh outside your scope' });
  let job = ahRefreshing.get(key);
  if (!job) {
    if (ahRefreshing.size >= AH_MAX_PARALLEL_REFRESH) return res.status(429).json({ error: 'Too many refreshes in progress, retry in a minute' });
    job = refreshAffiliationHistory(key).finally(() => ahRefreshing.delete(key));
    ahRefreshing.set(key, job);
  }
  try { await job; }
  catch (err) { console.error('[affiliation-history] refresh', key, err.message); return res.status(502).json({ error: 'Career-path computation failed' }); }
  const entry = AH_STORE.readEntry(AFFILIATION_HISTORY_DIR, key);
  if (!entry) return res.status(404).json({ error: 'No usable identifier for this record' });
  res.json({ entry, run: ahRunInfo() });
});

// ── LDAP Structures sync ────────────────────────────────────────────────────
app.get('/api/sync-structures-ldap-trigger', requireEstablishmentScope, (req, res) => {
  const running = runningProgress(STRUCT_LDAP_PROGRESS_PATH);
  if (running) return res.status(409).json({ error: 'An LDAP structures synchronization is already running', progress: running });
  try {
    console.log('[Sync] Triggering LDAP structures sync...');
    startBackgroundRun('LDAP structures', STRUCT_LDAP_PROGRESS_PATH, {}, ['scripts/sync_structures_ldap.cjs', `--progress=${STRUCT_LDAP_PROGRESS_PATH}`]);
    res.json({ started: true });
  } catch (err) {
    console.error('[Sync Error]', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sync-structures-ldap-progress', requireEstablishmentScope, (req, res) => {
  try {
    if (!fs.existsSync(STRUCT_LDAP_PROGRESS_PATH)) return res.json({ running: false });
    const p = JSON.parse(fs.readFileSync(STRUCT_LDAP_PROGRESS_PATH, 'utf8'));
    if (!p.running && !p.error && fs.existsSync('structures_ldap_cache.json')) {
      try { fs.copyFileSync('structures_ldap_cache.json', 'dist/structures_ldap_cache.json'); } catch (e) { /* noop */ }
    }
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── IdRef alignment ──────────────────────────────────────────────────────────
// Searches/verifies IdRef identifiers on ABES. Long (thousands of HTTP calls) →
// run in the background; the UI tracks progress via /api/sync-idref-progress and then reads
// the static cache /idref_align_cache.json (copied into dist/ by the script).
const IDREF_PROGRESS_PATH = 'idref_align_progress.json';

// Background runs (IdRef, ORCID/HAL/OpenAlex, LDAP candidates) and their progress
// file. The server writes running:true before the spawn; if the child dies
// without ever rewriting the file (missing LDAP password, crash at startup)
// or if the container restarts mid-run, it stayed at running:true ⇒ permanent
// 409 (review of 2026-09-16, point 7). A file still « running » is therefore
// closed when the child exits (below) and at server startup (at the bottom).
const readProgress = (progressPath) => {
  try { return JSON.parse(fs.readFileSync(progressPath, 'utf8')) || null; } catch { return null; }
};
const runningProgress = (progressPath) => {
  const p = readProgress(progressPath);
  return p && p.running ? p : null;
};
const settleProgress = (progressPath, error) => {
  const p = readProgress(progressPath);
  if (!p || !p.running) return false;
  fs.writeFileSync(progressPath, JSON.stringify({ ...p, running: false, error, finishedAt: new Date().toISOString() }));
  return true;
};
const startBackgroundRun = (label, progressPath, initial, args) => {
  fs.writeFileSync(progressPath, JSON.stringify({ running: true, total: 0, done: 0, ...initial, startedAt: new Date().toISOString() }));
  const child = spawn('node', args, { stdio: 'inherit' });
  child.on('error', (err) => {
    console.error(`[Sync ${label}] spawn error`, err);
    settleProgress(progressPath, `Lancement impossible : ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    const why = code === 0 ? 'Script terminé sans clore sa progression' : `Script interrompu (code ${code ?? signal})`;
    if (settleProgress(progressPath, why)) console.error(`[Sync ${label}] ${why}`);
  });
  child.unref();
  return child;
};

// Groups of the alignment pages (« Personnel » / « Doctorants » / « Sans obligation de recherche » tabs) —
// same list as scripts/lib/align_common.cjs::ALIGN_GROUPS and lib/gristService.ts::AlignGroup.
const ALIGN_GROUPS = ['personnel', 'doctorants', 'hors_recherche'];

app.get('/api/sync-idref-trigger', requireEstablishmentScope, (req, res) => {
  // 'align' = Qualinka prototype (disambiguation scoring); otherwise search/verify (sync_idref.cjs).
  const mode = ['verify', 'align'].includes(req.query.mode) ? req.query.mode : 'search';
  // `?labo=ACRONYM`: run restricted to one structure (`LABO` column) — lab by lab, much shorter
  // than a global run. Implies --force: the lab's records already in cache are reprocessed too
  // (otherwise a lab covered by a previous global run would yield a run with 0 records).
  const labo = String(req.query.labo || '').trim().slice(0, 120);
  // ?group=personnel|doctorants|hors_recherche: scopes the active tab of the IdRef alignment page —
  // « Doctorants » (TYPE_EMPLOI=DOCTORANT) and « Sans obligation de recherche » (LIB_TYPE_EMPLOI
  // « …n'ayant pas d'obligation statutaire de recherche ») are isolated low priorities;
  // « Personnel » = the rest. These two secondary groups also force reprocessing (deliberately
  // targeted queue, like labo).
  const group = ALIGN_GROUPS.includes(req.query.group) ? req.query.group : '';
  const forceRun = labo || (group && group !== 'personnel');
  // Refuse if a run is already in progress (unreadable progress: start anyway)
  const running = runningProgress(IDREF_PROGRESS_PATH);
  if (running) return res.status(409).json({ error: 'An IdRef alignment is already running', progress: running });

  try {
    console.log(`[Sync] Triggering IdRef alignment (mode=${mode}${labo ? `, labo=${labo}` : ''}${group ? `, group=${group}` : ''})...`);
    // align prototype: processes ALL records without IdRef, but INCREMENTALLY (the script resumes
    // from its cache → only new/unprocessed records are queried on subsequent runs).
    // ?limit=N caps the number of NEW records in a run (tests); ?force=1 reprocesses everything.
    const alignArgs = ['scripts/sync_idref_qualinka.cjs', '--mode=search', '--neo4j', '--labos', `--progress=${IDREF_PROGRESS_PATH}`];
    const alignLimit = Math.max(0, parseInt(req.query.limit, 10) || 0);
    if (alignLimit > 0) alignArgs.push(`--limit=${alignLimit}`);
    if (req.query.force === '1' || req.query.force === 'true' || forceRun) alignArgs.push('--force');
    if (labo) alignArgs.push(`--labo=${labo}`);
    if (group) alignArgs.push(`--group=${group}`);
    const searchArgs = ['scripts/sync_idref.cjs', `--mode=${mode}`];
    if (labo) searchArgs.push(`--labo=${labo}`);
    if (group) searchArgs.push(`--group=${group}`);
    startBackgroundRun('IdRef', IDREF_PROGRESS_PATH, { mode, labo: labo || undefined, group: group || undefined },
      mode === 'align' ? alignArgs : searchArgs);
    res.json({ started: true, mode, labo: labo || undefined, group: group || undefined });
  } catch (err) {
    console.error('[Sync IdRef Error]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync-idref-progress', requireEstablishmentScope, (req, res) => {
  try {
    if (!fs.existsSync(IDREF_PROGRESS_PATH)) return res.json({ running: false, total: 0, done: 0 });
    res.json(JSON.parse(fs.readFileSync(IDREF_PROGRESS_PATH, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ORCID / HAL / OpenAlex / Scopus alignments (scripts/sync_orcid.cjs, sync_hal.cjs, sync_openalex.cjs, sync_scopus.cjs — base scripts/lib/align_common.cjs) ──
// Same contract as IdRef: background run, progress in <source>_align_progress.json,
// cache <source>_align_cache.json served from the app root (see static routes below), suggestions
// pushed to the Grist tables Alignement_ORCID / Alignement_HAL / Alignement_OpenAlex / Alignement_Scopus.
// mode=push = re-pushes the cache without API calls (« Envoyer en revue Grist » button). See
// docs/archive/plan-alignement-orcid-hal.md, docs/archive/plan-alignement-openalex.md and docs/plan-alignement-scopus.md.
const ALIGN_SOURCES = {
  orcid: { script: 'scripts/sync_orcid.cjs', progress: 'orcid_align_progress.json', label: 'ORCID' },
  hal: { script: 'scripts/sync_hal.cjs', progress: 'hal_align_progress.json', label: 'HAL' },
  openalex: { script: 'scripts/sync_openalex.cjs', progress: 'openalex_align_progress.json', label: 'OpenAlex' },
  scopus: { script: 'scripts/sync_scopus.cjs', progress: 'scopus_align_progress.json', label: 'Scopus' },
};
app.get('/api/align/:source/trigger', requireEstablishmentScope, (req, res) => {
  const src = ALIGN_SOURCES[req.params.source];
  if (!src) return res.status(404).json({ error: `Unknown alignment source: ${req.params.source}` });
  const mode = ['search', 'verify', 'push'].includes(req.query.mode) ? req.query.mode : 'search';
  const labo = String(req.query.labo || '').trim().slice(0, 120);
  const group = ALIGN_GROUPS.includes(req.query.group) ? req.query.group : '';
  const limit = Math.max(0, parseInt(req.query.limit, 10) || 0);
  const force = req.query.force === '1' || req.query.force === 'true' || (group && group !== 'personnel');
  const running = runningProgress(src.progress);
  if (running) return res.status(409).json({ error: `Alignment already running: ${src.label}`, progress: running });
  try {
    console.log(`[Sync] Triggering ${src.label} alignment (mode=${mode}${labo ? `, labo=${labo}` : ''}${group ? `, group=${group}` : ''})...`);
    const args = [src.script, `--mode=${mode}`];
    if (labo) args.push(`--labo=${labo}`);
    if (group) args.push(`--group=${group}`);
    if (limit > 0) args.push(`--limit=${limit}`);
    if (force) args.push('--force');
    startBackgroundRun(src.label, src.progress, { mode, labo: labo || undefined, group: group || undefined }, args);
    res.json({ started: true, source: req.params.source, mode, labo: labo || undefined, group: group || undefined });
  } catch (err) {
    console.error(`[Sync ${src.label} Error]`, err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/align/:source/progress', requireEstablishmentScope, (req, res) => {
  const src = ALIGN_SOURCES[req.params.source];
  if (!src) return res.status(404).json({ error: `Unknown alignment source: ${req.params.source}` });
  try {
    if (!fs.existsSync(src.progress)) return res.json({ running: false, total: 0, done: 0 });
    res.json(JSON.parse(fs.readFileSync(src.progress, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LDAP candidate search (affiliation of records without uid) ──────────────
// Matches Annuaire records without uid_dyna to LDAP staff by email, and
// writes a cache of proposals (Grist read-only). Tracked via
// /api/sync-ldap-candidates-progress, cache served statically.
const LDAP_CAND_PROGRESS_PATH = 'ldap_candidates_progress.json';

app.get('/api/sync-ldap-candidates-trigger', requireEstablishmentScope, (req, res) => {
  const running = runningProgress(LDAP_CAND_PROGRESS_PATH);
  if (running) return res.status(409).json({ error: 'An LDAP search is already running', progress: running });

  try {
    console.log('[Sync] Triggering LDAP candidate search...');
    startBackgroundRun('LDAP cand', LDAP_CAND_PROGRESS_PATH, { matched: 0 }, ['scripts/sync_ldap_candidates.cjs']);
    res.json({ started: true });
  } catch (err) {
    console.error('[Sync LDAP cand Error]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync-ldap-candidates-progress', requireEstablishmentScope, (req, res) => {
  try {
    if (!fs.existsSync(LDAP_CAND_PROGRESS_PATH)) return res.json({ running: false, total: 0, done: 0, matched: 0 });
    res.json(JSON.parse(fs.readFileSync(LDAP_CAND_PROGRESS_PATH, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Static + SPA fallback ──────────────────────────────────────────────────
// Caches produced by the scripts (LDAP, IdRef, Qualinka, structures): served from the app
// root (bind-mounted files, see druid.yaml) and not from dist/ — after an image rebuild,
// dist/ starts empty again and the UI showed « 0 à renseigner » until the next run
// (see the 2026-09-09 incident). Fallback on dist/ if the root file does not exist.
for (const cacheFile of ['ldap_status_cache.json', 'ldap_candidates_cache.json', 'structures_ldap_cache.json', 'idref_align_cache.json', 'idref_align_qualinka_cache.json', 'orcid_align_cache.json', 'hal_align_cache.json', 'openalex_align_cache.json', 'scopus_align_cache.json']) {
  app.get(`/${cacheFile}`, (req, res) => {
    const root = path.join(__dirname, cacheFile);
    const dist = path.join(__dirname, 'dist', cacheFile);
    const file = (fs.existsSync(root) && fs.statSync(root).size > 0) ? root : (fs.existsSync(dist) ? dist : null);
    if (!file) return res.status(404).json({ error: `No run yet: ${cacheFile} missing` });
    res.set('Cache-Control', 'no-store');
    res.sendFile(file);
  });
}
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Error handler — always return JSON (catches 413 PayloadTooLarge, etc.)
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[Error] ${status} ${err.message}`);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// Loaded by `node server.cjs`: listens. Loaded by require() (tests): exposes
// the app and the guards/helpers tested by scripts/tests/*.cjs without opening a port.
if (require.main === module) {
  // Runs interrupted by a restart (the child dies with the container): their
  // progress file, left at running:true, would block any new run (409).
  for (const f of [IDREF_PROGRESS_PATH, LDAP_CAND_PROGRESS_PATH, LDAP_PROGRESS_PATH, STRUCT_LDAP_PROGRESS_PATH, ...Object.values(ALIGN_SOURCES).map((s) => s.progress)]) {
    if (settleProgress(f, 'Interrompu par un redémarrage du serveur')) console.warn(`[Sync] ${f}: run interrupted, file closed`);
  }
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Druid Server running on http://0.0.0.0:${PORT}`);
  });

  // No WebSocket is served (the Streamlit /dashboard upgrade went away
  // with the native ETL console): every upgrade is refused.
  server.on('upgrade', (req, socket) => socket.destroy());
}

module.exports = {
  app, gristProxyGuard, gristProxyDecision, rejectCrossSite, csvEscape, runningProgress, settleProgress, startBackgroundRun,
  buildPeopleCsv, buildStructuresCsv, gristCell, countCsvRecords, normalizeFuzzyDate, fuzzyDateBound, isFuzzyDatePast,
};
