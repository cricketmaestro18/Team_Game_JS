let openTournament = "";
let selectedSection = "matches";
const e = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const overText = (balls) => `${Math.floor((Number(balls) || 0) / 6)}.${(Number(balls) || 0) % 6}`;
function avatar(name) {
  const text = String(name || "?");
  const initials = text.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return `<span class="player-avatar small tournament-avatar"><span>${e(initials)}</span><img src="/api/player-image?v=5&name=${encodeURIComponent(text)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('loaded')" onerror="this.style.display='none'"></span>`;
}
function statRecord(players, sort, primary, columns) {
  const list = players.filter((p) => p[primary] > 0).sort(sort);
  const renderRows = (source) => source.map((p, i) => `<tr><td>${i + 1}</td><td><span class="tournament-player">${avatar(p.name)}<span>${e(p.name)}<small>${e(p.team)}</small></span></span></td>${columns.map((column) => `<td>${e(column.value(p))}</td>`).join("")}</tr>`).join("");
  const rows = renderRows(list.slice(0, 5));
  return `<section class="tournament-stat-card"><h3>${e(columns.title || "")}</h3><div class="tournament-table-wrap"><table><thead><tr><th>#</th><th>Player</th>${columns.map((column) => `<th>${e(column.label)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${columns.length + 2}" class="tournament-empty">No results recorded yet.</td></tr>`}</tbody></table></div>${list.length > 5 ? `<details class="tournament-more"><summary>Show all ${list.length} players</summary><div class="tournament-table-wrap"><table><thead><tr><th>#</th><th>Player</th>${columns.map((column) => `<th>${e(column.label)}</th>`).join("")}</tr></thead><tbody>${renderRows(list)}</tbody></table></div></details>` : ""}</section>`;
}
function aggregate(matches) {
  const batters = new Map(), bowlers = new Map(), bestBowling = new Map();
  for (const game of matches) for (const innings of game.data?.innings || []) {
    const team = innings.battingTeam || "";
    for (const p of innings.batting || []) {
      const key = `${team}\0${p.name}`;
      const item = batters.get(key) || { name: p.name, team, matches: 0, innings: 0, runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, hundreds: 0, fifties: 0, highest: 0 };
      item.innings++; item.matches++; item.runs += Number(p.runs) || 0; item.balls += Number(p.balls) || 0; item.fours += Number(p.fours) || 0; item.sixes += Number(p.sixes) || 0;
      if (!/not out/i.test(p.dismissal || "not out") && !/retired hurt/i.test(p.dismissal || "")) item.outs++;
      item.highest = Math.max(item.highest, Number(p.runs) || 0); if ((Number(p.runs) || 0) >= 100) item.hundreds++; else if ((Number(p.runs) || 0) >= 50) item.fifties++;
      batters.set(key, item);
    }
    const bowlingTeam = innings.bowlingTeam || "";
    for (const p of innings.bowling || []) {
      const key = `${bowlingTeam}\0${p.name}`;
      const item = bowlers.get(key) || { name: p.name, team: bowlingTeam, matches: 0, balls: 0, runs: 0, wickets: 0, maidens: 0, bestWickets: 0, bestRuns: Infinity, fiveWickets: 0 };
      item.matches++; item.balls += Number(p.balls) || 0; item.runs += Number(p.runs) || 0; item.wickets += Number(p.wickets) || 0; item.maidens += Number(p.maidens) || 0;
      const wkts = Number(p.wickets) || 0, conceded = Number(p.runs) || 0;
      if (wkts > item.bestWickets || (wkts === item.bestWickets && conceded < item.bestRuns)) { item.bestWickets = wkts; item.bestRuns = conceded; }
      if (wkts >= 5) item.fiveWickets++;
      bowlers.set(key, item);
      const figure = bestBowling.get(key) || { name: p.name, team: bowlingTeam, wickets: 0, runs: Infinity };
      if (wkts > figure.wickets || (wkts === figure.wickets && conceded < figure.runs)) { figure.wickets = wkts; figure.runs = conceded; }
      bestBowling.set(key, figure);
    }
  }
  const bowlingByKey = new Map([...bowlers.values()].map((p) => [`${p.team}\0${p.name}`, p]));
  const best = [...bestBowling.entries()].map(([key, p]) => { const season = bowlingByKey.get(key); return { ...p, balls: season?.balls || 0, economy: season?.balls ? season.runs * 6 / season.balls : 0 }; });
  return { batters: [...batters.values()], bowlers: [...bowlers.values()], bestBowling: best };
}
function matchesView(matches) {
  if (!matches.length) return `<section class="card"><p>No matches have been saved to this tournament yet.</p></section>`;
  return matches.map((game, index) => {
    const d = game.data || {}, innings = d.innings || [], scores = innings.map((inn) => `${inn.runs}/${inn.wickets}`).join(" · ");
    const scorecards = innings.map((inn, i) => `<article class="tournament-innings"><h4>${i + 1}${i ? "nd" : "st"} innings · ${e(inn.battingTeam)}</h4><p>${inn.runs}/${inn.wickets} · ${overText(inn.balls)} overs · Extras ${Object.values(inn.extras || {}).reduce((a, n) => a + (Number(n) || 0), 0)}</p><div class="tournament-scorecards"><section><h5>Batting</h5><div class="tournament-table-wrap"><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${(inn.batting || []).map((p) => `<tr><td>${e(p.name)}<small>${e(p.dismissal || "not out")}</small></td><td>${p.runs || 0}</td><td>${p.balls || 0}</td><td>${p.fours || 0}</td><td>${p.sixes || 0}</td><td>${p.balls ? (100 * p.runs / p.balls).toFixed(1) : "—"}</td></tr>`).join("")}</tbody></table></div></section><section><h5>Bowling · ${e(inn.bowlingTeam)}</h5><div class="tournament-table-wrap"><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>${(inn.bowling || []).map((p) => `<tr><td>${e(p.name)}</td><td>${overText(p.balls)}</td><td>${p.runs || 0}</td><td>${p.wickets || 0}</td><td>${p.balls ? (p.runs * 6 / p.balls).toFixed(1) : "—"}</td></tr>`).join("")}</tbody></table></div></section></div></article>`).join("");
    const commentary = innings.map((inn) => `<section class="tournament-detail-block"><h4>${e(inn.battingTeam)} · Commentary</h4>${[...(inn.deliveries || [])].reverse().map((delivery) => `<article class="tournament-ball"><b>${e(delivery.over || "")}</b><span>${e(delivery.text || `${delivery.bowler || ""} to ${delivery.batter || ""}, ${delivery.label || ""}`)}</span></article>`).join("") || "<p>No ball-by-ball commentary was saved for this match.</p>"}</section>`).join("");
    const partnerships = innings.map((inn) => `<section class="tournament-detail-block"><h4>${e(inn.battingTeam)} · Partnerships</h4>${(inn.partnerships || []).map((partnership, partIndex) => { const players = partnership.batters || [], contributions = partnership.playerRuns || {}, left = Number(contributions[players[0]]) || 0, right = Number(contributions[players[1]]) || 0, total = left + right, leftWidth = total ? Math.round(left / total * 100) : 50; return `<article class="tournament-partnership"><div class="tournament-partnership-names"><span><b>${e(players[0] || "Batter")}</b><small>${left || contributions[players[0]] === 0 ? left : "—"} runs</small></span><strong>${Number(partnership.runs) || 0} <small>(${Number(partnership.balls) || 0} balls)</small></strong><span><b>${e(players[1] || "Partner")}</b><small>${right || contributions[players[1]] === 0 ? right : "—"} runs</small></span></div><div class="tournament-partnership-bar" aria-label="Partnership ${partIndex + 1}: ${partnership.runs} runs"><span style="width:${leftWidth}%"></span><span style="width:${100 - leftWidth}%"></span></div></article>`; }).join("") || "<p>No partnerships were saved for this innings.</p>"}</section>`).join("");
    const graphs = `<section class="tournament-detail-block"><h4>Worm graph</h4><div class="tournament-worm-wrap"><svg class="tournament-worm" viewBox="0 0 640 280" role="img" aria-label="Worm graph showing cumulative runs by innings"><path class="worm-grid" d="M48 24V232H620 M48 180H620 M48 128H620 M48 76H620 M48 24H620"/><text x="8" y="28">Runs</text><text x="550" y="263">Deliveries</text>${innings.map((inn, lineIndex) => { const deliveries = [...(inn.deliveries || [])].reverse(); let score = 0; const points = [`48,232`, ...deliveries.map((delivery, i) => { score += Number(delivery.runs) || 0; const x = 48 + ((i + 1) / Math.max(1, deliveries.length)) * 560, y = 232 - (score / Math.max(1, ...innings.map((item) => Number(item.runs) || 0))) * 200; return `${x},${y}`; })]; return `<polyline class="worm-line worm-line-${lineIndex}" points="${points.join(" ")}"/><text x="${lineIndex * 180 + 56}" y="20" class="worm-legend worm-legend-${lineIndex}">${e(inn.battingTeam)}</text>`; }).join("")}</svg></div></section>`;
    const detailed = `<div class="tournament-detail" id="match-detail-${index}" hidden><nav class="tournament-detail-tabs">${["scorecard", "commentary", "graphs", "partnerships"].map((tab, i) => `<button data-detail-tab="${index}" data-section="${tab}" class="${i === 0 ? "active" : ""}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}</nav><div data-detail-panel="scorecard">${scorecards}</div><div data-detail-panel="commentary" hidden>${commentary}</div><div data-detail-panel="graphs" hidden>${graphs}</div><div data-detail-panel="partnerships" hidden>${partnerships}</div></div>`;
    return `<article class="card tournament-match"><div class="tournament-match-summary"><span><b>Match ${matches.length - index}</b><small>${new Date(game.playedAt).toLocaleString()}</small></span><span>${e(d.teams?.[0] || "Team 1")} vs ${e(d.teams?.[1] || "Team 2")}<small>${e(scores)} · ${e(d.result || "Match complete")}</small></span><button type="button" data-toggle-match="${index}" aria-expanded="false">Detailed view</button></div>${detailed}</article>`;
  }).join("");
}
function statsView(matches) {
  const { batters, bowlers, bestBowling } = aggregate(matches);
  const by = (key) => (a, b) => b[key] - a[key] || a.name.localeCompare(b.name);
  const battingAverage = (p) => p.outs ? p.runs / p.outs : p.runs;
  const bowlingAverage = (p) => p.wickets ? p.runs / p.wickets : Infinity;
  const economy = (p) => p.balls ? p.runs * 6 / p.balls : Infinity;
  const defs = [
    ["Runs", batters, by("runs"), "runs", [{ label: "M", value: (p) => p.matches }, { label: "Avg", value: (p) => battingAverage(p).toFixed(2) }, { label: "SR", value: (p) => p.balls ? (100 * p.runs / p.balls).toFixed(2) : "—" }, { label: "Runs", value: (p) => p.runs }]],
    ["Wickets", bowlers, by("wickets"), "wickets", [{ label: "M", value: (p) => p.matches }, { label: "Econ", value: (p) => economy(p).toFixed(2) }, { label: "W", value: (p) => p.wickets }]],
    ["Highest Scores", batters, (a,b) => b.highest-a.highest || a.name.localeCompare(b.name), "highest", [{ label: "SR", value: (p) => p.balls ? (100*p.runs/p.balls).toFixed(2) : "—" }, { label: "HS", value: (p) => p.highest }]],
    ["Best Bowling Figures", bestBowling, (a,b) => b.wickets-a.wickets || a.runs-b.runs, "wickets", [{ label: "O", value: (p) => overText(p.balls) }, { label: "Econ", value: (p) => p.economy.toFixed(2) }, { label: "BB", value: (p) => `${p.wickets}/${p.runs}` }]],
    ["Batting Average", batters.filter((p) => p.innings), (a,b) => battingAverage(b)-battingAverage(a), "runs", [{ label: "M", value: (p) => p.matches }, { label: "Runs", value: (p) => p.runs }, { label: "Avg", value: (p) => battingAverage(p).toFixed(2) }]],
    ["Bowling Average", bowlers.filter((p) => p.wickets), (a,b) => bowlingAverage(a)-bowlingAverage(b), "wickets", [{ label: "M", value: (p) => p.matches }, { label: "W", value: (p) => p.wickets }, { label: "Avg", value: (p) => bowlingAverage(p).toFixed(2) }]],
    ["Most Hundreds", batters, by("hundreds"), "hundreds", [{ label: "M", value: (p) => p.matches }, { label: "Runs", value: (p) => p.runs }, { label: "100s", value: (p) => p.hundreds }]],
    ["Most Fifties", batters, by("fifties"), "fifties", [{ label: "M", value: (p) => p.matches }, { label: "Runs", value: (p) => p.runs }, { label: "50s", value: (p) => p.fifties }]],
    ["Most Economical Bowlers", bowlers.filter((p) => p.balls), (a,b) => economy(a)-economy(b), "balls", [{ label: "M", value: (p) => p.matches }, { label: "W", value: (p) => p.wickets }, { label: "Econ", value: (p) => economy(p).toFixed(2) }]],
    ["Five Wicket Hauls", bowlers, by("fiveWickets"), "fiveWickets", [{ label: "M", value: (p) => p.matches }, { label: "W", value: (p) => p.wickets }, { label: "5W", value: (p) => p.fiveWickets }]],
    ["Sixes", batters, by("sixes"), "sixes", [{ label: "M", value: (p) => p.matches }, { label: "Runs", value: (p) => p.runs }, { label: "6s", value: (p) => p.sixes }]],
    ["Fours", batters, by("fours"), "fours", [{ label: "M", value: (p) => p.matches }, { label: "Runs", value: (p) => p.runs }, { label: "4s", value: (p) => p.fours }]],
    ["Boundaries", batters, (a,b) => b.sixes+b.fours-a.sixes-a.fours, "runs", [{ label: "4s", value: (p) => p.fours }, { label: "6s", value: (p) => p.sixes }, { label: "Total", value: (p) => p.fours+p.sixes }]],
  ];
  return `<div class="tournament-stats-grid">${defs.map(([title, players, sort, primary, columns]) => {
    columns.title = title;
    return statRecord(players, sort, primary, columns);
  }).join("")}</div>`;
}
const finishKey = (name) => `cricket-tournament-finished:${name}`;
function tournamentMvp(matches) {
  const { batters, bowlers } = aggregate(matches), people = new Map();
  for (const player of batters) { const item = people.get(player.name) || { name: player.name, team: player.team, runs: 0, wickets: 0 }; item.runs += player.runs; people.set(player.name, item); }
  for (const player of bowlers) { const item = people.get(player.name) || { name: player.name, team: player.team, runs: 0, wickets: 0 }; item.wickets += player.wickets; people.set(player.name, item); }
  return [...people.values()].map((player) => ({ ...player, points: player.runs + player.wickets * 20 })).sort((a, b) => b.points - a.points || b.runs - a.runs || b.wickets - a.wickets)[0] || null;
}
function summaryView(matches) {
  const mvp = tournamentMvp(matches), { batters, bowlers } = aggregate(matches);
  const leadingRunScorer = [...batters].sort((a, b) => b.runs - a.runs)[0], leadingWicketTaker = [...bowlers].sort((a, b) => b.wickets - a.wickets)[0];
  return `<section class="card tournament-summary"><p class="eyebrow">TOURNAMENT COMPLETE</p><h2>🏆 ${e(mvp?.name || "No MVP available")}</h2>${mvp ? `<p class="tournament-summary-team">${e(mvp.team)} · MVP score ${mvp.points}</p><p>${mvp.runs} runs + 20 × ${mvp.wickets} wickets</p>` : `<p>No player statistics were recorded.</p>`}<div class="tournament-summary-highlights"><article><small>MOST RUNS</small><b>${e(leadingRunScorer?.name || "—")}</b><span>${leadingRunScorer?.runs ?? 0} runs</span></article><article><small>MOST WICKETS</small><b>${e(leadingWicketTaker?.name || "—")}</b><span>${leadingWicketTaker?.wickets ?? 0} wickets</span></article></div><p class="note">MVP score uses runs + 20 points per wicket.</p></section>`;
}
async function renderTournamentPage(root, profileNav, onProfileTab) {
  root.innerHTML = `${profileNav}<section class="screen-intro"><div><p class="eyebrow">YOUR COMPETITIONS</p><h1>Tournaments</h1><p>Keep match scorecards and player standings together for each tournament.</p></div><span class="screen-intro-icon" aria-hidden="true">🏆</span></section><div id="tournament-content">Loading tournaments…</div>`;
  root.querySelectorAll("[data-profile-tab]").forEach((button) => button.onclick = () => onProfileTab(button.dataset.profileTab));
  const games = (await fetch("/api/history").then((r) => r.json()).catch(() => ({ games: [] }))).games || [];
  const tournaments = new Map();
  for (const game of games.filter((item) => item.type === "scorecard")) {
    const name = String(game.data?.tournamentName || "").trim(); if (!name) continue;
    tournaments.set(name, [...(tournaments.get(name) || []), game]);
  }
  const content = root.querySelector("#tournament-content");
  if (!openTournament || !tournaments.has(openTournament)) {
    openTournament = "";
    if (!tournaments.size) { content.innerHTML = '<section class="card"><h2>No tournaments yet</h2><p>Create a tournament when you start Cricket Scorecard. Completed matches and tournament stats will appear here.</p><a href="#scorecard">Start a scorecard</a></section>'; return; }
    content.innerHTML = `<div class="tournament-list">${[...tournaments.entries()].sort((a,b) => b[1][0].playedAt.localeCompare(a[1][0].playedAt)).map(([name, matches]) => `<button class="card tournament-tile" data-tournament="${e(name)}"><span class="tournament-tile-icon">🏆</span><span><b>${e(name)}</b><small>${matches.length} ${matches.length === 1 ? "match" : "matches"} · Last played ${new Date(matches[0].playedAt).toLocaleDateString()}</small></span><strong>›</strong></button>`).join("")}</div>`;
    content.querySelectorAll("[data-tournament]").forEach((button) => button.onclick = () => { openTournament = button.dataset.tournament; renderTournamentPage(root, profileNav, onProfileTab); });
    return;
  }
  const matches = tournaments.get(openTournament);
  let finished = false; try { finished = localStorage.getItem(finishKey(openTournament)) === "true"; } catch { /* storage can be unavailable */ }
  const visibleSection = selectedSection === "summary" && !finished ? "matches" : selectedSection;
  content.innerHTML = `<button class="screen-back-link" id="tournament-back">← All tournaments</button><section class="tournament-heading"><div><p class="eyebrow">TOURNAMENT</p><h2>${e(openTournament)}</h2><p>${matches.length} ${matches.length === 1 ? "match" : "matches"} recorded${finished ? " · Finished" : ""}</p></div><button type="button" class="tournament-finish" id="finish-tournament" ${finished ? "disabled" : ""}>${finished ? "Tournament finished" : "Finish tournament"}</button></section><nav class="scorecard-tabs tournament-tabs"><button data-tournament-section="matches" class="${visibleSection === "matches" ? "active" : ""}">Matches</button><button data-tournament-section="stats" class="${visibleSection === "stats" ? "active" : ""}">Stats</button>${finished ? `<button data-tournament-section="summary" class="${visibleSection === "summary" ? "active" : ""}">Summary</button>` : ""}</nav><div class="tournament-view">${visibleSection === "matches" ? matchesView(matches) : visibleSection === "stats" ? statsView(matches) : summaryView(matches)}</div>`;
  content.querySelector("#tournament-back").onclick = () => { openTournament = ""; renderTournamentPage(root, profileNav, onProfileTab); };
  content.querySelector("#finish-tournament").onclick = () => { try { localStorage.setItem(finishKey(openTournament), "true"); } catch { /* storage can be unavailable */ } selectedSection = "summary"; renderTournamentPage(root, profileNav, onProfileTab); };
  content.querySelectorAll("[data-tournament-section]").forEach((button) => button.onclick = () => { selectedSection = button.dataset.tournamentSection; renderTournamentPage(root, profileNav, onProfileTab); });
  content.querySelectorAll("[data-toggle-match]").forEach((button) => button.onclick = () => { const panel = content.querySelector(`#match-detail-${button.dataset.toggleMatch}`), open = panel.hidden; panel.hidden = !open; button.setAttribute("aria-expanded", String(open)); button.textContent = open ? "Hide details" : "Detailed view"; });
  content.querySelectorAll("[data-detail-tab]").forEach((button) => button.onclick = () => { const card = button.closest(".tournament-match"); card.querySelectorAll("[data-detail-tab]").forEach((tab) => tab.classList.toggle("active", tab === button)); card.querySelectorAll("[data-detail-panel]").forEach((panel) => { panel.hidden = panel.dataset.detailPanel !== button.dataset.section; }); });
}
export { renderTournamentPage };
