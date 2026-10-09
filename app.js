const app = document.querySelector("#app");
const $ = (s, root = document) => root.querySelector(s);
let currentUser = null;
let profileTab = "profile";
const defaultTheme = {
  bg: "#101914",
  surface: "#18251f",
  text: "#edf5f0",
  accent: "#23bb91",
  accent2: "#08765b",
};
function applyTheme(t) {
  Object.entries(t).forEach(([k, v]) =>
    document.documentElement.style.setProperty(`--${k}`, v),
  );
}
applyTheme(defaultTheme);
async function loadTheme() {
  const response = await fetch("/api/themes");
  if (!response.ok) throw new Error("Could not load this account's theme.");
  const state = await response.json();
  if (state.active?.colors) applyTheme(state.active.colors);
  else applyTheme(defaultTheme);
  return state;
}
async function persistTheme(colors) {
  applyTheme(colors);
  await fetch("/api/themes/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ colors }),
  });
}
function show(name) {
  location.hash = name;
  closeMobileMenu();
  render();
}
function closeMobileMenu() {
  const nav = $("#main-nav");
  const toggle = $("#menu-toggle");
  nav?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
  toggle?.setAttribute("aria-label", "Open navigation menu");
}
document
  .querySelectorAll("[data-page]")
  .forEach((button) => (button.onclick = () => {
    if (button.dataset.page === "profile") profileTab = "profile";
    show(button.dataset.page);
  }));
$("#menu-toggle").onclick = () => {
  const nav = $("#main-nav");
  const isOpen = nav.classList.toggle("is-open");
  $("#menu-toggle").setAttribute("aria-expanded", String(isOpen));
  $("#menu-toggle").setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenu();
});
function template(id) {
  return $(id).content.cloneNode(true);
}
function render() {
  app.replaceChildren();
  if (!currentUser) return authPage();
  closeMobileMenu();
  $("#main-nav").hidden = false;
  $("#menu-toggle").hidden = false;
  $("#account-tools").innerHTML = `<span>${escapeHtml(currentUser.displayName || currentUser.username)} (${escapeHtml(currentUser.role)})</span> <button id="logout">Log out</button>`;
  $("#logout").onclick = async () => { await fetch("/api/auth/logout", { method: "POST" }); currentUser = null; applyTheme(defaultTheme); render(); };
  $("#admin-nav").hidden = currentUser.role !== "admin";
  const page = location.hash.slice(1) || "home";
  if (page === "home") return homePage();
  if (page === "draft") return draftStart();
  if (page === "stats") return statsStart();
  if (page === "chase") return chaseStart();
  if (page === "profile") return profilePage();
  if (page === "themes" || page === "history") { location.hash = "profile"; profileTab = page; return profilePage(); }
  if (page === "admin" && currentUser.role === "admin") return adminPage();
}
function profileTabsMarkup() {
  return `<div class="profile-tabs"><button data-profile-tab="profile" class="${profileTab === "profile" ? "active" : ""}">Profile details</button><button data-profile-tab="themes" class="${profileTab === "themes" ? "active" : ""}">Themes</button><button data-profile-tab="history" class="${profileTab === "history" ? "active" : ""}">History</button></div>`;
}
function bindProfileTabs() {
  document.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.onclick = () => { profileTab = button.dataset.profileTab; profilePage(); };
  });
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]); }
function playerAvatarMarkup(name, size = "") {
  const safeName = String(name || "");
  const initials = safeName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  const imageUrl = `/api/player-image?v=5&name=${encodeURIComponent(safeName)}`;
  return `<span class="player-avatar ${size}" aria-hidden="true"><span>${escapeHtml(initials)}</span><img src="${imageUrl}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('loaded')" onerror="this.style.display='none'"></span>`;
}

