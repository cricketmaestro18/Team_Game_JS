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

function semanticNameSimilarity(query, candidateName) {
  const tokenize = (value) => {
    const parts = normalizePlayerName(value).split(" ").filter(Boolean);
    const tokens = [];
    for (let index = 0; index < parts.length; index += 1) {
      if (parts[index].length === 1 && parts[index + 1]?.length === 1) {
        let initials = "";
        while (parts[index]?.length === 1) initials += parts[index++];
        tokens.push(initials);
        index -= 1;
      } else {
        tokens.push(parts[index]);
      }
    }
    return tokens;
  };
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidateName);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  if (queryTokens.join(" ") === candidateTokens.join(" ")) return 1;

  const pairs = [];
  queryTokens.forEach((left, leftIndex) => candidateTokens.forEach((right, rightIndex) => {
    let score;
    if (left === right) score = 1;
    else if ((left.length === 1 && right.startsWith(left)) || (right.length === 1 && left.startsWith(right))) score = 0.92;
    else score = 1 - editDistance(left, right) / Math.max(left.length, right.length);
    if (score >= 0.55) pairs.push({ leftIndex, rightIndex, score });
  }));
  pairs.sort((a, b) => b.score - a.score);

  const usedLeft = new Set();
  const usedRight = new Set();
  let matchedScore = 0;
  for (const pair of pairs) {
    if (usedLeft.has(pair.leftIndex) || usedRight.has(pair.rightIndex)) continue;
    usedLeft.add(pair.leftIndex);
    usedRight.add(pair.rightIndex);
    matchedScore += pair.score;
  }
  const queryCoverage = matchedScore / queryTokens.length;
  const candidateCoverage = matchedScore / candidateTokens.length;
  return queryCoverage + candidateCoverage === 0
    ? 0
    : (2 * queryCoverage * candidateCoverage) / (queryCoverage + candidateCoverage);
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
    type: criteria.includes("Runs") ? "batting" : "bowling",
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
  const candidates = playerCandidatesFromSearch(html)
    .map((candidate) => ({
      ...candidate,
      similarity: semanticNameSimilarity(name, candidate.name),
    }))
    .filter((candidate) => candidate.similarity >= 0.86)
    .sort((a, b) => b.similarity - a.similarity);
  if (candidates.length === 0) return null;

  // An exact, unique profile name is the safest match (and avoids selecting
  // similarly named players just because they have longer careers).
  const exact = candidates.filter((candidate) => candidate.similarity === 1);
  if (exact.length === 1) return exact[0].id;

  const topSimilarity = candidates[0].similarity;
  const plausible = candidates.filter((candidate) => candidate.similarity >= topSimilarity - 0.025);
  if (plausible.length === 1) {
    return plausible[0].similarity >= 0.9 ? plausible[0].id : null;
  }

  // For genuinely ambiguous names, compare appearances in the requested
  // discipline. Never fall back to whichever search result happened to come first.
  const scored = await Promise.all(plausible.slice(0, 10).map(async (candidate) => ({
    ...candidate,
    matches: await playerCareerMatches(candidate.id, criteria).catch(() => -1),
  })));
  scored.sort((a, b) => b.matches - a.matches || b.similarity - a.similarity);
  const [best, second] = scored;
  if (best.matches < 0 || (second && second.matches >= best.matches - 1)) return null;
  return best.id;
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

const cricbuzzPlayerImageCache = new Map();
let activePlayerImageLookups = 0;
const playerImageResponseCache = new Map();
const waitingPlayerImageLookups = [];

async function withPlayerImageLookup(task) {
  if (activePlayerImageLookups >= 4) await new Promise((resolve) => waitingPlayerImageLookups.push(resolve));
  activePlayerImageLookups += 1;
  try { return await task(); }
  finally {
    activePlayerImageLookups -= 1;
    waitingPlayerImageLookups.shift()?.();
  }
}

