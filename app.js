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
  // Tools that need questions written (activities.js); "test" is the pre/post test.
  const SLOTS = ["poll", "words", "quiz", "buzz", "battle", "order", "match", "spot", "case", "exit"];
  const slotsOf = s => [...(s.pre_test || s.post_test ? ["test"] : []), ...SLOTS.filter(t => (s.tools || []).includes(t))];
  const acts = {};   // session id → activities
  async function loadActs(sid, fresh) {
    if (acts[sid] && !fresh) return acts[sid];
    const { data, error } = await sb.from("activities").select("*").eq("session_id", sid);
    if (error) return null;
    return (acts[sid] = data || []);
  }
  const achievement = (pre, post) => pre == null || post == null ? null : pre >= 100 ? (post >= 100 ? 1 : (post - 100) / 100) : (post - pre) / (100 - pre);

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
    document.querySelectorAll("#mainNav a").forEach(a => a.setAttribute("aria-current", a.dataset.nav === r || (r === "session" && a.dataset.nav === "sessions") || (r === "people" && a.dataset.nav === "programmes") ? "page" : "false"));
    if (!loaded) await loadData();
    const V = { dashboard: viewDashboard, programmes: viewProgrammes, sessions: viewSessions, new: () => viewWizard(null), edit: () => viewWizard(arg), session: () => viewSession(arg), people: () => viewPeople(arg), present: () => viewPresent(arg), library: () => viewSoon("Library", "Collections of ready-made questions, case studies, slides and evaluation templates you can drop into any session."), reports: () => viewSoon("Reports", "Cross-session reports for your programmes: attendance, learning achievement and evaluation, ready to print or send."), settings: viewSettings };
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
          <span style="min-width:0"><b>${esc(p.name)}</b><span class="meta">${esc([p.code, p.dates].filter(Boolean).join(" · ") || "No code or dates yet")}${p.certificates ? " · Certificates" : ""}${p.roster_only ? " · Registered list only" : ""}</span></span>${p.completed_at ? `<span class="badge done">Completed</span>` : ""}
          <span class="meta meta2">${ss.length} session${ss.length === 1 ? "" : "s"}</span><span class="sign">${open ? "HIDE −" : "SESSIONS +"}</span></button>
        ${open ? `<div class="inside">${ss.map(s => { const [t, c] = statusOf(s); return `<a class="srow" href="#/session/${s.id}"><span><b>${esc(s.topic)}</b><small>${esc(fmtDate(s.session_date))}${s.start_time ? " · " + esc(s.start_time) : ""}</small></span><span class="badge ${c}">${t}</span><span class="ok">Open →</span></a>`; }).join("") || `<p class="muted" style="padding:6px 0 12px">No sessions in this programme yet.</p>`}
          <div class="row" style="margin-top:10px"><a class="btn ghost small" href="#/new?p=${p.id}">+ Add a session</a><a class="btn ghost small" href="#/people/${p.id}">Participants</a><a class="btn ghost small" href="#/programmes?edit=${p.id}">Edit programme</a><button class="btn danger small" type="button" data-del="${p.id}">Delete</button></div>
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
        <div class="row" style="justify-content:space-between"><h2 style="font-size:20px">Register <span class="muted" id="regN" style="font-family:var(--body);font-weight:500;font-size:16px"></span></h2><div class="row"><button class="btn ghost small" type="button" id="regAdd">+ Check someone in</button><button class="btn ghost small" type="button" id="regRefresh">Refresh</button><button class="btn small" type="button" id="regCsv">Download (Excel/CSV)</button></div></div>
        <form id="regForm" class="grid2" hidden novalidate style="border:1.5px solid var(--ink);padding:18px"><span class="lbl full">For someone without a phone, or sharing one. Their time starts now.</span>
          <label class="fld">Title<select name="t">${TITLES.map(t => `<option>${t}</option>`).join("")}</select></label><label class="fld">Full name, as on the certificate<input name="n"></label>
          <label class="fld">Email<input name="e" type="email"></label><label class="fld">Organisation<input name="o"></label>
          <div class="row full"><button class="btn red" type="submit">Check in</button><span class="err" id="raErr" role="alert"></span></div></form>
        <div class="tablewrap"><table class="t" id="regTable"><tbody><tr><td class="muted">Loading…</td></tr></tbody></table></div>`;
    } else if (sessTab === "assess") {
      body = `<div id="actList"><p class="muted">Loading…</p></div>`;
    } else if (sessTab === "learning") {
      body = `<div id="learnBox"><p class="muted">Loading…</p></div>`;
    } else {
      const M = { evaluation: "Reaction and learning scores, per-item results and an AI summary of comments. Collapsed sections, like the dashboard.", certs: "Who qualifies, who has downloaded theirs, and reissue or revoke.", report: "A one-page summary of the session for your records or your director." };
      body = `<div class="empty"><div><h2>${esc(T.find(t => t[0] === sessTab)[1])}</h2><p class="muted">${esc(M[sessTab])} This fills in once the session has run, in the next phases.</p></div></div>`;
    }
    V(`<div class="pagehead"><div><span class="lbl">${esc(p.name || "")}</span><h1>${esc(s.topic)}</h1><span class="muted">${esc([s.course_lead && "Course lead: " + s.course_lead, fmtDate(s.session_date), s.start_time, s.venue].filter(Boolean).join(" · "))}</span></div>
        <div class="row"><span class="badge ${sc}" style="padding:10px 14px">${st}</span><a class="btn ghost small" href="#/edit/${s.id}">Edit</a>
        ${s.status === "completed" ? `<button class="btn ghost small" type="button" id="reopenRun">Reopen session</button>` : s.status === "live" ? `<a class="btn red" href="#/present/${s.id}">▶ Back to live screen</a><button class="btn ghost small" type="button" id="endRun">End session</button>` : `<button class="btn red" type="button" id="startRun">▶ Start session</button>`}</div></div>
      <div class="tabbar" role="tablist" aria-label="Session">${T.map(([k, n]) => `<button type="button" role="tab" aria-selected="${sessTab === k}" data-stab="${k}">${n}</button>`).join("")}</div>${body}`);
    const v = $("view");
    v.querySelectorAll("[data-stab]").forEach(b => b.addEventListener("click", () => { sessTab = b.dataset.stab; viewSession(id); }));
    const save = async patch => { const { data, error } = await sb.from("sessions").update(patch).eq("id", id).select().single(); if (error) return toast(errText(error, "Couldn't update.")); sessions = sessions.map(x => x.id === id ? data : x); viewSession(id); };
    $("startRun")?.addEventListener("click", async () => { await save({ status: "live", progress: 0 }); location.hash = "#/present/" + id; });
    if (sessTab === "attendance") loadRegister(s);
    if (sessTab === "assess") drawActs(s);
    if (sessTab === "learning") drawLearning(s);
    $("endRun")?.addEventListener("click", () => {
      const b = $("endRun");
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to end for everyone"; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "End session"; } }, 4000); return; }
      endSession(s);
    });
    $("reopenRun")?.addEventListener("click", async () => {
      const { error } = await sb.rpc("reopen_session", { p_session: id });
      if (error) return toast(errText(error, "Couldn't reopen.").replace("schema.sql", "schema-4-attendance.sql"));
      await loadData(); toast("Session reopened"); viewSession(id);
    });
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

  // End a session for everyone: phones show their summary; the programme completes after its last session.
  async function endSession(s) {
    const { data, error } = await sb.rpc("end_session", { p_session: s.id });
    if (error) return toast(errText(error, "Couldn't end the session.").replace("schema.sql", "schema-4-attendance.sql"));
    const ch = sb.channel("ts-" + s.attendance_code, { config: { broadcast: { self: false } } });
    ch.subscribe(st => { if (st === "SUBSCRIBED") { ch.send({ type: "broadcast", event: "ended", payload: {} }); setTimeout(() => (sb.removeChannel ? sb.removeChannel(ch) : ch.unsubscribe?.()), 1500); } });
    await loadData();
    toast(data?.programme_completed ? "Session ended. That was the last one: the programme is completed." : "Session ended. The room is closed on every phone.");
    if (location.hash === "#/session/" + s.id) viewSession(s.id);
  }

  // ---------- register (Attendance tab) ----------
  const fmtT = t => t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const hm = sec => { if (sec == null) return "–"; const m = Math.round(sec / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const pName = r => (r.title ? (r.title === "Miss" || r.title === "Ms" ? r.title + " " : r.title + ". ") : "") + r.name;
  const TITLES = ["", "Prof", "Dr", "Engr", "Mr", "Mrs", "Miss", "Ms"];
  const normName = n => String(n || "").toLowerCase().replace(/^(prof|dr|engr|mr|mrs|miss|ms)\.?\s+/, "").replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");
  async function loadRegister(s) {
    const add = $("regAdd"), form = $("regForm");
    add.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) form.n.focus(); };
    form.onsubmit = async e => {
      e.preventDefault();
      $("raErr").textContent = "Checking in…";
      const { error } = await sb.rpc("facilitator_checkin", { p_session: s.id, p_title: form.t.value, p_name: form.n.value.trim(), p_email: form.e.value.trim(), p_org: form.o.value.trim() });
      if (error) return ($("raErr").textContent = errText(error, "Couldn't check them in.").replace("schema.sql", "schema-4-attendance.sql"));
      $("raErr").textContent = ""; form.reset(); form.hidden = true; toast("Checked in"); draw();
    };
    const draw = async () => {
      const { data, error } = await sb.rpc("session_roll", { p_session: s.id });
      const t = $("regTable"); if (!t) return;
      if (error) { t.innerHTML = `<tbody><tr><td class="muted">${esc(errText(error, "Couldn't load the register.")).replace("schema.sql", "schema-2-participants.sql")}</td></tr></tbody>`; return; }
      const rows = data || [];
      // the same name under two emails is probably one person
      const byName = {}; rows.forEach(r => { const k = normName(r.name); if (k) (byName[k] = byName[k] || []).push(r); });
      // keep the listed one, then the one checked in on a phone (has a photo), then the earliest arrival
      const rank = x => (x.preloaded ? 0 : 2) + (x.photo ? 0 : 1);
      const keeperOf = r => [...(byName[normName(r.name)] || [])].sort((a, b) => rank(a) - rank(b) || new Date(a.arrived_at) - new Date(b.arrived_at))[0];
      const dupOf = r => (byName[normName(r.name)] || []).length > 1 ? [keeperOf(r)].filter(k => k.participant !== r.participant) : [];
      const isDup = r => (byName[normName(r.name)] || []).length > 1;
      const away = r => (r.periods || []).map(p => `${fmtT(p.out)}–${fmtT(p.back)}`).concat(r.left_at ? [`${fmtT(r.left_at)}–`] : []).join(", ");
      $("regN").textContent = `· ${rows.length} checked in · ${rows.filter(r => r.left_at).length} tapped out`;
      t.innerHTML = `<thead><tr><th>#</th><th>Photo</th><th>Name</th><th>Email</th><th>Organisation</th><th>In</th><th>Away</th><th>Out</th><th>Time spent</th><th></th></tr></thead><tbody>${rows.map((r, i) => {
        const d = dupOf(r);
        return `<tr><td>${i + 1}</td><td>${r.photo ? `<img src="${esc(r.photo)}" alt="" width="40" height="40" style="object-fit:cover;display:block">` : ""}</td>
          <td><b>${esc(pName(r))}</b>${isDup(r) ? `<br><span class="flag">Possible duplicate</span>` : ""}</td><td>${esc(r.email)}</td><td>${esc(r.organisation)}</td>
          <td>${fmtT(r.arrived_at)}</td><td>${r.away_seconds || r.left_at ? `<span title="${esc(away(r))}">${hm(r.away_seconds)}</span><br><small class="muted">${esc(away(r))}</small>` : "–"}</td>
          <td>${fmtT(r.left_at) || "–"}</td><td><b>${hm(r.spent_seconds)}</b></td>
          <td>${d.length ? `<button class="btn ghost small" type="button" data-merge="${r.participant}" data-into="${d[0].participant}">Merge into ${esc(d[0].email)}</button>` : ""}</td></tr>`;
      }).join("") || `<tr><td colspan="10" class="muted">No one has checked in yet. Open the live screen to show the check-in QR code.</td></tr>`}</tbody>`;
      t.querySelectorAll("[data-merge]").forEach(b => b.addEventListener("click", async () => {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to merge"; return; }
        const { error } = await sb.rpc("merge_participants", { p_keep: b.dataset.into, p_drop: b.dataset.merge });
        if (error) return toast(errText(error, "Couldn't merge.").replace("schema.sql", "schema-4-attendance.sql"));
        toast("Merged into one person"); draw();
      }));
      $("regCsv").onclick = () => {
        const p = progs.find(x => x.id === s.programme_id) || {};
        csvDownload(`Register - ${s.topic}`, [["Programme", p.name], ["Session", s.topic], ["Date", s.session_date || ""], [],
          ["#", "Title", "Name", "Email", "Organisation", "Time in", "Time away", "Away periods", "Time out", "Time spent", "Minutes spent", "Photo"],
          ...rows.map((r, i) => [i + 1, r.title, r.name, r.email, r.organisation, fmtT(r.arrived_at), hm(r.away_seconds), away(r), fmtT(r.left_at), hm(r.spent_seconds), Math.round((r.spent_seconds || 0) / 60), r.photo])]);
      };
    };
    $("regRefresh").onclick = draw;
    draw();
  }

  // ---------- participants of a programme (preloaded list) ----------
  // Accepts pasted Excel rows (tabs) or CSV: any order, the email is found by its @; a title in front of the name is kept.
  function parseRoster(text) {
    const out = [];
    text.split(/\r?\n/).forEach(line => {
      const cells = (line.includes("\t") ? line.split("\t") : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map(c => c.trim().replace(/^"|"$/g, "").trim());
      const ei = cells.findIndex(c => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c));
      if (ei < 0) return;
      const rest = cells.filter((c, i) => i !== ei && c);
      let title = "";
      if (rest.length && TITLES.includes(rest[0].replace(/\.$/, "")) && rest[0]) title = rest.shift().replace(/\.$/, "");
      let name = rest.shift() || "";
      const m = name.match(/^(Prof|Dr|Engr|Mr|Mrs|Miss|Ms)\.?\s+(.+)$/i);
      if (m && !title) { title = TITLES.find(t => t.toLowerCase() === m[1].toLowerCase()) || ""; name = m[2]; }
      out.push({ title, name, email: cells[ei].toLowerCase(), org: rest.shift() || "" });
    });
    return out;
  }
  async function viewPeople(pid) {
    const p = progs.find(x => x.id === pid);
    if (!p) return V(`<p class="muted">Programme not found. <a href="#/programmes">Back to programmes</a></p>`);
    V(`<div class="pagehead"><div><span class="lbl"><a href="#/programmes">Programmes</a> / ${esc(p.name)}</span><h1>Participants</h1></div></div>
      <div class="grid2">
        <div style="display:flex;flex-direction:column;gap:14px">
          <span class="lbl">Who can check in</span>
          <label class="opt"><input type="radio" name="ro" value="0" ${!p.roster_only ? "checked" : ""}><span><b>Anyone with the code</b><span class="muted">People register themselves at check-in.</span></span></label>
          <label class="opt"><input type="radio" name="ro" value="1" ${p.roster_only ? "checked" : ""}><span><b>Only people on the list below</b><span class="muted">Anyone else sees: “This email isn't registered for this programme. Use the email you registered with.”</span></span></label>
          <label class="fld" style="max-width:320px">After the programme ends, participants can open their page for<select id="accDays">${[[7, "1 week"], [14, "2 weeks"], [30, "30 days"], [90, "3 months"], [365, "1 year"]].map(([d, t]) => `<option value="${d}" ${p.access_days === d ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <div class="row"><button class="btn" type="button" id="ppSave">Save</button><span class="err" id="ppMsg" role="status"></span></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <span class="lbl">Add people</span>
          <label class="fld">Paste from Excel, or type one person per line<span class="hint">Title, name, email, organisation. The order doesn't matter as long as each line has an email.</span>
            <textarea id="ppPaste" rows="6" placeholder="Dr	Ada Obi	ada.obi@lagosstate.gov.ng	Ministry of Health&#10;Mr Bola Ade, bola.ade@lagosstate.gov.ng, PSSDC"></textarea></label>
          <div class="row"><label class="btn ghost small">Upload CSV<input type="file" id="ppFile" accept=".csv,.txt,text/csv" hidden></label><button class="btn red" type="button" id="ppAdd">Add to the list</button><span class="err" id="ppAddMsg" role="status"></span></div>
        </div>
      </div>
      <div class="row" style="justify-content:space-between"><h2 style="font-size:20px">People <span class="muted" id="ppN" style="font-family:var(--body);font-weight:500;font-size:16px"></span></h2><button class="btn small" type="button" id="ppCsv">Download (Excel/CSV)</button></div>
      <div class="tablewrap"><table class="t" id="ppTable"><tbody><tr><td class="muted">Loading…</td></tr></tbody></table></div>`);
    let people = [];
    const draw = async () => {
      const { data, error } = await sb.rpc("programme_people", { p_programme: pid });
      const t = $("ppTable"); if (!t) return;
      if (error) { t.innerHTML = `<tbody><tr><td class="muted">${esc(errText(error, "Couldn't load.").replace("schema.sql", "schema-4-attendance.sql"))}</td></tr></tbody>`; return; }
      people = data || [];
      const pre = people.filter(x => x.preloaded).length;
      $("ppN").textContent = `· ${pre} on the list · ${people.length - pre} registered at check-in`;
      t.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th>On the list</th><th>Sessions attended</th><th></th></tr></thead><tbody>${people.map(x => `<tr><td><b>${esc(pName(x))}</b></td><td>${esc(x.email)}</td><td>${esc(x.organisation)}</td>
        <td>${x.preloaded ? `<span class="ok">Yes</span>` : `<span class="muted">No</span>`}</td><td>${x.sessions}</td><td>${x.preloaded ? `<button class="btn ghost small" type="button" data-rm="${x.id}">Remove</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No one yet. Paste your list above, or let people register at check-in.</td></tr>`}</tbody>`;
      t.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", async () => {
        const { error } = await sb.rpc("roster_remove", { p_participant: b.dataset.rm });
        if (error) return toast(errText(error, "Couldn't remove.")); draw();
      }));
    };
    $("ppSave").onclick = async () => {
      const row = { roster_only: document.querySelector('input[name="ro"]:checked').value === "1", access_days: +$("accDays").value };
      const { data, error } = await sb.from("programmes").update(row).eq("id", pid).select().single();
      if (error) return ($("ppMsg").textContent = errText(error, "Couldn't save.").replace("schema.sql", "schema-4-attendance.sql"));
      progs = progs.map(x => x.id === pid ? data : x); $("ppMsg").textContent = "Saved ✓";
    };
    $("ppFile").onchange = async e => { const f = e.target.files[0]; if (f) { $("ppPaste").value = await f.text(); $("ppAddMsg").textContent = `${parseRoster($("ppPaste").value).length} people found. Press Add to the list.`; } };
    $("ppAdd").onclick = async () => {
      const rows = parseRoster($("ppPaste").value), msg = $("ppAddMsg");
      if (!rows.length) return (msg.textContent = "No emails found. Each line needs an email address.");
      msg.textContent = "Adding…";
      const { data, error } = await sb.rpc("roster_import", { p_programme: pid, p_rows: rows });
      if (error) return (msg.textContent = errText(error, "Couldn't add.").replace("schema.sql", "schema-4-attendance.sql"));
      msg.textContent = `${data.added} added, ${data.updated} already there${data.skipped ? `, ${data.skipped} skipped (bad email)` : ""}.`;
      $("ppPaste").value = ""; draw();
    };
    $("ppCsv").onclick = () => csvDownload(`Participants - ${p.name}`, [["Title", "Name", "Email", "Organisation", "On the list", "Sessions attended"], ...people.map(x => [x.title, x.name, x.email, x.organisation, x.preloaded ? "Yes" : "No", x.sessions])]);
    draw();
  }

  // ---------- questions (Assessments tab) ----------
  const csvDownload = (name, rows) => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = name.replace(/[\\/:*?"<>|]/g, "-").slice(0, 90) + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  function whereInFlow(s, slot) {
    if (slot === "test") return [s.pre_test && "at the start", s.post_test && "at the end"].filter(Boolean).join(" and ");
    if (slot === "exit") return "at the end";
    const f = (s.flow || []).find(x => x.tool === slot);
    return f ? (f.after ? `after slide ${f.after}` : "at the start of training") : "whenever you choose";
  }
  async function drawActs(s, openSlot) {
    const box = $("actList"); if (!box) return;
    const list = await loadActs(s.id);
    if (list === null) { box.innerHTML = `<p class="note warn">The database needs its activities update: run supabase/schema-3-activities.sql in Supabase.</p>`; return; }
    const slots = slotsOf(s);
    if (!slots.length) { box.innerHTML = `<div class="empty"><div><h2>No questions needed</h2><p class="muted">This session has no quiz, poll, pre/post test or other question activity. Tick some on the Engagement and Assessment steps of <a href="#/edit/${s.id}">Edit</a>.</p></div></div>`; return; }
    box.innerHTML = `<p class="muted" style="max-width:70ch">Write the questions for each activity. They run on the live screen when your flow reaches them, and participants answer on their phones.</p>
      <div class="acts">${slots.map(slot => {
        const a = list.find(x => x.slot === slot), K = TSA.KINDS[slot], n = a?.data?.steps?.length || 0;
        return `<div class="actc" data-slot="${slot}"><div class="acth"><span class="sq" style="background:${K.color}"></span>
          <div><b>${esc(a?.title || K.name)}</b><span class="small muted">${esc(K.name)} · ${esc(whereInFlow(s, slot))}</span></div>
          <span class="small ${n ? "ok" : "muted"}">${n ? `${n} ${TSA.PROMPTY(slot) ? "prompt" : "question"}${n === 1 ? "" : "s"} ✓` : "Not written yet"}</span>
          <div class="row">${n ? `<button class="btn ghost small" type="button" data-csv="${slot}">Answers (CSV)</button>` : ""}<button class="btn ${n ? "ghost" : "red"} small" type="button" data-write="${slot}">${n ? "Edit" : "Write questions"}</button></div></div>
          <div class="actb" hidden></div></div>`;
      }).join("")}</div>`;
    const open = slot => {
      box.querySelectorAll(".actb").forEach(b => { b.hidden = true; b.innerHTML = ""; });
      const card = box.querySelector(`.actc[data-slot="${slot}"]`), body = card.querySelector(".actb"), a = list.find(x => x.slot === slot);
      body.hidden = false;
      TSA.builder(body, {
        kind: slot, title: a?.title, steps: a?.data?.steps, seconds: a?.data?.seconds,
        upload: async file => {
          const { blob, aspect } = await TSA.shrinkImage(file);
          const dest = `${profile.id}/${s.id}/spot-${crypto.randomUUID()}.jpg`;
          const up = await sb.storage.from("ts-shared").upload(dest, blob, { contentType: "image/jpeg" });
          if (up.error) throw up.error;
          return { url: sb.storage.from("ts-shared").getPublicUrl(dest).data.publicUrl, aspect };
        },
        onSave: async ({ title, steps, seconds }) => {
          const { data, error } = await sb.from("activities").upsert({ session_id: s.id, slot, kind: slot, title, data: { steps, seconds }, updated_at: new Date().toISOString() }, { onConflict: "session_id,slot" }).select().single();
          if (error) throw new Error(errText(error, "Couldn't save.").replace("schema.sql", "schema-3-activities.sql"));
          acts[s.id] = [...list.filter(x => x.slot !== slot), data];
          toast("Questions saved"); drawActs(s);
        },
        onCancel: () => { body.hidden = true; body.innerHTML = ""; }
      });
      body.querySelector("textarea,input")?.focus();
    };
    box.querySelectorAll("[data-write]").forEach(b => b.addEventListener("click", () => open(b.dataset.write)));
    box.querySelectorAll("[data-csv]").forEach(b => b.addEventListener("click", () => answersCsv(s, list.find(x => x.slot === b.dataset.csv))));
    if (openSlot) open(openSlot);
  }
  function readable(kind, step, ans) {
    if (!ans) return "";
    if (ans.i != null) return `${TSA.LETTERS[ans.i] || ""}. ${(step?.options || [])[ans.i] ?? ""}`;
    if (ans.words) return ans.words.join(" · ");
    if (ans.items) return ans.items.join(" → ");
    if (ans.rights) return (step?.pairs || []).map((p, i) => `${p.l} = ${ans.rights[i] || "?"}`).join("; ");
    if (ans.x != null) return `Tapped at ${Math.round(ans.x * 100)}%, ${Math.round(ans.y * 100)}%`;
    return ans.text || "";
  }
  async function answersCsv(s, a) {
    const { data: rs } = await sb.from("responses").select("run").eq("activity_id", a.id);
    const runs = [...new Set((rs || []).map(r => r.run))].sort();
    if (!runs.length) return toast("No answers yet. Run it from the live screen.");
    const rows = [["Session", s.topic], ["Activity", a.title], [], ["Run", "Question #", "Question", "Name", "Organisation", "Group", "Answer", "Score %", "Points", "Seconds", "Answered at"]];
    for (const run of runs) {
      const { data } = await sb.rpc("live_results", { p_activity: a.id, p_run: run });
      const label = run === "pre" ? "Pre-test" : run === "post" ? "Post-test" : "Run " + (runs.filter(x => x !== "pre" && x !== "post").indexOf(run) + 1);
      (data || []).forEach(r => { const st = a.data.steps[r.step]; rows.push([label, r.step + 1, st?.q, r.name, r.organisation, r.grp === "all" ? "" : r.grp, readable(a.kind, st, r.answer), r.score == null ? "" : Math.round(r.score * 100), r.points, (r.ms / 1000).toFixed(1), new Date(r.at).toLocaleString()]); });
    }
    csvDownload(`${a.title} - ${s.topic}`, rows);
  }

  // ---------- learning achievement (Learning tab) ----------
  const pctTxt = v => v == null ? "–" : Math.round(v) + "%";
  const achTxt = v => v == null ? "–" : Math.round(v * 100) + "%";
  async function drawLearning(s) {
    const box = $("learnBox"); if (!box) return;
    if (!s.pre_test && !s.post_test) { box.innerHTML = `<div class="empty"><div><h2>No pre/post test</h2><p class="muted">Add a pre-test and post-test on the Attendance step of <a href="#/edit/${s.id}">Edit</a> to measure each person's learning achievement.</p></div></div>`; return; }
    const { data, error } = await sb.rpc("session_learning", { p_session: s.id });
    if (error) { box.innerHTML = `<p class="note warn">${esc(errText(error, "Couldn't load results.").replace("schema.sql", "schema-3-activities.sql"))}</p>`; return; }
    const rows = (data || []).map(r => ({ ...r, ach: r.took_pre && r.took_post ? achievement(+r.pre, +r.post) : null }));
    const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const both = rows.filter(r => r.ach != null);
    const aPre = avg(rows.filter(r => r.took_pre).map(r => +r.pre)), aPost = avg(rows.filter(r => r.took_post).map(r => +r.post)), aAch = avg(both.map(r => r.ach));
    box.innerHTML = `<p class="muted" style="max-width:72ch">Learning achievement is how much of the room for improvement each person closed: (post − pre) ÷ (100 − pre). Someone who moves from 40% to 85% has achieved 75%.</p>
      <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <div class="tile" style="--c:var(--yellow)"><span class="lbl">Average pre-test</span><b>${pctTxt(aPre)}</b><span>Where the room started</span></div>
        <div class="tile" style="--c:var(--blue)"><span class="lbl">Average post-test</span><b>${pctTxt(aPost)}</b><span>Where it finished</span></div>
        <div class="tile" style="--c:var(--red)"><span class="lbl">Average achievement</span><b>${achTxt(aAch)}</b><span>Of the room for improvement</span></div>
        <div class="tile" style="--c:var(--ink)"><span class="lbl">Took both tests</span><b>${both.length}</b><span>of ${rows.length} who took a test</span></div></div>
      <div class="row" style="justify-content:space-between"><h2 style="font-size:20px">Per participant</h2><div class="row"><button class="btn ghost small" type="button" id="lnRefresh">Refresh</button>${rows.length ? `<button class="btn small" type="button" id="lnCsv">Download (Excel/CSV)</button>` : ""}</div></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Organisation</th><th>Pre-test</th><th>Post-test</th><th>Gain</th><th>Achievement</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.organisation)}</td><td>${r.took_pre ? pctTxt(+r.pre) : "–"}</td><td>${r.took_post ? pctTxt(+r.post) : "–"}</td><td>${r.ach != null ? (r.post - r.pre >= 0 ? "+" : "") + Math.round(r.post - r.pre) : "–"}</td><td>${r.ach != null ? `<span class="achbar"><i style="width:${Math.max(0, Math.min(100, r.ach * 100))}%"></i></span> <b>${achTxt(r.ach)}</b>` : `<span class="muted small">${r.took_pre ? "No post-test" : "No pre-test"}</span>`}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No test answers yet. Run the pre-test and post-test from the live screen.</td></tr>`}</tbody></table></div>`;
    $("lnRefresh").onclick = () => drawLearning(s);
    if ($("lnCsv")) $("lnCsv").onclick = () => csvDownload(`Learning achievement - ${s.topic}`, [["Session", s.topic], ["Date", s.session_date || ""], [], ["Name", "Organisation", "Pre-test %", "Post-test %", "Gain", "Learning achievement %"],
      ...rows.map(r => [r.name, r.organisation, r.took_pre ? Math.round(r.pre) : "", r.took_post ? Math.round(r.post) : "", r.ach != null ? Math.round(r.post - r.pre) : "", r.ach != null ? Math.round(r.ach * 100) : ""])]);
  }

  // ---------- LIVE: one flow of welcome, slides and activities ----------
  let P = null;
  const CARD = { pretest: ["Pre-test", "Where everyone starts"], posttest: ["Post-test", "What was learned"], evaluation: ["Session evaluation", "How it landed"], certificates: ["Certificates", "For the programme"], train: ["Training", "No slides uploaded for this session"] };
  function buildFlow(s) {
    const it = [{ t: "welcome", label: "Check-in and welcome" }];
    if (s.pre_test) it.push({ t: "card", key: "pretest", label: "Pre-test" });
    const sc = s.slide_count || 0, flow = [...(s.flow || [])].filter(f => TOOL[f.tool]).sort((a, b) => a.after - b.after);
    const act = f => ({ t: "tool", tool: f.tool, label: TOOL[f.tool].name });
    flow.filter(f => f.after <= 0).forEach(f => it.push(act(f)));
    if (!sc) { it.push({ t: "card", key: "train", label: "Training" }); flow.filter(f => f.after > 0).forEach(f => it.push(act(f))); }
    for (let n = 1; n <= sc; n++) { it.push({ t: "slide", n, label: `Slide ${n} of ${sc}` }); flow.filter(f => f.after === n || (n === sc && f.after > sc)).forEach(f => it.push(act(f))); }
    if ((s.tools || []).includes("exit")) it.push({ t: "tool", tool: "exit", label: "Exit ticket" });
    if (s.post_test) it.push({ t: "card", key: "posttest", label: "Post-test" });
    if ((s.evaluation || {}).mode !== "none") it.push({ t: "card", key: "evaluation", label: "Evaluation" });
    const p = progs.find(x => x.id === s.programme_id);
    if (p?.certificates && isLastInProgramme(s)) it.push({ t: "card", key: "certificates", label: "Certificates" });
    return it;
  }
  async function viewPresent(id) {
    const s = sessions.find(x => x.id === id);
    if (!s) return V(`<p class="muted">Session not found. <a href="#/sessions">Back to sessions</a></p>`);
    if (s.status === "ready" || s.status === "draft") {
      const { data } = await sb.from("sessions").update({ status: "live" }).eq("id", id).select().single();
      if (data) sessions = sessions.map(x => x.id === id ? data : x);
    }
    stopPresent();
    P = { s, items: buildFlow(s), i: 0, pdf: null, roll: [], known: null, queue: [], showing: false, phones: 0, cache: {} };
    $("shell").hidden = true; $("stage").hidden = false; document.body.style.overflow = "hidden";
    $("stTitle").textContent = s.topic;
    $("stStrip").innerHTML = P.items.map((x, n) => `<button type="button" data-go="${n}" class="sti ${x.t}" title="${esc(x.label)}">${x.t === "slide" ? x.n : esc(x.t === "welcome" ? "Welcome" : x.label)}</button>`).join("");
    $("stStrip").onclick = e => { const b = e.target.closest("[data-go]"); if (b) goItem(+b.dataset.go); };
    const slides = (s.files || []).find(f => f.kind === "slides");
    if (slides) loadPdf(slides.path);
    P.channel = sb.channel("ts-" + s.attendance_code, { config: { broadcast: { self: false }, presence: { key: "presenter-" + crypto.randomUUID() } } });
    P.channel.on("presence", { event: "sync" }, () => { if (!P) return; P.phones = Object.keys(P.channel.presenceState()).filter(k => !k.startsWith("presenter-")).length; counts(); });
    P.channel.on("broadcast", { event: "checkin" }, () => refreshRoll(true));
    P.channel.on("broadcast", { event: "answered" }, () => P?.run?.onAnswered());
    P.channel.subscribe(st => { if (st === "SUBSCRIBED") sayNow(); });
    P.nowTimer = setInterval(sayNow, 10000);
    P.rollTimer = setInterval(() => refreshRoll(true), 8000);
    P.acts = (await loadActs(s.id, true)) || [];
    await refreshRoll(false);
    goItem(0);
    poke();
  }
  function stopRun() { if (P?.run) { P.run.destroy(); P.run = null; } }
  function stopPresent() {
    if (!P) return;
    stopRun();
    clearInterval(P.nowTimer); clearInterval(P.rollTimer);
    if (P.channel) sb.removeChannel ? sb.removeChannel(P.channel) : P.channel.unsubscribe?.();
    P = null;
  }
  function exitPresent(to) {
    const id = P?.s.id; stopPresent();
    $("stage").hidden = true; document.body.style.overflow = "";
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    location.hash = to || "#/session/" + id;
  }
  addEventListener("hashchange", () => { if (P && !/^#\/present\//.test(location.hash)) { stopPresent(); $("stage").hidden = true; document.body.style.overflow = ""; } });
  async function loadPdf(path) {
    try {
      const { data, error } = await sb.storage.from("session-files").createSignedUrl(path, 4 * 3600);
      if (error) throw error;
      if (!window.pdfjsLib) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "vendor/pdf.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      const doc = await window.pdfjsLib.getDocument(data.signedUrl).promise;
      if (!P) return;
      P.pdf = doc; if (P.items[P.i]?.t === "slide") draw();
    } catch { if (P) { P.pdfErr = true; if (P.items[P.i]?.t === "slide") draw(); } }
  }
  async function refreshRoll(announce) {
    if (!P) return;
    const { data } = await sb.rpc("session_roll", { p_session: P.s.id });
    if (!P || !Array.isArray(data)) return;
    const known = P.known || new Set(data.map(r => r.id));
    if (P.known && announce) data.filter(r => !known.has(r.id)).forEach(r => P.queue.push(r));
    data.forEach(r => known.add(r.id)); P.known = known; P.roll = data;
    counts();
    if (P.items[P.i]?.t === "welcome") { drawWelcome(); nextArrival(); }
  }
  function counts() {
    if (!P) return;
    const inRoom = P.roll.filter(r => !r.left_at).length;
    $("stCounts").textContent = `${inRoom} checked in · ${P.phones} phone${P.phones === 1 ? "" : "s"} connected`;
  }
  function sayNow() { if (P?.channel) P.channel.send({ type: "broadcast", event: "now", payload: { label: P.items[P.i].t === "welcome" ? "Welcome. The session starts soon" : P.items[P.i].label } }); }
  function goItem(n) {
    if (!P) return;
    const to = Math.max(0, Math.min(P.items.length - 1, n));
    if (to !== P.i || !P.run) stopRun();
    P.i = to;
    const it = P.items[P.i];
    $("stPos").textContent = `${P.i + 1} of ${P.items.length}`;
    $("stKind").textContent = it.t === "slide" ? "Training" : it.t === "welcome" ? "Check-in" : it.label;
    $("stNext").textContent = P.i < P.items.length - 1 ? "Next: " + P.items[P.i + 1].label + " ▶" : "Finish session ✓";
    $("stShareSlide").hidden = it.t !== "slide";
    document.querySelectorAll("#stStrip [data-go]").forEach(b => { b.classList.toggle("on", +b.dataset.go === P.i); });
    document.querySelector("#stStrip .on")?.scrollIntoView({ block: "nearest", inline: "center" });
    draw(); sayNow();
  }
  function draw() {
    const it = P.items[P.i], m = $("stMain");
    if (it.t === "welcome") return drawWelcome();
    if (it.t === "slide") {
      if (!P.pdf) { m.innerHTML = `<div class="st-card"><span class="lbl" style="color:var(--yellow)">Slide ${it.n}</span><b>${P.pdfErr ? "Couldn't open your slides." : "Loading your slides…"}</b></div>`; return; }
      m.innerHTML = `<canvas id="stCanvas" aria-label="Slide ${it.n}"></canvas>`;
      const n = it.n, token = (P.drawToken = (P.drawToken || 0) + 1);
      P.pdf.getPage(n).then(page => {
        if (!P || token !== P.drawToken) return;
        const box = m.getBoundingClientRect(), v1 = page.getViewport({ scale: 1 });
        const sc = Math.min(box.width / v1.width, box.height / v1.height), dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: sc * dpr }), c = $("stCanvas");
        c.width = vp.width; c.height = vp.height; c.style.width = vp.width / dpr + "px"; c.style.height = vp.height / dpr + "px";
        page.render({ canvasContext: c.getContext("2d"), viewport: vp });
      });
      return;
    }
    const slot = slotOfItem(it);
    if (slot) return drawActivity(it, slot);
    const tool = it.t === "tool" ? TOOL[it.tool] : null, card = CARD[it.key] || [it.label, ""];
    m.innerHTML = `<div class="st-card"><span class="sq" style="background:${tool ? tool.color : it.key === "certificates" ? "#F4B400" : "#D2391F"}"></span><span class="lbl" style="color:var(--yellow)">${tool ? "Activity" : "Next up"}</span><b>${esc(tool ? tool.name : card[0])}</b><span>${esc(tool ? tool.line : card[1])}</span><span class="soon">This runs live on phones in the next update of Training Suite.</span></div>`;
  }
  // Activities between slides: an intro card, then the live runner (activities.js).
  const slotOfItem = it => it.t === "tool" && SLOTS.includes(it.tool) ? it.tool : it.t === "card" && (it.key === "pretest" || it.key === "posttest") ? "test" : null;
  function drawActivity(it, slot) {
    if (P.run) return;
    const m = $("stMain"), a = P.acts.find(x => x.slot === slot), K = TSA.KINDS[slot], ok = a && a.data?.steps?.length;
    const name = slot === "test" ? (it.key === "pretest" ? "Pre-test" : "Post-test") : (a?.title || K.name);
    const line = slot === "test" ? (it.key === "pretest" ? "Where everyone starts. Answer on your phone." : "The same questions again. You'll see your learning achievement.") : K.line;
    const n = ok ? a.data.steps.length : 0;
    m.innerHTML = `<div class="st-card"><span class="sq" style="background:${K.color}"></span><span class="lbl" style="color:var(--yellow)">${slot === "test" ? "Test" : "Activity"}${n ? ` · ${n} ${TSA.PROMPTY(slot) ? "prompt" : "question"}${n === 1 ? "" : "s"}` : ""}</span><b>${esc(name)}</b><span>${esc(line)}</span>
      ${ok ? `<button class="key next big" type="button" id="stStart">▶ Start${P.phones ? ` · ${P.phones} phone${P.phones === 1 ? "" : "s"} ready` : ""}</button><span class="soon">Enter starts it · → skips it</span>`
           : `<span class="soon">No questions written yet. Add them on the session's Assessments tab, then reopen the live screen.</span>`}</div>`;
    $("stStart")?.addEventListener("click", () => startRun(it, slot, a));
  }
  function startRun(it, slot, a) {
    if (!P || P.run) return;
    const run = slot === "test" ? (it.key === "pretest" ? "pre" : "post") : "r" + Date.now().toString(36);
    const m = $("stMain"); m.innerHTML = `<div class="lvwrap"></div>`;
    const at = P.i;
    P.run = TSA.live(m.firstElementChild, { sb, session: P.s, activity: a, run, channel: P.channel, phones: () => P?.phones || 0,
      onDone: () => { if (P && P.i === at) { if (P.i < P.items.length - 1) goItem(P.i + 1); else { stopRun(); draw(); } } } });
  }
  function drawWelcome() {
    const m = $("stMain"), code = P.s.attendance_code, link = checkinLink(code), here = P.roll.filter(r => !r.left_at);
    m.innerHTML = `<div class="st-welcome"><div class="st-scan"><div class="qr big">${qrSvg(link)}</div><span class="lbl" style="color:#8FA69B">Scan to check in</span><span class="code" style="color:#fff">${esc(code)}</span><span class="small" style="color:#8FA69B;word-break:break-all">${esc(link)}</span></div>
      <div class="st-roll"><div class="st-hello"><span lang="yo">Ẹ káàbọ̀</span> · You are welcome</div><h2>${esc(P.s.topic)}</h2>
      <div class="faces">${here.slice(-40).reverse().map(r => `<figure>${r.photo ? `<img src="${esc(r.photo)}" alt="">` : `<span>${esc((r.name || "?")[0])}</span>`}<figcaption>${esc(pName(r))}</figcaption></figure>`).join("") || `<p style="color:#8FA69B">Arrivals appear here.</p>`}</div></div></div>`;
  }
  function nextArrival() {
    if (!P || P.showing || !P.queue.length || P.items[P.i]?.t !== "welcome") return;
    const r = P.queue.shift(); P.showing = true;
    const o = $("stArrive");
    o.innerHTML = `<div class="arr">${r.photo ? `<img src="${esc(r.photo)}" alt="">` : `<span class="ini">${esc((r.name || "?")[0])}</span>`}<div class="st-hello"><span lang="yo">Ẹ káàbọ̀</span> · You are welcome</div><b>${esc(pName(r))}</b><span>${esc(r.organisation || "")}</span></div>`;
    o.hidden = false;
    setTimeout(() => { o.hidden = true; if (P) { P.showing = false; nextArrival(); } }, 3800);
  }
  // Sharing: copy into the public share bucket, record it, and tell the phones.
  async function publishFile(f) {
    if (P.cache[f.path]) return P.cache[f.path];
    const { data, error } = await sb.storage.from("session-files").createSignedUrl(f.path, 600);
    if (error) throw error;
    const blob = await (await fetch(data.signedUrl)).blob();
    const dest = `${profile.id}/${P.s.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-80)}`;
    const up = await sb.storage.from("ts-shared").upload(dest, blob, { contentType: f.type || blob.type || "application/octet-stream" });
    if (up.error) throw up.error;
    return (P.cache[f.path] = sb.storage.from("ts-shared").getPublicUrl(dest).data.publicUrl);
  }
  async function share(kind, name, url, target) {
    const { data, error } = await sb.from("shared_items").insert({ session_id: P.s.id, kind, name, url, target }).select().single();
    if (error) throw error;
    P.channel.send({ type: "broadcast", event: "share", payload: { id: data.id, target } });
    return data;
  }
  function openShare() {
    const files = (P.s.files || []).filter(f => f.kind === "share");
    const tg = n => `<div class="row"><button class="btn ghost small" type="button" data-sh="${n}" data-t="A">← Group A</button><button class="btn red small" type="button" data-sh="${n}" data-t="all">Everyone</button><button class="btn ghost small" type="button" data-sh="${n}" data-t="B">Group B →</button></div>`;
    $("stShare").innerHTML = `<div class="row" style="justify-content:space-between"><b style="font-family:var(--display);font-size:18px">Share with the room</b><button type="button" class="x" id="shX" aria-label="Close">×</button></div>
      ${P.items[P.i].t === "slide" ? `<div class="shrow"><b>This slide (${P.items[P.i].n})</b>${tg("slide")}</div>` : ""}
      ${files.map((f, n) => `<div class="shrow"><b>${esc(f.name)}</b>${tg(n)}</div>`).join("") || `<p class="small muted">No files preloaded. Add them on the session's Slides step.</p>`}
      <span class="err" id="shMsg" role="status"></span>`;
    $("stShare").hidden = false;
    $("shX").onclick = () => ($("stShare").hidden = true);
    $("stShare").querySelectorAll("[data-sh]").forEach(b => b.addEventListener("click", async () => {
      const msg = $("shMsg"); msg.textContent = "Sharing…";
      try {
        if (b.dataset.sh === "slide") await shareSlide(b.dataset.t);
        else { const f = files[+b.dataset.sh]; await share("file", f.name, await publishFile(f), b.dataset.t); }
        msg.textContent = `Sent to ${b.dataset.t === "all" ? "everyone" : "Group " + b.dataset.t} ✓`;
      } catch (e) { msg.textContent = errText(e, "Couldn't share.").replace("schema.sql", "schema-2-participants.sql"); }
    }));
  }
  async function shareSlide(target) {
    const n = P.items[P.i].n; if (!P.pdf) throw new Error("Slides are still loading.");
    const page = await P.pdf.getPage(n), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 1600 / v1.width });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
    const dest = `${profile.id}/${P.s.id}/slide-${n}-${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from("ts-shared").upload(dest, blob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    await share("slide", `Slide ${n}`, sb.storage.from("ts-shared").getPublicUrl(dest).data.publicUrl, target);
  }
  async function finishSession() {
    if (!P) return;
    const b = $("stNext");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to finish the session"; setTimeout(() => { if (P) { b.dataset.sure = ""; goItem(P.i); } }, 4000); return; }
    const s = P.s; exitPresent("#/session/" + s.id); endSession(s);
  }
  $("stPrev").addEventListener("click", () => P && goItem(P.i - 1));
  $("stNext").addEventListener("click", () => { if (!P) return; if (P.i >= P.items.length - 1) finishSession(); else goItem(P.i + 1); });
  $("stShareBtn").addEventListener("click", () => P && openShare());
  $("stShareSlide").addEventListener("click", () => { if (!P) return; openShare(); });
  $("stFs").addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else $("stage").requestFullscreen?.().catch(() => {}); });
  $("stExit").addEventListener("click", () => exitPresent());
  document.addEventListener("keydown", e => {
    if (!P || $("stage").hidden || e.target.closest("input,textarea,select")) return;
    if ((e.key === " " || e.key === "Enter") && e.target.closest("button") && e.target.closest(".lv,.st-card,.st-share")) return;   // a focused button on the activity acts itself
    if (P.run && (e.key === " " || e.key === "Enter")) { e.preventDefault(); P.run.main(); }
    else if (!P.run && e.key === "Enter" && $("stStart")) { e.preventDefault(); $("stStart").click(); }
    else if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); if (P.i < P.items.length - 1) goItem(P.i + 1); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); goItem(P.i - 1); }
    else if (e.key === "f" || e.key === "F") $("stFs").click();
    else if (e.key === "Escape" && !$("stShare").hidden) $("stShare").hidden = true;
    poke();
  });
  let pokeT = null;
  function poke() { $("stDock").classList.remove("idle"); clearTimeout(pokeT); pokeT = setTimeout(() => $("stDock").classList.add("idle"), 4000); }
  $("stage").addEventListener("mousemove", poke);
  addEventListener("resize", () => { if (P && P.items[P.i]?.t === "slide") draw(); });


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
