import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { extname, join, resolve } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const dataDir = resolve(process.env.DATA_DIR || join(root, "data"));
const dataFile = join(dataDir, "team-game.json");
const themeFile = join(dataDir, "themes.json");
const scrypt = promisify(scryptCallback);
const sessions = new Map();
let store = { users: [], history: [] };
let storeWrite = Promise.resolve();
const playerIndexFile = join(root, "server/player-index.json");
const cricinfoBaseUrl = "https://www.cricinfo.com";
const requestHeaders = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

async function loadStore() {
  try {
    const data = JSON.parse(await readFile(dataFile, "utf8"));
    store = { users: data.users || [], history: data.history || [] };
    let assignedIds = false;
    for (const user of store.users) {
      if (!user.id) { user.id = randomUUID(); assignedIds = true; }
    }
    if (assignedIds) await saveStore();
  } catch {
    await mkdir(dataDir, { recursive: true });
    await saveStore();
  }
}
function saveStore() {
  storeWrite = storeWrite.then(async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(dataFile, JSON.stringify(store, null, 2));
  });
  return storeWrite;
}
async function requestBody(req) {
  let body = "";
  for await (const part of req) body += part;
  return body ? JSON.parse(body) : {};
}
function currentUser(req) {
  const token = (req.headers.cookie || "").match(/team_game_session=([^;]+)/)?.[1];
  const username = token && sessions.get(decodeURIComponent(token));
  return store.users.find((user) => user.username === username && !user.blocked) || null;
}
function publicUser(user, includeAvatar = false) {
  const profile = { username: user.username, role: user.role, blocked: !!user.blocked, displayName: user.displayName || user.username };
  if (includeAvatar) profile.avatar = user.avatar || "";
  return profile;
}
async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: (await scrypt(password, salt, 64)).toString("hex") };
}
function canSeeGame(user, game) {
  return game.owner === user.username;
}

async function themeData(accountId, legacyOwner) {
  let source;
  try {
    source = JSON.parse(await readFile(themeFile, "utf8"));
  } catch {
    try {
      source = JSON.parse(await readFile(join(root, "themes.json"), "utf8"));
    } catch {
      source = { themes: [], active: null };
    }
  }

  let changed = false;
  const data = source.activeByUser && typeof source.activeByUser === "object"
    ? {
        themes: Array.isArray(source.themes) ? source.themes : [],
        activeByUser: Object.assign(Object.create(null), source.activeByUser),
        legacyThemes: Array.isArray(source.legacyThemes) ? source.legacyThemes : [],
        legacyActiveByOwner: Object.assign(Object.create(null), source.legacyActiveByOwner || {}),
      }
    : {
        themes: [],
        activeByUser: Object.create(null),
        legacyThemes: Array.isArray(source.themes) ? source.themes : [],
        legacyActiveByOwner: Object.create(null),
      };

  if (!source.activeByUser) {
    if (source.active?.owner && source.active.colors) {
      data.legacyActiveByOwner[source.active.owner] = source.active.colors;
    }
    changed = true;
  }

  // Upgrade themes saved by the short-lived username-keyed account schema.
  for (const account of store.users) {
    if (account.username !== accountId && Object.hasOwn(data.activeByUser, account.username)) {
      data.activeByUser[account.id] = data.activeByUser[account.username];
      delete data.activeByUser[account.username];
      data.themes = data.themes.map((theme) => theme.owner === account.username ? { ...theme, owner: account.id } : theme);
      changed = true;
    }
  }

  // Attach this browser's old cookie-owned themes to the signed-in account once.
  const oldThemes = data.legacyThemes.filter((theme) => theme.owner === legacyOwner);
  if (oldThemes.length) {
    data.themes.push(...oldThemes.map((theme) => ({ ...theme, owner: accountId })));
    data.legacyThemes = data.legacyThemes.filter((theme) => theme.owner !== legacyOwner);
    changed = true;
  }
  if (Object.hasOwn(data.legacyActiveByOwner, legacyOwner)) {
    if (!Object.hasOwn(data.activeByUser, accountId)) data.activeByUser[accountId] = data.legacyActiveByOwner[legacyOwner];
    delete data.legacyActiveByOwner[legacyOwner];
    changed = true;
  }

  if (changed) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(themeFile, JSON.stringify(data, null, 2));
  }
  return data;
}

