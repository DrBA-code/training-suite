// Participant's phone: check in (or one-tap check in again), then the session room; tap out at the end.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const cfg = window.TS_CONFIG || {};
  const sb = window.supabase && cfg.SUPABASE_URL ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const LOGO = s => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true"><rect x="3" y="20" width="32" height="32" fill="#2747C8" transform="rotate(8 19 36)"/><rect x="13" y="24" width="32" height="32" fill="#F4B400" transform="rotate(-3 29 40)"/><g transform="rotate(-7 42 22)"><rect x="26" y="6" width="32" height="32" fill="#D2391F"/><text x="42" y="28.5" text-anchor="middle" font-family="Sora, sans-serif" font-weight="800" font-size="14" fill="#FFFFFF">TS</text></g></svg>`;
  document.querySelectorAll("[data-logo]").forEach(el => el.insertAdjacentHTML("afterbegin", LOGO(+el.dataset.logo)));
  const code = location.hash.replace("#", "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const TITLES = ["Prof", "Dr", "Engr", "Mr", "Mrs", "Miss", "Ms"];
  const fullName = (t, n) => (t ? (t === "Miss" || t === "Ms" ? t + " " : t + ". ") : "") + n;
  const initials = n => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const fmtTime = t => t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  let sess = null, me = null, channel = null, items = [], group = "all";
  const show = which => ["again", "form", "room", "bye"].forEach(id => ($(id).hidden = id !== which));
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
    group = store.get("ts_group_" + code) || "all";
    const here = store.get("ts_in_" + code), mine = store.get("ts_me_" + sess.pkey);
    if (here && mine) { me = { ...mine, arrived_at: here.arrived_at }; return openRoom(); }
    if (!sess.open) return note("This session has ended. Check-in is closed.");
    if (mine) { $("aName").textContent = fullName(mine.title, mine.name); $("aPh").innerHTML = mine.photo ? `<img src="${esc(mine.photo)}" alt="">` : esc(initials(mine.name)); return show("again"); }
    openForm();
  }

  // ---------- one tap for returning people ----------
  $("aGo").addEventListener("click", async () => {
    const mine = store.get("ts_me_" + sess.pkey); $("aErr").textContent = "Checking you in…";
    const { data, error } = await sb.rpc("checkin_again", { p_code: code, p_token: mine.token });
    if (error || !data) { $("aErr").textContent = ""; return openForm(); }
    done(data);
  });
  $("aNot").addEventListener("click", openForm);

  // ---------- the form ----------
  TITLES.forEach(t => $("titles").insertAdjacentHTML("beforeend", `<input type="radio" name="title" id="t_${t}" value="${t}"><label for="t_${t}">${t}</label>`));
  function preview() {
    const t = document.querySelector("input[name=title]:checked")?.value || "", n = $("fName").value.trim().replace(/\s+/g, " ");
    $("prev").hidden = n.length < 3; $("prevName").textContent = fullName(t, n);
  }
  $("fName").addEventListener("input", preview); $("titles").addEventListener("change", preview);
  let stream = null, picked = null;
  async function openForm() {
    show("form");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
      const v = $("video"); v.srcObject = stream; v.hidden = false; $("camMsg").hidden = true; await v.play().catch(() => {});
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
    const email = $("fEmail").value.trim().toLowerCase(), org = $("fOrg").value.trim();
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
    const { data, error } = await sb.rpc("checkin", { p_code: code, p_title: title, p_name: name, p_email: email, p_org: org, p_photo: photo });
    $("fGo").disabled = false;
    if (error) return ($("fErr").textContent = /valid email|full name|ended|not valid/i.test(error.message) ? error.message : "Couldn't check you in. Check the connection and try again.");
    if (stream) stream.getTracks().forEach(t => t.stop());
    done(data);
  });
  function done(d) {
    me = { token: d.token, title: d.title, name: d.name, organisation: d.organisation, photo: d.photo, arrived_at: d.arrived_at };
    store.set("ts_me_" + sess.pkey, { token: d.token, title: d.title, name: d.name, organisation: d.organisation, photo: d.photo });
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
    pickGroup(group);
    await loadItems(); render(false);
    if (channel) return;
    channel = sb.channel("ts-" + code, { config: { broadcast: { self: false }, presence: { key: crypto.randomUUID() } } });
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
    document.addEventListener("visibilitychange", async () => { if (!document.hidden) { await loadItems(); render(false); } });
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
        <span class="ic">${i.kind === "slide" ? `<img src="${esc(i.url)}" alt="">` : esc((i.name.split(".").pop() || "FILE").slice(0, 4).toUpperCase())}</span>
        <span><b>${esc(i.name || "Item")}</b><small>${i.kind === "slide" ? "Slide" : "File"} · ${fmtTime(i.at)}</small></span><span class="ok">Open</span></a>`).join("")
      : `<p class="muted">Nothing yet. When your facilitator shares a slide or a file, it lands here. Keep this page open.</p>`;
    list.forEach(i => seen.add(i.id)); store.set("ts_seen_" + code, [...seen].slice(-300));
  }
  function fly(i) {
    $("flyCard").innerHTML = `<span class="lbl" style="color:var(--red)">${i.kind === "slide" ? "A slide for you" : "A file for you"}</span>${i.kind === "slide" ? `<img src="${esc(i.url)}" alt="">` : ""}<b style="font-family:var(--display);font-size:20px">${esc(i.name)}</b><div class="row"><a class="btn red" href="${esc(i.url)}" target="_blank" rel="noopener">Open</a><button class="btn ghost" type="button" id="flyOk">Keep in My items</button></div>`;
    $("fly").hidden = false; buzz([30, 40, 60]);
    $("flyOk").onclick = () => ($("fly").hidden = true);
    clearTimeout(fly.t); fly.t = setTimeout(() => ($("fly").hidden = true), 20000);
  }
  function pickGroup(g) { group = g; store.set("ts_group_" + code, g); document.querySelectorAll("#groups button").forEach(b => b.setAttribute("aria-pressed", b.dataset.g === g)); channel?.track({ group, name: me?.name }); }
  $("groups").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { pickGroup(b.dataset.g); render(false); } });

  // ---------- tap out ----------
  $("outBtn").addEventListener("click", async () => {
    const b = $("outBtn");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to tap out"; setTimeout(() => { b.dataset.sure = ""; b.textContent = "Tap out"; }, 4000); return; }
    b.disabled = true;
    const { error } = await sb.rpc("tap_out", { p_code: code, p_token: me.token });
    b.disabled = false; b.dataset.sure = ""; b.textContent = "Tap out";
    if (error && !/Already/.test(error.message)) return note("Couldn't tap you out. Check the connection and try again.");
    channel?.send({ type: "broadcast", event: "checkin", payload: {} });
    $("dock").hidden = true; show("bye"); buzz(40);
  });
  $("byeRoom").addEventListener("click", () => { show("room"); });

  boot();
})();
