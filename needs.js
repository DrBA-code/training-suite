// Training Suite needs assessment (TNA / LNA): survey set-up, people and WhatsApp links, analysis with the
// Borich model (importance-weighted gaps), recommendations, nominations to programmes, and a signed report.
window.TSN = (() => {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dmy = s => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  // Starter skill areas, drawn from public-service competency frameworks (e.g. the UK Civil Service Success
  // Profiles behaviours) and the World Economic Forum's Future of Jobs Report 2025. Pick, edit or add your own.
  const CATALOGUE = [
    ["Core skills", [
      ["Written communication", "Writing clear memos, letters, emails and reports"],
      ["Presentation and public speaking", "Presenting ideas and information with confidence"],
      ["Customer and stakeholder service", "Understanding and meeting the needs of the people you serve"],
      ["Teamwork and collaboration", "Working well with colleagues and partners, inside and outside the organisation"],
      ["Problem solving and analytical thinking", "Breaking problems down and finding sound solutions"],
      ["Decision making", "Using evidence to weigh options, risks and consequences"],
      ["Creative thinking and innovation", "Suggesting new ideas and better ways of working"],
      ["Time management and productivity", "Planning, prioritising and delivering work on time"],
      ["Adaptability and resilience", "Coping well with change, pressure and setbacks"],
      ["Emotional intelligence and interpersonal skills", "Self-awareness, empathy and active listening"],
      ["Ethics, integrity and accountability", "Acting with honesty, fairness and responsibility"]
    ]],
    ["Digital and data", [
      ["Digital literacy and office software", "Using computers, email, word processing and spreadsheets well"],
      ["Data analysis and reporting", "Collecting, analysing and presenting data to support work"],
      ["Using AI tools at work", "Using AI assistants safely for drafting, research and routine tasks"],
      ["Cybersecurity and data protection", "Keeping information, systems and personal data safe"],
      ["Records and information management", "Organising, storing and retrieving records, paper and electronic"]
    ]],
    ["Management and leadership", [
      ["Leadership and influencing", "Setting direction and bringing people along"],
      ["People management, coaching and mentoring", "Developing, supporting and getting the best from staff"],
      ["Performance management", "Setting targets, giving feedback and reviewing results"],
      ["Strategic thinking and planning", "Seeing the bigger picture and planning for the future"],
      ["Project management", "Planning and delivering projects on time and within budget"],
      ["Change management", "Leading and supporting people through change"]
    ]],
    ["Professional and organisational", [
      ["Financial management and budgeting", "Planning, controlling and accounting for money"],
      ["Procurement and contract management", "Buying goods and services fairly and managing contracts"],
      ["Policy and procedure development", "Writing, reviewing and applying policies and procedures"],
      ["Monitoring and evaluation", "Tracking progress and measuring results"],
      ["Negotiation and conflict resolution", "Reaching agreement and handling disagreements constructively"],
      ["Health, safety and wellbeing", "Keeping yourself and others safe and well at work"]
    ]]
  ];
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const ALL = CATALOGUE.flatMap(([cat, list]) => list.map(([name, desc]) => ({ id: slug(name), name, cat, desc })));
  const DEFAULT_PICK = ["written-communication", "customer-and-stakeholder-service", "problem-solving-and-analytical-thinking", "time-management-and-productivity",
    "digital-literacy-and-office-software", "data-analysis-and-reporting", "using-ai-tools-at-work", "leadership-and-influencing", "people-management-coaching-and-mentoring",
    "project-management", "financial-management-and-budgeting", "procurement-and-contract-management"];
  const DEFAULT_Q = [{ id: "q1", text: "Which part of your work do you find most challenging?" }, { id: "q2", text: "What training would help you most in the next 12 months?" }, { id: "q3", text: "How do you prefer to learn (classroom, online, on the job, coaching)?" }];
  const FIELDS = [["department", "Department or unit"], ["grade", "Grade level"], ["role", "Role or job title"], ["years", "Years in service"]];
  const IMP = ["Not important", "Slightly important", "Important", "Very important", "Essential"];
  const ABL = ["None", "Basic", "Fair", "Good", "Expert"];

  // ---------- analysis (Borich) ----------
  // For each area: gap = importance − ability for each person; weighted by the area's mean importance;
  // the mean weighted discrepancy score (MWDS) ranks the training priorities.
  function analyse(sv, people, filter) {
    const R = people.filter(p => p.submitted_at && p.answers?.ratings && (!filter || !filter.dim || (p[filter.dim] || p.answers?.profile?.[filter.dim] || "") === filter.val));
    const th = +sv.threshold || 1.5;
    const areas = (sv.areas || []).map(a => {
      const rs = R.map(p => p.answers.ratings[a.id]).filter(r => r && r.imp >= 1 && r.abl >= 1);
      const mi = avg(rs.map(r => +r.imp)), ma = avg(rs.map(r => +r.abl));
      const mwds = rs.length ? avg(rs.map(r => (r.imp - r.abl) * mi)) : null;
      return { ...a, n: rs.length, imp: mi, abl: ma, gap: mi != null ? mi - ma : null, mwds, need: rs.length ? rs.filter(r => r.imp - r.abl >= th && r.imp >= 3).length / rs.length : null };
    }).sort((x, y) => (y.mwds ?? -99) - (x.mwds ?? -99));
    const recs = R.map(p => {
      const list = (sv.areas || []).map(a => { const r = p.answers.ratings[a.id]; return r ? { area: a, d: r.imp - r.abl, imp: +r.imp } : null; })
        .filter(x => x && x.d >= th && x.imp >= 3).sort((x, y) => y.d * y.imp - x.d * x.imp);
      return { p, list };
    });
    const cats = [...new Set((sv.areas || []).map(a => a.cat))].map(c => { const xs = areas.filter(a => a.cat === c && a.mwds != null); return { cat: c, mwds: avg(xs.map(a => a.mwds)), n: xs.length }; }).filter(c => c.n).sort((a, b) => b.mwds - a.mwds);
    return { R, areas, recs, cats, th };
  }
  const phoneFor = t => { let d = String(t || "").replace(/\D/g, ""); if (d.startsWith("0") && d.length === 11) d = "234" + d.slice(1); return d; };
  const linkFor = p => new URL("tna/", location.href.split("#")[0]).href + "#" + p.token;
  const fill = (tpl, sv, p) => String(tpl || "").replaceAll("{name}", ((p.title ? p.title + " " : "") + p.name).trim()).replaceAll("{link}", linkFor(p)).replaceAll("{org}", sv.org || "our organisation").replaceAll("{title}", sv.title);
  const DEFAULT_MSG = "Dear {name},\n\n{org} is planning training for the coming months, and we want it to match what you need in your work. Please take about 5 minutes to complete this short survey:\n{link}\n\nThank you.";

  // ---------- pages ----------
  // ctx: { sb, profile, toast, errText, V, head, progs, statusOf }
  async function list(ctx) {
    ctx.V(ctx.head("Needs assessment", "Training needs assessment", `<button class="btn" type="button" id="tnaNew">+ New needs assessment</button>`) +
      `<p class="muted" style="margin-top:-14px;max-width:76ch">Find out what training people need before you plan it. Choose skill areas, send each person a personal link by WhatsApp, and see the priorities, who needs what, and nominate people to a programme.</p><div id="tnaList"><p class="muted">Loading…</p></div>`);
    document.getElementById("tnaNew").onclick = async () => {
      const { data, error } = await ctx.sb.from("tna_surveys").insert({ title: "Training needs assessment " + new Date().getFullYear(), org: ctx.profile.where_train || "", areas: ALL.filter(a => DEFAULT_PICK.includes(a.id)), fields: { department: true, grade: true, role: true, years: false }, questions: DEFAULT_Q, message: DEFAULT_MSG, intro: "This short survey helps us plan training that fits your work. For each skill area, say how important it is to your job, and how able you are today. There are no right or wrong answers." }).select().single();
      if (error) return ctx.toast(/tna_surveys|schema cache/i.test(error.message || "") ? "Run supabase/schema-16-needs.sql in Supabase first." : ctx.errText(error, "Couldn't create it."));
      location.hash = "#/needs/" + data.id;
    };
    const [{ data: svs, error }, { data: ppl }] = await Promise.all([ctx.sb.from("tna_surveys").select("*").order("created_at", { ascending: false }), ctx.sb.from("tna_people").select("survey_id, submitted_at")]);
    const box = document.getElementById("tnaList"); if (!box) return;
    if (error) { box.innerHTML = `<p class="note warn">${esc(/tna_surveys|schema cache/i.test(error.message || "") ? "Needs assessment isn't set up yet: run supabase/schema-16-needs.sql in Supabase." : error.message)}</p>`; return; }
    const st = { draft: ["Draft", ""], open: ["Open", "live"], closed: ["Closed", "done"] };
    box.innerHTML = (svs || []).map(s => { const pp = (ppl || []).filter(x => x.survey_id === s.id), done = pp.filter(x => x.submitted_at).length;
      return `<a class="srow repcard" href="#/needs/${s.id}" style="flex-direction:row"><span><b style="font-size:17px">${esc(s.title)}</b><small>${(s.areas || []).length} skill areas · ${pp.length} people · ${done} responded${pp.length ? ` (${Math.round(100 * done / pp.length)}%)` : ""}</small></span><span class="badge ${st[s.status][1]}">${st[s.status][0]}</span><span class="ok">Open →</span></a>`; }).join("")
      || `<div class="empty"><div><h2>No needs assessments yet</h2><p class="muted">Start one: it comes with a starter list of skill areas you can change.</p></div></div>`;
  }

  let TAB = "setup";
  async function page(ctx, id, tab) {
    if (tab) TAB = tab;
    const [{ data: sv, error }, { data: people }] = await Promise.all([ctx.sb.from("tna_surveys").select("*").eq("id", id).single(), ctx.sb.from("tna_people").select("*").eq("survey_id", id).order("name")]);
    if (error || !sv) return ctx.V(`<p class="muted">Needs assessment not found. <a href="#/needs">Back</a></p>`);
    const P = people || [], done = P.filter(p => p.submitted_at).length;
    const T = [["setup", "Set up"], ["people", `People (${P.length})`], ["analysis", `Analysis (${done})`], ["report", "Report"]];
    const st = { draft: "Draft: links don't work yet", open: "Open: people can answer", closed: "Closed" }[sv.status];
    ctx.V(`<div class="pagehead"><div><span class="lbl"><a href="#/needs">Needs assessment</a></span><h1>${esc(sv.title)}</h1><span class="muted">${esc(st)} · ${P.length} people · ${done} responded</span></div>
      <div class="row">${sv.status === "draft" ? `<button class="btn red" type="button" id="svOpen">Open the survey</button>` : sv.status === "open" ? `<button class="btn ghost small" type="button" id="svClose">Close the survey</button>` : `<button class="btn ghost small" type="button" id="svReopen">Reopen</button>`}</div></div>
      <div class="tabbar" role="tablist">${T.map(([k, n]) => `<button type="button" role="tab" aria-selected="${TAB === k}" data-ntab="${k}">${n}</button>`).join("")}</div><div id="tnaBody"></div>`);
    document.querySelectorAll("[data-ntab]").forEach(b => (b.onclick = () => page(ctx, id, b.dataset.ntab)));
    const setStatus = async s => { const { error } = await ctx.sb.from("tna_surveys").update({ status: s, updated_at: new Date().toISOString() }).eq("id", id); if (error) return ctx.toast(ctx.errText(error, "Couldn't change it.")); ctx.toast(s === "open" ? "Open: personal links now work" : s === "closed" ? "Closed: no more answers" : "Reopened"); page(ctx, id); };
    document.getElementById("svOpen")?.addEventListener("click", () => { if (!(sv.areas || []).length) return ctx.toast("Choose at least one skill area first."); setStatus("open"); });
    document.getElementById("svClose")?.addEventListener("click", e => { const b = e.currentTarget; if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to close"; return; } setStatus("closed"); });
    document.getElementById("svReopen")?.addEventListener("click", () => setStatus("open"));
    const body = document.getElementById("tnaBody");
    if (TAB === "setup") setup(ctx, body, sv, P);
    else if (TAB === "people") peopleTab(ctx, body, sv, P);
    else if (TAB === "analysis") analysisTab(ctx, body, sv, P);
    else reportTab(ctx, body, sv, P);
  }

  function setup(ctx, box, sv, P) {
    const answered = P.some(p => p.submitted_at);
    let areas = (sv.areas || []).slice(), t = null, pend = {};
    const save = patch => { clearTimeout(t); Object.assign(pend, patch); Object.assign(sv, patch); const m = document.getElementById("svMsg"); if (m) m.textContent = "Saving…"; t = setTimeout(async () => { const pp = pend; pend = {}; const { error } = await ctx.sb.from("tna_surveys").update({ ...pp, updated_at: new Date().toISOString() }).eq("id", sv.id); Object.assign(sv, pp); const mm = document.getElementById("svMsg"); if (mm) mm.textContent = error ? ctx.errText(error, "Couldn't save.") : "Saved ✓"; }, 400); };
    const has = id => areas.some(a => a.id === id);
    const own = areas.filter(a => !ALL.some(x => x.id === a.id));
    box.innerHTML = `<div class="tna-setup">
      <div class="grid2"><label class="fld">Title<input id="svTitle" value="${esc(sv.title)}"></label><label class="fld">Run by<span class="hint">Your organisation, used in messages and the report.</span><input id="svOrg" value="${esc(sv.org)}" placeholder="e.g. PSSDC, or your company"></label>
        <label class="fld full">Introduction shown to people<textarea id="svIntro" rows="3">${esc(sv.intro)}</textarea></label>
        <label class="fld full">Background <span class="hint" style="display:inline">(for the report)</span><textarea id="svBg" rows="3" placeholder="Why this assessment is being done, and for whom.">${esc(sv.background)}</textarea></label></div>
      <section class="wsec"><div class="d-head"><h3>Skill areas <span class="muted" style="font-weight:500;font-size:15px">· ${areas.length} chosen</span></h3></div>
        <p class="small muted">For each area, people rate how important it is to their job and their current ability, from 1 to 5. Around 10 to 15 areas keeps the survey to about 5 minutes. ${answered ? "<b>People have already answered: removing an area drops its answers from the analysis.</b>" : ""}</p>
        ${CATALOGUE.map(([cat, list]) => `<fieldset class="tna-cat"><legend>${esc(cat)} <button type="button" class="linkbtn" data-allcat="${esc(cat)}">${list.every(([n]) => has(slug(n))) ? "Clear" : "Select all"}</button></legend>
          ${list.map(([n, d]) => `<label class="tna-area"><input type="checkbox" data-area="${slug(n)}" ${has(slug(n)) ? "checked" : ""}><span><b>${esc(n)}</b><small>${esc(d)}</small></span></label>`).join("")}</fieldset>`).join("")}
        <fieldset class="tna-cat"><legend>Your own areas</legend>${own.map(a => `<div class="tna-own"><b>${esc(a.name)}</b><small>${esc(a.desc)}</small><button type="button" class="x" data-rmown="${a.id}" aria-label="Remove">×</button></div>`).join("")}
          <div class="row"><input class="in" id="ownName" placeholder="e.g. Lagos State Public Service Rules" style="flex:1;min-width:200px"><input class="in" id="ownDesc" placeholder="Short description (optional)" style="flex:1;min-width:200px"><button class="btn ghost small" type="button" id="ownAdd">+ Add</button></div></fieldset></section>
      <section class="wsec"><h3>About the person</h3><p class="small muted">Name and organisation/MDA come from your list. Also ask:</p>
        <div class="row">${FIELDS.map(([k, l]) => `<label class="opt" style="flex:1;min-width:200px"><input type="checkbox" data-field="${k}" ${sv.fields?.[k] ? "checked" : ""}><span><b>${l}</b></span></label>`).join("")}</div></section>
      <section class="wsec"><h3>Open questions</h3><div id="qList">${(sv.questions || []).map((q, i) => `<div class="row" style="margin-bottom:6px"><input class="in" data-q="${i}" value="${esc(q.text)}" style="flex:1"><button type="button" class="x" data-rmq="${i}" aria-label="Remove">×</button></div>`).join("")}</div>
        <button class="btn ghost small" type="button" id="qAdd">+ Add a question</button></section>
      <section class="wsec"><h3>Recommendations</h3><label class="fld" style="max-width:520px">Recommend an area to someone when their gap is at least<select id="svTh">${[[1, "1 point (more people recommended)"], [1.5, "1.5 points"], [2, "2 points (only the clearest needs)"]].map(([v, l]) => `<option value="${v}" ${+sv.threshold === v ? "selected" : ""}>${l}</option>`).join("")}</select><span class="hint">Gap = importance − ability, and only for areas they rate at least “Important”.</span></label></section>
      <section class="wsec"><h3>WhatsApp message</h3><p class="small muted">{name} becomes each person's name and {link} their personal link.</p><textarea class="in" id="svMsgTpl" rows="6" style="width:100%">${esc(sv.message || DEFAULT_MSG)}</textarea></section>
      <p class="small" id="svMsg" role="status"></p></div>`;
    const $ = id => document.getElementById(id);
    $("svTitle").oninput = e => e.target.value.trim().length >= 3 && save({ title: e.target.value.trim() });
    $("svOrg").oninput = e => save({ org: e.target.value.trim() });
    $("svIntro").oninput = e => save({ intro: e.target.value });
    $("svBg").oninput = e => save({ background: e.target.value });
    $("svMsgTpl").oninput = e => save({ message: e.target.value });
    $("svTh").onchange = e => save({ threshold: +e.target.value });
    box.querySelectorAll("[data-area]").forEach(c => (c.onchange = () => {
      const a = ALL.find(x => x.id === c.dataset.area); areas = c.checked ? areas.concat(a) : areas.filter(x => x.id !== a.id);
      areas.sort((x, y) => ALL.findIndex(z => z.id === x.id) - ALL.findIndex(z => z.id === y.id)); save({ areas }); setup(ctx, box, sv, P);
    }));
    box.querySelectorAll("[data-allcat]").forEach(b => (b.onclick = () => {
      const list = ALL.filter(a => a.cat === b.dataset.allcat), all = list.every(a => has(a.id));
      areas = all ? areas.filter(a => !list.some(x => x.id === a.id)) : areas.concat(list.filter(a => !has(a.id)));
      save({ areas }); setup(ctx, box, sv, P);
    }));
    $("ownAdd").onclick = () => { const n = $("ownName").value.trim(); if (n.length < 3) return; areas = areas.concat({ id: "own-" + slug(n) + "-" + Date.now().toString(36).slice(-4), name: n, cat: "Organisation-specific", desc: $("ownDesc").value.trim() }); save({ areas }); setup(ctx, box, sv, P); };
    box.querySelectorAll("[data-rmown]").forEach(b => (b.onclick = () => { areas = areas.filter(a => a.id !== b.dataset.rmown); save({ areas }); setup(ctx, box, sv, P); }));
    box.querySelectorAll("[data-field]").forEach(c => (c.onchange = () => save({ fields: { ...sv.fields, [c.dataset.field]: c.checked } })));
    const qs = () => [...box.querySelectorAll("[data-q]")].map((i, k) => ({ id: (sv.questions[k] && sv.questions[k].id) || "q" + Date.now().toString(36) + k, text: i.value.trim() })).filter(q => q.text);
    box.querySelectorAll("[data-q]").forEach(i => (i.oninput = () => save({ questions: qs() })));
    box.querySelectorAll("[data-rmq]").forEach(b => (b.onclick = () => { sv.questions.splice(+b.dataset.rmq, 1); save({ questions: sv.questions }); setup(ctx, box, sv, P); }));
    $("qAdd").onclick = () => { sv.questions = (sv.questions || []).concat({ id: "q" + Date.now().toString(36), text: "" }); setup(ctx, box, sv, P); box.querySelector("#qList .row:last-child input")?.focus(); };
  }

  function peopleTab(ctx, box, sv, P) {
    let show = "all";
    const status = p => p.submitted_at ? ["Done ✓", "done"] : p.opened_at ? ["Opened", "live"] : p.sent_at ? ["Sent", ""] : ["Not sent", ""];
    const draw = () => {
      const rows = P.filter(p => show === "all" || (show === "todo" && !p.submitted_at));
      box.innerHTML = `${sv.status === "draft" ? `<div class="note warn">The survey is a draft, so links won't work yet. Press <b>Open the survey</b> above before you send them.</div>` : ""}
        <details class="tna-add" ${P.length ? "" : "open"}><summary><b>Add people</b> <span class="small muted">Paste from Excel, or upload a CSV file</span></summary>
          <p class="small muted">One person per line, with columns in this order (separated by tabs or commas): <b>Name, Phone, Email, Organisation/MDA, Department, Grade</b>. Only the name is required; a phone number is needed for WhatsApp and an email to nominate them to a programme.</p>
          <textarea class="in" id="ppPaste" rows="6" style="width:100%" placeholder="Ada Obi, 08031234567, ada@example.com, Ministry of Health, Planning, GL 10"></textarea>
          <div class="row"><button class="btn small" type="button" id="ppAdd">Add to the list</button><label class="btn ghost small">Upload CSV<input type="file" id="ppFile" accept=".csv,text/csv,text/plain" hidden></label><span class="small" id="ppMsg" role="status"></span></div></details>
        <div class="row" style="justify-content:space-between"><div class="tabbar" role="tablist"><button type="button" data-show="all" aria-selected="${show === "all"}">Everyone (${P.length})</button><button type="button" data-show="todo" aria-selected="${show === "todo"}">Not answered (${P.filter(p => !p.submitted_at).length})</button></div>
          <div class="row"><button class="btn ghost small" type="button" id="ppCopy" ${rows.length ? "" : "disabled"}>Copy ${show === "todo" ? "reminders" : "all messages"}</button><button class="btn ghost small" type="button" id="ppSent" ${rows.some(p => !p.sent_at) ? "" : "disabled"}>Mark all as sent</button></div></div>
        <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Organisation/MDA</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map(p => { const [t, c] = status(p); return `<tr><td><b>${esc((p.title ? p.title + " " : "") + p.name)}</b>${p.email ? `<br><small class="muted">${esc(p.email)}</small>` : ""}</td><td>${esc(p.organisation)}${p.department ? `<br><small class="muted">${esc(p.department)}</small>` : ""}</td><td>${esc(p.phone) || "–"}</td>
          <td><span class="badge ${c}">${t}</span>${p.sent_at && !p.submitted_at ? `<br><small class="muted">sent ${esc(dmy(p.sent_at))}</small>` : ""}${(p.nominated || []).length ? `<br><small style="color:#1E6B3E">Nominated: ${esc(p.nominated.map(n => n.name).join(", "))}</small>` : ""}</td>
          <td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn small wa" type="button" data-wa="${p.id}">${p.submitted_at ? "Message" : p.sent_at ? "Remind" : "Send"} on WhatsApp</button><button class="btn ghost small" type="button" data-cp="${p.id}">Copy link</button><button class="x" type="button" data-rm="${p.id}" aria-label="Remove ${esc(p.name)}">×</button></div></td></tr>`; }).join("") || `<tr><td colspan="5" class="muted">No one here yet.</td></tr>`}</tbody></table></div>
        <p class="small muted">Each link is personal: answers are tied to that person, and they can come back and change them until you close the survey.</p>`;
      const $ = id => document.getElementById(id);
      box.querySelectorAll("[data-show]").forEach(b => (b.onclick = () => { show = b.dataset.show; draw(); }));
      const add = async text => {
        const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const parsed = lines.map(l => l.split(l.includes("\t") ? "\t" : ",").map(x => x.trim().replace(/^"|"$/g, ""))).filter(c => c[0] && !/^name$/i.test(c[0]));
        const TITLES = /^(Prof|Dr|Engr|Mr|Mrs|Miss|Ms)\.?\s+/i;
        const seen = new Set(P.map(p => (p.email || "").toLowerCase()).filter(Boolean).concat(P.map(p => phoneFor(p.phone)).filter(Boolean)));
        const rows = parsed.map(c => { const m = c[0].match(TITLES); return { survey_id: sv.id, title: m ? m[1].replace(/^./, x => x.toUpperCase()) : "", name: c[0].replace(TITLES, "").slice(0, 160), phone: (c[1] || "").slice(0, 40), email: (c[2] || "").toLowerCase().slice(0, 160), organisation: (c[3] || "").slice(0, 200), department: (c[4] || "").slice(0, 200), grade: (c[5] || "").slice(0, 60) }; })
          .filter(r => r.name.length >= 2 && !(r.email && seen.has(r.email)) && !(phoneFor(r.phone) && seen.has(phoneFor(r.phone))));
        if (!rows.length) { $("ppMsg").textContent = "No new people found. Check the format, or they're already on the list."; return; }
        const { data, error } = await ctx.sb.from("tna_people").insert(rows).select();
        if (error) { $("ppMsg").textContent = ctx.errText(error, "Couldn't add them."); return; }
        ctx.toast(`${data.length} added`); page(ctx, sv.id);
      };
      $("ppAdd").onclick = () => add($("ppPaste").value);
      $("ppFile").onchange = async e => { const f = e.target.files[0]; if (f) add(await f.text()); };
      const mark = async ids => { const at = new Date().toISOString(); for (const id of ids) { const p = P.find(x => x.id === id); if (p && !p.sent_at) { p.sent_at = at; await ctx.sb.from("tna_people").update({ sent_at: at }).eq("id", id); } } };
      box.querySelectorAll("[data-wa]").forEach(b => (b.onclick = async () => {
        const p = P.find(x => x.id === b.dataset.wa), msg = fill(p.sent_at && !p.submitted_at ? "Reminder: " + (sv.message || DEFAULT_MSG) : sv.message || DEFAULT_MSG, sv, p), ph = phoneFor(p.phone);
        window.open(`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
        await mark([p.id]); draw();
      }));
      box.querySelectorAll("[data-cp]").forEach(b => (b.onclick = async () => { const p = P.find(x => x.id === b.dataset.cp); try { await navigator.clipboard.writeText(linkFor(p)); ctx.toast("Link copied"); } catch { ctx.toast(linkFor(p)); } }));
      box.querySelectorAll("[data-rm]").forEach(b => (b.onclick = async () => {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Remove?"; return; }
        const { error } = await ctx.sb.from("tna_people").delete().eq("id", b.dataset.rm); if (error) return ctx.toast(ctx.errText(error, "Couldn't remove."));
        P.splice(P.findIndex(x => x.id === b.dataset.rm), 1); draw();
      }));
      $("ppCopy").onclick = async () => {
        const text = rows.map(p => `${p.phone ? p.phone + "\n" : ""}${fill((show === "todo" ? "Reminder: " : "") + (sv.message || DEFAULT_MSG), sv, p)}`).join("\n\n--------\n\n");
        try { await navigator.clipboard.writeText(text); ctx.toast(`${rows.length} message${rows.length === 1 ? "" : "s"} copied`); } catch { ctx.toast("Couldn't copy. Use Send on WhatsApp for each person."); }
      };
      $("ppSent").onclick = async () => { await mark(rows.filter(p => !p.sent_at).map(p => p.id)); ctx.toast("Marked as sent"); draw(); };
    };
    draw();
  }

  // ---------- analysis ----------
  function analysisTab(ctx, box, sv, P) {
    let filter = { dim: "", val: "" };
    const draw = () => {
      const A = analyse(sv, P, filter.dim ? filter : null), all = analyse(sv, P);
      const dims = [["organisation", "Organisation/MDA"], ["department", "Department"], ["grade", "Grade level"]].filter(([k]) => P.some(p => p[k]));
      const vals = filter.dim ? [...new Set(all.R.map(p => p[filter.dim]).filter(Boolean))].sort() : [];
      const max = Math.max(0.01, ...A.areas.map(a => a.mwds || 0));
      box.innerHTML = !all.R.length ? `<div class="empty"><div><h2>No answers yet</h2><p class="muted">Once people answer, their training priorities show here.</p></div></div>` : `
        <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
          <div class="tile" style="--c:var(--blue)"><span class="lbl">Responded</span><b>${all.R.length}<small style="font-size:.45em"> of ${P.length}</small></b><span>${P.length ? Math.round(100 * all.R.length / P.length) : 0}% response rate</span></div>
          <div class="tile" style="--c:var(--red)"><span class="lbl">Top priority</span><b style="font-size:20px;line-height:1.2">${esc(A.areas[0]?.name || "–")}</b><span>${A.areas[0]?.need != null ? Math.round(A.areas[0].need * 100) + "% need training" : ""}</span></div>
          <div class="tile" style="--c:var(--yellow)"><span class="lbl">People with a need</span><b>${A.recs.filter(r => r.list.length).length}</b><span>At least one area recommended</span></div>
          <div class="tile" style="--c:var(--ink)"><span class="lbl">Skill areas</span><b>${(sv.areas || []).length}</b><span>${A.cats.length} categories</span></div></div>
        <div class="row" style="justify-content:space-between"><h2 style="font-size:20px">Training priorities</h2>
          <div class="row"><label class="small">Look at <select id="fDim" class="in" style="padding:6px 8px"><option value="">Everyone</option>${dims.map(([k, l]) => `<option value="${k}" ${filter.dim === k ? "selected" : ""}>By ${l.toLowerCase()}</option>`).join("")}</select></label>
          ${filter.dim ? `<select id="fVal" class="in" style="padding:6px 8px">${vals.map(v => `<option ${filter.val === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : ""}<button class="btn small" type="button" id="anCsv">Download (Excel/CSV)</button></div></div>
        <p class="small muted" style="max-width:80ch">Ranked by priority score (the Borich mean weighted discrepancy score): the gap between importance and ability, weighted by how important the area is. “Need” is the share of people whose gap is at least ${A.th} points in an area they rate at least important.${filter.dim ? ` Showing ${A.R.length} ${A.R.length === 1 ? "person" : "people"} in ${esc(filter.val)}.` : ""}</p>
        <div class="tablewrap"><table class="t tna-pri"><thead><tr><th>#</th><th>Skill area</th><th>Importance</th><th>Ability</th><th>Priority score</th><th>Need</th><th></th></tr></thead><tbody>
          ${A.areas.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.name)}</b><br><small class="muted">${esc(a.cat)}</small></td><td>${a.imp?.toFixed(1) ?? "–"}</td><td>${a.abl?.toFixed(1) ?? "–"}</td>
            <td><span class="achbar"><i style="width:${Math.max(0, 100 * (a.mwds || 0) / max)}%;background:${i < 3 ? "var(--red)" : "var(--blue)"}"></i></span> <b>${a.mwds?.toFixed(2) ?? "–"}</b></td><td>${a.need != null ? Math.round(a.need * 100) + "%" : "–"}</td>
            <td>${a.n ? `<button class="btn ghost small" type="button" data-nom="${a.id}">Nominate…</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
        <div id="nomBox"></div>
        <h2 style="font-size:20px;margin-top:18px">Recommendations by person</h2>
        <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Organisation/MDA</th><th>Recommended training</th><th>Nominated</th></tr></thead><tbody>
          ${A.recs.slice().sort((x, y) => y.list.length - x.list.length || x.p.name.localeCompare(y.p.name)).map(r => `<tr><td><b>${esc((r.p.title ? r.p.title + " " : "") + r.p.name)}</b></td><td>${esc(r.p.organisation)}</td><td>${r.list.length ? r.list.slice(0, 4).map(x => `<span class="tna-chip">${esc(x.area.name)} <small>+${x.d}</small></span>`).join(" ") + (r.list.length > 4 ? ` <small class="muted">and ${r.list.length - 4} more</small>` : "") : `<span class="muted small">No clear gaps</span>`}</td><td>${(r.p.nominated || []).map(n => esc(n.name)).join(", ") || "–"}</td></tr>`).join("")}</tbody></table></div>
        ${(sv.questions || []).length ? `<h2 style="font-size:20px;margin-top:18px">In their words</h2>${sv.questions.map(q => { const ans = A.R.map(p => String(p.answers?.open?.[q.id] || "").trim()).filter(Boolean); return `<details class="tna-open"><summary><b>${esc(q.text)}</b> <span class="muted small">${ans.length} answers</span></summary>${ans.map(t => `<blockquote>${esc(t)}</blockquote>`).join("") || `<p class="muted small">No answers.</p>`}</details>`; }).join("")}` : ""}`;
      const $ = id => document.getElementById(id);
      $("fDim")?.addEventListener("change", e => { filter = { dim: e.target.value, val: "" }; if (filter.dim) filter.val = [...new Set(all.R.map(p => p[filter.dim]).filter(Boolean))].sort()[0] || ""; draw(); });
      $("fVal")?.addEventListener("change", e => { filter.val = e.target.value; draw(); });
      $("anCsv")?.addEventListener("click", () => {
        const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = [["Rank", "Skill area", "Category", "Mean importance", "Mean ability", "Gap", "Priority score (MWDS)", "Need %", "Responses"], ...A.areas.map((a, i) => [i + 1, a.name, a.cat, a.imp?.toFixed(2), a.abl?.toFixed(2), a.gap?.toFixed(2), a.mwds?.toFixed(3), a.need != null ? Math.round(a.need * 100) : "", a.n]), [],
          ["Name", "Organisation/MDA", "Department", "Grade", "Email", "Phone", ...(sv.areas || []).flatMap(a => [a.name + " importance", a.name + " ability"]), "Recommended"],
          ...A.recs.map(r => [r.p.name, r.p.organisation, r.p.department, r.p.grade, r.p.email, r.p.phone, ...(sv.areas || []).flatMap(a => [r.p.answers.ratings[a.id]?.imp ?? "", r.p.answers.ratings[a.id]?.abl ?? ""]), r.list.map(x => x.area.name).join("; ")])];
        const blob = new Blob(["﻿" + lines.map(l => l.map(q).join(",")).join("\r\n")], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${sv.title} - analysis.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      box.querySelectorAll("[data-nom]").forEach(b => (b.onclick = () => nominate(ctx, sv, P, A, b.dataset.nom, draw)));
    };
    draw();
  }
  function nominate(ctx, sv, P, A, areaId, redraw) {
    const area = sv.areas.find(a => a.id === areaId), box = document.getElementById("nomBox");
    const rec = new Set(A.recs.filter(r => r.list.some(x => x.area.id === areaId)).map(r => r.p.id)), recOk = A.R.filter(p => rec.has(p.id) && p.email).length;
    const list = A.R.slice().sort((x, y) => (rec.has(y.id) - rec.has(x.id)) || x.name.localeCompare(y.name));
    const progs = ctx.progs();
    box.innerHTML = `<div class="confirm" style="border-color:var(--line-2);margin-top:12px"><b>Nominate people for “${esc(area.name)}”</b>
      <span class="small muted">${rec.size} recommended${recOk < rec.size ? `, ${recOk} with an email` : ""} (ticked). Nominated people join the programme's participant list, so they check in with that email.</span>
      <label class="fld" style="max-width:520px">Programme<select id="nomProg">${progs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>${progs.length ? "" : `<span class="hint">No programmes yet. Create one first.</span>`}</label>
      <div class="tna-nomlist">${list.map(p => `<label class="opt"><input type="checkbox" data-np="${p.id}" ${rec.has(p.id) && p.email ? "checked" : ""} ${p.email ? "" : "disabled"}><span><b>${esc(p.name)}</b> <span class="muted">${esc(p.organisation)}${rec.has(p.id) ? " · recommended" : ""}${p.email ? "" : " · no email on the list"}</span></span></label>`).join("")}</div>
      <div class="row"><button class="btn red small" type="button" id="nomGo" ${progs.length ? "" : "disabled"}>Nominate</button><button class="btn ghost small" type="button" id="nomX">Cancel</button><span class="err" id="nomErr"></span></div></div>`;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    document.getElementById("nomX").onclick = () => (box.innerHTML = "");
    document.getElementById("nomGo").onclick = async () => {
      const ids = [...box.querySelectorAll("[data-np]:checked")].map(c => c.dataset.np); if (!ids.length) return (document.getElementById("nomErr").textContent = "Tick at least one person.");
      const prog = document.getElementById("nomProg").value;
      const { data, error } = await ctx.sb.rpc("tna_nominate", { p_programme: prog, p_people: ids, p_area: area.name });
      if (error) return (document.getElementById("nomErr").textContent = ctx.errText(error, "Couldn't nominate."));
      const { data: fresh } = await ctx.sb.from("tna_people").select("*").eq("survey_id", sv.id);
      if (fresh) { P.splice(0, P.length, ...fresh.sort((a, b) => a.name.localeCompare(b.name))); }
      ctx.toast(`${data} nominated to ${progs.find(p => p.id === prog)?.name}`); box.innerHTML = ""; redraw();
    };
  }

  // ---------- report ----------
  const andList = xs => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
  const W = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
  const Num = (n, one, many) => `${W[n] || n} ${n === 1 ? one : many || one + "s"}`;
  const num = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  // lower-case a name for use mid-sentence, keeping acronyms (AI, ICT) and proper names (Lagos State …)
  const lc = t => { const cap = w => /^[A-Z][a-z]/.test(w || ""); return String(t).split(" ").map((w, i, a) => /^[A-Z]{2,}/.test(w) || (cap(w) && (cap(a[i - 1]) || cap(a[i + 1]))) ? w : w.toLowerCase()).join(" "); };
  function autoSummary(sv, P) {
    const A = analyse(sv, P), out = [], sent = P.map(p => p.sent_at).filter(Boolean).sort(), subs = P.map(p => p.submitted_at).filter(Boolean).sort();
    const isTna = /needs/i.test(sv.title || ""), first = sent[0] || subs[0], last = subs[subs.length - 1];
    out.push(`This report presents the findings of the ${sv.title}${isTna ? "" : ", a training needs assessment"}${sv.org ? ` conducted by ${sv.org}` : ""}.${first ? (last && dmy(first) === dmy(last) ? ` The survey was sent out and answered on ${dmy(first)}.` : ` The survey was sent out from ${dmy(first)}${last ? `, and responses were received up to ${dmy(last)}` : ""}.`) : ""}`);
    if (String(sv.background || "").trim()) out.push(String(sv.background).trim());
    const cats = [...new Set((sv.areas || []).map(a => a.cat))];
    out.push(`Staff were asked to rate ${num((sv.areas || []).length, "skill area")}${cats.length > 1 ? ` in ${num(cats.length, "category", "categories")} (${andList(cats.map(lc))})` : ""} on two five-point scales: how important each area is to their job, and their current ability in it. Following the Borich needs-assessment model, the gap between importance and ability was weighted by the average importance of each area to give a priority score (the mean weighted discrepancy score). The higher the score, the greater the training need.`);
    const orgs = new Map(); A.R.forEach(p => { const o = String(p.organisation || "").trim(); if (o) orgs.set(o.toLowerCase(), { label: o, n: (orgs.get(o.toLowerCase())?.n || 0) + 1 }); });
    const O = [...orgs.values()].sort((a, b) => b.n - a.n);
    out.push(P.length ? `${Num(P.length, "person was", "people were")} invited, and ${A.R.length} responded, a response rate of ${Math.round(100 * A.R.length / P.length)}%${O.length ? `. Respondents came from ${num(O.length, "organisation")}${O.length > 3 ? `, including ${andList(O.slice(0, 3).map(o => o.label))}` : `: ${andList(O.map(o => o.label))}`}` : ""}.` : "No one has been invited yet.");
    if (A.R.length) {
      const ranked = A.areas.filter(a => a.mwds != null), top = ranked.filter((a, i) => i < 3 || (a.need > 0 && a.mwds > 0)).slice(0, 5), low = A.areas.filter(a => a.mwds != null).slice(-2).reverse();
      if (top.length) out.push(`The highest training priorities were ${andList(top.map((a, i) => `(${i + 1}) ${lc(a.name)} (priority score ${a.mwds.toFixed(2)}${a.need ? `; ${a.need === 1 ? "every respondent" : Math.round(a.need * 100) + "% of respondents"} showed a clear need` : ""})`))}.${low.length && A.areas.length > 6 ? ` The lowest were ${andList(low.map(a => lc(a.name)))}, where staff already feel reasonably able.` : ""}${A.cats.length > 1 ? ` By category, ${lc(A.cats[0].cat)} showed the greatest overall need.` : ""}`);
      const byOrg = O.filter(o => o.n >= 2).slice(0, 5).map(o => { const X = analyse(sv, P, { dim: "organisation", val: A.R.find(p => (p.organisation || "").toLowerCase() === o.label.toLowerCase())?.organisation }); return X.areas[0]?.mwds != null ? { o: o.label, a: lc(X.areas[0].name) } : null; }).filter(Boolean);
      if (byOrg.length > 1) out.push(byOrg.every(x => x.a === byOrg[0].a) ? `The top priority was the same across organisations: ${byOrg[0].a} came first for ${andList(byOrg.map(x => x.o))}.` : `Needs varied across organisations. The top priority was ${andList(byOrg.map(x => `${x.a} for ${x.o}`))}.`);
      (sv.questions || []).slice(0, 2).forEach(q => { const ans = A.R.map(p => String(p.answers?.open?.[q.id] || "").trim()).filter(Boolean); if (ans.length) out.push(`Asked “${q.text}”, respondents said, for example, ${andList(ans.slice(0, 3).map(t => `“${t.replace(/[.\s]+$/, "")}”`))}.`); });
      const recBy = top.slice(0, 3).map(a => ({ a, n: A.recs.filter(r => r.list.some(x => x.area.id === a.id)).length })).filter(x => x.n);
      const nom = P.filter(p => (p.nominated || []).length).length;
      out.push(`It is recommended that training be prioritised in ${andList(top.slice(0, 3).map(a => lc(a.name)))}.${recBy.length ? ` Based on individual gaps of ${A.th} points or more, ${recBy.length > 1 && recBy.every(x => x.n === recBy[0].n) ? `${num(recBy[0].n, "person is", "people are")} recommended for each of these` : andList(recBy.map(x => `${num(x.n, "person", "people")} ${x.n === 1 ? "is" : "are"} recommended for ${lc(x.a.name)}`))}.` : ""}${nom ? ` So far, ${num(nom, "person has", "people have")} been nominated to a programme.` : ""}`);
    }
    return out.join("\n\n");
  }
  function reportHtml(sv, P, prof) {
    const A = analyse(sv, P), text = (sv.report && String(sv.report.summary || "").trim()) || autoSummary(sv, P), max = Math.max(0.01, ...A.areas.map(a => a.mwds || 0));
    const kpi = (l, v, s, c) => `<div class="rk" style="--c:${c}"><span>${esc(l)}</span><b>${v}</b><small>${esc(s || "")}</small></div>`;
    const bar = (label, v, m, color, right) => `<div class="rb"><span>${esc(label)}</span><i><em style="width:${m ? Math.max(1, 100 * v / m) : 0}%;background:${color}"></em></i><b>${right ?? v}</b></div>`;
    const orgs = [...new Set(A.R.map(p => p.organisation).filter(Boolean))];
    return `<article class="rpt"><header class="rh"><div><span class="rkind">Training needs assessment</span><h1>${esc(sv.title)}</h1><p>${esc([sv.org, `${A.R.length} of ${P.length} responded`].filter(Boolean).join(" · "))}</p></div><span class="rbrand"><img src="assets/logo.png" alt="" width="26" height="28"> Training Suite</span></header>
      <section class="rsum"><h2>Executive summary</h2><div class="rsumtext" id="rSumText">${text.split(/\n\s*\n/).map(x => `<p>${esc(x.trim()).replace(/\n/g, "<br>")}</p>`).join("")}</div>
        <div class="rsign">${prof?.signature ? `<img src="${esc(prof.signature)}" alt="Signature">` : `<span class="rsig-blank"></span>`}<span class="rline"></span><b>${esc(prof?.full_name || "")}</b><span>${esc(prof?.job_title || "Programme Lead")}</span><span>${esc(dmy(new Date()))}</span></div></section>
      <h2 class="rpart">Analytics</h2>
      <div class="rks">${kpi("Invited", P.length, "", "#1F5FBF")}${kpi("Responded", A.R.length, P.length ? Math.round(100 * A.R.length / P.length) + "% response rate" : "", "#0F8A5F")}${kpi("Skill areas", (sv.areas || []).length, A.cats.length + " categories", "#6D3FC0")}${kpi("Top priority", `<em style="font-style:normal;text-transform:none;letter-spacing:0;font-size:15px;line-height:1.2;display:block;color:inherit">${esc(A.areas[0]?.name || "–")}</em>`, A.areas[0]?.mwds != null ? "score " + A.areas[0].mwds.toFixed(2) : "", "#D2391F")}${kpi("People with a need", A.recs.filter(r => r.list.length).length, "At least one area recommended", "#B8860B")}</div>
      <section class="rwide"><h2>Training priorities</h2><table class="rt"><thead><tr><th>#</th><th>Skill area</th><th>Category</th><th>Importance</th><th>Ability</th><th>Priority score</th><th>Need</th><th>Recommended</th></tr></thead><tbody>
        ${A.areas.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.name)}</b></td><td>${esc(a.cat)}</td><td>${a.imp?.toFixed(1) ?? "–"}</td><td>${a.abl?.toFixed(1) ?? "–"}</td><td>${a.mwds?.toFixed(2) ?? "–"}</td><td>${a.need != null ? Math.round(a.need * 100) + "%" : "–"}</td><td>${A.recs.filter(r => r.list.some(x => x.area.id === a.id)).length}</td></tr>`).join("")}</tbody></table></section>
      <div class="rgrid"><section><h2>Priority scores</h2>${A.areas.slice(0, 10).map((a, i) => bar(a.name, a.mwds || 0, max, i < 3 ? "#D2391F" : "#1F5FBF", a.mwds?.toFixed(2) ?? "–")).join("")}</section>
        <section><h2>By category</h2>${A.cats.map(c => bar(c.cat, c.mwds, Math.max(...A.cats.map(x => x.mwds), 0.01), "#6D3FC0", c.mwds.toFixed(2))).join("")}
          ${orgs.length > 1 ? `<h3>Top priority by organisation/MDA</h3><ol class="rlist">${orgs.slice(0, 8).map(o => { const X = analyse(sv, P, { dim: "organisation", val: o }); return `<li>${esc(o)}: <b>${esc(X.areas[0]?.name || "–")}</b> <small>(${X.R.length})</small></li>`; }).join("")}</ol>` : ""}</section></div>
      <footer class="rf">Prepared with Training Suite on ${esc(dmy(new Date()))}. Priority score = mean weighted discrepancy score (Borich): the average of (importance − ability) × the area's mean importance.</footer></article>`;
  }
  function reportTab(ctx, box, sv, P) {
    const draw = () => {
      const edited = !!(sv.report && String(sv.report.summary || "").trim());
      box.innerHTML = `<div class="rbar no-print"><span class="small muted">${edited ? "Summary edited by you." : "Summary written from the survey and its answers."}${ctx.profile.signature ? "" : ` Add your signature in <a href="#/settings">Settings</a> to sign it.`}</span><span class="row"><button class="btn ghost small" type="button" id="sumEdit">Edit summary</button>${edited ? `<button class="btn ghost small" type="button" id="sumReset">Back to the automatic summary</button>` : ""}<button class="btn red small" type="button" id="rPrint">Print or save as PDF</button></span></div><div id="rBox">${reportHtml(sv, P, ctx.profile)}</div>`;
      document.getElementById("rPrint").onclick = () => window.print();
      document.getElementById("sumEdit").onclick = () => {
        const b = document.getElementById("rSumText"), text = (sv.report?.summary || "").trim() || autoSummary(sv, P);
        b.innerHTML = `<textarea class="in" id="sumTa" rows="18" style="width:100%;font:inherit;line-height:1.6">${esc(text)}</textarea><div class="row no-print" style="margin-top:8px"><button class="btn red small" type="button" id="sumSave">Save summary</button><button class="btn ghost small" type="button" id="sumCancel">Cancel</button><span class="small muted">Leave a blank line between paragraphs.</span></div>`;
        document.getElementById("sumCancel").onclick = draw;
        document.getElementById("sumSave").onclick = () => save({ summary: document.getElementById("sumTa").value.trim(), edited_at: new Date().toISOString() });
      };
      document.getElementById("sumReset")?.addEventListener("click", () => save(null));
    };
    const save = async rep => { const { error } = await ctx.sb.from("tna_surveys").update({ report: rep }).eq("id", sv.id); if (error) return ctx.toast(ctx.errText(error, "Couldn't save.")); sv.report = rep; ctx.toast(rep ? "Summary saved" : "Back to the automatic summary"); draw(); };
    draw();
  }
  return { list, page, CATALOGUE, ALL, analyse, autoSummary, IMP, ABL, FIELDS };
})();
