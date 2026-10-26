// Training Suite writing board: a full-screen board on the live screen for writing, diagrams and analogies.
// Touch, stylus (with pressure) and mouse. Pens, highlighter, eraser, shapes, text, undo/redo, pages,
// a blank, grid or chalk background, or drawing over the current slide. Pages can be shared to phones.
window.TSB = (() => {
  "use strict";
  const COLORS = ["#16181D", "#D2391F", "#1F5FBF", "#0F7B5F", "#E07A00", "#6D3FC0"];
  const CHALK = ["#F4F1E8", "#FF8A73", "#7FB2FF", "#7EE0A8", "#FFD166", "#C9A7FF"];
  const SIZES = [3, 6, 12];
  const BGS = { white: "#FFFFFF", grid: "#FFFFFF", dark: "#1E2A26" };
  let el = null, cv = null, g = null, opts = null, open = false;
  let pages = [], at = 0, tool = "pen", color = 0, size = 1, tidy = false, penSeen = false;
  let cur = null, active = null, bgCache = {}, saveT = null;
  const page = () => pages[at];
  const dark = () => page()?.bg === "dark";
  const ink = () => (dark() ? CHALK : COLORS)[color];
  const key = () => "ts_board_" + (opts?.id || "x");

  function load() {
    try { const v = JSON.parse(localStorage.getItem(key()) || "null"); if (v && Array.isArray(v.pages) && v.pages.length) { pages = v.pages.map(p => ({ ...p, hist: [], redo: [] })); at = Math.min(v.at || 0, pages.length - 1); return; } } catch {}
    pages = [{ bg: "white", strokes: [], hist: [], redo: [] }]; at = 0;
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(key(), JSON.stringify({ at, pages: pages.map(p => ({ bg: p.bg, slide: p.slide, strokes: p.strokes })) })); } catch {} }, 400); }

  // ---------- drawing ----------
  const W = () => cv.width, H = () => cv.height;
  const px = (x, y) => [x * W(), y * H()];
  function bgDraw(ctx, p, w, h) {
    ctx.fillStyle = BGS[p.bg] || "#fff"; ctx.fillRect(0, 0, w, h);
    if (p.bg === "grid") {
      ctx.strokeStyle = "rgba(31,95,191,.10)"; ctx.lineWidth = Math.max(1, w / 1600);
      const s = w / 40; for (let x = s; x < w; x += s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = s; y < h; y += s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }
    if (p.bg === "slide" && bgCache[p.slide]) {
      const im = bgCache[p.slide], sc = Math.min(w / im.width, h / im.height), iw = im.width * sc, ih = im.height * sc;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }
  }
  function strokeDraw(ctx, s, w, h) {
    const P = (x, y) => [x * w, y * h], k = w / 1600;
    ctx.save(); ctx.lineCap = ctx.lineJoin = "round";
    if (s.t === "hl") { ctx.globalAlpha = 0.32; ctx.globalCompositeOperation = s.dark ? "screen" : "multiply"; }
    ctx.strokeStyle = ctx.fillStyle = s.c;
    if (s.t === "pen" || s.t === "hl") {
      const pts = s.p; if (!pts.length) { ctx.restore(); return; }
      if (pts.length === 1) { const [x, y] = P(pts[0][0], pts[0][1]); ctx.beginPath(); ctx.arc(x, y, s.w * k * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
      if (s.t === "hl") {
        ctx.lineWidth = s.w * k * 3.2; ctx.beginPath(); ctx.moveTo(...P(pts[0][0], pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(...P(pts[i][0], pts[i][1])); ctx.stroke();
      } else {
        for (let i = 1; i < pts.length; i++) {   // width follows pressure, smoothed through midpoints
          const a = pts[i - 1], b = pts[i], m0 = i > 1 ? [(pts[i - 2][0] + a[0]) / 2, (pts[i - 2][1] + a[1]) / 2] : a, m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          ctx.lineWidth = s.w * k * (0.55 + 0.9 * ((a[2] ?? 0.5) + (b[2] ?? 0.5)) / 2);
          ctx.beginPath(); ctx.moveTo(...P(m0[0], m0[1])); ctx.quadraticCurveTo(...P(a[0], a[1]), ...P(m1[0], m1[1])); ctx.stroke();
        }
        const l = pts[pts.length - 1], m = pts[pts.length - 2]; ctx.beginPath(); ctx.moveTo(...P((l[0] + m[0]) / 2, (l[1] + m[1]) / 2)); ctx.lineTo(...P(l[0], l[1])); ctx.stroke();
      }
    } else if (s.t === "line" || s.t === "arrow") {
      const [x1, y1] = P(s.a[0], s.a[1]), [x2, y2] = P(s.b[0], s.b[1]); ctx.lineWidth = s.w * k;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (s.t === "arrow") { const an = Math.atan2(y2 - y1, x2 - x1), L = Math.max(14 * k, s.w * k * 4); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(an - 0.45), y2 - L * Math.sin(an - 0.45)); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(an + 0.45), y2 - L * Math.sin(an + 0.45)); ctx.stroke(); }
    } else if (s.t === "rect") {
      const [x1, y1] = P(s.a[0], s.a[1]), [x2, y2] = P(s.b[0], s.b[1]); ctx.lineWidth = s.w * k;
      ctx.beginPath(); const r = Math.min(8 * k, Math.abs(x2 - x1) / 4, Math.abs(y2 - y1) / 4); const x = Math.min(x1, x2), y = Math.min(y1, y2), ww = Math.abs(x2 - x1), hh = Math.abs(y2 - y1);
      ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); ctx.stroke();
    } else if (s.t === "ellipse") {
      const [x1, y1] = P(s.a[0], s.a[1]), [x2, y2] = P(s.b[0], s.b[1]); ctx.lineWidth = s.w * k;
      ctx.beginPath(); ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2 || 1, Math.abs(y2 - y1) / 2 || 1, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (s.t === "text") {
      const [x, y] = P(s.a[0], s.a[1]); ctx.font = `600 ${s.w * k * 6}px "Plus Jakarta Sans", Arial, sans-serif`; ctx.textBaseline = "top";
      String(s.text).split("\n").forEach((ln, i) => ctx.fillText(ln, x, y + i * s.w * k * 7.4));
    }
    ctx.restore();
  }
  function paint(ctx = g, w = W(), h = H(), p = page()) {
    if (!p) return;
    bgDraw(ctx, p, w, h);
    for (const s of p.strokes) strokeDraw(ctx, s, w, h);
    if (ctx === g && cur) strokeDraw(ctx, cur, w, h);
  }
  async function ensureSlide(p) {
    if (p.bg !== "slide" || bgCache[p.slide] || !opts.slideImage) return;
    const c = await opts.slideImage(p.slide).catch(() => null); if (c) { bgCache[p.slide] = c; paint(); }
  }
  // The page is always 16:9 and scales evenly, so marks stay where they were drawn on any screen.
  const RATIO = 16 / 9;
  function fit() {
    if (!cv) return;
    if (opts?.bottom) el.style.bottom = opts.bottom() + "px";
    const r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = Math.max(200, r.width), h = w / RATIO; if (h > r.height) { h = Math.max(120, r.height); w = h * RATIO; }
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px";
    paint();
  }

  // ---------- tidy shapes: a rough line, box or circle becomes a clean one ----------
  function tidyUp(s) {
    const p = s.p.map(q => [q[0] * W(), q[1] * H()]); if (p.length < 6) return s;
    let len = 0; for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    const a = p[0], b = p[p.length - 1], ends = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const N = q => [q[0] / W(), q[1] / H()];
    if (len > 30 && ends / len > 0.94) return { t: "line", c: s.c, w: s.w, a: N(a), b: N(b) };
    if (ends < Math.max(30, len * 0.18)) {
      const xs = p.map(q => q[0]), ys = p.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2; if (rx < 10 || ry < 10) return s;
      const err = p.reduce((m, q) => m + Math.abs(Math.hypot((q[0] - cx) / rx, (q[1] - cy) / ry) - 1), 0) / p.length;
      // a box hugs its bounding edges; an ellipse doesn't
      const edge = p.reduce((m, q) => m + (Math.min(q[0] - x0, x1 - q[0], q[1] - y0, y1 - q[1]) < Math.min(rx, ry) * 0.18 ? 1 : 0), 0) / p.length;
      if (edge > 0.82) return { t: "rect", c: s.c, w: s.w, a: N([x0, y0]), b: N([x1, y1]) };
      if (err < 0.16) return { t: "ellipse", c: s.c, w: s.w, a: N([x0, y0]), b: N([x1, y1]) };
    }
    return s;
  }

  // ---------- input ----------
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pointerType === "mouse" || !e.pressure ? 0.5 : e.pressure]; };
  function hitStroke(s, x, y) {
    const k = 14 / W() + (s.w || 4) / 1600, dist = (a, b) => Math.hypot((a[0] - b[0]) * W() / W(), (a[1] - b[1]) * H() / W());
    if (s.p) return s.p.some(q => dist(q, [x, y]) < k * 1.4);
    if (s.t === "text") return x >= s.a[0] - 0.01 && y >= s.a[1] - 0.01 && x <= s.a[0] + 0.3 && y <= s.a[1] + 0.06;
    const [a, b] = [s.a, s.b];
    if (s.t === "line" || s.t === "arrow") { const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) || 1))); return dist([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], [x, y]) < k * 1.4; }
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    if (s.t === "rect") return x >= x0 - k && x <= x1 + k && y >= y0 - k && y <= y1 + k && !(x > x0 + k && x < x1 - k && y > y0 + k && y < y1 - k);
    if (s.t === "ellipse") { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, v = Math.hypot((x - cx) / ((x1 - x0) / 2 || 1e-3), (y - cy) / ((y1 - y0) / 2 || 1e-3)); return Math.abs(v - 1) < 0.18; }
    return false;
  }
  function down(e) {
    if (e.pointerType === "pen") penSeen = true;
    if (e.pointerType === "touch" && penSeen) return;            // resting palm while writing with a stylus
    if (active != null) return;                                  // one finger at a time
    active = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch {} e.preventDefault();
    const [x, y, pr] = pos(e), w = SIZES[size];
    if (tool === "text") { active = null; textAt(x, y); return; }
    if (tool === "erase") { cur = { t: "erase" }; eraseAt(x, y); return; }
    if (tool === "pen" || tool === "hl") cur = { t: tool, c: ink(), w, p: [[x, y, pr]], dark: dark() };
    else cur = { t: tool, c: ink(), w, a: [x, y], b: [x, y] };
    paint();
  }
  function move(e) {
    if (e.pointerId !== active || !cur) return; e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y, pr] = pos(ev);
      if (cur.t === "erase") eraseAt(x, y);
      else if (cur.p) cur.p.push([+x.toFixed(4), +y.toFixed(4), +pr.toFixed(2)]);
      else cur.b = [x, y];
    }
    if (cur.t !== "erase") paint();
  }
  function up(e) {
    if (e.pointerId !== active) return; active = null;
    if (!cur) return;
    if (cur.t !== "erase") {
      let s = cur; if (tidy && s.t === "pen") s = tidyUp(s);
      if (!(s.a && s.b && Math.hypot(s.a[0] - s.b[0], s.a[1] - s.b[1]) < 0.004)) act({ k: "add", s });
    }
    cur = null; paint(); save(); bar();
  }
  function eraseAt(x, y) {
    const p = page(), i = p.strokes.findIndex(s => hitStroke(s, x, y));
    if (i >= 0) { act({ k: "erase", s: p.strokes[i], i }); paint(); }
  }
  function textAt(x, y) {
    const r = cv.getBoundingClientRect(), pr = cv.parentElement.getBoundingClientRect(), t = document.createElement("textarea");
    t.className = "bd-text"; t.rows = 1; t.placeholder = "Type, then click away";
    t.style.left = r.left - pr.left + x * r.width + "px"; t.style.top = r.top - pr.top + y * r.height + "px"; t.style.color = ink(); t.style.fontSize = SIZES[size] * 6 * r.width / 1600 + "px";
    cv.parentElement.appendChild(t); t.focus(); requestAnimationFrame(() => t.focus());
    const done = () => { const v = t.value.trim(); t.remove(); if (v) { act({ k: "add", s: { t: "text", c: ink(), w: SIZES[size], a: [x, y], text: v } }); paint(); save(); bar(); } };
    t.addEventListener("blur", done); t.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") { t.value = ""; t.blur(); } if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); t.blur(); } });
  }

  // ---------- actions ----------
  // Every change is an action, so undo and redo cover drawing, erasing and clearing alike.
  function apply(p, a) { if (a.k === "add") p.strokes.push(a.s); else if (a.k === "erase") p.strokes.splice(a.i, 1); else if (a.k === "clear") p.strokes = []; }
  function act(a, keepRedo) { const p = page(); p.hist = p.hist || []; if (a.k === "clear") a.list = p.strokes.slice(); apply(p, a); p.hist.push(a); if (!keepRedo) p.redo = []; }
  function undo() {
    const p = page(), a = (p.hist || []).pop(); if (!a) return;
    if (a.k === "add") p.strokes.pop(); else if (a.k === "erase") p.strokes.splice(a.i, 0, a.s); else if (a.k === "clear") p.strokes = a.list;
    p.redo.push(a); paint(); save(); bar();
  }
  function redo() { const p = page(), a = p.redo.pop(); if (!a) return; act(a, true); paint(); save(); bar(); }
  function clearPage() { if (!page().strokes.length) return; act({ k: "clear" }); paint(); save(); bar(); }
  function go(i) { at = Math.max(0, Math.min(pages.length - 1, i)); ensureSlide(page()); paint(); save(); bar(); }
  function addPage(bg = "white", slide) { pages.splice(at + 1, 0, { bg, slide, strokes: [], hist: [], redo: [] }); go(at + 1); }
  function delPage() { if (pages.length === 1) { pages[0] = { bg: "white", strokes: [], hist: [], redo: [] }; go(0); return; } pages.splice(at, 1); go(Math.min(at, pages.length - 1)); }
  function snapshot(width = 1600) {
    const r = H() / W(), c = document.createElement("canvas"); c.width = width; c.height = Math.round(width * r);
    paint(c.getContext("2d"), c.width, c.height, page()); return c;
  }

  // ---------- toolbar ----------
  const TOOLS = [["pen", "✏️", "Pen (P)"], ["hl", "🖍", "Highlighter (H)"], ["erase", "🧽", "Eraser (E)"], ["line", "╱", "Line"], ["arrow", "➚", "Arrow (A)"], ["rect", "▭", "Box"], ["ellipse", "◯", "Circle"], ["text", "T", "Text (X)"]];
  function bar() {
    if (!el) return;
    const b = el.querySelector(".bd-bar"), pal = dark() ? CHALK : COLORS, p = page();
    b.innerHTML = `<div class="bd-grp">${TOOLS.map(([k, ic, t]) => `<button type="button" data-tool="${k}" aria-pressed="${tool === k}" title="${t}" aria-label="${t}">${ic}</button>`).join("")}</div>
      <div class="bd-grp">${pal.map((c, i) => `<button type="button" class="bd-sw" data-col="${i}" style="--c:${c}" aria-pressed="${color === i}" aria-label="Colour ${i + 1}"></button>`).join("")}</div>
      <div class="bd-grp">${SIZES.map((s, i) => `<button type="button" data-size="${i}" aria-pressed="${size === i}" aria-label="Size ${i + 1}"><i style="width:${4 + i * 5}px;height:${4 + i * 5}px"></i></button>`).join("")}
        <button type="button" data-x="tidy" aria-pressed="${tidy}" title="Tidy shapes: rough lines, boxes and circles become clean ones">✨ Tidy</button></div>
      <div class="bd-grp"><button type="button" data-x="undo" title="Undo (Ctrl+Z)" ${p.hist?.length ? "" : "disabled"}>↶</button><button type="button" data-x="redo" title="Redo" ${p.redo.length ? "" : "disabled"}>↷</button>
        <button type="button" data-x="clear" title="Clear this page" ${p.strokes.length ? "" : "disabled"}>🗑</button></div>
      <div class="bd-grp"><button type="button" data-x="prev" ${at ? "" : "disabled"} aria-label="Previous page">◀</button><span class="bd-pg">${at + 1} / ${pages.length}</span><button type="button" data-x="next" ${at < pages.length - 1 ? "" : "disabled"} aria-label="Next page">▶</button>
        <button type="button" data-x="add" title="New page">＋ Page</button>${opts.slideNow && opts.slideNow() ? `<button type="button" data-x="onslide" title="A new page over the slide on screen">On slide ${opts.slideNow()}</button>` : ""}</div>
      <div class="bd-grp"><select data-x="bg" aria-label="Background">${[["white", "White"], ["grid", "Grid"], ["dark", "Chalkboard"]].concat(p.bg === "slide" ? [["slide", "Slide " + p.slide]] : []).map(([v, t]) => `<option value="${v}" ${p.bg === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="bd-grp"><button type="button" data-x="share" title="Send this page to phones">Share</button><button type="button" data-x="png" title="Download this page">⬇</button><button type="button" data-x="close" class="bd-close" title="Close the board (Esc)">Close ✕</button></div>`;
    b.querySelectorAll("[data-tool]").forEach(x => x.onclick = () => { tool = x.dataset.tool; bar(); });
    b.querySelectorAll("[data-col]").forEach(x => x.onclick = () => { color = +x.dataset.col; if (tool === "erase") tool = "pen"; bar(); });
    b.querySelectorAll("[data-size]").forEach(x => x.onclick = () => { size = +x.dataset.size; bar(); });
    const A = {
      tidy: () => { tidy = !tidy; bar(); }, undo, redo, clear: clearPage, prev: () => go(at - 1), next: () => go(at + 1), add: () => addPage(),
      onslide: () => addPage("slide", opts.slideNow()), close, png: () => { snapshot(2000).toBlob(bl => { const a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = `Board page ${at + 1}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, "image/png"); },
      share: () => shareMenu(b.querySelector('[data-x="share"]'))
    };
    b.querySelectorAll("button[data-x]").forEach(x => x.onclick = () => A[x.dataset.x]?.());
    b.querySelector('select[data-x="bg"]').onchange = e => { const was = dark(); p.bg = e.target.value; if (was !== dark()) color = Math.min(color, 5); ensureSlide(p); paint(); save(); bar(); };
    cv.style.cursor = tool === "erase" ? "cell" : tool === "text" ? "text" : "crosshair";
  }
  function shareMenu(btn) {
    const m = el.querySelector(".bd-menu"); if (!m.hidden) { m.hidden = true; return; }
    m.innerHTML = `<b>Send page ${at + 1} to phones</b><div class="row"><button type="button" class="btn ghost small" data-t="A">Group A</button><button type="button" class="btn red small" data-t="all">Everyone</button><button type="button" class="btn ghost small" data-t="B">Group B</button></div><span class="small" data-msg></span>`;
    const r = btn.getBoundingClientRect(), pr = el.getBoundingClientRect(); m.style.top = r.bottom - pr.top + 8 + "px"; m.style.right = Math.max(8, pr.right - r.right) + "px"; m.hidden = false;
    m.querySelectorAll("[data-t]").forEach(x => x.onclick = async () => {
      const msg = m.querySelector("[data-msg]"); msg.textContent = "Sending…";
      try { const blob = await new Promise(res => snapshot(1600).toBlob(res, "image/jpeg", 0.88)); await opts.share(blob, `Board · page ${at + 1}`, x.dataset.t); msg.textContent = `Sent to ${x.dataset.t === "all" ? "everyone" : "Group " + x.dataset.t} ✓`; setTimeout(() => (m.hidden = true), 1400); }
      catch (e) { msg.textContent = e.message || "Couldn't send."; }
    });
  }

  // ---------- open and close ----------
  function keys(e) {
    if (!open || e.target.closest("textarea,input,select")) return;
    const typing = el.querySelector(".bd-text"); if (typing) { typing.focus(); return; }   // a text box is waiting: letters go there
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === "y") { e.preventDefault(); redo(); }
    else if (e.key === "Escape") close();
    else if (!mod && { p: "pen", h: "hl", e: "erase", a: "arrow", x: "text" }[k]) { tool = { p: "pen", h: "hl", e: "erase", a: "arrow", x: "text" }[k]; bar(); }
    else if (e.key === "ArrowRight" || e.key === "PageDown") go(at + 1);
    else if (e.key === "ArrowLeft" || e.key === "PageUp") go(at - 1);
    else return;
    e.stopImmediatePropagation(); e.preventDefault();
  }
  // o: { host, id, slideNow() → slide number or 0, slideImage(n) → canvas, share(blob, name, target), onClose() }
  function show(o) {
    opts = o;
    if (!el) {
      el = document.createElement("div"); el.className = "bd"; el.hidden = true;
      el.innerHTML = `<div class="bd-bar" role="toolbar" aria-label="Board tools"></div><div class="bd-paper"><canvas aria-label="Writing board"></canvas></div><div class="bd-menu" hidden></div>`;
      o.host.appendChild(el); cv = el.querySelector("canvas"); g = cv.getContext("2d");
      cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      new ResizeObserver(() => open && fit()).observe(el.querySelector(".bd-paper"));
      addEventListener("resize", () => open && fit());
      document.addEventListener("keydown", keys, true);
    }
    if (!pages.length || el.dataset.id !== String(o.id)) { load(); el.dataset.id = o.id; }
    el.hidden = false; open = true; fit(); ensureSlide(page()); bar();
  }
  function close() { if (!el || !open) return; el.hidden = true; open = false; el.querySelector(".bd-menu").hidden = true; opts?.onClose && opts.onClose(); }
  return { show, close, isOpen: () => open, page: d => go(at + d), _state: () => ({ pages, at, tool }) };
})();
