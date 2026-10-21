/* The setup wizard. Six steps; everything saves to the database as you go, so an organizer can leave and come back. */
window.Wizard = (() => {
  let T = null;            // { trip, households, constraints, rules, templates }
  let step = 1;
  const STEPS = [["The trip", "Who, when, how long"], ["Households", "Where everyone starts from"], ["Deal-breakers", "What rules a place out"], ["Priorities", "How the 100 points split"], ["Deciding", "Vote method and deadlines"], ["Review", "The rules, in writing"]];
  const g = () => window.TD;

  async function load(tripId) {
    const { sb } = g();
    const [trip, hh, cs, rules, tpl] = await Promise.all([
      sb.from("trips").select("*").eq("id", tripId).maybeSingle(), sb.from("households").select("*").eq("trip_id", tripId).order("sort"),
      sb.from("constraints").select("*").eq("trip_id", tripId).order("sort"), sb.from("trip_rules").select("*").eq("trip_id", tripId).maybeSingle(),
      sb.from("constraint_templates").select("*").eq("active", true).order("sort"),
    ]);
    T = { trip: trip.data, households: hh.data || [], constraints: cs.data || [], rules: rules.data, templates: tpl.data || [] };
  }
  async function render(tripId) {
    const { sb } = g();
    const m = location.hash.match(/^#\/new\/[0-9a-f-]+\/(\d)/); step = m ? Number(m[1]) : 1;
    if (tripId) { await load(tripId); if (!T.trip) { g().$("#app").innerHTML = `<div class="card"><p>Trip not found. <a href="#/">Back</a></p></div>`; return; } }
    else { const { data: tpl } = await sb.from("constraint_templates").select("*").eq("active", true).order("sort"); T = { trip: null, households: [], constraints: [], rules: null, templates: tpl || [] }; step = 1; }
    draw();
  }
  const goStep = (n) => { if (!T.trip) return; location.hash = `#/new/${T.trip.id}/${n}`; };

  function draw() {
    const { $, $$, esc } = g();
    const body = [stepTrip, stepHouseholds, stepGates, stepPriorities, stepDeciding, stepReview][step - 1];
    $("#app").innerHTML = `
      <div><a href="#/" class="muted tiny">← Your trips</a><h1>${esc(STEPS[step - 1][0])}</h1><div class="muted">${esc(STEPS[step - 1][1])} · step ${step} of 6${T.trip ? " · saved as you go" : ""}</div></div>
      <div class="steps">${STEPS.map(([l], i) => `<button class="s ${i + 1 === step ? "cur" : i + 1 < step ? "done" : ""}" data-step="${i + 1}" ${T.trip ? "" : "disabled"}>${i + 1}. ${l}</button>`).join("")}</div>
      <div id="wiz"></div>
      <div class="row" style="justify-content:space-between"><button class="btn" id="back" ${step === 1 ? "style='visibility:hidden'" : ""}>Back</button>${step < 6 ? `<button class="btn primary" id="next">${step === 5 ? "Review the rules" : "Next: " + STEPS[step][0]}</button>` : ""}</div>`;
    $$("[data-step]").forEach((b) => b.onclick = () => goStep(Number(b.dataset.step)));
    $("#back").onclick = () => goStep(step - 1);
    body($("#wiz"));
  }

  // ---- 1 trip
  function stepTrip(el) {
    const { $, esc, sb, S, toast } = g(); const t = T.trip || {};
    el.innerHTML = `<form id="f-trip" class="card stack">
      <p class="muted small">Plain answers are fine. The site turns these into the rules every option is judged by, and shows you those rules before anyone is invited.</p>
      <div class="grid2">
        <label class="f">Name of the trip <input name="title" required value="${esc(t.title || "")}" placeholder="e.g. Pumilia reunion 2027"></label>
        <label class="f">What kind of place? <select name="kind">${[["house", "One big house for everyone"], ["cluster", "Several houses or cabins close together"], ["resort", "A resort or hotel block"], ["destination", "A destination first, lodging later"]].map(([v, l]) => `<option value="${v}" ${t.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="f">Earliest possible start <input name="season_start" type="date" value="${t.season_start || ""}"></label>
        <label class="f">Latest possible end <input name="season_end" type="date" value="${t.season_end || ""}"></label>
        <label class="f">How many nights <input name="nights" type="number" min="1" max="60" value="${t.nights || 7}"></label>
        <label class="f">We need to book by <input name="book_by" type="date" value="${t.book_by || ""}"></label>
        <label class="f">Adults <input name="adults" type="number" min="1" max="200" value="${t.adults || ""}"></label>
        <label class="f">Kids' ages, comma separated <input name="kids" value="${(t.kids_ages || []).join(", ")}" placeholder="e.g. 11, 8, 4, 2"></label>
      </div>
      <label class="f">Anything else the scorer should know about the group <textarea name="description" rows="2" placeholder="e.g. one grandparent with a bad knee; two of us work remotely; we always cook one big dinner">${esc(t.description || "")}</textarea></label>
      <button class="btn primary">${T.trip ? "Save" : "Save and continue"}</button></form>`;
    const save = async () => {
      const f = Object.fromEntries(new FormData($("#f-trip")).entries());
      const row = { title: f.title.trim(), kind: f.kind, season_start: f.season_start || null, season_end: f.season_end || null, nights: Number(f.nights) || 7, book_by: f.book_by || null, adults: f.adults ? Number(f.adults) : null, kids_ages: f.kids.split(/[,\s]+/).map((x) => parseInt(x)).filter((n) => Number.isFinite(n)), description: f.description.trim() || null };
      if (!row.title) return toast("Give the trip a name.");
      if (T.trip) { const { error } = await sb.from("trips").update(row).eq("id", T.trip.id); if (error) return toast(error.message, 6000); Object.assign(T.trip, row); return true; }
      const slug = row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
      const { data, error } = await sb.from("trips").insert({ ...row, slug, organizer_id: S.session.user.id }).select("*").single();
      if (error) return toast(error.message, 6000);
      T.trip = data; return true;
    };
    $("#f-trip").onsubmit = async (e) => { e.preventDefault(); if (await save()) { if (step === 1 && location.hash.indexOf(T.trip.id) < 0) goStep(2); else toast("Saved."); } };
    $("#next").onclick = async () => { if (await save()) goStep(2); };
  }

  // ---- 2 households
  function stepHouseholds(el) {
    const { $, $$, esc, sb, S, toast } = g();
    el.innerHTML = `<div class="card stack">
      <p class="muted small">Each household is one voting unit and one starting point for travel. The site estimates flights and driving from each home town to every place you consider.</p>
      <div class="table-wrap"><table class="t"><tr><th>Household</th><th>Travels from</th><th>Airports</th><th></th></tr>${T.households.map((h) => `<tr><td><b>${esc(h.name)}</b></td><td>${esc(h.home_town || "")}${h.lat != null ? "" : ` <span class="tag sun">not on the map</span>`}</td><td class="muted">${esc((h.airports || []).join(" / "))}</td><td><button class="btn small" data-del="${h.id}">Remove</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">No households yet. Add yours first.</td></tr>`}</table></div>
      <form id="f-hh" class="grid3" style="align-items:end"><label class="f">Household name <input name="name" required placeholder="e.g. The Nashville crew"></label><label class="f">Home town <input name="home_town" required placeholder="e.g. Nashville, TN"></label><label class="f">Airports (optional) <input name="airports" placeholder="e.g. BNA"></label><button class="btn">Add household</button></form>
      <label class="f">Which household are you in? <select id="my-hh"><option value="">Choose…</option>${T.households.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join("")}</select></label></div>`;
    sb.from("memberships").select("household_id").eq("trip_id", T.trip.id).eq("user_id", S.session.user.id).maybeSingle().then(({ data }) => { if (data?.household_id) $("#my-hh").value = data.household_id; });
    $("#my-hh").onchange = async (e) => { await sb.from("memberships").update({ household_id: e.target.value || null }).eq("trip_id", T.trip.id).eq("user_id", S.session.user.id); toast("Saved."); };
    $("#f-hh").onsubmit = async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries()); const b = e.target.querySelector("button"); b.disabled = true;
      let lat = null, lng = null;
      try { const q = f.home_town.split(",")[0].trim(); const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`).then((x) => x.json()); const region = (f.home_town.split(",")[1] || "").trim().toLowerCase(); const hit = (r.results || []).find((x) => !region || (x.admin1 || "").toLowerCase().startsWith(region) || (x.admin1 || "").toLowerCase().includes(region)) || (r.results || [])[0]; if (hit) { lat = hit.latitude; lng = hit.longitude; } } catch { /* fine */ }
      const { error } = await sb.from("households").insert({ trip_id: T.trip.id, name: f.name.trim(), home_town: f.home_town.trim(), lat, lng, airports: f.airports.split(/[\s,/]+/).map((x) => x.trim().toUpperCase()).filter(Boolean), sort: T.households.length });
      if (error) { toast(error.message, 6000); b.disabled = false; return; }
      await load(T.trip.id); draw();
    };
    $$("[data-del]", el).forEach((b) => b.onclick = async () => { await sb.from("households").delete().eq("id", b.dataset.del); await load(T.trip.id); draw(); });
    $("#next").onclick = () => T.households.length ? goStep(3) : toast("Add at least one household first.");
  }

  // ---- shared: constraint rows from templates and drafts
  const fill = (s, p) => String(s || "").replace(/\{param\}/g, p == null ? "" : String(p));
  const rowFromTemplate = (t, param, weight) => ({ trip_id: T.trip.id, template_key: t.key, kind: t.kind, applies_to: t.applies_to, label: t.label, rule_text: fill(t.description, param), rubric: fill(t.rubric, param ?? t.param_default), check_method: t.check_method, auto_check: t.auto_check, param: param ?? t.param_default, host_question: t.host_question, weight: t.kind === "criterion" ? (weight ?? t.default_weight) : 0, sort: t.sort, created_by: g().S.session.user.id });
  const existingFor = (key) => T.constraints.find((c) => c.template_key === key);

  function customBox(el, kindHint) {
    const { $, esc, toast, callFn, sb, S } = g();
    const box = document.createElement("div"); box.className = "card stack"; box.style.borderColor = "var(--accent)";
    box.innerHTML = `<h3>Something that isn't on the list? Type it.</h3><p class="muted tiny">Write it the way you'd say it to a relative. The site rewrites it as a rule it can check, says how it will check it, and lets you decide whether it's a deal-breaker or just a priority.</p>
      <div class="row"><textarea id="custom-text" style="flex:1 1 320px;min-height:56px" placeholder="${kindHint === "gate" ? "e.g. Grandma can't do stairs · within 30 minutes of a hospital · my brother is allergic to cats" : "e.g. a big porch for the adults after the kids are down · good barbecue nearby"}"></textarea><button class="btn primary" id="custom-go">Turn it into a rule</button></div><div id="custom-out"></div>`;
    el.appendChild(box);
    $("#custom-go").onclick = async () => {
      const text = $("#custom-text").value.trim(); if (text.length < 3) return;
      const out = $("#custom-out"); out.innerHTML = `<p class="progress"><span class="spinner"></span>Reading it… (about 10 seconds)</p>`; $("#custom-go").disabled = true;
      try {
        const r = await callFn("rules", { trip_id: T.trip.id, text });
        $("#custom-go").disabled = false;
        if (!r.understood) { out.innerHTML = `<p class="msg">${esc(r.reasoning || "That doesn't look like a rule about a place. Try again?")}</p>`; return; }
        let d = r.draft;
        const show = () => {
          const kindLabel = { gate: ["Deal-breaker", "warn"], criterion: ["Priority, worth points", "ok"], checklist: ["Host checklist only", "sun"] }[d.kind];
          out.innerHTML = `<div class="draft">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="muted tiny">You wrote: “${esc(text)}”</span><span class="tag ${kindLabel[1]}">${kindLabel[0]}</span></div>
            <div style="font-weight:800;font-size:16px">${esc(d.rule_text)}</div>
            ${r.template ? `<p class="msg info">This is the same as the common rule “${esc(r.template.label)}”. You can switch that one on instead of adding a duplicate.</p>` : ""}
            <div class="grid2"><div><div class="muted tiny" style="font-weight:700">How the site will check it</div><div class="small">${d.check_method === "auto" ? "Automatically, from map and travel data." : d.check_method === "listing" ? "From the listing text and photos." : "From the listing if it says; otherwise by asking the host."} ${esc(d.ai_reasoning || "")}</div></div><div><div class="muted tiny" style="font-weight:700">Question for the host</div><div class="small">${esc(d.host_question || "None needed.")}</div></div></div>
            ${d.kind === "criterion" ? `<label class="f">Worth about how many points? <input id="draft-weight" type="number" min="1" max="40" value="${d.weight}" style="max-width:120px"></label>` : ""}
            <div class="row"><button class="btn primary" id="draft-accept">${d.kind === "gate" ? "Add as a deal-breaker" : d.kind === "criterion" ? "Add as a priority" : "Add to the host checklist"}</button>${d.kind !== "checklist" ? `<button class="btn" id="draft-flip">${d.kind === "gate" ? "Make it a priority instead" : "Make it a deal-breaker instead"}</button>` : ""}<button class="btn ghost" id="draft-discard">Discard</button></div></div>`;
          $("#draft-flip")?.addEventListener("click", () => { d = { ...d, kind: d.kind === "gate" ? "criterion" : "gate", weight: d.kind === "gate" ? Math.max(3, d.weight || 5) : 0 }; show(); });
          $("#draft-discard").onclick = () => { out.innerHTML = ""; };
          $("#draft-accept").onclick = async () => {
            const w = d.kind === "criterion" ? Number($("#draft-weight")?.value) || d.weight || 5 : 0;
            const { error } = await sb.from("constraints").insert({ ...d, weight: w, trip_id: T.trip.id, as_written: text, created_by: S.session.user.id, sort: 500 + T.constraints.length });
            if (error) return toast(error.message, 6000);
            toast("Added."); $("#custom-text").value = ""; await load(T.trip.id); draw();
          };
        };
        show();
      } catch (e) { $("#custom-go").disabled = false; out.innerHTML = `<p class="msg">${esc(e.message)}</p>`; }
    };
  }
  const customList = (kinds) => {
    const { esc } = g();
    const rows = T.constraints.filter((c) => !c.template_key && kinds.includes(c.kind));
    return rows.length ? `<div class="card stack"><div class="muted tiny" style="font-weight:700">Your own rules</div>${rows.map((c) => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line2);padding-top:8px"><span class="tag ${c.kind === "gate" ? "warn" : c.kind === "criterion" ? "ok" : "sun"}">${c.kind === "gate" ? "Deal-breaker" : c.kind === "criterion" ? `Priority · ${c.weight} pts` : "Host checklist"}</span><span style="font-weight:700;flex:1 1 240px">${esc(c.rule_text)}</span><span class="muted tiny">${c.check_method === "auto" ? "checked automatically" : c.check_method === "listing" ? "read from the listing" : "asked of the host"}</span><button class="btn small" data-rm="${c.id}">Remove</button></div>`).join("")}</div>` : "";
  };
  const wireRemove = (el) => g().$$("[data-rm]", el).forEach((b) => b.onclick = async () => { await g().sb.from("constraints").delete().eq("id", b.dataset.rm); await load(T.trip.id); draw(); });

  // ---- 3 deal-breakers
  function stepGates(el) {
    const { $$, esc, sb, toast } = g();
    const gates = T.templates.filter((t) => t.kind === "gate");
    el.innerHTML = `<div class="card stack"><p class="muted small">A place that fails any of these is out, no matter how nice it is. Turn on the ones that apply and set the number. Each one says how the site checks it.</p>
      <div class="grid2">${gates.map((t) => { const ex = existingFor(t.key); return `<div class="tog ${ex ? "on" : ""}" data-key="${t.key}" style="cursor:default"><button class="btn small ${ex ? "primary" : ""}" data-toggle="${t.key}" style="align-self:flex-start">${ex ? "On" : "Off"}</button><b>${esc(t.label)}</b><span class="muted tiny">${esc(t.description)}</span>${t.param_label ? `<label class="f" ${ex ? "" : "hidden"}>${esc(t.param_label)} <input data-param="${t.key}" value="${esc(ex?.param ?? t.param_default ?? "")}" style="max-width:180px"></label>` : ""}<span class="tag ${t.check_method === "auto" ? "ok" : t.check_method === "host" ? "sun" : "info"}">${t.check_method === "auto" ? "Automatic, from map or travel data" : t.check_method === "host" ? "From the listing, then the host" : "From the listing"}</span></div>`; }).join("")}</div></div>
      ${customList(["gate", "checklist"])}`;
    customBox(el, "gate"); wireRemove(el);
    $$("[data-toggle]", el).forEach((b) => b.onclick = async () => {
      const t = gates.find((x) => x.key === b.dataset.toggle), ex = existingFor(t.key);
      if (ex) await sb.from("constraints").delete().eq("id", ex.id);
      else { const p = el.querySelector(`[data-param="${t.key}"]`)?.value || t.param_default; const { error } = await sb.from("constraints").insert(rowFromTemplate(t, p)); if (error) return toast(error.message, 6000); }
      await load(T.trip.id); draw();
    });
    $$("[data-param]", el).forEach((i) => i.onchange = async () => { const t = gates.find((x) => x.key === i.dataset.param), ex = existingFor(t.key); if (!ex) return; await sb.from("constraints").update({ param: i.value, rubric: fill(t.rubric, i.value), rule_text: fill(t.description, i.value) }).eq("id", ex.id); toast("Saved."); await load(T.trip.id); });
    g().$("#next").onclick = () => goStep(4);
  }

  // ---- 4 priorities
  function stepPriorities(el) {
    const { $$, esc, sb, toast } = g();
    const crits = T.templates.filter((t) => t.kind === "criterion");
    const rows = crits.map((t) => ({ t, ex: existingFor(t.key), w: existingFor(t.key)?.weight ?? (existingFor(t.key) ? 0 : (T.constraints.length ? 0 : t.default_weight)) }));
    const custom = T.constraints.filter((c) => !c.template_key && c.kind === "criterion");
    const sum = rows.reduce((a, r) => a + (r.ex ? r.ex.weight : 0), 0) + custom.reduce((a, c) => a + c.weight, 0) || 1;
    const pts = (w) => Math.round(100 * w / sum);
    el.innerHTML = `<div class="card stack"><p class="muted small">Every place gets a score out of 100. You decide how the 100 points are split. Slide anything to zero to ignore it. Rules you typed and marked as priorities appear here too.</p>
      ${rows.map(({ t, ex }) => `<div class="prio"><div><b>${esc(t.label)}</b><div class="muted tiny">${esc(t.description)}</div></div><div class="slider"><input type="range" min="0" max="40" value="${ex ? ex.weight : 0}" data-w="${t.key}"></div><div style="text-align:right"><b style="font-size:18px">${ex ? pts(ex.weight) : 0}</b> <span class="muted tiny">pts</span></div></div>`).join("")}
      ${custom.map((c) => `<div class="prio"><div><b>${esc(c.label)}</b> <span class="tag ok">yours</span><div class="muted tiny">${esc(c.rule_text)}</div></div><div class="slider"><input type="range" min="1" max="40" value="${c.weight}" data-wc="${c.id}"></div><div style="text-align:right"><b style="font-size:18px">${pts(c.weight)}</b> <span class="muted tiny">pts</span> <button class="btn small ghost" data-rm="${c.id}">✕</button></div></div>`).join("")}
      ${!T.constraints.some((c) => c.kind === "criterion") ? `<div class="row"><button class="btn" id="use-defaults">Start from the usual split</button><span class="muted tiny">Sleeping plan 25 · travel 20 · kids 15 · nature 15 · value 10 · kitchen 10 · reviews 5</span></div>` : ""}</div>`;
    customBox(el, "criterion"); wireRemove(el);
    const saveW = async (key, w) => { const t = crits.find((x) => x.key === key), ex = existingFor(key); if (!w) { if (ex) await sb.from("constraints").delete().eq("id", ex.id); } else if (ex) await sb.from("constraints").update({ weight: w }).eq("id", ex.id); else await sb.from("constraints").insert(rowFromTemplate(t, null, w)); await load(T.trip.id); draw(); };
    $$("[data-w]", el).forEach((i) => i.onchange = () => saveW(i.dataset.w, Number(i.value)));
    $$("[data-wc]", el).forEach((i) => i.onchange = async () => { await sb.from("constraints").update({ weight: Number(i.value) || 1 }).eq("id", i.dataset.wc); await load(T.trip.id); draw(); });
    g().$("#use-defaults")?.addEventListener("click", async () => { const { error } = await sb.from("constraints").insert(crits.filter((t) => t.default_weight > 0).map((t) => rowFromTemplate(t, null, t.default_weight))); if (error) return toast(error.message, 6000); await load(T.trip.id); draw(); });
    g().$("#next").onclick = () => T.constraints.some((c) => c.kind === "criterion") ? goStep(5) : toast("Pick at least one priority, or start from the usual split.");
  }

  // ---- 5 deciding
  function stepDeciding(el) {
    const { $, $$, sb, toast } = g(); const r = T.rules || {};
    const methods = [["irv", "Ranked choice", "Everyone ranks the finalists. The last-place option is dropped and its votes move to the next choice until one has a majority.", "Best with four or more finalists when you want a winner most people can live with."], ["approval", "Approve any you'd accept", "Each voter checks every option they'd be happy with. Most checks wins.", "Best for a quick, low-drama decision with few options."], ["score", "Score each one", "Give every finalist 1 to 5. Highest average wins.", "Best when intensity matters: one family's strong objection should count."], ["irv_veto", "Ranked choice with one veto", "Each household may strike one option before voting. Then ranked choice on the rest.", "Best when there's a house someone truly can't accept but won't say why in the group chat."], ["score_only", "Highest score wins, no vote", "The rubric decides. Nobody votes; the top-scoring available place is booked.", "Best when the group agreed on the criteria and wants to skip the politics."], ["organizer", "Organizer decides, with input", "Everyone nominates and comments; the organizer picks and explains why.", "Best when one person is paying or doing all the work."]];
    const dtLocal = (s) => s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    el.innerHTML = `<div class="card stack"><p class="muted small">Pick the method now, before anyone has a favorite. The rules get written out on the next page so everyone agrees to them up front.</p>
      <div class="grid2">${methods.map(([v, l, d, b]) => `<button class="tog ${(r.method || "irv") === v ? "on" : ""}" data-m="${v}"><b>${l}</b><span class="muted tiny">${d}</span><span class="tiny" style="color:var(--accent);font-weight:700">${b}</span></button>`).join("")}</div>
      <div class="grid2"><button class="tog ${(r.weighting || "household") === "household" ? "on" : ""}" data-wt="household"><b>Each household counts once</b><span class="muted tiny">If two people in a household both vote, their ballots count half each.</span></button><button class="tog ${r.weighting === "person" ? "on" : ""}" data-wt="person"><b>Each adult counts once</b><span class="muted tiny">Simple head count. Fair when households are about the same size.</span></button></div>
      <div class="grid3"><label class="f">Nominations per household <input id="d-cap" type="number" min="1" max="20" value="${r.nom_cap ?? 2}"></label><label class="f">Nominations lock on <input id="d-lock" type="datetime-local" value="${dtLocal(r.nominations_close)}"></label><label class="f">Voting closes <input id="d-close" type="datetime-local" value="${dtLocal(r.voting_closes)}"></label></div>
      <div class="grid2"><button class="tog ${r.hide_results !== false ? "on" : ""}" id="d-hide"><b>${r.hide_results !== false ? "Results hidden until voting closes" : "Results visible as votes come in"}</b><span class="muted tiny">Hiding the tally until the deadline stops people from voting against the leader.</span></button><button class="tog ${r.blind_submitters !== false ? "on" : ""}" id="d-blind"><b>${r.blind_submitters !== false ? "Judge the house, not the person" : "Show who added each house"}</b><span class="muted tiny">Who added a house shows only in the fine print.</span></button></div>
      <label class="f">If the winner can't be booked when we call <select id="d-fallback"><option value="next" ${r.fallback === "next" ? "selected" : ""}>The next place in the final ranking is the pick. No re-vote.</option><option value="revote" ${r.fallback === "revote" ? "selected" : ""}>Re-open voting for 48 hours on what's left.</option><option value="organizer" ${r.fallback === "organizer" ? "selected" : ""}>The organizer chooses from the top three.</option></select></label></div>`;
    const st = { method: r.method || "irv", weighting: r.weighting || "household", hide: r.hide_results !== false, blind: r.blind_submitters !== false };
    $$("[data-m]", el).forEach((b) => b.onclick = () => { st.method = b.dataset.m; $$("[data-m]", el).forEach((x) => x.classList.toggle("on", x === b)); });
    $$("[data-wt]", el).forEach((b) => b.onclick = () => { st.weighting = b.dataset.wt; $$("[data-wt]", el).forEach((x) => x.classList.toggle("on", x === b)); });
    $("#d-hide").onclick = () => { st.hide = !st.hide; $("#d-hide").classList.toggle("on", st.hide); $("#d-hide b").textContent = st.hide ? "Results hidden until voting closes" : "Results visible as votes come in"; };
    $("#d-blind").onclick = () => { st.blind = !st.blind; $("#d-blind").classList.toggle("on", st.blind); $("#d-blind b").textContent = st.blind ? "Judge the house, not the person" : "Show who added each house"; };
    $("#next").onclick = async () => {
      const toIso = (v) => v ? new Date(v).toISOString() : null;
      const { error } = await sb.from("trip_rules").update({ method: st.method, weighting: st.weighting, nom_cap: Number($("#d-cap").value) || 2, nominations_close: toIso($("#d-lock").value), voting_closes: toIso($("#d-close").value), hide_results: st.hide, blind_submitters: st.blind, fallback: $("#d-fallback").value }).eq("trip_id", T.trip.id);
      if (error) return toast(error.message, 6000); goStep(6);
    };
  }

  // ---- 6 review
  function stepReview(el) {
    const { $, esc, sb, toast, fmtDT } = g(); const t = T.trip, r = T.rules || {};
    const cs = T.constraints.filter((c) => c.active), gates = cs.filter((c) => c.kind === "gate"), crits = cs.filter((c) => c.kind === "criterion"), checks = cs.filter((c) => c.kind === "checklist");
    const sum = crits.reduce((a, c) => a + c.weight, 0) || 1;
    const mname = { irv: "ranked choice", approval: "approval voting", score: "scoring each house 1 to 5", irv_veto: "ranked choice after one veto per household", score_only: "highest score, no vote", organizer: "the organizer, with everyone's input" }[r.method || "irv"];
    const text = `${t.title} · ${t.nights} nights${t.season_start ? ` between ${t.season_start} and ${t.season_end}` : ""} · ${T.households.length} households, ${t.adults ?? "?"} adults${(t.kids_ages || []).length ? `, kids ${t.kids_ages.join(", ")}` : ""}.${t.book_by ? ` Book by ${t.book_by}.` : ""}

1. Every option is scored out of 100 on the same ${crits.length} things, by the site, whoever added it. Scores are never changed by hand.
2. A place that fails a deal-breaker is out, no matter its score. There are ${gates.length} deal-breakers.
3. ${["score_only", "organizer"].includes(r.method) ? "There is no ballot. " : `Each household nominates up to ${r.nom_cap ?? 2} options for the ballot.${r.nominations_close ? ` Nominations lock ${fmtDT(r.nominations_close)}.` : ""}${r.voting_closes ? ` Voting closes ${fmtDT(r.voting_closes)}.` : ""} `}${r.method === "score_only" ? "The highest-scoring available option is booked." : r.method === "organizer" ? "The organizer chooses after everyone has had a say." : `Method: ${mname}. ${r.weighting === "person" ? "Each adult counts once." : "Each household counts once; two voters in one household count half each."}`}
4. ${r.hide_results !== false ? "Results stay hidden until voting closes." : "Results are visible as votes come in."} ${r.blind_submitters !== false ? "Who added an option is shown only in the fine print." : ""}
5. If the winner can't be booked: ${r.fallback === "revote" ? "voting re-opens for 48 hours on what's left." : r.fallback === "organizer" ? "the organizer chooses from the top three." : "the next place in the final ranking is the pick, no re-vote."}
6. An option leaves the ballot only when someone confirms it isn't available for our dates, never for taste.
7. Results are final at the deadline. No extensions for a household that doesn't vote.`;
    el.innerHTML = `<div class="card stack"><p class="muted small">This is what everyone sees when they join. It is built from your answers; go back to any step to change it.</p><div class="rulebox">${esc(text)}</div>
      <div class="grid2"><div class="card stack"><b>Deal-breakers (${gates.length})</b>${gates.map((c) => `<span class="small">· ${esc(c.label)}${c.param ? ` (${esc(c.param)})` : ""}</span>`).join("") || `<span class="empty">none</span>`}${checks.length ? `<b style="margin-top:6px">Asked of the host (${checks.length})</b>${checks.map((c) => `<span class="small">· ${esc(c.label)}</span>`).join("")}` : ""}</div><div class="card stack"><b>Points (100 total)</b>${crits.map((c) => `<span class="small">· ${esc(c.label)}: ${Math.round(100 * c.weight / sum)}</span>`).join("")}</div></div>
      <div class="card stack" style="border-color:#d9a441;background:#fff8e8"><b>About partner houses</b><span class="small">Lodging companies in the areas you consider can pay to have their houses added to your list. They are marked <b>Sponsored</b>, they are scored by exactly the same rules as everything else, and they never reach the ballot unless one of your households nominates them. They do not see who you are unless you choose to contact them.</span></div>
      <div class="row"><button class="btn primary" id="open-trip">${t.status === "setup" ? "Open the trip and get the invite code" : "Back to the trip"}</button>${t.status !== "setup" ? `<span class="small">Invite code: <b style="font-size:18px;letter-spacing:.06em">${esc(t.invite_code)}</b></span>` : ""}</div></div>`;
    $("#open-trip").onclick = async () => {
      if (t.status === "setup") { if (!gates.length && !crits.length) return toast("Add at least one rule first."); const { error } = await sb.from("trips").update({ status: "open" }).eq("id", t.id); if (error) return toast(error.message, 6000); toast(`Open. Share the code ${t.invite_code} with the group.`, 8000); }
      location.hash = `#/trip/${t.id}/people`;
    };
  }

  return { render };
})();