async function playerIndex() {
  try {
    return JSON.parse(await readFile(playerIndexFile, "utf8"));
  } catch {
    return {};
  }
}

function owner(req) {
  const id = (req.headers.cookie || "").match(/team_game_js_user=([^;]+)/)?.[1];
  return id || randomUUID();
}

function clean(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Cricinfo returned HTTP ${response.status}`);
  }
  return response.text();
}

function normalizePlayerName(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerCandidatesFromSearch(html) {
  const links = [
    ...html.matchAll(
      /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
    ),
  ];
  const candidates = links
    .map(([, before, href, after, content]) => {
      const url = href.replace(/&amp;/g, "&");
      const pathMatch =
        url.match(
          /\/(?:player|cricketers?)\/[^/?#]*?-(\d+)(?:\.html)?(?:[/?#]|$)/i,
        ) ||
        url.match(/\/(?:[a-z-]+\/)?content\/player\/(\d+)\.html(?:[?#]|$)/i);
      const attrText = `${before} ${after}`;
      const dataMatch = attrText.match(/data-(?:player-)?id=["']?(\d+)/i);
      const id = pathMatch?.[1] || dataMatch?.[1];
      if (!id) return null;

      const label = clean(content);
      const parentheticalName = label.match(/\(([^()]+)\)/)?.[1];
      const canonicalName = parentheticalName
        ? parentheticalName.replace(/,?\s*\d{4}.*$/, "").trim()
        : label.split("(")[0].trim();
      return { id, name: normalizePlayerName(canonicalName) };
    })
    .filter(Boolean);

  return [
    ...new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    ).values(),
  ];
}

function editDistance(left, right) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function playerNameSimilarity(query, candidateName) {
  const queryName = normalizePlayerName(query);
  const candidate = normalizePlayerName(candidateName);
  if (!queryName || !candidate) return 0;
  if (queryName === candidate) return 1;
  const distance = editDistance(queryName, candidate);
  return 1 - distance / Math.max(queryName.length, candidate.length);
}

async function playerCareerMatches(playerId, criteria) {
  const playerClass = criteria.startsWith("IPL") ? 6 : 11;
  const url = new URL(
    `/ci/engine/player/${playerId}.html`,
    "https://stats.espncricinfo.com",
  );
  url.search = new URLSearchParams({
    class: String(playerClass),
    template: "results",
    type: "batting",
  }).toString();
  const html = await fetchText(url);
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    ([, row]) =>
      [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) =>
        clean(cell).replace(/,/g, "").trim(),
      ),
  );

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const header = rows[rowIndex].map((cell) => cell.toLowerCase());
    const matchesIndex = header.indexOf("mat");
    if (matchesIndex < 0 || !header.includes("inns")) continue;

    for (const row of rows.slice(rowIndex + 1)) {
      if (row.some((cell) => /^(mat|inns)$/i.test(cell))) break;
      if (row[0]?.toLowerCase() !== "overall") continue;
      const matches = Number(row[matchesIndex]);
      if (Number.isFinite(matches)) return matches;
    }
  }
  return -1;
}

async function resolvePlayerId(html, name, criteria) {
  const query = normalizePlayerName(name);
  const candidates = playerCandidatesFromSearch(html)
    .map((candidate) => ({
      ...candidate,
      similarity: playerNameSimilarity(query, candidate.name),
    }))
    .filter((candidate) => candidate.similarity >= 0.72)
    .sort((a, b) => b.similarity - a.similarity);
  if (candidates.length === 0) return null;

  const bestSimilarity = candidates[0].similarity;
  const plausible = candidates.filter(
    (candidate) => candidate.similarity >= bestSimilarity - 0.025,
  );
  if (plausible.length === 1) return plausible[0].id;

  const scored = await Promise.all(
    plausible.slice(0, 10).map(async (candidate) => ({
      id: candidate.id,
      similarity: candidate.similarity,
      matches: await playerCareerMatches(candidate.id, criteria).catch(
        () => -1,
      ),
    })),
  );
  scored.sort((a, b) => {
    if (Math.abs(a.similarity - b.similarity) > 0.025) {
      return b.similarity - a.similarity;
    }
    return b.matches - a.matches;
  });
  return scored[0].id;
}

async function cricinfoPlayerId(name, criteria) {
  const index = await playerIndex();
  const indexedId = index[name.toLowerCase().trim()];
  if (indexedId) return String(indexedId);

  const searchUrl = new URL(
    "/ci/content/player/search.html",
    "https://search.espncricinfo.com",
  );
  searchUrl.searchParams.set("search", name);

  try {
    const html = await fetchText(searchUrl);
    const id = await resolvePlayerId(html, name, criteria);
    if (id) return id;
  } catch {
    // Fall through to Statsguru search if the legacy player search is unavailable.
  }

  const statsSearchUrl = new URL(
    "/ci/engine/stats/index.html",
    "https://stats.espncricinfo.com",
  );
  statsSearchUrl.searchParams.set(
    "class",
    criteria.startsWith("IPL") ? "6" : "11",
  );
  statsSearchUrl.searchParams.set("type", "batting");
  statsSearchUrl.searchParams.set("search", name);
  try {
    const statsHtml = await fetchText(statsSearchUrl);
    const id = await resolvePlayerId(statsHtml, name, criteria);
    if (id) return id;
  } catch {
    // Try individual name parts below; they can still identify a near-spelling.
  }

  const nameParts = [
    ...new Set(
      name
        .trim()
        .split(/\s+/)
        .filter((part) => part.length >= 3),
    ),
  ];
  for (const part of nameParts) {
    const partialSearchUrl = new URL(
      "/ci/content/player/search.html",
      "https://search.espncricinfo.com",
    );
    partialSearchUrl.searchParams.set("search", part);
    try {
      const partialHtml = await fetchText(partialSearchUrl);
      const id = await resolvePlayerId(partialHtml, name, criteria);
      if (id) return id;
    } catch {
      // Continue through the remaining name parts.
    }
  }

  throw new Error(`No player profile found for “${name}” on Cricinfo`);
}

function statFromStatsguru(html, criteria) {
  const isBatting = criteria.includes("Runs");
  const metric = isBatting ? "Runs" : "Wkts";
  const isIpl = criteria.startsWith("IPL");
  let foundNumericStat = false;
  let foundIplStat = false;
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    ([, row]) =>
      [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) =>
        clean(cell).replace(/,/g, "").trim(),
      ),
  );

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const headers = rows[rowIndex].map((cell) => cell.toLowerCase());
    const metricIndex = headers.findIndex(
      (cell) => cell === metric.toLowerCase(),
    );
    if (
      metricIndex < 0 ||
      !headers.includes("mat") ||
      !headers.includes("inns")
    ) {
      continue;
    }

    const dataRows = [];
    for (
      let nextIndex = rowIndex + 1;
      nextIndex < rows.length;
      nextIndex += 1
    ) {
      const cells = rows[nextIndex];
      if (!cells.length) continue;
      if (cells.some((cell) => /^(mat|inns)$/i.test(cell))) break;
      if (cells.length <= metricIndex) continue;

      const valueText = cells[metricIndex].replace(/,/g, "").trim();
      const label = cells.slice(0, metricIndex).join(" ").trim().toLowerCase();
      const isIplRow = /^ipl(?:\s|$)/.test(label);
      const isAggregateRow =
        isIplRow ||
        /\b(total|career|overall|all formats|all internationals)\b/.test(label);
      const isNumber = /^\d+(?:\.\d+)?$/.test(valueText);
      const isEmptyAggregate = isAggregateRow && /^[-–—]$/.test(valueText);
      if (!isNumber && !isEmptyAggregate) continue;
      foundNumericStat = true;
      if (isIplRow) foundIplStat = true;
      dataRows.push({
        label,
        value: isEmptyAggregate ? 0 : Number(valueText),
      });
    }

    const totalRow = dataRows.find(({ label }) =>
      isIpl
        ? /^ipl(?:\s|$)/.test(label)
        : /\b(total|career|overall|all formats|all internationals)\b/.test(
            label,
          ),
    );
    if (totalRow) {
      return {
        value: totalRow.value,
        source: `ESPNcricinfo Statsguru (${criteria})`,
      };
    }
    if (!isIpl && dataRows.length === 1) {
      return {
        value: dataRows[0].value,
        source: `ESPNcricinfo Statsguru (${criteria})`,
      };
    }
  }

  const expectedTable = isBatting ? "Batting" : "Bowling";
  const isValidStatsguruPage = new RegExp(
    `<title>[^<]*\\b${expectedTable} records\\b[^<]*\\bStatsguru\\b`,
    "i",
  ).test(html);
  if (isValidStatsguruPage && isIpl && !foundIplStat) {
    return {
      value: 0,
      source: `ESPNcricinfo Statsguru (${criteria}; no IPL ${metric.toLowerCase()} recorded)`,
    };
  }
  if (isValidStatsguruPage && !foundNumericStat) {
    return {
      value: 0,
      source: `ESPNcricinfo Statsguru (${criteria}; no ${metric.toLowerCase()} recorded)`,
    };
  }

  throw new Error(`Cricinfo did not expose an unambiguous ${metric} total`);
}

function cricbuzzPlayerCandidates(html) {
  const anchors = [...html.matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)];
  const candidates = anchors.map(([, before, href, after, content]) => {
    const url = href.replace(/&amp;/g, "&");
    const match = url.match(/\/profiles\/(\d+)\/([^/?#"']*)/i);
    if (!match) return null;
    const text = clean(content).replace(/\s+/g, " ");
    const name = text || decodeURIComponent(match[2].replace(/-/g, " "));
    return { id: match[1], name: normalizePlayerName(name), href: `https://www.cricbuzz.com/profiles/${match[1]}/${match[2]}` };
  }).filter(Boolean);
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