async function googlePlayerImageUrl(playerName) {
  const url = new URL("https://www.google.com/search");
  url.search = new URLSearchParams({ tbm: "isch", q: `${playerName} cricketer portrait`, hl: "en", gl: "in" }).toString();
  try {
    const response = await withPlayerImageLookup(() => fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36", accept: "text/html", "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(7000),
    }));
    if (!response.ok) return null;
    const html = (await response.text()).replace(/\\u003d|\u003d|\\x3d/gi, "=").replace(/\\u0026|\u0026|\\x26/gi, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    const candidates = [];
    for (const [, tag] of html.matchAll(/<img\b[^>]*>/gi)) {
      const source = tag.match(/(?:src|data-src)=(["'])(.*?)\1/i)?.[2];
      const alt = tag.match(/alt=(["'])(.*?)\1/i)?.[2] || "";
      if (!source || !/encrypted-tbn\d*\.gstatic\.com/i.test(source)) continue;
      const score = semanticNameSimilarity(playerName, alt.replace(/<[^>]*>/g, " "));
      // Ignore thumbnails whose own text does not identify the requested player.
      if (score >= 0.8) candidates.push({ source, score });
    }
    const image = candidates.sort((a, b) => b.score - a.score)[0]?.source;
    if (!image) return null;
    const imageUrl = new URL(image.replace(/\\u003d|\u003d|\\x3d/gi, "=").replace(/\\u0026|\u0026|\\x26/gi, "&"));
    return /^encrypted-tbn\d*\.gstatic\.com$/.test(imageUrl.hostname) ? imageUrl.href : null;
  } catch { return null; }
}

async function wikipediaPlayerImageUrl(playerName) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: `"${playerName}" cricket`,
    gsrnamespace: "0", gsrlimit: "8", prop: "pageimages", piprop: "thumbnail",
    pithumbsize: "320", format: "json",
  }).toString();
  try {
    const response = await withPlayerImageLookup(() => fetch(url, {
      headers: { "user-agent": "TeamGame/1.0 (cricket player portrait lookup)", accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    }));
    if (!response.ok) return null;
    const payload = await response.json();
    const pages = Object.values(payload.query?.pages || {});
    const matches = pages.map((page) => {
      const title = page.title.replace(/\s*\([^)]*\)\s*$/, "");
      return { page, score: playerNameSimilarity(playerName, title) };
    }).filter(({ page, score }) => score >= 0.82 && page.thumbnail?.source)
      .sort((a, b) => b.score - a.score);
    const source = matches[0]?.page.thumbnail.source;
    if (!source) return null;
    const imageUrl = new URL(source);
    return ["thumb.wikimedia.org", "upload.wikimedia.org"].includes(imageUrl.hostname) ? imageUrl.href : null;
  } catch { return null; }
}

async function commonsPlayerImageUrl(playerName) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: `filetype:bitmap \"${playerName}\" cricket`,
    gsrnamespace: "6", gsrlimit: "10", prop: "imageinfo", iiprop: "url",
    iiurlwidth: "320", format: "json",
  }).toString();
  try {
    const response = await withPlayerImageLookup(() => fetch(url, {
      headers: { "user-agent": "TeamGame/1.0 (cricket player portrait lookup)", accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    }));
    if (!response.ok) return null;
    const payload = await response.json();
    const name = normalizePlayerName(playerName);
    const rejectTerms = /\b(and|team|squad|fans|fan|logo|jersey|shirt|bat|stadium|match|statue|museum|poster)\b/i;
    const matches = Object.values(payload.query?.pages || {}).map((page) => {
      const fileName = page.title.replace(/^File:/i, "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      const normalized = normalizePlayerName(fileName);
      const imageUrl = page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url;
      return { normalized, fileName, imageUrl };
    }).filter((item) => item.normalized.includes(name) && !rejectTerms.test(item.fileName) && item.imageUrl)
      .sort((a, b) => a.normalized.length - b.normalized.length);
    const source = matches[0]?.imageUrl;
    if (!source) return null;
    const imageUrl = new URL(source);
    return ["thumb.wikimedia.org", "upload.wikimedia.org"].includes(imageUrl.hostname) ? imageUrl.href : null;
  } catch { return null; }
}

async function cricbuzzPortraitSearch(query) {
  try {
    const response = await withPlayerImageLookup(() => fetch(`https://www.cricbuzz.com/api/player-search/${encodeURIComponent(query)}`, {
      headers: { ...requestHeaders, accept: "application/json", referer: "https://www.cricbuzz.com/profiles/" },
      signal: AbortSignal.timeout(9000),
    }));
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.player) ? payload.player : [];
  } catch { return []; }
}

