let match = null;
let selectedTournamentName = "";
let tournamentTeams = [];
let ownerKey = "guest";
let pausedMatch = null;
let pausedOwnerKey = "";
const ongoingStorageKey = () => `cricket-scorecard-ongoing:${ownerKey}`;
function readOngoing() { try { return JSON.parse(localStorage.getItem(ongoingStorageKey()) || "[]"); } catch { return []; } }
function persistOngoing() {
  if (!match?.id) return;
  const saved = readOngoing().filter((item) => item.id !== match.id);
  if (!match.finished) {
    const recovery = structuredClone(match);
    recovery.undo = [];
    saved.unshift(recovery);
    pausedMatch = recovery;
    pausedOwnerKey = ownerKey;
  } else if (pausedMatch?.id === match.id) pausedMatch = null;
  try { localStorage.setItem(ongoingStorageKey(), JSON.stringify(saved)); } catch { /* browser storage may be unavailable */ }
}
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = (s, root = document) => root.querySelector(s);
const ballsText = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
const freshInnings = (batting, bowling, striker, nonStriker, bowler) => ({ batting, bowling, striker, nonStriker, nextBatter: 3, batters: [striker, nonStriker].map((name) => ({ name, runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: "not out", retired: false })), bowlers: [{ name: bowler, balls: 0, runs: 0, wickets: 0, maidens: 0, overRuns: 0, wides: 0, noBalls: 0 }], currentBowler: bowler, total: 0, wickets: 0, legalBalls: 0, extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 }, deliveries: [], partnerships: [], stand: { batters: [striker, nonStriker], playerRuns: { [striker]: 0, [nonStriker]: 0 }, runs: 0, balls: 0 }, ended: false });
function active() { return match.innings[match.innings.length - 1]; }
function batter(inn, name) { return inn.batters.find((p) => p.name === name); }
function rememberPlayer(team, name) { const key = `teamPlayers${team}`; match[key] ||= []; if (!match[key].some((player) => player.toLowerCase() === name.toLowerCase())) match[key].push(name); }
function bowler(inn, name = inn.currentBowler) { let p = inn.bowlers.find((x) => x.name === name); if (!p) { p = { name, balls: 0, runs: 0, wickets: 0, maidens: 0, overRuns: 0, wides: 0, noBalls: 0 }; inn.bowlers.push(p); } return p; }
function addBatter(inn, name) { inn.batters.push({ name, runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: "not out", retired: false }); inn.nextBatter++; }
function swap(inn) { [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker]; }
function snapshot() { const saved = structuredClone(match); delete saved.undo; match.undo.push(saved); }
function oversDone(inn) { return inn.legalBalls >= match.overs * 6; }
function inningsDone(inn) { return inn.ended || inn.wickets >= match.wicketLimit || inn.batters.filter((p) => !p.retired).length < 2 || oversDone(inn); }
function closeOver(inn) { return inn.legalBalls > 0 && inn.legalBalls % 6 === 0; }
function finishCheck() {
  const inn = active();
  if (match.innings.length === 2 && inn.total > match.innings[0].total) { match.finished = true; match.result = `${match.teams[inn.batting]} won by ${match.wicketLimit - inn.wickets} wicket${match.wicketLimit - inn.wickets === 1 ? "" : "s"}`; }
  else if (inningsDone(inn)) { inn.ended = true; if (match.innings.length === 1) match.screen = "chase-setup"; else { match.finished = true; const first = match.innings[0].total, second = inn.total; match.result = first > second ? `${match.teams[match.innings[0].batting]} won by ${first - second} runs` : second === first ? "Match tied" : `${match.teams[inn.batting]} won by ${match.wicketLimit - inn.wickets} wicket${match.wicketLimit - inn.wickets === 1 ? "" : "s"}`; } }
  else if (closeOver(inn)) match.screen = "next-over";
}
function runBall(value, flags) {
  const inn = active(); if (match.finished || match.screen !== "match") return;
  const striker = inn.striker, faced = batter(inn, striker), bowl = bowler(inn);
  snapshot();
  let teamRuns = value, batRuns = value, legal = true, label = String(value), bowlerRuns = value, extraType = "";
  if (flags.wide) { teamRuns = value + 1; batRuns = 0; bowlerRuns = teamRuns; legal = false; extraType = "wides"; inn.extras.wides++; bowl.wides++; label = value === 0 ? "WD" : value === 4 ? "5WD" : `${value}WD`; }
  else if (flags.noBall) { teamRuns = value + 1; batRuns = value; bowlerRuns = teamRuns; legal = false; extraType = "noBalls"; inn.extras.noBalls++; bowl.noBalls++; faced.balls++; label = value === 0 ? "NB" : `${value}NB`; if (value === 4) faced.fours++; if (value === 6) faced.sixes++; }
  else if (flags.byes || flags.legByes) { batRuns = 0; bowlerRuns = 0; extraType = flags.byes ? "byes" : "legByes"; inn.extras[extraType] += value; label = value ? `${value}${flags.byes ? "B" : "LB"}` : (flags.byes ? "B" : "LB"); faced.balls++; }
  else { faced.balls++; if (value === 4) faced.fours++; if (value === 6) faced.sixes++; }
  inn.total += teamRuns; faced.runs += batRuns; bowl.runs += bowlerRuns; bowl.overRuns += bowlerRuns; inn.stand.runs += teamRuns; inn.stand.balls++; inn.stand.playerRuns ||= {}; inn.stand.playerRuns[striker] = (inn.stand.playerRuns[striker] || 0) + batRuns;
  if (legal) { inn.legalBalls++; bowl.balls++; }
  inn.deliveries.unshift({ over: ballsText(inn.legalBalls), label, runs: teamRuns, batRuns, batter: striker, nonStriker: inn.nonStriker, bowler: bowl.name, text: `${bowl.name} to ${striker}, ${label}${extraType ? ` (${extraType === "wides" ? "wide" : extraType === "noBalls" ? "no-ball" : extraType === "byes" ? "byes" : "leg-byes"})` : ""}` });
  if (value % 2 === 1) swap(inn);
  if (legal && closeOver(inn)) { if (!bowl.overRuns) bowl.maidens++; bowl.overRuns = 0; swap(inn); }
  if (flags.wicket) { match.pending = { runs: value, striker, bowler: bowl.name, flags, label }; match.screen = "wicket"; renderScorecard(); return; }
  finishCheck(); renderScorecard();
}
function resolveWicket(form) {
  const inn = active(), p = match.pending, outName = form.dismissed.value, type = form.wicketType.value;
  const dismissed = batter(inn, outName); if (!dismissed) return;
  const runout = type === "Run out";
  if (runout) { /* completed runs remain credited to the striker */ }
  else if (p.runs) { const faced = batter(inn, p.striker); inn.total -= p.runs; inn.stand.runs -= p.runs; inn.stand.playerRuns ||= {}; inn.stand.playerRuns[p.striker] = Math.max(0, (inn.stand.playerRuns[p.striker] || 0) - p.runs); bowler(inn).runs -= p.runs; faced.runs -= p.runs; if (p.runs === 4) faced.fours--; if (p.runs === 6) faced.sixes--; }
  const fielder = form.elements.existingFielder?.value || form.elements.newFielder?.value.trim() || "fielder";
  if (["Caught", "Stumped", "Run out"].includes(type) && !form.elements.existingFielder?.value && form.elements.newFielder?.value.trim()) {
    rememberPlayer(inn.bowling, fielder);
    match.rosters ||= {}; match.rosters[match.teams[inn.bowling]] ||= [];
    if (!match.rosters[match.teams[inn.bowling]].some((name) => name.toLowerCase() === fielder.toLowerCase())) match.rosters[match.teams[inn.bowling]].push(fielder);
  }
  dismissed.dismissal = type === "Run out" ? `run out (${fielder})` : type === "Caught" ? `c ${fielder} b ${inn.currentBowler}` : type === "Stumped" ? `st ${fielder} b ${inn.currentBowler}` : `${type.toLowerCase()} b ${inn.currentBowler}`;
  const delivery = inn.deliveries[0];
  if (delivery) {
    delivery.label = "W";
    delivery.text = `${p.bowler || inn.currentBowler} to ${outName}, W, ${outName} is ${type.toLowerCase()}`;
  }
  inn.wickets++; if (!["Run out", "Retired hurt", "Retired out"].includes(type)) bowler(inn).wickets++;
  if (type === "Retired hurt") dismissed.retired = true;
  if (runout && p.runs % 2) swap(inn);
  if (dismissed.retired) { /* allow replacement without counting a wicket */ inn.wickets--; }
  inn.partnerships.push({ ...inn.stand, batters: [...inn.stand.batters], playerRuns: { ...(inn.stand.playerRuns || {}) } });
  inn.stand = { batters: [], playerRuns: {}, runs: 0, balls: 0 };
  match.pending = null;
  if (inningsDone(inn)) { match.screen = "match"; finishCheck(); renderScorecard(); return; }
  match.screen = "incoming"; match.incomingSlot = inn.striker === outName ? "striker" : "nonStriker"; match.afterIncoming = closeOver(inn) ? "next-over" : "match"; renderScorecard();
}
const top = (title, subtitle = "") => `<section class="screen-intro"><div><p class="eyebrow">CRICKET SCORECARD</p><h1>${h(title)}</h1><p>${h(subtitle)}</p></div><span class="screen-intro-icon" aria-hidden="true">🏏</span></section>`;
function setupPage(root, show) {
  const teamOptions = tournamentTeams.map((team) => `<option value="${h(team.name)}">${h(team.name)}</option>`).join("");
  const teamField = (key, label, placeholder) => `<fieldset class="scorecard-player-choice"><legend>${label}</legend><label>Choose a previous team<select name="${key}Existing"><option value="">Create a new team</option>${teamOptions}</select></label><label>Or enter a new team name<input name="${key}New" maxlength="50" placeholder="${placeholder}"${tournamentTeams.length ? "" : " required"}></label></fieldset>`;
  root.innerHTML = `<button class="screen-back-link" id="scorecard-home">← Home</button>${top("Set up your match", "Choose the match length and name both teams.")}<section class="card setup-card"><form id="scorecard-setup"><label>Overs<input name="overs" type="number" min="1" max="50" value="20" required></label><label>Wickets<input name="wickets" type="number" min="1" max="10" value="10" required></label>${teamField("batting", "Batting team", "e.g. Riverside XI")}${teamField("bowling", "Bowling team", "e.g. Hilltop XI")}<p id="setup-error" class="note"></p><button>Continue to opening players</button></form></section>`;
  $("#scorecard-home", root).onclick = () => show("home");
  const form = $("#scorecard-setup", root);
  for (const key of ["batting", "bowling"]) { const select = form.elements[`${key}Existing`], input = form.elements[`${key}New`]; select.onchange = () => { input.required = !select.value; if (select.value) input.value = ""; }; input.oninput = () => { if (input.value.trim()) select.value = ""; }; }
  form.onsubmit = (e) => { e.preventDefault(); const teams = ["batting", "bowling"].map((key) => form.elements[`${key}Existing`].value || form.elements[`${key}New`].value.trim()); if (teams.some((x) => !x) || teams[0].toLowerCase() === teams[1].toLowerCase()) { $("#setup-error", root).textContent = "Choose or enter two different team names."; return; } const rosters = Object.fromEntries(tournamentTeams.map((team) => [team.name, team.players])); match = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tournamentName: selectedTournamentName, overs: +form.elements.overs.value, wicketLimit: +form.elements.wickets.value, teams, rosters, innings: [], screen: "openers", undo: [], tab: "summary", finished: false, saved: false }; renderScorecard(); };
}
async function tournamentPage(root, show) {
  let games = [];
  try { games = (await fetch("/api/history").then((r) => r.json())).games || []; } catch { games = []; }
  const tournaments = [...new Set(games.filter((g) => g.type === "scorecard").map((g) => String(g.data?.tournamentName || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const ongoing = readOngoing();
  if (pausedMatch && pausedOwnerKey === ownerKey && !ongoing.some((item) => item.id === pausedMatch.id)) ongoing.unshift(pausedMatch);
  root.innerHTML = `<button class="screen-back-link" id="scorecard-home">← Home</button>${top("Choose a tournament", "Create a tournament or add this match to one you already play.")}${ongoing.length ? `<section class="card scorecard-ongoing"><h2>Ongoing matches</h2><div class="scorecard-ongoing-list">${ongoing.map((item) => { const inn = item.innings?.at(-1); return `<button class="scorecard-ongoing-match" data-resume-match="${h(item.id)}"><span><b>${h(item.teams?.[0] || "Team 1")} vs ${h(item.teams?.[1] || "Team 2")}</b><small>${h(item.tournamentName || "Untitled tournament")} · ${h(inn ? `${item.teams[inn.batting]} ${inn.total}/${inn.wickets} (${ballsText(inn.legalBalls)} overs)` : "Setup in progress")}</small></span><strong>Continue →</strong></button>`; }).join("")}</div></section>` : ""}<section class="card setup-card"><form id="tournament-select"><label>Create a new tournament<input name="newTournament" maxlength="60" placeholder="e.g. Weekend Cup"></label><div class="scorecard-or"><span>or select an existing tournament</span></div><label>Existing tournaments<select name="existingTournament"><option value="">Choose a tournament</option>${tournaments.map((name) => `<option>${h(name)}</option>`).join("")}</select></label><p class="note" id="tournament-error"></p><button>Continue to match setup</button></form></section>`;
  $("#scorecard-home", root).onclick = () => show("home");
  root.querySelectorAll("[data-resume-match]").forEach((button) => button.onclick = () => { match = readOngoing().find((item) => item.id === button.dataset.resumeMatch) || (pausedMatch?.id === button.dataset.resumeMatch && pausedOwnerKey === ownerKey ? pausedMatch : null); if (match) renderScorecard(root, show); });
  $("#tournament-select", root).onsubmit = (e) => { e.preventDefault(); const form = e.currentTarget, created = form.elements.newTournament.value.trim(), existing = form.elements.existingTournament.value; if (created && existing) { $("#tournament-error", root).textContent = "Enter a new tournament name or choose an existing one, not both."; return; } selectedTournamentName = (created || existing).trim(); if (!selectedTournamentName) { $("#tournament-error", root).textContent = "Enter a name or choose a tournament."; return; } const rosterMap = new Map(); for (const game of games.filter((g) => g.type === "scorecard" && g.data?.tournamentName === selectedTournamentName)) for (const inn of game.data.innings || []) { const add = (team, players) => { if (!team) return; const roster = rosterMap.get(team) || new Set(); for (const player of players || []) if (player?.name) roster.add(player.name); rosterMap.set(team, roster); }; add(inn.battingTeam, inn.batting); add(inn.bowlingTeam, inn.bowling); } tournamentTeams = [...rosterMap].map(([name, players]) => ({ name, players: [...players] })); match = { screen: "setup" }; setupPage(root, show); };
}
function setupInningsPage(root, show) {
  const chase = match.screen === "chase-setup", batting = chase ? match.teams[1] : match.teams[0], bowling = chase ? match.teams[0] : match.teams[1];
  const battingRoster = match.rosters?.[batting] || [];
  const bowlingRoster = match.rosters?.[bowling] || [];
  const choosePlayer = (label, key, players) => `<fieldset class="scorecard-player-choice"><legend>${label}</legend><label>Choose a player<select name="${key}Existing"><option value="">Enter a new name</option>${players.map((name) => `<option>${h(name)}</option>`).join("")}</select></label><label>Or add a player<input name="${key}New" maxlength="50"${players.length ? "" : " required"}></label></fieldset>`;
  const batterFields = `${choosePlayer("Striker", "striker", battingRoster)}${choosePlayer("Non-striker", "nonStriker", battingRoster)}`;
  const bowlerField = choosePlayer("Opening bowler", "bowler", bowlingRoster);
  root.innerHTML = `<button class="screen-back-link" id="scorecard-home">← Home</button>${top(chase ? "Set up the chase" : "Choose your opening players", `${batting} batting · ${bowling} bowling`)}<section class="card setup-card"><form id="scorecard-openers">${batterFields}${bowlerField}<p id="openers-error" class="note"></p><button>${chase ? "Start second innings" : "Start innings"}</button></form></section>`;
  $("#scorecard-home", root).onclick = () => show("home");
  const form = $("#scorecard-openers", root);
  for (const key of ["striker", "nonStriker", "bowler"]) {
    const select = form.elements[`${key}Existing`], input = form.elements[`${key}New`];
    if (!select || !input) continue;
    select.onchange = () => { input.required = !select.value; if (select.value) input.value = ""; };
    input.oninput = () => { if (input.value.trim()) select.value = ""; };
  }
  form.onsubmit = (e) => { e.preventDefault(); const names = ["striker", "nonStriker", "bowler"].map((key) => form.elements[`${key}Existing`].value || form.elements[`${key}New`].value.trim()); if (names.some((x) => !x) || new Set(names.map((x) => x.toLowerCase())).size !== 3) { $("#openers-error", root).textContent = "Choose or enter three different player names."; return; } const inn = freshInnings(chase ? 1 : 0, chase ? 0 : 1, ...names); match.innings.push(inn); names.slice(0, 2).forEach((name) => rememberPlayer(inn.batting, name)); rememberPlayer(inn.bowling, names[2]); match.rosters ||= {}; match.rosters[batting] ||= []; match.rosters[bowling] ||= []; for (const name of names.slice(0, 2)) if (!match.rosters[batting].some((p) => p.toLowerCase() === name.toLowerCase())) match.rosters[batting].push(name); if (!match.rosters[bowling].some((p) => p.toLowerCase() === names[2].toLowerCase())) match.rosters[bowling].push(names[2]); match.screen = "match"; renderScorecard(); };
}
function rowsBat(inn) { return inn.batters.map((p) => `<tr><td>${h(p.name)}<small>${p.dismissal === "not out" || p.retired ? " not out" : ` · ${h(p.dismissal)}`}</small></td><td>${p.runs}</td><td>${p.balls}</td><td>${p.fours}</td><td>${p.sixes}</td><td>${p.balls ? (p.runs * 100 / p.balls).toFixed(1) : "—"}</td></tr>`).join(""); }
function rowsBowl(inn) { return inn.bowlers.map((p) => `<tr><td>${h(p.name)}</td><td>${ballsText(p.balls)}</td><td>${p.runs}</td><td>${p.maidens || 0}</td><td>${p.wickets}</td><td>${p.balls ? (p.runs * 6 / p.balls).toFixed(1) : "—"}</td></tr>`).join(""); }
function bowlingTable(inn, title = "Bowling scorecard") { return `<h3>${title}</h3><div class="scorecard-table-scroll"><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>M</th><th>W</th><th>Econ</th></tr></thead><tbody>${rowsBowl(inn)}</tbody></table></div>`; }
function summary(inn) {
  const striker = batter(inn, inn.striker), non = batter(inn, inn.nonStriker), b = bowler(inn);
  const target = match.innings.length === 2 ? match.innings[0].total + 1 : null;
  return `<div class="scorecard-live"><div class="scorecard-metrics"><div><small>OVERS</small><b>${ballsText(inn.legalBalls)} / ${match.overs}</b></div><div><small>RUN RATE</small><b>${inn.legalBalls ? (inn.total * 6 / inn.legalBalls).toFixed(2) : "0.00"}</b></div><div><small>${target ? "TARGET" : "WICKETS"}</small><b>${target || `${inn.wickets} / ${match.wicketLimit}`}</b></div></div><h2>${h(match.teams[inn.batting])} <strong>${inn.total}/${inn.wickets}</strong></h2><p>${target ? `Need ${Math.max(0, target - inn.total)} from ${Math.max(0, match.overs * 6 - inn.legalBalls)} balls` : `Extras: ${inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes} · ${inn.extras.wides} wd, ${inn.extras.noBalls} nb, ${inn.extras.byes} b, ${inn.extras.legByes} lb`}</p><div class="scorecard-table-scroll"><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${[striker, non].filter(Boolean).map((p) => `<tr class="${p.name === inn.striker ? "on-strike" : ""}"><td>${p.name === inn.striker ? "★ " : ""}${h(p.name)}</td><td>${p.runs}</td><td>${p.balls}</td><td>${p.fours}</td><td>${p.sixes}</td><td>${p.balls ? (100 * p.runs / p.balls).toFixed(1) : "—"}</td></tr>`).join("")}</tbody></table></div>${bowlingTable(inn)}<p>Current bowler: <b>${h(b.name)}</b> · ${ballsText(b.balls)} overs · ${b.runs} runs · ${b.wickets} wickets</p><h3>Recent deliveries</h3><div class="scorecard-deliveries">${inn.deliveries.slice(0, 12).map((d) => `<span><b>${h(d.label)}</b> ${h(d.text)}</span>`).join("") || "No balls yet"}</div></div>`;
}
function scorecardTab(inn) { return match.innings.map((i, n) => `<section class="card"><h2>${n + 1}${n ? "nd" : "st"} innings · ${h(match.teams[i.batting])}</h2><p class="note">${i.total}/${i.wickets} · ${ballsText(i.legalBalls)} overs</p><h3>Batting scorecard</h3><div class="scorecard-table-scroll"><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${rowsBat(i)}</tbody></table></div><h3>Bowling scorecard · ${h(match.teams[i.bowling])}</h3><div class="scorecard-table-scroll"><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>M</th><th>W</th><th>Econ</th></tr></thead><tbody>${rowsBowl(i)}</tbody></table></div></section>`).join(""); }
function wormGraph(inn) {
  const balls = [...inn.deliveries].reverse(); let score = 0;
  const points = [`42,222`, ...balls.map((delivery, i) => { score += Number(delivery.runs) || 0; const x = 42 + ((i + 1) / Math.max(1, balls.length)) * 570, y = 222 - score / Math.max(1, inn.total) * 190; return `${x},${y}`; })];
  return `<section class="card"><h2>Worm graph</h2><div class="scorecard-worm-wrap"><svg class="scorecard-worm" viewBox="0 0 640 270" role="img" aria-label="Cumulative runs by delivery"><path class="worm-grid" d="M42 24V222H620 M42 174H620 M42 126H620 M42 78H620 M42 30H620"/><polyline points="${points.join(" ")}"/><text x="8" y="24">Runs</text><text x="548" y="258">Deliveries</text><text x="45" y="244">0</text><text x="585" y="244">${balls.length}</text></svg></div><p class="note">${h(match.teams[inn.batting])} · ${inn.total} runs</p></section>`;
}
function tabs(inn) {
  if (match.tab === "scorecard") return scorecardTab(inn);
  if (match.tab === "commentary") return `<section class="card"><h2>Ball-by-ball commentary</h2><div class="scorecard-commentary">${inn.deliveries.map((d) => `<article><b>${h(d.over)} · ${h(d.label)}</b><span>${h(d.text)}</span></article>`).join("") || "Commentary will appear here after the first ball."}</div></section>`;
  if (match.tab === "graphs") return wormGraph(inn);
  if (match.tab === "partnerships") return `<section class="card"><h2>Partnerships</h2><div class="scorecard-partnership-list">${[...inn.partnerships, ...(inn.stand.batters.length ? [inn.stand] : [])].map((p, i) => { const [leftName, rightName] = p.batters || [], left = Number(p.playerRuns?.[leftName]) || 0, right = Number(p.playerRuns?.[rightName]) || 0, combined = Math.max(1, left + right); return `<article class="scorecard-partnership-visual"><div><b>${h(leftName || "Batter")}</b><span>${p.playerRuns?.[leftName] === undefined ? "—" : left} runs</span></div><strong>${p.runs} <small>(${p.balls} balls${i < inn.partnerships.length ? ` · wicket ${i + 1}` : " · current"})</small></strong><div><b>${h(rightName || "Partner")}</b><span>${p.playerRuns?.[rightName] === undefined ? "—" : right} runs</span></div><div class="scorecard-partnership-bar"><span style="width:${left / combined * 100}%"></span><span style="width:${right / combined * 100}%"></span></div></article>`; }).join("") || '<p class="note">Partnerships appear as the innings progresses.</p>'}</div></section>`;
  return summary(inn);
}
function renderScorecard(root = $("#app"), show = (p) => { location.hash = p; }) {
  persistOngoing();
  if (!match) return tournamentPage(root, show);
  if (match.screen === "setup") return setupPage(root, show);
  if (["openers", "chase-setup"].includes(match.screen)) return setupInningsPage(root, show);
  if (match.screen === "next-over") {
    const inn = active(), players = match.rosters?.[match.teams[inn.bowling]] || [inn.currentBowler]; root.innerHTML = `${top("Over complete", `${h(match.teams[inn.batting])} · ${ballsText(inn.legalBalls)} overs`)}<section class="card setup-card"><form id="next-bowler"><label>Choose an existing bowler<select name="existing"><option value="">Enter a new bowler</option>${players.map((name) => `<option>${h(name)}</option>`).join("")}</select></label><label>Or add next bowler<input name="newName" maxlength="50"></label><p class="note" id="bowler-error"></p><button>Continue innings</button></form></section>`;
    const form = $("#next-bowler", root); form.elements.existing.onchange = () => { form.elements.newName.required = !form.elements.existing.value; }; form.elements.newName.required = true;
    form.onsubmit = (e) => { e.preventDefault(); let name = form.elements.existing.value; if (!name) { name = form.elements.newName.value.trim(); if (!name) return; if (players.some((p) => p.toLowerCase() === name.toLowerCase())) { $("#bowler-error", root).textContent = "That player is already on the bowling team. Select them above."; return; } players.push(name); match.rosters[match.teams[inn.bowling]] = players; } inn.currentBowler = name; bowler(inn, name); match.screen = "match"; renderScorecard(root, show); }; return;
  }
  if (match.screen === "incoming") {
    const inn = active(), hurt = inn.batters.filter((p) => p.retired && p.dismissal === "retired hurt"), roster = match.rosters?.[match.teams[inn.batting]] || [], used = new Set(inn.batters.map((p) => p.name.toLowerCase())), available = roster.filter((name) => !used.has(name.toLowerCase()));
    root.innerHTML = `${top("Choose the next batter", `${h(match.teams[inn.batting])} · ${inn.wickets} wicket${inn.wickets === 1 ? "" : "s"} down`)}<section class="card setup-card"><form id="next-batter">${available.length ? `<label>Select a player from the team<select name="rosterPlayer"><option value="">Enter a new name</option>${available.map((name) => `<option>${h(name)}</option>`).join("")}</select></label>` : ""}${hurt.length ? `<label>Return a retired-hurt batter<select name="returning"><option value="">Choose a new batter instead</option>${hurt.map((p) => `<option>${h(p.name)}</option>`).join("")}</select></label>` : ""}<label>Or enter a new batter<input name="name" maxlength="50"${available.length || hurt.length ? "" : " required"}></label><p id="incoming-error" class="note"></p><button>Continue</button></form></section>`;
    const form = $("#next-batter", root), syncName = () => { form.elements.name.required = !(form.elements.rosterPlayer?.value || form.elements.returning?.value); };
    form.elements.rosterPlayer?.addEventListener("change", () => { if (form.elements.rosterPlayer.value) { form.elements.returning && (form.elements.returning.value = ""); form.elements.name.value = ""; } syncName(); });
    form.elements.returning?.addEventListener("change", () => { if (form.elements.returning.value) { form.elements.rosterPlayer && (form.elements.rosterPlayer.value = ""); form.elements.name.value = ""; } syncName(); });
    form.elements.name.oninput = () => { if (form.elements.rosterPlayer) form.elements.rosterPlayer.value = ""; if (form.elements.returning) form.elements.returning.value = ""; syncName(); };
    form.onsubmit = (e) => { e.preventDefault(); let player; const selected = form.elements.returning?.value || form.elements.rosterPlayer?.value; if (form.elements.returning?.value) { player = batter(inn, selected); player.retired = false; player.dismissal = "not out"; } else if (selected) { addBatter(inn, selected); player = batter(inn, selected); } else { const name = form.elements.name.value.trim(); if (!name || inn.batters.some((p) => p.name.toLowerCase() === name.toLowerCase())) { $("#incoming-error", root).textContent = "Choose a listed player or enter a new name."; return; } addBatter(inn, name); rememberPlayer(inn.batting, name); match.rosters ||= {}; match.rosters[match.teams[inn.batting]] ||= []; match.rosters[match.teams[inn.batting]].push(name); player = batter(inn, name); } if (match.incomingSlot === "striker") inn.striker = player.name; else inn.nonStriker = player.name; inn.stand.batters = [inn.striker, inn.nonStriker]; inn.stand.playerRuns ||= {}; inn.stand.playerRuns[player.name] ??= 0; match.screen = match.afterIncoming || "match"; match.afterIncoming = null; renderScorecard(root, show); }; return;
  }
  if (match.screen === "wicket") {
    const inn = active(), players = match.rosters?.[match.teams[inn.bowling]] || [inn.currentBowler]; root.innerHTML = `${top("Wicket details", `${h(match.teams[inn.batting])} · ${inn.total}/${inn.wickets}`)}<section class="card setup-card"><form id="wicket-form"><label>Dismissed batter<select name="dismissed">${[inn.striker, inn.nonStriker].filter(Boolean).map((n) => `<option>${h(n)}</option>`).join("")}</select></label><label>Wicket type<select name="wicketType"><option>Bowled</option><option>Caught</option><option>LBW</option><option>Stumped</option><option>Hit Wicket</option><option>Run out</option></select></label><div id="fielder-area" hidden><label>Select an existing fielder<select name="existingFielder"><option value="">Choose a player</option>${players.map((name) => `<option>${h(name)}</option>`).join("")}</select></label><label>Or add a new fielder<input name="newFielder" maxlength="50"></label><p id="fielder-error" class="note"></p></div><button>Record wicket</button></form></section>`;
    const form = $("#wicket-form", root), type = $(`[name=wicketType]`, form), area = $("#fielder-area", form), existing = form.elements.existingFielder, added = form.elements.newFielder;
    const syncFielder = () => { added.required = !area.hidden && !existing.value; };
    type.onchange = () => { area.hidden = !["Caught", "Stumped", "Run out"].includes(type.value); syncFielder(); }; type.dispatchEvent(new Event("change"));
    existing.onchange = () => { if (existing.value) added.value = ""; syncFielder(); };
    added.oninput = () => { if (added.value.trim()) existing.value = ""; syncFielder(); };
    form.onsubmit = (e) => { e.preventDefault(); if (!area.hidden && !existing.value && !added.value.trim()) { $("#fielder-error", root).textContent = "Choose an existing fielder or enter a new name."; return; } if (!area.hidden && added.value.trim() && players.some((p) => p.toLowerCase() === added.value.trim().toLowerCase())) { $("#fielder-error", root).textContent = "That player is already on the bowling team. Select them above."; return; } resolveWicket(form); }; return;
  }
  const inn = active();
  if (match.finished) return renderResult(root, show);
  const modifiers = `<div class="scorecard-modifiers">${["wide", "noBall", "byes", "legByes", "wicket"].map((x) => `<label><input type="checkbox" data-modifier="${x}"> ${x === "noBall" ? "No ball" : x === "legByes" ? "Leg byes" : x[0].toUpperCase() + x.slice(1)}</label>`).join("")}</div>`;
  root.innerHTML = `${top("Live scorecard", `${h(match.teams[inn.batting])} vs ${h(match.teams[inn.bowling])} · ${match.overs} overs · ${match.wicketLimit} wickets`)}<nav class="scorecard-tabs">${["summary", "scorecard", "commentary", "graphs", "partnerships"].map((t) => `<button data-sc-tab="${t}" class="${match.tab === t ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</nav><div class="scorecard-content">${tabs(inn)}</div>${match.tab === "summary" ? `<section class="card scorecard-controls"><div class="scorecard-actions"><button data-sc-action="swap">Swap</button><button data-sc-action="retire">Retire</button><button data-sc-action="end">End innings</button><button data-sc-action="undo" ${match.undo.length ? "" : "disabled"}>Undo</button></div>${modifiers}<div class="scorecard-runs">${[0,1,2,3,4,5,6].map((n) => `<button data-sc-run="${n}">${n}</button>`).join("")}</div></section>` : ""}`;
  root.querySelectorAll("[data-sc-tab]").forEach((b) => b.onclick = () => { match.tab = b.dataset.scTab; renderScorecard(root, show); });
  root.querySelectorAll("[data-sc-action]").forEach((b) => b.onclick = () => action(b.dataset.scAction, root, show));
  root.querySelectorAll("[data-sc-run]").forEach((b) => b.onclick = () => { const flags = Object.fromEntries([...root.querySelectorAll("[data-modifier]:checked")].map((x) => [x.dataset.modifier, true])); if (flags.wicket) runBall(+b.dataset.scRun, flags); else runBall(+b.dataset.scRun, flags); });
  root.querySelectorAll("[data-modifier]").forEach((x) => x.onchange = () => { if (x.checked) root.querySelectorAll("[data-modifier]").forEach((other) => { if (other !== x && ["wide", "noBall", "byes", "legByes"].includes(other.dataset.modifier)) other.checked = false; }); });
}
function action(which, root, show) {
  const inn = active();
  if (which === "swap") { swap(inn); renderScorecard(root, show); }
  if (which === "undo") { if (!match.undo.length) return; const stack = match.undo; match = stack.pop(); match.undo = stack; renderScorecard(root, show); }
  if (which === "end") { if (!confirm("End this innings now?")) return; inn.ended = true; finishCheck(); renderScorecard(root, show); }
  if (which === "retire") {
    root.insertAdjacentHTML("beforeend", `<div class="scorecard-modal"><form id="retire-form" class="card"><h2>Retire batter</h2><label>Batter<select name="name">${[inn.striker, inn.nonStriker].filter(Boolean).map((n) => `<option>${h(n)}</option>`).join("")}</select></label><label>Retirement<select name="kind"><option>Retired hurt</option><option>Retired out</option></select></label><div class="scorecard-actions"><button>Continue</button><button type="button" id="retire-cancel">Cancel</button></div></form></div>`);
    const form = $("#retire-form", root); $("#retire-cancel", root).onclick = () => renderScorecard(root, show); form.onsubmit = (e) => { e.preventDefault(); snapshot(); const name = form.elements.name.value, p = batter(inn, name); p.dismissal = form.elements.kind.value.toLowerCase(); p.retired = true; if (form.elements.kind.value === "Retired out") inn.wickets++; inn.partnerships.push({ ...inn.stand, batters: [...inn.stand.batters], playerRuns: { ...(inn.stand.playerRuns || {}) } }); inn.stand = { batters: [], playerRuns: {}, runs: 0, balls: 0 }; match.screen = "incoming"; match.incomingSlot = inn.striker === name ? "striker" : "nonStriker"; finishCheck(); renderScorecard(root, show); };
  }
}
function renderResult(root, show) {
  const innings = match.innings;
  root.innerHTML = `<button class="screen-back-link" id="scorecard-home">← Home</button>${top("Match complete", match.result)}<section class="card scorecard-result"><h2>${h(match.result)}</h2><p>${innings.map((i) => `${h(match.teams[i.batting])} ${i.total}/${i.wickets} (${ballsText(i.legalBalls)} overs)`).join(" · ")}</p><div class="scorecard-result-actions"><button id="scorecard-save" ${match.saved || match.saving ? "disabled" : ""}>${match.saved ? "Saved to profile history" : match.saving ? "Saving match…" : "Save to profile history"}</button><button id="scorecard-new">New match</button></div><p class="note" id="scorecard-save-note">${match.saved ? "Match saved in Profile → History." : "Saving this result to your profile history."}</p></section>${scorecardTab()}`;
  $("#scorecard-home", root).onclick = () => show("home"); $("#scorecard-new", root).onclick = () => { match = null; renderScorecard(root, show); };
  const save = async () => { if (match.saved || match.saving) return; match.saving = true; const button = $("#scorecard-save", root), note = $("#scorecard-save-note", root); button.disabled = true; button.textContent = "Saving match…"; note.textContent = "Saving this result to your tournament."; const data = { tournamentName: match.tournamentName, teams: match.teams, overs: match.overs, wicketLimit: match.wicketLimit, result: match.result, innings: match.innings.map((i) => ({ battingTeam: match.teams[i.batting], bowlingTeam: match.teams[i.bowling], runs: i.total, wickets: i.wickets, balls: i.legalBalls, extras: i.extras, batting: i.batters, bowling: i.bowlers, deliveries: i.deliveries, partnerships: [...i.partnerships, ...(i.stand.batters.length ? [{ ...i.stand, batters: [...i.stand.batters], playerRuns: { ...(i.stand.playerRuns || {}) } }] : [])] })) }; try { const r = await fetch("/api/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "scorecard", title: "Cricket Scorecard", data, participants: match.teams }) }); if (!r.ok) throw new Error("Could not save this match."); match.saved = true; note.textContent = `Match saved under ${match.tournamentName} in Profile → Tournaments.`; button.textContent = "Saved to tournament"; } catch (error) { note.textContent = error.message; button.disabled = false; button.textContent = "Retry saving history"; } finally { match.saving = false; } };
  $("#scorecard-save", root).onclick = save;
  if (!match.saved && !match.saving) save();
}
function startScorecard(root, show, userKey = "guest") { ownerKey = userKey; if (match?.id && !match.finished) persistOngoing(); match = null; selectedTournamentName = ""; tournamentTeams = []; renderScorecard(root, show); }
export { renderScorecard, startScorecard };