async function cricbuzzProfileUrl(name) {
  const query = encodeURIComponent(name.trim());
  const urls = [
    `https://www.cricbuzz.com/api/html/cricket-match/search?query=${query}`,
    `https://www.cricbuzz.com/api/html/search?query=${query}`,
    `https://www.cricbuzz.com/api/html/search?q=${query}`,
    `https://www.cricbuzz.com/search?q=${query}`,
  ];
  const responses = await Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(url, {
      headers: { ...requestHeaders, referer: "https://www.cricbuzz.com/profiles" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }));
  const candidates = responses.flatMap((response) => response.status === "fulfilled" ? cricbuzzPlayerCandidates(response.value) : []);
  const queryName = normalizePlayerName(name);
  const scored = [...new Map(candidates.map((candidate) => [candidate.id, {
    ...candidate,
    similarity: playerNameSimilarity(queryName, candidate.name),
  }])).values()].filter((candidate) => candidate.similarity >= 0.72).sort((a, b) => b.similarity - a.similarity);
  if (!scored.length) throw new Error(`No matching player profile found for “${name}” on Cricbuzz`);
  if (scored.length > 1 && scored[1].similarity >= scored[0].similarity - 0.025)
    throw new Error(`Cricbuzz returned multiple similar player profiles for “${name}”`);
  return scored[0].href;
}