async function cricbuzzProfileImageUrl(player) {
  if (!player?.id) return null;
  const slug = normalizePlayerName(player.name).replace(/\s+/g, "-");
  try {
    const response = await withPlayerImageLookup(() => fetch(`https://www.cricbuzz.com/profiles/${encodeURIComponent(player.id)}/${encodeURIComponent(slug)}`, {
      headers: { ...requestHeaders, accept: "text/html", referer: "https://www.cricbuzz.com/profiles/" },
      signal: AbortSignal.timeout(9000),
    }));
    if (!response.ok) return null;
    const html = await response.text();
    const image = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i)?.[1];
    if (!image) return null;
    const imageUrl = new URL(image, response.url);
    return /^(?:static\.cricbuzz\.com|www\.cricbuzz\.com)$/.test(imageUrl.hostname) ? imageUrl.href : null;
  } catch { return null; }
}

async function legacyPlayerPortraitUrl(playerName) {
  const key = normalizePlayerName(playerName);
  const searchTerms = [...new Set([playerName.trim(), ...key.split(" ").filter((part) => part.length >= 3).reverse()])];
  const seenPlayers = new Map();
  for (const term of searchTerms) {
    const players = await cricbuzzPortraitSearch(term);
    for (const candidate of players) {
      const similarity = semanticNameSimilarity(playerName, candidate.name || "");
      if (similarity < 0.86) continue;
      const previous = seenPlayers.get(String(candidate.id));
      if (!previous || similarity > previous.similarity) seenPlayers.set(String(candidate.id), { ...candidate, similarity });
    }
    const matches = [...seenPlayers.values()].sort((a, b) => b.similarity - a.similarity || (String(a.faceImageId) === "182026") - (String(b.faceImageId) === "182026"));
    const match = matches[0];
    if (match && match.similarity >= 0.9) {
      if (match.faceImageId && String(match.faceImageId) !== "182026") {
        return `https://static.cricbuzz.com/a/img/v1/256x256/i1/c${encodeURIComponent(match.faceImageId)}/i.jpg`;
      }
      const profileImage = await cricbuzzProfileImageUrl(match);
      if (profileImage) return profileImage;
    }
  }
  return await wikipediaPlayerImageUrl(playerName) || await commonsPlayerImageUrl(playerName);
}

async function playerPortraitUrl(playerName) {
  const key = normalizePlayerName(playerName);
  if (!key) return null;
  const cached = cricbuzzPlayerImageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const lookup = (async () => {
    const googleImage = await googlePlayerImageUrl(playerName);
    if (googleImage) return googleImage;
    return legacyPlayerPortraitUrl(playerName);
  })();
  const promise = lookup.then((imageUrl) => {
    cricbuzzPlayerImageCache.set(key, { promise: Promise.resolve(imageUrl), expiresAt: Date.now() + (imageUrl ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000) });
    return imageUrl;
  }).catch(() => null);
  cricbuzzPlayerImageCache.set(key, { promise, expiresAt: Date.now() + 30_000 });
  return promise;
}

