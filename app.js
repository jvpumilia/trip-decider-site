/* Trip Decider front end: a single page with hash routes. Everything the page shows comes straight from the
   database under row-level security; the AI work goes through the edge functions (signup, rules, ingest, tally). */
(() => {
  const CFG = window.TD_CONFIG;
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => c == null ? "" : "$" + Math.round(c / 100).toLocaleString("en-US");
  const fmtDate = (s) => s ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const fmtDT = (s) => s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  let toastT; const toast = (m, ms = 3500) => { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); };
  const openModal = (html) => { $("#modal-body").innerHTML = html; $("#modal").hidden = false; document.body.style.overflow = "hidden"; };
  const closeModal = () => { $("#modal").hidden = true; document.body.style.overflow = ""; };
  $("#modal-close").onclick = closeModal; $("#modal").onclick = (e) => { if (e.target === $("#modal")) closeModal(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
  const go = (hash) => { location.hash = hash; };

  const S = { session: null, profile: null, trip: null };
  window.TD = { sb, S, $, $$, esc, toast, openModal, closeModal, go, fmtDate, fmtDT, money };

  async function callFn(name, body) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || CFG.SUPABASE_KEY}` }, body: JSON.stringify(body) });
    let j = null; try { j = await res.json(); } catch { j = null; }
    if (!res.ok) { const e = new Error(j?.error || `Request failed (${res.status})`); e.status = res.status; e.extra = j; throw e; }
    return j;
  }
  window.TD.callFn = callFn;

  // ---------------------------------------------------------------- auth
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    S.session = session;
    sb.auth.onAuthStateChange((_e, s) => { S.session = s; route(); });
    await route();
  }
  async function loadProfile() {
    if (!S.session) { S.profile = null; return; }
    const { data } = await sb.from("profiles").select("*").eq("id", S.session.user.id).maybeSingle();
    S.profile = data;
    if (!data) { const { data: created } = await sb.from("profiles").insert({ id: S.session.user.id, display_name: S.session.user.user_metadata?.name || (S.session.user.email || "Member").split("@")[0], email: S.session.user.email }).select("*").single(); S.profile = created; }
    $("#userchip").hidden = false; $("#user-name").textContent = S.profile?.display_name || S.session.user.email;
  }
  $("#signout").onclick = async () => { await sb.auth.signOut(); $("#userchip").hidden = true; go("#/"); };

  function renderAuth(joinCode) {
    $("#app").innerHTML = `<div class="card pad auth stack">
      <h1>Where are we going?</h1>
      <p class="muted">Your group writes its own rules. Every option is scored the same way. Then you decide by a method you agreed on first.</p>
      ${joinCode ? `<p class="notice">You've been invited to a trip (code <b>${esc(joinCode)}</b>). Sign in and you'll join it automatically.</p>` : ""}
      <div class="tabs small"><button class="tab active" data-t="link">Email me a link</button><button class="tab" data-t="in">Password</button><button class="tab" data-t="up">Create account</button></div>
      <form id="f-link" class="stack"><label class="f">Email <input type="email" name="email" required autocomplete="email"></label><button class="btn primary">Send me a sign-in link</button><p class="muted tiny">No password to remember. We email you a link that signs you in; it works once and expires in an hour. First time here? The same link creates your account.</p></form>
      <form id="f-in" class="stack" hidden><label class="f">Email <input type="email" name="email" required autocomplete="email"></label><label class="f">Password <input type="password" name="password" required autocomplete="current-password"></label><button class="btn primary">Sign in</button><button type="button" class="link" id="forgot">Forgot your password? Email me a reset link.</button></form>
      <form id="f-up" class="stack" hidden><label class="f">Your name <input name="name" required placeholder="e.g. Aunt Mary"></label><label class="f">Email <input type="email" name="email" required autocomplete="email"></label><label class="f">Password (8+ characters) <input type="password" name="password" required minlength="8" autocomplete="new-password"></label><button class="btn primary">Create account</button></form>
      <p id="auth-msg" class="msg" hidden></p></div>`;
    const msg = (m, ok) => { const el = $("#auth-msg"); el.textContent = m; el.className = "msg" + (ok ? " ok" : ""); el.hidden = false; };
    // the join code rides in the query string: a hash would collide with the tokens the sign-in link appends
    const redirectTo = location.origin + location.pathname + (joinCode ? `?join=${encodeURIComponent(joinCode)}` : "");
    $$(".tab").forEach((t) => t.onclick = () => { $$(".tab").forEach((x) => x.classList.toggle("active", x === t)); $("#f-link").hidden = t.dataset.t !== "link"; $("#f-in").hidden = t.dataset.t !== "in"; $("#f-up").hidden = t.dataset.t !== "up"; });
    $("#f-link").onsubmit = async (e) => {
      e.preventDefault(); const email = new FormData(e.target).get("email").trim(); const b = e.target.querySelector("button"); b.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      b.disabled = false;
      if (error) return msg(error.message);
      msg(`Sent. Check ${email} for a link from Trip Decider (look in spam the first time). You can close this tab.`, true);
    };
    $("#f-in").onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") }); if (error) msg(error.message); };
    $("#forgot").onclick = async () => { const email = $("#f-in input[name=email]").value.trim(); if (!email) return msg("Type your email first, then tap the reset link."); const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + "#/password" }); if (error) return msg(error.message); msg(`Sent. Check ${email} for a reset link.`, true); };
    $("#f-up").onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector("button"); b.disabled = true;
      try { await callFn("signup", { name: f.get("name"), email: f.get("email"), password: f.get("password") }); const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") }); if (error) msg(error.message); }
      catch (err) { msg(err.message); } finally { b.disabled = false; }
    };
  }
  function renderPassword() {
    $("#app").innerHTML = `<div class="card pad auth stack"><h1>Choose a new password</h1><form id="f-pw" class="stack"><label class="f">New password (8+ characters) <input type="password" name="password" required minlength="8" autocomplete="new-password"></label><button class="btn primary">Save</button></form><p id="auth-msg" class="msg" hidden></p></div>`;
    $("#f-pw").onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get("password") }); const el = $("#auth-msg"); el.hidden = false; if (error) { el.textContent = error.message; el.className = "msg"; return; } el.textContent = "Saved. Taking you to your trips…"; el.className = "msg ok"; setTimeout(() => go("#/"), 800); };
  }

  // ---------------------------------------------------------------- home
  async function renderHome() {
    const { data: ms } = await sb.from("memberships").select("role, household_id, trips(id, title, status, nights, season_start, season_end, check_in, check_out, created_at)").eq("user_id", S.session.user.id);
    const trips = (ms || []).map((m) => ({ ...m.trips, role: m.role })).filter((t) => t.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const statusWord = { setup: "Still being set up", open: "Open: adding and nominating", locked: "Ballot locked, voting", voting: "Voting", decided: "Decided", archived: "Archived" };
    $("#app").innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center"><h1>Your trips</h1><a class="btn primary" href="#/new">Set up a new trip</a></div>
      <div class="cards">${trips.map((t) => `<a class="card house" href="#/trip/${t.id}" style="text-decoration:none;color:inherit"><div class="t">${esc(t.title)}</div><div class="muted small">${esc(statusWord[t.status] || t.status)} · ${t.nights} nights${t.check_in ? " · " + fmtDate(t.check_in) : t.season_start ? " · " + fmtDate(t.season_start) + " to " + fmtDate(t.season_end) : ""}</div><span class="tag ${t.role === "organizer" ? "info" : "neutral"}">${t.role}</span></a>`).join("") || `<p class="empty">No trips yet. Set one up, or join one with the code your organizer sent.</p>`}</div>
      <div class="card stack" style="max-width:520px"><h3>Join a trip with a code</h3><form id="f-join" class="row"><label class="f" style="flex:1">The code from the group text <input name="code" required placeholder="e.g. 7A3F9C2B1D" style="text-transform:uppercase"></label><button class="btn">Join</button></form><p id="join-msg" class="msg" hidden></p></div>`;
    $("#f-join").onsubmit = async (e) => {
      e.preventDefault(); const code = new FormData(e.target).get("code").trim();
      const { data, error } = await sb.rpc("join_trip", { code, name: S.profile?.display_name || null });
      if (error) { const el = $("#join-msg"); el.textContent = error.message.replace(/^[a-z_]+: /, ""); el.hidden = false; return; }
      go(`#/trip/${data}/people`);
    };
  }

  // ---------------------------------------------------------------- trip workspace
  async function loadTrip(id) {
    const [trip, rules, members, households, constraints, dests, listings, noms, evals, ballot, results, vetoes, weekVotes, messages] = await Promise.all([
      sb.from("trips").select("*").eq("id", id).maybeSingle(),
      sb.from("trip_rules").select("*").eq("trip_id", id).maybeSingle(),
      sb.from("memberships").select("*, profiles(display_name, email)").eq("trip_id", id),
      sb.from("households").select("*").eq("trip_id", id).order("sort"),
      sb.from("constraints").select("*").eq("trip_id", id).order("sort"),
      sb.from("trip_destinations").select("*, places(*)").eq("trip_id", id),
      sb.from("trip_listings").select("*, listings(*)").eq("trip_id", id).order("total", { ascending: false }),
      sb.from("nominations").select("*").eq("trip_id", id),
      sb.from("evaluations").select("*").eq("trip_id", id),
      sb.from("ballots").select("*").eq("trip_id", id).eq("user_id", S.session.user.id).maybeSingle(),
      sb.from("results").select("*").eq("trip_id", id).order("computed_at", { ascending: false }).limit(1),
      sb.from("vetoes").select("*").eq("trip_id", id),
      sb.from("week_votes").select("*").eq("trip_id", id),
      sb.from("messages").select("*").eq("trip_id", id).order("created_at", { ascending: true }).limit(400),
    ]);
    if (!trip.data) return null;
    const me = (members.data || []).find((m) => m.user_id === S.session.user.id);
    const listingIds = (listings.data || []).map((l) => l.listing_id);
    const { data: windows } = listingIds.length ? await sb.from("availability_windows").select("*").in("listing_id", listingIds) : { data: [] };
    return { trip: trip.data, rules: rules.data, members: members.data || [], households: households.data || [], constraints: constraints.data || [], dests: dests.data || [], listings: listings.data || [], noms: noms.data || [], evals: evals.data || [], ballot: ballot.data, result: (results.data || [])[0] || null, vetoes: vetoes.data || [], weekVotes: weekVotes.data || [], messages: messages.data || [], windows: windows || [], me };
  }
  let realtime = null;
  function watch(id) {
    if (realtime) { sb.removeChannel(realtime); realtime = null; }
    let t;
    const refresh = () => { clearTimeout(t); t = setTimeout(async () => { if (S.trip?.trip.id !== id) return; const fresh = await loadTrip(id); if (fresh) { S.trip = fresh; renderTrip(currentTab); } }, 500); };
    realtime = sb.channel("trip-" + id).on("postgres_changes", { event: "*", schema: "public", table: "trip_listings", filter: `trip_id=eq.${id}` }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "nominations", filter: `trip_id=eq.${id}` }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "trip_destinations", filter: `trip_id=eq.${id}` }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `trip_id=eq.${id}` }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "week_votes", filter: `trip_id=eq.${id}` }, refresh).subscribe();
  }
  window.TD.loadTrip = loadTrip;

  let currentTab = "overview";
  const TABS = [["overview", "Overview"], ["places", "Places"], ["houses", "Houses"], ["dates", "Dates"], ["chat", "Chat"], ["vote", "Vote"], ["results", "Results"], ["people", "People"], ["settings", "Settings"]];
  const hhName = (id) => S.trip.households.find((h) => h.id === id)?.name || "";
  const myHousehold = () => S.trip.me?.household_id || null;
  const isOrg = () => S.trip.me?.role === "organizer";
  const nomsFor = (tlId) => S.trip.noms.filter((n) => n.trip_listing_id === tlId);
  const locked = () => { const r = S.trip.rules; return ["voting", "decided", "archived"].includes(S.trip.trip.status) || (r?.nominations_close && new Date(r.nominations_close) < new Date()); };
  const votingOpen = () => { const r = S.trip.rules; return ["open", "locked", "voting"].includes(S.trip.trip.status) && (!r?.voting_closes || new Date(r.voting_closes) >= new Date()); };
  const onBallot = () => S.trip.listings.filter((l) => l.is_finalist && l.status === "scored" && l.avail_status !== "unavailable" && !S.trip.vetoes.some((v) => v.trip_listing_id === l.id));
  const statusTag = (l) => l.status === "scored" ? "" : l.status === "error" ? `<span class="tag warn">scoring failed</span>` : `<span class="tag sun"><span class="spinner"></span>scoring…</span>`;
  // A gate can pass, fail, or be unknown (the listing didn't say; the host has to confirm). Only a real failure is a red mark.
  const gateState = (l) => { if (l.status !== "scored") return ""; if (l.gate_pass) return "pass"; const gs = S.trip.evals.filter((e) => e.trip_listing_id === l.id && e.passed !== null && S.trip.constraints.find((c) => c.id === e.constraint_id && c.kind === "gate")); return gs.some((e) => e.passed === false) ? "fail" : "unknown"; };
  const gateTag = (l, short) => { const g = gateState(l); return g === "pass" ? `<span class="tag ok">${short ? "gates ✓" : "passes every deal-breaker"}</span>` : g === "fail" ? `<span class="tag warn">${short ? "gate ✗" : "fails a deal-breaker"}</span>` : g === "unknown" ? `<span class="tag sun">${short ? "ask host" : "a deal-breaker needs the host to confirm"}</span>` : ""; };

  function renderTrip(tab) {
    currentTab = tab || "overview";
    const T = S.trip, t = T.trip;
    const tabs = TABS.filter(([k]) => k !== "settings" || isOrg());
    $("#app").innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div><a href="#/" class="muted tiny">← Your trips</a><h1>${esc(t.title)}</h1><div class="muted small">${t.nights} nights · ${t.check_in ? fmtDate(t.check_in) + " to " + fmtDate(t.check_out) : t.season_start ? "between " + fmtDate(t.season_start) + " and " + fmtDate(t.season_end) : "dates open"} · ${T.households.length} households · ${esc(t.adults ?? "?")} adults${(t.kids_ages || []).length ? ", kids " + t.kids_ages.join(", ") : ""}</div></div>
        ${t.status === "setup" ? `<span class="tag sun">Setup: not open to the group yet</span>` : locked() ? `<span class="tag info">Ballot locked</span>` : `<span class="tag ok">Open</span>`}
      </div>
      <nav class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === currentTab ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav>
      <section id="panel"></section>`;
    $$("[data-tab]").forEach((b) => b.onclick = () => go(`#/trip/${t.id}/${b.dataset.tab}`));
    ({ overview: renderOverview, places: renderPlaces, houses: renderHouses, dates: renderDates, chat: renderChat, vote: renderVote, results: renderResults, people: renderPeople, settings: renderSettings })[currentTab]?.($("#panel"));
  }

  const rulesSummary = () => {
    const cs = S.trip.constraints.filter((c) => c.active), gates = cs.filter((c) => c.kind === "gate"), crits = cs.filter((c) => c.kind === "criterion"), checks = cs.filter((c) => c.kind === "checklist");
    const sum = crits.reduce((a, c) => a + c.weight, 0) || 1;
    return `<div class="grid2"><div><div class="muted tiny" style="font-weight:700">Deal-breakers (${gates.length})</div>${gates.map((g) => `<div class="small">· ${esc(g.label)}${g.param ? ` <span class="muted">(${esc(g.param)})</span>` : ""}</div>`).join("") || `<div class="empty">none</div>`}${checks.length ? `<div class="muted tiny" style="font-weight:700;margin-top:8px">Asked of the host (${checks.length})</div>${checks.map((c) => `<div class="small">· ${esc(c.label)}</div>`).join("")}` : ""}</div>
      <div><div class="muted tiny" style="font-weight:700">Points (100 total)</div>${crits.map((c) => `<div class="small" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(c.label)}</span><b>${Math.round(100 * c.weight / sum)}</b></div>`).join("") || `<div class="empty">none</div>`}</div></div>`;
  };

  function renderOverview(el) {
    const T = S.trip, r = T.rules;
    const scored = T.listings.filter((l) => l.status === "scored");
    const top = [...scored].sort((a, b) => (b.gate_pass - a.gate_pass) || (b.total - a.total)).slice(0, 5);
    const dests = [...T.dests].sort((a, b) => b.total - a.total);
    el.innerHTML = `
      ${T.trip.status === "setup" && isOrg() ? `<div class="notice">This trip is still in setup. <a href="#/new/${T.trip.id}">Finish the setup wizard</a> and open it so the group can join and add places.</div>` : ""}
      <div class="grid2">
        <div class="card stack"><h3>Where things stand</h3>
          <div class="small">${T.dests.length} place${T.dests.length === 1 ? "" : "s"} · ${T.listings.length} house${T.listings.length === 1 ? "" : "s"} (${scored.length} scored) · ${onBallot().length} on the ballot · ${T.members.length} people in ${T.households.length} households</div>
          <div class="small">${r?.nominations_close ? `Nominations ${locked() ? "closed" : "close"} ${fmtDT(r.nominations_close)}. ` : "No nomination deadline set. "}${r?.voting_closes ? `Voting ${votingOpen() ? "closes" : "closed"} ${fmtDT(r.voting_closes)}.` : "No voting deadline set."}</div>
          <div class="small">Decided by <b>${esc(methodName(r?.method))}</b>, ${r?.weighting === "person" ? "each adult counts once" : "each household counts once"}.</div></div>
        <div class="card stack"><h3>The rules, in writing</h3>${rulesSummary()}</div>
      </div>
      <div class="grid2">
        <div class="card stack"><h3>Places, best first</h3>${dests.map((d) => `<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--line2);padding:6px 0"><a href="#" data-open-dest="${d.id}">${esc(d.places?.facts?.display_name || d.places?.name)}</a><span class="score">${d.total}<small>/100</small></span></div>`).join("") || `<p class="empty">No places yet. Add one on the Places tab.</p>`}</div>
        <div class="card stack"><h3>Top houses so far</h3>${top.map((l) => `<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--line2);padding:6px 0;align-items:center"><span><a href="#" data-open-house="${l.id}">${esc(l.listings.title)}</a> ${l.is_sponsored ? `<span class="tag sponsored">Sponsored</span>` : ""} ${gateTag(l, true)}</span><span class="score">${l.total}<small>/100</small></span></div>`).join("") || `<p class="empty">No scored houses yet. Add one on the Houses tab.</p>`}</div>
      </div>`;
    wireOpeners(el);
  }
  const methodName = (m) => ({ irv: "ranked choice", approval: "approval voting", score: "scoring 1 to 5", irv_veto: "ranked choice with one veto per household", score_only: "the highest score, no vote", organizer: "the organizer, with input" }[m] || m || "ranked choice");
  function wireOpeners(el) {
    $$("[data-open-house]", el).forEach((a) => a.onclick = (e) => { e.preventDefault(); houseModal(a.dataset.openHouse); });
    $$("[data-open-dest]", el).forEach((a) => a.onclick = (e) => { e.preventDefault(); destModal(a.dataset.openDest); });
  }

  // ---------------------------------------------------------------- places
  function renderPlaces(el) {
    const T = S.trip;
    const dests = [...T.dests].sort((a, b) => b.total - a.total);
    el.innerHTML = `
      <div class="card stack"><h3>Suggest a place</h3><p class="muted small">A town, a park, a resort, a region: the site works out where a group like yours would actually stay, scores it against your rules, estimates travel from every household, and pulls in any partner houses there.</p>
        <form id="f-place" class="row"><label class="f" style="flex:1">Where? <input name="text" required placeholder="e.g. Gatlinburg, Outer Banks, Yellowstone, Disney World"></label><button class="btn primary">Score this place</button></form><div id="place-progress" class="progress" hidden></div></div>
      <div class="cards">${dests.map((d) => `<div class="card house" data-open-dest="${d.id}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div class="t">${esc(d.places?.facts?.display_name || d.places?.name)}<div class="muted tiny">${esc(d.places?.region)}, ${esc(d.places?.country)}${d.places?.elevation_ft != null ? " · " + d.places.elevation_ft.toLocaleString() + " ft" : ""}</div></div><span class="score">${d.total}<small>/100</small></span></div>${d.status !== "scored" ? `<span class="tag sun"><span class="spinner"></span>scoring…</span>` : d.gate_pass ? `<span class="tag ok">passes your deal-breakers</span>` : `<span class="tag warn">fails a deal-breaker</span>`}<p class="small">${esc((d.summary || "").slice(0, 180))}${(d.summary || "").length > 180 ? "…" : ""}</p><div class="muted tiny">${T.listings.filter((l) => l.trip_destination_id === d.id).length} houses here</div></div>`).join("") || `<p class="empty">No places yet.</p>`}</div>`;
    $$("[data-open-dest]", el).forEach((c) => c.onclick = () => destModal(c.dataset.openDest));
    $("#f-place").onsubmit = async (e) => {
      e.preventDefault(); const text = new FormData(e.target).get("text").trim(); const b = e.target.querySelector("button"); b.disabled = true;
      const p = $("#place-progress"); p.hidden = false; p.innerHTML = `<span class="spinner"></span>Working out where that is, scoring it for your group and estimating travel for every household. About a minute.`;
      try { const r = await callFn("ingest", { action: "place", trip_id: T.trip.id, text }); toast(r.destination_created ? `Added and scored: ${r.resolved}${r.sponsored_added?.length ? ` · ${r.sponsored_added.length} partner house${r.sponsored_added.length > 1 ? "s" : ""} added` : ""}` : `Already on the list: ${r.resolved}`, 6000); S.trip = await loadTrip(T.trip.id); renderTrip("places"); if (r.sponsored_added?.length) scoreMany(r.sponsored_added); }
      catch (err) { toast(err.message, 7000); b.disabled = false; p.hidden = true; }
    };
  }
  function destModal(id) {
    const d = S.trip.dests.find((x) => x.id === id); if (!d) return;
    const evs = S.trip.evals.filter((e) => e.trip_destination_id === id);
    const travel = d.travel || {};
    openModal(`<div class="stack"><h2>${esc(d.places?.facts?.display_name || d.places?.name)} <span class="score">${d.total}<small>/100</small></span></h2>
      <p>${esc(d.summary || "")}</p>
      <div class="grid2"><div><b>Why it might win</b>${(d.pros || []).map((p) => `<div class="small">· ${esc(p)}</div>`).join("")}</div><div><b>Why it might lose</b>${(d.cons || []).map((p) => `<div class="small">· ${esc(p)}</div>`).join("")}</div></div>
      <h3>Travel from each household</h3><div class="table-wrap"><table class="t"><tr><th>Household</th><th>Difficulty</th><th>Hours</th><th>Route</th></tr>${S.trip.households.map((h) => { const t = travel[h.id]; return `<tr><td>${esc(h.name)}</td><td>${t ? t.difficulty + "/10" : "?"}</td><td>${t ? t.hours : "?"}</td><td class="small">${esc(t?.route || "")}${t?.notes ? `<div class="muted tiny">${esc(t.notes)}</div>` : ""}</td></tr>`; }).join("")}</table></div>
      ${evalList(evs)}
      ${(d.places?.facts?.attractions || []).length ? `<h3>Things to do, rated for this group</h3>${d.places.facts.attractions.map((a) => `<div class="small">${"★".repeat(a.rating || 0)}${"☆".repeat(5 - (a.rating || 0))} <b>${esc(a.name)}</b> <span class="muted">${esc(a.category)} · ${esc(a.ages)}</span><div class="muted tiny">${esc(a.why)}</div></div>`).join("")}` : ""}
      <div class="row">${isOrg() ? `<button class="btn small" id="rescore-dest">Re-score this place</button>` : ""}<button class="btn small" id="prospect">Search the web for houses here</button></div><div id="dest-progress" class="progress" hidden></div></div>`);
    const prog = (html) => { const p = $("#dest-progress"); p.hidden = false; p.innerHTML = html; };
    $("#rescore-dest")?.addEventListener("click", async () => { prog(`<span class="spinner"></span>Re-scoring…`); try { await callFn("ingest", { action: "rescore_destination", trip_id: S.trip.trip.id, trip_destination_id: id }); S.trip = await loadTrip(S.trip.trip.id); destModal(id); } catch (e) { prog(esc(e.message)); } });
    $("#prospect")?.addEventListener("click", async () => {
      prog(`<span class="spinner"></span>Searching the web for houses that fit your rules (a minute or two)…`);
      try {
        const { candidates = [], skipped } = await callFn("ingest", { action: "prospect", trip_id: S.trip.trip.id, trip_destination_id: id, force: true });
        if (!candidates.length) { prog(skipped ? "This place already has suggestions." : "Nothing suitable turned up automatically. Add a house by hand if you know of one."); return; }
        const ids = [];
        for (const c of candidates) { prog(`<span class="spinner"></span>Reading ${esc(c.url)}…`); try { const r = await callFn("ingest", { action: "prospect_add", trip_id: S.trip.trip.id, trip_destination_id: id, url: c.url, why: c.why }); if (r.trip_listing_id) ids.push(r.trip_listing_id); } catch (e) { console.warn(e); } }
        if (!ids.length) { prog("Found listings but none passed the first look."); return; }
        prog(`Found ${ids.length} house${ids.length > 1 ? "s" : ""}; scoring now. Watch the Houses tab.`); closeModal(); S.trip = await loadTrip(S.trip.trip.id); renderTrip("houses"); scoreMany(ids);
      } catch (e) { prog(esc(e.message)); }
    });
  }

  // ---------------------------------------------------------------- houses
  async function scoreMany(ids) {
    for (const id of ids) { try { await callFn("ingest", { action: "score", trip_id: S.trip.trip.id, trip_listing_id: id }); } catch (e) { console.warn("score", e.message); } }
    S.trip = await loadTrip(S.trip.trip.id); renderTrip(currentTab);
  }
  // houses left pending (someone closed the tab) get scored when anyone opens the trip
  let resumed = false;
  function resumePending() {
    if (resumed) return; resumed = true;
    const ids = S.trip.listings.filter((l) => l.status === "pending" && Date.now() - new Date(l.created_at).getTime() > 90_000).map((l) => l.id);
    if (ids.length) scoreMany(ids);
  }

  function houseCard(l) {
    const L = l.listings, noms = nomsFor(l.id);
    const img = (L.photos && L.photos[0]) || "";
    return `<div class="card house" data-open-house="${l.id}">
      <div class="img" style="${img ? `background-image:url('${esc(img)}')` : ""}"></div>
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div class="t">${esc(L.title)}</div><span class="score">${l.status === "scored" ? l.total : "–"}<small>/100</small></span></div>
      <div class="muted tiny">${esc([L.city, L.state].filter(Boolean).join(", "))} · ${L.bedrooms ?? "?"} BR · ${L.bathrooms ?? "?"} BA${L.sleeps ? " · sleeps " + L.sleeps : ""}${L.price_night_cents ? " · " + money(L.price_night_cents) + "/night" : ""}</div>
      <div class="chips">${statusTag(l)}${l.is_sponsored ? `<span class="tag sponsored">Sponsored</span>` : ""}${l.added_via === "ai" ? `<span class="tag info">Found by search</span>` : ""}${gateTag(l, false)}${l.avail_status === "unavailable" ? `<span class="tag warn">not available</span>` : l.avail_status === "available" ? `<span class="tag ok">availability confirmed</span>` : ""}${noms.map((n) => `<span class="tag sun">★ ${esc(hhName(n.household_id))}</span>`).join("")}</div>
      ${(L.facts?.highlights || []).length ? `<div class="chips">${L.facts.highlights.slice(0, 5).map((h) => `<span class="chip">${esc(h)}</span>`).join("")}</div>` : ""}
    </div>`;
  }
  function renderHouses(el) {
    const T = S.trip;
    const list = [...T.listings].sort((a, b) => (b.status === "scored") - (a.status === "scored") || (b.gate_pass - a.gate_pass) || (b.total - a.total));
    el.innerHTML = `
      <div class="card stack" id="add-house"><h3>Add a house</h3>
        <form id="f-preview" class="row"><label class="f" style="flex:1">Paste the listing link (Airbnb, VRBO, a cabin company…) <input name="url" type="url" placeholder="https://www.airbnb.com/rooms/…"></label><button class="btn primary">Read the listing</button><button class="btn" type="button" id="manual">Enter by hand</button></form>
        <form id="f-submit" class="stack" hidden>
          <p id="prefill-note" class="msg info" hidden></p>
          <details class="stack"><summary class="small">Site blocked our reader? Paste the listing's text instead</summary><textarea id="paste-text" rows="5" placeholder="Select all the text on the listing page, copy, paste here"></textarea><button class="btn small" type="button" id="paste-go">Read the pasted text</button></details>
          <input type="hidden" name="url"><input type="hidden" name="photos"><input type="hidden" name="description"><input type="hidden" name="rating"><input type="hidden" name="review_count">
          <label class="f">Name of the house <input name="title" required></label>
          <div class="row"><label class="f">City / town <input name="city" required></label><label class="f">State / province <input name="state" required maxlength="40"></label></div>
          <div class="grid3"><label class="f">Bedrooms <input name="bedrooms" type="number" min="1" max="40" required></label><label class="f">Bathrooms <input name="bathrooms" type="number" min="0" max="40" step="0.5"></label><label class="f">Sleeps <input name="sleeps" type="number" min="1" max="80"></label></div>
          <div class="row"><label class="f">Price per night ($) <input name="price_night" type="number" min="0"></label><label class="f">Total for the stay ($) <input name="price_total" type="number" min="0"></label></div>
          <label class="f">Notes for the scorer <textarea name="notes" rows="2" placeholder="Beds in each room, anything the page doesn't say…"></textarea></label>
          <div class="row"><button class="btn primary">Save &amp; score it</button><button class="btn" type="button" id="cancel-submit">Cancel</button></div>
          <div id="submit-progress" class="progress" hidden></div></form></div>
      <div class="row" style="justify-content:space-between"><div class="muted small">${list.length} house${list.length === 1 ? "" : "s"} · sorted by score; houses that fail a deal-breaker sink</div></div>
      <div class="cards">${list.map(houseCard).join("") || `<p class="empty">No houses yet. Paste a listing link above, or open a place and search the web.</p>`}</div>`;
    $$("[data-open-house]", el).forEach((c) => c.onclick = () => houseModal(c.dataset.openHouse));
    const fs = $("#f-submit"), fp = $("#f-preview");
    const showSubmit = (p) => { fs.hidden = false; fp.hidden = true; const set = (k, v) => { const i = fs.elements[k]; if (i) i.value = v == null ? "" : (Array.isArray(v) ? JSON.stringify(v) : v); }; ["url", "title", "city", "state", "bedrooms", "bathrooms", "sleeps", "price_night", "price_total", "description", "rating", "review_count", "photos"].forEach((k) => set(k, p[k])); const n = $("#prefill-note"); n.hidden = !p.note; n.textContent = p.note || ""; fs.elements.title.focus(); };
    fp.onsubmit = async (e) => { e.preventDefault(); const url = new FormData(fp).get("url").trim(); if (!url) return showSubmit({}); const b = fp.querySelector("button"); b.disabled = true; b.innerHTML = `<span class="spinner"></span>Reading…`; try { const r = await callFn("ingest", { action: "preview", trip_id: T.trip.id, url }); showSubmit({ ...r.prefill, url }); } catch (err) { toast(err.message, 6000); showSubmit({ url }); } finally { b.disabled = false; b.textContent = "Read the listing"; } };
    $("#manual").onclick = () => showSubmit({});
    $("#cancel-submit").onclick = () => { fs.hidden = true; fp.hidden = false; };
    $("#paste-go").onclick = async () => { const text = $("#paste-text").value; const b = $("#paste-go"); b.disabled = true; try { const r = await callFn("ingest", { action: "extract_text", trip_id: T.trip.id, text, url: fs.elements.url.value }); showSubmit({ ...r.prefill, url: fs.elements.url.value }); } catch (err) { toast(err.message, 6000); } finally { b.disabled = false; } };
    fs.onsubmit = async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(fs).entries()); try { f.photos = JSON.parse(f.photos || "[]"); } catch { f.photos = []; }
      const prog = $("#submit-progress"); prog.hidden = false; const b = fs.querySelector("button.primary"); b.disabled = true;
      try {
        prog.innerHTML = `<span class="spinner"></span>Placing it on the map${T.dests.length ? "" : " and scoring its destination"}…`;
        const r = await callFn("ingest", { action: "submit", trip_id: T.trip.id, ...f });
        prog.innerHTML = `<span class="spinner"></span>Saved. Scoring it against your ${T.constraints.filter((c) => c.active && c.kind !== "checklist").length} rules (about a minute)…`;
        S.trip = await loadTrip(T.trip.id); renderTrip("houses"); toast("Saved. Scoring now; the card will fill in when it's done.", 5000);
        await scoreMany([r.trip_listing.id]);
      } catch (err) { prog.innerHTML = esc(err.message); b.disabled = false; if (err.status === 409 && err.extra?.existing_id) houseModal(err.extra.existing_id); }
    };
  }

  function evalList(evs) {
    const cs = S.trip.constraints;
    const rows = evs.map((e) => ({ e, c: cs.find((c) => c.id === e.constraint_id) })).filter((x) => x.c).sort((a, b) => (a.c.kind === "gate" ? 0 : 1) - (b.c.kind === "gate" ? 0 : 1) || a.c.sort - b.c.sort);
    if (!rows.length) return "";
    const sum = cs.filter((c) => c.active && c.kind === "criterion").reduce((a, c) => a + c.weight, 0) || 1;
    return `<h3>How it did on each rule</h3><div>${rows.map(({ e, c }) => c.kind === "gate"
      ? `<div class="ev"><span class="ic ${e.passed === true ? "pass" : e.passed === false ? "fail" : "unk"}">${e.passed === true ? "✓" : e.passed === false ? "✗" : "?"}</span><span><b>${esc(c.label)}</b> <span class="muted tiny">deal-breaker${e.passed == null ? " · needs confirming" : ""}</span><div class="small">${esc(e.why)}</div></span><span class="tag ${e.passed === true ? "ok" : e.passed === false ? "warn" : "sun"}">${e.passed === true ? "passes" : e.passed === false ? "fails" : "ask host"}</span></div>`
      : `<div class="ev"><span class="ic">·</span><span><b>${esc(c.label)}</b> <span class="muted tiny">${Math.round(100 * c.weight / sum)} pts possible${e.needs_host ? " · confirm with host" : ""}</span><div class="small">${esc(e.why)}</div><div class="bar" style="margin-top:4px;max-width:220px"><i style="width:${Math.round(100 * (e.raw || 0))}%"></i></div></span><b>${Math.round(100 * (e.raw || 0) * c.weight / sum)}</b></div>`).join("")}</div>`;
  }

  function houseModal(id) {
    const l = S.trip.listings.find((x) => x.id === id); if (!l) return;
    const L = l.listings, evs = S.trip.evals.filter((e) => e.trip_listing_id === id), noms = nomsFor(id), mine = myHousehold();
    const myNom = noms.find((n) => n.household_id === mine), myCount = S.trip.noms.filter((n) => n.household_id === mine).length, cap = S.trip.rules?.nom_cap || 2;
    const canNominate = mine && !locked() && S.trip.trip.status !== "setup" && l.status === "scored" && l.avail_status !== "unavailable" && !["score_only", "organizer"].includes(S.trip.rules?.method);
    const photos = L.photos || [];
    openModal(`<div class="stack">
      ${photos[0] ? `<img class="hero" src="${esc(photos[0])}" alt="" referrerpolicy="no-referrer">` : ""}
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div><h2>${esc(L.title)}</h2><div class="muted small">${esc([L.city, L.state].filter(Boolean).join(", "))} · ${L.bedrooms ?? "?"} BR · ${L.bathrooms ?? "?"} BA${L.sleeps ? " · sleeps " + L.sleeps : ""}${L.price_night_cents ? " · " + money(L.price_night_cents) + "/night" : ""}${L.rating ? ` · ★ ${L.rating}${L.review_count ? ` (${L.review_count})` : ""}` : ""}${L.elevation_ft != null ? " · " + L.elevation_ft.toLocaleString() + " ft" : ""}</div></div><span class="score" style="font-size:30px">${l.status === "scored" ? l.total : "–"}<small>/100</small></span></div>
      <div class="chips">${statusTag(l)}${l.is_sponsored ? `<span class="tag sponsored">Sponsored: a partner paid to be included. Scored by the same rules as everything else.</span>` : ""}${gateTag(l, false)}${noms.map((n) => `<span class="tag sun">★ nominated by ${esc(hhName(n.household_id))}</span>`).join("")}</div>
      ${l.ai_summary ? `<p>${esc(l.ai_summary)}</p>` : ""}
      ${L.facts?.bed_plan ? `<p class="small"><b>Sleeping plan:</b> ${esc(L.facts.bed_plan)}</p>` : ""}
      ${(l.red_flags || []).length ? `<div class="msg"><b>Red flags</b>${l.red_flags.map((f) => `<div>· ${esc(f)}</div>`).join("")}</div>` : ""}
      ${evalList(evs)}
      ${(l.verify_checklist || []).length ? `<h3>Ask the host before a deposit</h3>${l.verify_checklist.map((q) => `<div class="small">☐ ${esc(q)}</div>`).join("")}` : ""}
      <div class="row">
        ${canNominate ? (myNom ? `<button class="btn" id="withdraw">Withdraw my household's nomination</button>` : `<button class="btn primary" id="nominate" ${myCount >= cap ? "disabled" : ""}>Nominate for ${esc(hhName(mine))} (${myCount}/${cap} used)</button>`) : ""}
        ${L.canonical_url ? `<a class="btn" href="${esc(L.canonical_url)}" target="_blank" rel="noopener">${l.is_sponsored ? "Book direct with the owner ↗" : "Open the listing ↗"}</a>` : ""}
        ${(l.added_by === S.session.user.id || isOrg()) && l.status !== "scoring" ? `<button class="btn small" id="rescore">Re-score</button>` : ""}
      </div>
      <div class="card stack"><b>Availability for our dates</b><p class="muted tiny">The site can't read a host's calendar. When you check, record what you learned. "Not available" removes the house from the ballot; it is the only thing that does.</p>
        <div class="row"><button class="btn small ${l.avail_status === "available" ? "primary" : ""}" data-av="available">Confirmed open</button><button class="btn small danger" data-av="unavailable">Not available for our dates</button><button class="btn small ghost" data-av="unknown">Clear</button></div>
        ${l.avail_note ? `<div class="muted tiny">${esc(l.avail_note)}</div>` : ""}
        <details><summary class="small">Record what the host's calendar showed (feeds the Dates tab)</summary>
          <form id="f-window" class="row" style="margin-top:8px"><label class="f">From <input type="date" name="start_date" required></label><label class="f">To <input type="date" name="end_date" required></label><label class="f">It was <select name="status"><option value="available">open</option><option value="booked">booked</option></select></label><button class="btn small">Save</button></form>
          ${S.trip.windows.filter((w) => w.listing_id === l.listing_id).sort((a, b) => a.start_date.localeCompare(b.start_date)).map((w) => `<div class="tiny"><span class="tag ${w.status === "available" ? "ok" : "warn"}">${w.status === "available" ? "open" : "booked"}</span> ${fmtDate(w.start_date)} to ${fmtDate(w.end_date)} <span class="muted">${w.source === "member" ? "seen by " + esc(nameOf(w.recorded_by)) : "from the owner's calendar"}</span></div>`).join("")}</details></div>
      ${photos.length > 1 ? `<div class="gallery">${photos.slice(1, 13).map((p) => `<img src="${esc(p)}" alt="" referrerpolicy="no-referrer" loading="lazy">`).join("")}</div>` : ""}
      <details><summary class="muted tiny">More</summary><div class="tiny muted">${l.added_via === "member" && !S.trip.rules?.blind_submitters ? `Added by ${esc(S.trip.members.find((m) => m.user_id === l.added_by)?.profiles?.display_name || "a member")}. ` : l.added_via === "ai" ? "Found by web search. " : l.is_sponsored ? "Added by a partner. " : ""}${l.notes ? `Notes: ${esc(l.notes)}` : ""}</div><pre class="tiny" style="white-space:pre-wrap;max-height:240px;overflow:auto">${esc((L.description || "").slice(0, 4000))}</pre></details>
      <div id="house-progress" class="progress" hidden></div></div>`);
    const prog = (h) => { const p = $("#house-progress"); p.hidden = false; p.innerHTML = h; };
    const after = async () => { S.trip = await loadTrip(S.trip.trip.id); renderTrip(currentTab); houseModal(id); };
    $("#nominate")?.addEventListener("click", async () => { const { error } = await sb.from("nominations").insert({ trip_id: S.trip.trip.id, household_id: mine, trip_listing_id: id, nominated_by: S.session.user.id }); if (error) return toast(error.message.replace(/^[a-z_]+: /, ""), 6000); toast("Nominated. It is on the ballot."); after(); });
    $("#withdraw")?.addEventListener("click", async () => { const { error } = await sb.from("nominations").delete().eq("id", myNom.id); if (error) return toast(error.message.replace(/^[a-z_]+: /, ""), 6000); after(); });
    $("#rescore")?.addEventListener("click", async () => { prog(`<span class="spinner"></span>Re-reading and re-scoring (about a minute)…`); try { await callFn("ingest", { action: "score", trip_id: S.trip.trip.id, trip_listing_id: id, reread: true }); after(); } catch (e) { prog(esc(e.message)); } });
    $("#f-window")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()); const { error } = await sb.from("availability_windows").insert({ listing_id: l.listing_id, start_date: f.start_date, end_date: f.end_date, status: f.status, source: "member", recorded_by: S.session.user.id }); if (error) return toast(error.message, 6000); after(); });
    $$("[data-av]").forEach((b) => b.onclick = async () => { const st = b.dataset.av; let note = null; if (st !== "unknown") { note = prompt(st === "available" ? "Optional: what did you see? (e.g. 'host confirmed June 12-19 open')" : "What did you learn? (e.g. 'host says booked that week')") ; if (note === null) return; } const { error } = await sb.from("trip_listings").update({ avail_status: st, avail_note: note || null, avail_by: S.session.user.id, avail_at: new Date().toISOString() }).eq("id", id); if (error) return toast(error.message, 6000); after(); });
  }

  // ---------------------------------------------------------------- dates (which week?)
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
  function seasonWeeks() {
    const t = S.trip.trip; if (!t.season_start || !t.season_end) return [];
    let d = new Date(t.season_start + "T00:00:00Z"); while (d.getUTCDay() !== 6) d = addDays(d, 1); // first Saturday
    const end = new Date(t.season_end + "T00:00:00Z"), out = [];
    while (addDays(d, t.nights) <= addDays(end, 1) && out.length < 30) { out.push({ start: iso(d), end: iso(addDays(d, t.nights)) }); d = addDays(d, 7); }
    return out;
  }
  const weekLabel = (w) => new Date(w.start + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  function weekStatus(listingId, w) {
    const ws = S.trip.windows.filter((x) => x.listing_id === listingId && overlaps(x.start_date, x.end_date, w.start, w.end));
    if (ws.some((x) => x.status === "booked")) return "booked";
    if (ws.some((x) => x.status === "available" && x.start_date <= w.start && x.end_date >= w.end)) return "open";
    return "unknown";
  }
  function householdChoice(hh, ws) {
    const ids = S.trip.members.filter((m) => m.household_id === hh).map((m) => m.user_id);
    const cs = S.trip.weekVotes.filter((v) => v.week_start === ws && ids.includes(v.user_id)).map((v) => v.choice);
    if (!cs.length) return ""; if (cs.includes("no")) return "no"; if (cs.includes("prefer")) return "prefer"; return "ok";
  }
  function renderDates(el) {
    const T = S.trip, weeks = seasonWeeks(), me = S.session.user.id;
    if (!weeks.length) { el.innerHTML = `<div class="card"><p>The organizer hasn't set the possible date range yet${isOrg() ? ` (<a href="#/new/${T.trip.id}/1">set it in step 1 of the wizard</a>)` : ""}.</p></div>`; return; }
    const mine = (ws) => T.weekVotes.find((v) => v.user_id === me && v.week_start === ws)?.choice || "";
    const hhs = T.households;
    const ranked = weeks.map((w) => { const ch = hhs.map((h) => householdChoice(h.id, w.start)); const open = T.listings.filter((l) => l.status === "scored" && l.avail_status !== "unavailable" && weekStatus(l.listing_id, w) === "open"); return { w, nos: ch.filter((c) => c === "no").length, prefers: ch.filter((c) => c === "prefer").length, oks: ch.filter((c) => c === "ok" || c === "prefer").length, answered: ch.filter(Boolean).length, open }; })
      .filter((r) => r.answered).sort((a, b) => (a.nos - b.nos) || (b.oks - a.oks) || (b.prefers - a.prefers) || (b.open.length - a.open.length)).slice(0, 5);
    el.innerHTML = `
      <div class="card stack"><h3>Which week works for you?</h3><p class="muted small">Tap each ${T.trip.nights}-night week starting on a Saturday and mark it. Everyone answers for themselves; results roll up by household. ${T.trip.check_in ? `<b>The organizer has set ${fmtDate(T.trip.check_in)} to ${fmtDate(T.trip.check_out)}.</b>` : ""}</p>
        <div class="table-wrap"><table class="t"><tr><th>Week of</th><th>Can't</th><th>Could</th><th>Prefer</th></tr>${weeks.map((w) => `<tr><td><b>${weekLabel(w)}</b> <span class="muted tiny">to ${weekLabel({ start: w.end })}</span></td>${["no", "ok", "prefer"].map((c) => `<td><button class="btn small ${mine(w.start) === c ? "primary" : ""}" data-wk="${w.start}" data-ch="${c}">${c === "no" ? "Can't" : c === "ok" ? "Could" : "Prefer"}</button></td>`).join("")}</tr>`).join("")}</table></div></div>
      <div class="card stack"><h3>By household</h3><div class="table-wrap"><table class="t"><tr><th>Week of</th>${hhs.map((h) => `<th>${esc(h.name)}</th>`).join("")}<th>Houses confirmed open</th></tr>${weeks.map((w) => `<tr><td><b>${weekLabel(w)}</b></td>${hhs.map((h) => { const c = householdChoice(h.id, w.start); return `<td>${c === "no" ? `<span class="tag warn">can't</span>` : c === "prefer" ? `<span class="tag ok">prefer</span>` : c === "ok" ? `<span class="tag neutral">could</span>` : `<span class="muted tiny">–</span>`}</td>`; }).join("")}<td class="tiny">${T.listings.filter((l) => weekStatus(l.listing_id, w) === "open").map((l) => esc(l.listings.title.slice(0, 24))).join(", ") || "<span class='muted'>none recorded</span>"}</td></tr>`).join("")}</table></div></div>
      ${ranked.length ? `<div class="card stack"><h3>Best weeks so far</h3>${ranked.map((r, i) => `<div class="rank-item"><div class="n">${i + 1}</div><div><b>Week of ${weekLabel(r.w)}</b> <span class="muted tiny">${r.nos ? `${r.nos} household${r.nos > 1 ? "s" : ""} can't` : "nobody is out"} · ${r.prefers} prefer · ${r.open.length} house${r.open.length === 1 ? "" : "s"} confirmed open</span></div><div class="ctl">${isOrg() ? `<button class="btn small" data-setweek="${r.w.start}|${r.w.end}">Make this our week</button>` : ""}</div></div>`).join("")}</div>` : ""}`;
    $$("[data-wk]", el).forEach((b) => b.onclick = async () => { const { error } = await sb.from("week_votes").upsert({ trip_id: T.trip.id, user_id: me, week_start: b.dataset.wk, choice: b.dataset.ch }); if (error) return toast(error.message, 6000); S.trip = await loadTrip(T.trip.id); renderTrip("dates"); });
    $$("[data-setweek]", el).forEach((b) => b.onclick = async () => { const [ci, co] = b.dataset.setweek.split("|"); if (!confirm(`Set the trip to ${fmtDate(ci)} to ${fmtDate(co)}?`)) return; const { error } = await sb.from("trips").update({ check_in: ci, check_out: co }).eq("id", T.trip.id); if (error) return toast(error.message, 6000); S.trip = await loadTrip(T.trip.id); renderTrip("dates"); toast("Dates set. Houses will be judged for that week from now on."); });
  }

  // ---------------------------------------------------------------- chat
  const nameOf = (uid) => S.trip.members.find((m) => m.user_id === uid)?.profiles?.display_name || "someone";
  function renderChat(el) {
    const T = S.trip;
    const msgs = T.messages;
    const tagOf = (m) => m.trip_listing_id ? T.listings.find((l) => l.id === m.trip_listing_id) : null;
    el.innerHTML = `<div class="card stack"><h3>Family chat</h3><p class="muted small">One thread for everyone. Tag a house so the conversation stays attached to it.</p>
      <div id="chat-list" style="max-height:55vh;overflow:auto;display:flex;flex-direction:column;gap:10px">${msgs.map((m) => { const t = tagOf(m); return `<div style="display:flex;gap:10px;align-items:flex-start"><div style="width:32px;height:32px;border-radius:50%;background:var(--accent-bg);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex:none">${esc(nameOf(m.user_id).split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase())}</div><div style="min-width:0"><div class="tiny"><b>${esc(nameOf(m.user_id))}</b> <span class="muted">${fmtDT(m.created_at)}</span>${t ? ` · <a href="#" data-open-house="${t.id}">🏠 ${esc(t.listings.title.slice(0, 40))}</a>` : ""}</div><div style="white-space:pre-wrap">${esc(m.body)}</div></div></div>`; }).join("") || `<p class="empty">No messages yet. Say hello.</p>`}</div>
      <form id="f-chat" class="stack"><textarea name="body" rows="2" maxlength="4000" placeholder="Say something…" required></textarea><div class="row"><select name="tag" style="max-width:320px"><option value="">No house tagged</option>${T.listings.map((l) => `<option value="${l.id}">${esc(l.listings.title.slice(0, 50))}</option>`).join("")}</select><button class="btn primary">Send</button></div></form></div>`;
    wireOpeners(el);
    const list = $("#chat-list"); list.scrollTop = list.scrollHeight;
    $("#f-chat").onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); const body = String(f.get("body")).trim(); if (!body) return; const { error } = await sb.from("messages").insert({ trip_id: T.trip.id, user_id: S.session.user.id, body, trip_listing_id: f.get("tag") || null }); if (error) return toast(error.message, 6000); S.trip = await loadTrip(T.trip.id); renderTrip("chat"); };
  }

  // ---------------------------------------------------------------- vote
  let ranking = null;
  function renderVote(el) {
    const T = S.trip, r = T.rules, m = r?.method || "irv", fin = onBallot(), mine = myHousehold();
    const myNoms = T.noms.filter((n) => n.household_id === mine);
    const nominees = T.listings.filter((l) => l.status === "scored" && l.avail_status !== "unavailable").sort((a, b) => (b.gate_pass - a.gate_pass) || (b.total - a.total));
    const head = `<div class="notice">${T.trip.status === "setup" ? "The organizer has not opened the trip yet." : `Decided by <b>${esc(methodName(m))}</b>. ${r?.nominations_close ? `Nominations ${locked() ? "closed" : "close"} ${fmtDT(r.nominations_close)}. ` : ""}${r?.voting_closes ? `Voting ${votingOpen() ? "closes" : "closed"} ${fmtDT(r.voting_closes)}. ` : ""}${T.members.length} people; ${r?.weighting === "person" ? "each adult counts once" : "each household counts once, split among its voters"}.`}</div>`;
    if (m === "score_only") { el.innerHTML = head + `<div class="card"><p>There is no ballot on this trip: the highest-scoring house that passes every deal-breaker and is available gets booked. See Results.</p></div>`; return; }
    if (m === "organizer") { el.innerHTML = head + `<div class="card"><p>The organizer decides after everyone has had a say. Nominate on the Houses tab and talk it over; there is no ballot.</p></div>`; return; }
    const nomBlock = `<div class="card stack"><h3>Nominate for ${esc(hhName(mine)) || "your household"}</h3><p class="muted small">Each household puts up to ${r?.nom_cap || 2} houses on the ballot. ${mine ? `Your household has used ${myNoms.length} of ${r?.nom_cap || 2}.` : "You are not in a household yet; pick one on the People tab."} A house several households nominate appears once.</p>
      ${nominees.map((l) => { const n = T.noms.find((x) => x.trip_listing_id === l.id && x.household_id === mine); return `<div class="rank-item"><div class="n">${l.total}</div><div><a href="#" data-open-house="${l.id}">${esc(l.listings.title)}</a> ${gateTag(l, true)} ${l.is_sponsored ? `<span class="tag sponsored">Sponsored</span>` : ""}<div class="muted tiny">${nomsFor(l.id).map((x) => "★ " + esc(hhName(x.household_id))).join(" · ")}</div></div><div class="ctl">${mine && !locked() && T.trip.status !== "setup" ? (n ? `<button data-withdraw="${n.id}" title="Withdraw">★ withdraw</button>` : `<button data-nom="${l.id}" ${myNoms.length >= (r?.nom_cap || 2) ? "disabled" : ""}>☆ nominate</button>`) : ""}</div></div>`; }).join("") || `<p class="empty">No scored houses to nominate yet.</p>`}</div>`;
    let ballotBlock = "";
    if (!fin.length) ballotBlock = `<div class="card"><p class="empty">Nothing is on the ballot yet. Nominate above.</p></div>`;
    else if (m === "irv" || m === "irv_veto") {
      if (ranking === null) ranking = (T.ballot?.ranking || []).filter((id) => fin.some((f) => f.id === id)); else ranking = ranking.filter((id) => fin.some((f) => f.id === id));
      const unranked = fin.filter((f) => !ranking.includes(f.id));
      const item = (l, i, inRank) => `<div class="rank-item"><div class="n">${inRank ? i + 1 : "·"}</div><div><a href="#" data-open-house="${l.id}">${esc(l.listings.title)}</a><div class="muted tiny">${l.total}/100${l.listings.price_night_cents ? " · " + money(l.listings.price_night_cents) + "/night" : ""}</div></div><div class="ctl">${inRank ? `<button data-mv="${l.id}" data-dir="-1" ${!votingOpen() ? "disabled" : ""}>▲</button><button data-mv="${l.id}" data-dir="1" ${!votingOpen() ? "disabled" : ""}>▼</button><button data-rm="${l.id}" ${!votingOpen() ? "disabled" : ""}>✕</button>` : `<button data-add="${l.id}" ${!votingOpen() ? "disabled" : ""}>＋</button>`}</div></div>`;
      const myVeto = T.vetoes.find((v) => v.household_id === mine);
      ballotBlock = `${m === "irv_veto" ? `<div class="card stack"><h3>Your household's veto</h3><p class="muted small">Each household may strike one house from the ballot before voting. ${myVeto ? `Yours: <b>${esc(T.listings.find((l) => l.id === myVeto.trip_listing_id)?.listings.title || "")}</b>.` : "You have not used yours."}</p>${!locked() && mine ? `<div class="row"><select id="veto-pick"><option value="">Choose a house to strike…</option>${T.listings.filter((l) => l.is_finalist).map((l) => `<option value="${l.id}" ${myVeto?.trip_listing_id === l.id ? "selected" : ""}>${esc(l.listings.title)}</option>`).join("")}</select><button class="btn small" id="veto-save">Save veto</button></div>` : ""}</div>` : ""}
        <div class="grid2"><div class="card stack"><h3>My ranking</h3><p class="muted tiny">1 = the house I most want us to book. Rank at least ${Math.min(r?.min_ranked || 1, fin.length)}. A house you leave out gets no points from you.</p><div>${ranking.length ? ranking.map((id, i) => item(fin.find((f) => f.id === id), i, true)).join("") : `<p class="empty">Tap ＋ on a house to start.</p>`}</div><div class="row"><button class="btn primary" id="save-vote" ${!votingOpen() || ranking.length < Math.min(r?.min_ranked || 1, fin.length) ? "disabled" : ""}>${T.ballot ? "Update my vote" : "Cast my vote"}</button>${T.ballot ? `<span class="muted tiny">Last saved ${fmtDT(T.ballot.updated_at)}</span>` : ""}</div></div>
        <div class="card stack"><h3>On the ballot</h3><div>${unranked.length ? unranked.map((l) => item(l, 0, false)).join("") : `<p class="empty">You've ranked them all.</p>`}</div></div></div>`;
    } else if (m === "approval") {
      const mineAp = new Set(T.ballot?.approvals || []);
      ballotBlock = `<div class="card stack"><h3>Check every house you would be happy with</h3>${fin.map((l) => `<label class="rank-item" style="cursor:pointer"><input type="checkbox" data-ap="${l.id}" ${mineAp.has(l.id) ? "checked" : ""} style="width:22px;height:22px;min-height:0"><span><a href="#" data-open-house="${l.id}">${esc(l.listings.title)}</a><div class="muted tiny">${l.total}/100</div></span><span></span></label>`).join("")}<div class="row"><button class="btn primary" id="save-vote" ${!votingOpen() ? "disabled" : ""}>${T.ballot ? "Update my vote" : "Cast my vote"}</button></div></div>`;
    } else if (m === "score") {
      const sc = T.ballot?.scores || {};
      ballotBlock = `<div class="card stack"><h3>Score each house, 1 to 5</h3>${fin.map((l) => `<div class="rank-item"><div class="n"></div><span><a href="#" data-open-house="${l.id}">${esc(l.listings.title)}</a><div class="muted tiny">${l.total}/100</div></span><select data-sc="${l.id}" style="min-width:80px"><option value="">–</option>${[1, 2, 3, 4, 5].map((v) => `<option ${sc[l.id] == v ? "selected" : ""}>${v}</option>`).join("")}</select></div>`).join("")}<div class="row"><button class="btn primary" id="save-vote" ${!votingOpen() ? "disabled" : ""}>${T.ballot ? "Update my vote" : "Cast my vote"}</button></div></div>`;
    }
    el.innerHTML = head + nomBlock + ballotBlock;
    wireOpeners(el);
    const reload = async (tab = "vote") => { S.trip = await loadTrip(T.trip.id); renderTrip(tab); };
    $$("[data-nom]", el).forEach((b) => b.onclick = async () => { const { error } = await sb.from("nominations").insert({ trip_id: T.trip.id, household_id: mine, trip_listing_id: b.dataset.nom, nominated_by: S.session.user.id }); if (error) return toast(error.message.replace(/^[a-z_]+: /, ""), 6000); reload(); });
    $$("[data-withdraw]", el).forEach((b) => b.onclick = async () => { const { error } = await sb.from("nominations").delete().eq("id", b.dataset.withdraw); if (error) return toast(error.message.replace(/^[a-z_]+: /, ""), 6000); reload(); });
    $$("[data-add]", el).forEach((b) => b.onclick = () => { ranking.push(b.dataset.add); renderVote(el); });
    $$("[data-rm]", el).forEach((b) => b.onclick = () => { ranking = ranking.filter((x) => x !== b.dataset.rm); renderVote(el); });
    $$("[data-mv]", el).forEach((b) => b.onclick = () => { const i = ranking.indexOf(b.dataset.mv), j = i + Number(b.dataset.dir); if (j < 0 || j >= ranking.length) return; [ranking[i], ranking[j]] = [ranking[j], ranking[i]]; renderVote(el); });
    $("#veto-save")?.addEventListener("click", async () => { const id = $("#veto-pick").value; if (!id) return; const { error } = await sb.from("vetoes").upsert({ trip_id: T.trip.id, household_id: mine, trip_listing_id: id, vetoed_by: S.session.user.id }); if (error) return toast(error.message.replace(/^[a-z_]+: /, ""), 6000); reload(); });
    $("#save-vote")?.addEventListener("click", async () => {
      const row = { trip_id: T.trip.id, user_id: S.session.user.id };
      if (m === "irv" || m === "irv_veto") row.ranking = ranking; else if (m === "approval") row.approvals = $$("[data-ap]:checked", el).map((i) => i.dataset.ap); else row.scores = Object.fromEntries($$("[data-sc]", el).filter((s) => s.value).map((s) => [s.dataset.sc, Number(s.value)]));
      const { error } = await sb.from("ballots").upsert(row); if (error) return toast(error.message.replace(/^[a-z_]+: /, ""), 7000);
      toast("Vote saved. You can change it any time before the deadline."); reload();
    });
  }

  // ---------------------------------------------------------------- results
  function renderResults(el) {
    const T = S.trip, r = T.rules, res = T.result;
    const canCount = isOrg() || !votingOpen() || r?.results_public || !r?.hide_results;
    const titleOf = (id) => T.listings.find((l) => l.id === id)?.listings.title || "(removed)";
    el.innerHTML = `<div class="card stack"><h3>Results</h3><p class="muted small">${esc(methodName(r?.method))}. ${r?.hide_results && votingOpen() && !isOrg() ? "Hidden until voting closes." : ""}</p>
      ${canCount ? `<div class="row"><button class="btn primary" id="count">Count the votes now</button>${isOrg() ? `<button class="btn" id="count-publish">Count and publish to everyone</button>` : ""}</div>` : ""}
      <div id="res-progress" class="progress" hidden></div>
      ${res && (res.published || isOrg()) ? `<div class="stack"><div class="muted tiny">Counted ${fmtDT(res.computed_at)}${res.published ? " · published" : " · visible to the organizer only"}</div>
        ${res.winner_trip_listing_id ? `<div class="notice">Winner: <b>${esc(titleOf(res.winner_trip_listing_id))}</b></div>` : ""}
        <ol>${(res.final_ranking || []).map((id) => `<li>${esc(titleOf(id))} <span class="muted tiny">${res.tally?.[id] != null ? "· " + Number(res.tally[id]).toFixed(2).replace(/\.00$/, "") + (res.method === "score" ? " avg" : res.method === "approval" ? " approvals" : " pts") : ""}</span></li>`).join("")}</ol>
        ${(res.rounds || []).length ? `<details><summary class="small">Round by round</summary><div class="table-wrap"><table class="t"><tr><th>Round</th>${(res.final_ranking || []).map((id) => `<th>${esc(titleOf(id)).slice(0, 18)}</th>`).join("")}<th>Dropped</th></tr>${res.rounds.map((rd, i) => `<tr><td>${i + 1}</td>${(res.final_ranking || []).map((id) => `<td>${rd.counts?.[id] != null ? Number(rd.counts[id]).toFixed(2).replace(/\.00$/, "") : ""}</td>`).join("")}<td class="tiny">${rd.eliminated ? esc(titleOf(rd.eliminated)) : rd.winner ? "winner found" : ""}</td></tr>`).join("")}</table></div></details>` : ""}
        <p class="muted tiny">If the winner can't be booked: ${r?.fallback === "next" ? "the next house in the final ranking is the pick, no re-vote." : r?.fallback === "revote" ? "voting re-opens for 48 hours on what's left." : "the organizer chooses from the top three."}</p></div>` : `<p class="empty">No count yet.</p>`}</div>`;
    const run = async (publish) => { const p = $("#res-progress"); p.hidden = false; p.innerHTML = `<span class="spinner"></span>Counting…`; try { await callFn("tally", { trip_id: T.trip.id, publish }); S.trip = await loadTrip(T.trip.id); renderTrip("results"); } catch (e) { p.innerHTML = esc(e.message); } };
    $("#count")?.addEventListener("click", () => run(false)); $("#count-publish")?.addEventListener("click", () => run(true));
  }

  // ---------------------------------------------------------------- people
  function renderPeople(el) {
    const T = S.trip;
    el.innerHTML = `<div class="grid2">
      <div class="card stack"><h3>Who's in</h3>${T.households.map((h) => `<div><b>${esc(h.name)}</b> <span class="muted tiny">${esc(h.home_town || "")}</span>${T.members.filter((m) => m.household_id === h.id).map((m) => `<div class="small">· ${esc(m.profiles?.display_name || m.profiles?.email || "")} ${m.role === "organizer" ? `<span class="tag info">organizer</span>` : ""}</div>`).join("") || `<div class="muted tiny">nobody yet</div>`}</div>`).join("")}${T.members.filter((m) => !m.household_id).length ? `<div><b>Not in a household yet</b>${T.members.filter((m) => !m.household_id).map((m) => `<div class="small">· ${esc(m.profiles?.display_name || "")}</div>`).join("")}</div>` : ""}</div>
      <div class="card stack"><h3>You</h3><label class="f">Your household <select id="my-hh"><option value="">Choose…</option>${T.households.map((h) => `<option value="${h.id}" ${T.me?.household_id === h.id ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</select></label><p class="muted tiny">Your household is your voting unit and your nomination allowance.</p>
        ${T.me?.role !== "viewer" ? `<h3>Invite people</h3><p class="small">Share this link: <code>${esc(location.origin + location.pathname)}#/join/${esc(T.trip.invite_code)}</code> (or the code <b style="letter-spacing:.06em">${esc(T.trip.invite_code)}</b>). Or let us email it:</p>
        <form id="f-invite" class="stack"><label class="f">Email addresses, separated by commas <textarea name="emails" rows="2" placeholder="mom@example.com, uncle.bob@example.com"></textarea></label><label class="f">A note from you (optional) <input name="note" placeholder="e.g. Add any house you like by Friday; we vote the week after."></label><button class="btn">Send invitations</button></form><p id="invite-msg" class="msg" hidden></p>` : ""}</div></div>`;
    $("#f-invite")?.addEventListener("submit", async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector("button"); b.disabled = true; const el = $("#invite-msg");
      try { const r = await callFn("invite", { trip_id: T.trip.id, emails: f.get("emails"), note: f.get("note") }); el.hidden = false; el.className = "msg ok"; el.textContent = `Sent ${r.sent} invitation${r.sent === 1 ? "" : "s"}.`; e.target.reset(); }
      catch (err) { el.hidden = false; el.className = "msg"; el.textContent = err.message; } finally { b.disabled = false; }
    });
    $("#my-hh").onchange = async (e) => { const { error } = await sb.from("memberships").update({ household_id: e.target.value || null }).eq("trip_id", T.trip.id).eq("user_id", S.session.user.id); if (error) return toast(error.message, 6000); S.trip = await loadTrip(T.trip.id); renderTrip("people"); toast("Saved."); };
  }

  // ---------------------------------------------------------------- settings (organizer)
  function renderSettings(el) {
    const T = S.trip, t = T.trip, r = T.rules;
    const dtLocal = (s) => s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    el.innerHTML = `<div class="grid2">
      <div class="card stack"><h3>Status</h3><p class="small">Now: <b>${esc(t.status)}</b></p><div class="row">
        ${t.status === "setup" ? `<button class="btn primary" data-st="open">Open the trip to the group</button>` : ""}
        ${t.status === "open" ? `<button class="btn" data-st="voting">Lock the ballot and start voting</button>` : ""}
        ${["open", "locked", "voting"].includes(t.status) ? `<button class="btn" data-st="decided">Mark decided</button>` : ""}
        ${t.status === "decided" ? `<button class="btn" data-st="archived">Archive</button>` : ""}</div>
        <p class="muted tiny">Opening lets members join, add places and houses, and nominate. Locking fixes the ballot. Deadlines below do the same automatically.</p>
        <a class="btn" href="#/new/${t.id}">Edit the trip, households and rules (wizard)</a></div>
      <div class="card stack"><h3>How the group decides</h3>
        <label class="f">Method <select id="s-method">${[["irv", "Ranked choice"], ["approval", "Approve any you'd accept"], ["score", "Score each one 1 to 5"], ["irv_veto", "Ranked choice with one veto per household"], ["score_only", "Highest score wins, no vote"], ["organizer", "Organizer decides, with input"]].map(([v, l]) => `<option value="${v}" ${r?.method === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="f">Weighting <select id="s-weighting"><option value="household" ${r?.weighting === "household" ? "selected" : ""}>Each household counts once</option><option value="person" ${r?.weighting === "person" ? "selected" : ""}>Each adult counts once</option></select></label>
        <div class="grid2"><label class="f">Nominations per household <input id="s-cap" type="number" min="1" max="20" value="${r?.nom_cap ?? 2}"></label><label class="f">Rank at least <input id="s-min" type="number" min="1" max="20" value="${r?.min_ranked ?? 3}"></label></div>
        <div class="grid2"><label class="f">Nominations lock <input id="s-lock" type="datetime-local" value="${dtLocal(r?.nominations_close)}"></label><label class="f">Voting closes <input id="s-close" type="datetime-local" value="${dtLocal(r?.voting_closes)}"></label></div>
        <label class="f"><span><input type="checkbox" id="s-hide" ${r?.hide_results ? "checked" : ""} style="width:18px;height:18px;min-height:0;vertical-align:middle"> Hide results until voting closes</span></label>
        <label class="f"><span><input type="checkbox" id="s-blind" ${r?.blind_submitters ? "checked" : ""} style="width:18px;height:18px;min-height:0;vertical-align:middle"> Judge the house, not the person (hide who added it)</span></label>
        <label class="f">If the winner can't be booked <select id="s-fallback"><option value="next" ${r?.fallback === "next" ? "selected" : ""}>Next in the final ranking, no re-vote</option><option value="revote" ${r?.fallback === "revote" ? "selected" : ""}>Re-open voting for 48 hours</option><option value="organizer" ${r?.fallback === "organizer" ? "selected" : ""}>Organizer chooses from the top three</option></select></label>
        <div class="grid2"><label class="f">Check-in <input id="s-in" type="date" value="${t.check_in || ""}"></label><label class="f">Check-out <input id="s-out" type="date" value="${t.check_out || ""}"></label></div>
        <button class="btn primary" id="s-save">Save</button></div></div>`;
    $$("[data-st]", el).forEach((b) => b.onclick = async () => { if (b.dataset.st === "decided" && !confirm("Mark this trip decided? Nominations and votes close.")) return; const { error } = await sb.from("trips").update({ status: b.dataset.st }).eq("id", t.id); if (error) return toast(error.message, 6000); S.trip = await loadTrip(t.id); renderTrip("settings"); toast("Status updated."); });
    $("#s-save").onclick = async () => {
      const toIso = (v) => v ? new Date(v).toISOString() : null;
      const { error } = await sb.from("trip_rules").update({ method: $("#s-method").value, weighting: $("#s-weighting").value, nom_cap: Number($("#s-cap").value) || 2, min_ranked: Number($("#s-min").value) || 1, nominations_close: toIso($("#s-lock").value), voting_closes: toIso($("#s-close").value), hide_results: $("#s-hide").checked, blind_submitters: $("#s-blind").checked, fallback: $("#s-fallback").value }).eq("trip_id", t.id);
      if (error) return toast(error.message, 6000);
      const ci = $("#s-in").value || null, co = $("#s-out").value || null;
      if (ci !== t.check_in || co !== t.check_out) { const { error: e2 } = await sb.from("trips").update({ check_in: ci, check_out: co }).eq("id", t.id); if (e2) return toast(e2.message, 6000); }
      S.trip = await loadTrip(t.id); renderTrip("settings"); toast("Saved.");
    };
  }

  // ---------------------------------------------------------------- routing
  let pendingJoin = null;
  async function route() {
    closeModal();
    let h = location.hash || "#/";
    const qJoin = new URLSearchParams(location.search).get("join");
    if (qJoin) pendingJoin = qJoin.toUpperCase();
    if (/^#(access_token|error|type)=/.test(h) || /[#&]type=(magiclink|recovery|signup|invite)/.test(h) || location.search) {
      // the sign-in link brought us here; supabase-js has read the tokens, so tidy the address and carry on
      const rec = /type=recovery/.test(h);
      const errDesc = (h.match(/error_description=([^&]+)/) || [])[1];
      h = rec ? "#/password" : (pendingJoin ? `#/join/${pendingJoin}` : "#/");
      history.replaceState(null, "", location.pathname + h);
      if (errDesc) toast(decodeURIComponent(errDesc.replace(/\+/g, " ")), 8000);
      if (!S.session) { const { data: { session } } = await sb.auth.getSession(); S.session = session; }
      return route();
    }
    const j = h.match(/^#\/join\/([A-Za-z0-9]+)/);
    if (j) pendingJoin = j[1].toUpperCase();
    if (!S.session) { $("#userchip").hidden = true; renderAuth(pendingJoin); return; }
    if (!S.profile) await loadProfile();
    if (h.startsWith("#/password")) { renderPassword(); return; }
    if (pendingJoin) {
      const code = pendingJoin; pendingJoin = null;
      const { data, error } = await sb.rpc("join_trip", { code, name: S.profile?.display_name || null });
      if (error) { toast(error.message.replace(/^[a-z_]+: /, ""), 7000); go("#/"); return; }
      toast("You're in. Pick your household below.", 5000); go(`#/trip/${data}/people`); return;
    }
    const m = h.match(/^#\/trip\/([0-9a-f-]+)(?:\/([a-z]+))?/), w = h.match(/^#\/new(?:\/([0-9a-f-]+))?/);
    if (w) { $("#app").innerHTML = `<p class="progress"><span class="spinner"></span>Loading…</p>`; await window.Wizard.render(w[1] || null); return; }
    if (m) {
      if (S.trip?.trip.id !== m[1]) { $("#app").innerHTML = `<p class="progress"><span class="spinner"></span>Loading the trip…</p>`; S.trip = await loadTrip(m[1]); if (!S.trip) { $("#app").innerHTML = `<div class="card"><p>You are not a member of that trip. <a href="#/">Back to your trips</a></p></div>`; return; } watch(m[1]); resumed = false; }
      renderTrip(m[2] || "overview"); resumePending(); return;
    }
    S.trip = null; await renderHome();
  }
  window.addEventListener("hashchange", route);
  boot();
})();
