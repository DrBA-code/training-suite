// Training Suite — phase 1: accounts, dashboard, programmes, sessions, the guided session form and the run sheet.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cfg = window.TS_CONFIG || {};
  const sb = window.supabase && cfg.SUPABASE_URL ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const LOGO = s => `<img src="assets/logo.png" alt="" width="${Math.round(s * 0.94)}" height="${s}" style="display:block;flex:none">`;
  document.querySelectorAll("[data-logo]").forEach(el => el.insertAdjacentHTML("afterbegin", LOGO(+el.dataset.logo)));
  $("yr").textContent = new Date().getFullYear();

  // Activity catalogue (shared with later phases).
  const ENG = [
    ["throw", "Throw and catch", "Grab a slide or file and throw it to phones", "#F4B400"],
    ["wheel", "Spin the wheel", "Always on the live screen: pick who answers next", "#14161C"],
    ["finger", "Finger vote", "The webcam counts raised fingers", "#D2391F"],
    ["words", "Word cloud", "Short answers grow on screen", "#2747C8"],
    ["poll", "Live poll", "Bars grow as votes come in", "#F4B400"],
    ["scale", "Rating gauge", "Everyone slides to a number; a gauge shows the average", "#3FB98A"],
    ["feedback", "Star feedback", "1 to 5 stars and a comment", "#F4B400"]
  ];
  const ASS = [
    ["quiz", "Quiz", "Timed, with a portrait leaderboard", "#2747C8"],
    ["short", "Short answer", "Type a word or phrase; auto-marked", "#2747C8"],
    ["buzz", "First to catch", "First correct answer wins", "#F4B400"],
    ["battle", "Group battle", "Groups race to answer", "#14161C"],
    ["order", "Order it", "Put the steps in order", "#D2391F"],
    ["match", "Match it", "Pair terms and meanings", "#2747C8"],
    ["spot", "Spot the error", "Tap the planted mistake", "#F4B400"],
    ["case", "Case study race", "Groups answer, AI gives feedback", "#14161C"],
    ["exit", "Exit ticket", "One thing I'll apply at my desk", "#D2391F"]
  ];
  const TOOL = Object.fromEntries([...ENG, ...ASS].map(([id, name, line, color]) => [id, { id, name, line, color }]));
  const PLACEABLE = id => id !== "exit" && id !== "throw" && id !== "wheel";   // throw and the wheel are always on the live screen; exit ticket goes at the end
  // Tools that need questions written (activities.js); "test" is the pre/post test.
  const SLOTS = ["poll", "words", "finger", "scale", "feedback", "quiz", "short", "buzz", "battle", "order", "match", "spot", "case", "exit"];
  const slotsOf = s => [...(s.pre_test || s.post_test ? ["test"] : []), ...SLOTS.filter(t => (s.tools || []).includes(t))];
  const acts = {};   // session id → activities
  async function loadActs(sid, fresh) {
    if (acts[sid] && !fresh) return acts[sid];
    const { data, error } = await sb.from("activities").select("*").eq("session_id", sid);
    if (error) return null;
    return (acts[sid] = data || []);
  }
  // AI runs on the Training Suite server key (supabase/functions/ts-ai). Returns the reply, or { error }.
  async function aiCall(body) {
    try {
      const { data, error } = await sb.functions.invoke(cfg.AI_FUNCTION || "ts-ai", { body });
      if (error) return { error: /Failed to send|not found|404/i.test(error.message || "") ? "AI isn't switched on for Training Suite yet (the ts-ai server function isn't deployed)." : (error.message || "The AI request failed.") };
      return data || { error: "No reply from the AI." };
    } catch (e) { return { error: (e && e.message) || "The AI request failed." }; }
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
  // Save programme settings (certificates) and keep the local list in step.
  const saveProgramme = id => async patch => {
    const { data, error } = await sb.from("programmes").update(patch).eq("id", id).select().single();
    if (error) { toast(errText(error, "Couldn't save.").replace("schema.sql", /cert_rules/.test(error.message || "") ? "schema-11-certificates.sql" : "schema.sql")); return null; }
    progs = progs.map(x => x.id === data.id ? data : x); return data;
  };
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
    progs = p.data || []; sessions = s.data || []; loaded = true; dash = null;
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
    const [r, arg, arg2] = parts();
    document.body.classList.toggle("reporting", r === "report");
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
    document.querySelectorAll("#mainNav a").forEach(a => a.setAttribute("aria-current", a.dataset.nav === r || (r === "session" && a.dataset.nav === "sessions") || (r === "people" && a.dataset.nav === "programmes") || (r === "report" && a.dataset.nav === "reports") ? "page" : "false"));
    if (!loaded) await loadData();
    const V = { dashboard: viewDashboard, programmes: viewProgrammes, sessions: viewSessions, new: () => viewWizard(null), edit: () => viewWizard(arg), session: () => viewSession(arg), people: () => viewPeople(arg), present: () => viewPresent(arg), library: viewLibrary, reports: viewReports, report: () => viewReport(arg, arg2), settings: viewSettings };
    (V[r] || viewDashboard)();
    $("view").focus({ preventScroll: true }); scrollTo({ top: 0 });
  }
  addEventListener("hashchange", route);
  // menu: drop-down on phones and tablets, foldable to icons on wide screens
  const navOpen = on => { document.querySelector(".side-nav").classList.toggle("open", on); $("navMenu").setAttribute("aria-expanded", on); $("navMenu").textContent = on ? "Close" : "Menu"; };
  $("navMenu").addEventListener("click", () => navOpen(!document.querySelector(".side-nav").classList.contains("open")));
  addEventListener("hashchange", () => navOpen(false));
  const setFold = on => { document.body.classList.toggle("navmini", on); try { localStorage.setItem("ts_navmini", on ? "1" : ""); } catch {} $("navFold").setAttribute("aria-label", on ? "Open the menu" : "Fold the menu"); $("navFold").title = on ? "Open the menu" : "Fold the menu"; };
  $("navFold").addEventListener("click", () => setFold(!document.body.classList.contains("navmini")));
  try { if (localStorage.getItem("ts_navmini")) setFold(true); } catch {}
  $("signOut").addEventListener("click", async () => { await sb.auth.signOut(); profile = null; loaded = false; location.hash = "#/"; route(); });
  const V = html => ($("view").innerHTML = html);
  const head = (lbl, title, right = "") => `<div class="pagehead"><div><span class="lbl">${esc(lbl)}</span><h1>${esc(title)}</h1></div>${right}</div>`;

  // ---------- dashboard ----------
  const openFolds = { perf: true };
  let dash = null;   // dashboard numbers (dashboard_stats)
  function viewDashboard(refresh = true) {
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const first = (profile.full_name || "").replace(/^(Prof|Dr|Engr|Mr|Mrs|Miss|Ms)\.?\s+/i, "").split(" ")[0];
    const done = sessions.filter(s => s.status === "completed").length;
    const live = sessions.find(s => s.status === "live");
    const upcoming = sessions.filter(s => s.status === "ready" || s.status === "live").sort((a, b) => String(a.session_date || "9999").localeCompare(String(b.session_date || "9999")));
    const next = live || upcoming.filter(s => !s.session_date || s.session_date >= today())[0] || upcoming[0];
    const D = dash || {};
    const rts = (D.ratings || []).filter(x => x.rating != null), rN = rts.reduce((a, x) => a + x.n, 0);
    const rating = rN ? rts.reduce((a, x) => a + x.rating * x.n, 0) / rN : null;
    const num = (v, suf = "") => v == null ? "–" : `${Number(v).toLocaleString()}${suf ? `<small>${suf}</small>` : ""}`;
    const hero = `<section class="dcard d-hero">
      <span class="eyebrow">${live ? "A session is live" : "Your training desk"}</span>
      <h1>${greet}${first ? `, <em>${esc(first)}</em>` : ""}.</h1>
      <p>${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${done} completed · ${upcoming.length} to run.<br>${live ? `“${esc(live.topic)}” is running now.` : next ? `Next up: “${esc(next.topic)}”, ${esc(fmtDate(next.session_date))}${next.start_time ? " at " + esc(next.start_time) : ""}.` : progs.length ? "No sessions scheduled. Add one to a programme to get going." : "Create a programme, then add your first session to it."}</p>
      <div class="row">${live ? `<a class="btn yellow" href="#/present/${live.id}">Back to the live screen <span class="arr">↗</span></a>` : next ? `<a class="btn yellow" href="#/session/${next.id}">Open next session <span class="arr">↗</span></a>` : ""}
        <a class="btn ${next || live ? "ghost" : "yellow"}" href="${progs.length ? "#/new" : "#/programmes?new=1"}">${progs.length ? "+ New session" : "+ Create a programme"}</a></div>
</section>`;
    const stats = `
      <div class="dcard d-stat"><span class="eyebrow">Participant rating</span><b>${rating == null ? "–" : rating.toFixed(1)}<small>/5</small></b><span class="sub">${rating == null ? "From session evaluations" : `${"★".repeat(Math.round(rating))}${"☆".repeat(5 - Math.round(rating))} · ${rN} evaluation${rN === 1 ? "" : "s"}`}</span></div>
      <div class="dcard d-stat yellow"><span class="eyebrow">People trained</span><b>${num(D.people)}</b><span class="sub">${D.checkins != null ? `${Number(D.checkins).toLocaleString()} check-ins across ${progs.length} programme${progs.length === 1 ? "" : "s"}` : "From your registers"}</span></div>
      <div class="dcard d-stat blue"><span class="eyebrow">Learning achievement</span><b>${num(D.achievement, "%")}</b><span class="sub">Average, from pre and post tests</span></div>
      <div class="dcard d-stat red"><span class="eyebrow">Participation</span><b>${num(D.participation, "%")}</b><span class="sub">${D.runs ? `Across ${D.runs} activities run` : "Of activities run, on average"}</span></div>`;
    const nextList = upcoming.slice(0, 4);
    const nextCard = `<section class="dcard d-next"><div class="d-head"><h3>Coming up</h3><a class="btn ghost small" href="#/sessions">All sessions</a></div>
      ${nextList.map(s => { const [d, m] = dayMon(s.session_date), [t, c] = statusOf(s); return `<a class="nrow" href="#/session/${s.id}"><span class="cal"><b>${d}</b><span>${m}</span></span><span style="min-width:0"><b class="t">${esc(s.topic)}</b><small>${esc(progName(s.programme_id))}${s.start_time ? " · " + esc(s.start_time) : ""}</small></span><span class="badge ${c}">${t}</span></a>`; }).join("") || `<p class="muted">Nothing scheduled. <a href="#/new">Create a session</a>.</p>`}</section>`;
    const usage = {}; sessions.forEach(s => (s.tools || []).forEach(t => (usage[t] = (usage[t] || 0) + 1)));
    const u = Object.entries(usage).sort((a, b) => b[1] - a[1]);
    const toolsCard = `<section class="dcard d-tools"><div class="d-head"><h3>Your favourite tools</h3><span class="small muted">Planned in sessions</span></div>
      <div class="chips">${u.map(([id, n], k) => `<span class="chip${k % 3 === 0 ? " dark" : ""}">${esc(TOOL[id]?.name || id)} <i>${n}</i></span>`).join("") || `<p class="muted">Tick activities when you create a session; they show up here.</p>`}</div></section>`;
    const perSess = Object.fromEntries((D.sessions || []).map(x => [x.id, x]));
    const progCard = progs.length ? `<section class="dcard d-progs"><div class="d-head"><h3>Programmes</h3><a class="btn ghost small" href="#/programmes">Manage</a></div><div class="pgrid">${progs.map(p => {
      const ss = sessions.filter(s => s.programme_id === p.id), dn = ss.filter(s => s.status === "completed").length;
      const ach = (D.sessions || []).filter(x => x.programme === p.id && x.achievement != null).map(x => +x.achievement);
      return `<a class="pcard" href="#/programmes"><span class="meta"><span>${esc(p.code || "Programme")}</span>${p.completed_at ? `<span class="badge done">Completed</span>` : ""}</span><b>${esc(p.name)}</b>
        <div class="bar" style="height:8px"><i style="width:${ss.length ? dn / ss.length * 100 : 0}%;background:var(--red)"></i></div>
        <span class="meta"><span>${dn} of ${ss.length} session${ss.length === 1 ? "" : "s"} done</span><span>${ach.length ? Math.round(ach.reduce((a, b) => a + b, 0) / ach.length) + "% achievement" : ""}</span></span></a>`; }).join("")}</div></section>` : "";
    // analytics: one open by default, the rest folded
    const fold = (k, title, body) => `<section class="fold" data-open="${openFolds[k] ? 1 : 0}"><button type="button" data-fold="${k}" aria-expanded="${!!openFolds[k]}"><span>${title}</span><span>${openFolds[k] ? "Hide" : "Show"}</span></button>${openFolds[k] ? `<div class="body">${body}</div>` : ""}</section>`;
    const later = `<p class="muted">Fills in as you run sessions with pre and post tests and activities.</p>`;
    const barRow = (label, v, color, href) => `<a href="${href}" style="display:grid;grid-template-columns:minmax(0,220px) 1fr 52px;gap:12px;align-items:center;font-size:14px;color:var(--ink);text-decoration:none"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span><div class="bar" style="height:14px"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div><b style="text-align:right">${Math.round(v)}%</b></a>`;
    const progPerf = progs.map(p => { const a = (D.sessions || []).filter(x => x.programme === p.id && x.achievement != null).map(x => +x.achievement); return a.length ? [p, a.reduce((x, y) => x + y, 0) / a.length] : null; }).filter(Boolean).sort((a, b) => b[1] - a[1]);
    const sessPerf = sessions.map(x => [x, perSess[x.id]]).filter(([, d]) => d && (d.achievement != null || d.participation != null));
    const analytics = `<div class="d-analytics"><span class="eyebrow" style="background:var(--canvas)">Analytics</span>
      ${fold("perf", "Programmes by learning achievement", progPerf.length ? progPerf.map(([p, v]) => barRow(p.name, v, "var(--blue)", "#/programmes")).join("") : later)}
      ${fold("sess", "Sessions by learning achievement and participation", sessPerf.length ? sessPerf.map(([x, d]) => `<div style="display:flex;flex-direction:column;gap:6px"><b style="font-size:14px">${esc(x.topic)}</b>${d.achievement != null ? barRow("Learning achievement", +d.achievement, "var(--blue)", "#/session/" + x.id) : ""}${d.participation != null ? barRow("Participation", +d.participation, "var(--red)", "#/session/" + x.id) : ""}</div>`).join("") : later)}
      ${fold("rate", "Participant ratings", rts.length ? rts.map(x => { const ss = sessions.find(y => y.id === x.id); return ss ? barRow(`${ss.topic} (${x.n})`, (x.rating - 1) / 4 * 100, "var(--yellow)", "#/session/" + ss.id).replace(/<b style="text-align:right">\d+%<\/b>/, `<b style="text-align:right">${(+x.rating).toFixed(1)}★</b>`) : ""; }).join("") : later)}</div>`;
    V(`<div class="dash">${hero}${stats}${nextCard}${toolsCard}${progCard}${analytics}</div>`);
    $("view").querySelectorAll("[data-fold]").forEach(b => b.addEventListener("click", () => { openFolds[b.dataset.fold] = !openFolds[b.dataset.fold]; viewDashboard(false); }));
    if (refresh) Promise.all([sb.rpc("dashboard_stats"), sb.rpc("dashboard_ratings")]).then(([a, b]) => {
      if (!a.data) return; const next = { ...a.data, ratings: b.data || [] };
      if (JSON.stringify(next) === JSON.stringify(dash)) return;
      dash = next; if (/^#\/dashboard|^#?\/?$/.test(location.hash)) viewDashboard(false);
    });
  }

  // ---------- library ----------
  const LIBKIN = k => (["quiz", "test", "buzz", "battle"].includes(k) ? ["quiz", "test", "buzz", "battle"] : ["poll", "finger"].includes(k) ? ["poll", "finger"] : [k]);
  const libMissing = e => /library_items|schema cache|does not exist/i.test((e && e.message) || "");
  const LIB = {
    async list(kind) {
      const { data, error } = await sb.from("library_items").select("*").order("updated_at", { ascending: false });
      if (error) throw new Error(libMissing(error) ? "The Library isn't set up yet: run supabase/schema-13-step7.sql in Supabase." : errText(error, "Couldn't load the Library."));
      return (data || []).filter(x => !kind || LIBKIN(kind).includes(x.kind));
    },
    async save(it) {
      const { error } = await sb.from("library_items").insert({ kind: it.kind, title: it.title, data: it.data || { steps: it.steps, seconds: it.seconds } });
      if (error) throw new Error(libMissing(error) ? "The Library isn't set up yet: run supabase/schema-13-step7.sql in Supabase." : errText(error, "Couldn't save to the Library."));
    },
    used(id) { sb.from("library_items").select("uses").eq("id", id).single().then(({ data }) => data && sb.from("library_items").update({ uses: (data.uses || 0) + 1 }).eq("id", id)); }
  };
  const LIBTABS = [["all", "Everything"], ["questions", "Questions"], ["case", "Case studies"], ["prompts", "Polls and prompts"], ["evaluation", "Evaluation forms"]];
  const libTab = k => k === "evaluation" ? "evaluation" : k === "case" ? "case" : ["quiz", "test", "buzz", "battle", "short", "order", "match", "spot"].includes(k) ? "questions" : "prompts";
  let libView = "all", libQ = "", libOpen = null;
  async function viewLibrary() {
    V(head("Library", "Your Library", "") + `<p class="muted" style="margin-top:-14px;max-width:72ch">Question sets, case studies and evaluation forms you've kept for reuse. Add to it with <b>Save to Library</b> when writing questions or editing an evaluation; use it with <b>📚 Add from Library</b>.</p><div id="libBox"><p class="muted">Loading…</p></div>`);
    let items; try { items = await LIB.list(); } catch (e) { $("libBox").innerHTML = `<p class="note warn">${esc(e.message)}</p>`; return; }
    const draw = () => {
      const q = libQ.trim().toLowerCase(), list = items.filter(x => (libView === "all" || libTab(x.kind) === libView) && (!q || x.title.toLowerCase().includes(q) || JSON.stringify(x.data).toLowerCase().includes(q)));
      const kname = k => k === "evaluation" ? "Evaluation form" : TSA.KINDS[k]?.name || k;
      const count = x => x.kind === "evaluation" ? `${(x.data.items || []).length} questions` : `${(x.data.steps || []).length} ${TSA.PROMPTY(x.kind) ? "prompt" : "question"}${(x.data.steps || []).length === 1 ? "" : "s"}`;
      const preview = x => x.kind === "evaluation" ? `<ol>${(x.data.items || []).map(i => `<li>${esc(i.text)} <small class="muted">${esc(TSE.TYPES[i.type] || "")}</small></li>`).join("")}</ol>`
        : `<ol>${(x.data.steps || []).map(st => `<li>${esc(st.q)}${st.options ? `<small class="muted"> · ${st.options.map((o, j) => j === st.correct ? `<b>${esc(o)} ✓</b>` : esc(o)).join(" · ")}</small>` : ""}${st.text ? `<div class="small muted" style="white-space:pre-wrap">${esc(st.text.slice(0, 400))}${st.text.length > 400 ? "…" : ""}</div>` : ""}</li>`).join("")}</ol>`;
      $("libBox").innerHTML = `<div class="row" style="justify-content:space-between"><div class="tabbar" role="tablist">${LIBTABS.map(([k, t]) => `<button type="button" role="tab" aria-selected="${libView === k}" data-lt="${k}">${t}</button>`).join("")}</div>
          <input class="in" id="libQ" placeholder="Search titles and questions" value="${esc(libQ)}" style="max-width:300px"></div>
        <div class="libgrid">${list.map(x => `<div class="libcard"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><div style="min-width:0"><span class="lbl">${esc(kname(x.kind))}</span><b class="libt" data-ren="${x.id}" title="Rename">${esc(x.title)}</b><span class="small muted">${count(x)} · used ${x.uses || 0}× · ${esc(fmtDate(String(x.updated_at).slice(0, 10)))}</span></div></div>
            <div class="row"><button class="btn ghost small" type="button" data-pv="${x.id}">${libOpen === x.id ? "Hide" : "Preview"}</button><button class="btn ghost small" type="button" data-rn="${x.id}">Rename</button><button class="btn danger small" type="button" data-ld="${x.id}">Delete</button></div>
            ${libOpen === x.id ? `<div class="libpv">${preview(x)}</div>` : ""}</div>`).join("") || `<div class="empty"><div><h2>${items.length ? "Nothing matches" : "Your Library is empty"}</h2><p class="muted">${items.length ? "Try another search or tab." : "Open a session's Assessments tab, write or open some questions, and press Save to Library."}</p></div></div>`}</div>`;
      $("libBox").querySelectorAll("[data-lt]").forEach(b => (b.onclick = () => { libView = b.dataset.lt; draw(); }));
      $("libQ").oninput = e => { libQ = e.target.value; const at = e.target.selectionStart; draw(); const i = $("libQ"); i.focus(); i.setSelectionRange(at, at); };
      $("libBox").querySelectorAll("[data-pv]").forEach(b => (b.onclick = () => { libOpen = libOpen === b.dataset.pv ? null : b.dataset.pv; draw(); }));
      $("libBox").querySelectorAll("[data-rn]").forEach(b => (b.onclick = async () => {
        const x = items.find(i => i.id === b.dataset.rn), el = $("libBox").querySelector(`[data-ren="${x.id}"]`), inp = document.createElement("input");
        inp.className = "in"; inp.value = x.title; inp.maxLength = 200; el.replaceWith(inp); inp.focus(); inp.select();
        inp.onkeydown = e => { if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = x.title; inp.blur(); } };
        inp.onblur = async () => { const t = inp.value.trim(); if (t && t !== x.title) { const { error } = await sb.from("library_items").update({ title: t, updated_at: new Date().toISOString() }).eq("id", x.id); if (error) toast(errText(error, "Couldn't rename.")); else x.title = t; } draw(); };
      }));
      $("libBox").querySelectorAll("[data-ld]").forEach(b => (b.onclick = async () => {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to delete"; return; }
        const { error } = await sb.from("library_items").delete().eq("id", b.dataset.ld);
        if (error) return toast(errText(error, "Couldn't delete.")); items = items.filter(i => i.id !== b.dataset.ld); toast("Removed from your Library"); draw();
      }));
    };
    draw();
  }

  // ---------- reports ----------
  async function viewReport(kind, id) {
    const s = kind === "s" ? sessions.find(x => x.id === id) : null, p = kind === "p" ? progs.find(x => x.id === id) : progs.find(x => x.id === s?.programme_id);
    if (!p || (kind === "s" && !s)) return V(`<p class="muted">Report not found. <a href="#/reports">Back to reports</a></p>`);
    V(`<div class="rbar no-print"><a class="btn ghost small" href="${kind === "s" ? "#/session/" + s.id : "#/reports"}">← Back</a><span class="small muted">Use your browser's print window to print it or choose “Save as PDF”.</span><button class="btn red small" type="button" id="rPrint">Print or save as PDF</button></div><div id="rBox"><p class="muted">Preparing the report…</p></div>`);
    $("rPrint").onclick = () => window.print();
    if (kind === "s") {
      const d = await TSR.sessionData(sb, s); if (!$("rBox")) return;
      const draw = () => {
        $("rBox").innerHTML = TSR.session(d, p, profile);
        const edited = !!(s.report && String(s.report.summary || "").trim());
        $("rBox").insertAdjacentHTML("afterbegin", `<div class="rsumbar no-print"><span class="small muted">${edited ? "Summary edited by you." : "Summary written from the session's details and results."}${!String(s.background || "").trim() && !String(s.rationale || "").trim() ? ` Add a background and rationale in <a href="#/edit/${s.id}">Edit → Session</a>.` : ""}${profile.signature ? "" : ` Add your signature in <a href="#/settings">Settings</a> to sign reports.`}</span>
          <span class="row"><button class="btn ghost small" type="button" id="sumEdit">Edit summary</button>${edited ? `<button class="btn ghost small" type="button" id="sumReset">Back to the automatic summary</button>` : ""}</span></div>`);
        $("sumEdit").onclick = () => {
          const box = $("rSumText"), text = (s.report?.summary || "").trim() || TSR.autoSummary(d, p);
          box.innerHTML = `<textarea class="in" id="sumTa" rows="16" style="width:100%;font:inherit;line-height:1.6">${esc(text)}</textarea><div class="row no-print" style="margin-top:8px"><button class="btn red small" type="button" id="sumSave">Save summary</button><button class="btn ghost small" type="button" id="sumCancel">Cancel</button><span class="small muted">Leave a blank line between paragraphs.</span><span class="err" id="sumErr"></span></div>`;
          $("sumTa").focus();
          $("sumCancel").onclick = draw;
          $("sumSave").onclick = () => saveSummary({ summary: $("sumTa").value.trim(), edited_at: new Date().toISOString() });
        };
        $("sumReset")?.addEventListener("click", () => saveSummary(null));
      };
      const saveSummary = async rep => {
        const { data, error } = await sb.from("sessions").update({ report: rep }).eq("id", s.id).select().single();
        if (error) { const e = $("sumErr"); const m = /report|schema cache/i.test(error.message || "") ? "Run supabase/schema-15-report.sql in Supabase first." : errText(error, "Couldn't save."); if (e) e.textContent = m; else toast(m); return; }
        Object.assign(s, data); sessions = sessions.map(x => x.id === s.id ? data : x); d.s = s; toast(rep ? "Summary saved" : "Back to the automatic summary"); draw();
      };
      draw(); return;
    }
    const list = sessions.filter(x => x.programme_id === p.id && x.status !== "draft").sort((a, b) => (a.session_date || "9999").localeCompare(b.session_date || "9999"));
    const [datas, pc] = await Promise.all([Promise.all(list.map(x => TSR.sessionData(sb, x))), sb.rpc("programme_certificates", { p_programme: p.id }).then(r => r.data).catch(() => null)]);
    const people = pc?.people || null;
    const drawP = () => {
      if (!$("rBox")) return;
      $("rBox").innerHTML = TSR.programme(p, datas, people, profile);
      const edited = !!(p.report && String(p.report.summary || "").trim());
      $("rBox").insertAdjacentHTML("afterbegin", `<div class="rsumbar no-print"><span class="small muted">${edited ? "Summary edited by you." : "Summary written from the programme's details and its sessions' results."}${!String(p.background || "").trim() && !String(p.rationale || "").trim() ? ` Add a background, rationale and objectives in <a href="#/programmes?edit=${p.id}">Edit programme</a>.` : ""}${profile.signature ? "" : ` Add your signature in <a href="#/settings">Settings</a> to sign reports.`}</span>
        <span class="row"><button class="btn ghost small" type="button" id="sumEdit">Edit summary</button>${edited ? `<button class="btn ghost small" type="button" id="sumReset">Back to the automatic summary</button>` : ""}</span></div>`);
      $("sumEdit").onclick = () => {
        const box = $("rSumText"), text = (p.report?.summary || "").trim() || TSR.autoProgrammeSummary(p, datas, people);
        box.innerHTML = `<textarea class="in" id="sumTa" rows="18" style="width:100%;font:inherit;line-height:1.6">${esc(text)}</textarea><div class="row no-print" style="margin-top:8px"><button class="btn red small" type="button" id="sumSave">Save summary</button><button class="btn ghost small" type="button" id="sumCancel">Cancel</button><span class="small muted">Leave a blank line between paragraphs.</span><span class="err" id="sumErr"></span></div>`;
        $("sumTa").focus(); $("sumCancel").onclick = drawP;
        $("sumSave").onclick = () => saveP({ summary: $("sumTa").value.trim(), edited_at: new Date().toISOString() });
      };
      $("sumReset")?.addEventListener("click", () => saveP(null));
    };
    const saveP = async rep => {
      const { data, error } = await sb.from("programmes").update({ report: rep }).eq("id", p.id).select().single();
      if (error) { const m = /report|schema cache/i.test(error.message || "") ? "Run supabase/schema-15-report.sql in Supabase first." : errText(error, "Couldn't save."); const e = $("sumErr"); if (e) e.textContent = m; else toast(m); return; }
      Object.assign(p, data); progs = progs.map(x => x.id === p.id ? data : x); toast(rep ? "Summary saved" : "Back to the automatic summary"); drawP();
    };
    drawP();
  }
  function viewReports() {
    const cards = progs.map(p => {
      const ss = sessions.filter(x => x.programme_id === p.id && x.status !== "draft").sort((a, b) => (a.session_date || "9999").localeCompare(b.session_date || "9999"));
      return `<section class="repcard"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b style="font-family:var(--display);font-size:20px">${esc(p.name)}</b><span class="small muted" style="display:block">${esc([p.code, p.dates].filter(Boolean).join(" · ") || `${ss.length} session${ss.length === 1 ? "" : "s"}`)}${p.completed_at ? " · Completed" : ""}</span></div>
        ${ss.length ? `<a class="btn small" href="#/report/p/${p.id}">Programme report</a>` : ""}</div>
        ${ss.map(x => { const [t, c] = statusOf(x); return `<a class="srow" href="#/report/s/${x.id}"><span><b>${esc(x.topic)}</b><small>${esc(fmtDate(x.session_date))}</small></span><span class="badge ${c}">${t}</span><span class="ok">Session report →</span></a>`; }).join("") || `<p class="muted small">No sessions yet.</p>`}</section>`;
    }).join("");
    V(head("Reports", "Reports", "") + `<p class="muted" style="margin-top:-14px;max-width:72ch">A one-page report for every session, and a programme report that brings its sessions together: attendance, participation, learning achievement, evaluation and certificates. Open one, then print it or save it as PDF.</p>
      <div style="display:flex;flex-direction:column;gap:14px">${cards || `<div class="empty"><div><h2>No programmes yet</h2><p class="muted">Reports appear once you have sessions.</p></div></div>`}</div>`);
  }

  // ---------- programmes ----------
  const openProg = {};
  function progForm(p) {
    return `<form id="pForm" class="grid2" style="border:1.5px solid var(--ink);padding:22px" novalidate>
      <label class="fld full">Programme name<input name="name" value="${esc(p?.name)}" placeholder="e.g. AI for Data, Research and Routine Work"></label>
      <label class="fld">Programme code<input name="code" value="${esc(p?.code)}" placeholder="e.g. PSSDC/AI/2026/01"></label>
      <label class="fld">Dates<input name="dates" value="${esc(p?.dates)}" placeholder="e.g. 3 to 7 November 2026"></label>
      <label class="fld full">Venue<input name="venue" value="${esc(p?.venue)}"></label>
      <label class="fld full">Background <span class="hint" style="display:inline">(optional, for the programme report)</span><textarea name="background" rows="3" placeholder="The context: who requested the programme and the situation it responds to.">${esc(p?.background || "")}</textarea></label>
      <label class="fld full">Rationale <span class="hint" style="display:inline">(optional)</span><textarea name="rationale" rows="3" placeholder="Why the programme matters now and what it should change at work.">${esc(p?.rationale || "")}</textarea></label>
      <label class="fld full">Programme objectives <span class="hint" style="display:inline">(optional, one per line)</span><textarea name="objectives" rows="3" placeholder="By the end of the programme, participants will be able to…">${esc(p?.objectives || "")}</textarea></label>
      <label class="opt full"><input type="checkbox" name="certificates" ${p?.certificates ? "checked" : ""}><span><b>Issue certificates (optional)</b><span class="muted">Given at the end of the programme's last session.</span></span></label>
      <label class="opt full"><input type="checkbox" name="focus" ${p?.focus_allowed ? "checked" : ""}><span><b>Allow Focus mode</b><span class="muted">The facilitator can turn it on during a session: phones are asked to stay on Training Suite, and leaving is logged.</span></span></label>
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
          <span style="min-width:0"><b>${esc(p.name)}</b><span class="meta">${esc([p.code, p.dates].filter(Boolean).join(" · ") || "No code or dates yet")}${p.certificates ? " · Certificates" : ""}${p.roster_only ? " · Registered list only" : ""}${p.focus_allowed ? " · Focus mode" : ""}</span></span>${p.completed_at ? `<span class="badge done">Completed</span>` : ""}
          <span class="meta meta2">${ss.length} session${ss.length === 1 ? "" : "s"}</span><span class="sign">${open ? "HIDE −" : "SESSIONS +"}</span></button>
        ${open ? `<div class="inside">${ss.map(s => { const [t, c] = statusOf(s); return `<a class="srow" href="#/session/${s.id}"><span><b>${esc(s.topic)}</b><small>${esc(fmtDate(s.session_date))}${s.start_time ? " · " + esc(s.start_time) : ""}</small></span><span class="badge ${c}">${t}</span><span class="ok">Open →</span></a>`; }).join("") || `<p class="muted" style="padding:6px 0 12px">No sessions in this programme yet.</p>`}
          <div class="row" style="margin-top:10px"><a class="btn ghost small" href="#/new?p=${p.id}">+ Add a session</a><a class="btn ghost small" href="#/people/${p.id}">Participants</a><a class="btn ghost small" href="#/programmes?edit=${p.id}">Edit programme</a><button class="btn ghost small" type="button" data-again="${p.id}">↻ Run again for a new group</button><a class="btn ghost small" href="#/report/p/${p.id}">Programme report</a><button class="btn danger small" type="button" data-del="${p.id}">Delete</button></div>
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
        const was = editing && progs.find(p => p.id === editing)?.focus_allowed; if (f.focus.checked || was) row.focus_allowed = f.focus.checked;
        const old = editing ? progs.find(p => p.id === editing) : null;
        ["background", "rationale", "objectives"].forEach(k => { const v = f[k].value.trim(); if (v || (old && old[k])) row[k] = v; });
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
    $("view").querySelectorAll("[data-again]").forEach(b => b.addEventListener("click", () => runAgain(b.dataset.again)));
  }
  // Run a programme again: everything except the people. The earlier run stays as it was.
  function runAgain(id) {
    const p = progs.find(x => x.id === id), box = document.querySelector(`[data-delbox="${id}"]`), ss = sessions.filter(s => s.programme_id === id);
    const first = ss.map(s => s.session_date).filter(Boolean).sort()[0];
    box.innerHTML = `<form class="confirm" style="margin-top:12px;border-color:var(--line-2)" novalidate><b>Run “${esc(p.name)}” again for a new group</b>
      <span class="small muted">Copies its ${ss.length} session${ss.length === 1 ? "" : "s"} with slides, files, questions, flow, evaluation, groups plan and certificate design. No participants, attendance, answers or certificates are copied, and this run stays exactly as it is.</span>
      <div class="grid2"><label class="fld full">Name of the new run<input name="n" value="${esc(p.name)} (new group)"></label>
        <label class="fld">Programme code<input name="c" value="${esc(p.code)}"></label><label class="fld">Dates<input name="d" placeholder="e.g. 10 to 14 November 2026"></label>
        <label class="fld">First session date<span class="hint">${first ? "Later sessions keep the same gaps between them. Leave empty to set dates yourself." : "Optional."}</span><input type="date" name="s"></label></div>
      <div class="row"><button class="btn red small" type="submit">Create the new run</button><button class="btn ghost small" type="button" data-x>Cancel</button><span class="err"></span></div></form>`;
    const f = box.firstElementChild; f.n.focus(); f.n.select();
    f.querySelector("[data-x]").onclick = () => (box.innerHTML = "");
    f.addEventListener("submit", async e => {
      e.preventDefault(); const er = f.querySelector(".err"); er.className = "upmsg"; er.textContent = "Copying…";
      const { data, error } = await sb.rpc("copy_programme", { p_programme: id, p_name: f.n.value.trim(), p_code: f.c.value.trim(), p_dates: f.d.value.trim(), p_start: f.s.value || null });
      if (error) { er.className = "err"; er.textContent = /function|schema cache/i.test(error.message || "") ? "Run supabase/schema-13-step7.sql in Supabase first." : errText(error, "Couldn't copy the programme."); return; }
      await loadData(); openProg[data] = true; openProg[id] = false;
      toast("New run created. Its sessions are ready, each with a new check-in code."); viewProgrammes();
    });
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
  // Order: session → slides and resources → activities → evaluation → certificate → flow → attendance.
  // Everything is kept as you type (in this browser) and, once the session has a programme and topic, saved as a draft.
  const STEPS = [["Session", "Session details"], ["Slides", "Slides and resources"], ["Activities", "How will you engage and check learning?"], ["Evaluation", "Session evaluation"], ["Certificate", "Certificate"], ["Flow", "Your session flow"], ["Attendance", "Attendance and check-in"]];
  const LAST = STEPS.length - 1;
  let W = null, wizTimer = null, wizSrvTimer = null;
  const wizKey = k => "ts_wiz_" + k;
  function wizSaveLocal() {
    if (!W) return;
    try { localStorage.setItem(wizKey(W.key), JSON.stringify({ ...W, tools: [...W.tools], savedAt: Date.now() })); } catch {}
  }
  function wizForget(key) { try { localStorage.removeItem(wizKey(key)); } catch {} }
  function viewWizard(editId) {
    const src = editId ? sessions.find(s => s.id === editId) : null;
    if (editId && !src) { V(`<p class="muted">Session not found.</p>`); return; }
    const key = editId || "new:" + (query().get("p") || "");
    if (!W || W.key !== key) {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(wizKey(key)) || "null"); } catch {}
      if (saved && (!editId || saved.id === editId)) { W = { ...saved, tools: new Set(saved.tools || []), restored: true }; }
      else W = { key, at: 0, id: src ? src.id : crypto.randomUUID(), existing: !!src, draft: src?.status === "draft",
        programme_id: src?.programme_id || query().get("p") || progs[0]?.id || "", topic: src?.topic || "", session_date: src?.session_date || "", start_time: src?.start_time || "",
        venue: src?.venue || "", course_lead: src?.course_lead || profile.full_name || "", objectives: src?.objectives || "", main_topic: src?.main_topic || "", key_skill: src?.key_skill || "",
        pre_test: src ? src.pre_test : true, post_test: src ? src.post_test : true, tools: new Set((src?.tools || ["quiz", "exit"]).filter(t => t !== "wheel" && t !== "throw")),
        flow: src?.flow || [], evaluation: src?.evaluation || { mode: "default", anonymous: true, at_tapout: true }, files: src?.files || [], slide_count: src?.slide_count || 0,
        attendance_code: src?.attendance_code || "", groups: src ? src.groups : undefined, background: src?.background || "", rationale: src?.rationale || "", hadBg: !!(src?.background || src?.rationale) };
      W.at = Math.min(W.at || 0, LAST);
    }
    drawWizard();
  }
  function wizardField(name) { const el = $("view").querySelector(`[name="${name}"]`); return el ? el.value.trim() : W[name]; }
  function grabStep() {
    const v = $("view");
    if (W.at === 0) {
      ["programme_id", "topic", "session_date", "start_time", "venue", "course_lead", "objectives", "main_topic", "key_skill", "background", "rationale"].forEach(k => (W[k] = wizardField(k)));
      const on = v.querySelector("[name=g_on]");
      if (on) W.groups = on.value ? { ...(W.groups || {}), n: Math.max(2, Math.min(12, +v.querySelector("[name=g_n]").value || 4)), method: v.querySelector("[name=g_m]").value, names: W.groups?.names || [] } : null;
    }
    if (W.at === 2) { const a = v.querySelector("[name=pre_test]"), b = v.querySelector("[name=post_test]"); if (a) W.pre_test = a.checked; if (b) W.post_test = b.checked; }
    if (W.at === 3) { const m = v.querySelector("[name=evmode]:checked"); if (m) W.evaluation = { mode: m.value, anonymous: v.querySelector("[name=anon]").checked, at_tapout: v.querySelector("[name=tapout]").checked }; }
  }
  function checkStep(i) {
    if (i === 0) {
      if (!W.programme_id) return "Pick a programme, or create one first.";
      if (String(W.topic || "").length < 2) return "Type the session topic.";
    }
    return "";
  }
  function syncFlow() {
    const placeable = [...W.tools].filter(PLACEABLE);
    W.flow = W.flow.filter(f => placeable.includes(f.tool));
    const sc = W.slide_count || 0;
    placeable.forEach((t, i) => { if (!W.flow.some(f => f.tool === t)) W.flow.push({ tool: t, after: sc ? Math.round(sc * (i + 1) / (placeable.length + 1)) : 0 }); });
    W.flow.forEach(f => { if (sc && f.after > sc) f.after = sc; });
    W.flow.sort((a, b) => a.after - b.after);
  }
  const wizRow = () => ({ id: W.id, programme_id: W.programme_id, topic: W.topic, session_date: W.session_date || null, start_time: W.start_time, venue: W.venue, course_lead: W.course_lead,
    objectives: W.objectives, main_topic: W.main_topic, key_skill: W.key_skill, pre_test: W.pre_test, post_test: W.post_test, tools: [...W.tools],
    flow: W.flow, evaluation: W.evaluation, files: W.files, slide_count: W.slide_count, ...(W.groups !== undefined ? { groups: W.groups } : {}), ...((W.background || W.rationale || W.hadBg) ? { background: W.background || "", rationale: W.rationale || "" } : {}) });
  function wizStatus(t, ok) { const el = $("wSaved"); if (el) { el.textContent = t; el.classList.toggle("ok", !!ok); } }
  // Save to the server as a draft: new sessions as soon as they have a programme and topic; drafts on every change.
  async function wizSaveServer() {
    if (!W || checkStep(0)) return;
    if (W.existing && !W.draft) { wizStatus("Not saved yet · press Save changes to update the session", false); return; }
    syncFlow(); wizStatus("Saving…");
    const row = { ...wizRow(), status: "draft" };
    const res = W.existing ? await sb.from("sessions").update(row).eq("id", W.id).select().single() : await sb.from("sessions").insert(row).select().single();
    if (res.error) { wizStatus("Not saved yet: " + errText(res.error, "check the connection")); return; }
    sessions = [...sessions.filter(x => x.id !== res.data.id), res.data].sort((a, b) => (a.session_date || "9999").localeCompare(b.session_date || "9999"));
    W.attendance_code = res.data.attendance_code;
    if (!W.existing) {
      const old = W.key; W.existing = true; W.draft = true; W.key = W.id; wizForget(old); wizSaveLocal();
      history.replaceState(null, "", "#/edit/" + W.id);
    }
    wizStatus("Draft saved ✓ " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), true);
  }
  function wizChanged() {
    if (W && W.existing && !W.draft && !W.dirty) { W.dirty = true; const b = $("wSaveTop"); if (b) b.disabled = false; wizStatus("Changes not saved yet · press Save changes", false); }
    clearTimeout(wizTimer); clearTimeout(wizSrvTimer);
    wizTimer = setTimeout(() => { if (!W || !$("wSaved")) return; grabStep(); wizSaveLocal(); }, 300);
    wizSrvTimer = setTimeout(() => { if (W && $("wSaved")) wizSaveServer(); }, 2500);
  }

  // slide thumbnails (pdf.js), cached per file path
  const PDFS = {}, THUMBS = {};
  async function ensurePdfjs() {
    if (!window.pdfjsLib) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "vendor/pdf.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }
  async function pdfDoc(path, file) {
    if (PDFS[path]) return PDFS[path];
    await ensurePdfjs();
    if (file) return (PDFS[path] = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise);
    const { data, error } = await sb.storage.from("session-files").createSignedUrl(path, 3600);
    if (error) throw error;
    return (PDFS[path] = await window.pdfjsLib.getDocument(data.signedUrl).promise);
  }
  // Fill every <img data-th="n" data-path="…"> under root with that slide's picture.
  async function fillThumbs(root) {
    const imgs = [...root.querySelectorAll("img[data-th]")]; if (!imgs.length) return;
    const path = imgs[0].dataset.path; let doc;
    try { doc = await pdfDoc(path); } catch { return; }
    THUMBS[path] = THUMBS[path] || {};
    for (const im of imgs) {
      const n = +im.dataset.th;
      if (!THUMBS[path][n]) {
        try {
          const pg = await doc.getPage(n), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 240 / v1.width });
          const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: g, viewport: vp }).promise;
          THUMBS[path][n] = c.toDataURL("image/jpeg", 0.8);
        } catch { continue; }
      }
      if (im.isConnected) { im.src = THUMBS[path][n]; im.classList.add("in"); }
    }
  }
  const thumbStrip = (path, count) => `<div class="thumbs">${Array.from({ length: count }, (_, k) => `<figure><img data-th="${k + 1}" data-path="${esc(path)}" alt="Slide ${k + 1}"><figcaption>${k + 1}</figcaption></figure>`).join("")}</div>`;
  const linkKind = u => /youtu\.?be/i.test(u) ? "YouTube" : /\.(pdf|docx?|pptx?|xlsx?)(\?|$)/i.test(u) ? "Document" : "Link";

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
        <label class="fld full">Background <span class="hint" style="display:inline">(optional, for the session report)</span><span class="hint">The context: who asked for this training, the situation it responds to.</span><textarea name="background" rows="3">${esc(W.background || "")}</textarea></label>
        <label class="fld full">Rationale <span class="hint" style="display:inline">(optional, for the session report)</span><span class="hint">Why this session matters now and what it should change at work.</span><textarea name="rationale" rows="3">${esc(W.rationale || "")}</textarea></label>
        <label class="fld full">Learning objectives<span class="hint">One per line. By the end of the session, participants will be able to…</span><textarea name="objectives" rows="4">${esc(W.objectives)}</textarea></label>
        <label class="fld">Main topic, for the evaluation<span class="hint">“My knowledge of …”</span><input name="main_topic" value="${esc(W.main_topic)}" placeholder="e.g. using AI for routine office tasks"></label>
        <label class="fld">Key skill, for the evaluation<span class="hint">“I can now …”</span><input name="key_skill" value="${esc(W.key_skill)}" placeholder="e.g. write a clear prompt that gets a usable draft"></label>
        <fieldset class="ced-sig full"><legend>Groups</legend>
          <div class="grid2"><label class="fld">Will you use groups?<select name="g_on"><option value="">No, or I'll decide in the session</option><option value="1" ${W.groups ? "selected" : ""}>Yes</option></select></label>
          <label class="fld">How many groups<input type="number" name="g_n" min="2" max="12" value="${W.groups?.n || 4}"></label>
          <label class="fld full">How to place people<select name="g_m">${TSGR.METHODS.map(([v, t, l]) => `<option value="${v}" ${(W.groups?.method || "random") === v ? "selected" : ""}>${t}: ${l}</option>`).join("")}</select></label></div>
          <span class="small muted">People are placed as they check in, keeping the rule. You can reshuffle, move people or change the groups from the 👥 Groups button on the live screen.</span></fieldset></div>`
        : `<div class="empty"><div><h2>Create a programme first</h2><p class="muted">Every session belongs to a programme, such as a course or a workshop series.</p><a class="btn" style="align-self:flex-start" href="#/programmes?new=1&back=new">+ New programme</a></div></div>`;
    } else if (at === 1) {
      const slides = W.files.find(f => f.kind === "slides"), share = W.files.filter(f => f.kind === "share"), links = W.files.filter(f => f.kind === "link");
      body = `<section class="wsec"><div class="d-head"><h3>Slides</h3>${slides ? `<span class="small muted">${esc(slides.name)} · ${W.slide_count || "?"} slides</span>` : ""}</div>
          <label class="drop" for="slideIn"><b style="font-family:var(--display);font-size:18px">${slides ? "Replace your slides" : "Choose your slides"}</b><span class="muted small">PDF, up to 50 MB. In PowerPoint use File → Save As → PDF.</span></label>
          <input type="file" id="slideIn" accept="application/pdf,.pdf" hidden>
          <span class="upmsg" id="upMsg" role="status"></span>
          ${slides ? `${W.slide_count ? thumbStrip(slides.path, W.slide_count) : ""}<div class="row"><button type="button" class="btn ghost small" data-rm="${esc(slides.path)}">Remove slides</button></div>` : ""}</section>
        <section class="wsec"><div class="d-head"><h3>Files to share</h3><label class="btn ghost small" for="shareIn">+ Add files</label></div>
          <span class="small muted">Handouts, templates, readings. During the session, tap Share file to send them to phones.</span>
          <input type="file" id="shareIn" multiple hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,image/*">
          <span class="upmsg" id="upMsg2" role="status"></span>
          ${share.map(f => `<div class="filerow"><span>📄 ${esc(f.name)}</span><button type="button" data-rm="${esc(f.path)}">Remove</button></div>`).join("")}</section>
        <section class="wsec"><div class="d-head"><h3>Links</h3></div>
          <span class="small muted">YouTube videos, articles, websites. Share them to phones during the session.</span>
          <form class="row" id="linkForm" novalidate><input class="in" name="url" placeholder="Paste a link, e.g. https://youtu.be/…" style="flex:2 1 260px" aria-label="Link"><input class="in" name="title" placeholder="Title (optional)" style="flex:1 1 180px" aria-label="Link title"><button class="btn small" type="submit">Add link</button></form>
          <span class="err" id="linkErr" role="alert"></span>
          ${links.map(f => `<div class="filerow"><span>${f.sub === "YouTube" ? "▶" : "🔗"} ${esc(f.name)} <small class="muted">${esc(f.sub || "")}</small></span><button type="button" data-rmlink="${esc(f.url)}">Remove</button></div>`).join("")}</section>`;
    } else if (at === 2) {
      const grid = list => `<div class="toolgrid">${list.filter(([id]) => id !== "throw" && id !== "wheel").map(([id, name, line, color]) => { const on = W.tools.has(id); return `<button type="button" class="toolc" data-tool="${id}" aria-pressed="${on}"><span class="top"><span class="sq" style="background:${color}"></span><span class="mk">${on ? "ADDED ✓" : "+ ADD"}</span></span><b>${esc(name)}</b><span>${esc(line)}</span></button>`; }).join("")}</div>`;
      body = `<div class="note">Always on the live screen, no need to add: <b>🎯 Spin the wheel</b>, <b>✊ Throw a slide</b> and <b>Share file</b>.</div>
        <section class="wsec"><h3>Engage the room</h3>${grid(ENG)}</section>
        <section class="wsec"><h3>Check learning</h3>
          <div class="grid2"><label class="opt"><input type="checkbox" name="pre_test" ${W.pre_test ? "checked" : ""}><span><b>Pre-test at the start</b><span class="muted">Right after check-in. Answers stay hidden.</span></span></label>
          <label class="opt"><input type="checkbox" name="post_test" ${W.post_test ? "checked" : ""}><span><b>Post-test at the end</b><span class="muted">Same questions. Each person sees their learning achievement.</span></span></label></div>
          ${grid(ASS)}<p class="small muted">You write the questions on the session's Assessments tab, yourself or drafted by AI.</p></section>`;
    } else if (at === 3) {
      const ev = W.evaluation;
      body = `<div style="display:flex;flex-direction:column;gap:12px;max-width:760px">
        <label class="opt"><input type="radio" name="evmode" value="default" ${ev.mode !== "none" ? "checked" : ""}><span><b>Default evaluation</b><span class="muted">Reaction and learning (Kirkpatrick levels 1 and 2), 17 items, about 2 minutes, filled with your topic and key skill.</span></span></label>
        <label class="opt"><input type="radio" name="evmode" value="none" ${ev.mode === "none" ? "checked" : ""}><span><b>No evaluation for this session</b></span></label>
        <label class="opt"><input type="checkbox" name="anon" ${ev.anonymous ? "checked" : ""}><span><b>Anonymous to the course lead</b><span class="muted">You see completion counts and results, not who said what.</span></span></label>
        <label class="opt"><input type="checkbox" name="tapout" ${ev.at_tapout ? "checked" : ""}><span><b>Ask at tap-out</b><span class="muted">Anyone tapping out who hasn't filled it is asked first.</span></span></label>
        <p class="small muted">The evaluation always comes at the end of the session. Editing the questions and your own forms come with the evaluation update.</p></div>`;
    } else if (at === 4) {
      const last = isLastInProgramme({ id: W.id, programme_id: W.programme_id, session_date: W.session_date });
      body = p ? `<div style="display:flex;flex-direction:column;gap:14px">
        <div class="note" style="max-width:900px">Certificates are <b>optional</b> and belong to the <b>programme</b> (one session or many): they're issued at the end of its last session. Set the design and rules once for “${esc(p.name)}”.</div>
        <label class="opt" style="max-width:900px"><input type="checkbox" id="certOn" ${p.certificates ? "checked" : ""}><span><b>Issue certificates for “${esc(p.name)}”</b><span class="muted">${p.certificates ? (last ? "They'll be issued at the end of this session (the programme's last, by date)." : "They'll be issued at the end of the programme's last session, not this one.") : "Tick to turn certificates on for the whole programme."}</span></span></label>
        ${p.certificates ? `<div id="certEd"></div>` : ""}</div>`
        : `<p class="muted">Pick a programme on the first step.</p>`;
    } else if (at === 5) {
      syncFlow();
      const sc = W.slide_count, slides = W.files.find(f => f.kind === "slides");
      const placed = n => W.flow.filter(f => f.after === n);
      const chip = f => `<button type="button" class="fchip${W.arm === f.tool ? " arm" : ""}" data-arm="${f.tool}" style="--c:${TOOL[f.tool].color}" title="Click, then click a gap to move it">${esc(TOOL[f.tool].name)}</button>`;
      const gap = n => `<div class="gap${W.arm ? " can" : ""}" data-gap="${n}" role="button" tabindex="${W.arm ? 0 : -1}" aria-label="${n ? "After slide " + n : "Before the first slide"}">${placed(n).map(chip).join("") || `<span class="plus">+</span>`}</div>`;
      const endItems = [];
      if (W.tools.has("exit")) endItems.push(["Exit ticket", "#D2391F"]);
      if (W.post_test) endItems.push(["Post-test", "#D2391F"]);
      if (W.evaluation.mode !== "none") endItems.push(["Evaluation", "#14161C"]);
      if (p?.certificates) endItems.push(["Certificates", "#F4B400"]);
      const fixed = (n, c) => `<span class="fchip fixed" style="--c:${c}">${esc(n)}</span>`;
      body = W.flow.length || endItems.length ? `<p class="muted" style="max-width:76ch">${W.arm ? `Now click the gap where <b>${esc(TOOL[W.arm].name)}</b> should go.` : "Click an activity, then click the gap between two slides where it should run."} Evaluation and certificates always come at the end.</p>
        <div class="fstart">${fixed("Check-in and welcome", "#D2391F")}${W.pre_test ? fixed("Pre-test", "#D2391F") : ""}</div>
        ${sc && slides ? `<div class="carousel" id="carousel">${gap(0)}${Array.from({ length: sc }, (_, k) => `<figure class="cs"><img data-th="${k + 1}" data-path="${esc(slides.path)}" alt="Slide ${k + 1}"><figcaption>${k + 1}</figcaption></figure>${gap(k + 1)}`).join("")}</div>`
          : `<div class="note warn">No slides yet. <a href="#" data-goto="1">Upload your slides</a> to place activities between them. For now they all run at the start of training.</div><div class="fstart">${W.flow.map(chip).join("")}</div>`}
        <div class="fstart"><span class="lbl">At the end</span>${endItems.map(([n, c]) => fixed(n, c)).join("") || `<span class="small muted">Nothing fixed at the end.</span>`}</div>`
        : `<div class="empty"><div><h2>No activities picked</h2><p class="muted">Go back to <a href="#" data-goto="2">Activities</a> to add some, or carry on: Spin the wheel and Share file are always there.</p></div></div>`;
    } else if (at === 6) {
      const code = W.attendance_code;
      const warn = [];
      if (!W.files.some(f => f.kind === "slides")) warn.push(["No slides uploaded", "You can add them later.", true]);
      if (W.pre_test || W.post_test || [...W.tools].some(t => SLOTS.includes(t))) warn.push(["Questions to write", "On the session's Assessments tab after you save, yourself or with AI.", true]);
      if (W.evaluation.mode !== "none") warn.push(["Evaluation ready", "Default form, with your topic and key skill.", false]);
      body = `<div class="row" style="align-items:stretch;gap:24px">
        <div class="wsec" style="flex:1 1 380px;flex-direction:row;align-items:center;gap:20px;flex-wrap:wrap">
          ${code ? `<div class="qr">${qrSvg(checkinLink(code))}</div><div style="display:flex;flex-direction:column;gap:8px;min-width:0"><span class="lbl">Check-in code</span><span class="code">${esc(code)}</span><span class="small" style="word-break:break-all;font-family:var(--mono)">${esc(checkinLink(code))}</span></div>`
          : `<div style="display:flex;flex-direction:column;gap:8px"><span class="lbl">Check-in</span><b style="font-family:var(--display);font-size:20px">Your check-in code and QR code appear as soon as the session is saved.</b></div>`}</div>
        <div style="flex:1 1 320px;display:flex;flex-direction:column;gap:10px">
          <div class="note"><b>${p?.roster_only ? "Only people on the programme's list can check in." : "Anyone with the code can check in."}</b><br><a href="#/people/${esc(W.programme_id)}">Programme participants →</a></div>
          ${warn.map(([t, l, w]) => `<div class="note${w ? " warn" : ""}"><b style="display:block">${esc(t)}</b><span class="small muted">${esc(l)}</span></div>`).join("")}</div></div>`;
    }
    V(`<div class="pagehead"><div><span class="lbl">${W.existing ? (W.draft ? "Draft session" : "Edit session") : "New session"}</span><h1>${esc(STEPS[at][1])}</h1><span class="wsaved" id="wSaved">${W.restored ? "Picked up where you left off" : ""}</span></div>
        <div class="row" id="wHeadBtns">${W.restored ? `<button class="btn ghost small" type="button" id="wFresh">${W.existing && !W.draft ? "Discard unsaved changes" : "Start over"}</button>` : ""}${W.existing && !W.draft ? `<button class="btn red small" type="button" id="wSaveTop" ${W.dirty ? "" : "disabled"}>Save changes</button>` : ""}<button class="btn ghost small" type="button" id="wClose">Close</button></div></div>
      <ol class="wsteps" style="--n:${STEPS.length}" aria-label="Steps">${STEPS.map(([n], i) => `<li><button type="button" data-step="${i}" class="${i < at ? "done" : i === at ? "now" : ""}" ${i === at ? 'aria-current="step"' : ""}><span class="n">0${i + 1}</span><span>${n}</span></button></li>`).join("")}</ol>
      ${body}
      <div class="err" id="wErr" role="alert"></div>
      <div class="wfoot"><button class="btn ghost" type="button" id="wBack" ${at === 0 ? 'style="visibility:hidden"' : ""}>← Back</button>
        <div class="row">${at === LAST ? `${!W.existing || W.draft ? `<button class="btn ghost" type="button" id="wDraft">Keep as draft</button>` : ""}<button class="btn red" type="button" id="wSave">${W.existing && !W.draft ? "Save session" : "Create session"}</button>` : `${W.existing && !W.draft ? `<button class="btn ghost" type="button" id="wSaveMid">Save changes</button>` : ""}<button class="btn" type="button" id="wNext">Next: ${STEPS[at + 1][0]} →</button>`}</div></div>`);
    if (W.restored && W.existing && !W.draft) W.dirty = true;
    W.restored = false;
    wireWizard();
    $("wSaveTop")?.addEventListener("click", () => saveWizard(false));
    $("wSaveMid")?.addEventListener("click", () => saveWizard(false));
    $("wClose").addEventListener("click", () => {
      const back = W.existing ? "#/session/" + W.id : "#/sessions";
      if (!(W.existing && !W.draft && W.dirty)) { location.hash = back; return; }
      $("wHeadBtns").innerHTML = `<span class="small" style="font-weight:700">You have changes that aren't saved.</span><button class="btn red small" type="button" id="wCloseSave">Save and close</button><button class="btn ghost small" type="button" id="wCloseKeep">Close without saving</button>`;
      $("wCloseSave").onclick = () => saveWizard(false);
      $("wCloseKeep").onclick = () => { location.hash = back; };
    });
    fillThumbs($("view"));
  }
  function go(i) {
    grabStep();
    if (i > W.at) for (let k = W.at; k < i; k++) { const m = checkStep(k); if (m) { W.at = k; drawWizard(); $("wErr").textContent = m; return; } }
    W.at = Math.max(0, Math.min(LAST, i)); W.arm = null; wizSaveLocal(); drawWizard(); scrollTo({ top: 0 });
    wizSaveServer();
  }
  function wireWizard() {
    const v = $("view");
    v.querySelectorAll("[data-step]").forEach(b => b.addEventListener("click", () => go(+b.dataset.step)));
    v.querySelectorAll("[data-goto]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); go(+a.dataset.goto); }));
    $("wBack").addEventListener("click", () => go(W.at - 1));
    $("wNext")?.addEventListener("click", () => go(W.at + 1));
    $("wSave")?.addEventListener("click", () => saveWizard(false));
    $("wDraft")?.addEventListener("click", () => saveWizard(true));
    $("wFresh")?.addEventListener("click", () => { const id = W.existing ? W.id : null; wizForget(W.key); W = null; if (id) viewWizard(id); else { location.hash = "#/new"; viewWizard(null); } });
    v.querySelectorAll("input,select,textarea").forEach(el => el.addEventListener("input", wizChanged));
    v.querySelectorAll("input[type=checkbox],input[type=radio],select").forEach(el => el.addEventListener("change", wizChanged));
    v.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => { grabStep(); const t = b.dataset.tool; W.tools.has(t) ? W.tools.delete(t) : W.tools.add(t); wizSaveLocal(); drawWizard(); wizChanged(); }));
    $("certOn")?.addEventListener("change", async e => {
      const { data, error } = await sb.from("programmes").update({ certificates: e.target.checked }).eq("id", W.programme_id).select().single();
      if (error) { toast(errText(error, "Couldn't change the programme.")); e.target.checked = !e.target.checked; return; }
      progs = progs.map(p => p.id === data.id ? data : p); drawWizard();
    });
    if ($("certEd")) TSCU.editor($("certEd"), { sb, profile, toast, programme: progs.find(x => x.id === W.programme_id), sessions, save: saveProgramme(W.programme_id) });
    $("slideIn")?.addEventListener("change", e => upload(e.target.files, "slides"));
    $("shareIn")?.addEventListener("change", e => upload(e.target.files, "share"));
    $("linkForm")?.addEventListener("submit", e => {
      e.preventDefault(); const f = e.target; let url = f.url.value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
      try { new URL(url); } catch { $("linkErr").textContent = "Paste a full web address."; return; }
      const sub = linkKind(url);
      W.files.push({ kind: "link", url, sub, name: f.title.value.trim() || (sub === "YouTube" ? "YouTube video" : new URL(url).hostname.replace(/^www\./, "")) });
      wizSaveLocal(); drawWizard(); wizChanged();
    });
    v.querySelectorAll("[data-rmlink]").forEach(b => b.addEventListener("click", () => { W.files = W.files.filter(x => !(x.kind === "link" && x.url === b.dataset.rmlink)); wizSaveLocal(); drawWizard(); wizChanged(); }));
    v.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", async () => {
      await sb.storage.from("session-files").remove([b.dataset.rm]);
      const f = W.files.find(x => x.path === b.dataset.rm);
      W.files = W.files.filter(x => x.path !== b.dataset.rm); if (f?.kind === "slides") W.slide_count = 0;
      wizSaveLocal(); drawWizard(); wizChanged();
    }));
    // flow carousel: pick an activity, then a gap
    v.querySelectorAll("[data-arm]").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      const g = b.closest("[data-gap]");
      if (W.arm && W.arm !== b.dataset.arm && g) { g.click(); return; }   // armed: clicking another activity drops it in that gap
      W.arm = W.arm === b.dataset.arm ? null : b.dataset.arm; drawWizard();
    }));
    v.querySelectorAll("[data-gap]").forEach(g => g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); g.click(); } }));
    v.querySelectorAll("[data-gap]").forEach(g => g.addEventListener("click", () => {
      if (!W.arm) return; const f = W.flow.find(x => x.tool === W.arm); if (f) f.after = +g.dataset.gap;
      W.arm = null; W.flow.sort((a, b) => a.after - b.after); wizSaveLocal(); drawWizard(); wizChanged();
    }));
  }
  async function pdfPages(file, path) {
    try { const doc = await pdfDoc(path, file); return doc.numPages; } catch { return 0; }
  }
  async function upload(list, kind) {
    const files = [...(list || [])]; if (!files.length) return;
    const msg = $(kind === "slides" ? "upMsg" : "upMsg2") || { set textContent(t) { toast(t); }, set className(c) {} };
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) { msg.className = "err"; msg.textContent = `${file.name} is over 50 MB.`; continue; }
      msg.className = "upmsg busy"; msg.textContent = `Uploading ${file.name}…`;
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${profile.id}/${W.id}/${kind}-${Date.now()}-${safe}`;
      const { error } = await sb.storage.from("session-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) { msg.className = "err"; msg.textContent = errText(error, `Couldn't upload ${file.name}.`); continue; }
      if (kind === "slides") {
        const old = W.files.filter(f => f.kind === "slides");
        if (old.length) await sb.storage.from("session-files").remove(old.map(f => f.path));
        W.files = W.files.filter(f => f.kind !== "slides");
        W.slide_count = await pdfPages(file, path);
      }
      W.files.push({ kind, name: file.name, path, size: file.size, type: file.type });
      msg.className = "upmsg"; msg.textContent = `Uploaded ${file.name} ✓`;
    }
    wizSaveLocal(); drawWizard(); wizSaveServer();
  }
  async function saveWizard(asDraft) {
    grabStep();
    for (let k = 0; k <= LAST; k++) { const m = checkStep(k); if (m) { W.at = k; drawWizard(); $("wErr").textContent = m; return; } }
    syncFlow();
    const row = wizRow();
    if (asDraft) row.status = "draft"; else if (!W.existing || W.draft) row.status = "ready";
    const e = $("wErr"); e.className = "upmsg"; e.textContent = "Saving…";
    const res = W.existing ? await sb.from("sessions").update(row).eq("id", W.id).select().single() : await sb.from("sessions").insert(row).select().single();
    if (res.error) { e.className = "err"; e.textContent = errText(res.error, "Couldn't save the session."); return; }
    sessions = [...sessions.filter(s => s.id !== res.data.id), res.data].sort((a, b) => (a.session_date || "9999").localeCompare(b.session_date || "9999"));
    wizForget(W.key); W = null;
    toast(asDraft ? "Kept as a draft. Find it under My sessions → Drafts." : "Session saved");
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
    (s.flow || []).forEach(f => TOOL[f.tool] && PLACEABLE(f.tool) && out.push([TOOL[f.tool].name, f.after ? `After slide ${f.after}` : "At the start of training"]));
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
    const T = [["run", "Run sheet"], ["details", "Details"], ["attendance", "Attendance"], ["particip", "Participation"], ["assess", "Assessments"], ["learning", "Learning"], ["evaluation", "Evaluation"], ["certs", "Certificates"], ["report", "Report"]];
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
        <div style="display:flex;flex-direction:column;gap:12px"><span class="lbl">Files</span>${(s.files || []).map(f => f.kind === "link" ? `<div class="filerow"><span>${f.sub === "YouTube" ? "▶" : "🔗"} ${esc(f.name)}</span><a href="${esc(f.url)}" target="_blank" rel="noopener">Open</a></div>` : `<div class="filerow"><span>${f.kind === "slides" ? `Slides · ${s.slide_count || "?"} slides · ` : "📄 "}${esc(f.name)}</span><button type="button" style="color:var(--blue)" data-open="${esc(f.path)}">Open</button></div>`).join("") || `<p class="muted">No files yet.</p>`}
          ${(s.files || []).find(f => f.kind === "slides") && s.slide_count ? thumbStrip(s.files.find(f => f.kind === "slides").path, s.slide_count) : ""}</div></div>
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
    } else if (sessTab === "particip") {
      body = `<div id="partBox"><p class="muted">Loading…</p></div>`;
    } else if (sessTab === "evaluation") {
      body = `<div id="evBox"><p class="muted">Loading…</p></div>`;
    } else if (sessTab === "certs") {
      body = `<div id="certBox"><p class="muted">Loading…</p></div>`;
    } else if (sessTab === "report") {
      body = `<div class="row no-print" style="justify-content:space-between"><p class="muted" style="margin:0">A one-page summary for your records or your director.</p><a class="btn red small" href="#/report/s/${s.id}">Open to print or save as PDF</a></div><div id="repBox"><p class="muted">Preparing the report…</p></div>`;
    } else {
      const M = { report: "A one-page summary of the session for your records or your director." };
      body = `<div class="empty"><div><h2>${esc(T.find(t => t[0] === sessTab)[1])}</h2><p class="muted">${esc(M[sessTab])} This fills in once the session has run, in the next phases.</p></div></div>`;
    }
    let pending = null; try { pending = s.status !== "draft" && JSON.parse(localStorage.getItem(wizKey(s.id)) || "null"); } catch {}
    const unsaved = pending && pending.dirty ? `<div class="note warn" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span><b>You have changes to this session that aren't saved yet</b> (activities, flow or details). The live screen uses the saved version.</span><a class="btn red small" href="#/edit/${s.id}">Open and save</a><button class="btn ghost small" type="button" id="dropPending">Discard them</button></div>` : "";
    V(`${unsaved}<div class="pagehead"><div><span class="lbl">${esc(p.name || "")}</span><h1>${esc(s.topic)}</h1><span class="muted">${esc([s.course_lead && "Course lead: " + s.course_lead, fmtDate(s.session_date), s.start_time, s.venue].filter(Boolean).join(" · "))}</span></div>
        <div class="row"><span class="badge ${sc}" style="padding:10px 14px">${st}</span><a class="btn ghost small" href="#/edit/${s.id}">Edit</a>
        ${s.status === "completed" ? `<button class="btn ghost small" type="button" id="reopenRun">Reopen session</button>` : s.status === "live" ? `<a class="btn red" href="#/present/${s.id}">▶ Back to live screen</a><button class="btn ghost small" type="button" id="endRun">End session</button>` : `<button class="btn red" type="button" id="startRun">▶ Start session</button>`}</div></div>
      <div class="tabbar" role="tablist" aria-label="Session">${T.map(([k, n]) => `<button type="button" role="tab" aria-selected="${sessTab === k}" data-stab="${k}">${n}</button>`).join("")}</div>${body}`);
    const v = $("view");
    v.querySelectorAll("[data-stab]").forEach(b => b.addEventListener("click", () => { sessTab = b.dataset.stab; viewSession(id); }));
    const save = async patch => { const { data, error } = await sb.from("sessions").update(patch).eq("id", id).select().single(); if (error) return toast(errText(error, "Couldn't update.")); sessions = sessions.map(x => x.id === id ? data : x); viewSession(id); };
    $("startRun")?.addEventListener("click", async () => { await save({ status: "live", progress: 0 }); location.hash = "#/present/" + id; });
    $("dropPending")?.addEventListener("click", () => { wizForget(id); if (W && W.key === id) W = null; viewSession(id); });
    if (sessTab === "attendance") loadRegister(s);
    if (sessTab === "assess") drawActs(s);
    if (sessTab === "learning") drawLearning(s);
    if (sessTab === "particip") drawParticipation(s);
    if (sessTab === "evaluation") drawEvaluation(s);
    if (sessTab === "report") TSR.sessionData(sb, s).then(d => { const b = $("repBox"); if (b) b.innerHTML = TSR.session(d, p, profile); });
    if (sessTab === "certs" && p.id) TSCU.tab($("certBox"), { sb, profile, toast, errText, programme: p, sessions, session: s, save: saveProgramme(p.id), notify: () => notifyCerts(p.id) });
    if (sessTab === "details") fillThumbs($("view"));
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
      const paths = [];
      for (const f of (s.files || []).filter(f => f.path)) { const { data: used } = await sb.rpc("file_in_use", { p_path: f.path, p_except: s.id }); if (!used) paths.push(f.path); }
      if (paths.length) await sb.storage.from("session-files").remove(paths);
      const { error } = await sb.from("sessions").delete().eq("id", id);
      if (error) return ($("delErr").textContent = errText(error, "Couldn't delete."));
      sessions = sessions.filter(x => x.id !== id); toast("Session deleted"); location.hash = "#/sessions";
    });
  }

  // Tell phones in the programme's sessions that certificates changed.
  function notifyCerts(programmeId) {
    sessions.filter(x => x.programme_id === programmeId && x.attendance_code && x.status !== "draft").forEach(x => {
      const ch = sb.channel("ts-" + x.attendance_code, { config: { broadcast: { self: false } } });
      ch.subscribe(st => { if (st === "SUBSCRIBED") { ch.send({ type: "broadcast", event: "certs", payload: {} }); setTimeout(() => (sb.removeChannel ? sb.removeChannel(ch) : ch.unsubscribe?.()), 1500); } });
    });
  }
  // End a session for everyone: phones show their summary; the programme completes after its last session.
  async function endSession(s) {
    const { data, error } = await sb.rpc("end_session", { p_session: s.id });
    if (error) return toast(errText(error, "Couldn't end the session.").replace("schema.sql", "schema-4-attendance.sql"));
    const ch = sb.channel("ts-" + s.attendance_code, { config: { broadcast: { self: false } } });
    ch.subscribe(st => { if (st === "SUBSCRIBED") { ch.send({ type: "broadcast", event: "ended", payload: {} }); setTimeout(() => (sb.removeChannel ? sb.removeChannel(ch) : ch.unsubscribe?.()), 1500); } });
    await loadData();
    const pr = progs.find(x => x.id === s.programme_id);
    toast(data?.programme_completed ? (pr?.certificates ? "Programme completed. Review who qualifies and issue the certificates." : "Session ended. That was the last one: the programme is completed.") : "Session ended. The room is closed on every phone.");
    if (data?.programme_completed && pr?.certificates) { sessTab = "certs"; location.hash = "#/session/" + s.id; }
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
      t.innerHTML = `<thead><tr><th>#</th><th>Photo</th><th>Name</th><th>Email</th><th>Organisation</th><th>Group</th><th>In</th><th>Away</th><th>Out</th><th>Time spent</th><th></th></tr></thead><tbody>${rows.map((r, i) => {
        const d = dupOf(r);
        return `<tr><td>${i + 1}</td><td>${r.photo ? `<img src="${esc(r.photo)}" alt="" width="40" height="40" style="object-fit:cover;display:block">` : ""}</td>
          <td><b>${esc(pName(r))}</b>${isDup(r) ? `<br><span class="flag">Possible duplicate</span>` : ""}${(r.rejoins || []).length ? `<br><small class="muted" title="${esc(r.rejoins.map(fmtT).join(", "))}">↩ Back in by email ${r.rejoins.length > 1 ? r.rejoins.length + " times" : "at " + fmtT(r.rejoins[0])}</small>` : ""}</td><td>${esc(r.email)}</td><td>${esc(r.organisation)}</td>
          <td>${r.grp ? `<span class="gpill" style="background:${TSGR.color(r.grp)}">${esc(TSGR.name(s.groups, r.grp))}</span>` : "–"}</td><td>${fmtT(r.arrived_at)}</td><td>${r.away_seconds || r.left_at ? `<span title="${esc(away(r))}">${hm(r.away_seconds)}</span><br><small class="muted">${esc(away(r))}</small>` : "–"}</td>
          <td>${fmtT(r.left_at) || "–"}</td><td><b>${hm(r.spent_seconds)}</b></td>
          <td>${d.length ? `<button class="btn ghost small" type="button" data-merge="${r.participant}" data-into="${d[0].participant}">Merge into ${esc(d[0].email)}</button>` : ""}</td></tr>`;
      }).join("") || `<tr><td colspan="11" class="muted">No one has checked in yet. Open the live screen to show the check-in QR code.</td></tr>`}</tbody>`;
      t.querySelectorAll("[data-merge]").forEach(b => b.addEventListener("click", async () => {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to merge"; return; }
        const { error } = await sb.rpc("merge_participants", { p_keep: b.dataset.into, p_drop: b.dataset.merge });
        if (error) return toast(errText(error, "Couldn't merge.").replace("schema.sql", "schema-4-attendance.sql"));
        toast("Merged into one person"); draw();
      }));
      $("regCsv").onclick = async () => {
        const p = progs.find(x => x.id === s.programme_id) || {};
        const { data: part } = await sb.rpc("session_participation", { p_session: s.id });
        const pm = Object.fromEntries((part || []).map(x => [x.participant, x]));
        csvDownload(`Register - ${s.topic}`, [["Programme", p.name], ["Session", s.topic], ["Date", s.session_date || ""], [],
          ["#", "Title", "Name", "Email", "Organisation", "Sex", "Group", "Focus: times left", "Focus: time away", "Time in", "Time away", "Away periods", "Time out", "Time spent", "Minutes spent", "Activities taken part in", "Activities run", "Participation %", "Points", "Participation rank", "Photo"],
          ...rows.map((r, i) => { const x = pm[r.participant] || {}; return [i + 1, r.title, r.name, r.email, r.organisation, { male: "Male", female: "Female", na: "Prefer not to say" }[r.sex] || "", r.grp ? TSGR.name(s.groups, r.grp) : "", r.focus_accepted ? r.focus_leaves || 0 : "", r.focus_accepted ? hm(r.focus_away || 0) : "", fmtT(r.arrived_at), hm(r.away_seconds), away(r), fmtT(r.left_at), hm(r.spent_seconds), Math.round((r.spent_seconds || 0) / 60), x.taken ?? "", x.runs ?? "", x.rate ?? "", x.points ?? "", x.rank ?? "", r.photo]; })]);
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
        kind: slot, title: a?.title, steps: a?.data?.steps, seconds: a?.data?.seconds, library: LIB,
        aiWrite: async ({ kind, count, notes }) => {
          const r = await aiCall({ task: "write_questions", kind, count, notes, topic: s.topic, objectives: s.objectives || [s.main_topic, s.key_skill].filter(Boolean).join("; ") });
          if (r.error) throw new Error(r.error);
          return r.steps;
        },
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

  // ---------- session evaluation (Evaluation tab, live card, form editor) ----------
  const starTxt = v => v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1);
  async function drawEvaluation(s, editing) {
    const box = $("evBox"); if (!box) return;
    const ev = s.evaluation || {};
    if (ev.mode === "none" && !editing) { box.innerHTML = `<div class="empty"><div><h2>No evaluation for this session</h2><p class="muted">Turn it on in <a href="#/edit/${s.id}">Edit</a> → Evaluation.</p></div></div>`; return; }
    const items = TSE.formFor(s, ev);
    if (editing) return drawEvalEditor(s, items);
    const { data, error } = await sb.rpc("session_evaluation", { p_session: s.id });
    if (error) { box.innerHTML = `<p class="note warn">${esc(errText(error, "Couldn't load.").replace("schema.sql", "schema-9-evaluation.sql"))}</p>`; return; }
    const rows = data?.rows || [], R = TSE.score(items, rows);
    const bars = i => `<div class="evrow"><span class="evt">${esc(i.text)}</span><span class="evdist">${i.dist.map((n, k) => `<i title="${TSE.SCALES[i.type][k]}: ${n}" style="flex:${n || 0.001};background:${["#D2391F", "#F0A35E", "#C9CEC6", "#7FB8E6", "#2747C8"][k]}"></i>`).join("")}</span><b>${i.avg == null ? "–" : i.avg.toFixed(1)}</b></div>`;
    const sec = (k, t) => { const list = R.per.filter(i => i.sec === k); return list.length ? `<section class="fold" data-open="1"><div class="body" style="padding-top:18px"><h3 style="font-size:18px">${t}</h3>${list.map(bars).join("")}</div></section>` : ""; };
    box.innerHTML = `<div class="row" style="justify-content:space-between"><p class="muted" style="max-width:70ch">${R.count} of ${data.attendees} participants have filled it${data.anonymous ? " · anonymous" : ""}. ${data.open ? "Open on phones now." : "Phones get it when you open it on the live screen, at tap-out, and when the session ends."}</p>
        <div class="row"><button class="btn ghost small" type="button" id="evEdit">Edit the questions</button>${rows.length ? `<button class="btn small" type="button" id="evCsv">Download (Excel/CSV)</button>` : ""}</div></div>
      <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <div class="tile" style="--c:var(--yellow)"><span class="lbl">Overall rating</span><b>${starTxt(R.overall)}<small style="font-size:.4em"> / 5</small></b><span>${R.overall == null ? "No ratings yet" : "★".repeat(Math.round(R.overall)) + "☆".repeat(5 - Math.round(R.overall))}</span></div>
        <div class="tile" style="--c:var(--blue)"><span class="lbl">Reaction (level 1)</span><b>${R.reaction == null ? "–" : R.reaction + "%"}</b><span>How the session went</span></div>
        <div class="tile" style="--c:var(--red)"><span class="lbl">Learning (level 2)</span><b>${R.learning == null ? "–" : R.learning + "%"}</b><span>Can do it and confident to apply</span></div>
        <div class="tile" style="--c:var(--ink)"><span class="lbl">Knowledge, before → after</span><b>${R.before == null ? "–" : R.before.toFixed(1)} → ${R.after == null ? "–" : R.after.toFixed(1)}</b><span>Out of 5, self-rated</span></div></div>
      ${rows.length ? `${sec("reaction", "How the session went")}${sec("learning", "What they learned")}${sec("other", "Your questions")}
        <section class="fold" data-open="1"><div class="body" style="padding-top:18px"><div class="d-head"><h3 style="font-size:18px">In their own words</h3><button class="btn small" type="button" id="evAI">✨ Summarise with AI</button></div><div id="evAIout"></div>
          ${R.texts.map(t => `<h4 class="evh4">${esc(t.text)} <span class="muted small">(${t.answers.length})</span></h4><div class="evcomments">${t.answers.map(a => `<blockquote>${esc(a.t)}${a.name ? `<cite>${esc(a.name)}</cite>` : ""}</blockquote>`).join("") || `<p class="muted small">No answers yet.</p>`}</div>`).join("")}</div></section>`
        : `<div class="empty"><div><h2>No answers yet</h2><p class="muted">Open the evaluation on the live screen when you reach it in your flow. Phones also get it at tap-out and when the session ends.</p></div></div>`}`;
    $("evEdit").onclick = () => drawEvaluation(s, true);
    if ($("evCsv")) $("evCsv").onclick = () => csvDownload(`Evaluation - ${s.topic}`, [["Session", s.topic], ["Date", s.session_date || ""], ["Responses", R.count], ["Overall rating (out of 5)", starTxt(R.overall)], ["Reaction %", R.reaction ?? ""], ["Learning %", R.learning ?? ""], [],
      [...(data.anonymous ? [] : ["Name"]), "Submitted", ...items.map(i => i.text)], ...rows.map(r => [...(data.anonymous ? [] : [r.name]), new Date(r.at).toLocaleString(), ...items.map(i => r.answers?.[i.id] ?? "")])]);
    if ($("evAI")) $("evAI").onclick = async () => {
      const b = $("evAI"); b.disabled = true; b.textContent = "✨ Reading the comments…";
      const r = await aiCall({ task: "eval_summary", session_id: s.id });
      b.disabled = false; b.textContent = "✨ Summarise with AI";
      if (!r || r.error) { $("evAIout").innerHTML = `<p class="err">${esc((r && r.error) || "AI couldn't summarise.")}</p>`; return; }
      $("evAIout").innerHTML = `<div class="evai"><p><b>${esc(r.summary || "")}</b></p>${(r.strengths || []).length ? `<p class="small"><b>Strengths:</b> ${r.strengths.map(esc).join(" · ")}</p>` : ""}${(r.improve || []).length ? `<p class="small"><b>To improve:</b> ${r.improve.map(esc).join(" · ")}</p>` : ""}</div>`;
    };
  }
  function drawEvalEditor(s, items) {
    const box = $("evBox"); let list = structuredClone(items);
    const draw = () => {
      box.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="font-size:20px">Edit the evaluation questions</h2><div class="row"><button class="btn ghost small" type="button" id="eeLibAdd">📚 Use a form from Library</button><button class="btn ghost small" type="button" id="eeLibSave">Save form to Library</button><button class="btn ghost small" type="button" id="eeReset">Back to the default 17</button></div></div>
        <div class="libpick" id="eeLib" hidden></div>
        <p class="muted small">Change the wording, the answer type, or add your own questions. The overall star rating feeds your dashboard.</p>
        <div class="eelist">${list.map((i, k) => `<div class="eerow"><span class="n">${k + 1}</span><input class="in" data-k="${k}" data-f="text" value="${esc(i.text)}" aria-label="Question ${k + 1}"><select class="in" data-k="${k}" data-f="type" aria-label="Answer type">${Object.entries(TSE.TYPES).map(([v, t]) => `<option value="${v}" ${i.type === v ? "selected" : ""}>${t}</option>`).join("")}</select><button class="x" type="button" data-del="${k}" aria-label="Remove question ${k + 1}">×</button></div>`).join("")}</div>
        <div class="row"><button class="btn ghost small" type="button" id="eeAdd">+ Add a question</button></div>
        <div class="wfoot"><button class="btn ghost" type="button" id="eeCancel">Cancel</button><div class="row"><span class="err" id="eeErr"></span><button class="btn red" type="button" id="eeSave">Save questions</button></div></div>`;
      box.querySelectorAll("[data-f]").forEach(el => el.addEventListener("input", () => { list[+el.dataset.k][el.dataset.f] = el.value; }));
      box.querySelectorAll("[data-f=type]").forEach(el => el.addEventListener("change", () => { list[+el.dataset.k].type = el.value; }));
      box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { list.splice(+b.dataset.del, 1); draw(); }));
      $("eeAdd").onclick = () => { list.push({ id: "q" + Date.now().toString(36), sec: "other", type: "agree", text: "" }); draw(); box.querySelector(".eerow:last-child input")?.focus(); };
      $("eeReset").onclick = () => { list = TSE.defaultForm(s); draw(); };
      $("eeLibSave").onclick = async () => {
        const clean = list.map(i => ({ ...i, text: String(i.text || "").trim() })).filter(i => i.text);
        if (!clean.length) return ($("eeErr").textContent = "Add at least one question first.");
        try { await LIB.save({ kind: "evaluation", title: `Evaluation: ${s.topic}`, data: { items: clean } }); $("eeErr").textContent = "Saved to your Library ✓ Rename it on the Library page."; }
        catch (e) { $("eeErr").textContent = e.message; }
      };
      $("eeLibAdd").onclick = async () => {
        const pk = $("eeLib"); if (!pk.hidden) { pk.hidden = true; return; } pk.hidden = false; pk.innerHTML = `<span class="small muted">Loading…</span>`;
        let forms; try { forms = await LIB.list("evaluation"); } catch (e) { pk.innerHTML = `<span class="err">${esc(e.message)}</span>`; return; }
        pk.innerHTML = forms.length ? `<b>Use a form from your Library</b> <span class="small muted">It replaces the questions below.</span>${forms.map((f, i) => `<button type="button" class="libitem" data-ef="${i}"><span><b>${esc(f.title)}</b><small>${(f.data.items || []).length} questions</small></span><span class="ok">Use</span></button>`).join("")}` : `<span class="small muted">No evaluation forms in your Library yet. Save one with “Save form to Library”.</span>`;
        pk.querySelectorAll("[data-ef]").forEach(b => (b.onclick = () => { const f = forms[+b.dataset.ef]; list = structuredClone(f.data.items || []); LIB.used(f.id); draw(); $("eeErr").textContent = `Using “${f.title}”. Save questions to keep it.`; }));
      };
      $("eeCancel").onclick = () => drawEvaluation(s);
      $("eeSave").onclick = async () => {
        list = list.map(i => ({ ...i, text: String(i.text || "").trim() })).filter(i => i.text);
        if (!list.length) return ($("eeErr").textContent = "Keep at least one question.");
        const isDefault = JSON.stringify(list) === JSON.stringify(TSE.defaultForm(s));
        const evaluation = { ...(s.evaluation || { mode: "default", anonymous: true, at_tapout: true }), mode: (s.evaluation || {}).mode === "none" ? "default" : ((s.evaluation || {}).mode || "default") };
        if (isDefault) delete evaluation.items; else evaluation.items = list;
        const { data, error } = await sb.from("sessions").update({ evaluation }).eq("id", s.id).select().single();
        if (error) return ($("eeErr").textContent = errText(error, "Couldn't save."));
        sessions = sessions.map(x => x.id === s.id ? data : x); toast("Evaluation questions saved"); drawEvaluation(data);
      };
    };
    draw();
  }
  // live screen card
  function drawEvalCard() {
    const m = $("stMain"), on = !!P.s.eval_open, ev = P.s.evaluation || {};
    m.innerHTML = `<div class="st-card"><span class="sq" style="background:#14161C"></span><span class="lbl" style="color:var(--sacc)">Session evaluation</span><b>How did it go?</b>
      <span>Fill the evaluation on your phone. About 2 minutes${ev.anonymous !== false ? ", and it's anonymous" : ""}.</span>
      <div class="evlive"><span class="ring" id="evRing" style="--p:0"><b id="evN">0</b></span><span id="evOf" class="st-mono">of ${P.roll.filter(r => !r.left_at).length || 0} done</span></div>
      <div class="row">${on ? `<button class="key big" type="button" id="evClose">Close the evaluation</button>` : `<button class="key next big" type="button" id="stStart">▶ Open on phones</button>`}</div></div>`;
    $("stStart")?.addEventListener("click", () => setEvalOpen(true));
    $("evClose")?.addEventListener("click", () => setEvalOpen(false));
    evalCount();
  }
  async function setEvalOpen(on) {
    const { error } = await sb.rpc("set_eval_open", { p_session: P.s.id, p_open: on });
    if (error) return toast(errText(error, "Couldn't open the evaluation.").replace("schema.sql", "schema-9-evaluation.sql"));
    P.s = { ...P.s, eval_open: on }; sessions = sessions.map(x => x.id === P.s.id ? { ...x, eval_open: on } : x);
    if (on) P.channel?.send({ type: "broadcast", event: "eval", payload: {} });
    if (P.items[P.i]?.key === "evaluation") drawEvalCard();
  }
  async function evalCount() {
    if (!P || P.items[P.i]?.key !== "evaluation") return;
    const { data } = await sb.rpc("eval_count", { p_session: P.s.id });
    if (!data || !$("evN")) return;
    const total = Math.max(data.attendees || 0, 1);
    $("evN").textContent = data.done; $("evOf").textContent = `of ${data.attendees} done`;
    $("evRing").style.setProperty("--p", Math.round(data.done / total * 100));
  }

  // ---------- participation ranking (Participation tab) ----------
  async function drawParticipation(s) {
    const box = $("partBox"); if (!box) return;
    const { data, error } = await sb.rpc("session_participation", { p_session: s.id });
    if (error) { box.innerHTML = `<p class="note warn">${esc(errText(error, "Couldn't load.").replace("schema.sql", "schema-5-participation.sql"))}</p>`; return; }
    const rows = data || [], runs = rows[0]?.runs || 0;
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.rate, 0) / rows.length) : 0;
    const medal = n => n <= 3 ? `<span class="medal m${n}">${n}</span>` : `<span class="medal">${n}</span>`;
    box.innerHTML = `<p class="muted" style="max-width:72ch">Ranked by how many activities each person took part in, then by points. Each person sees their own rank on their phone.</p>
      <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <div class="tile" style="--c:var(--red)"><span class="lbl">Activities run</span><b>${runs}</b><span>Launched on the live screen</span></div>
        <div class="tile" style="--c:var(--blue)"><span class="lbl">Average participation</span><b>${avg}%</b><span>Of activities run</span></div>
        <div class="tile" style="--c:var(--yellow)"><span class="lbl">Took part in all</span><b>${runs ? rows.filter(r => r.taken >= runs).length : 0}</b><span>of ${rows.length} checked in</span></div>
        <div class="tile" style="--c:var(--ink)"><span class="lbl">Took part in none</span><b>${runs ? rows.filter(r => !r.taken).length : 0}</b><span>Worth a word at the break</span></div></div>
      <div class="row" style="justify-content:space-between"><h2 style="font-size:20px">Most active first</h2><div class="row"><button class="btn ghost small" type="button" id="ptRefresh">Refresh</button>${rows.length ? `<button class="btn small" type="button" id="ptCsv">Download (Excel/CSV)</button>` : ""}</div></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Rank</th><th>Photo</th><th>Name</th><th>Organisation</th><th>Activities</th><th>Participation</th><th>Answers</th><th>Points</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${medal(r.rank)}</td><td>${r.photo ? `<img src="${esc(r.photo)}" alt="" width="40" height="40" style="object-fit:cover;display:block">` : ""}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.organisation)}</td>
        <td>${r.taken} of ${r.runs}</td><td><span class="achbar"><i style="width:${r.rate}%;background:var(--blue)"></i></span> <b>${r.rate}%</b></td><td>${r.answers}</td><td><b>${r.points.toLocaleString()}</b></td></tr>`).join("") || `<tr><td colspan="8" class="muted">No one has checked in yet.</td></tr>`}</tbody></table></div>`;
    $("ptRefresh").onclick = () => drawParticipation(s);
    if ($("ptCsv")) $("ptCsv").onclick = () => csvDownload(`Participation - ${s.topic}`, [["Session", s.topic], ["Date", s.session_date || ""], ["Activities run", runs], [],
      ["Rank", "Name", "Organisation", "Activities taken part in", "Activities run", "Participation %", "Answers", "Points"], ...rows.map(r => [r.rank, r.name, r.organisation, r.taken, r.runs, r.rate, r.answers, r.points])]);
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
    const sc = s.slide_count || 0, flow = [...(s.flow || [])].filter(f => TOOL[f.tool] && PLACEABLE(f.tool)).sort((a, b) => a.after - b.after);
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
    P.channel.on("broadcast", { event: "evaluated" }, () => evalCount());
    P.channel.on("broadcast", { event: "focus_out" }, ({ payload }) => focusOut(payload));
    P.channel.on("broadcast", { event: "focus_back" }, ({ payload }) => focusBack(payload));
    P.channel.on("broadcast", { event: "focus_ok" }, () => loadFocus());
    P.channel.on("broadcast", { event: "focus_research" }, ({ payload }) => payload && focusNote(`🔎 ${payload.name} started a ${payload.minutes}-minute research window`, "#1F5FBF"));
    P.channel.subscribe(st => { if (st === "SUBSCRIBED") sayNow(); });
    P.nowTimer = setInterval(sayNow, 10000);
    P.remoteTimer = setInterval(() => remoteState(), 3000);
    setupRemote();
    P.rollTimer = setInterval(() => refreshRoll(true), 8000);
    P.acts = (await loadActs(s.id, true)) || [];
    await refreshRoll(false);
    loadFocus(true);
    P.focusTimer = setInterval(drawAlerts, 1000);
    $("stage").style.setProperty("--dockh", $("stDock").offsetHeight + "px");
    goItem(0);
    if (gestPref()) gestures(true);
    poke();
  }
  function stopRun() { if (P?.run) { P.run.destroy(); P.run = null; } }
  function stopPresent() {
    if (!P) return;
    stopRun(); closeWheel(); window.TSG?.stop(); $("stCam").hidden = true; $("stGest").setAttribute("aria-pressed", "false"); $("stBlank").hidden = true; $("stRemote").hidden = true;
    if (P.remote) sb.removeChannel ? sb.removeChannel(P.remote) : P.remote.unsubscribe?.();
    clearInterval(P.nowTimer); clearInterval(P.rollTimer); clearInterval(P.remoteTimer); clearInterval(P.focusTimer); $("stAlerts").innerHTML = ""; $("stFocus").hidden = true;
    if (P.channel) sb.removeChannel ? sb.removeChannel(P.channel) : P.channel.unsubscribe?.();
    P = null;
  }
  function exitPresent(to) {
    const id = P?.s.id; window.TSB?.close(); stopPresent();
    $("stage").hidden = true; document.body.style.overflow = "";
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    location.hash = to || "#/session/" + id;
  }
  addEventListener("hashchange", () => { if (P && !/^#\/present\//.test(location.hash)) { window.TSB?.close(); stopPresent(); $("stage").hidden = true; document.body.style.overflow = ""; } });
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
    if (!$("stGroups").hidden && gcfg() && !document.querySelector(".gghost,.gnamein,.gform")) drawGroups();
    if (P.focus && announce) loadFocus();
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
    if (P) P.dir = to >= P.i ? 1 : -1;
    window.TSG?.resetZoom();
    if (to !== P.i || !P.run) stopRun();
    P.i = to;
    const it = P.items[P.i];
    $("stPos").textContent = `${P.i + 1} of ${P.items.length}`;
    $("stKind").textContent = it.t === "slide" ? "Training" : it.t === "welcome" ? "Check-in" : it.label;
    $("stNext").textContent = P.i < P.items.length - 1 ? "Next: " + P.items[P.i + 1].label + " ▶" : "Finish session ✓";
    document.querySelectorAll("#stStrip [data-go]").forEach(b => { b.classList.toggle("on", +b.dataset.go === P.i); });
    document.querySelector("#stStrip .on")?.scrollIntoView({ block: "nearest", inline: "center" });
    draw(); sayNow(); remoteState();
  }
  function draw() {
    const it = P.items[P.i], m = $("stMain");
    if (it.t === "welcome") return drawWelcome();
    if (it.t === "slide") {
      if (!P.pdf) { m.innerHTML = `<div class="st-card"><span class="lbl" style="color:var(--sacc)">Slide ${it.n}</span><b>${P.pdfErr ? "Couldn't open your slides." : "Loading your slides…"}</b></div>`; return; }
      // Render the new slide off-screen, then swap it in with the chosen transition.
      const old = m.querySelector("canvas#stCanvas"), keepOld = old && P.lastSlide !== it.n && !P.redraw;
      if (!old) m.innerHTML = "";
      const n = it.n, token = (P.drawToken = (P.drawToken || 0) + 1), redraw = P.redraw; P.redraw = false;
      P.pdf.getPage(n).then(async page => {
        if (!P || token !== P.drawToken) return;
        const box = m.getBoundingClientRect(), v1 = page.getViewport({ scale: 1 });
        const sc = Math.min(box.width / v1.width, box.height / v1.height), dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: sc * dpr }), c = document.createElement("canvas");
        c.width = vp.width; c.height = vp.height; c.style.width = vp.width / dpr + "px"; c.style.height = vp.height / dpr + "px";
        c.setAttribute("aria-label", "Slide " + n);
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        if (!P || token !== P.drawToken) return;
        P.lastSlide = n;
        const t = trans(), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        m.querySelectorAll("canvas.leaving").forEach(x => x.remove());
        const prev = m.querySelector("canvas#stCanvas");
        if (!prev || !keepOld || redraw || t === "none" || reduced) { m.innerHTML = ""; c.id = "stCanvas"; m.appendChild(c); return; }
        prev.id = ""; prev.classList.add("leaving"); c.id = "stCanvas"; m.appendChild(c);
        const dir = P.dir < 0 ? "back" : "fwd";
        // Morph picks a different camera move each time: push into a point, pull back, swing, drift or spin.
        let mv = "";
        if (t === "morph") {
          const moves = ["push", "pull", "swing", "drift", "spin"].filter(x => x !== P.lastMove);
          mv = "m-" + (P.lastMove = moves[Math.floor(Math.random() * moves.length)]);
          const ox = 20 + Math.random() * 60 + "%", oy = 20 + Math.random() * 60 + "%";
          [prev, c].forEach(el => { el.style.setProperty("--ox", ox); el.style.setProperty("--oy", oy); });
        }
        prev.classList.add("tr-out", "t-" + t, dir); c.classList.add("tr-in", "t-" + t, dir); if (mv) { prev.classList.add(mv); c.classList.add(mv); }
        setTimeout(() => { prev.remove(); c.classList.remove("tr-in", "t-" + t, dir); if (mv) c.classList.remove(mv); }, t === "morph" ? 1050 : 650);
      });
      return;
    }
    const slot = slotOfItem(it);
    if (slot) return drawActivity(it, slot);
    if (it.t === "card" && it.key === "evaluation") return drawEvalCard();
    if (it.t === "card" && it.key === "certificates") {
      m.innerHTML = `<div class="st-card"><span class="sq" style="background:#F4B400"></span><span class="lbl" style="color:var(--sacc)">Certificates</span><b>Is your name right?</b>
        <span>Your phone shows your name as it will be printed. Tap <b>Correct</b>, or fix it now. Certificates are issued when the programme ends, and you download yours from your phone.</span>
        <button class="btn red" type="button" id="stNames" style="align-self:flex-start;margin-top:8px">📱 Ask phones to check names</button></div>`;
      $("stNames").onclick = () => { P.channel?.send({ type: "broadcast", event: "namecheck", payload: {} }); toast("Sent: every phone shows the name check."); };
      return;
    }
    const tool = it.t === "tool" ? TOOL[it.tool] : null, card = CARD[it.key] || [it.label, ""];
    m.innerHTML = `<div class="st-card"><span class="sq" style="background:${tool ? tool.color : it.key === "certificates" ? "#F4B400" : "#D2391F"}"></span><span class="lbl" style="color:var(--sacc)">${tool ? "Activity" : "Next up"}</span><b>${esc(tool ? tool.name : card[0])}</b><span>${esc(tool ? tool.line : card[1])}</span><span class="soon">This runs live on phones in the next update of Training Suite.</span></div>`;
  }
  // Activities between slides: an intro card, then the live runner (activities.js).
  const slotOfItem = it => it.t === "tool" && SLOTS.includes(it.tool) ? it.tool : it.t === "card" && (it.key === "pretest" || it.key === "posttest") ? "test" : null;
  function drawActivity(it, slot) {
    if (P.run) return;
    const m = $("stMain"), a = P.acts.find(x => x.slot === slot), K = TSA.KINDS[slot], ok = a && a.data?.steps?.length;
    const name = slot === "test" ? (it.key === "pretest" ? "Pre-test" : "Post-test") : (a?.title || K.name);
    const line = slot === "test" ? (it.key === "pretest" ? "Where everyone starts. Answer on your phone." : "The same questions again. You'll see your learning achievement.") : (K.say || K.line);
    const n = ok ? a.data.steps.length : 0;
    m.innerHTML = `<div class="st-card"><span class="sq" style="background:${K.color}"></span><span class="lbl" style="color:var(--sacc)">${slot === "test" ? "Test" : "Activity"}${n ? ` · ${n} ${TSA.PROMPTY(slot) ? "prompt" : "question"}${n === 1 ? "" : "s"}` : ""}</span><b>${esc(name)}</b><span>${esc(line)}</span>
      ${ok ? `<button class="key next big" type="button" id="stStart">▶ Start${P.phones ? ` · ${P.phones} phone${P.phones === 1 ? "" : "s"} ready` : ""}</button><span class="soon">Enter starts it · → skips it</span>`
           : `<span class="soon">No questions written yet. Add them on the session's Assessments tab, then reopen the live screen.</span>`}</div>`;
    $("stStart")?.addEventListener("click", () => startRun(it, slot, a));
  }
  async function startRun(it, slot, a) {
    if (!P || P.run) return;
    // a group battle needs groups: make two at random if there are none yet
    if (a.kind === "battle" && !gcfg() && P.roll.length >= 2) {
      const cfg = { n: 2, method: "random", names: [], aliases: {} };
      if (await gSave(cfg, TSGR.assign(P.roll.map(r => ({ participant: r.participant })), 2, "random"))) { await refreshRoll(false); gSend(); stFlash("👥 2 groups made for the battle"); }
      if (P.run) return;
    }
    const run = slot === "test" ? (it.key === "pretest" ? "pre" : "post") : "r" + Date.now().toString(36);
    const m = $("stMain"); m.innerHTML = `<div class="lvwrap"></div>`;
    const at = P.i;
    P.run = TSA.live(m.firstElementChild, { sb, session: P.s, activity: a, run, channel: P.channel, phones: () => P?.phones || 0, groups: () => gcfg(), ai: aiCall, fingers: f => window.TSG.fingers(f), onCamera: on => { if (window.TSG.on || P?.gestPaused) { P.gestPaused = on; window.TSG.pause(on); } },
      onDone: () => { if (P && P.i === at) { if (P.i < P.items.length - 1) goItem(P.i + 1); else { stopRun(); draw(); } } } });
  }
  function drawWelcome() {
    const m = $("stMain"), code = P.s.attendance_code, link = checkinLink(code), here = P.roll.filter(r => !r.left_at);
    m.innerHTML = `<div class="st-welcome"><div class="st-scan"><div class="qr big">${qrSvg(link)}</div><span class="lbl" style="color:var(--smuted)">Scan to check in</span><span class="code" style="color:var(--sstrong)">${esc(code)}</span><span class="small" style="color:var(--smuted);word-break:break-all">${esc(link)}</span></div>
      <div class="st-roll"><div class="st-hello"><span lang="yo">Ẹ káàbọ̀</span> · You are welcome</div><h2>${esc(P.s.topic)}</h2>
      <div class="faces">${here.slice(-40).reverse().map(r => `<figure>${r.photo ? `<img src="${esc(r.photo)}" alt="">` : `<span>${esc((r.name || "?")[0])}</span>`}<figcaption>${esc(pName(r))}</figcaption></figure>`).join("") || `<p style="color:var(--smuted)">Arrivals appear here.</p>`}</div></div></div>`;
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
    const files = (P.s.files || []).filter(f => f.kind === "share" || f.kind === "link");
    const tg = n => `<div class="row" style="gap:6px"><button class="btn red small" type="button" data-sh="${n}" data-t="all">Everyone</button>${TSGR.keys(gcfg()).map(k => `<button class="btn ghost small" type="button" data-sh="${n}" data-t="${k}" style="border-color:${TSGR.color(k)};color:${TSGR.color(k)}">${esc(TSGR.name(gcfg(), k))}</button>`).join("")}</div>`;
    $("stShare").innerHTML = `<div class="row" style="justify-content:space-between"><b style="font-family:var(--display);font-size:18px">Share with the room</b><button type="button" class="x" id="shX" aria-label="Close">×</button></div>
      ${P.items[P.i].t === "slide" ? `<div class="shrow"><b>This slide (${P.items[P.i].n})</b>${tg("slide")}</div>` : ""}
      ${files.map((f, n) => `<div class="shrow"><b>${f.kind === "link" ? (f.sub === "YouTube" ? "▶ " : "🔗 ") : "📄 "}${esc(f.name)}</b>${tg(n)}</div>`).join("") || `<p class="small muted">No files or links preloaded. Add them on the session's Slides step.</p>`}
      <span class="upmsg" id="shMsg" role="status"></span>`;
    $("stShare").hidden = false;
    $("shX").onclick = () => ($("stShare").hidden = true);
    $("stShare").querySelectorAll("[data-sh]").forEach(b => b.addEventListener("click", async () => {
      const msg = $("shMsg"); msg.textContent = "Sharing…";
      try {
        if (b.dataset.sh === "slide") await shareSlide(b.dataset.t);
        else { const f = files[+b.dataset.sh]; if (f.kind === "link") await share("link", f.name, f.url, b.dataset.t); else await share("file", f.name, await publishFile(f), b.dataset.t); }
        msg.className = "upmsg"; msg.textContent = `Sent to ${b.dataset.t === "all" ? "everyone" : TSGR.name(gcfg(), b.dataset.t)} ✓`;
      } catch (e) { msg.className = "err"; msg.textContent = errText(e, "Couldn't share.").replace("schema.sql", "schema-2-participants.sql"); }
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
  // ---------- Spin the wheel (always on) ----------
  const WCOL = ["#D2391F", "#F4B400", "#2747C8", "#14161C", "#3FB98A", "#B48EF0"];
  const pickedKey = () => "ts_picked_" + (P?.s.id || "");
  const getPicked = () => { try { return new Set(JSON.parse(sessionStorage.getItem(pickedKey()) || "[]")); } catch { return new Set(); } };
  const setPicked = set => { try { sessionStorage.setItem(pickedKey(), JSON.stringify([...set])); } catch {} };
  let wheelSkip = true;
  function openWheel(mode) {
    if (!P) return;
    if (mode) G.wheel = mode;
    const gm = G.wheel === "groups" && gcfg();
    const box = $("stWheel"), picked = getPicked();
    const here = gm ? TSGR.keys(gcfg()).map(k => ({ participant: "g" + k, name: TSGR.name(gcfg(), k), grp: k, color: TSGR.color(k), count: P.roll.filter(r => r.grp === k).length })) : P.roll.filter(r => !r.left_at);
    const pool = wheelSkip ? here.filter(r => !picked.has(r.participant)) : here;
    box.hidden = false; setTimeout(remoteState, 0);
    if (!here.length) { box.innerHTML = `<div class="wcard"><h2>No one is checked in yet</h2><p>People appear on the wheel once they check in.</p><button class="key next" type="button" data-wx>Close</button></div>`; box.querySelector("[data-wx]").onclick = closeWheel; return; }
    if (!pool.length) { box.innerHTML = `<div class="wcard"><h2>Everyone has had a turn</h2><p>Start again with the whole room?</p><div class="row" style="justify-content:center"><button class="key next" type="button" data-wreset>Start again</button><button class="key" type="button" data-wx>Close</button></div></div>`; box.querySelector("[data-wreset]").onclick = () => { setPicked(new Set()); openWheel(); }; box.querySelector("[data-wx]").onclick = closeWheel; return; }
    const n = pool.length, seg = 360 / n;
    const label = r => { const nm = String(r.name || "").replace(/^(Prof|Dr|Engr|Mr|Mrs|Miss|Ms)\.?\s+/i, ""); return n > 24 ? nm.split(" ")[0] : nm.length > 18 ? nm.split(" ")[0] : nm; };
    const svg = `<svg viewBox="-110 -110 220 220" class="wsvg" id="wSvg">${pool.map((r, i) => {
      const a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180, large = seg > 180 ? 1 : 0;
      const path = n === 1 ? `<circle r="100" fill="${r.color || WCOL[0]}"/>` : `<path d="M0 0 L${100 * Math.cos(a0)} ${100 * Math.sin(a0)} A100 100 0 ${large} 1 ${100 * Math.cos(a1)} ${100 * Math.sin(a1)} Z" fill="${r.color || WCOL[i % WCOL.length]}"/>`;
      const mid = (i + 0.5) * seg - 90, fs = Math.max(4, Math.min(9, 150 / n));
      return path + `<text transform="rotate(${mid}) translate(94 0)" text-anchor="end" dominant-baseline="middle" font-size="${fs}" fill="${!r.color && i % WCOL.length === 1 ? "#14161C" : "#fff"}">${esc(gm ? r.name : label(r))}</text>`;
    }).join("")}<circle r="14" fill="#fff"/><circle r="6" fill="#14161C"/></svg>`;
    box.innerHTML = `<div class="wwrap"><div class="wpin" aria-hidden="true"></div>${svg}</div>
      <div class="wside"><span class="st-hello">Spin the wheel</span>${gcfg() ? `<div class="wmode" role="group" aria-label="Spin"><button type="button" data-wm="people" aria-pressed="${!gm}">People</button><button type="button" data-wm="groups" aria-pressed="${!!gm}">Groups</button></div>` : ""}<h2>${n} ${gm ? (n === 1 ? "group" : "groups") : n === 1 ? "person" : "people"} on the wheel</h2>
        <label class="wskip"><input type="checkbox" id="wSkip" ${wheelSkip ? "checked" : ""}> Leave out people already picked (${picked.size})</label>
        <div class="row"><button class="key next big" type="button" id="wGo">Spin ↻</button><button class="key" type="button" data-wx>Close</button></div>
        <div id="wWin" class="wwin" aria-live="polite"></div></div>`;
    box.querySelector("[data-wx]").onclick = closeWheel;
    box.querySelectorAll("[data-wm]").forEach(b => (b.onclick = () => openWheel(b.dataset.wm)));
    $("wSkip").onchange = e => { wheelSkip = e.target.checked; openWheel(); };
    let rot = 0, busy = false, spun = false;
    $("wGo").onclick = () => {
      if (busy) return;
      if (spun && wheelSkip) { openWheel(); setTimeout(() => $("wGo")?.click(), 60); return; }   // take the last person off, then spin
      busy = true; $("wWin").innerHTML = "";
      const k = Math.floor(Math.random() * n), win = pool[k];
      const target = 360 - ((k + 0.5) * seg) + (Math.random() - 0.5) * seg * 0.6;   // the chosen slice stops under the pin (top)
      rot = rot - (rot % 360) + 360 * 6 + target;
      const el = $("wSvg"); el.style.transition = matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "transform 5.2s cubic-bezier(.12,.75,.12,1)";
      el.style.transform = `rotate(${rot}deg)`;
      setTimeout(() => {
        busy = false; spun = true;
        if (!$("wWin") || !$("wSvg") || $("wSvg") !== el) return;   // closed while spinning
        const set = getPicked(); set.add(win.participant); setPicked(set);
        if (gm) {
          $("wWin").innerHTML = `<div class="wface" style="background:${win.color}"><span>${esc(win.grp)}</span></div><b>${esc(win.name)}</b><small>${TSGR.colorName(win.grp)} · ${win.count} ${win.count === 1 ? "person" : "people"}</small>`;
          P.channel?.send({ type: "broadcast", event: "picked", payload: { grp: win.grp, name: win.name } });
        } else {
          $("wWin").innerHTML = `<div class="wface">${win.photo ? `<img src="${esc(win.photo)}" alt="">` : `<span>${esc((win.name || "?")[0])}</span>`}</div><b>${esc(pName(win))}</b><small>${esc(win.organisation || "")}</small>`;
          P.channel?.send({ type: "broadcast", event: "picked", payload: { participant: win.participant, name: win.name } });
        }
        $("wGo").textContent = "Spin again ↻";
      }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : 5300);
    };
  }
  function closeWheel() { $("stWheel").hidden = true; $("stWheel").innerHTML = ""; remoteState(); }
  $("stWheelBtn").addEventListener("click", () => ($("stWheel").hidden ? openWheel() : closeWheel()));

  // ---------- phone remote: a private key per live screen; the phone sends commands, we send back what's on screen ----------
  const remoteLink = key => new URL("remote/", location.href.split("#")[0]).href + "#" + key;
  function setupRemote() {
    const k = "ts_remote_" + P.s.id;
    let key = null; try { key = sessionStorage.getItem(k); } catch {}
    if (!key) { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(10)); key = [...r].map(x => A[x % A.length]).join(""); try { sessionStorage.setItem(k, key); } catch {} }
    P.remoteKey = key;
    P.remote = sb.channel("ts-remote-" + key, { config: { broadcast: { self: false } } });
    P.remote.on("broadcast", { event: "cmd" }, ({ payload }) => { const c = payload?.cmd; if (["next", "prev", "step", "spin", "blank", "close"].includes(c)) { cmd(c); poke(); } else remoteState(); P.remoteSeen = true; if (!$("stRemote").hidden) drawRemote(); });
    P.remote.subscribe(st => { if (st === "SUBSCRIBED") remoteState(); });
  }
  function remoteState() {
    if (!P?.remote) return;
    const it = P.items[P.i] || {}, wheel = !$("stWheel").hidden;
    const step = wheel ? "Spin" : P.run ? (P.run.label?.() || "Next step") : $("stStart") ? "Start activity" : "Next";
    P.remote.send({ type: "broadcast", event: "state", payload: { label: it.t === "welcome" ? "Check-in and welcome" : it.label, pos: P.i + 1, total: P.items.length, blank: !!P.blank, wheel, step, topic: P.s.topic } });
  }
  function drawRemote() {
    const link = remoteLink(P.remoteKey);
    $("stRemote").innerHTML = `<div class="row" style="justify-content:space-between"><b style="font-family:var(--display);font-size:18px">Control from your phone</b><button type="button" class="x" data-rx aria-label="Close">×</button></div>
      <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:nowrap"><div class="qr" style="width:150px;height:150px">${qrSvg(link)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0"><span class="small">Scan with <b>your</b> phone. Keep this code private: anyone with it can move your slides.</span><span class="code" style="font-size:20px">${esc(P.remoteKey)}</span><span class="small" style="word-break:break-all;color:var(--muted)">${esc(link)}</span>${P.remoteSeen ? `<span class="ok">Phone connected ✓</span>` : ""}</div></div>`;
    $("stRemote").querySelector("[data-rx]").onclick = () => ($("stRemote").hidden = true);
  }
  $("stRemoteBtn").addEventListener("click", () => { if (!P) return; if ($("stRemote").hidden) { drawRemote(); $("stRemote").hidden = false; } else $("stRemote").hidden = true; });

  // ---------- hand gestures (gestures.js) ----------
  const gestPref = () => { try { return localStorage.getItem("ts_gest") === "1"; } catch { return false; } };
  function stFlash(t) { const f = $("stFlash"); f.textContent = t; f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
  async function gestures(on) {
    try { localStorage.setItem("ts_gest", on ? "1" : ""); } catch {}
    $("stGest").setAttribute("aria-pressed", on); $("stCam").hidden = !on;
    if (!on) { window.TSG.stop(); $("stGrab").hidden = true; return; }
    $("gNote").hidden = true;
    await window.TSG.start({
      video: $("gVideo"), canvas: $("gOverlay"),
      label: t => ($("gLbl").textContent = t),
      note: t => { $("gNote").textContent = t; $("gNote").hidden = !t; },
      onCmd: c => { if (!P) return; stFlash(c === "next" ? "▶" : "◀"); cmd(c === "next" && P.run ? "step" : c); },
      zoomable: () => P && P.items[P.i]?.t === "slide" && !P.blank,
      slideEl: () => $("stCanvas"),
      canThrow: () => P && P.items[P.i]?.t === "slide" && !!P.pdf,
      onGrab: g => {
        $("stGrab").hidden = !g; $("stGrab").textContent = gcfg() ? "✊ Grabbed: move your fist to a group, then open your hand" : "✊ Grabbed: open your hand towards the room to throw"; $("stMain").classList.toggle("grabbed", g);
        throwTiles(g);
      },
      onAim: f => { if (!P?.tiles) return; const i = Math.floor(f * P.tiles.length); P.aim = P.tiles[i]; document.querySelectorAll("#stThrow span").forEach((el, j) => el.classList.toggle("on", j === i)); },
      onThrow: async target => {
        target = target || P.aim || "all"; throwTiles(false);
        const m = $("stMain"); m.classList.remove("tossed"); void m.offsetWidth; m.classList.add("tossed"); setTimeout(() => m.classList.remove("tossed"), 900);
        try { await shareSlide(target); stFlash(`Thrown to ${target === "all" ? "everyone" : TSGR.name(gcfg(), target)} ✓`); }
        catch (e) { stFlash("Couldn't throw"); toast(errText(e, "Couldn't share the slide.")); }
      },
      flash: stFlash
    });
  }
  // While a slide is grabbed: the groups as tiles along the bottom, Everyone in the middle.
  function throwTiles(on) {
    let el = $("stThrow");
    if (!on || !P) { if (el) el.remove(); if (P) { P.tiles = null; P.aim = null; } return; }
    const ks = TSGR.keys(gcfg()), half = Math.ceil(ks.length / 2);
    P.tiles = ks.slice(0, half).concat(["all"], ks.slice(half)); P.aim = "all";
    if (!el) { el = document.createElement("div"); el.id = "stThrow"; el.className = "st-throw"; $("stage").appendChild(el); }
    $("stage").style.setProperty("--gb", $("stage").classList.contains("fs") ? "0px" : $("stDock").offsetHeight + "px");
    el.innerHTML = P.tiles.map(k => `<span class="${k === "all" ? "on" : ""}" style="--tc:${k === "all" ? "#14161C" : TSGR.color(k)}">${k === "all" ? "Everyone" : esc(TSGR.name(gcfg(), k))}</span>`).join("");
  }
  $("stGest").addEventListener("click", () => gestures($("stGest").getAttribute("aria-pressed") !== "true"));

  // ---------- blank screen (B, or the phone remote) ----------
  function setBlank(on) { if (!P) return; P.blank = on; $("stBlank").hidden = !on; remoteState(); }

  $("stPrev").addEventListener("click", () => P && goItem(P.i - 1));
  $("stNext").addEventListener("click", () => { if (!P) return; if (P.i >= P.items.length - 1) finishSession(); else goItem(P.i + 1); });
  $("stShareBtn").addEventListener("click", () => P && openShare());
  // ---------- groups (any number; fresh each session) ----------
  const G = { form: null, wheel: "people" };
  const initials = n => String(n || "?").replace(/^(Prof|Dr|Engr|Mr|Mrs|Miss|Ms)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const gcfg = () => P?.s.groups || null;
  function gSend() { P?.channel?.send({ type: "broadcast", event: "groups", payload: {} }); }
  async function gSave(cfg, assign) {
    const { error } = await sb.rpc("set_groups", { p_session: P.s.id, p_config: cfg, p_assign: assign });
    if (error) { toast(/function|schema cache/i.test(error.message || "") ? "Groups aren't set up in the database yet: run supabase/schema-12-groups.sql in Supabase." : errText(error, "Couldn't save the groups.")); return false; }
    P.s.groups = cfg; sessions = sessions.map(x => x.id === P.s.id ? { ...x, groups: cfg } : x);
    return true;
  }
  async function openGroups() {
    if (!P) return;
    const { data } = await sb.from("sessions").select("groups").eq("id", P.s.id).single();
    if (data) P.s.groups = data.groups || null;
    await refreshRoll(false);
    $("stage").style.setProperty("--gb", $("stage").classList.contains("fs") ? "0px" : $("stDock").offsetHeight + "px");
    $("stGroups").hidden = false; setTimeout(remoteState, 0);
    gcfg() ? drawGroups(true) : groupForm();
  }
  function closeGroups() { $("stGroups").hidden = true; }
  function groupForm(prefill) {
    const box = $("stGroups"), people = P.roll, cur = prefill || gcfg() || { n: 4, method: "random" };
    G.form = { n: cur.n || 4, about: 0, method: cur.method || "random", aliases: { ...(cur.aliases || {}) } };
    const sexes = { male: 0, female: 0, other: 0 }; people.forEach(r => (r.sex === "male" ? sexes.male++ : r.sex === "female" ? sexes.female++ : sexes.other++));
    const draw = () => {
      const f = G.form, n = f.about ? Math.max(2, Math.min(12, Math.round(people.length / f.about) || 2)) : f.n, list = TSGR.mdas(people, f.aliases);
      box.innerHTML = `<div class="gform"><div class="row" style="justify-content:space-between"><h2>Make groups</h2><button type="button" class="x" data-gx aria-label="Close">×</button></div>
        <p class="st-mono">${people.length} ${people.length === 1 ? "person" : "people"} checked in · ${sexes.male} men · ${sexes.female} women${sexes.other ? ` · ${sexes.other} not said` : ""}</p>
        <div class="gsize"><label class="gopt"><input type="radio" name="gsz" value="n" ${f.about ? "" : "checked"}><span>Number of groups</span>
            <span class="gstep"><button type="button" data-gn="-1" aria-label="Fewer">−</button><b>${f.n}</b><button type="button" data-gn="1" aria-label="More">＋</button></span></label>
          <label class="gopt"><input type="radio" name="gsz" value="about" ${f.about ? "checked" : ""}><span>Groups of about</span>
            <span class="gstep"><button type="button" data-ga="-1" aria-label="Smaller">−</button><b>${f.about || 5}</b><button type="button" data-ga="1" aria-label="Bigger">＋</button></span><span class="small">people${f.about ? ` → ${n} groups` : ""}</span></label></div>
        <div class="gmeth">${TSGR.METHODS.map(([v, t, l]) => `<label class="gm"><input type="radio" name="gm" value="${v}" ${f.method === v ? "checked" : ""}><b>${t}</b><span>${l}</span></label>`).join("")}</div>
        ${f.method.startsWith("mda") ? `<details class="gmda" ${list.length ? "open" : ""}><summary><b>${list.length} different MDA${list.length === 1 ? "" : "s"}</b> <span class="small">Same MDA spelt differently? Merge them so they count as one.</span></summary>
          <div class="gmlist">${list.map((m, i) => `<div class="gmrow"><span>${esc(m.label)} <small>(${m.count})</small></span><select data-gmerge="${i}"><option value="">Its own MDA</option>${list.filter(o => o.key !== m.key).map(o => `<option value="${esc(o.key)}">Same as ${esc(o.label)}</option>`).join("")}</select></div>`).join("") || `<p class="small">No MDAs entered yet.</p>`}</div></details>` : ""}
        ${f.method === "sex" && sexes.other > people.length / 2 ? `<p class="small" style="color:var(--sacc)">Most people haven't said their sex, so this works like Random.</p>` : ""}
        <div class="row"><button type="button" class="key next big" id="gMake">${gcfg() ? "Make new groups" : "Create groups"}</button><button type="button" class="key" data-gx>Cancel</button></div></div>`;
      box.querySelectorAll("[data-gx]").forEach(b => (b.onclick = () => (gcfg() ? drawGroups() : closeGroups())));
      box.querySelectorAll("[data-gn]").forEach(b => (b.onclick = () => { f.about = 0; f.n = Math.max(2, Math.min(12, f.n + +b.dataset.gn)); draw(); }));
      box.querySelectorAll("[data-ga]").forEach(b => (b.onclick = () => { f.about = Math.max(2, Math.min(30, (f.about || 5) + +b.dataset.ga)); draw(); }));
      box.querySelectorAll("[name=gsz]").forEach(i => (i.onchange = () => { f.about = i.value === "about" ? f.about || 5 : 0; draw(); }));
      box.querySelectorAll("[name=gm]").forEach(i => (i.onchange = () => { f.method = i.value; draw(); }));
      box.querySelectorAll("[data-gmerge]").forEach(sel => (sel.onchange = () => {
        const m = list[+sel.dataset.gmerge]; m.raws.forEach(r => { if (sel.value) f.aliases[r] = sel.value; else delete f.aliases[r]; });
        Object.keys(f.aliases).forEach(k => { if (f.aliases[k] === m.key && sel.value) f.aliases[k] = sel.value; }); draw();
      }));
      $("gMake").onclick = async () => {
        const cfg = { n, method: f.method, names: (gcfg()?.n === n ? gcfg().names : []) || [], aliases: f.aliases };
        const assign = TSGR.assign(people.map(r => ({ participant: r.participant, sex: r.sex, organisation: r.organisation })), n, f.method, f.aliases);
        if (!(await gSave(cfg, assign))) return;
        await refreshRoll(false); gSend(); drawGroups(true);
      };
    };
    draw();
  }
  function drawGroups(animate) {
    const box = $("stGroups"), cfg = gcfg(); if (!cfg) return groupForm();
    const keys = TSGR.keys(cfg), by = {}; keys.forEach(k => (by[k] = []));
    const none = []; P.roll.forEach(r => (by[r.grp] ? by[r.grp].push(r) : none.push(r)));
    const face = (r, i) => `<span class="gface${r.left_at ? " out" : ""}" data-pid="${r.participant}" style="${animate ? `animation-delay:${Math.min(i * 40, 1600)}ms` : "animation:none"}" title="${esc(pName(r))}">${r.photo ? `<img src="${esc(r.photo)}" alt="" draggable="false">` : `<i>${esc(initials(r.name))}</i>`}<small>${esc(String(r.name || "").split(" ")[0])}</small></span>`;
    let i = 0;
    box.innerHTML = `<div class="gtop"><div><span class="st-hello">Groups</span><h2>${keys.length} groups · ${esc((TSGR.METHODS.find(m => m[0] === cfg.method) || [])[1] || "")}</h2></div>
        <div class="row"><button type="button" class="key" id="gShuffle" ${cfg.method === "choose" ? "hidden" : ""}>↻ Reshuffle</button><button type="button" class="key" id="gChange">Change</button><button type="button" class="key" id="gSpin">🎯 Spin a group</button><button type="button" class="key" id="gRemove">Remove groups</button><button type="button" class="key next" data-gx>Close</button></div></div>
      <p class="st-mono gtip">Drag a face to move someone · tap a group's name to rename it${cfg.method === "choose" ? " · people pick their group on their phones" : " · late arrivals are placed automatically"}</p>
      <div class="ggrid" style="--cols:${Math.min(keys.length + (none.length ? 1 : 0), keys.length > 6 ? 4 : 3)}">${keys.map(k => `<div class="gcard" data-gk="${k}" style="--gc:${TSGR.color(k)}"><div class="gh"><button type="button" class="gname" data-gren="${k}">${esc(TSGR.name(cfg, k))}</button><span>${TSGR.colorName(k)} · ${by[k].length}</span></div><div class="gfaces">${by[k].map(r => face(r, i++)).join("") || `<span class="small gempty">No one yet</span>`}</div></div>`).join("")}
        ${none.length ? `<div class="gcard" data-gk="" style="--gc:#5B6170"><div class="gh"><b>Not in a group</b><span>${none.length}</span></div><div class="gfaces">${none.map(r => face(r, i++)).join("")}</div></div>` : ""}</div>`;
    box.querySelector("[data-gx]").onclick = closeGroups;
    $("gChange").onclick = () => groupForm(cfg);
    $("gSpin").onclick = () => { closeGroups(); openWheel("groups"); };
    $("gShuffle").onclick = async e => {
      const b = e.currentTarget; if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to reshuffle"; return; }
      const assign = TSGR.assign(P.roll.map(r => ({ participant: r.participant, sex: r.sex, organisation: r.organisation })), cfg.n, cfg.method, cfg.aliases);
      if (await gSave(cfg, assign)) { await refreshRoll(false); gSend(); drawGroups(true); }
    };
    $("gRemove").onclick = async e => {
      const b = e.currentTarget; if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to remove"; return; }
      if (await gSave(null, null)) { await refreshRoll(false); gSend(); closeGroups(); toast("Groups removed"); }
    };
    box.querySelectorAll("[data-gren]").forEach(b => (b.onclick = () => {
      const k = b.dataset.gren, inp = document.createElement("input"); inp.className = "gnamein"; inp.value = TSGR.name(cfg, k); inp.maxLength = 30;
      b.replaceWith(inp); inp.focus(); inp.select();
      const done = async () => { const names = (cfg.names || []).slice(); names[+k - 1] = inp.value.trim(); const nc = { ...cfg, names }; if (await gSave(nc, null)) gSend(); drawGroups(); };
      inp.addEventListener("blur", done, { once: true }); inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = TSGR.name(cfg, k); inp.blur(); } });
    }));
    // drag a face to another group (mouse or touch)
    box.querySelectorAll(".gface").forEach(f => f.addEventListener("pointerdown", e => {
      e.preventDefault(); const ghost = f.cloneNode(true); ghost.classList.add("gghost"); document.body.appendChild(ghost);
      const mv = ev => { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; box.querySelectorAll(".gcard").forEach(c => c.classList.toggle("over", c === document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".gcard"))); };
      mv(e); f.classList.add("lifting");
      const up = async ev => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up); ghost.remove(); f.classList.remove("lifting");
        const card = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".gcard"); box.querySelectorAll(".gcard").forEach(c => c.classList.remove("over"));
        const r = P.roll.find(x => x.participant === f.dataset.pid); if (!card || !r || card.dataset.gk === r.grp) return;
        const { error } = await sb.rpc("move_to_group", { p_session: P.s.id, p_participant: r.participant, p_grp: card.dataset.gk });
        if (error) return toast(errText(error, "Couldn't move them."));
        r.grp = card.dataset.gk; gSend(); drawGroups();
      };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    }));
  }
  $("stGroupsBtn").addEventListener("click", () => { if (!P) return; $("stGroups").hidden ? openGroups() : closeGroups(); });

  // ---------- focus mode ----------
  // P.focus = the session's focus settings; P.fx = everyone's focus state; P.away = who is off the page now.
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  async function loadFocus(seed) {
    if (!P) return;
    const { data, error } = await sb.rpc("session_focus", { p_session: P.s.id });
    if (error || !data) { P.fx = null; return; }
    P.fx = data; P.focus = data.focus && data.focus.on ? data.focus : null; P.away = P.away || new Map();
    if (seed && P.focus) (data.rows || []).forEach(r => { if (r.out_at && r.in_room) P.away.set(r.participant, { name: r.name, since: +new Date(r.out_at), research: false, until: 0 }); });
    if (!P.focus) P.away.clear();
    const waiting = P.focus ? (data.rows || []).filter(r => r.in_room && !r.accepted).length : 0;
    $("stFocusN").hidden = !waiting; $("stFocusN").textContent = waiting; $("stFocusBtn").classList.toggle("on", !!P.focus);
    $("stFocusBtn").title = P.focus ? `Focus mode is on${waiting ? ` · ${waiting} not accepted yet` : ""} (O)` : "Focus mode (O)";
    if (!$("stFocus").hidden) drawFocusPanel();
    drawAlerts();
  }
  function focusOut(p) {
    if (!P?.focus || !p) return; P.away = P.away || new Map();
    P.away.set(p.participant, { name: p.name, since: Date.now(), research: !!p.research, until: p.until || 0 }); drawAlerts();
  }
  function focusBack(p) {
    if (!P || !p) return; const a = P.away?.get(p.participant); P.away?.delete(p.participant);
    if (P.focus && p.secs > (P.focus.grace || 20)) focusNote(`${p.name} is back · away ${p.secs < 60 ? p.secs + " s" : mmss(p.secs)}`, "#0F8A5F");
    drawAlerts(); if (a && !$("stFocus").hidden) loadFocus();
  }
  function focusNote(t, color) {
    const el = document.createElement("div"); el.className = "st-alert note"; el.style.setProperty("--ac", color || "#14161C"); el.textContent = t;
    $("stAlerts").appendChild(el); setTimeout(() => el.remove(), 6000);
  }
  // Who has been off the page longer than the grace period, with a running timer.
  function drawAlerts() {
    if (!P) return; const box = $("stAlerts"), now = Date.now(), grace = (P.focus?.grace || 20) * 1000;
    box.querySelectorAll(".st-alert.away").forEach(e => e.remove());
    if (!P.focus || !P.away) return;
    const list = [...P.away.entries()].map(([id, a]) => {
      const counted = a.research && a.until > a.since ? Math.max(0, now - Math.max(a.since, a.until)) : now - a.since;
      return { id, ...a, counted, researching: a.research && now < a.until };
    }).filter(a => a.researching || a.counted > grace).sort((x, y) => y.counted - x.counted);
    list.slice(0, 6).forEach(a => {
      const el = document.createElement("div"); el.className = "st-alert away" + (a.researching ? " res" : "");
      el.innerHTML = a.researching ? `🔎 <b>${esc(a.name)}</b> is researching · ${mmss((a.until - now) / 1000)} left` : `⚠ <b>${esc(a.name)}</b> away from Training Suite · ${mmss(a.counted / 1000)}`;
      box.prepend(el);
    });
    if (list.length > 6) { const el = document.createElement("div"); el.className = "st-alert away"; el.textContent = `and ${list.length - 6} more away`; box.appendChild(el); }
  }
  function drawFocusPanel() {
    const box = $("stFocus"), fx = P.fx; if (!fx) { box.innerHTML = `<div class="gform"><h2>Focus mode</h2><p>Focus mode isn't set up in the database yet: run supabase/schema-14-focus.sql in Supabase.</p><div class="row"><button type="button" class="key" data-fx>Close</button></div></div>`; box.querySelector("[data-fx]").onclick = () => (box.hidden = true); return; }
    const saved = fx.focus || { on: false, scope: "activities", grace: 30, research: 3 }, f = { ...saved, ...(P.fxDraft || {}) }, rows = (fx.rows || []).filter(r => r.in_room), now = Date.now();
    const status = r => { const a = P.away?.get(r.participant); if (!a) return `<span class="ok">Here</span>`; if (a.research && now < a.until) return `<span style="color:#1F5FBF">Researching</span>`; return `<b style="color:#D2391F">Away ${mmss((now - a.since) / 1000)}</b>`; };
    box.innerHTML = `<div class="gform"><div class="row" style="justify-content:space-between"><h2>🎯 Focus mode</h2><button type="button" class="x" data-fx aria-label="Close">×</button></div>
      ${!fx.allowed ? `<div class="note warn" style="color:#14161C">Focus mode is off for this programme. <button type="button" class="key next" id="fxAllow">Allow Focus mode for this programme</button></div>` : `
      <p class="st-mono">Phones are asked to accept. While Focus applies, their screens stay on, and going away from Training Suite for longer than the grace period is logged and shown here with a timer.</p>
      <div class="gmeth" style="grid-template-columns:1fr 1fr">${[["activities", "During activities and tests", "Only while a question is open on phones. Between activities, phones are free."], ["session", "Whole session", "From now until you turn it off."]].map(([v, t, l]) => `<label class="gm"><input type="radio" name="fxScope" value="${v}" ${(f.scope || "activities") === v ? "checked" : ""}><b>${t}</b><span>${l}</span></label>`).join("")}</div>
      <div class="gsize"><label class="gopt">Grace period <select id="fxGrace" class="fxsel">${[10, 20, 30, 60, 120].map(v => `<option value="${v}" ${(f.grace || 30) === v ? "selected" : ""}>${v < 60 ? v + " seconds" : v / 60 + " minute" + (v > 60 ? "s" : "")}</option>`).join("")}</select></label>
        <label class="gopt">Research window <select id="fxRes" class="fxsel">${[0, 2, 3, 5, 10].map(v => `<option value="${v}" ${(f.research ?? 3) === v ? "selected" : ""}>${v ? v + " minutes" : "Off"}</option>`).join("")}</select></label></div>
      <div class="row"><button type="button" class="key next big" id="fxToggle">${f.on ? "Turn Focus mode off" : "Turn Focus mode on"}</button>${f.on ? `<button type="button" class="key" id="fxSave">Save changes</button>` : ""}<span class="st-mono">${f.on ? `${rows.filter(r => r.accepted).length} of ${rows.length} accepted · ${P.away?.size || 0} away now` : ""}</span></div>
      ${rows.length ? `<div class="fxwrap"><table class="fxt"><thead><tr><th>Name</th><th>Accepted</th><th>Now</th><th>Times left</th><th>Time away</th><th>Research</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${r.photo ? `<img src="${esc(r.photo)}" alt="">` : ""}<b>${esc(r.name)}</b></td><td>${r.accepted ? "✓" : `<span style="color:#B8860B">Waiting</span>`}</td><td>${f.on && r.accepted ? status(r) : "–"}</td><td>${r.leaves || "–"}${r.short ? ` <small class="st-mono">(+${r.short} short)</small>` : ""}</td><td>${r.away ? mmss(r.away) : "–"}</td><td>${r.research || "–"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="st-mono">No one is checked in yet.</p>`}`}</div>`;
    box.querySelector("[data-fx]").onclick = () => (box.hidden = true);
    const keep = () => { P.fxDraft = { scope: document.querySelector("[name=fxScope]:checked")?.value, grace: +$("fxGrace").value, research: +$("fxRes").value }; };
    box.querySelectorAll("[name=fxScope],#fxGrace,#fxRes").forEach(el => el.addEventListener("change", keep));
    $("fxAllow")?.addEventListener("click", async () => {
      const { error } = await sb.from("programmes").update({ focus_allowed: true }).eq("id", P.s.programme_id);
      if (error) return toast(errText(error, "Couldn't change the programme."));
      progs = progs.map(x => x.id === P.s.programme_id ? { ...x, focus_allowed: true } : x); loadFocus();
    });
    const save = async on => {
      const cfg = { on, scope: document.querySelector("[name=fxScope]:checked")?.value || "activities", grace: +$("fxGrace").value, research: +$("fxRes").value };
      const { data, error } = await sb.rpc("set_focus", { p_session: P.s.id, p_focus: cfg });
      if (error) return toast(errText(error, "Couldn't change Focus mode."));
      P.fxDraft = null;
      P.channel?.send({ type: "broadcast", event: "focus", payload: {} }); stFlash(on ? "🎯 Focus mode on" : "Focus mode off");
      if (!on) { P.away?.clear(); drawAlerts(); }
      loadFocus();
    };
    $("fxToggle")?.addEventListener("click", () => save(!f.on));
    $("fxSave")?.addEventListener("click", () => save(true));
  }
  function openFocus() {
    if (!P) return; const box = $("stFocus");
    if (!box.hidden) { box.hidden = true; return; }
    $("stage").style.setProperty("--gb", $("stage").classList.contains("fs") ? "0px" : $("stDock").offsetHeight + "px");
    box.hidden = false; drawFocusPanel(); loadFocus();
    clearInterval(P.fxPanelTimer); P.fxPanelTimer = setInterval(() => { if (!P || box.hidden) return clearInterval(P?.fxPanelTimer); if (!box.querySelector("select:focus")) drawFocusPanel(); }, 2000);
  }
  $("stFocusBtn").addEventListener("click", openFocus);

  // ---------- writing board ----------
  async function slideCanvas(n, width = 1600) {
    if (!P?.pdf) return null;
    const page = await P.pdf.getPage(n), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: width / v1.width });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise; return c;
  }
  function toggleBoard() {
    if (!P) return;
    if (TSB.isOpen()) { TSB.close(); return; }
    TSB.show({
      host: $("stage"), id: P.s.id, bottom: () => ($("stage").classList.contains("fs") ? 0 : $("stDock").offsetHeight),
      slideNow: () => (P.items[P.i]?.t === "slide" ? P.items[P.i].n : 0),
      slideImage: n => slideCanvas(n),
      share: async (blob, name, target) => {
        const dest = `${profile.id}/${P.s.id}/board-${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("ts-shared").upload(dest, blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        await share("slide", name, sb.storage.from("ts-shared").getPublicUrl(dest).data.publicUrl, target);
      },
      onClose: () => $("stBoardBtn").setAttribute("aria-pressed", "false")
    });
    $("stBoardBtn").setAttribute("aria-pressed", "true");
  }
  $("stBoardBtn").addEventListener("click", toggleBoard);
  // the session flow strip only appears when you ask for it
  function flowStrip(on) { $("stage").style.setProperty("--dockh", $("stDock").offsetHeight + "px"); $("stStrip").hidden = !on; $("stFlowBtn").setAttribute("aria-expanded", on); if (on) document.querySelector("#stStrip .on")?.scrollIntoView({ block: "nearest", inline: "center" }); }
  $("stFlowBtn").addEventListener("click", () => flowStrip($("stStrip").hidden));
  $("stStrip").addEventListener("click", e => { if (e.target.closest("[data-go]")) setTimeout(() => flowStrip(false), 150); });
  // light screen by default; dark for dark slide decks (remembered on this computer)
  const darkPref = () => { try { return localStorage.getItem("ts_dark") === "1"; } catch { return false; } };
  function setDark(on) { $("stage").classList.toggle("dark", on); $("stTheme").textContent = on ? "☀️ Light" : "🌙 Dark"; try { localStorage.setItem("ts_dark", on ? "1" : ""); } catch {} }
  $("stTheme").addEventListener("click", () => setDark(!$("stage").classList.contains("dark")));
  setDark(darkPref());
  $("stFs").addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else $("stage").requestFullscreen?.().catch(() => {}); });
  $("stExit").addEventListener("click", () => exitPresent());
  // One set of commands for the keyboard, hand gestures and the phone remote.
  function cmd(c) {
    if (!P) return;
    if (window.TSB?.isOpen() && c !== "blank" && c !== "spin") { if (c === "next") TSB.page(1); else if (c === "prev") TSB.page(-1); return; }
    if (P.blank && c !== "blank") { setBlank(false); return; }
    if (c === "spin") { if ($("stWheel").hidden) openWheel(); else $("wGo")?.click(); }
    else if (c === "blank") setBlank(!P.blank);
    else if (!$("stWheel").hidden) { if (c === "step") $("wGo")?.click(); else if (c === "close") closeWheel(); }
    else if (c === "step") { if (P.run) P.run.main(); else if ($("stStart")) $("stStart").click(); else if (P.i < P.items.length - 1) goItem(P.i + 1); }
    else if (c === "next") { if (P.i < P.items.length - 1) goItem(P.i + 1); }
    else if (c === "prev") goItem(P.i - 1);
    remoteState();
  }
  document.addEventListener("keydown", e => {
    if (!P || $("stage").hidden || e.target.closest("input,textarea,select")) return;
    if (e.key === "k" || e.key === "K") { e.preventDefault(); toggleBoard(); return; }
    if (window.TSB?.isOpen()) return;   // the board has its own keys
    if ((e.key === " " || e.key === "Enter") && e.target.closest("button") && e.target.closest(".lv,.st-card,.st-share,.st-wheel")) return;   // a focused button acts itself
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); cmd("step"); }
    else if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); cmd("next"); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); cmd("prev"); }
    else if (e.key === "f" || e.key === "F") $("stFs").click();
    else if (e.key === "w" || e.key === "W") cmd("spin");
    else if (e.key === "b" || e.key === "B" || e.key === ".") cmd("blank");
    else if (e.key === "g" || e.key === "G") $("stGest").click();
    else if (e.key === "t" || e.key === "T") nextTrans();
    else if (e.key === "l" || e.key === "L") $("stFlowBtn").click();
    else if (e.key === "d" || e.key === "D") $("stTheme").click();
    else if (e.key === "Escape" && !$("stStrip").hidden) flowStrip(false);
    else if (e.key === "h" || e.key === "H") window.TSG?.checkHands();
    else if (e.key === "Escape" && !$("stWheel").hidden) closeWheel();
    else if (e.key === "Escape" && !$("stRemote").hidden) $("stRemote").hidden = true;
    else if (e.key === "Escape" && !$("stShare").hidden) $("stShare").hidden = true;
    else if (e.key === "u" || e.key === "U") $("stGroupsBtn").click();
    else if (e.key === "o" || e.key === "O") openFocus();
    else if (e.key === "Escape" && !$("stFocus").hidden) $("stFocus").hidden = true;
    else if (e.key === "Escape" && !$("stGroups").hidden) closeGroups();
    poke();
  });
  let pokeT = null;
  function poke() { $("stDock").classList.remove("idle"); clearTimeout(pokeT); pokeT = setTimeout(() => $("stDock").classList.add("idle"), 4000); }
  $("stage").addEventListener("mousemove", poke);
  addEventListener("resize", () => { if (P && P.items[P.i]?.t === "slide") { P.redraw = true; draw(); } });
  // transitions between slides: none, fade, slide, zoom or morph (T, or the ✨ button)
  const TRANS = [["morph", "Special"], ["zoom", "Zoom"], ["fade", "Fade"], ["slide", "Slide"], ["none", "None"]];
  function trans() { try { return localStorage.getItem("ts_trans") || "morph"; } catch { return "morph"; } }
  function showTrans() { $("stTrans").textContent = "✨ " + (TRANS.find(x => x[0] === trans()) || TRANS[0])[1]; }
  function nextTrans() { const i = TRANS.findIndex(x => x[0] === trans()); try { localStorage.setItem("ts_trans", TRANS[(i + 1) % TRANS.length][0]); } catch {} showTrans(); stFlash("✨ " + TRANS[(i + 1) % TRANS.length][1]); }
  $("stTrans").addEventListener("click", nextTrans);
  showTrans();
  // full screen: the bars hide, and slide back when the mouse reaches the bottom edge (or a tap there)
  let fsT = null;
  document.addEventListener("fullscreenchange", () => { const on = !!document.fullscreenElement; $("stage").classList.toggle("fs", on); $("stage").classList.remove("reveal"); $("stage").style.setProperty("--dockh", $("stDock").offsetHeight + "px"); if (P && P.items[P.i]?.t === "slide") setTimeout(() => { P.redraw = true; draw(); }, 150); });
  const fsReveal = y => {
    const st = $("stage"); if (!st.classList.contains("fs")) return;
    if (y > innerHeight - 90) { st.classList.add("reveal"); clearTimeout(fsT); }
    else if (st.classList.contains("reveal") && y < innerHeight - 200 && y > 70) { clearTimeout(fsT); fsT = setTimeout(() => st.classList.remove("reveal"), 1200); }
  };
  $("stage").addEventListener("mousemove", e => fsReveal(e.clientY));
  $("stage").addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") fsReveal(e.clientY); });


  // ---------- simple pages ----------
  function viewSoon(title, line) { V(head(title, title) + `<div class="empty">${LOGO(90)}<div><h2>Coming soon</h2><p class="muted" style="max-width:56ch">${esc(line)}</p></div></div>`); }
  function viewSettings() {
    const exp = profile.expires_at ? new Date(profile.expires_at).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) : "No end date";
    V(head("Settings", "Your account") + `<div class="grid2" style="max-width:860px">
      <form id="meForm" style="display:flex;flex-direction:column;gap:14px" novalidate><span class="lbl">Profile</span>
        <label class="fld">Full name<span class="hint">As it should appear on certificates you sign.</span><input name="n" value="${esc(profile.full_name)}"></label>
        <label class="fld">Phone<input name="ph" value="${esc(profile.phone)}"></label>
        <label class="fld">Where you train<input name="w" value="${esc(profile.where_train)}"></label>
        <div class="row"><button class="btn" type="submit">Save</button><span class="err" id="meErr" role="status"></span></div>
        <span class="lbl" style="margin-top:10px">For signing reports</span>
        <label class="fld">Your title<span class="hint">Printed under your name, e.g. Head, Digital Learning Unit.</span><input name="jt" id="meTitle" value="${esc(profile.job_title || "")}"></label>
        <div class="row ced-assets">${profile.signature ? `<span class="ced-img sig"><img src="${esc(profile.signature)}" alt="Your signature"></span>` : `<span class="small muted">No signature yet.</span>`}
          <label class="btn ghost small">Upload<input type="file" id="meSigUp" accept="image/png,image/jpeg" hidden></label><button class="btn ghost small" type="button" id="meSigDraw">✍ Draw</button>${profile.signature ? `<button class="btn ghost small" type="button" id="meSigRm">Remove</button>` : ""}</div>
        <span class="small muted" id="meSigMsg">A photo of your signature on white paper works; the paper is removed automatically.</span></form>
      <div style="display:flex;flex-direction:column;gap:14px"><span class="lbl">Plan</span>
        <p><b>${esc(profile.plan || "Approved")}</b><br><span class="muted">Ends: ${esc(exp)}</span><br><span class="muted">${esc(profile.email)}</span></p>
        <p class="note" id="aiUse">AI requests this month: checking…</p>
        <form id="pwForm" style="display:flex;flex-direction:column;gap:14px" novalidate><span class="lbl">Change password</span>
          <label class="fld">New password<input type="password" name="pw" autocomplete="new-password"></label>
          <div class="row"><button class="btn ghost" type="submit">Change password</button><span class="err" id="pwErr" role="status"></span></div></form></div></div>`);
    sb.rpc("my_ai_usage").then(({ data, error }) => { const el = $("aiUse"); if (!el) return;
      if (error || !data) { el.textContent = "AI requests: not set up yet."; return; }
      el.textContent = data.limit === 0 ? "AI isn't included in your plan." : data.limit < 0 ? `AI requests this month: ${data.used} (no limit)` : `AI requests this month: ${data.used} of ${data.limit}`; });
    $("meForm").addEventListener("submit", async e => {
      e.preventDefault(); const f = e.target;
      const { data, error } = await sb.rpc("update_my_profile", { p_full_name: f.n.value, p_phone: f.ph.value, p_where_train: f.w.value });
      if (error) return ($("meErr").textContent = errText(error, "Couldn't save."));
      profile = data; $("meName").textContent = profile.full_name; $("meErr").textContent = "Saved.";
    });
    const saveSig = async (sig, title) => {
      const { data, error } = await sb.rpc("update_my_signature", { p_job_title: title ?? $("meTitle").value, p_signature: sig ?? profile.signature ?? "" });
      if (error) { $("meSigMsg").textContent = /function|schema cache/i.test(error.message || "") ? "Run supabase/schema-15-report.sql in Supabase first." : errText(error, "Couldn't save."); return false; }
      profile = data; return true;
    };
    $("meTitle").addEventListener("change", async () => { if (await saveSig(null, $("meTitle").value)) $("meSigMsg").textContent = "Title saved ✓"; });
    const sigAsset = async c => { if (!c) throw new Error("No signature found in that picture."); return TSCU.putAsset({ sb, profile }, "profile", c, "signature"); };
    $("meSigUp").addEventListener("change", async e => {
      const f = e.target.files[0]; if (!f) return; $("meSigMsg").textContent = "Uploading…";
      try { const url = await sigAsset(TSCU.clearWhite(await TSCU.fileToCanvas(f, 1200))); if (await saveSig(url)) viewSettings(); } catch (er) { $("meSigMsg").textContent = er.message; }
    });
    $("meSigDraw").addEventListener("click", async () => {
      const c = await TSCU.drawPad(); if (!c) return; $("meSigMsg").textContent = "Saving…";
      try { const url = await sigAsset(c); if (await saveSig(url)) viewSettings(); } catch (er) { $("meSigMsg").textContent = er.message; }
    });
    $("meSigRm")?.addEventListener("click", async () => { if (await saveSig("")) viewSettings(); });
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