const chaseSquadsFile = join(root, "server/chase-squads.json");
const chaseSquadTeams = [
  "Chennai Super Kings", "Delhi Capitals", "Gujarat Titans", "Royal Challengers Bengaluru",
  "Punjab Kings", "Kolkata Knight Riders", "Sunrisers Hyderabad", "Rajasthan Royals",
  "Lucknow Super Giants", "Mumbai Indians",
];
let chaseSquadsCache = null;
let chaseSquadsCacheUntil = 0;

function articleText(html) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li|section|article|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .split("\n")
    .map((line) => clean(line))
    .filter(Boolean)
    .join("\n");
}

function scrapeCricbuzzSquads(html, fallback) {
  const text = articleText(html);
  const roleByPlayer = new Map(fallback.teams.flatMap((team) => team.players.map((player) => [normalizePlayerName(player.name), player.role])));
  const teamStarts = chaseSquadTeams.map((name) => ({ name, index: text.indexOf(name, Math.max(0, text.indexOf("Current squads"))) })).sort((a, b) => a.index - b.index);
  const foundTeams = [];
  const auctionRoles = [
    ["Batters", "batter"], ["Wicketkeepers", "wicketkeeper"], ["Allrounders", "allrounder"],
    ["Spinners", "bowler"], ["Pacers", "bowler"],
  ];
  for (let i = 0; i < teamStarts.length; i += 1) {
    const start = teamStarts[i];
    if (start.index < 0) continue;
    const end = teamStarts.slice(i + 1).find((team) => team.index > start.index)?.index ?? text.length;
    const section = text.slice(start.index + start.name.length, end);
    const names = new Map();
    const retention = section.match(/Retentions\s*:\s*([\s\S]*?)(?=Auction Buys|Purse Remaining|$)/i)?.[1] || "";
    for (const rawName of retention.split(",")) {
      const playerName = rawName.replace(/\([^)]*\)/g, "").replace(/[.;\s]+$/g, "").trim();
      if (playerName) names.set(playerName, roleByPlayer.get(normalizePlayerName(playerName)) || "batter");
    }
    for (let roleIndex = 0; roleIndex < auctionRoles.length; roleIndex += 1) {
      const [label, role] = auctionRoles[roleIndex];
      const nextLabels = auctionRoles.slice(roleIndex + 1).map(([nextLabel]) => nextLabel).join("|");
      const expression = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=${nextLabels ? `${nextLabels}|` : ""}Purse Remaining|Overseas slots|$)`, "i");
      const values = section.match(expression)?.[1] || "";
      for (const item of values.split(",")) {
        const playerName = item.replace(/\([^)]*\)/g, "").replace(/[.;\s]+$/g, "").trim();
        if (playerName && !/^nil$/i.test(playerName)) names.set(playerName, role);
      }
    }
    const players = [...names].map(([name, role]) => ({ name, role }));
    if (players.length >= 20 && players.length <= 28 && players.filter((player) => player.role === "bowler" || player.role === "allrounder").length >= 5) {
      foundTeams.push({ name: start.name, players });
    }
  }
  if (foundTeams.length !== 10) throw new Error(`Cricbuzz squad page returned ${foundTeams.length} complete teams`);
  return { season: 2026, source: "Cricbuzz IPL 2026 squad article", teams: foundTeams };
}

async function getChaseSquads() {
  const now = Date.now();
  if (chaseSquadsCache && now < chaseSquadsCacheUntil) return chaseSquadsCache;
  const fallback = JSON.parse(await readFile(chaseSquadsFile, "utf8"));
  try {
    const response = await fetch("https://www.cricbuzz.com/cricket-news/136914/ipl-2026-auction-current-squads-purse-remaining", {
      headers: { ...requestHeaders, referer: "https://www.cricbuzz.com/cricket-series/9241/indian-premier-league-2026/squads" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Cricbuzz returned HTTP ${response.status}`);
    chaseSquadsCache = scrapeCricbuzzSquads(await response.text(), fallback);
    chaseSquadsCacheUntil = now + 6 * 60 * 60 * 1000;
  } catch {
    chaseSquadsCache = fallback;
    chaseSquadsCacheUntil = now + 10 * 60 * 1000;
  }
  return chaseSquadsCache;
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
  if (url.pathname === "/api/player-image" && req.method === "GET") {
    const playerName = (url.searchParams.get("name") || "").trim().slice(0, 100);
    if (!playerName) { res.writeHead(204); return res.end(); }
    let imageUrl = await playerPortraitUrl(playerName);
    if (!imageUrl) { res.writeHead(204, { "Cache-Control": "public, max-age=300" }); return res.end(); }
    const loadImage = async (source) => {
      const parsed = new URL(source);
      const allowedHost = /^(?:encrypted-tbn\d*\.gstatic\.com|static\.cricbuzz\.com|thumb\.wikimedia\.org|upload\.wikimedia\.org)$/i.test(parsed.hostname);
      if (!allowedHost) throw new Error("Unsupported player image host");
      const response = await fetch(parsed, { headers: { ...requestHeaders, referer: parsed.hostname.endsWith("gstatic.com") ? "https://www.google.com/" : "https://www.cricbuzz.com/" }, signal: AbortSignal.timeout(9000) });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.startsWith("image/")) throw new Error("Player image unavailable");
      return { body: Buffer.from(await response.arrayBuffer()), contentType, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    };
    let image = playerImageResponseCache.get(imageUrl);
    if (!image || image.expiresAt <= Date.now()) {
      try { image = await loadImage(imageUrl); }
      catch {
        if (!new URL(imageUrl).hostname.endsWith("gstatic.com")) { res.writeHead(204, { "Cache-Control": "public, max-age=300" }); return res.end(); }
        imageUrl = await legacyPlayerPortraitUrl(playerName);
        if (!imageUrl) { res.writeHead(204, { "Cache-Control": "public, max-age=300" }); return res.end(); }
        const playerKey = normalizePlayerName(playerName);
        cricbuzzPlayerImageCache.set(playerKey, { promise: Promise.resolve(imageUrl), expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
        try { image = await loadImage(imageUrl); }
        catch { res.writeHead(204, { "Cache-Control": "public, max-age=300" }); return res.end(); }
      }
      if (playerImageResponseCache.size >= 100) playerImageResponseCache.delete(playerImageResponseCache.keys().next().value);
      playerImageResponseCache.set(imageUrl, image);
    }
    res.writeHead(200, { "Content-Type": image.contentType, "Content-Length": image.body.length, "Cache-Control": "public, max-age=21600", "X-Content-Type-Options": "nosniff" });
    return res.end(image.body);
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
  if (url.pathname === "/api/chase-squads" && req.method === "GET") {
    try {
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, await getChaseSquads());
    } catch {
      return sendJson(res, 503, { error: "IPL squads are currently unavailable." });
    }
  }
  if (url.pathname === "/api/history" && req.method === "GET")
    return sendJson(res, 200, { games: store.history.filter((game) => canSeeGame(user, game)).sort((a, b) => b.playedAt.localeCompare(a.playedAt)) });
  if (url.pathname === "/api/history" && req.method === "POST") {
    try {
      const body = await requestBody(req);
      if (!["draft", "stats", "chase"].includes(body.type) || !body.data || typeof body.data !== "object")
        return sendJson(res, 400, { error: "Invalid game record." });
      const game = { id: randomUUID(), owner: user.username, type: body.type, title: String(body.title || (body.type === "draft" ? "Team Draft" : body.type === "chase" ? "Chase Master" : "Stats Winner")), participants: Array.isArray(body.participants) ? body.participants.map(String).slice(0, 50) : [], status: "complete", playedAt: new Date().toISOString(), data: body.data };
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
  console.log(`Cricket Mini Games: http://0.0.0.0:${process.env.PORT || 8001}`);
});
