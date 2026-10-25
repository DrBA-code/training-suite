// Training Suite certificates: draws a certificate (preset templates or the lead's own design) on a canvas,
// with logo, two signatures, number and QR code, and turns certificates into A4 landscape PDFs.
// Shared by the planner's pages, participants' phones and the public check page.
window.TSC = (() => {
  "use strict";
  const BASE = new URL(".", (document.currentScript && document.currentScript.src) || location.href).href;
  const TEMPLATES = [
    { id: "classic", name: "Classic", line: "Double frame, serif", accent: "#B8902F" },
    { id: "modern", name: "Modern", line: "Colour band, left aligned", accent: "#1F5FBF" },
    { id: "bold", name: "Bold", line: "Colour header", accent: "#D2391F" },
    { id: "elegant", name: "Elegant", line: "Deep navy and gold", accent: "#C9A227" },
    { id: "minimal", name: "Minimal", line: "White, thin line", accent: "#0F7B5F" },
    { id: "upload", name: "Your own design", line: "Upload a PDF or image", accent: "#16181D" }
  ];
  const SWATCHES = ["#B8902F", "#C9A227", "#D2391F", "#C2410C", "#1F5FBF", "#0E7490", "#0F7B5F", "#6D3FC0", "#16181D"];
  const KINDS = {
    completion: { title: "Certificate of Completion", verb: "has successfully completed" },
    attendance: { title: "Certificate of Attendance", verb: "attended" },
    participation: { title: "Certificate of Participation", verb: "participated in" },
    achievement: { title: "Certificate of Achievement", verb: "has successfully completed, with distinction," }
  };
  const W1 = 1000, H1 = W1 / Math.SQRT2; // drawing space: A4 landscape
  const INK = "#16181D", MUTED = "#5B6170";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function defaults(o = {}) {
    return {
      template: "classic", accent: TEMPLATES[0].accent, kind: "completion", title: "", org: o.org || "", logo: "",
      signatories: [{ name: "", title: "Head of Institution", sig: "" }, { name: o.lead || "", title: "Programme Lead", sig: "" }],
      upload: "", layout: { name: { x: 0.5, y: 0.47, size: 1, color: INK }, qr: { x: 0.87, y: 0.8, size: 1 } }
    };
  }
  // Older designs only had { template }: fill in the rest.
  function normal(d, o) {
    const base = defaults(o), x = { ...base, ...(d || {}) };
    if (!TEMPLATES.some(t => t.id === x.template)) x.template = "classic";
    if (x.template === "upload" && !/^(https?:|data:|blob:|\/)/.test(x.upload || "")) x.template = "classic";
    if (!d || !d.accent) x.accent = (TEMPLATES.find(t => t.id === x.template) || TEMPLATES[0]).accent;
    x.signatories = [0, 1].map(i => ({ ...base.signatories[i], ...((d && d.signatories && d.signatories[i]) || {}) }));
    x.layout = { name: { ...base.layout.name, ...(d?.layout?.name || {}) }, qr: { ...base.layout.qr, ...(d?.layout?.qr || {}) } };
    if (!KINDS[x.kind]) x.kind = "completion";
    return x;
  }
  const titleOf = d => (d.title || "").trim() || KINDS[d.kind || "completion"].title;
  const verbOf = d => KINDS[d.kind || "completion"].verb;

  const dmy = s => { const d = new Date(String(s).slice(0, 10) + "T00:00:00"); return isNaN(d) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  function datesText(info) {
    if (!info) return "";
    if (String(info.dates || "").trim()) return String(info.dates).trim();
    const a = info.first, b = info.last; if (!a) return "";
    if (!b || a === b) return dmy(a);
    const A = new Date(a + "T00:00:00"), B = new Date(b + "T00:00:00");
    if (A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth()) return `${A.getDate()} – ${dmy(b)}`;
    if (A.getFullYear() === B.getFullYear()) return `${A.getDate()} ${MONTHS[A.getMonth()]} – ${dmy(b)}`;
    return `${dmy(a)} – ${dmy(b)}`;
  }
  const verifyUrl = n => BASE + "verify/#" + encodeURIComponent(n || "");

  // ---------- images and fonts ----------
  const cache = new Map();
  function img(url) {
    if (!url) return Promise.resolve(null);
    if (!cache.has(url)) cache.set(url, new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => { cache.delete(url); res(null); }; i.src = url; }));
    return cache.get(url);
  }
  let fontsReady = null;
  const fonts = () => fontsReady || (fontsReady = Promise.all(['600 40px "Playfair Display"', '700 40px "Playfair Display"', 'italic 600 40px "Playfair Display"', '800 40px "Bricolage Grotesque"', '700 40px "Bricolage Grotesque"',
    '400 20px "Plus Jakarta Sans"', '600 20px "Plus Jakarta Sans"', '700 20px "Plus Jakarta Sans"', '500 20px "JetBrains Mono"'].map(f => document.fonts?.load(f).catch(() => {}))).catch(() => {}));

  // ---------- drawing helpers (all in the 1000 × 707 space) ----------
  const SERIF = '"Playfair Display", Georgia, serif', SANS = '"Plus Jakarta Sans", Arial, sans-serif', DISP = '"Bricolage Grotesque", "Plus Jakarta Sans", Arial, sans-serif', MONO = '"JetBrains Mono", ui-monospace, monospace';
  function text(g, s, x, y, { font, size, color = INK, align = "center", max = 0, spacing = 0, weight = "", style = "" }) {
    s = String(s || ""); if (!s) return;
    let sz = size;
    const set = () => { g.font = `${style} ${weight} ${sz}px ${font}`.trim(); };
    set();
    const width = () => g.measureText(s).width + spacing * Math.max(0, s.length - 1);
    if (max) while (width() > max && sz > size * 0.45) { sz -= 1; set(); }
    g.fillStyle = color; g.textBaseline = "alphabetic";
    if (!spacing) { g.textAlign = align; g.fillText(s, x, y); return; }
    const w = width(); let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    g.textAlign = "left";
    for (const ch of s) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + spacing; }
  }
  function fitImg(g, im, x, y, w, h, align = "center") { // inside the box, keeping its shape
    if (!im) return 0;
    const s = Math.min(w / im.width, h / im.height), iw = im.width * s, ih = im.height * s;
    const ix = align === "left" ? x : align === "right" ? x + w - iw : x + (w - iw) / 2;
    g.drawImage(im, ix, y + (h - ih) / 2, iw, ih); return iw;
  }
  function tint(im, color) { // a dark signature, recoloured for a dark background
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const x = c.getContext("2d"); x.drawImage(im, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); return c;
  }
  function qr(g, data, x, y, size, dark = INK, light = "#fff") {
    if (!window.qrcode) return;
    const q = window.qrcode(0, "M"); q.addData(data); q.make();
    const n = q.getModuleCount(), m = size / (n + 2);
    g.fillStyle = light; g.fillRect(x, y, size, size); g.fillStyle = dark;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect(x + (c + 1) * m, y + (r + 1) * m, m + 0.05, m + 0.05);
  }
  async function sigs(g, d, y, xs, w, { line = INK, color = INK, muted = MUTED, ink = null } = {}) {
    const list = d.signatories.filter(s => (s.name || "").trim() || s.sig);
    const at = list.length === 1 ? [(xs[0] + xs[1]) / 2] : xs;
    for (let i = 0; i < list.length; i++) {
      const s = list[i], cx = at[i];
      let im = await img(s.sig); if (im && ink) im = tint(im, ink);
      if (im) fitImg(g, im, cx - w / 2, y - 62, w, 56);
      g.strokeStyle = line; g.lineWidth = 0.9; g.beginPath(); g.moveTo(cx - w / 2, y); g.lineTo(cx + w / 2, y); g.stroke();
      text(g, s.name, cx, y + 20, { font: SANS, weight: 700, size: 13.5, color, max: w + 30 });
      text(g, s.title, cx, y + 38, { font: SANS, size: 11.5, color: muted, max: w + 30 });
    }
  }
  function numberAndQr(g, data, x, y, size, { color = MUTED, dark = INK, light = "#fff", align = "center" } = {}) {
    qr(g, verifyUrl(data.number), x - size / 2, y, size, dark, light);
    text(g, data.number, x, y + size + 15, { font: MONO, weight: 500, size: 10, color, align });
    if (data.issued) text(g, "Issued " + data.issued, x, y + size + 29, { font: SANS, size: 9.5, color, align });
  }

  // ---------- templates ----------
  const T = {};
  T.classic = async (g, d, data, A) => {
    g.fillStyle = "#FFFDF7"; g.fillRect(0, 0, W1, H1);
    g.strokeStyle = A; g.lineWidth = 6; g.strokeRect(22, 22, W1 - 44, H1 - 44);
    g.lineWidth = 1.4; g.strokeRect(36, 36, W1 - 72, H1 - 72);
    g.fillStyle = A; for (const [x, y] of [[36, 36], [W1 - 36, 36], [36, H1 - 36], [W1 - 36, H1 - 36]]) { g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore(); }
    await top(g, d, 62, 64, 152);
    text(g, titleOf(d).toUpperCase(), W1 / 2, 206, { font: SERIF, weight: 700, size: 34, color: A, spacing: 3, max: 820 });
    body(g, d, data, { y: 258, nameFont: SERIF, nameStyle: "italic", nameWeight: 600, nameSize: 60, line: A, progColor: INK });
    await sigs(g, d, 600, [255, 745], 220);
    numberAndQr(g, data, W1 / 2, 528, 74);
  };
  T.modern = async (g, d, data, A) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, W1, H1);
    g.fillStyle = A; g.fillRect(0, 0, 70, H1);
    g.globalAlpha = 0.14; g.beginPath(); g.moveTo(70, 0); g.lineTo(150, 0); g.lineTo(70, 120); g.closePath(); g.fill(); g.globalAlpha = 1;
    const L = 120, logo = await img(d.logo);
    const lw = logo ? fitImg(g, logo, L, 50, 200, 58, "left") : 0;
    text(g, (d.org || "").toUpperCase(), L + (lw ? lw + 16 : 0), 86, { font: SANS, weight: 700, size: 12.5, color: MUTED, align: "left", spacing: 1.6, max: 760 - lw });
    const t = titleOf(d), cut = t.toLowerCase().startsWith("certificate of ") ? 15 : 0;
    text(g, (cut ? "CERTIFICATE OF" : "CERTIFICATE"), L, 168, { font: SANS, weight: 700, size: 15, color: A, align: "left", spacing: 4 });
    text(g, cut ? t.slice(cut) : t, L, 222, { font: DISP, weight: 800, size: 52, align: "left", max: 820 });
    text(g, "This is to certify that", L, 282, { font: SANS, size: 16, color: MUTED, align: "left" });
    text(g, data.name, L, 350, { font: DISP, weight: 800, size: 56, align: "left", max: 820 });
    g.fillStyle = A; g.fillRect(L, 368, 90, 5);
    text(g, verbOf(d), L, 404, { font: SANS, size: 16, color: MUTED, align: "left" });
    text(g, data.programme, L, 440, { font: DISP, weight: 700, size: 26, align: "left", max: 820 });
    text(g, [data.dates, data.venue].filter(Boolean).join("  ·  "), L, 472, { font: SANS, size: 14, color: MUTED, align: "left", max: 820 });
    await sigs(g, d, 610, [235, 505], 210);
    numberAndQr(g, data, 860, 520, 84);
  };
  T.bold = async (g, d, data, A) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, W1, H1);
    g.fillStyle = A; g.fillRect(0, 0, W1, 168); g.fillRect(0, H1 - 10, W1, 10);
    g.globalAlpha = 0.18; g.fillStyle = "#fff"; g.beginPath(); g.arc(W1 - 40, 10, 150, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(60, 168, 70, Math.PI, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    const t = titleOf(d), cut = t.toLowerCase().startsWith("certificate of ") ? 15 : 0;
    text(g, cut ? "CERTIFICATE OF" : "CERTIFICATE", W1 / 2, 54, { font: SANS, weight: 700, size: 15, color: "#fff", spacing: 5 });
    text(g, cut ? t.slice(cut) : t, W1 / 2, 108, { font: DISP, weight: 800, size: 50, color: "#fff", max: 860 });
    const logo = await img(d.logo);
    if (logo) { g.fillStyle = "#fff"; g.beginPath(); g.arc(W1 / 2, 168, 44, 0, Math.PI * 2); g.fill(); g.strokeStyle = A; g.lineWidth = 3; g.stroke(); fitImg(g, logo, W1 / 2 - 30, 140, 60, 56); }
    text(g, (d.org || "").toUpperCase(), W1 / 2, logo ? 240 : 222, { font: SANS, weight: 700, size: 12.5, color: MUTED, spacing: 1.6, max: 820 });
    body(g, d, data, { y: 282, nameFont: DISP, nameWeight: 800, nameSize: 56, line: A, progColor: A });
    await sigs(g, d, 608, [255, 745], 220);
    numberAndQr(g, data, W1 / 2, 530, 72);
  };
  T.elegant = async (g, d, data, A) => {
    const CREAM = "#F6F0E1", SOFT = "#B9C1D4";
    g.fillStyle = "#15233F"; g.fillRect(0, 0, W1, H1);
    g.strokeStyle = A; g.lineWidth = 2.2; g.strokeRect(26, 26, W1 - 52, H1 - 52); g.lineWidth = 0.8; g.strokeRect(36, 36, W1 - 72, H1 - 72);
    for (const [x, y, sx, sy] of [[36, 36, 1, 1], [W1 - 36, 36, -1, 1], [36, H1 - 36, 1, -1], [W1 - 36, H1 - 36, -1, -1]]) {
      g.beginPath(); g.moveTo(x, y + sy * 46); g.lineTo(x, y); g.lineTo(x + sx * 46, y); g.lineWidth = 3; g.stroke();
    }
    const logo = await img(d.logo);
    if (logo) { g.fillStyle = CREAM; rr(g, W1 / 2 - 60, 54, 120, 72, 10); g.fill(); fitImg(g, logo, W1 / 2 - 50, 60, 100, 60); }
    text(g, (d.org || "").toUpperCase(), W1 / 2, 156, { font: SANS, weight: 700, size: 12.5, color: SOFT, spacing: 2, max: 820 });
    text(g, titleOf(d).toUpperCase(), W1 / 2, 208, { font: SERIF, weight: 700, size: 34, color: A, spacing: 3, max: 820 });
    body(g, d, data, { y: 258, nameFont: SERIF, nameStyle: "italic", nameWeight: 600, nameSize: 60, nameColor: CREAM, line: A, progColor: CREAM, muted: SOFT });
    await sigs(g, d, 600, [255, 745], 220, { line: A, color: CREAM, muted: SOFT, ink: CREAM });
    numberAndQr(g, data, W1 / 2, 528, 74, { color: SOFT, dark: "#15233F", light: CREAM });
  };
  T.minimal = async (g, d, data, A) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, W1, H1);
    g.strokeStyle = "#E1E4E8"; g.lineWidth = 1.2; g.strokeRect(30, 30, W1 - 60, H1 - 60);
    await top(g, d, 60, 64, 150);
    g.fillStyle = A; g.fillRect(W1 / 2 - 28, 168, 56, 4);
    text(g, titleOf(d), W1 / 2, 222, { font: DISP, weight: 700, size: 38, max: 820 });
    body(g, d, data, { y: 270, nameFont: DISP, nameWeight: 700, nameSize: 54, line: null, progColor: INK });
    await sigs(g, d, 604, [255, 745], 220);
    numberAndQr(g, data, W1 / 2, 530, 70);
  };
  T.upload = async (g, d, data) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, W1, H1);
    const bg = await img(d.upload);
    if (bg) { const s = Math.min(W1 / bg.width, H1 / bg.height); g.drawImage(bg, (W1 - bg.width * s) / 2, (H1 - bg.height * s) / 2, bg.width * s, bg.height * s); }
    else text(g, "Upload your design", W1 / 2, H1 / 2 - 60, { font: SANS, size: 18, color: MUTED });
    const n = d.layout.name, q = d.layout.qr;
    text(g, data.name, n.x * W1, n.y * H1 + 20 * n.size, { font: SERIF, style: "italic", weight: 600, size: 58 * n.size, color: n.color || INK, max: 760 });
    const qs = 76 * q.size; numberAndQr(g, data, q.x * W1, q.y * H1 - qs / 2, qs, { color: n.color || INK });
  };
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  async function top(g, d, y, h, orgY) {
    const logo = await img(d.logo);
    if (logo) fitImg(g, logo, W1 / 2 - 150, y, 300, h);
    text(g, (d.org || "").toUpperCase(), W1 / 2, logo ? orgY : orgY - 50, { font: SANS, weight: 700, size: 12.5, color: MUTED, spacing: 2, max: 820 });
  }
  function body(g, d, data, o) {
    const m = o.muted || MUTED;
    text(g, "This is to certify that", W1 / 2, o.y, { font: SANS, size: 16, color: m });
    text(g, data.name, W1 / 2, o.y + 72, { font: o.nameFont, style: o.nameStyle || "", weight: o.nameWeight, size: o.nameSize, color: o.nameColor || INK, max: 820 });
    if (o.line) { g.strokeStyle = o.line; g.lineWidth = 1.4; g.beginPath(); g.moveTo(W1 / 2 - 250, o.y + 92); g.lineTo(W1 / 2 + 250, o.y + 92); g.stroke(); }
    text(g, verbOf(d), W1 / 2, o.y + 128, { font: SANS, size: 16, color: m });
    text(g, data.programme, W1 / 2, o.y + 166, { font: DISP, weight: 700, size: 27, color: o.progColor, max: 840 });
    text(g, [data.dates, data.venue].filter(Boolean).join("  ·  "), W1 / 2, o.y + 198, { font: SANS, size: 14, color: m, max: 840 });
  }

  // data: { name, number, programme, dates, venue, issued }
  async function render(design, data, width = 1000, canvas) {
    await fonts();
    const d = normal(design), c = canvas || document.createElement("canvas");
    c.width = Math.round(width); c.height = Math.round(width / Math.SQRT2);
    const g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.scale(width / W1, width / W1);
    await (T[d.template] || T.classic)(g, d, data, d.accent || INK);
    return c;
  }
  // From a stored certificate row (number, name, issued_at, design, info).
  const dataOf = c => ({ name: c.name, number: c.number, programme: c.info?.programme || "", dates: datesText(c.info), venue: c.info?.venue || "", issued: c.issued_at ? dmy(c.issued_at) : "" });
  const sample = (info, name) => ({ name: name || "Ada Obi", number: "TS-" + new Date().getFullYear() + "-SAMPLE", programme: info?.programme || "Programme name", dates: datesText(info) || dmy(new Date().toISOString()), venue: info?.venue || "", issued: dmy(new Date().toISOString()) });

  let jsPdf = null;
  function loadPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
    return jsPdf || (jsPdf = new Promise((res, rej) => { const s = document.createElement("script"); s.src = BASE + "vendor/jspdf.umd.min.js"; s.onload = () => res(window.jspdf.jsPDF); s.onerror = () => { jsPdf = null; rej(new Error("Couldn't load the PDF maker. Check the connection.")); }; document.head.appendChild(s); }));
  }
  // items: [{ design, data }] → one PDF, a page each
  async function pdf(items, filename, onProgress) {
    const J = await loadPdf(), doc = new J({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const c = document.createElement("canvas");
    for (let i = 0; i < items.length; i++) {
      await render(items[i].design, items[i].data, 2480, c);
      if (i) doc.addPage("a4", "landscape");
      doc.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 297, 210, undefined, "FAST");
      onProgress && onProgress(i + 1, items.length);
    }
    doc.save(filename);
  }
  const fileName = s => String(s || "certificate").replace(/[^\w\- .]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "certificate";
  return { TEMPLATES, SWATCHES, KINDS, defaults, normal, titleOf, datesText, dmy, verifyUrl, render, dataOf, sample, pdf, fileName, img };
})();