function statFromCricbuzzProfile(html, criteria) {
  const metric = criteria.includes("Runs") ? "runs" : "wickets";
  const isIpl = criteria.startsWith("IPL");
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => clean(cell).replace(/,/g, "").trim()),
  );
  for (let index = 0; index < rows.length; index += 1) {
    const header = rows[index].map((cell) => cell.toLowerCase());
    const formatIndices = ["test", "odi", "t20", "ipl"].map((format) => header.indexOf(format));
    if (formatIndices.some((formatIndex) => formatIndex < 0)) continue;
    for (const row of rows.slice(index + 1)) {
      const label = row[0]?.toLowerCase().replace(/[^a-z]/g, "");
      if (label !== metric) continue;
      const values = formatIndices.map((formatIndex) => {
        const value = row[formatIndex];
        if (value === undefined || /^(?:--|[-–—])$/.test(value)) return 0;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      });
      if (values.some((value) => value === null)) continue;
      const value = isIpl ? values[3] : values[0] + values[1] + values[2];
      return { value, source: `Cricbuzz career stats (${criteria})` };
    }
  }
  throw new Error(`Cricbuzz profile did not expose a ${metric} career row by format`);
}

async function statFromCricbuzz(player, criteria) {
  const profileUrl = await cricbuzzProfileUrl(player);
  const response = await fetch(profileUrl, {
    headers: { ...requestHeaders, referer: "https://www.cricbuzz.com/profiles" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Cricbuzz returned HTTP ${response.status}`);
  const html = await response.text();
  return statFromCricbuzzProfile(html, criteria);
}

async function statFromCricinfo(player, criteria) {
  const id = await cricinfoPlayerId(player, criteria);
  const playerClass = criteria.startsWith("IPL") ? 6 : 11;
  const dataType = criteria.includes("Runs") ? "batting" : "bowling";
  const url = new URL(
    `/ci/engine/player/${id}.html`,
    "https://stats.espncricinfo.com",
  );
  url.search = new URLSearchParams({
    class: String(playerClass),
    template: "results",
    type: dataType,
  }).toString();
  const html = await fetchText(url);
  return statFromStatsguru(html, criteria);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

await loadStore();

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const themeOwner = owner(req);
  if (!(req.headers.cookie || "").includes("team_game_js_user=")) {
    res.setHeader(
      "Set-Cookie",
      `team_game_js_user=${themeOwner}; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  }

  const user = currentUser(req);
  if (url.pathname.startsWith("/api/auth/")) {
    try {
      if (url.pathname === "/api/auth/session" && req.method === "GET")
        return sendJson(res, 200, { user: user ? publicUser(user) : null });
      if (url.pathname === "/api/auth/signup" && req.method === "POST") {
        const body = await requestBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 8)
          return sendJson(res, 400, { error: "Use a 3–32 character username and a password of at least 8 characters." });
        if (store.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
          return sendJson(res, 409, { error: "That username is already registered." });
        const credentials = await passwordHash(password);
        const account = { id: randomUUID(), username, role: store.users.length ? "player" : "admin", blocked: false, ...credentials, createdAt: new Date().toISOString() };
        store.users.push(account);
        await saveStore();
        const token = randomBytes(32).toString("hex");
        sessions.set(token, username);
        res.setHeader("Set-Cookie", `team_game_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
        return sendJson(res, 201, { user: publicUser(account), firstUserAdmin: account.role === "admin" });
      }
      if (url.pathname === "/api/auth/login" && req.method === "POST") {
        const body = await requestBody(req);
        const account = store.users.find((u) => u.username.toLowerCase() === String(body.username || "").trim().toLowerCase());
        if (!account || account.blocked) return sendJson(res, 401, { error: "Invalid username or password, or this account is blocked." });
        const expected = Buffer.from(account.hash, "hex");
        const actual = Buffer.from((await scrypt(String(body.password || ""), account.salt, 64)).toString("hex"), "hex");
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
          return sendJson(res, 401, { error: "Invalid username or password, or this account is blocked." });
        const token = randomBytes(32).toString("hex");
        sessions.set(token, account.username);
        return res.writeHead(200, { "content-type": "application/json; charset=utf-8", "Set-Cookie": `team_game_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` }).end(JSON.stringify({ user: publicUser(account) }));
      }
      if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        const token = parseCookies(req).team_game_session;
        if (token) sessions.delete(token);
        return res.writeHead(204, { "Set-Cookie": "team_game_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" }).end();
      }
    } catch (error) { return sendJson(res, 400, { error: error.message || "Invalid request" }); }
  }
  if (url.pathname.startsWith("/api/") && !user)
    return sendJson(res, 401, { error: "Please log in first." });
  if (url.pathname === "/api/profile" && req.method === "GET")
    return sendJson(res, 200, { user: publicUser(user, true) });
  if (url.pathname === "/api/profile" && req.method === "PATCH") {
    try {
      const body = await requestBody(req);
      const displayName = String(body.displayName ?? user.displayName ?? user.username).trim();
      const username = String(body.username ?? user.username).trim();
      const avatar = String(body.avatar ?? user.avatar ?? "");
      if (!displayName || displayName.length > 60) return sendJson(res, 400, { error: "Display name must be 1–60 characters." });
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return sendJson(res, 400, { error: "Username must be 3–32 letters, numbers, dots, dashes, or underscores." });
      if (store.users.some((item) => item !== user && item.username.toLowerCase() === username.toLowerCase())) return sendJson(res, 409, { error: "That username is already in use." });
      if (avatar && (!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(avatar) || Buffer.byteLength(avatar, "utf8") > 1400000)) return sendJson(res, 400, { error: "Choose a PNG, JPEG, WEBP, or GIF image under 1 MB." });
      const oldUsername = user.username;
      user.username = username;
      user.displayName = displayName;
      user.avatar = avatar;
      for (const game of store.history) {
        if (game.owner === oldUsername) game.owner = username;
      }
      for (const [token, name] of sessions) if (name === oldUsername) sessions.set(token, username);
      await saveStore();
      return sendJson(res, 200, { user: publicUser(user, true) });
    } catch (error) { return sendJson(res, 400, { error: error.message || "Invalid profile." }); }
  }
  if (url.pathname === "/api/profile/password" && req.method === "POST") {
    try {
      const body = await requestBody(req);
      const password = String(body.currentPassword || "");
      const actual = Buffer.from((await scrypt(password, user.salt, 64)).toString("hex"), "hex");
      const expected = Buffer.from(user.hash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return sendJson(res, 403, { error: "Current password is incorrect." });
      if (String(body.newPassword || "").length < 8) return sendJson(res, 400, { error: "New password must be at least 8 characters." });
      Object.assign(user, await passwordHash(String(body.newPassword)));
      await saveStore();
      return sendJson(res, 200, { updated: true });
    } catch (error) { return sendJson(res, 400, { error: error.message || "Invalid password request." }); }
  }
  if (url.pathname === "/api/draft-players" && req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    try {
      const players = JSON.parse(await readFile(join(root, "server/draft-players.json"), "utf8"));
      if (!Array.isArray(players) || players.some((name) => typeof name !== "string")) throw new Error("Invalid list");
      return sendJson(res, 200, players);
    } catch {
      return sendJson(res, 500, { error: "The draft player list is unavailable." });
    }
  }
  if (url.pathname === "/api/history" && req.method === "GET")
    return sendJson(res, 200, { games: store.history.filter((game) => canSeeGame(user, game)).sort((a, b) => b.playedAt.localeCompare(a.playedAt)) });
  if (url.pathname === "/api/history" && req.method === "POST") {
    try {
      const body = await requestBody(req);
      if (!["draft", "stats"].includes(body.type) || !body.data || typeof body.data !== "object")
        return sendJson(res, 400, { error: "Invalid game record." });
      const game = { id: randomUUID(), owner: user.username, type: body.type, title: String(body.title || (body.type === "draft" ? "Team Draft" : "Stats Winner")), participants: Array.isArray(body.participants) ? body.participants.map(String).slice(0, 50) : [], status: "complete", playedAt: new Date().toISOString(), data: body.data };
      store.history.push(game); await saveStore();
      return sendJson(res, 201, { game });
    } catch (error) { return sendJson(res, 400, { error: error.message || "Invalid game record." }); }
  }
  const deleteHistory = url.pathname.match(/^\/api\/history\/([^/]+)$/);
  if (deleteHistory && req.method === "DELETE") {
    const game = store.history.find((item) => item.id === deleteHistory[1]);
    if (!game) return sendJson(res, 404, { error: "Game not found." });
    if (!canSeeGame(user, game)) return sendJson(res, 403, { error: "You cannot delete this game." });
    store.history = store.history.filter((item) => item.id !== game.id); await saveStore();
    return sendJson(res, 200, { deleted: true });
  }
  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    if (user?.role !== "admin") return sendJson(res, 403, { error: "Admin access required." });
    return sendJson(res, 200, { users: store.users.map(publicUser) });
  }
  const adminUser = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUser && user?.role === "admin" && req.method === "PATCH") {
    const target = store.users.find((item) => item.username === decodeURIComponent(adminUser[1]));
    if (!target) return sendJson(res, 404, { error: "User not found." });
    const body = await requestBody(req);
    if (typeof body.blocked !== "boolean") return sendJson(res, 400, { error: "Specify blocked true or false." });
    if (target.role === "admin" && (body.blocked || body.role === "player") && store.users.filter((item) => item.role === "admin" && !item.blocked).length <= 1)
      return sendJson(res, 400, { error: "The last active admin cannot be blocked or demoted." });
    target.blocked = body.blocked;
    if (body.role === "player" || body.role === "admin") target.role = body.role;
    if (target.blocked) for (const [token, name] of sessions) if (name === target.username) sessions.delete(token);
    await saveStore(); return sendJson(res, 200, { user: publicUser(target) });
  }
  if (adminUser && user?.role === "admin" && req.method === "DELETE") {
    const target = store.users.find((item) => item.username === decodeURIComponent(adminUser[1]));
    if (!target) return sendJson(res, 404, { error: "User not found." });
    if (target.username === user.username) return sendJson(res, 400, { error: "You cannot delete your own account." });
    if (target.role === "admin" && store.users.filter((item) => item.role === "admin").length <= 1)
      return sendJson(res, 400, { error: "The last admin cannot be deleted." });
    store.users = store.users.filter((item) => item !== target);
    for (const [token, name] of sessions) if (name === target.username) sessions.delete(token);
    await saveStore(); return sendJson(res, 200, { deleted: true });
  }

  if (url.pathname === "/api/themes") {
    const data = await themeData(user.id, themeOwner);
    if (req.method === "GET") {
      return sendJson(res, 200, {
        themes: data.themes.filter((theme) => theme.owner === user.id),
        active: Object.hasOwn(data.activeByUser, user.id) ? { colors: data.activeByUser[user.id] } : null,
      });
    }

    let body = "";
    for await (const part of req) body += part;
    try {
      const payload = JSON.parse(body);
      if (!payload.name || !payload.colors) throw new Error("Invalid theme");
      data.themes.push({
        id: randomUUID(),
        owner: user.id,
        name: payload.name,
        colors: payload.colors,
      });
      data.activeByUser[user.id] = payload.colors;
      await writeFile(themeFile, JSON.stringify(data, null, 2));
      return sendJson(res, 201, { colors: data.activeByUser[user.id] });
    } catch {
      res.writeHead(400);
      return res.end("Invalid theme");
    }
  }

  if (url.pathname === "/api/themes/apply" && req.method === "POST") {
    let body = "";
    for await (const part of req) body += part;
    const payload = JSON.parse(body);
    const data = await themeData(user.id, themeOwner);
    const chosen =
      payload.id &&
      data.themes.find(
        (theme) => theme.id === payload.id && theme.owner === user.id,
      );
    const colors = chosen?.colors || payload.colors;
    const requiredKeys = ["bg", "surface", "text", "accent", "accent2"];
    if (
      !colors ||
      !requiredKeys.every((key) => typeof colors[key] === "string")
    ) {
      res.writeHead(400);
      return res.end("Invalid theme");
    }
    data.activeByUser[user.id] = colors;
    await writeFile(themeFile, JSON.stringify(data, null, 2));
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname === "/api/stat") {
    const player = url.searchParams.get("player") || "";
    const criteria = url.searchParams.get("criteria") || "";
    const allowedCriteria = [
      "Intl Runs",
      "Intl Wickets",
      "IPL Runs",
      "IPL Wickets",
    ];
    if (!player || !allowedCriteria.includes(criteria)) {
      return sendJson(res, 400, { error: "Invalid player or criteria" });
    }

    try {
      const result = await statFromCricinfo(player, criteria);
      return sendJson(res, 200, { player, criteria, ...result });
    } catch (cricinfoError) {
      try {
        const result = await statFromCricbuzz(player, criteria);
        return sendJson(res, 200, { player, criteria, ...result, fallback: "Cricinfo unavailable; used Cricbuzz." });
      } catch (cricbuzzError) {
        return sendJson(res, 502, {
          player,
          criteria,
          value: null,
          source: `Cricinfo failed: ${cricinfoError.message}; Cricbuzz fallback failed: ${cricbuzzError.message}`,
        });
      }
    }
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const data = await readFile(join(root, file));
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(Number(process.env.PORT || 8001), "0.0.0.0", () => {
  console.log(`Team Game JS: http://0.0.0.0:${process.env.PORT || 8001}`);
});