function authPage() {
  closeMobileMenu();
  $("#main-nav").hidden = true;
  $("#menu-toggle").hidden = true;
  $("#account-tools").replaceChildren();
  $("#admin-nav").hidden = true;
  app.innerHTML = `<p class="eyebrow">TEAM GAME ACCOUNT</p><h1>Log in to continue</h1><p>History is saved to your account. The first account created on this installation becomes the admin.</p><section class="card"><div class="mode-grid"><button id="login-tab" class="active">Log in</button><button id="signup-tab">Create account</button></div><form id="auth-form"><label>Username<input name="username" autocomplete="username" minlength="3" maxlength="32" required></label><label>Password<input type="password" name="password" autocomplete="current-password" minlength="8" required></label><p id="auth-message" class="note" role="status"></p><button id="auth-submit">Log in</button></form></section>`;
  let signup = false;
  const form = $("#auth-form");
  const setMode = (value) => { signup = value; $("#auth-submit").textContent = signup ? "Create account" : "Log in"; $("#login-tab").classList.toggle("active", !signup); $("#signup-tab").classList.toggle("active", signup); $("input[type=password]").autocomplete = signup ? "new-password" : "current-password"; };
  $("#login-tab").onclick = () => setMode(false); $("#signup-tab").onclick = () => setMode(true);
  form.onsubmit = async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const response = await fetch(`/api/auth/${signup ? "signup" : "login"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); const result = await response.json(); if (!response.ok) { $("#auth-message").textContent = result.error; return; } currentUser = result.user; location.hash = "home"; profileTab = "profile"; try { await loadTheme(); } catch { applyTheme(defaultTheme); } render(); };
}
async function historyPage() {
  app.innerHTML = `${profileTabsMarkup()}<section class="screen-intro"><div><p class="eyebrow">YOUR RESULTS</p><h1>Game history</h1><p>Your completed games, newest first. Open a game to revisit teams, scores, and player results.</p></div><span class="screen-intro-icon" aria-hidden="true">🏆</span></section><div id="history-list">Loading history…</div>`;
  bindProfileTabs();
  const response = await fetch("/api/history");
  const { games = [] } = await response.json();
  const list = $("#history-list");
  if (!games.length) { list.innerHTML = '<section class="card">No games saved yet. Completed games will appear here.</section>'; return; }
  list.innerHTML = games.map((game) => {
    const data = game.data || {};
    const date = new Date(game.playedAt).toLocaleString();
    let details = "";
    if (game.type === "stats") {
      details = `<section class="history-section"><h3>Team totals · ${escapeHtml(data.criteria || "Stats")}</h3><div class="history-team-grid">${(data.teams || []).map((team) => `<article class="history-team"><h4>${escapeHtml(team.name)}</h4><p><strong>${escapeHtml(team.total)}</strong> total · ${escapeHtml(team.distance)} from target</p></article>`).join("")}</div><p class="history-winner">🏆 Winner: ${escapeHtml((data.winners || []).join(", ") || "—")}</p><h3>Player results</h3><ul class="history-player-list">${(data.players || []).map((player) => `<li><span class="player-identity">${playerAvatarMarkup(player.player, "small")}${escapeHtml(player.player)}</span><b>${escapeHtml(player.value)}</b><small>${escapeHtml(player.team || "")}</small></li>`).join("")}</ul></section>`;
    } else if (game.type === "chase") {
      const batting = data.batting || [];
      const bowling = data.bowling || [];
      const overs = `${Math.floor((data.balls || 0) / 6)}.${(data.balls || 0) % 6}`;
      const battingRows = batting.map((player) => `<tr><td><span class="player-identity">${playerAvatarMarkup(player.name, "tiny")}${escapeHtml(player.name)}${player.out ? " <small>(out)</small>" : ""}</span></td><td>${escapeHtml(player.runs ?? 0)}</td><td>${escapeHtml(player.balls ?? 0)}</td><td>${escapeHtml(player.fours ?? 0)}</td><td>${escapeHtml(player.sixes ?? 0)}</td><td>${player.balls ? (player.runs * 100 / player.balls).toFixed(1) : "—"}</td></tr>`).join("");
      const bowlingRows = bowling.map((player) => `<tr><td><span class="player-identity">${playerAvatarMarkup(player.name, "tiny")}${escapeHtml(player.name)}</span></td><td>${Math.floor((player.balls || 0) / 6)}.${(player.balls || 0) % 6}</td><td>${escapeHtml(player.runs ?? 0)}</td><td>${escapeHtml(player.wickets ?? 0)}</td><td>${player.balls ? (player.runs * 6 / player.balls).toFixed(1) : "—"}</td></tr>`).join("");
      details = `<section class="history-section chase-history-details"><h3 class="chase-history-fixture">${escapeHtml(data.userTeam || "Your team")} <span>vs</span> ${escapeHtml(data.opponentTeam || "Opponent")}</h3><p class="history-winner chase-history-result ${data.won ? "is-win" : "is-loss"}">${data.won ? "🏆 Won" : "🏏 Result"} · ${escapeHtml(data.result || "—")}</p><div class="chase-history-scoreline"><div><small>FINAL SCORE</small><b>${escapeHtml(data.score ?? 0)}<i>/${escapeHtml(data.wickets ?? 0)}</i></b><span>${escapeHtml(overs)} overs</span></div><div><small>TARGET</small><b>${escapeHtml(data.target ?? "—")}</b><span>${data.won ? "Chase completed" : "Target not reached"}</span></div></div><div class="history-team-grid chase-history-highlights"><article class="history-team"><small>TOP SCORER</small><h4 class="player-identity">${playerAvatarMarkup(data.topScorer?.name || "—", "small")}${escapeHtml(data.topScorer?.name || "—")}</h4><p><strong>${escapeHtml(data.topScorer?.runs ?? 0)}</strong> runs</p></article><article class="history-team"><small>BEST BOWLER</small><h4 class="player-identity">${playerAvatarMarkup(data.bestBowler?.name || "—", "small")}${escapeHtml(data.bestBowler?.name || "—")}</h4><p><strong>${escapeHtml(data.bestBowler?.wickets ?? 0)}/${escapeHtml(data.bestBowler?.runs ?? 0)}</strong> · wickets/runs</p></article></div><div class="chase-history-scorecards"><section class="chase-history-card"><h4>Batting scorecard</h4><div class="chase-history-table-wrap"><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${battingRows || '<tr><td colspan="6">No batting details saved.</td></tr>'}</tbody></table></div></section><section class="chase-history-card"><h4>Bowling figures</h4><div class="chase-history-table-wrap"><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>${bowlingRows || '<tr><td colspan="5">No bowling details saved.</td></tr>'}</tbody></table></div></section></div></section>`;
    } else {
      const roles = data.roles || [];
      const rosters = (game.participants || []).map((team) => `<article class="history-team"><h4>${escapeHtml(team)}</h4><ul>${roles.map((role) => `<li><span>${escapeHtml(role)}</span><b>${escapeHtml(data.picks?.[`${team}|${role}`] || "—")}</b></li>`).join("")}</ul>${data.totals?.[team] !== undefined ? `<p>${escapeHtml(data.totals[team])} points</p>` : ""}</article>`).join("");
      details = `<section class="history-section"><h3>Final result</h3>${data.winner ? `<p class="history-winner">🏆 Winner: ${escapeHtml(data.winner)}${data.winningPoints ? ` · ${escapeHtml(data.winningPoints)} points` : ""}</p>` : ""}<div class="history-team-grid">${rosters}</div></section>`;
    }
    return `<details class="card history-item ${game.type === "chase" ? "chase-history-item" : ""}"><summary><span><b>${game.type === "stats" ? "Stats Winner" : game.type === "chase" ? "Chase Master" : "Team Draft"}</b><small>${escapeHtml(date)}</small></span><span class="history-summary">${game.type === "stats" ? escapeHtml(data.criteria || "Player stats") : game.type === "chase" ? `${escapeHtml(data.score ?? "")} / ${escapeHtml(data.target ?? "")}` : `${(game.participants || []).length} participants`}</span></summary>${details}<button class="danger-button" data-delete-game="${escapeHtml(game.id)}">Delete game</button></details>`;
  }).join("");
  list.querySelectorAll("[data-delete-game]").forEach((button) => button.onclick = async () => {
    if (!confirm("Delete this game from your history?")) return;
    const result = await fetch(`/api/history/${encodeURIComponent(button.dataset.deleteGame)}`, { method: "DELETE" });
    if (result.ok) historyPage();
  });
}
async function profilePage() {
  app.innerHTML = `<section class="screen-intro"><div><p class="eyebrow">YOUR ACCOUNT</p><h1>Profile</h1><p>Manage your details, personalize the game, and revisit your results.</p></div><span class="screen-intro-icon" aria-hidden="true">👤</span></section><div class="profile-tabs"><button data-profile-tab="profile">Profile details</button><button data-profile-tab="themes">Themes</button><button data-profile-tab="history">History</button></div><div id="profile-content">Loading…</div>`;
  bindProfileTabs();
  if (profileTab === "themes") return themes();
  if (profileTab === "history") return historyPage();
  const response = await fetch("/api/profile");
  const { user } = await response.json();
  currentUser = user;
  const content = $("#profile-content");
  content.innerHTML = `<section class="card profile-card"><div class="profile-avatar">${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="Profile picture">` : `<span>${escapeHtml((user.displayName || user.username).slice(0, 1).toUpperCase())}</span>`}</div><form id="profile-form"><label>Profile picture<input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif"></label><p class="note">PNG, JPEG, WEBP, or GIF. Maximum 1 MB.</p><label>Name to display<input name="displayName" value="${escapeHtml(user.displayName || user.username)}" maxlength="60" required></label><label>Username used to log in<input name="username" value="${escapeHtml(user.username)}" minlength="3" maxlength="32" required></label><p id="profile-message" class="note" role="status"></p><button>Save profile</button></form></section><section class="card"><h2>Change password</h2><form id="password-form"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>New password<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label><p id="password-message" class="note" role="status"></p><button>Update password</button></form></section>`;
  $("#profile-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    let avatar = user.avatar || "";
    const file = form.elements.avatar.files[0];
    if (file) {
      if (file.size > 1024 * 1024) { $("#profile-message").textContent = "Image must be 1 MB or smaller."; return; }
      avatar = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    }
    const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: form.elements.displayName.value, username: form.elements.username.value, avatar }) });
    const result = await response.json();
    if (!response.ok) { $("#profile-message").textContent = result.error; return; }
    currentUser = result.user;
    $("#profile-message").textContent = "Profile saved.";
    render(); profileTab = "profile";
  };
  $("#password-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.elements.newPassword.value !== form.elements.confirmPassword.value) { $("#password-message").textContent = "New passwords do not match."; return; }
    const response = await fetch("/api/profile/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }) });
    const result = await response.json();
    $("#password-message").textContent = response.ok ? "Password updated." : result.error;
    if (response.ok) form.reset();
  };
}
async function adminPage() {
  app.innerHTML = '<section class="screen-intro"><div><p class="eyebrow">ADMIN CONSOLE</p><h1>Account management</h1><p>Manage registered accounts and keep the game space running smoothly.</p></div><span class="screen-intro-icon" aria-hidden="true">🛡️</span></section><div id="admin-list">Loading users…</div>';
  const response = await fetch("/api/admin/users"); if (!response.ok) { app.innerHTML = "<p>Admin access required.</p>"; return; }
  const { users } = await response.json();
  $("#admin-list").innerHTML = `<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${users.map((u) => `<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td><td>${u.blocked ? "Blocked" : "Active"}</td><td><button data-block-user="${escapeHtml(u.username)}" data-blocked="${!u.blocked}">${u.blocked ? "Unblock" : "Block"}</button> ${u.username === currentUser.username ? "" : `<button data-delete-user="${escapeHtml(u.username)}">Delete user</button>`}</td></tr>`).join("")}</tbody></table></div><p class="note">Game history is private to its account owner.</p>`;
  $("#admin-list").querySelectorAll("[data-block-user]").forEach((button) => button.onclick = async () => { await fetch(`/api/admin/users/${encodeURIComponent(button.dataset.blockUser)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ blocked: button.dataset.blocked === "true" }) }); adminPage(); });
  $("#admin-list").querySelectorAll("[data-delete-user]").forEach((button) => button.onclick = async () => { if (!confirm(`Delete ${button.dataset.deleteUser}?`)) return; const r = await fetch(`/api/admin/users/${encodeURIComponent(button.dataset.deleteUser)}`, { method: "DELETE" }); const result = await r.json(); if (!r.ok) alert(result.error); adminPage(); });
}
async function saveHistory(type, title, data, participants) {
  const response = await fetch("/api/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, title, data, participants }) });
  if (!response.ok) throw new Error("Could not save game history");
}

function homePage() {
  const displayName = currentUser.displayName || currentUser.username;
  app.innerHTML = `<section class="home-hero"><div class="home-hero-copy"><p class="eyebrow">YOUR CRICKET GAME NIGHT</p><h1>Ready to play, ${escapeHtml(displayName)}?</h1><p>Pick a game, gather your players, and see who takes the win.</p><div class="home-prompt"><span class="home-prompt-icon">🏏</span><span><b>Three ways to play</b><small>Draft a dream team, compare stats, or chase an IPL target ball by ball.</small></span></div></div><div class="home-hero-art" aria-hidden="true"><span class="hero-ball">🏏</span><span class="hero-stumps">▥</span><span class="hero-orbit"></span></div></section><section class="home-games"><div class="home-section-heading"><div><p class="eyebrow">CHOOSE YOUR GAME</p><h2>How do you want to play?</h2></div><span class="home-section-note">Tap a game to get started</span></div><div class="game-card-grid"><button class="game-launch-card draft-launch" data-launch-game="draft" aria-label="Open Team Draft"><span class="game-card-topline"><span class="game-card-icon">🧢</span><span class="game-card-tag">PICK · PLAN · PLAY</span></span><span class="game-card-title">Team Draft</span><span class="game-card-summary">Build a cricket team together, one pick at a time.</span><span class="game-card-details"><span>Choose six specialist roles or draft a full Playing XI. Take turns picking from your player list, then decide who built the winning team.</span><span class="game-card-meta"><b>2+ players</b><b>Shared picks</b><b>Six roles or XI</b></span></span><span class="game-card-action">Start a draft <span aria-hidden="true">↗</span></span></button><button class="game-launch-card stats-launch" data-launch-game="stats" aria-label="Open Stats Winner"><span class="game-card-topline"><span class="game-card-icon">📊</span><span class="game-card-tag">GUESS · COMPARE · WIN</span></span><span class="game-card-title">Stats Winner</span><span class="game-card-summary">Choose a target and see whose cricket stats come closest.</span><span class="game-card-details"><span>Pick international or IPL runs and wickets. Add players to each team, set your target, and let the career stats decide the winner.</span><span class="game-card-meta"><b>Intl & IPL</b><b>Runs & wickets</b><b>Play your target</b></span></span><span class="game-card-action">Play Stats Winner <span aria-hidden="true">↗</span></span></button><button class="game-launch-card chase-launch" data-launch-game="chase" aria-label="Open Chase Master"><span class="game-card-topline"><span class="game-card-icon">🏏</span><span class="game-card-tag">PICK · CHASE · WIN</span></span><span class="game-card-title">Chase Master</span><span class="game-card-summary">Choose two IPL squads and chase a live target.</span><span class="game-card-details"><span>Pick both Playing XIs, adjust your batting order, and chase a randomly set score with Safe and Aggressive shots.</span><span class="game-card-meta"><b>10 IPL teams</b><b>Live scorecard</b><b>Ball-by-ball play</b></span></span><span class="game-card-action">Start a chase <span aria-hidden="true">↗</span></span></button></div></section><section class="home-footer-card"><span>🏆</span><p><b>Keep the rivalry going.</b><small>Your completed games are saved in your Profile under History.</small></p><button data-page="profile">Go to Profile</button></section>`;
  document.querySelectorAll("[data-launch-game]").forEach((button) => button.onclick = () => show(button.dataset.launchGame));
  $("[data-page=profile]", app)?.addEventListener("click", () => { profileTab = "profile"; show("profile"); });
}

function draftStart() {
  app.append(template("#draft-template"));
  $("[data-page=home]", app).onclick = () => show("home");
  $("#draft-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      names = f
        .get("players")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (names.length < 2) return alert("Enter at least two names");
    startDraft(names, f.get("type")).catch((error) => alert(error.message));
  };
}
async function startDraft(names, type) {
  const roles =
    type === "xi"
      ? Array.from({ length: 11 }, (_, i) => `Playing XI #${i + 1}`)
      : [
          "Captain",
          "Open Bat",
          "Wicketkeeper",
          "Finish Bat",
          "Open Bowl",
          "Death Bowl",
        ];
  const pool = await fetch("/api/draft-players").then(async (response) => {
    if (!response.ok) throw new Error("The draft player list could not be loaded.");
    return response.json();
  });
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const state = {
    names,
    roles,
    type,
    picks: {},
    turn: 0,
    draws: shuffled.slice(0, names.length * roles.length),
    points: {},
  };
  draftGame(state);
}
function draftGame(s) {
  const total = s.names.length * s.roles.length;
  if (s.turn === total) return scoreDraft(s);
  const name = s.names[s.turn % s.names.length],
    player = s.draws[s.turn],
    used = Object.keys(s.picks)
      .filter((k) => k.startsWith(`${name}|`))
      .map((k) => k.split("|")[1]);
  app.innerHTML = `<button class="screen-back-link" data-return-home>← All games</button><div class="draft-progress"><span class="eyebrow">TEAM DRAFT</span><span>Pick ${s.turn + 1} of ${total}</span></div><div class="draft-progress-track"><span style="width:${Math.round((s.turn / total) * 100)}%"></span></div><section class="card draft-player"><div><h2>${escapeHtml(name)}, choose your role</h2><p class="note">Assigned roles remain disabled.</p></div><div class="banner player-banner">${playerAvatarMarkup(player, "featured")}<span>${escapeHtml(player)}</span></div></section>${teamTable(s)}<section class="card"><h2>Assign ${player}</h2><div class="role-grid">${s.roles.map((r) => `<button data-role="${r}" ${used.includes(r) ? "disabled" : ""}>${r}</button>`).join("")}</div></section>`;
  $("[data-return-home]").onclick = () => show("home");
  document.querySelectorAll("[data-role]").forEach(
    (b) =>
      (b.onclick = () => {
        s.picks[`${name}|${b.dataset.role}`] = player;
        s.turn++;
        draftGame(s);
      }),
  );
}
function teamTable(s) {
  return `<div class="table-wrap"><table><thead><tr><th scope="col">Slot</th>${s.names.map((name) => `<th scope="col">${escapeHtml(name)}</th>`).join("")}<th scope="col">Awarded to</th></tr></thead><tbody>${s.roles.map((role) => `<tr><th scope="row">${escapeHtml(role)}</th>${s.names.map((name) => { const player = s.picks[`${name}|${role}`]; return `<td>${player ? `<span class="player-identity">${playerAvatarMarkup(player, "draft")}${escapeHtml(player)}</span>` : "—"}</td>`; }).join("")}<td class="draft-awarded-to">${s.points[role] ? `<strong>${escapeHtml(s.points[role])}</strong>` : `<span class="note">—</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}
function scoreDraft(s) {
  if (s.type === "xi") {
    app.innerHTML = `${teamTable(s)}<section class="card"><h2>Which Playing XI wins?</h2><p>One overall point decides this draft.</p><div class="role-grid">${s.names.map((n) => `<button data-win="${n}">${playerAvatarMarkup(n)}${escapeHtml(n)}</button>`).join("")}</div></section>`;
    document
      .querySelectorAll("[data-win]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            const winner = b.dataset.win;
            app.innerHTML += `<p class="winner">🏆 ${escapeHtml(winner)} wins with 1 overall point.</p>`;
            await saveHistory("draft", "Team Draft · Playing XI", { type: s.type, roles: s.roles, picks: s.picks, winner, points: 1 }, s.names);
          }),
      );
    return;
  }
  const pending = s.roles.find((r) => !s.points[r]);
  if (!pending) {
    const totals = Object.values(s.points).reduce(
      (a, n) => ((a[n] = (a[n] || 0) + 1), a),
      {},
    );
    const best = Math.max(...Object.values(totals)),
      winner = Object.keys(totals)
        .filter((n) => totals[n] === best)
        .join(", ");
    app.innerHTML = `${teamTable(s)}<p class="winner">🏆 ${winner} wins with ${best} points.</p>`;
    saveHistory("draft", "Team Draft", { type: s.type, roles: s.roles, picks: s.picks, points: s.points, totals, winner, winningPoints: best }, s.names).catch((error) => alert(error.message));
    return;
  }
  app.innerHTML = `${teamTable(s)}<section class="card"><h2>Who wins ${pending}?</h2><div class="role-grid">${s.names.map((n) => `<button data-win="${n}"><span class="draft-winner-player">${playerAvatarMarkup(s.picks[`${n}|${pending}`], "draft")}<span>${escapeHtml(s.picks[`${n}|${pending}`])}</span></span><small>Team: ${escapeHtml(n)}</small></button>`).join("")}</div></section>`;
  document.querySelectorAll("[data-win]").forEach(
    (b) =>
      (b.onclick = () => {
        s.points[pending] = b.dataset.win;
        scoreDraft(s);
      }),
  );
}
function statsStart(initial = {}) {
  app.append(template("#stats-template"));
  $("[data-page=home]", app).onclick = () => show("home");
  const form = $("#stats-form");
  const teamCountInput = form.querySelector('[name="players"]');
  const teamNameFields = $("#stats-team-names", form);
  if (initial.teamNames) teamCountInput.value = initial.teamNames.length;
  if (initial.criteria) form.querySelector('[name="criteria"]').value = initial.criteria;
  if (initial.limit !== undefined) form.querySelector('[name="limit"]').value = initial.limit;
  if (initial.slots !== undefined) form.querySelector('[name="slots"]').value = initial.slots;
  const preserveValues = (container, selector) => [...container.querySelectorAll(selector)].map((input) => input.value);
  const renderTeamNames = () => {
    const count = Math.min(12, Math.max(2, Number(teamCountInput.value) || 2));
    const previous = preserveValues(teamNameFields, '[name="teamNames"]');
    teamNameFields.innerHTML = `<p class="team-name-fields-title">Name each team</p>${Array.from({ length: count }, (_, index) => `<label>Team ${index + 1}<input name="teamNames" value="${escapeHtml(previous[index] || initial.teamNames?.[index] || `Team ${index + 1}`)}" maxlength="60" autocomplete="off" required></label>`).join("")}`;
  };
  renderTeamNames();
  teamCountInput.addEventListener("input", renderTeamNames);
  form.onsubmit = (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const teamNames = values.getAll("teamNames").map((name, index) => name.trim() || `Team ${index + 1}`);
    const slots = +values.get("slots");
    const criteria = values.get("criteria");
    const limit = +values.get("limit");
    renderStatsPlayerSetup(teamNames, slots, criteria, limit);
  };
}
function renderStatsPlayerSetup(teamNames, slots, criteria, limit) {
  const app = document.querySelector("#app");
  const names = teamNames;
  app.innerHTML = `<button class="screen-back-link" id="stats-back">← Back to team setup</button><section class="screen-intro stats-screen-intro"><div><p class="eyebrow">STATS WINNER · STEP 2</p><h1>Choose your players</h1><p>Enter one player for every slot in each team. Names will be locked once the game begins.</p></div><span class="screen-intro-icon" aria-hidden="true">🏏</span></section><section class="card setup-card"><div class="setup-card-heading"><span class="setup-step">02</span><div><h2>Enter player names</h2><p>${escapeHtml(criteria)} · Target ${limit} · ${slots} slots per team</p></div></div><form id="stats-player-form"><div class="stats-player-team-grid">${names.map((name) => `<section class="stats-player-team"><h3>${escapeHtml(name)}</h3>${Array.from({ length: slots }, (_, slot) => `<label>Slot ${slot + 1}<input name="initialPlayers" placeholder="Cricketer name" maxlength="80" autocomplete="off" required></label>`).join("")}</section>`).join("")}</div><div class="setup-actions"><button type="button" class="secondary-button" id="stats-back-button">Back</button><button type="submit">Start Stats Winner</button></div></form></section>`;
  const goBack = () => statsStart({ teamNames: names, slots, criteria, limit });
  $("#stats-back").onclick = goBack;
  $("#stats-back-button").onclick = goBack;
  $("#stats-player-form").onsubmit = (event) => {
    event.preventDefault();
    const playerNames = new FormData(event.currentTarget).getAll("initialPlayers").map((name) => name.trim());
    statsGrid(names, playerNames, slots, criteria, limit);
  };
}
function statsGrid(teamNames, playerNames, slots, criteria, limit) {
  const names = teamNames;
  app.innerHTML = `<button class="screen-back-link" data-return-home>← All games</button><section class="screen-intro stats-screen-intro"><div><p class="eyebrow">STATS WINNER · ${escapeHtml(criteria.toUpperCase())}</p><h1>Player line-up locked</h1><p>Target: <b>${limit}</b>. These are the players selected during setup.</p></div><span class="screen-intro-icon" aria-hidden="true">🏆</span></section><div class="table-wrap"><table><thead><tr><th scope="col">Slot</th>${names.map((name) => `<th scope="col">${escapeHtml(name)}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: slots }, (_, row) => `<tr><th scope="row">${row + 1}</th>${names.map((_, team) => `<td><span class="player-identity">${playerNames[team * slots + row] ? playerAvatarMarkup(playerNames[team * slots + row], "small") : ""}${escapeHtml(playerNames[team * slots + row] || "—")}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div><p><button id="calculate">Look up stats & calculate winner</button></p><section id="stats-result" class="card" aria-live="polite"><p class="note">Unavailable stats are not treated as zero. Correct any unavailable lookup and recalculate.</p></section>`;
  $("[data-return-home]").onclick = () => show("home");
  $("#calculate").onclick = async () => {
    const fields = playerNames.map((player, index) => ({ value: player, dataset: { team: String(Math.floor(index / slots)) } }));
    const result = $("#stats-result");
    const calculateButton = $("#calculate");
    const playerCount = fields.filter((input) => input.value.trim()).length;
    calculateButton.disabled = true;
    result.setAttribute("aria-busy", "true");
    result.innerHTML = `<div class="lookup-progress" role="status"><span class="animated-loader" aria-hidden="true"></span><span><b>Looking up cricket stats</b><small>Fetching ESPNcricinfo data for ${playerCount} ${playerCount === 1 ? "player" : "players"}…</small></span></div>`;
    const lookupPromise = Promise.all(
      fields.map(async (input) => {
        const player = input.value.trim();
        if (!player)
          return {
            team: +input.dataset.team,
            value: null,
            player: "—",
            source: "Empty field",
          };
        try {
          return {
            team: +input.dataset.team,
            ...(await fetch(
              `/api/stat?player=${encodeURIComponent(player)}&criteria=${encodeURIComponent(criteria)}`,
            ).then((response) => response.json())),
          };
        } catch {
          return {
            team: +input.dataset.team,
            value: null,
            player,
            source: "Lookup failed",
          };
        }
      }),
    );
    // Keep the loader visible long enough to be noticed, even when a request fails instantly.
    const [data] = await Promise.all([
      lookupPromise,
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
    result.setAttribute("aria-busy", "false");
    calculateButton.disabled = false;
    const unavailable = data.filter((item) => item.value === null);
    if (unavailable.length) {
      result.innerHTML = `<h2>Some stats could not be retrieved</h2><p class="note">No winner has been calculated because unavailable values must not count as zero. Check the names below and retry.</p><ul>${unavailable.map((item) => `<li><b>${escapeHtml(item.player)}</b>: ${escapeHtml(item.source)}</li>`).join("")}</ul><button id="retry">Retry Cricinfo lookup</button>`;
      $("#retry").onclick = () => $("#calculate").click();
      return;
    }
    const totals = names.map((_, index) =>
      data.filter((item) => item.team === index).reduce((sum, item) => sum + item.value, 0),
    );
    const differences = totals.map((total) => Math.abs(limit - total));
    const best = Math.min(...differences);
    const winners = names.filter((_, index) => differences[index] === best);
    result.innerHTML = `<h2>Results</h2><div class="table-wrap"><table><thead><tr><th>Team</th><th>Total ${escapeHtml(criteria)}</th><th>Distance from limit</th></tr></thead><tbody>${names.map((name, index) => `<tr><td>${escapeHtml(name)}</td><td class="stat-value">${totals[index]}</td><td>${differences[index]}</td></tr>`).join("")}</tbody></table></div><p class="winner">🏆 Winner: ${escapeHtml(winners.join(", "))} — closest to ${limit}</p><h3>ESPNcricinfo lookup details</h3><ul>${data.map((item) => `<li><span class="player-identity">${playerAvatarMarkup(item.player, "small")}${escapeHtml(item.player)}</span>: <b>${item.value}</b> <small>(${escapeHtml(item.source)})</small></li>`).join("")}</ul>`;
    saveHistory("stats", `Stats Winner · ${criteria}`, { criteria, limit, teams: names.map((name, index) => ({ name, total: totals[index], distance: differences[index] })), winners, players: data.map(({ team, player, value, source }) => ({ team: names[team], player, value, source })) }, names).catch((error) => alert(error.message));
  };
}

async function chaseStart() {
  app.innerHTML = `<section class="screen-intro"><div><p class="eyebrow">CHASE MASTER · IPL</p><h1>Pick your rivalry</h1><p>Choose the team you’ll lead and the opponent you’ll chase down.</p></div><span class="screen-intro-icon" aria-hidden="true">🏏</span></section><section class="card chase-loading"><span class="chase-loader" aria-hidden="true"></span><span>Loading the latest IPL squads…</span></section>`;
  try {
    const response = await fetch("/api/chase-squads");
    if (!response.ok) throw new Error("IPL squads could not be loaded.");
    const { teams } = await response.json();
    renderChaseTeamSetup(teams);
  } catch (error) {
    app.innerHTML = `<section class="card"><h2>Squads unavailable</h2><p>${escapeHtml(error.message)}</p><button data-page="home">Back home</button></section>`;
    $("[data-page=home]", app).onclick = () => show("home");
  }
}
function renderChaseTeamSetup(teams, selectedUser = teams[0]?.name, selectedOpponent = teams[1]?.name) {
  app.innerHTML = `<button class="screen-back-link" data-page="home">← All games</button><section class="screen-intro"><div><p class="eyebrow">CHASE MASTER · STEP 1</p><h1>Choose your teams</h1><p>Your opponent’s bowlers will come from the opponent Playing XI.</p></div><span class="screen-intro-icon" aria-hidden="true">🏟️</span></section><section class="card setup-card"><form id="chase-team-form"><div class="chase-team-select-grid"><label>Your IPL team<select name="userTeam" required>${teams.map((team) => `<option value="${escapeHtml(team.name)}" ${team.name === selectedUser ? "selected" : ""}>${escapeHtml(team.name)}</option>`).join("")}</select></label><label>Opponent team<select name="opponentTeam" required>${teams.map((team) => `<option value="${escapeHtml(team.name)}" ${team.name === selectedOpponent ? "selected" : ""}>${escapeHtml(team.name)}</option>`).join("")}</select></label></div><p id="chase-team-error" class="note" role="status"></p><button type="submit">Choose Playing XIs</button></form></section>`;
  $("[data-page=home]", app).onclick = () => show("home");
  $("#chase-team-form").onsubmit = (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const userName = values.get("userTeam");
    const opponentName = values.get("opponentTeam");
    if (userName === opponentName) { $("#chase-team-error").textContent = "Choose two different teams."; return; }
    const userTeam = teams.find((team) => team.name === userName);
    const opponentTeam = teams.find((team) => team.name === opponentName);
    renderChaseLineup({ userTeam, opponentTeam, allTeams: teams, userPicks: new Set(), opponentPicks: new Set() });
  };
}
function renderChaseLineup(state) {
  const teamPicker = (team, key, title) => `<section class="chase-pick-team"><div class="chase-pick-heading"><h2>${escapeHtml(title)}</h2><span id="${key}-count">0 / 11 selected</span></div><div class="chase-squad-list" data-squad="${key}">${team.players.map((player, index) => `<button type="button" class="chase-player-pick" data-pick-team="${key}" data-pick-index="${index}" aria-pressed="false"><span class="chase-picker-identity">${playerAvatarMarkup(player.name, "squad")}<span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.role)}</small></span></span><span class="pick-check" aria-hidden="true">+</span></button>`).join("")}</div></section>`;
  app.innerHTML = `<button class="screen-back-link" id="chase-team-back">← Team selection</button><section class="screen-intro"><div><p class="eyebrow">CHASE MASTER · STEP 2</p><h1>Select both Playing XIs</h1><p>Pick 11 players per team. Your opponent must have at least five bowlers or all-rounders.</p></div><span class="screen-intro-icon" aria-hidden="true">👥</span></section><div class="chase-pick-grid">${teamPicker(state.userTeam, "user", "Your XI · " + state.userTeam.name)}${teamPicker(state.opponentTeam, "opponent", "Opponent XI · " + state.opponentTeam.name)}</div><section class="card chase-lineup-footer"><p id="chase-lineup-error" class="note" role="status">Select 11 players for each side.</p><button id="chase-start-match" disabled>Set batting order & start chase</button></section>`;
  $("#chase-team-back").onclick = () => renderChaseTeamSetup(state.allTeams, state.userTeam.name, state.opponentTeam.name);
  const refresh = () => {
    const userCount = state.userPicks.size;
    const opponentCount = state.opponentPicks.size;
    $("#user-count").textContent = `${userCount} / 11 selected`;
    $("#opponent-count").textContent = `${opponentCount} / 11 selected`;
    const eligible = [...state.opponentPicks].filter((index) => ["bowler", "allrounder"].includes(state.opponentTeam.players[index].role)).length;
    const button = $("#chase-start-match");
    button.disabled = userCount !== 11 || opponentCount !== 11 || eligible < 5;
    $("#chase-lineup-error").textContent = eligible < 5 && opponentCount === 11 ? "Opponent XI needs at least five bowlers or all-rounders." : `Your XI: ${userCount}/11 · Opponent XI: ${opponentCount}/11 · Opponent bowling options: ${eligible}`;
  };
  $(".chase-pick-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick-team]");
    if (!button) return;
    const key = button.dataset.pickTeam;
    const picks = key === "user" ? state.userPicks : state.opponentPicks;
    const index = Number(button.dataset.pickIndex);
    if (picks.has(index)) picks.delete(index);
    else if (picks.size < 11) picks.add(index);
    else return;
    button.classList.toggle("selected", picks.has(index));
    button.setAttribute("aria-pressed", String(picks.has(index)));
    button.querySelector(".pick-check").textContent = picks.has(index) ? "✓" : "+";
    refresh();
  });
  $("#chase-start-match").onclick = () => {
    const userXI = [...state.userPicks].map((index) => state.userTeam.players[index]);
    const opponentXI = [...state.opponentPicks].map((index) => state.opponentTeam.players[index]);
    const target = 160 + Math.floor(Math.random() * 91);
    const bowlers = opponentXI.filter((player) => ["bowler", "allrounder"].includes(player.role)).map((player) => ({ name: player.name, role: player.role, balls: 0, runs: 0, wickets: 0 }));
    const game = { userTeam: state.userTeam.name, opponentTeam: state.opponentTeam.name, target, battingOrder: userXI.map((player) => player.name), batters: userXI.map((player) => ({ name: player.name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false })), bowlers, balls: 0, runs: 0, wickets: 0, striker: userXI[0].name, nonStriker: userXI[1].name, nextBatter: 2, partnership: 0, currentBowler: null, lastBowler: null, lastOutcome: "—", overOrder: 0, finished: false };
    advanceChaseBowler(game);
    renderChaseMatch(game);
  };
  refresh();
}
function advanceChaseBowler(game) {
  const available = game.bowlers.filter((bowler) => bowler.balls < 24 && bowler.name !== game.lastBowler);
  const choices = available.length ? available : game.bowlers.filter((bowler) => bowler.balls < 24);
  choices.sort((a, b) => a.balls - b.balls || game.bowlers.indexOf(a) - game.bowlers.indexOf(b));
  game.currentBowler = choices[0]?.name || null;
  game.overOrder += 1;
}
function chaseCurrentOver(game) { return `${Math.floor(game.balls / 6)}.${game.balls % 6}`; }
function chaseCrr(game) { return game.balls ? game.runs * 6 / game.balls : 0; }
function chaseRrr(game) { const ballsLeft = Math.max(0, 120 - game.balls); return ballsLeft ? Math.max(0, game.target - game.runs) * 6 / ballsLeft : 0; }
function chaseWinProbability(game) {
  if (game.runs >= game.target) return 100;
  if (game.wickets >= 10 || game.balls >= 120) return 0;
  const progress = game.balls / 120;
  const paceMargin = game.runs / game.target - progress;
  const logit = 7 * paceMargin - game.wickets * 0.2 * progress + 0.25 * progress;
  return Math.round(100 / (1 + Math.exp(-logit)));
}
function renderChaseMatch(game) {
  const striker = game.batters.find((player) => player.name === game.striker);
  const nonStriker = game.batters.find((player) => player.name === game.nonStriker);
  const currentBowler = game.bowlers.find((bowler) => bowler.name === game.currentBowler);
  const probability = chaseWinProbability(game);
  const strikerButtons = game.battingOrder.map((name) => {
    const active = name === game.striker || name === game.nonStriker;
    return `<button class="chase-striker-choice ${name === game.striker ? "active" : ""}" data-striker="${escapeHtml(name)}" ${active ? "" : "disabled"}>${playerAvatarMarkup(name, "striker")}<span>${escapeHtml(name)}${name === game.striker ? " · STRIKER" : name === game.nonStriker ? " · NON-STRIKER" : ""}</span></button>`;
  }).join("");
  app.innerHTML = `<section class="screen-intro chase-match-intro"><div><p class="eyebrow">CHASE MASTER · LIVE INNINGS</p><h1>${escapeHtml(game.userTeam)} vs ${escapeHtml(game.opponentTeam)}</h1><p>Target ${game.target} · 20 overs · Choose a shot for every ball.</p></div><span class="screen-intro-icon" aria-hidden="true">🏏</span></section><div class="chase-layout"><section class="chase-score-column"><article class="card chase-score-panel"><div class="chase-metrics"><div><small>CRR</small><b>${chaseCrr(game).toFixed(2)}</b></div><div class="target-metric"><small>TARGET</small><b>${game.target}</b></div><div><small>RRR</small><b>${game.balls >= 120 ? "—" : chaseRrr(game).toFixed(2)}</b></div></div><div class="chase-win-prob"><div><small>WIN PROBABILITY</small><b>${probability}%</b></div><div class="chase-prob-track"><span style="width:${probability}%"></span></div></div><div class="chase-big-score"><strong>${game.runs}<i>/</i><em>${game.wickets}</em></strong><span class="chase-ball-badge">${escapeHtml(game.lastOutcome)}</span><small>OVERS ${chaseCurrentOver(game)}</small></div><div class="chase-quick"><div class="chase-quick-title"><small>QUICK MATCH</small><b>${escapeHtml(game.userTeam)} vs ${escapeHtml(game.opponentTeam)}</b></div><div class="chase-mini-head"><span></span><span>R</span><span>B</span><span>4</span><span>6</span><span>SR</span></div>${[striker, nonStriker].map((player) => `<div class="chase-mini-row"><b class="player-identity">${playerAvatarMarkup(player.name, "tiny")}${escapeHtml(player.name)}${player.name === game.striker ? " *" : ""}</b><span>${player.runs}</span><span>${player.balls}</span><span>${player.fours}</span><span>${player.sixes}</span><span>${player.balls ? (player.runs * 100 / player.balls).toFixed(0) : "-"}</span></div>`).join("")}<div class="chase-mini-head chase-bowling-head"><span>Bowler</span><span>O</span><span>R</span><span>W</span><span></span><span>ECO</span></div><div class="chase-mini-row"><b class="player-identity">${currentBowler ? playerAvatarMarkup(currentBowler.name, "tiny") : ""}${escapeHtml(currentBowler?.name || "—")}</b><span>${currentBowler ? `${Math.floor(currentBowler.balls / 6)}.${currentBowler.balls % 6}` : "0.0"}</span><span>${currentBowler?.runs || 0}</span><span>${currentBowler?.wickets || 0}</span><span></span><span>${currentBowler?.balls ? (currentBowler.runs * 6 / currentBowler.balls).toFixed(1) : "-"}</span></div><p class="chase-partnership">Partnership: <b>${game.partnership}</b> runs</p></div><div class="chase-shot-controls"><button class="safe-shot" data-shot="safe">🛡 Safe</button><button class="aggressive-shot" data-shot="aggressive">⚡ Aggressive</button></div><p class="chase-shot-note">Safe: 0, 1, 2, 3 runs · Aggressive: 0, 3, 4, 6, or wicket</p><div class="chase-striker-area"><small>SELECT STRIKER · PLAYING XI</small><div class="chase-striker-grid">${strikerButtons}</div></div></article><article class="card chase-order-card"><div class="chase-section-title"><div><small>BATTING ORDER</small><h2>Your Playing XI</h2></div><span>${game.balls === 0 ? "Drag cards to arrange · use ↑/↓ keys" : "Batting order locked"}</span></div><ol class="chase-batting-order" aria-label="Batting order">${game.battingOrder.map((name, index) => { const batter = game.batters.find((player) => player.name === name); return `<li class="chase-batter-card ${name === game.striker ? "on-strike" : ""} ${batter?.out ? "dismissed" : ""}" draggable="${game.balls === 0}" tabindex="${game.balls === 0 ? "0" : "-1"}" role="listitem" data-batting-index="${index}" aria-label="Position ${index + 1}: ${escapeHtml(name)}${name === game.striker ? ", striker" : name === game.nonStriker ? ", non-striker" : ""}. ${game.balls === 0 ? "Use arrow keys to reorder." : "Batting order locked."}"><span class="chase-batter-position">${String(index + 1).padStart(2, "0")}</span>${playerAvatarMarkup(name, "small")}<span class="chase-batter-name">${escapeHtml(name)}<small>${name === game.striker ? "Striker" : name === game.nonStriker ? "Non-striker" : batter?.out ? "Out" : "Yet to bat"}</small></span><span class="chase-drag-grip" aria-hidden="true" title="Drag to reorder">⠿</span></li>`; }).join("")}</ol></article></section><section class="chase-scorecards"><article class="card chase-scorecard"><div class="chase-section-title"><div><small>INNINGS SCORECARD</small><h2>${escapeHtml(game.userTeam)} batting</h2></div><b>${game.runs}/${game.wickets}</b></div><div class="chase-table-wrap"><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4</th><th>6</th><th>SR</th></tr></thead><tbody>${game.battingOrder.map((name) => { const player = game.batters.find((item) => item.name === name); return `<tr class="${name === game.striker ? "on-strike" : ""}"><td><span class="player-identity">${playerAvatarMarkup(name, "tiny")}${escapeHtml(name)}${name === game.striker ? " *" : ""}${player.out ? " (out)" : ""}</span></td><td>${player.runs}</td><td>${player.balls}</td><td>${player.fours}</td><td>${player.sixes}</td><td>${player.balls ? (player.runs * 100 / player.balls).toFixed(1) : "-"}</td></tr>`; }).join("")}</tbody></table></div></article><article class="card chase-scorecard"><div class="chase-section-title"><div><small>OPPONENT BOWLING</small><h2>${escapeHtml(game.opponentTeam)}</h2></div><span>Bowler rotation is automatic</span></div><div class="chase-table-wrap"><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>ECO</th></tr></thead><tbody>${game.bowlers.map((bowler) => `<tr class="${bowler.name === game.currentBowler ? "current-bowler" : ""}"><td><span class="player-identity">${playerAvatarMarkup(bowler.name, "tiny")}${escapeHtml(bowler.name)}</span></td><td>${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}</td><td>${bowler.runs}</td><td>${bowler.wickets}</td><td>${bowler.balls ? (bowler.runs * 6 / bowler.balls).toFixed(1) : "-"}</td></tr>`).join("")}</tbody></table></div></article></section></div>`;
  document.querySelectorAll("[data-shot]").forEach((button) => button.onclick = () => playChaseBall(game, button.dataset.shot));
  document.querySelectorAll("[data-striker]").forEach((button) => button.onclick = () => { if (button.dataset.striker !== game.striker) [game.striker, game.nonStriker] = [game.nonStriker, game.striker]; renderChaseMatch(game); });
  const battingList = $(".chase-batting-order");
  const reorderBatters = (from, to) => {
    if (game.balls > 0 || from === to || from < 0 || to < 0 || from >= game.battingOrder.length || to >= game.battingOrder.length) return;
    const [player] = game.battingOrder.splice(from, 1);
    game.battingOrder.splice(to, 0, player);
    game.striker = game.battingOrder[0];
    game.nonStriker = game.battingOrder[1];
    renderChaseMatch(game);
    document.querySelector(`[data-batting-index="${to}"]`)?.focus();
  };
  let draggedBatter = null;
  battingList.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-batting-index]");
    if (!card || game.balls > 0) { event.preventDefault(); return; }
    draggedBatter = Number(card.dataset.battingIndex);
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(draggedBatter));
  });
  battingList.addEventListener("dragend", () => battingList.querySelectorAll(".dragging").forEach((card) => card.classList.remove("dragging")));
  battingList.addEventListener("dragover", (event) => { if (event.target.closest("[data-batting-index]")) event.preventDefault(); });
  battingList.addEventListener("drop", (event) => {
    const target = event.target.closest("[data-batting-index]");
    if (!target || draggedBatter === null) return;
    event.preventDefault();
    reorderBatters(draggedBatter, Number(target.dataset.battingIndex));
    draggedBatter = null;
  });
  battingList.addEventListener("keydown", (event) => {
    if (!game.balls && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const from = Number(event.target.closest("[data-batting-index]")?.dataset.battingIndex);
      const to = from + (event.key === "ArrowUp" ? -1 : 1);
      if (to >= 0 && to < game.battingOrder.length) reorderBatters(from, to);
    }
  });
  let touchDrag = null;
  battingList.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || game.balls > 0) return;
    const handle = event.target.closest(".chase-drag-grip");
    const card = handle?.closest("[data-batting-index]");
    if (!card) return;
    touchDrag = { pointerId: event.pointerId, from: Number(card.dataset.battingIndex), to: Number(card.dataset.battingIndex), card };
    card.classList.add("dragging");
    handle.setPointerCapture(event.pointerId);
  });
  battingList.addEventListener("pointermove", (event) => {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-batting-index]");
    if (target) touchDrag.to = Number(target.dataset.battingIndex);
  });
  const finishTouchDrag = (event) => {
    if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
    const { from, to, card } = touchDrag;
    card.classList.remove("dragging");
    touchDrag = null;
    reorderBatters(from, to);
  };
  battingList.addEventListener("pointerup", finishTouchDrag);
  battingList.addEventListener("pointercancel", finishTouchDrag);
}
function playChaseBall(game, shot) {
  if (game.finished) return;
  const safeRoll = Math.random();
  const outcome = shot === "safe"
    ? safeRoll < 0.4 ? 0 : safeRoll < 0.8 ? 1 : safeRoll < 0.97 ? 2 : 3
    : [0, 3, 4, 6, "W"][Math.floor(Math.random() * 5)];
  game.lastOutcome = outcome;
  const batter = game.batters.find((player) => player.name === game.striker);
  const bowler = game.bowlers.find((player) => player.name === game.currentBowler);
  batter.balls += 1;
  bowler.balls += 1;
  game.balls += 1;
  if (outcome === "W") {
    game.wickets += 1;
    batter.out = true;
    bowler.wickets += 1;
    game.partnership = 0;
    if (game.wickets < 10 && game.nextBatter < game.battingOrder.length) {
      const incoming = game.battingOrder[game.nextBatter++];
      game.striker = incoming;
    }
  } else {
    batter.runs += outcome;
    game.runs += outcome;
    game.partnership += outcome;
    bowler.runs += outcome;
    if (outcome === 4) batter.fours += 1;
    if (outcome === 6) batter.sixes += 1;
    if (outcome % 2 === 1) [game.striker, game.nonStriker] = [game.nonStriker, game.striker];
  }
  const overComplete = game.balls % 6 === 0;
  if (overComplete) {
    [game.striker, game.nonStriker] = [game.nonStriker, game.striker];
    game.lastBowler = game.currentBowler;
    if (game.balls < 120) advanceChaseBowler(game);
  }
  if (game.runs >= game.target || game.wickets >= 10 || game.balls >= 120) {
    game.finished = true;
    finishChase(game);
    return;
  }
  renderChaseMatch(game);
}
function finishChase(game) {
  const won = game.runs >= game.target;
  const remainingWickets = 10 - game.wickets;
  const margin = won ? `${remainingWickets} wicket${remainingWickets === 1 ? "" : "s"}` : `${game.target - game.runs} run${game.target - game.runs === 1 ? "" : "s"}`;
  const topScorer = [...game.batters].sort((a, b) => b.runs - a.runs || b.balls - a.balls)[0];
  const bestBowler = [...game.bowlers].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
  const result = won ? `${game.userTeam} won by ${margin}` : `${game.opponentTeam} won by ${margin}`;
  const data = { userTeam: game.userTeam, opponentTeam: game.opponentTeam, target: game.target, score: game.runs, wickets: game.wickets, balls: game.balls, won, result, topScorer: { name: topScorer?.name || "—", runs: topScorer?.runs || 0 }, bestBowler: { name: bestBowler?.name || "—", wickets: bestBowler?.wickets || 0, runs: bestBowler?.runs || 0 }, batting: game.batters, bowling: game.bowlers };
  app.innerHTML = `<button class="screen-back-link" data-page="home">← Home</button><section class="screen-intro"><div><p class="eyebrow">CHASE MASTER · FINAL RESULT</p><h1>${won ? "Chase complete!" : "Innings complete"}</h1><p>${escapeHtml(result)} · Final score ${game.runs}/${game.wickets} in ${chaseCurrentOver(game)} overs against ${game.target}.</p></div><span class="screen-intro-icon" aria-hidden="true">${won ? "🏆" : "🏏"}</span></section><section class="card chase-result-card"><p class="chase-result-kicker">${won ? "VICTORY" : "MATCH RESULT"}</p><h2>${escapeHtml(result)}</h2><div class="chase-result-highlights"><article><small>TOP SCORER</small><b class="player-identity">${playerAvatarMarkup(topScorer?.name || "—", "small")}${escapeHtml(topScorer?.name || "—")}</b><strong>${topScorer?.runs || 0}</strong><span>${topScorer?.balls || 0} balls · SR ${topScorer?.balls ? (topScorer.runs * 100 / topScorer.balls).toFixed(1) : "—"}</span></article><article><small>BEST BOWLER</small><b class="player-identity">${playerAvatarMarkup(bestBowler?.name || "—", "small")}${escapeHtml(bestBowler?.name || "—")}</b><strong>${bestBowler?.wickets || 0}/${bestBowler?.runs || 0}</strong><span>${Math.floor((bestBowler?.balls || 0) / 6)}.${(bestBowler?.balls || 0) % 6} overs · Econ ${bestBowler?.balls ? (bestBowler.runs * 6 / bestBowler.balls).toFixed(1) : "—"}</span></article></div><p class="chase-result-score">${game.runs}/${game.wickets} <small>· Target ${game.target}</small></p><button data-page="home">Exit to Home</button></section><section class="chase-final-cards"><article class="card"><h2>Batting scorecard</h2><div class="chase-table-wrap"><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4</th><th>6</th><th>SR</th></tr></thead><tbody>${game.battingOrder.map((name) => { const p = game.batters.find((player) => player.name === name); return `<tr><td><span class="player-identity">${playerAvatarMarkup(name, "tiny")}${escapeHtml(name)}${p.out ? " (out)" : ""}</span></td><td>${p.runs}</td><td>${p.balls}</td><td>${p.fours}</td><td>${p.sixes}</td><td>${p.balls ? (p.runs * 100 / p.balls).toFixed(1) : "-"}</td></tr>`; }).join("")}</tbody></table></div></article><article class="card"><h2>Bowling figures</h2><div class="chase-table-wrap"><table><thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>ECO</th></tr></thead><tbody>${game.bowlers.map((p) => `<tr><td><span class="player-identity">${playerAvatarMarkup(p.name, "tiny")}${escapeHtml(p.name)}</span></td><td>${Math.floor(p.balls / 6)}.${p.balls % 6}</td><td>${p.runs}</td><td>${p.wickets}</td><td>${p.balls ? (p.runs * 6 / p.balls).toFixed(1) : "-"}</td></tr>`).join("")}</tbody></table></div></article></section>`;
  app.querySelectorAll('[data-page="home"]').forEach((button) => {
    button.onclick = () => show("home");
  });
  saveHistory("chase", "Chase Master", data, [game.userTeam, game.opponentTeam]).catch((error) => console.error(error));
}

