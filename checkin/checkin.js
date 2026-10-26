// Participant's phone: check in (or one-tap check in again), then the session room: answer live activities,
// see shared items and your learning achievement; tap out at the end.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const cfg = window.TS_CONFIG || {};
  const sb = window.supabase && cfg.SUPABASE_URL ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const LOGO = s => `<img src="../assets/logo.png" alt="" width="${Math.round(s * 0.94)}" height="${s}" style="display:block;flex:none">`;
  document.querySelectorAll("[data-logo]").forEach(el => el.insertAdjacentHTML("afterbegin", LOGO(+el.dataset.logo)));
  const code = location.hash.replace("#", "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const TITLES = ["Prof", "Dr", "Engr", "Mr", "Mrs", "Miss", "Ms"];
  const fullName = (t, n) => (t ? (t === "Miss" || t === "Ms" ? t + " " : t + ". ") : "") + n;
  const initials = n => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const fmtTime = t => t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  let sess = null, me = null, channel = null, items = [], group = "all";
  // This phone's id: one phone checks in one person per session.
  const DEV = store.get("ts_dev") || (() => { const d = crypto.randomUUID(); store.set("ts_dev", d); return d; })();
  const missingFn = e => /Could not find the function|does not exist|schema cache/i.test((e && e.message) || "");
  const hm = sec => { if (sec == null) return "–"; const m = Math.floor(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const SERVER_SAYS = /valid email|full name|ended|not valid|registered|this phone/i;
  const show = which => ["start", "back", "again", "form", "room", "bye", "evalSec"].forEach(id => ($(id).hidden = id !== which));
  const note = t => { $("note").hidden = !t; $("note").textContent = t || ""; };

  // ---------- start ----------
  async function boot() {
    if (!sb) return note("Can't reach Training Suite. Check the internet connection.");
    if (!code) return note("Scan the QR code shown at the venue, or open the link your facilitator shared.");
    const { data, error } = await sb.rpc("public_session", { p_code: code });
    if (error || !data) return note("This check-in code isn't valid. Check it with your facilitator.");
    sess = data;
    $("head").hidden = false; $("hProg").textContent = sess.programme; $("hTopic").textContent = sess.topic;
    $("hMeta").textContent = [sess.course_lead, sess.date && new Date(sess.date + "T00:00:00").toLocaleDateString([], { day: "numeric", month: "long" }), sess.start_time, sess.venue].filter(Boolean).join(" · ");
    document.title = sess.topic + " · Check-in";
    group = "all";
    if (sess.closed) return note("This programme has closed. Thank you for taking part.");
    if (sess.roster_only) $("emailHint").textContent = "Use the email you registered with for this programme. Your certificate and results will be sent there.";
    const here = store.get("ts_in_" + code), mine = store.get("ts_me_" + sess.pkey);
    if (here && mine) { me = { ...mine, arrived_at: here.arrived_at }; return openRoom(); }
    if (sess.ended && mine) { me = { ...mine }; return openRoom(); }
    if (sess.ended) { $("bNew").hidden = true; $("bEmail").previousElementSibling.textContent = "This session has ended. If you were here, use the email you checked in with to see your summary, evaluation and results."; return showBack(); }
    if (!sess.open) return note("This session has ended. Check-in is closed.");
    if (mine) { $("aName").textContent = fullName(mine.title, mine.name); $("aPh").innerHTML = mine.photo ? `<img src="${esc(mine.photo)}" alt="">` : esc(initials(mine.name)); return show("again"); }
    show("start");
  }

  // ---------- new here, or back in? ----------
  function showBack() { stopCam(); show("back"); $("bErr").textContent = ""; setTimeout(() => $("bEmail").focus(), 50); }
  $("sBack").addEventListener("click", showBack);
  $("sNew").addEventListener("click", openForm);
  $("fBack").addEventListener("click", () => { const e = $("fEmail").value.trim(); if (e && !$("bEmail").value) $("bEmail").value = e; showBack(); });
  $("bNew").addEventListener("click", () => { const e = $("bEmail").value.trim(); if (e && !$("fEmail").value) $("fEmail").value = e; openForm(); });
  // Only the email: the same person, the same record, the same photo.
  $("back").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("bEmail").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ($("bErr").textContent = "Enter a valid email address.");
    $("bErr").textContent = "Finding you…"; $("bGo").disabled = true;
    const { data, error } = await sb.rpc("rejoin", { p_code: code, p_email: email, p_device: DEV });
    $("bGo").disabled = false;
    if (error) return ($("bErr").textContent = missingFn(error) ? "Getting back in by email isn't switched on yet. Tap I'm new here and use the same email." : /find that email|haven't checked in|ended|this phone|valid/i.test(error.message) ? error.message : "Couldn't get you back in. Check the connection and try again.");
    if (data.ended) {
      me = { token: data.token, participant: data.participant, title: data.title, name: data.name, organisation: data.organisation, photo: data.photo, arrived_at: data.arrived_at };
      store.set("ts_me_" + sess.pkey, { token: data.token, participant: data.participant, title: data.title, name: data.name, organisation: data.organisation, photo: data.photo });
      return openRoom();
    }
    done(data);
  });

  // ---------- one tap for returning people ----------
  $("aGo").addEventListener("click", async () => {
    const mine = store.get("ts_me_" + sess.pkey); $("aErr").textContent = "Checking you in…";
    let { data, error } = await sb.rpc("checkin_again", { p_code: code, p_token: mine.token, p_device: DEV });
    if (missingFn(error)) ({ data, error } = await sb.rpc("checkin_again", { p_code: code, p_token: mine.token }));
    if (error && SERVER_SAYS.test(error.message)) return ($("aErr").textContent = error.message);
    if (error || !data) { $("aErr").textContent = ""; return openForm(); }
    done(data);
  });
  $("aNot").addEventListener("click", () => show("start"));

  // ---------- the form ----------
  TITLES.forEach(t => $("titles").insertAdjacentHTML("beforeend", `<input type="radio" name="title" id="t_${t}" value="${t}"><label for="t_${t}">${t}</label>`));
  function preview() {
    const t = document.querySelector("input[name=title]:checked")?.value || "", n = $("fName").value.trim().replace(/\s+/g, " ");
    $("prev").hidden = n.length < 3; $("prevName").textContent = fullName(t, n);
  }
  $("fName").addEventListener("input", preview); $("titles").addEventListener("change", preview);
  let stream = null, picked = null;
  const stopCam = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };
  async function openForm() {
    show("form");
    sb.rpc("mda_list", { p_code: code }).then(({ data }) => { if (Array.isArray(data)) $("mdaList").innerHTML = data.map(o => `<option value="${esc(o)}">`).join(""); });
    if (stream) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
      const v = $("video"); v.srcObject = stream; v.hidden = false; $("guide").removeAttribute("hidden"); $("camMsg").hidden = true; await v.play().catch(() => {});
    } catch { $("camMsg").textContent = "Camera not available"; $("pickLbl").hidden = false; }
  }
  $("fPhoto").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image(); img.onload = () => { picked = img; $("still").src = img.src; $("still").hidden = false; $("camMsg").hidden = true; }; img.src = URL.createObjectURL(f);
  });
  function snap() {
    const src = stream && $("video").videoWidth ? $("video") : picked; if (!src) return null;
    const w = src.videoWidth || src.naturalWidth, h = src.videoHeight || src.naturalHeight, s = Math.min(w, h);
    const c = document.createElement("canvas"); c.width = c.height = 480;
    const g = c.getContext("2d");
    if (src === $("video")) { g.translate(480, 0); g.scale(-1, 1); }
    g.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 480, 480);
    return c;
  }
  $("form").addEventListener("submit", async e => {
    e.preventDefault();
    const title = document.querySelector("input[name=title]:checked")?.value || "", name = $("fName").value.trim().replace(/\s+/g, " ");
    const email = $("fEmail").value.trim().toLowerCase(), org = $("fOrg").value.trim(), sex = document.querySelector("input[name=sex]:checked")?.value || "";
    if (!title) return ($("fErr").textContent = "Choose your title.");
    if (name.length < 3) return ($("fErr").textContent = "Enter your full name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ($("fErr").textContent = "Enter a valid email address.");
    if (!$("fConsent").checked) return ($("fErr").textContent = "Tick the box to agree to your photo and name being shown.");
    const c = snap(); if (!c) return ($("fErr").textContent = "We need your photo. Allow the camera, or tap Take photo instead.");
    $("fErr").textContent = "Checking you in…"; $("fGo").disabled = true;
    let photo = "";
    try {
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
      const path = `${code}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from("ts-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (!up.error) photo = sb.storage.from("ts-photos").getPublicUrl(path).data.publicUrl;
    } catch {}
    const args = { p_code: code, p_title: title, p_name: name, p_email: email, p_org: org, p_photo: photo };
    let { data, error } = await sb.rpc("checkin_v2", { p: { code, title, name, email, org, photo, device: DEV, sex } });
    if (missingFn(error)) ({ data, error } = await sb.rpc("checkin", { ...args, p_device: DEV }));
    if (missingFn(error)) ({ data, error } = await sb.rpc("checkin", args));
    $("fGo").disabled = false;
    if (error) return ($("fErr").textContent = SERVER_SAYS.test(error.message) ? error.message : "Couldn't check you in. Check the connection and try again.");
    if (stream) stream.getTracks().forEach(t => t.stop());
    done(data);
  });
  function done(d) {
    me = { token: d.token, participant: d.participant, title: d.title, name: d.name, organisation: d.organisation, photo: d.photo, arrived_at: d.arrived_at };
    store.set("ts_me_" + sess.pkey, { token: d.token, participant: d.participant, title: d.title, name: d.name, organisation: d.organisation, photo: d.photo });
    store.set("ts_in_" + code, { arrived_at: d.arrived_at });
    buzz([30, 40, 60]);
    openRoom(true);
  }

  // ---------- the room ----------
  async function openRoom(justIn) {
    show("room"); $("dock").hidden = false;
    $("rName").textContent = fullName(me.title, me.name);
    $("rPh").innerHTML = me.photo ? `<img src="${esc(me.photo)}" alt="">` : esc(initials(me.name));
    $("rIn").textContent = me.arrived_at ? "Checked in at " + fmtTime(me.arrived_at) : "";
    loadTime(); loadCert(); loadFocus();
    loadGroup();
    await loadItems(); render(false);
    if (channel) return;
    channel = sb.channel("ts-" + code, { config: { broadcast: { self: false }, presence: { key: crypto.randomUUID() } } });
    channel.on("broadcast", { event: "live" }, () => refreshLive());
    channel.on("broadcast", { event: "ended" }, () => sessionEnded());
    channel.on("broadcast", { event: "feedback" }, () => loadFeedback(true));
    channel.on("broadcast", { event: "eval" }, () => loadEval(true));
    channel.on("broadcast", { event: "certs" }, () => loadCert(true));
    channel.on("broadcast", { event: "groups" }, () => loadGroup(true));
    channel.on("broadcast", { event: "focus" }, () => loadFocus(true));
    channel.on("broadcast", { event: "namecheck" }, () => loadCert(true, true));
    channel.on("broadcast", { event: "picked" }, ({ payload }) => {
      if (payload?.grp) {
        if (payload.grp !== group) return;
        $("flyCard").innerHTML = `<span class="lbl" style="color:${TSGR.color(payload.grp)}">Spin the wheel</span><b style="font-family:var(--display);font-size:34px;line-height:1.05">🎯 Your group was picked!</b><p class="muted">${esc(payload.name || "")}, over to you.</p><button class="btn red" type="button" id="flyOk">OK</button>`;
        $("fly").hidden = false; buzz([80, 60, 80, 60, 200]); $("flyOk").onclick = () => ($("fly").hidden = true); return;
      }
      if (!payload || !(me.participant ? payload.participant === me.participant : payload.name === me.name)) return;
      $("flyCard").innerHTML = `<span class="lbl" style="color:var(--red)">Spin the wheel</span><b style="font-family:var(--display);font-size:34px;line-height:1.05">🎯 You've been picked!</b><p class="muted">Over to you, ${esc(String(me.name || "").split(" ")[0])}.</p><button class="btn red" type="button" id="flyOk">OK</button>`;
      $("fly").hidden = false; buzz([80, 60, 80, 60, 200]);
      $("flyOk").onclick = () => ($("fly").hidden = true);
      clearTimeout(fly.t); fly.t = setTimeout(() => ($("fly").hidden = true), 15000);
    });
    channel.on("broadcast", { event: "winner" }, ({ payload }) => { if (payload?.name) $("nowTxt").textContent = payload.name + " caught it first!"; });
    channel.on("broadcast", { event: "now" }, ({ payload }) => { $("nowTxt").textContent = payload?.label || "The session is on"; });
    channel.on("broadcast", { event: "share" }, async ({ payload }) => {
      if (payload && payload.target && payload.target !== "all" && group !== "all" && payload.target !== group) return;
      await loadItems(); render(true);
      const it = items.find(i => i.id === payload?.id); if (it) fly(it);
    });
    channel.subscribe(st => {
      const l = $("live"); l.hidden = false;
      if (st === "SUBSCRIBED") { l.classList.add("on"); l.lastElementChild.textContent = "Connected"; channel.track({ group, name: me.name }); if (justIn) channel.send({ type: "broadcast", event: "checkin", payload: {} }); }
      else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") { l.classList.remove("on"); l.lastElementChild.textContent = "Reconnecting…"; }
    });
    document.addEventListener("visibilitychange", async () => { if (!document.hidden) { await loadItems(); render(false); refreshLive(true); } });
    setInterval(() => { if (!document.hidden && !$("room").hidden) refreshLive(); }, 5000);
    setInterval(() => { if (!document.hidden) loadTime(); }, 60000);
    refreshLive(true); loadLearning(); loadPart(); loadFeedback(false); loadEval(false);
    if (sess.ended) sessionEnded();
  }
  async function loadItems() {
    const { data } = await sb.rpc("room_items", { p_code: code, p_token: me.token });
    items = Array.isArray(data) ? data : [];
  }
  const forMe = i => i.target === "all" || group === "all" || i.target === group;
  const seen = new Set(store.get("ts_seen_" + code) || []);
  function render(fresh) {
    const list = items.filter(forMe);
    $("items").innerHTML = list.length ? list.map(i => `<a class="item${fresh && !seen.has(i.id) ? " new" : ""}" href="${esc(i.url)}" target="_blank" rel="noopener">
        <span class="ic">${i.kind === "slide" ? `<img src="${esc(i.url)}" alt="">` : i.kind === "link" ? (/youtu\.?be/i.test(i.url) ? "▶" : "LINK") : esc((i.name.split(".").pop() || "FILE").slice(0, 4).toUpperCase())}</span>
        <span><b>${esc(i.name || "Item")}</b><small>${i.kind === "slide" ? (/^Board/.test(i.name) ? "Board" : "Slide") : i.kind === "link" ? "Link" : "File"} · ${fmtTime(i.at)}</small></span><span class="ok">Open</span></a>`).join("")
      : `<p class="muted">Nothing yet. When your facilitator shares a slide or a file, it lands here. Keep this page open.</p>`;
    list.forEach(i => seen.add(i.id)); store.set("ts_seen_" + code, [...seen].slice(-300));
  }
  function fly(i) {
    $("flyCard").innerHTML = `<span class="lbl" style="color:var(--red)">${i.kind === "slide" ? (/^Board/.test(i.name) ? "From the board" : "A slide for you") : i.kind === "link" ? "A link for you" : "A file for you"}</span>${i.kind === "slide" ? `<img src="${esc(i.url)}" alt="">` : ""}<b style="font-family:var(--display);font-size:20px">${esc(i.name)}</b><div class="row"><a class="btn red" href="${esc(i.url)}" target="_blank" rel="noopener">Open</a><button class="btn ghost" type="button" id="flyOk">Keep in My items</button></div>`;
    $("fly").hidden = false; buzz([30, 40, 60]);
    $("flyOk").onclick = () => ($("fly").hidden = true);
    clearTimeout(fly.t); fly.t = setTimeout(() => ($("fly").hidden = true), 20000);
  }
  // ---------- focus mode ----------
  let FOC = null, focOk = false, awayAt = 0, resUntil = 0, resTimer = null, focNote = "";
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const nice = s => s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${s % 60 ? (s % 60) + " s" : ""}`.trim();
  async function loadFocus(fresh) {
    if (!me) return;
    const { data, error } = await sb.rpc("my_focus", { p_code: code, p_token: me.token });
    if (error || !data) { FOC = null; drawFocus(); return; }
    const was = !!FOC; FOC = data.focus && data.focus.on && !ended ? data.focus : null; focOk = !!data.accepted;
    if (!FOC) { resUntil = 0; focNote = ""; }
    drawFocus(fresh && !was && FOC);
  }
  function drawFocus(alert) {
    const bar = $("focBar"), ask = $("focAsk");
    if (!FOC || ended) { bar.hidden = true; ask.hidden = true; return; }
    if (!focOk) {
      $("focCard").innerHTML = `<span class="lbl" style="color:#1F5FBF">🎯 Focus mode</span><h2 id="focT">Please stay on this page</h2>
        <p>Your facilitator has turned on Focus mode for this part of the session.</p>
        <ul><li>Keep Training Suite open on your phone.</li><li>If you leave it (another app, a chat, a call) for more than <b>${FOC.grace} seconds</b>, it's noted and your facilitator is told.</li>
          ${FOC.research ? `<li>Need to look something up? Use <b>🔎 Research</b>: you get ${FOC.research} minutes that don't count as leaving.</li>` : ""}<li>Locking your phone also counts as leaving.</li></ul>
        <button class="btn red" type="button" id="focYes">I accept</button>`;
      ask.hidden = false; if (alert) buzz([60, 40, 60]);
      $("focYes").onclick = async () => {
        $("focYes").disabled = true;
        const { error } = await sb.rpc("focus_event", { p_code: code, p_token: me.token, p_kind: "accept" });
        if (error) { $("focYes").disabled = false; return; }
        focOk = true; ask.hidden = true; channel?.send({ type: "broadcast", event: "focus_ok", payload: { participant: me.participant } }); drawFocus();
      };
      bar.hidden = true; return;
    }
    ask.hidden = true;
    const left = Math.max(0, Math.round((resUntil - Date.now()) / 1000));
    bar.innerHTML = `<b class="ft">🎯 Focus mode is on</b><span class="small">Stay on this page. Leaving for more than ${FOC.grace} seconds is noted.</span>
      ${focNote ? `<div class="warnline">${esc(focNote)}</div>` : ""}
      ${FOC.research ? (left ? `<span class="res">🔎 Research window: ${mmss(left)} left. Come back here when you're done.</span>`
        : `<div class="row"><input id="focQ" placeholder="Look something up…" enterkeyhint="search" aria-label="Search the web"><button class="btn ghost small" type="button" id="focGo">🔎 Research (${FOC.research} min)</button></div>`) : ""}`;
    bar.hidden = false;
    const go = async () => {
      const q = ($("focQ")?.value || "").trim();
      resUntil = Date.now() + FOC.research * 60000;
      sb.rpc("focus_event", { p_code: code, p_token: me.token, p_kind: "research" });
      channel?.send({ type: "broadcast", event: "focus_research", payload: { participant: me.participant, name: fullName(me.title, me.name), minutes: FOC.research } });
      window.open(q ? "https://www.google.com/search?q=" + encodeURIComponent(q) : "https://www.google.com/", "_blank", "noopener");
      clearInterval(resTimer); resTimer = setInterval(() => { if (Date.now() > resUntil) { clearInterval(resTimer); resUntil = 0; } drawFocus(); }, 1000);
      drawFocus();
    };
    $("focGo")?.addEventListener("click", go);
    $("focQ")?.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  }
  // Leaving and coming back: the page notices when it's hidden (another app, another tab, a locked screen).
  function focusAway(hidden) {
    if (!FOC || !focOk || ended || !me || !store.get("ts_in_" + code)) return;   // tapped out: not tracked
    const now = Date.now();
    if (hidden) {
      if (awayAt) return; awayAt = now;
      sb.rpc("focus_event", { p_code: code, p_token: me.token, p_kind: "out" });
      channel?.send({ type: "broadcast", event: "focus_out", payload: { participant: me.participant, name: fullName(me.title, me.name), research: now < resUntil, until: resUntil, grace: FOC.grace } });
    } else if (awayAt) {
      const total = Math.round((now - awayAt) / 1000), inRes = Math.max(0, Math.round((Math.min(now, resUntil) - awayAt) / 1000)), secs = Math.max(0, total - inRes);
      awayAt = 0;
      sb.rpc("focus_event", { p_code: code, p_token: me.token, p_kind: "back", p_secs: secs, p_research: inRes });
      channel?.send({ type: "broadcast", event: "focus_back", payload: { participant: me.participant, name: fullName(me.title, me.name), secs, research: inRes } });
      if (secs > FOC.grace) { focNote = `You were away from Training Suite for ${nice(secs)}. This has been noted and your facilitator has been told.`; buzz([80, 40, 80]); }
      drawFocus();
    }
  }
  document.addEventListener("visibilitychange", () => focusAway(document.hidden));
  addEventListener("pagehide", () => focusAway(true));

  // ---------- my group ----------
  let GRP = null;
  async function loadGroup(fresh) {
    if (!me) return;
    const { data, error } = await sb.rpc("my_group", { p_code: code, p_token: me.token });
    const box = $("grpBox");
    if (error || !data || !data.groups) { GRP = null; box.hidden = true; if (group !== "all") { group = "all"; render(false); } return; }
    const was = group; GRP = data; group = data.grp || "all";
    const cfg = data.groups, k = data.grp;
    if (k) {
      box.className = "grpbox"; box.style.setProperty("--gc", TSGR.color(k));
      box.innerHTML = `<span class="lbl">Your group</span><b class="gn">${esc(TSGR.name(cfg, k))}</b><span>${esc(TSGR.colorName(k))}${cfg.method === "choose" ? ` · <button type="button" class="btn ghost small" id="gChange" style="color:var(--ink)">Change</button>` : ""}</span>
        ${(data.mates || []).length ? `<span class="mates">With ${esc(data.mates.slice(0, 12).join(", "))}${data.mates.length > 12 ? ` and ${data.mates.length - 12} more` : ""}</span>` : ""}`;
      $("gChange")?.addEventListener("click", () => chooser(cfg));
    } else if (cfg.method === "choose") chooser(cfg);
    else { box.className = "grpbox pick"; box.innerHTML = `<span class="lbl">Groups</span><span>You'll be placed in a group in a moment.</span>`; }
    box.hidden = false;
    channel?.track({ group, name: me?.name });
    if (fresh && k && k !== was) {
      buzz([60, 50, 60, 50, 160]);
      $("flyCard").innerHTML = `<span class="lbl" style="color:${TSGR.color(k)}">Groups</span><b style="font-family:var(--display);font-size:34px;line-height:1.05;color:${TSGR.color(k)}">You're in ${esc(TSGR.name(cfg, k))}</b><p class="muted">${esc(TSGR.colorName(k))}. Find your group in the room.</p><button class="btn red" type="button" id="flyOk">OK</button>`;
      $("fly").hidden = false; $("flyOk").onclick = () => ($("fly").hidden = true);
    }
    if (was !== group) render(false);
  }
  function chooser(cfg) {
    const box = $("grpBox"); box.className = "grpbox pick"; box.hidden = false;
    box.innerHTML = `<span class="lbl">Pick your group</span><div class="gchoose">${TSGR.keys(cfg).map(k => `<button type="button" data-g="${k}" style="background:${TSGR.color(k)}">${esc(TSGR.name(cfg, k))}</button>`).join("")}</div><span class="err" id="gErr"></span>`;
    box.querySelectorAll("[data-g]").forEach(b => b.addEventListener("click", async () => {
      const { error } = await sb.rpc("choose_group", { p_code: code, p_token: me.token, p_grp: b.dataset.g });
      if (error) return ($("gErr").textContent = error.message);
      buzz(30); loadGroup(); channel?.send({ type: "broadcast", event: "checkin", payload: {} });
    }));
  }

  // ---------- live activities ----------
  const LET = "ABCDEF", COL = ["#F4B400", "#3FB98A", "#5AA9E6", "#F2786F", "#B48EF0", "#F0A35E"];
  const NAMES = { poll: "Live poll", words: "Word cloud", quiz: "Quiz", buzz: "First to catch", battle: "Group battle", order: "Order it", match: "Match it", spot: "Spot the error", case: "Case study", exit: "Exit ticket", test: "Test", finger: "Finger vote", short: "Short answer", scale: "Rating", feedback: "Feedback" };
  let cur = null, lastKey = "", draft = null, deadline = 0, sending = false, lastRun = "";
  async function refreshLive(force) {
    if (!me) return;
    const { data } = await sb.rpc("room_current", { p_code: code, p_token: me.token });
    if (!data) return;
    const key = data.phase === "idle" ? "idle" : [data.activity, data.run, data.step, data.phase, data.mine ? 1 : 0].join("|");
    if (key === lastKey && !force) return;
    const moved = !cur || data.activity !== cur.activity || data.run !== cur.run || data.step !== cur.step;
    if (lastRun === "post" && (data.run !== "post" || data.phase !== "open")) loadLearning();
    lastRun = data.phase === "idle" ? "" : data.run;
    lastKey = key; cur = data;
    if (data.phase === "reveal" || data.phase === "idle") loadPart();
    if (moved || data.phase !== "open") draft = null;
    deadline = data.phase === "open" && data.left != null ? Date.now() + data.left * 1000 : 0;
    if (moved && data.phase === "open") buzz(30);
    drawAct();
  }
  const testName = c => c.kind === "test" ? (c.run === "pre" ? "Pre-test" : "Post-test") : (c.title || NAMES[c.kind]);
  function drawAct() {
    const box = $("act");
    if (!cur || cur.phase === "idle") { box.hidden = true; box.innerHTML = ""; return; }
    const c = cur, q = c.q || {}, mine = c.mine, open = c.phase === "open" && !mine, rev = c.phase === "reveal";
    let body = "";
    if (c.kind === "case" && q.text) body += `<div class="case">${esc(q.text)}</div>`;
    if (open) body += answerUi(c, q);
    else if (!rev) body += mine ? `<p class="res">Answer sent ✓</p><p class="muted">${c.kind === "buzz" ? "Fingers crossed. Watch the screen." : "Watch the screen for the results."}</p>${mineView(c, q, mine)}` : `<p class="res bad">Time's up</p><p class="muted">Answers are closed for this question.</p>`;
    else body += revealView(c, q, mine);
    const step = c.steps > 1 ? `${c.step + 1} of ${c.steps}` : "";
    box.innerHTML = `<div class="ah"><span class="lbl" style="color:var(--red)">${esc(testName(c))}</span><span class="small muted" style="font-family:var(--mono)">${step}<span id="tLeft"></span></span></div>
      ${deadline && open ? `<div class="tm" id="tm"><i></i></div>` : ""}<h2>${esc(q.q || "")}</h2>${body}<div class="err" id="actErr" role="alert"></div>`;
    box.hidden = false;
    wireAnswer(c, q);
  }
  setInterval(() => {
    const tm = $("tm"); if (!tm || !deadline || !cur) return;
    const left = Math.max(0, deadline - Date.now()), total = (cur.seconds || 1) * 1000;
    tm.firstElementChild.style.transform = `scaleX(${left / total})`; tm.classList.toggle("low", left < 5000);
    const t = $("tLeft"); if (t) t.textContent = ` · ${Math.ceil(left / 1000)}s`;
    if (left <= 0) { deadline = 0; setTimeout(() => refreshLive(true), 1200); }
  }, 250);
  function answerUi(c, q) {
    const k = c.kind;
    if (k === "finger") return `<p class="res">✋ Raise your hand</p><p class="muted">Hold your hand up high, facing the screen, with:</p><div class="ord">${(q.options || []).map((o, i) => `<div style="grid-template-columns:44px 1fr"><b style="font-size:22px;color:var(--ink)">${i + 1}</b><span>${i + 1} finger${i ? "s" : ""} = ${esc(o)}</span></div>`).join("")}</div>`;
    if (q.options) return `<div class="ch">${q.options.map((o, i) => `<button type="button" data-i="${i}"><span class="let" style="background:${COL[i]}">${LET[i]}</span><span>${esc(o)}</span></button>`).join("")}</div>
      ${c.teams && group === "all" ? `<p class="small muted">You're not in a group yet, so your points count for you only.</p>` : ""}`;
    if (k === "short") return `<input class="wi" id="aShort" maxlength="120" placeholder="Your answer" autocomplete="off"><button class="btn red" type="button" id="aSend">Send</button>`;
    if (k === "scale") { const lo = +q.min || 0, hi = +q.max || 10, mid = Math.round((lo + hi) / 2); return `<div class="sc"><output id="scOut">${mid}</output><input type="range" id="aScale" min="${lo}" max="${hi}" step="1" value="${mid}" aria-label="Your rating"><div class="scends"><span>${esc(q.low || lo)}</span><span>${esc(q.high || hi)}</span></div></div><button class="btn red" type="button" id="aSend">Send</button>`; }
    if (k === "feedback") return `<div class="stars5" id="stars5" role="radiogroup" aria-label="Stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-st="${n}" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div><textarea id="aText" rows="3" maxlength="600" placeholder="Anything to add? (optional)"></textarea><button class="btn red" type="button" id="aSend" disabled>Send</button>`;
    if (k === "words") return `${Array.from({ length: q.max || 1 }, (_, i) => `<input class="wi" maxlength="40" data-w="${i}" placeholder="${(q.max || 1) > 1 ? "Answer " + (i + 1) : "One or two words"}" autocomplete="off">`).join("")}<button class="btn red" type="button" id="aSend">Send</button>`;
    if (k === "order") { draft = draft || [...q.items]; return `<p class="small muted">Use the arrows to put them in the right order, top first.</p><div class="ord" id="ord">${ordRows()}</div><button class="btn red" type="button" id="aSend">Send my order</button>`; }
    if (k === "match") return `<div class="mt">${q.lefts.map((l, i) => `<label>${esc(l)}<select data-m="${i}"><option value="">Choose…</option>${q.rights.map(r => `<option>${esc(r)}</option>`).join("")}</select></label>`).join("")}</div><button class="btn red" type="button" id="aSend">Send my matches</button>`;
    if (k === "spot") return `<p class="small muted">Tap where the error is, then send.</p><div class="sp" id="sp"><img src="${esc(q.image)}" alt="Find the error">${draft ? `<span class="dot" style="left:${draft.x * 100}%;top:${draft.y * 100}%"></span>` : ""}</div><button class="btn red" type="button" id="aSend" ${draft ? "" : "disabled"}>Send my tap</button>`;
    return `<textarea id="aText" rows="${k === "case" ? 6 : 4}" maxlength="1500" placeholder="${k === "exit" ? "One thing I'll apply at my desk…" : "Your answer…"}"></textarea>${c.teams && group === "all" ? `<p class="small muted">You're not in a group yet, so this answer is yours alone.</p>` : ""}<button class="btn red" type="button" id="aSend">Send</button>`;
  }
  const ordRows = () => draft.map((it, i) => `<div><b>${i + 1}</b><span>${esc(it)}</span><button type="button" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button type="button" data-dn="${i}" ${i === draft.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button></div>`).join("");
  function wireAnswer(c, q) {
    const box = $("act");
    box.querySelectorAll(".ch button[data-i]").forEach(b => b.addEventListener("click", () => send({ i: +b.dataset.i })));
    if ($("aScale")) $("aScale").addEventListener("input", e => ($("scOut").textContent = e.target.value));
    if ($("stars5")) $("stars5").addEventListener("click", e => { const b = e.target.closest("[data-st]"); if (!b) return; draft = +b.dataset.st; $("stars5").querySelectorAll("button").forEach(x => { const on = +x.dataset.st <= draft; x.classList.toggle("on", on); x.setAttribute("aria-checked", +x.dataset.st === draft); }); $("aSend").disabled = false; });
    const ord = $("ord");
    if (ord) ord.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const i = +(b.dataset.up ?? b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1;
      [draft[i], draft[j]] = [draft[j], draft[i]]; ord.innerHTML = ordRows();
    });
    const sp = $("sp");
    if (sp) sp.addEventListener("click", e => { const r = sp.getBoundingClientRect(); draft = { x: +((e.clientX - r.left) / r.width).toFixed(4), y: +((e.clientY - r.top) / r.height).toFixed(4) }; drawAct(); });
    const go = $("aSend"); if (!go) return;
    go.addEventListener("click", () => {
      const k = c.kind, err = $("actErr");
      if (k === "words") { const words = [...box.querySelectorAll("[data-w]")].map(i => i.value.trim()).filter(Boolean); if (!words.length) return (err.textContent = "Type a word or two."); return send({ words }); }
      if (k === "order") return send({ items: draft });
      if (k === "match") { const rights = [...box.querySelectorAll("[data-m]")].map(s => s.value); if (rights.some(x => !x)) return (err.textContent = "Match every item first."); return send({ rights }); }
      if (k === "spot") return draft && send({ x: draft.x, y: draft.y });
      if (k === "short") { const t = $("aShort").value.trim(); if (!t) return (err.textContent = "Type your answer first."); return send({ text: t }); }
      if (k === "scale") return send({ v: +$("aScale").value });
      if (k === "feedback") { if (!draft) return (err.textContent = "Tap the stars first."); return send({ stars: draft, text: ($("aText").value || "").trim() }); }
      const text = $("aText").value.trim(); if (!text) return (err.textContent = "Write your answer first."); send({ text });
    });
  }
  async function send(answer) {
    if (sending) return; sending = true;
    $("act").querySelectorAll("button").forEach(b => (b.disabled = true));
    const { data, error } = await sb.rpc("submit_answer", { p_code: code, p_token: me.token, p_grp: group, p_answer: answer });
    sending = false;
    if (error) {
      if (/already answered|closed|Time is up/i.test(error.message)) return refreshLive(true);
      $("act").querySelectorAll("button").forEach(b => (b.disabled = false));
      const e = $("actErr"); if (e) e.textContent = "Couldn't send. Check the connection and try again."; return;
    }
    buzz(data?.rank === 1 ? [40, 60, 40, 60, 120] : 40);
    setTimeout(loadPart, 400);
    channel?.send({ type: "broadcast", event: "answered", payload: {} });
    cur = { ...cur, mine: { answer, score: data?.score, points: data?.points, rank: data?.rank } };
    lastKey = [cur.activity, cur.run, cur.step, cur.phase, 1].join("|");
    drawAct();
  }
  function mineView(c, q, mine) {
    const a = mine.answer || {};
    if (a.i != null && q.options) return `<div class="ch">${q.options.map((o, i) => `<button type="button" disabled class="${i === a.i ? "mine" : "wrong"}"><span class="let" style="background:${COL[i]}">${LET[i]}</span><span>${esc(o)}</span></button>`).join("")}</div>`;
    if (a.words) return `<p><b>${a.words.map(esc).join(" · ")}</b></p>`;
    if (a.v != null) return `<p class="res">${esc(a.v)}<span class="muted" style="font-size:16px"> on the scale</span></p>`;
    if (a.stars) return `<p class="res" style="color:var(--yellow)">${"★".repeat(a.stars)}</p>${a.text ? `<p class="case">${esc(a.text)}</p>` : ""}`;
    if (a.text) return `<p class="case">${esc(a.text)}</p>`;
    return "";
  }
  function revealView(c, q, mine) {
    const a = mine?.answer || {}, scored = mine && mine.score != null;
    let head = !mine ? `<p class="muted">You didn't answer this one.</p>` : scored ? (+mine.score === 1 ? `<p class="res good">Correct! +${mine.points} points</p>` : +mine.score > 0 ? `<p class="res">${Math.round(mine.score * 100)}% right · +${mine.points} points</p>` : `<p class="res bad">Not quite</p>`) : `<p class="res">Thanks for answering</p><p class="muted">The results are on the screen.</p>`;
    if (q.options && q.correct != null) return head + `<div class="ch">${q.options.map((o, i) => `<button type="button" disabled class="${i === q.correct ? "right" : ""} ${i === a.i ? "mine" : i !== q.correct ? "wrong" : ""}"><span class="let" style="background:${COL[i]}">${LET[i]}</span><span>${esc(o)}${i === q.correct ? " ✓" : ""}</span></button>`).join("")}</div>`;
    if (q.accept) return head + `<p class="small muted">Accepted answer${q.accept.length > 1 ? "s" : ""}</p><p><b>${q.accept.map(esc).join(" · ")}</b></p>${a.text ? `<p class="small muted">You wrote: ${esc(a.text)}</p>` : ""}`;
    if (q.answer_items) return head + `<p class="small muted">The right order</p><div class="ord">${q.answer_items.map((it, i) => `<div style="grid-template-columns:28px 1fr"><b>${i + 1}</b><span>${esc(it)}${a.items && a.items[i] === it ? " ✓" : ""}</span></div>`).join("")}</div>`;
    if (q.answer_pairs) return head + `<div class="ord">${q.answer_pairs.map((p, i) => `<div style="grid-template-columns:1fr"><span>${esc(p.l)} → <b>${esc(p.r)}</b>${a.rights && a.rights[i] === p.r ? " ✓" : ""}</span></div>`).join("")}</div>`;
    if (q.region) return head + `<div class="sp"><img src="${esc(q.image)}" alt=""><span class="tgt" style="left:${q.region.x * 100}%;top:${q.region.y * 100}%;width:${q.region.r * 2 / (q.aspect || 1) * 100}%;aspect-ratio:1"></span>${a.x != null ? `<span class="dot" style="left:${a.x * 100}%;top:${a.y * 100}%"></span>` : ""}</div>`;
    return head + (mine ? mineView(c, q, mine) : "");
  }

  // ---------- session evaluation ----------
  let EV = null, evThen = false;
  async function loadEval(fresh) {
    if (!me) return;
    const { data } = await sb.rpc("my_evaluation", { p_code: code, p_token: me.token });
    EV = data || null;
    const box = $("evCard");
    if (!EV || EV.mode === "none" || (!EV.open && !EV.done)) { box.hidden = true; return; }
    box.innerHTML = EV.done ? `<span class="lbl">Session evaluation</span><b>✓ Sent. Thank you!</b><span class="small muted">Your answers help make the next session better.</span>`
      : `<span class="lbl" style="color:var(--red)">Session evaluation</span><b>How did this session go for you?</b><span class="small muted">About 2 minutes${EV.anonymous ? " · anonymous: your name is not shown to the facilitator" : ""}.</span><button class="btn red" type="button" id="evGo">Start the evaluation</button>`;
    box.classList.toggle("done", !!EV.done); box.hidden = false;
    $("evGo")?.addEventListener("click", () => openEval(false));
    if (fresh && !EV.done) { buzz([30, 40, 60]); box.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  function openEval(thenTapOut) {
    evThen = thenTapOut;
    const items = TSE.formFor(EV, EV), groups = {};
    items.forEach(i => (groups[i.sec] = groups[i.sec] || []).push(i));
    const scale = i => i.type === "stars"
      ? `<div class="evstars" role="radiogroup" aria-label="${esc(i.text)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-ev="${esc(i.id)}" data-v="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div>`
      : `<div class="evscale" role="radiogroup" aria-label="${esc(i.text)}">${TSE.SCALES[i.type].map((l, k) => `<button type="button" data-ev="${esc(i.id)}" data-v="${k + 1}"><b>${k + 1}</b><span>${esc(l)}</span></button>`).join("")}</div>`;
    $("evalSec").innerHTML = `<div class="evhead"><span class="lbl" style="color:var(--red)">Session evaluation</span><h2>${esc(sess.topic)}</h2>
        <p class="muted small">${thenTapOut ? "Before you go: about 2 minutes. " : ""}${EV.anonymous ? "Anonymous: the facilitator sees the results, not your name." : "Your name is shown with your answers."}</p></div>
      ${Object.entries(groups).map(([sec, list]) => `<fieldset class="evgrp"><legend>${esc(TSE.SEC[sec] || TSE.SEC.other)}</legend>${list.map(i => `<div class="evq" data-q="${esc(i.id)}"><p>${esc(i.text)}</p>${i.type === "text" ? `<textarea data-evt="${esc(i.id)}" rows="3" maxlength="800" placeholder="Optional"></textarea>` : scale(i)}</div>`).join("")}</fieldset>`).join("")}
      <div class="err" id="evErr" role="alert"></div>
      <div class="evfoot"><button class="btn red" type="button" id="evSend">${thenTapOut ? "Send and tap out" : "Send my evaluation"}</button><button class="btn ghost" type="button" id="evSkip">${thenTapOut ? "Skip and tap out" : "Not now"}</button></div>`;
    const ans = {};
    $("evalSec").querySelectorAll("[data-ev]").forEach(b => b.addEventListener("click", () => {
      ans[b.dataset.ev] = +b.dataset.v;
      b.parentNode.querySelectorAll("button").forEach(x => x.classList.toggle("on", b.parentNode.classList.contains("evstars") ? +x.dataset.v <= +b.dataset.v : x === b));
      b.closest(".evq").classList.remove("miss");
    }));
    $("evSkip").addEventListener("click", () => { show("room"); $("dock").hidden = ended; if (evThen) doTapOut(); });
    $("evSend").addEventListener("click", async () => {
      $("evalSec").querySelectorAll("[data-evt]").forEach(t => { if (t.value.trim()) ans[t.dataset.evt] = t.value.trim(); });
      const missing = items.filter(i => i.type !== "text" && !ans[i.id]);
      if (missing.length) { missing.forEach(i => $("evalSec").querySelector(`[data-q="${CSS.escape(i.id)}"]`)?.classList.add("miss")); $("evErr").textContent = `Answer ${missing.length === 1 ? "the question" : "the " + missing.length + " questions"} marked in red.`; $("evalSec").querySelector(".evq.miss")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      $("evSend").disabled = true; $("evErr").textContent = "";
      const { error } = await sb.rpc("submit_evaluation", { p_code: code, p_token: me.token, p_answers: ans });
      $("evSend").disabled = false;
      if (error) { $("evErr").textContent = "Couldn't send. Check the connection and try again."; return; }
      channel?.send({ type: "broadcast", event: "evaluated", payload: {} });
      EV.done = true; buzz([30, 40, 60]);
      show("room"); $("dock").hidden = ended; loadEval(false); scrollTo({ top: 0 });
      if (evThen) doTapOut();
    });
    show("evalSec"); $("dock").hidden = true; scrollTo({ top: 0 });
  }

  // ---------- AI feedback on case study answers ----------
  async function loadFeedback(fresh) {
    if (!me) return;
    const { data } = await sb.rpc("my_feedback", { p_code: code, p_token: me.token });
    const list = Array.isArray(data) ? data : [], box = $("fb");
    if (!list.length) { box.hidden = true; return; }
    box.innerHTML = `<span class="lbl">✨ Feedback for you</span>${list.map(f => `<div class="fbi"><small>${esc(f.title || "Case study")}${f.q ? " · " + esc(f.q) : ""}</small><p>${esc(f.feedback)}</p></div>`).join("")}`;
    box.hidden = false;
    if (fresh) { buzz([30, 40, 60]); box.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }

  // ---------- participation (step 2) ----------
  async function loadPart() {
    if (!me) return;
    const { data } = await sb.rpc("my_participation", { p_code: code, p_token: me.token });
    const box = $("part");
    if (!data || !data.runs) { box.hidden = true; return; }
    box.innerHTML = `<span class="lbl">Your participation</span>
      <div class="pp3"><div><b>${data.taken}<small>/${data.runs}</small></b><span>activities</span></div><div><b>${(data.points || 0).toLocaleString()}</b><span>points</span></div><div><b>${data.rank}<small>/${data.of}</small></b><span>rank</span></div></div>
      <div class="bar"><i style="width:${data.rate}%"></i></div>`;
    box.hidden = false;
  }

  // ---------- learning achievement (after the post-test) ----------
  async function loadLearning() {
    if (!me) return;
    const { data } = await sb.rpc("my_learning", { p_code: code, p_token: me.token });
    const box = $("learn");
    if (!data || !data.took_post) { box.hidden = true; return; }
    const pre = data.took_pre ? +data.pre : null, post = +data.post;
    const ach = pre == null ? null : pre >= 100 ? (post >= 100 ? 1 : (post - 100) / 100) : (post - pre) / (100 - pre);
    const msg = ach == null ? "You didn't take the pre-test, so we can't measure your progress this time." : ach >= 0.75 ? "Outstanding progress." : ach >= 0.5 ? "Strong progress." : ach > 0 ? "You moved forward. Keep practising." : "Talk to your facilitator about the topics you found hard.";
    box.innerHTML = `<span class="lbl">Your learning achievement</span><span class="big">${ach == null ? post + "%" : Math.round(ach * 100) + "%"}</span>
      ${ach != null ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, ach * 100))}%"></i></div>` : ""}
      <div class="pp"><div><span class="small" style="color:#C9CEC6">Pre-test</span><b>${pre == null ? "–" : pre + "%"}</b></div><div><span class="small" style="color:#C9CEC6">Post-test</span><b>${post}%</b></div></div>
      <span>${esc(msg)}</span><span class="small" style="color:#9AA0A8">Achievement = (post − pre) ÷ (100 − pre): how much of your room for improvement you closed.</span>`;
    if (box.hidden) buzz([30, 40, 60]);
    box.hidden = false;
  }

  // ---------- certificate: check the name, then download ----------
  let CERT = null;
  async function loadCert(fresh, ask) {
    if (!me || !window.TSC) return;
    const { data, error } = await sb.rpc("my_certificate", { p_code: code, p_token: me.token });
    const box = $("certCard");
    if (error || !data || !data.on) { box.hidden = true; return; }
    const had = CERT && CERT.cert; CERT = data;
    const nm = fullName(data.title, data.name);
    box.classList.toggle("got", !!data.cert);
    if (data.cert) {
      box.innerHTML = `<span class="lbl" style="color:#9A7417">🎓 Your certificate</span><canvas id="certCv" aria-label="Your certificate"></canvas>
        <div class="row"><button class="btn red" type="button" id="certDl">Download PDF</button><a class="small" href="${esc(TSC.verifyUrl(data.cert.number))}" target="_blank" rel="noopener">Check it: ${esc(data.cert.number)}</a></div>
        <span class="err" id="certErr" role="alert"></span>`;
      box.hidden = false;
      const w = Math.round((box.clientWidth || 340) * Math.min(2, window.devicePixelRatio || 1));
      TSC.render(data.cert.design, TSC.dataOf(data.cert), w).then(c => { const cv = $("certCv"); if (!cv) return; cv.width = c.width; cv.height = c.height; cv.getContext("2d").drawImage(c, 0, 0); });
      $("certDl").onclick = async () => {
        const b = $("certDl"); b.disabled = true; b.textContent = "Making your PDF…";
        try { await TSC.pdf([{ design: data.cert.design, data: TSC.dataOf(data.cert) }], `${TSC.fileName(data.cert.name)} - certificate.pdf`); sb.rpc("cert_downloaded", { p_code: code, p_token: me.token }); }
        catch (e) { $("certErr").textContent = e.message || "Couldn't make the PDF. Try again."; }
        b.disabled = false; b.textContent = "Download PDF";
      };
      if (fresh && !had) { buzz([40, 60, 40, 60, 160]); box.classList.add("pulse"); box.scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }
    if (!data.last_session) { box.hidden = true; return; }
    if (data.confirmed && !ask) {
      box.innerHTML = `<span class="lbl" style="color:#9A7417">🎓 Certificate</span><span>Name confirmed: <b>${esc(nm)}</b>. Your certificate is issued when the programme ends, and you download it here.</span>
        <button class="btn ghost small" type="button" id="certFix" style="align-self:flex-start">Change the name</button>`;
      box.hidden = false; $("certFix").onclick = () => nameForm(data); return;
    }
    box.innerHTML = `<span class="lbl" style="color:#9A7417">🎓 Your name on the certificate</span><span class="nm">${esc(nm)}</span>
      <span class="small muted">Check the spelling and your title. This is exactly how it will be printed.</span>
      <div class="row"><button class="btn red" type="button" id="certOk">✓ Correct</button><button class="btn ghost" type="button" id="certFix">Fix it</button></div><span class="err" id="certErr" role="alert"></span>`;
    box.hidden = false;
    if (ask) { box.classList.remove("pulse"); void box.offsetWidth; box.classList.add("pulse"); buzz([30, 40, 60]); box.scrollIntoView({ behavior: "smooth", block: "center" }); }
    $("certOk").onclick = () => saveName(data.title, data.name);
    $("certFix").onclick = () => nameForm(data);
  }
  function nameForm(data) {
    const box = $("certCard");
    box.innerHTML = `<span class="lbl" style="color:#9A7417">🎓 Fix your name</span>
      <div class="titles" id="cTitles">${TITLES.map(t => `<input type="radio" name="ctitle" id="ct_${t}" value="${t}" ${data.title === t ? "checked" : ""}><label for="ct_${t}">${t}</label>`).join("")}</div>
      <label class="fld" for="cName">Full name<input id="cName" value="${esc(data.name)}" autocomplete="name"></label>
      <div class="certprev"><span>On your certificate</span><b id="cPrev">${esc(fullName(data.title, data.name))}</b></div>
      <div class="row"><button class="btn red" type="button" id="cSave">Save name</button><button class="btn ghost" type="button" id="cCancel">Cancel</button></div><span class="err" id="certErr" role="alert"></span>`;
    const pv = () => { $("cPrev").textContent = fullName(document.querySelector("input[name=ctitle]:checked")?.value || "", $("cName").value.trim().replace(/\s+/g, " ")); };
    $("cName").addEventListener("input", pv); $("cTitles").addEventListener("change", pv); $("cName").focus();
    $("cCancel").onclick = () => loadCert();
    $("cSave").onclick = () => saveName(document.querySelector("input[name=ctitle]:checked")?.value || "", $("cName").value);
  }
  async function saveName(title, name) {
    name = String(name || "").trim().replace(/\s+/g, " ");
    if (name.length < 3) return ($("certErr").textContent = "Enter your full name.");
    const { data, error } = await sb.rpc("confirm_cert_name", { p_code: code, p_token: me.token, p_title: title, p_name: name });
    if (error) return ($("certErr").textContent = /issued|full name/i.test(error.message) ? error.message : "Couldn't save. Check the connection and try again.");
    me.title = data.title; me.name = data.name; $("rName").textContent = fullName(me.title, me.name);
    const st = store.get("ts_me_" + sess.pkey); if (st) store.set("ts_me_" + sess.pkey, { ...st, title: data.title, name: data.name });
    buzz(30); loadCert();
  }

  // ---------- tap out ----------
  $("outBtn").addEventListener("click", async () => {
    const b = $("outBtn");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to tap out"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Tap out"; }, 4000); return; }
    b.dataset.sure = ""; b.textContent = "Tap out";
    // Ask for the evaluation first, if the facilitator wants it at tap-out and it isn't done yet.
    if (EV && EV.mode !== "none" && EV.at_tapout && !EV.done) { openEval(true); return; }
    doTapOut();
  });
  async function doTapOut() {
    const b = $("outBtn"); b.disabled = true;
    const { error } = await sb.rpc("tap_out", { p_code: code, p_token: me.token });
    b.disabled = false; b.dataset.sure = ""; b.textContent = "Tap out";
    if (error && !/Already/.test(error.message)) return note("Couldn't tap you out. Check the connection and try again.");
    channel?.send({ type: "broadcast", event: "checkin", payload: {} });
    store.set("ts_in_" + code, null);
    $("dock").hidden = true; show("bye"); buzz(40); loadTime();
  }
  $("byeRoom").addEventListener("click", () => { show("room"); });
  $("byeBack").addEventListener("click", async () => {
    $("byeErr").textContent = "Checking you back in…";
    let { data, error } = await sb.rpc("checkin_again", { p_code: code, p_token: me.token, p_device: DEV });
    if (missingFn(error)) ({ data, error } = await sb.rpc("checkin_again", { p_code: code, p_token: me.token }));
    if (error || !data) return ($("byeErr").textContent = error && SERVER_SAYS.test(error.message) ? error.message : "Couldn't check you back in. Try again.");
    $("byeErr").textContent = "";
    store.set("ts_in_" + code, { arrived_at: data.arrived_at });
    channel?.send({ type: "broadcast", event: "checkin", payload: {} });
    show("room"); $("dock").hidden = false; buzz([30, 40, 60]); loadTime();
  });

  // ---------- time spent, and the end of the session ----------
  let ended = false;
  async function loadTime() {
    if (!me) return;
    const { data } = await sb.rpc("my_attendance", { p_code: code, p_token: me.token });
    if (!data) return;
    const away = data.away_seconds ? ` · ${hm(data.away_seconds)} away` : "";
    const line = `Checked in at ${fmtTime(data.arrived_at)} · ${hm(data.spent_seconds)} in the session${away}`;
    $("rIn").textContent = line;
    $("byeTime").textContent = `Time in the session: ${hm(data.spent_seconds)}${away}. You can check back in any time before the session ends.`;
    if (data.ended && !ended) sessionEnded(data);
  }
  async function sessionEnded(d) {
    ended = true;
    if (!d) { const r = await sb.rpc("my_attendance", { p_code: code, p_token: me.token }); d = r.data || {}; }
    const ps = await sb.rpc("public_session", { p_code: code }); if (ps.data) sess = ps.data;
    $("dock").hidden = true; $("act").hidden = true; show("room");
    $("endBox").hidden = false;
    $("endBox").innerHTML = `<span class="lbl" style="color:var(--yellow)">Session ended</span><b>Thank you for taking part</b>
      ${d.spent_seconds != null ? `<div class="pp"><div><span class="small">Time in the session</span><b>${hm(d.spent_seconds)}</b></div><div><span class="small">Time away</span><b>${hm(d.away_seconds || 0)}</b></div></div>` : ""}
      <span class="small" style="color:#C9CEC6">Your items stay on this page${sess.closes_at ? " until " + new Date(sess.closes_at).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) : ""}.</span>`;
    $("nowTxt").textContent = "The session has ended";
    FOC = null; drawFocus();
    loadLearning(); loadPart(); loadEval(true); loadCert(); buzz([30, 40, 60]);
  }

  boot();
})();
