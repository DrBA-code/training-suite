// Training Suite certificates, planner side: the design-and-rules editor with a live preview (wizard and
// Certificates tab), and the Certificates tab itself (who qualifies, issue, download, reissue, revoke).
window.TSCU = (() => {
  "use strict";
  const C = () => window.TSC;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const RULES = { attend_pct: 75, time_pct: 75, pass_mark: null, eval: false };
  const rulesOf = r => ({ ...RULES, ...(r || {}) });

  // What prints besides the name, before anything is issued.
  function infoOf(p, sessions) {
    const ds = (sessions || []).filter(s => s.programme_id === p.id && s.status !== "draft" && s.session_date).map(s => s.session_date).sort();
    const vs = [...new Set((sessions || []).filter(s => s.programme_id === p.id && s.venue).map(s => s.venue))];
    return { programme: p.name, code: p.code, dates: p.dates || "", first: ds[0] || null, last: ds[ds.length - 1] || null, venue: p.venue || (vs.length === 1 ? vs[0] : "") };
  }
  function rulesLine(r, n) {
    const need = n ? Math.ceil(n * r.attend_pct / 100 - 1e-9) : 0;
    return `${n ? `With ${n} session${n === 1 ? "" : "s"}, a person needs <b>${Math.max(need, 1)} session${need === 1 ? "" : "s"}</b>` : "A person needs the share of sessions above"}, each with at least <b>${r.time_pct}%</b> of the session in the room${r.pass_mark != null ? `, a post-test score of <b>${r.pass_mark}%</b> or more` : ""}${r.eval ? ", and the evaluation filled" : ""}.`;
  }

  // ---------- images: logos, signatures, uploaded designs ----------
  const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file couldn't be read as an image.")); i.src = src; });
  async function fileToCanvas(file, maxW) {
    if (file.type === "application/pdf") {
      if (!window.pdfjsLib) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "vendor/pdf.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, pg = await doc.getPage(1);
      const v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: maxW / v0.width });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; return c;
    }
    const url = URL.createObjectURL(file);
    try {
      const im = await loadImage(url), s = Math.min(1, maxW / im.width);
      const c = document.createElement("canvas"); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return c;
    } finally { URL.revokeObjectURL(url); }
  }
  // A signature photographed on white paper: the paper becomes see-through, then trim the edges.
  function clearWhite(c) {
    const g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const l = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]; if (l > 200) a[i + 3] = 0; else if (l > 150) a[i + 3] = Math.round(a[i + 3] * (200 - l) / 50); }
    g.putImageData(d, 0, 0); return trim(c);
  }
  function trim(c) {
    const g = c.getContext("2d"), { data, width: w, height: h } = g.getImageData(0, 0, c.width, c.height);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const pad = 6, o = document.createElement("canvas"); o.width = x1 - x0 + 1 + pad * 2; o.height = y1 - y0 + 1 + pad * 2;
    o.getContext("2d").drawImage(c, x0 - pad, y0 - pad, o.width, o.height, 0, 0, o.width, o.height); return o;
  }
  async function putAsset(ctx, programmeId, canvas, kind, jpeg) {
    const blob = await new Promise(r => canvas.toBlob(r, jpeg ? "image/jpeg" : "image/png", 0.9));
    const path = `${ctx.profile.id}/${programmeId}/${kind}-${Date.now()}.${jpeg ? "jpg" : "png"}`;
    const { error } = await ctx.sb.storage.from("ts-certs").upload(path, blob, { contentType: jpeg ? "image/jpeg" : "image/png" });
    if (error) throw new Error(/bucket|not found/i.test(error.message || "") ? "Certificate storage isn't set up yet: run schema-11-certificates.sql in Supabase." : error.message || "Couldn't upload.");
    return ctx.sb.storage.from("ts-certs").getPublicUrl(path).data.publicUrl;
  }

  // ---------- draw a signature ----------
  function drawPad() {
    return new Promise(resolve => {
      const m = document.createElement("div"); m.className = "sigpad";
      m.innerHTML = `<div class="sigbox" role="dialog" aria-modal="true" aria-label="Draw a signature"><b>Sign with your finger, a stylus or the mouse</b>
        <canvas width="900" height="300"></canvas><div class="row"><button class="btn ghost small" type="button" data-x="clear">Clear</button><span style="flex:1"></span>
        <button class="btn ghost small" type="button" data-x="cancel">Cancel</button><button class="btn red small" type="button" data-x="use">Use this signature</button></div></div>`;
      document.body.appendChild(m);
      const c = m.querySelector("canvas"), g = c.getContext("2d"); let drawing = false, last = null, inked = false;
      g.lineCap = g.lineJoin = "round"; g.strokeStyle = "#13203F";
      const at = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height, p: e.pressure && e.pointerType !== "mouse" ? e.pressure : 0.5 }; };
      c.addEventListener("pointerdown", e => { drawing = true; last = at(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
      c.addEventListener("pointermove", e => {
        if (!drawing) return; const p = at(e);
        g.lineWidth = 2.5 + 4 * p.p; g.beginPath(); g.moveTo(last.x, last.y); g.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2); g.lineTo(p.x, p.y); g.stroke();
        last = p; inked = true;
      });
      const up = () => { drawing = false; }; c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
      m.addEventListener("click", e => {
        const x = e.target.dataset?.x; if (!x) return;
        if (x === "clear") { g.clearRect(0, 0, c.width, c.height); inked = false; return; }
        m.remove(); resolve(x === "use" && inked ? trim(c) : null);
      });
    });
  }

  // ---------- the editor ----------
  // ctx: { sb, profile, toast, programme, sessions, save(patch) → updated programme or null }
  function editor(box, ctx) {
    let p = ctx.programme, d = C().normal(p.cert_design, { lead: ctx.profile?.full_name }), r = rulesOf(p.cert_rules), timer = null;
    const nSess = (ctx.sessions || []).filter(s => s.programme_id === p.id && s.status !== "draft").length;
    const sig = (i) => { const s = d.signatories[i]; return `<fieldset class="ced-sig"><legend>Signature ${i + 1}</legend>
      <div class="grid2"><label class="fld">Name<input data-sg="${i}" data-f="name" value="${esc(s.name)}" placeholder="${i ? "e.g. Dr. Babajide Arulogun" : "e.g. Mrs. A. Adio-Moses"}"></label>
      <label class="fld">Title<input data-sg="${i}" data-f="title" value="${esc(s.title)}" placeholder="${i ? "Programme Lead" : "Head of Institution"}"></label></div>
      <div class="row ced-assets">${s.sig ? `<span class="ced-img sig"><img src="${esc(s.sig)}" alt="Signature ${i + 1}"></span>` : `<span class="small muted">No signature image yet: the line stays blank for signing by hand.</span>`}
        <label class="btn ghost small">Upload<input type="file" data-sgup="${i}" accept="image/png,image/jpeg" hidden></label>
        <button class="btn ghost small" type="button" data-sgdraw="${i}">✍ Draw</button>${s.sig ? `<button class="btn ghost small" type="button" data-sgrm="${i}">Remove</button>` : ""}</div></fieldset>`; };
    const html = () => `<div class="ced">
      <div class="ced-form">
        <span class="lbl">Template</span>
        <div class="ced-tpls">${C().TEMPLATES.map(t => `<button type="button" class="ced-tpl" data-tpl="${t.id}" aria-pressed="${d.template === t.id}"><canvas width="240" height="170" data-thumb="${t.id}"></canvas><b>${t.name}</b><span class="small muted">${t.line}</span></button>`).join("")}</div>
        ${d.template === "upload" ? `<div class="note">Upload your design as a PDF or image (A4 landscape), with an empty space for the name. Then <b>drag the name and the QR code</b> into place on the preview.
          <div class="row" style="margin-top:10px"><label class="btn small">${d.upload ? "Replace design" : "⬆ Upload design"}<input type="file" id="cedUp" accept="application/pdf,image/png,image/jpeg" hidden></label>
          <label class="small">Name size <input type="range" id="cedNs" min="0.5" max="1.6" step="0.05" value="${d.layout.name.size}"></label>
          <label class="small">QR size <input type="range" id="cedQs" min="0.6" max="1.6" step="0.05" value="${d.layout.qr.size}"></label>
          <span class="small">Name colour</span>${["#16181D", "#FFFFFF", "#B8902F", "#1F5FBF"].map(c => `<button type="button" class="ced-sw" data-nc="${c}" style="background:${c}" aria-label="Name colour ${c}" aria-pressed="${d.layout.name.color === c}"></button>`).join("")}</div></div>` : `
        <span class="lbl">Colour</span>
        <div class="row">${C().SWATCHES.map(c => `<button type="button" class="ced-sw" data-acc="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${d.accent.toLowerCase() === c.toLowerCase()}"></button>`).join("")}
          <label class="ced-sw ced-own" title="Your own colour"><input type="color" id="cedAcc" value="${esc(d.accent)}" aria-label="Your own colour"></label></div>`}
        <div class="grid2"><label class="fld">Certificate of<select id="cedKind">${Object.entries(C().KINDS).map(([k, v]) => `<option value="${k}" ${d.kind === k ? "selected" : ""}>${v.title.replace("Certificate of ", "")}</option>`).join("")}</select></label>
          <label class="fld">Title on the certificate<span class="hint">Leave empty for “${esc(C().KINDS[d.kind].title)}”.</span><input id="cedTitle" value="${esc(d.title)}" placeholder="${esc(C().KINDS[d.kind].title)}"></label></div>
        <label class="fld">Issuing organisation<input id="cedOrg" value="${esc(d.org)}" placeholder="e.g. Public Service Staff Development Centre"></label>
        <div class="row ced-assets"><span class="lbl" style="min-width:60px">Logo</span>${d.logo ? `<span class="ced-img"><img src="${esc(d.logo)}" alt="Logo"></span>` : `<span class="small muted">No logo yet.</span>`}
          <label class="btn ghost small">${d.logo ? "Replace" : "Upload logo"}<input type="file" id="cedLogo" accept="image/png,image/jpeg,image/svg+xml" hidden></label>${d.logo ? `<button class="btn ghost small" type="button" id="cedLogoRm">Remove</button>` : ""}</div>
        <div class="row ced-assets"><span class="lbl" style="min-width:60px">Second logo</span>${d.logo2 ? `<span class="ced-img"><img src="${esc(d.logo2)}" alt="Second logo"></span>` : `<span class="small muted">Optional, e.g. a partner or the State.</span>`}
          <label class="btn ghost small">${d.logo2 ? "Replace" : "Upload"}<input type="file" id="cedLogo2" accept="image/png,image/jpeg,image/svg+xml" hidden></label>${d.logo2 ? `<button class="btn ghost small" type="button" id="cedLogo2Rm">Remove</button>` : ""}</div>
        ${d.template === "ribbon" ? `<label class="opt"><input type="checkbox" id="cedSeal" ${d.seal !== false ? "checked" : ""}><span><b>Gold seal</b><span class="muted">The rosette beside the signatures.</span></span></label>` : ""}
        ${sig(0)}${sig(1)}
        <fieldset class="ced-sig"><legend>Who qualifies</legend>
          <div class="grid2"><label class="fld">Sessions attended<span class="hint">Share of the programme's sessions.</span><span class="row"><input id="rA" type="number" min="1" max="100" value="${r.attend_pct}" style="width:90px"> %</span></label>
          <label class="fld">Time in the room<span class="hint">For a session to count as attended.</span><span class="row"><input id="rT" type="number" min="1" max="100" value="${r.time_pct}" style="width:90px"> %</span></label></div>
          <label class="opt"><input type="checkbox" id="rPon" ${r.pass_mark != null ? "checked" : ""}><span><b>Post-test pass mark</b> <input id="rP" type="number" min="1" max="100" value="${r.pass_mark ?? 50}" style="width:80px" ${r.pass_mark == null ? "disabled" : ""}> %<span class="muted">Average of the post-tests in the programme.</span></span></label>
          <label class="opt"><input type="checkbox" id="rE" ${r.eval ? "checked" : ""}><span><b>Must fill the session evaluation</b><span class="muted">For every session they attended.</span></span></label>
          <p class="small muted" id="rLine" style="margin:4px 0 0">${rulesLine(r, nSess)}</p></fieldset>
      </div>
      <div class="ced-prev"><div class="ced-stage"><canvas id="cedCanvas"></canvas></div>
        <p class="small muted">Preview with a sample name. The programme name and dates fill in by themselves; each person's name and certificate number are printed when you issue.</p>
        <div class="row"><button class="btn ghost small" type="button" id="cedPdf">Download a sample PDF</button><span class="small" id="cedMsg" role="status"></span></div></div>
    </div>`;
    const msg = (t, bad) => { const m = box.querySelector("#cedMsg"); if (m) { m.textContent = t || ""; m.style.color = bad ? "#B3261E" : "var(--muted)"; } };
    const info = () => infoOf(p, ctx.sessions);
    const sampleName = () => "Dr Babajide Arulogun";
    let drawing = 0;
    async function preview() {
      const c = box.querySelector("#cedCanvas"); if (!c) return;
      const n = ++drawing, w = Math.min(1400, Math.round((c.parentElement.clientWidth || 700) * (window.devicePixelRatio || 1)));
      const tmp = await C().render(d, C().sample(info(), sampleName()), w);
      if (n !== drawing) return;
      c.width = tmp.width; c.height = tmp.height; c.getContext("2d").drawImage(tmp, 0, 0);
    }
    async function thumbs() {
      for (const t of C().TEMPLATES) {
        const el = box.querySelector(`[data-thumb="${t.id}"]`); if (!el) continue;
        const dd = { ...d, template: t.id, accent: t.id === d.template ? d.accent : t.accent };
        if (t.id === "upload" && !d.upload) { const g = el.getContext("2d"); g.fillStyle = "#F3F5F2"; g.fillRect(0, 0, 240, 170); g.fillStyle = "#5B6170"; g.font = "600 15px 'Plus Jakarta Sans', Arial"; g.textAlign = "center"; g.fillText("⬆ Upload", 120, 90); continue; }
        const c = await C().render(dd, C().sample(info(), "Dr Babajide Arulogun"), 240); el.width = c.width; el.height = c.height; el.getContext("2d").drawImage(c, 0, 0);
      }
    }
    function persist() {
      clearTimeout(timer); msg("Saving…");
      timer = setTimeout(async () => {
        const np = await ctx.save({ cert_design: d, cert_rules: r });
        if (np) { p = np; msg("Saved ✓"); } else msg("Couldn't save. Check the connection.", true);
      }, 500);
    }
    const changed = (redraw) => { persist(); if (redraw) draw(); else { preview(); const l = box.querySelector("#rLine"); if (l) l.innerHTML = rulesLine(r, nSess); } };
    async function withBusy(label, fn) { msg(label); try { await fn(); } catch (e) { msg(e.message || "Something went wrong.", true); } }
    function draw() {
      box.innerHTML = html();
      thumbs(); preview();
      const $ = s => box.querySelector(s);
      box.querySelectorAll("[data-tpl]").forEach(b => b.addEventListener("click", () => {
        const t = C().TEMPLATES.find(x => x.id === b.dataset.tpl); if (d.template === t.id) return;
        d.template = t.id; if (t.id !== "upload") d.accent = t.accent; changed(true);
      }));
      box.querySelectorAll("[data-acc]").forEach(b => b.addEventListener("click", () => { d.accent = b.dataset.acc; changed(true); }));
      $("#cedAcc")?.addEventListener("change", e => { d.accent = e.target.value; changed(true); });
      $("#cedKind").addEventListener("change", e => { d.kind = e.target.value; changed(true); });
      $("#cedTitle").addEventListener("input", e => { d.title = e.target.value; changed(); });
      $("#cedOrg").addEventListener("input", e => { d.org = e.target.value; changed(); });
      box.querySelectorAll("[data-sg]").forEach(i => i.addEventListener("input", () => { d.signatories[+i.dataset.sg][i.dataset.f] = i.value; changed(); }));
      $("#cedLogo").addEventListener("change", e => withBusy("Uploading the logo…", async () => {
        const f = e.target.files[0]; if (!f) return;
        const c = await fileToCanvas(f, 900); d.logo = await putAsset(ctx, p.id, trim(c) || c, "logo"); changed(true); msg("Logo added ✓");
      }));
      $("#cedLogoRm")?.addEventListener("click", () => { d.logo = ""; changed(true); });
      $("#cedLogo2").addEventListener("change", e => withBusy("Uploading the logo…", async () => {
        const f = e.target.files[0]; if (!f) return;
        const c = await fileToCanvas(f, 900); d.logo2 = await putAsset(ctx, p.id, trim(c) || c, "logo"); changed(true); msg("Second logo added ✓");
      }));
      $("#cedLogo2Rm")?.addEventListener("click", () => { d.logo2 = ""; changed(true); });
      $("#cedSeal")?.addEventListener("change", e => { d.seal = e.target.checked; changed(); });
      box.querySelectorAll("[data-sgup]").forEach(i => i.addEventListener("change", e => withBusy("Uploading the signature…", async () => {
        const f = e.target.files[0]; if (!f) return;
        const c = clearWhite(await fileToCanvas(f, 1200)); if (!c) throw new Error("No signature found in that picture.");
        d.signatories[+i.dataset.sgup].sig = await putAsset(ctx, p.id, c, "signature"); changed(true); msg("Signature added ✓");
      })));
      box.querySelectorAll("[data-sgdraw]").forEach(b => b.addEventListener("click", async () => {
        const c = await drawPad(); if (!c) return;
        withBusy("Saving the signature…", async () => { d.signatories[+b.dataset.sgdraw].sig = await putAsset(ctx, p.id, c, "signature"); changed(true); msg("Signature added ✓"); });
      }));
      box.querySelectorAll("[data-sgrm]").forEach(b => b.addEventListener("click", () => { d.signatories[+b.dataset.sgrm].sig = ""; changed(true); }));
      $("#cedUp")?.addEventListener("change", e => withBusy("Uploading your design…", async () => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 20 * 1024 * 1024) throw new Error("Use a file under 20 MB.");
        const c = await fileToCanvas(f, 2480); d.upload = await putAsset(ctx, p.id, c, "design", true); d.upload_name = f.name; changed(true); msg("Design added ✓ Now drag the name and QR code into place.");
      }));
      $("#cedNs")?.addEventListener("input", e => { d.layout.name.size = +e.target.value; changed(); });
      $("#cedQs")?.addEventListener("input", e => { d.layout.qr.size = +e.target.value; changed(); });
      box.querySelectorAll("[data-nc]").forEach(b => b.addEventListener("click", () => { d.layout.name.color = b.dataset.nc; changed(true); }));
      const num = (el, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+el.value || lo)));
      $("#rA").addEventListener("change", e => { r.attend_pct = num(e.target, 1, 100); e.target.value = r.attend_pct; changed(); });
      $("#rT").addEventListener("change", e => { r.time_pct = num(e.target, 1, 100); e.target.value = r.time_pct; changed(); });
      $("#rPon").addEventListener("change", e => { $("#rP").disabled = !e.target.checked; r.pass_mark = e.target.checked ? num($("#rP"), 1, 100) : null; changed(); });
      $("#rP").addEventListener("change", e => { if (r.pass_mark != null) { r.pass_mark = num(e.target, 1, 100); e.target.value = r.pass_mark; changed(); } });
      $("#rE").addEventListener("change", e => { r.eval = e.target.checked; changed(); });
      $("#cedPdf").addEventListener("click", () => withBusy("Making the PDF…", async () => { await C().pdf([{ design: d, data: C().sample(info(), sampleName()) }], "Sample certificate.pdf"); msg(""); }));
      // own design: drag the name and the QR code
      const cv = $("#cedCanvas");
      if (d.template === "upload") {
        cv.style.cursor = "grab"; cv.style.touchAction = "none"; let hold = null;
        const pos = e => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; };
        cv.addEventListener("pointerdown", e => {
          const q = pos(e), dn = Math.hypot(q.x - d.layout.name.x, (q.y - d.layout.name.y) * 0.7), dq = Math.hypot(q.x - d.layout.qr.x, (q.y - d.layout.qr.y) * 0.7);
          hold = dq < dn ? "qr" : "name"; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
        });
        cv.addEventListener("pointermove", e => {
          if (!hold) return; const q = pos(e);
          d.layout[hold].x = Math.max(0.05, Math.min(0.95, q.x)); d.layout[hold].y = Math.max(0.05, Math.min(0.95, q.y)); preview();
        });
        const up = () => { if (hold) { hold = null; cv.style.cursor = "grab"; persist(); } };
        cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      }
    }
    draw();
    let rw = 0; const ro = new ResizeObserver(() => { const w = box.clientWidth; if (Math.abs(w - rw) > 40) { rw = w; preview(); } }); ro.observe(box);
    return { get design() { return d; }, get rules() { return r; } };
  }

  // ---------- the Certificates tab ----------
  // ctx: { sb, profile, toast, errText, programme, sessions, session, save(patch), refresh() }
  async function tab(box, ctx) {
    const p = ctx.programme;
    if (!p.certificates) {
      box.innerHTML = `<div class="empty"><div><h2>Certificates are off for “${esc(p.name)}”</h2><p class="muted">Certificates belong to the programme. Turn them on to set the design and rules, then issue them after the programme's last session.</p>
        <button class="btn red" type="button" id="ctOn">Turn on certificates</button></div></div>`;
      box.querySelector("#ctOn").onclick = async () => { const np = await ctx.save({ certificates: true }); if (np) { ctx.programme = np; tab(box, ctx); } };
      return;
    }
    box.innerHTML = `<p class="muted">Loading…</p>`;
    const [{ data, error }, certs] = await Promise.all([ctx.sb.rpc("programme_certificates", { p_programme: p.id }), ctx.sb.from("certificates").select("*").eq("programme_id", p.id)]);
    if (error || !data) { box.innerHTML = `<p class="err">${esc(/function|schema cache|does not exist/i.test(error?.message || "") ? "Certificates aren't set up in the database yet: run supabase/schema-11-certificates.sql in Supabase." : ctx.errText(error, "Couldn't load certificates."))}</p>`; return; }
    const rows = certs.data || [], byId = Object.fromEntries(rows.map(c => [c.id, c]));
    const people = data.people || [], ok = people.filter(x => x.qualifies), issued = people.filter(x => x.cert?.status === "valid");
    let open = !people.some(x => x.cert?.status === "valid");
    const pick = new Set(people.filter(x => x.qualifies && x.cert?.status !== "valid").map(x => x.participant)), notes = {};
    const n = data.info?.sessions || 0, r = rulesOf(data.rules);
    const fullName = x => (x.title ? (x.title === "Miss" || x.title === "Ms" ? x.title + " " : x.title + ". ") : "") + x.name;
    const status = x => x.cert?.status === "valid" ? `<span class="badge done">Issued</span>` : x.qualifies ? `<span class="badge ok">Qualifies</span>` : `<span class="badge">Not yet</span>`;
    const draw = () => {
      const toIssue = [...pick].length;
      box.innerHTML = `<div class="ct">
        <div class="ct-stats"><div><b>${ok.length}</b><span>qualify</span></div><div><b>${people.length - ok.length}</b><span>not yet</span></div><div><b>${issued.length}</b><span>issued</span></div><div><b>${issued.filter(x => x.cert.downloads > 0).length}</b><span>downloaded</span></div></div>
        ${data.completed ? "" : `<div class="note">The programme's last session hasn't ended yet. Certificates are usually issued after it ends, but you can issue now.</div>`}
        <details class="ct-design" ${open ? "open" : ""}><summary><b>Design and rules</b> <span class="small muted">${esc(C().TEMPLATES.find(t => t.id === C().normal(p.cert_design).template)?.name || "")} · ${rulesLine(r, n).replace(/<[^>]+>/g, "")}</span></summary><div id="ctEd"></div></details>
        <div class="row" style="justify-content:space-between"><h2 style="font-size:20px">People <span class="muted" style="font-family:var(--body);font-weight:500;font-size:16px">· ${people.length} in the programme · ${n} session${n === 1 ? "" : "s"}</span></h2>
          <div class="row"><button class="btn ghost small" type="button" id="ctAll" ${issued.length ? "" : "disabled"}>Download all issued (one PDF)</button><button class="btn ghost small" type="button" id="ctCsv">Download list (Excel/CSV)</button></div></div>
        <div class="tablewrap"><table class="t ct-t"><thead><tr><th><span class="sr">Issue</span></th><th>Photo</th><th>Name on the certificate</th><th>Sessions</th><th>Post-test</th><th>Evaluation</th><th>Status</th><th>Certificate</th></tr></thead><tbody>
        ${people.map(x => {
          const c = x.cert, can = c?.status !== "valid";
          return `<tr${!x.qualifies && pick.has(x.participant) ? ` class="ct-over"` : ""}><td>${can ? `<input type="checkbox" data-pk="${x.participant}" ${pick.has(x.participant) ? "checked" : ""} aria-label="Issue to ${esc(fullName(x))}">` : ""}</td>
            <td>${x.photo ? `<img src="${esc(x.photo)}" alt="" width="40" height="40" style="object-fit:cover;display:block;border-radius:8px">` : ""}</td>
            <td><b>${esc(fullName(x))}</b>${x.name_confirmed ? ` <span class="small" style="color:#2E7D4F" title="They confirmed this name on their phone">✓ confirmed</span>` : ""}<br><small class="muted">${esc(x.email)}</small></td>
            <td>${x.attended} of ${x.sessions}<br><small class="muted">${(x.per || []).map(s => s.here ? s.pct + "%" : "absent").join(" · ")}</small></td>
            <td>${x.post == null ? "–" : x.post + "%"}</td><td>${x.eval_need ? `${x.eval_done} of ${x.eval_need}` : "–"}</td>
            <td>${status(x)}${!x.qualifies && can ? `<br><small class="muted">${(x.why || []).map(esc).join("<br>")}</small>` : ""}
              ${!x.qualifies && can && pick.has(x.participant) ? `<input class="in" data-nt="${x.participant}" placeholder="Why include? (optional)" value="${esc(notes[x.participant] || "")}" style="margin-top:6px;max-width:220px">` : ""}</td>
            <td>${c ? `<code>${esc(c.number)}</code> ${c.status !== "valid" ? `<span class="badge">${c.status === "revoked" ? "Revoked" : "Replaced"}</span>` : ""}<br><small class="muted">${c.status === "valid" ? `Issued ${esc(C().dmy(c.issued_at))} · ${c.downloads ? `downloaded ${c.downloads}×` : "not downloaded yet"}` : esc(c.reason || "")}</small>
              ${c.status === "valid" ? `<div class="row" style="margin-top:6px;gap:6px"><button class="btn ghost small" type="button" data-dl="${c.id}">PDF</button><button class="btn ghost small" type="button" data-re="${c.id}">Reissue</button><button class="btn ghost small" type="button" data-rv="${c.id}">Revoke</button></div>` : ""}` : `<span class="small muted">–</span>`}</td></tr>`;
        }).join("") || `<tr><td colspan="8" class="muted">No one has checked in to this programme yet.</td></tr>`}</tbody></table></div>
        <div class="row ct-go"><button class="btn red" type="button" id="ctIssue" ${toIssue ? "" : "disabled"}>Issue certificates to ${toIssue} ${toIssue === 1 ? "person" : "people"}</button><span class="small muted">Ticked people get a certificate with its own number and QR code. They download it from their phone.</span><span class="err" id="ctErr" role="alert"></span></div>
      </div>`;
      const ed = box.querySelector("#ctEd");
      box.querySelector(".ct-design").addEventListener("toggle", e => { open = e.target.open; if (e.target.open && !ed.dataset.on) { ed.dataset.on = "1"; editor(ed, { ...ctx, programme: p, save: async patch => { const np = await ctx.save(patch); if (np) Object.assign(p, np); return np; } }); } });
      if (box.querySelector(".ct-design").open) { ed.dataset.on = "1"; editor(ed, { ...ctx, programme: p, save: async patch => { const np = await ctx.save(patch); if (np) Object.assign(p, np); return np; } }); }
      box.querySelectorAll("[data-pk]").forEach(i => i.addEventListener("change", () => { i.checked ? pick.add(i.dataset.pk) : pick.delete(i.dataset.pk); draw(); }));
      box.querySelectorAll("[data-nt]").forEach(i => i.addEventListener("input", () => { notes[i.dataset.nt] = i.value; }));
      box.querySelector("#ctIssue").addEventListener("click", async e => {
        const b = e.currentTarget; b.disabled = true; b.textContent = "Issuing…";
        const { data: k, error } = await ctx.sb.rpc("issue_certificates", { p_programme: p.id, p_people: [...pick], p_notes: notes });
        if (error) { box.querySelector("#ctErr").textContent = ctx.errText(error, "Couldn't issue."); b.disabled = false; b.textContent = "Try again"; return; }
        ctx.toast(`${k} certificate${k === 1 ? "" : "s"} issued. Phones can download them now.`); ctx.notify && ctx.notify(); tab(box, ctx);
      });
      box.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", async () => {
        const c = byId[b.dataset.dl]; b.disabled = true; b.textContent = "…";
        try { await C().pdf([{ design: c.design, data: C().dataOf(c) }], `${C().fileName(c.name)} - ${c.number}.pdf`); } catch (e) { ctx.toast(e.message); }
        b.disabled = false; b.textContent = "PDF";
      }));
      box.querySelectorAll("[data-re]").forEach(b => b.addEventListener("click", async () => {
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again: new number"; return; }
        const { error } = await ctx.sb.rpc("reissue_certificate", { p_cert: b.dataset.re });
        if (error) return ctx.toast(ctx.errText(error, "Couldn't reissue."));
        ctx.toast("Reissued with a new number. The old one now shows “replaced”."); ctx.notify && ctx.notify(); tab(box, ctx);
      }));
      box.querySelectorAll("[data-rv]").forEach(b => b.addEventListener("click", () => {
        const cell = b.closest("td"); if (cell.querySelector(".ct-rv")) return;
        cell.insertAdjacentHTML("beforeend", `<div class="ct-rv row" style="margin-top:6px;gap:6px"><input class="in" placeholder="Reason for revoking" style="max-width:200px"><button class="btn danger small" type="button">Revoke</button></div>`);
        const inp = cell.querySelector(".ct-rv input"); inp.focus();
        cell.querySelector(".ct-rv button").onclick = async () => {
          const { error } = await ctx.sb.rpc("revoke_certificate", { p_cert: b.dataset.rv, p_reason: inp.value });
          if (error) return ctx.toast(ctx.errText(error, "Couldn't revoke."));
          ctx.toast("Certificate revoked. Its QR code now shows “Revoked”."); tab(box, ctx);
        };
      }));
      box.querySelector("#ctAll").addEventListener("click", async e => {
        const b = e.currentTarget, list = rows.filter(c => c.status === "valid").sort((a, z) => a.name.localeCompare(z.name));
        b.disabled = true;
        try { await C().pdf(list.map(c => ({ design: c.design, data: C().dataOf(c) })), `${C().fileName(p.name)} - certificates.pdf`, (i, t) => (b.textContent = `Making ${i} of ${t}…`)); } catch (er) { ctx.toast(er.message); }
        b.disabled = false; b.textContent = "Download all issued (one PDF)";
      });
      box.querySelector("#ctCsv").addEventListener("click", () => {
        const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = [["Name on certificate", "Email", "Organisation", "Sessions attended", "Of", "Post-test %", "Evaluations", "Qualifies", "Reasons", "Certificate number", "Status", "Issued", "Downloads"]]
          .concat(people.map(x => [fullName(x), x.email, x.organisation, x.attended, x.sessions, x.post ?? "", x.eval_need ? `${x.eval_done}/${x.eval_need}` : "", x.qualifies ? "Yes" : "No", (x.why || []).join("; "), x.cert?.number || "", x.cert?.status || "", x.cert ? C().dmy(x.cert.issued_at) : "", x.cert?.downloads ?? ""]));
        const blob = new Blob(["﻿" + lines.map(l => l.map(q).join(",")).join("\r\n")], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${C().fileName(p.name)} - certificates.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
    };
    draw();
  }
  return { editor, tab, infoOf, rulesOf, drawPad, fileToCanvas, clearWhite, putAsset };
})();