const themePresets = {
  light: [
    [
      "Daylight",
      {
        bg: "#f6f8fb",
        surface: "#ffffff",
        text: "#17212b",
        accent: "#0ead69",
        accent2: "#087c4c",
      },
    ],
    [
      "Paper",
      {
        bg: "#f7f3e9",
        surface: "#fffdf7",
        text: "#2a241c",
        accent: "#c67a2a",
        accent2: "#8d5218",
      },
    ],
    [
      "Sky",
      {
        bg: "#edf7ff",
        surface: "#ffffff",
        text: "#17334a",
        accent: "#2876d1",
        accent2: "#18569e",
      },
    ],
    [
      "Mint",
      {
        bg: "#effaf5",
        surface: "#ffffff",
        text: "#17362d",
        accent: "#159669",
        accent2: "#0f704e",
      },
    ],
    [
      "Blush",
      {
        bg: "#fff2f6",
        surface: "#ffffff",
        text: "#3c2030",
        accent: "#d65a89",
        accent2: "#9d335e",
      },
    ],
    [
      "Lavender",
      {
        bg: "#f6f1ff",
        surface: "#ffffff",
        text: "#31204d",
        accent: "#8d3ee0",
        accent2: "#6325a7",
      },
    ],
    [
      "Slate",
      {
        bg: "#f1f4f6",
        surface: "#ffffff",
        text: "#26333f",
        accent: "#64798e",
        accent2: "#485b6b",
      },
    ],
    [
      "Coral",
      {
        bg: "#fff1ed",
        surface: "#ffffff",
        text: "#3d261f",
        accent: "#ed513d",
        accent2: "#b23425",
      },
    ],
    [
      "Ink on White",
      {
        bg: "#f7f7f5",
        surface: "#ffffff",
        text: "#17212b",
        accent: "#31468f",
        accent2: "#213266",
      },
    ],
    [
      "Fresh Lime",
      {
        bg: "#f6fde9",
        surface: "#ffffff",
        text: "#28331a",
        accent: "#59a41d",
        accent2: "#3d7711",
      },
    ],
  ],
  dark: [
    [
      "Arena Green",
      {
        bg: "#0a1814",
        surface: "#122923",
        text: "#e8f5ef",
        accent: "#00d68f",
        accent2: "#009c67",
      },
    ],
    [
      "Midnight Blue",
      {
        bg: "#101329",
        surface: "#202440",
        text: "#edf0ff",
        accent: "#4d92ff",
        accent2: "#2f67bb",
      },
    ],
    [
      "Grape Soda",
      {
        bg: "#26102f",
        surface: "#391a48",
        text: "#faedff",
        accent: "#bf2eea",
        accent2: "#8721a9",
      },
    ],
    [
      "Sunset",
      {
        bg: "#2c1d18",
        surface: "#473027",
        text: "#fff1ea",
        accent: "#ff7646",
        accent2: "#b84928",
      },
    ],
    [
      "Crimson",
      {
        bg: "#2b1219",
        surface: "#481c29",
        text: "#ffe9ef",
        accent: "#ed3056",
        accent2: "#ad1d3b",
      },
    ],
    [
      "Carbon",
      {
        bg: "#161a1c",
        surface: "#2a3032",
        text: "#f0f5f7",
        accent: "#c4d1d7",
        accent2: "#84939a",
      },
    ],
    [
      "Neon Pink",
      {
        bg: "#30102b",
        surface: "#4a1b43",
        text: "#ffeafa",
        accent: "#f000c6",
        accent2: "#ac008d",
      },
    ],
    [
      "Cyber Teal",
      {
        bg: "#0c2d30",
        surface: "#124549",
        text: "#e3ffff",
        accent: "#00d9cc",
        accent2: "#009c94",
      },
    ],
    [
      "Floodlight",
      {
        bg: "#292315",
        surface: "#443a20",
        text: "#fff9e9",
        accent: "#ffc72e",
        accent2: "#b58a13",
      },
    ],
    [
      "Royal Indigo",
      {
        bg: "#21153c",
        surface: "#34205e",
        text: "#f0ecff",
        accent: "#8a65f2",
        accent2: "#5e42b3",
      },
    ],
  ],
};
function swatches(colors) {
  return `<span class="swatches">${Object.values(colors)
    .map((c) => `<i style="background:${c}"></i>`)
    .join("")}</span>`;
}
async function themes() {
  const state = await loadTheme(),
    saved = state.themes;
  let mode = "light";
  const renderMode = () => {
    const presets = mode === "light" ? themePresets.light : themePresets.dark;
    const presetSection = `<section class="theme-section"><h3>${mode.toUpperCase()} PALETTES</h3><div class="preset-grid">${presets.map(([name, colors], i) => `<button class="preset-card" data-preset="${i}">${swatches(colors)}<b>${name}</b></button>`).join("")}</div></section>`;
    const customSection = `<section class="theme-section"><div class="custom-note">Custom is yours to build. Select a colour below and every change previews immediately.</div><h3>YOUR SAVED THEMES</h3><div class="saved-card-list">${saved.length ? saved.map((x) => `<button class="saved-card" data-theme="${x.id}">${swatches(x.colors)}<b>${x.name}</b><small>Apply saved theme</small></button>`).join("") : '<p class="note">No saved themes yet.</p>'}</div><form id="theme-form" class="custom-form"><label>Theme name<input name="name" placeholder="Name this look…" required></label><div class="fine-tune"><h3>FINE TUNE</h3>${[
      ["Buttons & accents", "accent"],
      ["Widgets & panels", "surface"],
      ["Text", "text"],
      ["Page background", "bg"],
      ["Button hover", "accent2"],
    ]
      .map(
        ([label, key]) =>
          `<label>${label}<input type="color" name="${key}" value="${defaultTheme[key]}"></label>`,
      )
      .join("")}</div><button>Save this theme</button></form></section>`;
    app.innerHTML = `${profileTabsMarkup()}<h1 class="theme-title">Theme</h1><p class="theme-intro">Every change here is live on this page straight away, and saved themes apply everywhere after you choose one.</p><p class="eyebrow">MODE</p><div class="mode-grid"><button data-mode="light" class="${mode === "light" ? "active" : ""}">☀<b>Light</b></button><button data-mode="dark" class="${mode === "dark" ? "active" : ""}">🌙<b>Dark</b></button><button data-mode="custom" class="${mode === "custom" ? "active" : ""}">🎨<b>Custom</b></button></div>${mode === "custom" ? customSection : presetSection}`;
    bindProfileTabs();
    document.querySelectorAll("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          mode = b.dataset.mode;
          renderMode();
        }),
    );
    if (mode === "custom") {
      document
        .querySelectorAll("#theme-form input[type=color]")
        .forEach((input) =>
          input.addEventListener("input", () => {
            const f = new FormData($("#theme-form"));
            applyTheme(Object.fromEntries(f));
          }),
        );
      $("#theme-form").onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        await fetch("/api/themes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: f.name,
            colors: {
              bg: f.bg,
              surface: f.surface,
              text: f.text,
              accent: f.accent,
              accent2: f.accent2,
            },
          }),
        });
        themes();
      };
      document.querySelectorAll("[data-theme]").forEach(
        (b) =>
          (b.onclick = async () => {
            await fetch("/api/themes/apply", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: b.dataset.theme }),
            });
            themes();
          }),
      );
    } else
      document.querySelectorAll("[data-preset]").forEach(
        (b) =>
          (b.onclick = () => {
            const colors = presets[b.dataset.preset][1];
            persistTheme(colors);
          }),
      );
  };
  renderMode();
}
window.addEventListener("hashchange", render);
async function initializeApp() {
  try {
    currentUser = (await fetch("/api/auth/session").then((response) => response.json())).user;
  } catch {
    currentUser = null;
  }
  if (currentUser) {
    try { await loadTheme(); } catch { applyTheme(defaultTheme); }
  } else {
    applyTheme(defaultTheme);
  }
  render();
}
initializeApp();
