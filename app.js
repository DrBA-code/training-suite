// Training Suite — phase 1: accounts, dashboard, programmes, sessions, the guided session form and the run sheet.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cfg = window.TS_CONFIG || {};
  const sb = window.supabase && cfg.SUPABASE_URL ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const LOGO = s => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true"><rect x="3" y="20" width="32" height="32" fill="#2747C8" transform="rotate(8 19 36)"/><rect x="13" y="24" width="32" height="32" fill="#F4B400" transform="rotate(-3 29 40)"/><g transform="rotate(-7 42 22)"><rect x="26" y="6" width="32" height="32" fill="#D2391F"/><text x="42" y="28.5" text-anchor="middle" font-family="Sora, sans-serif" font-weight="800" font-size="14" fill="#FFFFFF">TS</text></g></svg>`;
  document.querySelectorAll("[data-logo]").forEach(el => el.insertAdjacentHTML("afterbegin", LOGO(+el.dataset.logo)));
  $("yr").textContent = new Date().getFullYear();

  // Activity catalogue (shared with later phases).
  const ENG = [
    ["throw", "Throw and catch", "Grab a slide or file and throw it to phones", "#F4B400"],
    ["wheel", "Spin the wheel", "Pick who answers next", "#14161C"],
    ["finger", "Finger vote", "The webcam counts raised fingers", "#D2391F"],
    ["words", "Word cloud", "Short answers grow on screen", "#2747C8"],
    ["poll", "Live poll", "Bars grow as votes come in", "#F4B400"]
  ];
  const ASS = [
    ["quiz", "Quiz", "Timed, with a portrait leaderboard", "#2747C8"],
    ["buzz", "First to catch", "First correct answer wins", "#F4B400"],
    ["battle", "Group battle", "Group A against Group B", "#14161C"],
    ["order", "Order it", "Put the steps in order", "#D2391F"],
    ["match", "Match it", "Pair terms and meanings", "#2747C8"],
    ["spot", "Spot the error", "Tap the planted mistake", "#F4B400"],
    ["case", "Case study race", "Groups answer, AI gives feedback", "#14161C"],
    ["exit", "Exit ticket", "One thing I'll apply at my desk", "#D2391F"]
  ];
  const TOOL = Object.fromEntries([...ENG, ...ASS].map(([id, name, line, color]) => [id, { id, name, line, color }]));
  const PLACEABLE = id => id !== "exit" && id !== "throw";   // throw is available all the time; exit ticket goes at the end

  let profile = null, progs = [], sessions = [], loaded = false;

  // ---------- small helpers ----------
  let toastT = null;
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); }
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = d => d ? new Date(d + "T00:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "No date yet";
  const dayMon = d => d ? [String(new Date(d + "T00:00:00").getDate()), new Date(d + "T00:00:00").toLocaleDateString([], { month: "short" }).toUpperCase()] : ["–", "TBC"];
  const progName = id => (progs.find(p => p.id === id) || {}).name || "";
  function statusOf(s) {
    if (s.status === "draft") return ["Draft", "draft"];
    if (s.status === "live") return ["Live now", "live"];
    if (s.status === "completed") return ["Completed", "done"];
    return ["Upcoming", "soon"];
  }
  function qrSvg(t) { if (!window.qrcode) return ""; const q = window.qrcode(0, "M"); q.addData(t); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  const checkinLink = code => new URL("checkin/", location.href.split("#")[0]).href + "#" + code;
  const dbHint = e => /does not exist|schema cache|Could not find/i.test((e && e.message) || "");
  const errText = (e, fb) => dbHint(e) ? "The database isn't set up yet: run supabase/schema.sql in Supabase." : (e && e.message) || fb;

  // ---------- account ----------
  function accountState(p) {
    if (!p) return "none";
    if (p.is_admin) return "admin";
    if (p.status !== "active") return p.status;
    if (p.expires_at && new Date(p.expires_at) < new Date()) return "expired";
    return "active";
  }
  async function loadProfile() {
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    return data || { id: session.user.id, status: "pending", email: session.user.email };
  }
  async function loadData() {
    const [p, s] = await Promise.all([
      sb.from("programmes").select("*").order("created_at", { ascending: false }),
      sb.from("sessions").select("*").order("session_date", { ascending: true, nullsFirst: false })
    ]);
    if (p.error) toast(errText(p.error, "Couldn't load programmes."));
    progs = p.data || []; sessions = s.data || []; loaded = true;
  }

  // ---------- auth screens ----------
  function showAuth(which) {
    $("landing").hidden = true; $("shell").hidden = true; $("auth").hidden = false;
    $("inForm").hidden = which !== "in"; $("upForm").hidden = which !== "up"; $("waitBox").hidden = which !== "wait";
    $("authTabs").hidden = which === "wait";
    $("tabIn").setAttribute("aria-current", which === "in" ? "page" : "false");
    $("tabUp").setAttribute("aria-current", which === "up" ? "page" : "false");
  }
  function showWait(state) {
    const M = {
      pending: ["Request received", "Your account is pending approval. You'll be able to sign in as soon as it's approved, usually within one working day."],
      rejected: ["Request not approved", "Your request for an account wasn't approved. If you think this is a mistake, contact the Training Suite team."],
      suspended: ["Account paused", "This account is paused. Contact the Training Suite team to reactivate it."],
      expired: ["Plan ended", "Your plan has ended. Contact the Training Suite team to renew it. Your programmes and sessions are kept."],
      admin: ["Admin account", "This is the Super Admin account. It signs in to the admin console, not to the training workspace."],
      confirm: ["Check your email", "We've sent you a link to confirm your email address. After that, your request goes for approval."]
    }[state] || ["Request received", ""];
    $("waitTitle").textContent = M[0]; $("waitMsg").textContent = M[1];
    $("waitOut").textContent = state === "admin" ? "Open the admin console" : "Back to sign in";
    $("waitOut").dataset.admin = state === "admin" ? "1" : "";
    showAuth("wait");
  }
  $("waitOut").addEventListener("click", async () => {
    if ($("waitOut").dataset.admin) { location.href = "admin/"; return; }
    await sb.auth.signOut(); profile = null; location.hash = "#/signin";
  });

  $("inForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("inEmail").value.trim(), password = $("inPass").value;
    if (!email || !password) return ($("inErr").textContent = "Enter your email and password.");
    $("inErr").textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return ($("inErr").textContent = /confirm/i.test(error.message) ? "Confirm your email first: check your inbox for the link." : "That email and password don't match.");
    $("inErr").textContent = ""; $("inPass").value = "";
    profile = await loadProfile(); loaded = false;
    location.hash = "#/dashboard"; route();
  });
  $("forgot").addEventListener("click", async () => {
    const email = $("inEmail").value.trim();
    if (!email) return ($("inErr").textContent = "Type your email above first, then tap Forgot password.");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
    $("inErr").textContent = error ? "Couldn't send the reset email. Try again in a few minutes." : "If that email has an account, a reset link is on its way.";
  });
  $("upForm").addEventListener("submit", async e => {
    e.preventDefault();
    const full_name = $("upName").value.trim(), email = $("upEmail").value.trim(), password = $("upPass").value;
    if (full_name.length < 3) return ($("upErr").textContent = "Enter your full name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ($("upErr").textContent = "Enter a valid email address.");
    if (password.length < 8) return ($("upErr").textContent = "Use at least 8 characters for your password.");
    $("upErr").textContent = "Sending…";
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0],
      data: { full_name, phone: $("upPhone").value.trim(), role: $("upRole").value, where_train: $("upWhere").value.trim() } } });
    if (error) return ($("upErr").textContent = /registered|exists/i.test(error.message) ? "That email already has an account. Sign in instead." : error.message);
    $("upErr").textContent = "";
    if (!data.session) return showWait("confirm");
    profile = await loadProfile();
    showWait("pending");
  });

  // ---------- routing ----------
  const parts = () => location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  const query = () => new URLSearchParams(location.hash.split("?")[1] || "");
  async function route() {
    if (/access_token|error_description/.test(location.hash)) return;   // Supabase is finishing a sign-in link
    const [r, arg] = parts();
    if (!sb) { $("landing").hidden = false; return; }
    const st = accountState(profile);
    if (st === "none") {
      if (r === "signin") return showAuth("in");
      if (r === "signup") return showAuth("up");
      $("auth").hidden = true; $("shell").hidden = true; $("landing").hidden = false;
      if (r) location.hash = "#/";
      return;
    }
    if (st !== "active") return showWait(st);
    if (!r || r === "signin" || r === "signup") { location.hash = "#/dashboard"; return; }
    $("landing").hidden = true; $("auth").hidden = true; $("shell").hidden = false;
    $("meName").textContent = profile.full_name || profile.email;
    $("meRole").textContent = (profile.role === "programme_lead" ? "Programme Lead" : "Course Lead") + (profile.plan ? " · " + profile.plan : "");
    document.querySelectorAll("#mainNav a").forEach(a => a.setAttribute("aria-current", a.dataset.nav === r || (r === "session" && a.dataset.nav === "sessions") ? "page" : "false"));
    if (!loaded) await loadData();
    const V = { dashboard: viewDashboard, programmes: viewProgrammes, sessions: viewSessions, new: () => viewWizard(null), edit: () => viewWizard(arg), session: () => viewSession(arg), library: () => viewSoon("Library", "Collections of ready-made questions, case studies, slides and evaluation templates you can drop into any session."), reports: () => viewSoon("Reports", "Cross-session reports for your programmes: attendance, learning achievement and evaluation, ready to print or send."), settings: viewSettings };
    (V[r] || viewDashboard)();
    $("view").focus({ preventScroll: true }); scrollTo({ top: 0 });
  }
  addEventListener("hashchange", route);
  $("signOut").addEventListener("click", async () => { await sb.auth.signOut(); profile = null; loaded = false; location.hash = "#/"; route(); });
  const V = html => ($("view").innerHTML = html);
  const head = (lbl, title, right = "") => `<div class="pagehead"><div><span class="lbl">${esc(lbl)}</span><h1>${esc(title)}</h1></div>${right}</div>`;

  // ---------- dashboard ----------
  const openFolds = { perf: true };
  function viewDashboard() {
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const first = (profile.full_name || "").replace(/^(Prof|Dr|Mr|Mrs|Miss|Ms)\.?\s+/i, "").split(" ")[0];
    const done = sessions.filter(s => s.status === "completed").length;
    const upcoming = sessions.filter(s => s.status === "ready" || s.status === "live");
    const next = upcoming.filter(s => !s.session_date || s.session_date >= today())[0] || upcoming[0];
    const tiles = `<div class="tiles">
      <div class="tile" style="--c:var(--red)"><span class="lbl">Sessions</span><b>${sessions.length}</b><span>${done} completed · ${upcoming.length} to run</span></div>
      <div class="tile" style="--c:var(--yellow)"><span class="lbl">Programmes</span><b>${progs.length}</b><span>Each holds its sessions</span></div>
      <div class="tile" style="--c:var(--blue)"><span class="lbl">Participant rating</span><b>–</b><span>From session evaluations</span></div>
      <div class="tile" style="--c:var(--ink)"><span class="lbl">Learning achievement</span><b>–</b><span>From pre and post tests</span></div></div>`;
    if (!progs.length || !sessions.length) {
      return V(head("Dashboard", `${greet}${first ? ", " + first : ""}`) + tiles + `<div class="empty">${LOGO(110)}<div>
        <h2>Let's set up your first session</h2>
        <p class="muted" style="font-size:17px;max-width:52ch">Start with a programme, then add a session to it. Ratings, learning achievement and tool usage build up here after each session.</p>
        <div class="row"><a class="btn${progs.length ? " ghost" : ""}" href="#/programmes?new=1">1 · Create a programme</a><a class="btn${progs.length ? "" : " ghost"}" href="#/new">2 · Create a session</a></div></div></div>`);
    }
    const usage = {}; sessions.forEach(s => (s.tools || []).forEach(t => (usage[t] = (usage[t] || 0) + 1)));
    const u = Object.entries(usage).sort((a, b) => b[1] - a[1]); const umax = Math.max(1, ...u.map(x => x[1]));
    const fold = (k, title, body) => `<section class="fold"><button type="button" data-fold="${k}" aria-expanded="${!!openFolds[k]}"><span>${title}</span><span>${openFolds[k] ? "HIDE −" : "SHOW +"}</span></button>${openFolds[k] ? `<div class="body">${body}</div>` : ""}</section>`;
    const later = `<p class="muted">Appears once sessions have been run with pre and post tests and evaluations.</p>`;
    V(head("Dashboard", `${greet}${first ? ", " + first : ""}`) + tiles + `<div style="display:flex;flex-direction:column;gap:10px"><span class="lbl">Analytics</span>
      ${fold("perf", "Programmes by participant performance", later)}
      ${fold("sess", "Sessions by participant performance", later)}
      ${fold("rate", "Participant ratings", later)}
      ${fold("tools", "Tool usage", u.length ? u.map(([id, n]) => `<div style="display:grid;grid-template-columns:150px 1fr 30px;gap:12px;align-items:center;font-size:14px"><span>${esc(TOOL[id]?.name || id)}</span><div class="bar" style="height:16px"><i style="width:${n / umax * 100}%;background:${TOOL[id]?.color || "#2747C8"}"></i></div><b style="text-align:right">${n}</b></div>`).join("") + `<span class="small muted">Planned across your sessions</span>` : `<p class="muted">No tools picked yet.</p>`)}
      ${next ? `<a href="#/session/${next.id}" style="margin-top:10px;background:var(--ink);color:#fff;text-decoration:none;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap"><span style="display:flex;flex-direction:column;gap:4px"><span class="lbl" style="color:var(--yellow)">Next session</span><b style="font-family:var(--display);font-size:20px">${esc(next.topic)} · ${esc(fmtDate(next.session_date))}${next.start_time ? " · " + esc(next.start_time) : ""}</b></span><span class="btn yellow small">Open</span></a>` : ""}</div>`);
    $("view").querySelectorAll("[data-fold]").forEach(b => b.addEventListener("click", () => { openFolds[b.dataset.fold] = !openFolds[b.dataset.fold]; viewDashboard(); }));
  }

  // ---------- programmes ----------
  const openProg = {};
  function progForm(p) {
    return `<form id="pForm" class="grid2" style="border:1.5px solid var(--ink);padding:22px" novalidate>
      <label class="fld full">Programme name<input name="name" value="${esc(p?.name)}" placeholder="e.g. AI for Data, Research and Routine Work"></label>
      <label class="fld">Programme code<input name="code" value="${esc(p?.code)}" placeholder="e.g. PSSDC/AI/2026/01"></label>
      <label class="fld">Dates<input name="dates" value="${esc(p?.dates)}" placeholder="e.g. 3 to 7 November 2026"></label>
      <label class="fld full">Venue<input name="venue" value="${esc(p?.venue)}"></label>
      <label class="opt full"><input type="checkbox" name="certificates" ${p?.certificates ? "checked" : ""}><span><b>Issue certificates (optional)</b><span class="muted">Given at the end of the programme's last session.</span></span></label>
      <label class="fld">Who qualifies<select name="cert_rule">${[["completion", "Completion: attended, post-test and evaluation"], ["attendance", "Attendance only"], ["achievement", "Achievement: completion plus a pass mark"]].map(([v, t]) => `<option value="${v}" ${p?.cert_rule === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="row full"><button class="btn red" type="submit">${p ? "Save changes" : "Create programme"}</button><button class="btn ghost" type="button" id="pCancel">Cancel</button><span class="err" id="pErr" role="alert"></span></div>
    </form>`;
  }
  function viewProgrammes() {
    const q = query(), editing = q.get("edit"), creating = q.get("new") === "1";
    const list = progs.map(p => {
      const ss = sessions.filter(s => s.programme_id === p.id);
      const open = !!openProg[p.id];
      return `<section class="prog"><button type="button" data-open="${p.id}" aria-expanded="${open}">
          <span class="sw" style="background:${["#D2391F", "#2747C8", "#F4B400", "#14161C"][progs.indexOf(p) % 4]}"></span>
          <span style="min-width:0"><b>${esc(p.name)}</b><span class="meta">${esc([p.code, p.dates].filter(Boolean).join(" · ") || "No code or dates yet")}${p.certificates ? " · Certificates" : ""}</span></span>
          <span class="meta meta2">${ss.length} session${ss.length === 1 ? "" : "s"}</span><span class="sign">${open ? "HIDE −" : "SESSIONS +"}</span></button>
        ${open ? `<div class="inside">${ss.map(s => { const [t, c] = statusOf(s); return `<a class="srow" href="#/session/${s.id}"><span><b>${esc(s.topic)}</b><small>${esc(fmtDate(s.session_date))}${s.start_time ? " · " + esc(s.start_time) : ""}</small></span><span class="badge ${c}">${t}</span><span class="ok">Open →</span></a>`; }).join("") || `<p class="muted" style="padding:6px 0 12px">No sessions in this programme yet.</p>`}
          <div class="row" style="margin-top:10px"><a class="btn ghost small" href="#/new?p=${p.id}">+ Add a session</a><a class="btn ghost small" href="#/programmes?edit=${p.id}">Edit programme</a><button class="btn danger small" type="button" data-del="${p.id}">Delete</button></div>
          <div data-delbox="${p.id}"></div></div>` : ""}</section>`;
    }).join("");
    V(head("Programmes", "Your programmes", `<a class="btn" href="#/programmes?new=1">+ New programme</a>`) +
      `<p class="muted" style="margin-top:-14px">A programme holds its sessions: one check-in and register, any number of sessions.</p>` +
      (creating || editing ? progForm(editing ? progs.find(p => p.id === editing) : null) : "") +
      `<div style="display:flex;flex-direction:column;gap:12px">${list || (creating ? "" : `<div class="empty"><div><h2>No programmes yet</h2><p class="muted">Create your first programme, then add sessions to it.</p><a class="btn" href="#/programmes?new=1" style="align-self:flex-start">+ New programme</a></div></div>`)}</div>`);
    const f = $("pForm");
    if (f) {
      f.name.focus();
      $("pCancel").onclick = () => (location.hash = "#/programmes");
      f.addEventListener("submit", async e => {
        e.preventDefault();
        const row = { name: f.name.value.trim(), code: f.code.value.trim(), dates: f.dates.value.trim(), venue: f.venue.value.trim(), certificates: f.certificates.checked, cert_rule: f.cert_rule.value };
        if (row.name.length < 3) return ($("pErr").textContent = "Give the programme a name.");
        $("pErr").textContent = "Saving…";
        const res = editing ? await sb.from("programmes").update(row).eq("id", editing).select().single() : await sb.from("programmes").insert(row).select().single();
        if (res.error) return ($("pErr").textContent = errText(res.error, "Couldn't save."));
        if (editing) progs = progs.map(p => p.id === editing ? res.data : p); else { progs.unshift(res.data); openProg[res.data.id] = true; }
        toast(editing ? "Programme saved" : "Programme created");
        const back = query().get("back");
        location.hash = back === "new" ? "#/new?p=" + res.data.id : "#/programmes";
      });
    }
    $("view").querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => { openProg[b.dataset.open] = !openProg[b.dataset.open]; viewProgrammes(); }));
    $("view").querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => confirmDelete(b.dataset.del)));
  }
  function confirmDelete(id) {
    const p = progs.find(x => x.id === id), box = document.querySelector(`[data-delbox="${id}"]`);
    const n = sessions.filter(s => s.programme_id === id).length;
    box.innerHTML = `<form class="confirm" style="margin-top:12px" novalidate><b>Delete “${esc(p.name)}”${n ? ` and its ${n} session${n === 1 ? "" : "s"}` : ""}?</b><span class="small muted">This can't be undone. Type the programme name to confirm.</span><input class="in" name="c" autocomplete="off" aria-label="Programme name"><div class="row"><button class="btn danger small" type="submit">Delete for good</button><button class="btn ghost small" type="button" data-x>Cancel</button><span class="err"></span></div></form>`;
    const f = box.firstElementChild; f.c.focus();
    f.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
    f.addEventListener("submit", async e => {
      e.preventDefault();
      if (f.c.value.trim().toLowerCase() !== p.name.toLowerCase()) return (f.querySelector(".err").textContent = "The name doesn't match.");
      const { error } = await sb.from("programmes").delete().eq("id", id);
      if (error) return (f.querySelector(".err").textContent = errText(error, "Couldn't delete."));
      progs = progs.filter(x => x.id !== id); sessions = sessions.filter(s => s.programme_id !== id);
      toast("Programme deleted"); viewProgrammes();
    });
  }

  // ---------- sessions list ----------
  let sTab = "all";
  function viewSessions() {
    const T = [["all", "All"], ["live", "Live now"], ["ready", "Upcoming"], ["completed", "Completed"], ["draft", "Drafts"]];
    const rows = sessions.filter(s => sTab === "all" || s.status === sTab);
    V(head("My sessions", "Sessions", `<a class="btn red" href="#/new">+ New session</a>`) +
      `<div class="tabbar" role="tablist" aria-label="Filter sessions">${T.map(([k, n]) => `<button type="button" role="tab" aria-selected="${sTab === k}" data-tab="${k}">${n}</button>`).join("")}</div>` +
      `<div>${rows.map(s => { const [t, c] = statusOf(s), [d, m] = dayMon(s.session_date); return `<a class="sess" href="#/session/${s.id}"><span class="cal"><b>${d}</b><span>${m}</span></span><span class="t"><b>${esc(s.topic)}</b><span>${esc(progName(s.programme_id))}${s.start_time ? " · " + esc(s.start_time) : ""}</span></span><span class="badge ${c}">${t}</span><span class="go">${s.status === "live" ? "Rejoin →" : s.status === "completed" ? "Records →" : "Open →"}</span></a>`; }).join("") || `<p class="muted" style="padding:24px 0">${sessions.length ? "No sessions here." : "No sessions yet. Create one to get started."}</p>`}</div>`);
    $("view").querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { sTab = b.dataset.tab; viewSessions(); }));
  }

  // ---------- the guided session form ----------
  const STEP_NAMES = ["Topic", "Attendance", "Slides", "Engagement", "Assessment", "Evaluation", "Certificate", "Flow"];
  const STEP_TITLES = ["Programme and topic", "Attendance and tests", "Slides and files", "How will you engage the room?", "How will you check learning?", "Session evaluation", "Certificates", "Your session flow"];
  let W = null;
  function viewWizard(editId) {
    const src = editId ? sessions.find(s => s.id === editId) : null;
    if (editId && !src) { V(`<p class="muted">Session not found.</p>`); return; }
    if (!W || W.key !== (editId || "new:" + (query().get("p") || ""))) {
      W = { key: editId || "new:" + (query().get("p") || ""), at: 0, id: src ? src.id : crypto.randomUUID(), existing: !!src,
        programme_id: src?.programme_id || query().get("p") || progs[0]?.id || "", topic: src?.topic || "", session_date: src?.session_date || "", start_time: src?.start_time || "",
        venue: src?.venue || "", course_lead: src?.course_lead || profile.full_name || "", objectives: src?.objectives || "", main_topic: src?.main_topic || "", key_skill: src?.key_skill || "",
        pre_test: src ? src.pre_test : true, post_test: src ? src.post_test : true, tools: new Set(src?.tools || ["throw", "wheel", "quiz", "exit"]),
        flow: src?.flow || [], evaluation: src?.evaluation || { mode: "default", anonymous: true, at_tapout: true }, files: src?.files || [], slide_count: src?.slide_count || 0,
        attendance_code: src?.attendance_code || "" };
    }
    drawWizard();
  }
  function wizardField(name) { const el = $("view").querySelector(`[name="${name}"]`); return el ? el.value.trim() : W[name]; }
  function grabStep() {
    const v = $("view");
    if (W.at === 0) ["programme_id", "topic", "session_date", "start_time", "venue", "course_lead", "objectives", "main_topic", "key_skill"].forEach(k => (W[k] = wizardField(k)));
    if (W.at === 1) { W.pre_test = v.querySelector("[name=pre_test]").checked; W.post_test = v.querySelector("[name=post_test]").checked; }
    if (W.at === 5) W.evaluation = { mode: v.querySelector("[name=evmode]:checked").value, anonymous: v.querySelector("[name=anon]").checked, at_tapout: v.querySelector("[name=tapout]").checked };
    if (W.at === 7) v.querySelectorAll("[data-after]").forEach(i => { const f = W.flow.find(x => x.tool === i.dataset.after); if (f) f.after = Math.max(0, parseInt(i.value, 10) || 0); });
  }
  function checkStep(i) {
    if (i === 0) {
      if (!W.programme_id) return "Pick a programme, or create one first.";
      if (W.topic.length < 2) return "Type the session topic.";
    }
    return "";
  }
  function syncFlow() {
    const placeable = [...W.tools].filter(PLACEABLE);
    W.flow = W.flow.filter(f => placeable.includes(f.tool));
    const sc = W.slide_count || 0;
    placeable.forEach((t, i) => { if (!W.flow.some(f => f.tool === t)) W.flow.push({ tool: t, after: sc ? Math.round(sc * (i + 1) / (placeable.length + 1)) : 0 }); });
    W.flow.sort((a, b) => a.after - b.after);
  }
  function drawWizard() {
    const at = W.at, p = progs.find(x => x.id === W.programme_id);
    let body = "";
    if (at === 0) {
      body = progs.length ? `<div class="grid2">
        <label class="fld full">Programme<span class="hint">Every session belongs to a programme. <a href="#/programmes?new=1&back=new">Create a new programme</a> if yours isn't listed.</span><select name="programme_id">${progs.map(x => `<option value="${x.id}" ${x.id === W.programme_id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        <label class="fld full">Topic<input name="topic" value="${esc(W.topic)}" placeholder="e.g. Prompting for routine work"></label>
        <label class="fld">Date<input type="date" name="session_date" value="${esc(W.session_date)}"></label>
        <label class="fld">Start time<input type="time" name="start_time" value="${esc(W.start_time)}"></label>
        <label class="fld">Course lead<input name="course_lead" value="${esc(W.course_lead)}"></label>
        <label class="fld">Venue<input name="venue" value="${esc(W.venue)}" placeholder="e.g. PSSDC Hall B"></label>
        <label class="fld full">Learning objectives<span class="hint">One per line. By the end of the session, participants will be able to…</span><textarea name="objectives" rows="4">${esc(W.objectives)}</textarea></label>
        <label class="fld">Main topic, for the evaluation<span class="hint">“My knowledge of …”</span><input name="main_topic" value="${esc(W.main_topic)}" placeholder="e.g. using AI for routine office tasks"></label>
        <label class="fld">Key skill, for the evaluation<span class="hint">“I can now …”</span><input name="key_skill" value="${esc(W.key_skill)}" placeholder="e.g. write a clear prompt that gets a usable draft"></label></div>`
        : `<div class="empty"><div><h2>Create a programme first</h2><p class="muted">Every session belongs to a programme, such as a course or a workshop series.</p><a class="btn" style="align-self:flex-start" href="#/programmes?new=1&back=new">+ New programme</a></div></div>`;
    } else if (at === 1) {
      const code = W.attendance_code;
      body = `<div class="row" style="align-items:stretch;gap:28px">
        <div style="flex:1 1 360px;border:1.5px solid var(--ink);padding:22px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          ${code ? `<div class="qr">${qrSvg(checkinLink(code))}</div><div style="display:flex;flex-direction:column;gap:8px;min-width:0"><span class="lbl">Attendance</span><span class="code">${esc(code)}</span><span class="small" style="word-break:break-all;font-family:var(--mono)">${esc(checkinLink(code))}</span></div>`
          : `<div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Attendance</span><b style="font-family:var(--display);font-size:20px">Your check-in code and QR code are made when you save the session.</b><span class="muted small">Participants scan it at the door to check in. The check-in page itself arrives in the next phase.</span></div>`}
        </div>
        <div style="flex:1 1 360px;display:flex;flex-direction:column;gap:12px">
          <label class="opt"><input type="checkbox" name="pre_test" ${W.pre_test ? "checked" : ""}><span><b>Pre-test at the start</b><span class="muted">Right after check-in, before you start training.</span></span></label>
          <label class="opt"><input type="checkbox" name="post_test" ${W.post_test ? "checked" : ""}><span><b>Post-test at the end</b><span class="muted">The same questions, shuffled. Each person sees their learning achievement.</span></span></label>
          <p class="small muted">You'll add the test questions (yourself, from the Library or drafted by AI) in the assessment phase.</p>
        </div></div>`;
    } else if (at === 2) {
      const slides = W.files.find(f => f.kind === "slides"), share = W.files.filter(f => f.kind === "share");
      body = `<div class="row" style="align-items:flex-start;gap:28px">
        <div style="flex:1 1 420px;display:flex;flex-direction:column;gap:12px"><span class="lbl">Slides</span>
          <label class="drop" for="slideIn"><b style="font-family:var(--display);font-size:18px">${slides ? "Replace your slides" : "Choose your slides"}</b><span class="muted small">PDF (save PowerPoint as PDF), up to 50 MB. You'll change slides by hand gesture or phone.</span></label>
          <input type="file" id="slideIn" accept="application/pdf,.pdf" hidden>
          ${slides ? `<div class="filerow"><span>${esc(slides.name)} · ${W.slide_count || "?"} slides</span><button type="button" data-rm="${esc(slides.path)}">Remove</button></div>` : ""}
          <span class="err" id="upMsg" role="status"></span></div>
        <div style="flex:1 1 320px;display:flex;flex-direction:column;gap:12px"><span class="lbl">Files to share in the session</span>
          <span class="small muted">Preload them now. During the session, tap Share file and throw them to the room.</span>
          ${share.map(f => `<div class="filerow"><span>${esc(f.name)}</span><button type="button" data-rm="${esc(f.path)}">Remove</button></div>`).join("")}
          <label class="btn ghost small" for="shareIn" style="align-self:flex-start">+ Add files</label>
          <input type="file" id="shareIn" multiple hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*"></div></div>`;
    } else if (at === 3 || at === 4) {
      const list = at === 3 ? ENG : ASS;
      body = `<p class="muted">${at === 3 ? "Tick what you'll use. You'll place each one between your slides on the last step. Anything you skip is still one click away during the session." : "Tick how you'll check learning. You can add the questions later."}</p>
        <div class="toolgrid">${list.map(([id, name, line, color]) => { const on = W.tools.has(id); return `<button type="button" class="toolc" data-tool="${id}" aria-pressed="${on}"><span class="top"><span class="sq" style="background:${color}"></span><span class="mk">${on ? "ADDED" : "+ ADD"}</span></span><b>${esc(name)}</b><span>${esc(line)}</span></button>`; }).join("")}</div>`;
    } else if (at === 5) {
      const ev = W.evaluation;
      body = `<div style="display:flex;flex-direction:column;gap:12px;max-width:720px">
        <label class="opt"><input type="radio" name="evmode" value="default" ${ev.mode !== "none" ? "checked" : ""}><span><b>Default evaluation</b><span class="muted">Reaction and learning (Kirkpatrick levels 1 and 2), 17 items, about 2 minutes, filled with your topic and key skill.</span></span></label>
        <label class="opt"><input type="radio" name="evmode" value="none" ${ev.mode === "none" ? "checked" : ""}><span><b>No evaluation for this session</b></span></label>
        <label class="opt"><input type="checkbox" name="anon" ${ev.anonymous ? "checked" : ""}><span><b>Anonymous to the course lead</b><span class="muted">You see completion counts and results, not who said what.</span></span></label>
        <label class="opt"><input type="checkbox" name="tapout" ${ev.at_tapout ? "checked" : ""}><span><b>Ask at tap-out</b><span class="muted">Anyone tapping out who hasn't filled it is asked first.</span></span></label>
        <p class="small muted">Your own evaluation templates arrive with the evaluation phase.</p></div>`;
    } else if (at === 6) {
      const last = isLastInProgramme({ id: W.id, programme_id: W.programme_id, session_date: W.session_date });
      body = `<div style="display:flex;flex-direction:column;gap:12px;max-width:760px">
        <div class="note">Certificates are <b>optional</b> and belong to the <b>programme</b>: they're issued at the end of its last session. A programme with one session gets them at the end of that session.</div>
        ${p ? `<label class="opt"><input type="checkbox" id="certOn" ${p.certificates ? "checked" : ""}><span><b>Issue certificates for “${esc(p.name)}”</b><span class="muted">${p.certificates ? (last ? "They'll be issued at the end of this session (the programme's last, by date)." : "They'll be issued at the end of the programme's last session, not this one.") : "Tick to turn certificates on for the whole programme."}</span></span></label>
        <p class="small muted">Who qualifies and the certificate design are set on the programme. Designs and templates arrive with the certificates phase.</p>` : `<p class="muted">Pick a programme on the first step.</p>`}</div>`;
    } else if (at === 7) {
      syncFlow();
      const sc = W.slide_count;
      const rows = [["Check-in and welcome", "#D2391F", "Before you start"]];
      if (W.pre_test) rows.push(["Pre-test", "#D2391F", "Start"]);
      rows.push([sc ? `Your slides (${sc})` : "Your slides", "#2747C8", "Train"]);
      const flowRows = W.flow.map(f => `<div class="flowrow"><span class="n"></span><span class="sq" style="background:${TOOL[f.tool].color}"></span><b>${esc(TOOL[f.tool].name)}</b><label class="small">After slide <input type="number" min="0" ${sc ? `max="${sc}"` : ""} value="${f.after}" data-after="${f.tool}" aria-label="After slide number for ${esc(TOOL[f.tool].name)}"></label></div>`).join("");
      const end = [];
      if (W.tools.has("exit")) end.push(["Exit ticket", "#D2391F", "End"]);
      if (W.post_test) end.push(["Post-test", "#D2391F", "End"]);
      if (W.evaluation.mode !== "none") end.push(["Evaluation", "#14161C", "End"]);
      if (p?.certificates) end.push(["Certificates (programme)", "#F4B400", "Last session only"]);
      const plain = r => `<div class="flowrow"><span class="n"></span><span class="sq" style="background:${r[1]}"></span><b>${esc(r[0])}</b><span class="small muted">${esc(r[2])}</span></div>`;
      const warn = [];
      if (!W.files.some(f => f.kind === "slides")) warn.push(["No slides uploaded", "You can add them later from the session page.", true]);
      if (W.pre_test || W.post_test) warn.push(["Test questions not added yet", "Added in the assessment phase.", true]);
      if (W.evaluation.mode !== "none") warn.push(["Evaluation ready", "Default form, with your topic and key skill.", false]);
      body = `<div class="row" style="align-items:flex-start;gap:28px">
        <div class="flowlist" style="flex:999 1 480px;min-width:0;display:flex;flex-direction:column;gap:10px"><span class="lbl">Activities sit between your slides</span>${rows.map(plain).join("")}${flowRows}${end.map(plain).join("")}
          <span class="small muted">Set “after slide” to place each activity. 0 means at the start of training. Throw and catch and Share file are available all the time.</span></div>
        <div style="flex:1 1 280px;display:flex;flex-direction:column;gap:10px"><span class="lbl">Readiness</span>${warn.map(([t, l, w]) => `<div class="note${w ? " warn" : ""}"><b style="display:block">${esc(t)}</b><span class="small muted">${esc(l)}</span></div>`).join("")}</div></div>`;
    }
    V(`<div class="pagehead"><div><span class="lbl">${W.existing ? "Edit session" : "New session"}</span><h1>${esc(STEP_TITLES[at])}</h1></div><a class="btn ghost small" href="${W.existing ? "#/session/" + W.id : "#/sessions"}">Cancel</a></div>
      <ol class="wsteps" aria-label="Steps">${STEP_NAMES.map((n, i) => `<li><button type="button" data-step="${i}" class="${i < at ? "done" : i === at ? "now" : ""}" ${i === at ? 'aria-current="step"' : ""}><span class="n">0${i + 1}</span><span>${n}</span></button></li>`).join("")}</ol>
      ${body}
      <div class="err" id="wErr" role="alert"></div>
      <div class="wfoot"><button class="btn ghost" type="button" id="wBack" ${at === 0 ? 'style="visibility:hidden"' : ""}>Back</button>
        <div class="row">${at === 7 ? `<button class="btn ghost" type="button" id="wDraft">Save as draft</button><button class="btn red" type="button" id="wSave">${W.existing ? "Save session" : "Create session"}</button>` : `<button class="btn" type="button" id="wNext">Next: ${STEP_NAMES[at + 1]}</button>`}</div></div>`);
    wireWizard();
  }
  function go(i) {
    grabStep();
    if (i > W.at) for (let k = W.at; k < i; k++) { const m = checkStep(k); if (m) { W.at = k; drawWizard(); $("wErr").textContent = m; return; } }
    W.at = Math.max(0, Math.min(7, i)); drawWizard();
  }
  function wireWizard() {
    const v = $("view");
    v.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => go(+b.dataset.step)));
    $("wBack").addEventListener("click", () => go(W.at - 1));
    $("wNext")?.addEventListener("click", () => go(W.at + 1));
    $("wSave")?.addEventListener("click", () => saveWizard(false));
    $("wDraft")?.addEventListener("click", () => saveWizard(true));
    v.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => { const t = b.dataset.tool; W.tools.has(t) ? W.tools.delete(t) : W.tools.add(t); drawWizard(); }));
    $("certOn")?.addEventListener("change", async e => {
      const { data, error } = await sb.from("programmes").update({ certificates: e.target.checked }).eq("id", W.programme_id).select().single();
      if (error) { toast(errText(error, "Couldn't change the programme.")); e.target.checked = !e.target.checked; return; }
      progs = progs.map(p => p.id === data.id ? data : p); drawWizard();
    });
    $("slideIn")?.addEventListener("change", e => upload(e.target.files, "slides"));
    $("shareIn")?.addEventListener("change", e => upload(e.target.files, "share"));
    v.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", async () => {
      await sb.storage.from("session-files").remove([b.dataset.rm]);
      const f = W.files.find(x => x.path === b.dataset.rm);
      W.files = W.files.filter(x => x.path !== b.dataset.rm); if (f?.kind === "slides") W.slide_count = 0;
      drawWizard();
    }));
  }
  async function pdfPages(file) {
    try {
      if (!window.pdfjsLib) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/pdf.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      return doc.numPages;
    } catch { return 0; }
  }
  async function upload(list, kind) {
    const files = [...(list || [])]; if (!files.length) return;
    const msg = $("upMsg") || { set textContent(t) { toast(t); } };
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) { msg.textContent = `${file.name} is over 50 MB.`; continue; }
      msg.textContent = `Uploading ${file.name}…`;
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${profile.id}/${W.id}/${kind}-${Date.now()}-${safe}`;
      const { error } = await sb.storage.from("session-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) { msg.textContent = errText(error, `Couldn't upload ${file.name}.`); continue; }
      if (kind === "slides") {
        const old = W.files.filter(f => f.kind === "slides");
        if (old.length) await sb.storage.from("session-files").remove(old.map(f => f.path));
        W.files = W.files.filter(f => f.kind !== "slides");
        W.slide_count = await pdfPages(file);
      }
      W.files.push({ kind, name: file.name, path, size: file.size, type: file.type });
      msg.textContent = "";
    }
    drawWizard();
  }
  async function saveWizard(asDraft) {
    grabStep();
    for (let k = 0; k < 8; k++) { const m = checkStep(k); if (m) { W.at = k; drawWizard(); $("wErr").textContent = m; return; } }
    syncFlow();
    const row = { id: W.id, programme_id: W.programme_id, topic: W.topic, session_date: W.session_date || null, start_time: W.start_time, venue: W.venue, course_lead: W.course_lead,
      objectives: W.objectives, main_topic: W.main_topic, key_skill: W.key_skill, pre_test: W.pre_test, post_test: W.post_test, tools: [...W.tools],
      flow: W.flow, evaluation: W.evaluation, files: W.files, slide_count: W.slide_count };
    if (asDraft) row.status = "draft"; else if (!W.existing || sessions.find(s => s.id === W.id)?.status === "draft") row.status = "ready";
    $("wErr").textContent = "Saving…";
    const res = W.existing ? await sb.from("sessions").update(row).eq("id", W.id).select().single() : await sb.from("sessions").insert(row).select().single();
    if (res.error) { $("wErr").textContent = errText(res.error, "Couldn't save the session."); return; }
    sessions = [...sessions.filter(s => s.id !== res.data.id), res.data].sort((a, b) => (a.session_date || "9999").localeCompare(b.session_date || "9999"));
    W = null;
    toast(asDraft ? "Saved as draft" : "Session saved");
    location.hash = "#/session/" + res.data.id;
  }
  function isLastInProgramme(s) {
    const others = sessions.filter(x => x.programme_id === s.programme_id && x.id !== s.id && x.status !== "draft");
    if (!s.session_date) return !others.length;
    return !others.some(x => (x.session_date || "") > s.session_date);
  }

  // ---------- session page ----------
  let sessTab = "run";
  function runSteps(s) {
    const p = progs.find(x => x.id === s.programme_id), sc = s.slide_count;
    const out = [["Check-in", "Welcome screen on the projector, QR code at the door"]];
    if (s.pre_test) out.push(["Pre-test", "Where everyone starts"]);
    out.push(["Train", sc ? `Your slides · ${sc} slides` : (s.files || []).some(f => f.kind === "slides") ? "Your slides" : "No slides uploaded yet"]);
    (s.flow || []).forEach(f => TOOL[f.tool] && out.push([TOOL[f.tool].name, f.after ? `After slide ${f.after}` : "At the start of training"]));
    if ((s.tools || []).includes("exit")) out.push(["Exit ticket", "One thing I'll apply at my desk"]);
    if (s.post_test) out.push(["Post-test", "Same questions, shuffled"]);
    if ((s.evaluation || {}).mode !== "none") out.push(["Evaluation", "Default form" + ((s.evaluation || {}).anonymous ? " · anonymous" : "")]);
    if (p?.certificates && isLastInProgramme(s)) out.push(["Certificates", "Programme certificates, issued at the end of its last session"]);
    return out;
  }
  function viewSession(id) {
    const s = sessions.find(x => x.id === id);
    if (!s) return V(`<p class="muted">Session not found. <a href="#/sessions">Back to sessions</a></p>`);
    const p = progs.find(x => x.id === s.programme_id) || {};
    const [st, sc] = statusOf(s), steps = runSteps(s), now = s.status === "live" ? s.progress : s.status === "completed" ? steps.length : -1;
    const T = [["run", "Run sheet"], ["details", "Details"], ["attendance", "Attendance"], ["assess", "Assessments"], ["learning", "Learning"], ["evaluation", "Evaluation"], ["certs", "Certificates"], ["report", "Report"]];
    let body = "";
    if (sessTab === "run") {
      body = `<ol class="runlist">${steps.map(([n, l], i) => `<li><span class="dot ${i < now ? "done" : i === now ? "now" : ""}">${String(i + 1).padStart(2, "0")}</span><div><b>${esc(n)}</b><span class="l">${esc(l)}</span></div>
        <div>${i < now ? `<span class="ok">Done ✓</span>` : i === now ? `<button class="btn red small" type="button" id="markDone">${i === steps.length - 1 ? "Finish session" : "Mark done"}</button>` : `<span class="small muted">${s.status === "live" ? "Up next" : ""}</span>`}</div></li>`).join("")}</ol>
        ${s.status !== "live" && s.status !== "completed" ? `<p class="small muted">The live screens (check-in, slides by gesture, activities between slides, Share file) arrive in the next phases. For now Start session lets you walk through your run sheet.</p>` : ""}`;
    } else if (sessTab === "details") {
      const obj = (s.objectives || "").split("\n").map(x => x.trim()).filter(Boolean);
      body = `<div class="grid2">
        <div style="display:flex;flex-direction:column;gap:14px"><span class="lbl">Learning objectives</span>${obj.length ? `<ol style="margin:0;padding-left:20px;display:grid;gap:6px">${obj.map(o => `<li>${esc(o)}</li>`).join("")}</ol>` : `<p class="muted">None added.</p>`}
          <span class="lbl" style="margin-top:8px">For the evaluation</span><p>Main topic: <b>${esc(s.main_topic || "–")}</b><br>Key skill: <b>${esc(s.key_skill || "–")}</b></p></div>
        <div style="display:flex;flex-direction:column;gap:12px"><span class="lbl">Files</span>${(s.files || []).map(f => `<div class="filerow"><span>${f.kind === "slides" ? "Slides · " : ""}${esc(f.name)}</span><button type="button" style="color:var(--blue)" data-open="${esc(f.path)}">Open</button></div>`).join("") || `<p class="muted">No files yet.</p>`}</div></div>
        <div class="confirm" style="border-color:var(--line-2)"><b>Delete this session</b><span class="small muted">Removes the session, its files and its results. Type the topic to confirm.</span><div class="row"><input class="in" id="delIn" style="max-width:360px" autocomplete="off" aria-label="Session topic"><button class="btn danger small" type="button" id="delGo">Delete session</button><span class="err" id="delErr"></span></div></div>`;
    } else if (sessTab === "attendance") {
      body = `<div class="row" style="gap:24px;align-items:center;border:1.5px solid var(--ink);padding:22px"><div class="qr">${qrSvg(checkinLink(s.attendance_code))}</div><div style="display:flex;flex-direction:column;gap:8px;min-width:0"><span class="lbl">Check-in code</span><span class="code">${esc(s.attendance_code)}</span><span class="small" style="font-family:var(--mono);word-break:break-all">${esc(checkinLink(s.attendance_code))}</span><button class="btn ghost small" type="button" id="copyLink" style="align-self:flex-start">Copy link</button></div></div>
        <p class="muted">The register (photos, emails, time in and out, Excel export) fills in here once check-in opens in the next phase.</p>`;
    } else {
      const M = { assess: "Quizzes, polls and other activities you run in this session, with their results.", learning: "Each participant's pre-test and post-test scores and learning achievement.", evaluation: "Reaction and learning scores, per-item results and an AI summary of comments. Collapsed sections, like the dashboard.", certs: "Who qualifies, who has downloaded theirs, and reissue or revoke.", report: "A one-page summary of the session for your records or your director." };
      body = `<div class="empty"><div><h2>${esc(T.find(t => t[0] === sessTab)[1])}</h2><p class="muted">${esc(M[sessTab])} This fills in once the session has run, in the next phases.</p></div></div>`;
    }
    V(`<div class="pagehead"><div><span class="lbl">${esc(p.name || "")}</span><h1>${esc(s.topic)}</h1><span class="muted">${esc([s.course_lead && "Course lead: " + s.course_lead, fmtDate(s.session_date), s.start_time, s.venue].filter(Boolean).join(" · "))}</span></div>
        <div class="row"><span class="badge ${sc}" style="padding:10px 14px">${st}</span><a class="btn ghost small" href="#/edit/${s.id}">Edit</a>
        ${s.status === "completed" ? "" : s.status === "live" ? `<button class="btn ghost small" type="button" id="stopRun">Stop</button>` : `<button class="btn red" type="button" id="startRun">▶ Start session</button>`}</div></div>
      <div class="tabbar" role="tablist" aria-label="Session">${T.map(([k, n]) => `<button type="button" role="tab" aria-selected="${sessTab === k}" data-stab="${k}">${n}</button>`).join("")}</div>${body}`);
    const v = $("view");
    v.querySelectorAll("[data-stab]").forEach(b => b.addEventListener("click", () => { sessTab = b.dataset.stab; viewSession(id); }));
    const save = async patch => { const { data, error } = await sb.from("sessions").update(patch).eq("id", id).select().single(); if (error) return toast(errText(error, "Couldn't update.")); sessions = sessions.map(x => x.id === id ? data : x); viewSession(id); };
    $("startRun")?.addEventListener("click", () => { sessTab = "run"; save({ status: "live", progress: 0 }); });
    $("stopRun")?.addEventListener("click", () => save({ status: "ready", progress: 0 }));
    $("markDone")?.addEventListener("click", () => { const n = s.progress + 1; save(n >= steps.length ? { status: "completed", progress: steps.length } : { progress: n }); });
    $("copyLink")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(checkinLink(s.attendance_code)); toast("Link copied"); } catch { toast(checkinLink(s.attendance_code)); } });
    v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", async () => {
      const { data, error } = await sb.storage.from("session-files").createSignedUrl(b.dataset.open, 600);
      if (error) return toast("Couldn't open the file."); window.open(data.signedUrl, "_blank", "noopener");
    }));
    $("delGo")?.addEventListener("click", async () => {
      if ($("delIn").value.trim().toLowerCase() !== s.topic.toLowerCase()) return ($("delErr").textContent = "The topic doesn't match.");
      if ((s.files || []).length) await sb.storage.from("session-files").remove(s.files.map(f => f.path));
      const { error } = await sb.from("sessions").delete().eq("id", id);
      if (error) return ($("delErr").textContent = errText(error, "Couldn't delete."));
      sessions = sessions.filter(x => x.id !== id); toast("Session deleted"); location.hash = "#/sessions";
    });
  }

  // ---------- simple pages ----------
  function viewSoon(title, line) { V(head(title, title) + `<div class="empty">${LOGO(90)}<div><h2>Coming soon</h2><p class="muted" style="max-width:56ch">${esc(line)}</p></div></div>`); }
  function viewSettings() {
    const exp = profile.expires_at ? new Date(profile.expires_at).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) : "No end date";
    V(head("Settings", "Your account") + `<div class="grid2" style="max-width:860px">
      <form id="meForm" style="display:flex;flex-direction:column;gap:14px" novalidate><span class="lbl">Profile</span>
        <label class="fld">Full name<span class="hint">As it should appear on certificates you sign.</span><input name="n" value="${esc(profile.full_name)}"></label>
        <label class="fld">Phone<input name="ph" value="${esc(profile.phone)}"></label>
        <label class="fld">Where you train<input name="w" value="${esc(profile.where_train)}"></label>
        <div class="row"><button class="btn" type="submit">Save</button><span class="err" id="meErr" role="status"></span></div></form>
      <div style="display:flex;flex-direction:column;gap:14px"><span class="lbl">Plan</span>
        <p><b>${esc(profile.plan || "Approved")}</b><br><span class="muted">Ends: ${esc(exp)}</span><br><span class="muted">${esc(profile.email)}</span></p>
        <form id="pwForm" style="display:flex;flex-direction:column;gap:14px" novalidate><span class="lbl">Change password</span>
          <label class="fld">New password<input type="password" name="pw" autocomplete="new-password"></label>
          <div class="row"><button class="btn ghost" type="submit">Change password</button><span class="err" id="pwErr" role="status"></span></div></form></div></div>`);
    $("meForm").addEventListener("submit", async e => {
      e.preventDefault(); const f = e.target;
      const { data, error } = await sb.rpc("update_my_profile", { p_full_name: f.n.value, p_phone: f.ph.value, p_where_train: f.w.value });
      if (error) return ($("meErr").textContent = errText(error, "Couldn't save."));
      profile = data; $("meName").textContent = profile.full_name; $("meErr").textContent = "Saved.";
    });
    $("pwForm").addEventListener("submit", async e => {
      e.preventDefault(); const pw = e.target.pw.value;
      if (pw.length < 8) return ($("pwErr").textContent = "Use at least 8 characters.");
      const { error } = await sb.auth.updateUser({ password: pw });
      $("pwErr").textContent = error ? error.message : "Password changed."; e.target.reset();
    });
  }

  // ---------- start ----------
  async function start() {
    if (!sb) { $("landing").hidden = false; return; }
    sb.auth.onAuthStateChange(async (ev) => {
      if (ev === "PASSWORD_RECOVERY") { profile = await loadProfile(); location.hash = "#/settings"; route(); toast("Set a new password below."); }
      if (ev === "SIGNED_OUT") { profile = null; loaded = false; }
    });
    profile = await loadProfile();
    if (/access_token/.test(location.hash)) { setTimeout(async () => { profile = await loadProfile(); location.hash = "#/dashboard"; }, 600); return; }
    route();
  }
  start();
})();
