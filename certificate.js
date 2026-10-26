// Training Suite certificates: draws a certificate (preset templates or the lead's own design) on a canvas,
// with logo, two signatures, number and QR code, and turns certificates into A4 landscape PDFs.
// Shared by the planner's pages, participants' phones and the public check page.
window.TSC = (() => {
  "use strict";
  const BASE = new URL(".", (document.currentScript && document.currentScript.src) || location.href).href;
  const TEMPLATES = [
    { id: "ribbon", name: "Ribbon", line: "Flowing lines, gold seal", accent: "#1E4A93" },
    { id: "grid", name: "Grid", line: "Pattern corners, bold heading", accent: "#4B2A8C" },
    { id: "block", name: "Block", line: "Colour panel and shapes", accent: "#1565E0" },
    { id: "split", name: "Split", line: "Two tones, verify stamp", accent: "#3A9BB0" },
    { id: "modern", name: "Modern", line: "Colour band, left aligned", accent: "#1F5FBF" },
    { id: "upload", name: "Your own design", line: "Upload a PDF or image", accent: "#16181D" }
  ];
  // Earlier designs: still drawn for certificates already issued with them, no longer offered.
  const LEGACY = [{ id: "classic", accent: "#B8902F" }, { id: "bold", accent: "#D2391F" }, { id: "elegant", accent: "#C9A227" }, { id: "minimal", accent: "#0F7B5F" }];
  const SWATCHES = ["#1E4A93", "#1565E0", "#3A9BB0", "#0F7B5F", "#4B2A8C", "#B8902F", "#D2391F", "#C2410C", "#16181D"];
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
      template: "ribbon", accent: TEMPLATES[0].accent, seal: true, logo2: "", kind: "completion", title: "", org: o.org || "", logo: "",
      signatories: [{ name: "", title: "Head of Institution", sig: "" }, { name: o.lead || "", title: "Programme Lead", sig: "" }],
      upload: "", layout: { name: { x: 0.5, y: 0.47, size: 1, color: INK }, qr: { x: 0.87, y: 0.8, size: 1 } }
    };
  }
  // Older designs only had { template }: fill in the rest.
  function normal(d, o) {
    const base = defaults(o), x = { ...base, ...(d || {}) };
    const all = TEMPLATES.concat(LEGACY);
    if (!all.some(t => t.id === x.template)) x.template = "ribbon";
    if (x.template === "upload" && !/^(https?:|data:|blob:|\/)/.test(x.upload || "")) x.template = "ribbon";
    if (!d || !d.accent) x.accent = (all.find(t => t.id === x.template) || TEMPLATES[0]).accent;
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
    '400 20px "Plus Jakarta Sans"', '600 20px "Plus Jakarta Sans"', '700 20px "Plus Jakarta Sans"', '500 20px "JetBrains Mono"', '300 40px "Montserrat"', '500 20px "Montserrat"', '600 20px "Montserrat"', '700 40px "Montserrat"', '800 40px "Montserrat"', '400 40px "Marcellus"'].map(f => document.fonts?.load(f).catch(() => {}))).catch(() => {}));

  // ---------- drawing helpers (all in the 1000 × 707 space) ----------
  const MONT = '"Montserrat", "Plus Jakarta Sans", Arial, sans-serif', MARC = '"Marcellus", "Playfair Display", Georgia, serif';
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

  // ---------- helpers for the newer templates ----------
  const hex = c => { const m = String(c || "#000").replace("#", ""); const v = m.length === 3 ? m.split("").map(x => x + x).join("") : m.padEnd(6, "0"); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) || 0); };
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return "rgb(" + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",") + ")"; };
  const rgba = (c, al) => "rgba(" + hex(c).join(",") + "," + al + ")";
  function lines(g, s, { font, size, weight = "", style = "" }, max, most = 2) {
    g.font = `${style} ${weight} ${size}px ${font}`.trim();
    const words = String(s || "").split(/\s+/).filter(Boolean), out = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width <= max || !cur) cur = t; else { out.push(cur); cur = w; } }
    if (cur) out.push(cur);
    if (out.length > most) { const rest = out.splice(most - 1).join(" "); out.push(rest); }
    return out;
  }
  // A block of wrapped text; shrinks until it fits the number of lines. Returns the y after the last line.
  function para(g, s, x, y, o, max, most = 2, lh = 1.22) {
    let size = o.size, ls;
    while (true) { ls = lines(g, s, { ...o, size }, max, most); g.font = `${o.style || ""} ${o.weight || ""} ${size}px ${o.font}`.trim(); if (ls.every(l => g.measureText(l).width <= max) || size < o.size * 0.55) break; size -= 1; }
    ls.forEach((l, i) => text(g, l, x, y + i * size * lh, { ...o, size, max }));
    return y + (ls.length - 1) * size * lh;
  }
  // One signature: image, line, name, title. align "left" or "center"; titleAbove puts the role over the signature.
  async function sig1(g, s, x, y, w, { align = "center", color = INK, muted = MUTED, line = INK, titleAbove = false } = {}) {
    const im = await img(s.sig), lx = align === "left" ? x : x - w / 2;
    if (titleAbove) text(g, s.title, align === "left" ? x : x, y - 72, { font: MONT, weight: 500, size: 11, color: muted, align, max: w + 40 });
    if (im) fitImg(g, im, lx, y - 60, w, 54, align === "left" ? "left" : "center");
    g.strokeStyle = line; g.lineWidth = 0.8; g.beginPath(); g.moveTo(lx, y); g.lineTo(lx + w, y); g.stroke();
    text(g, s.name, align === "left" ? x : x, y + 18, { font: MONT, weight: 600, size: 12.5, color, align, max: w + 40 });
    if (!titleAbove) text(g, s.title, align === "left" ? x : x, y + 34, { font: MONT, size: 10.5, color: muted, align, max: w + 40 });
  }
  async function sigPair(g, d, y, xs, w, o) {
    const list = d.signatories.filter(s => (s.name || "").trim() || s.sig);
    const at = list.length === 1 && o?.align !== "left" ? [(xs[0] + xs[1]) / 2] : xs;
    for (let i = 0; i < list.length; i++) await sig1(g, list[i], at[i], y, w, o);
  }
  async function logos(g, d, x, y, h, { gap = 16, org = true, orgColor = INK, orgSize = 12, maxW = 520 } = {}) {
    const a = await img(d.logo), b = await img(d.logo2); let cx = x;
    if (a) cx += fitImg(g, a, cx, y, h * 2.4, h, "left") + gap;
    if (org && d.org) {
      const ls = lines(g, d.org.toUpperCase(), { font: MONT, size: orgSize, weight: 600 }, 190, 3);
      ls.forEach((l, i) => text(g, l, cx, y + h / 2 - (ls.length - 1) * orgSize * 0.62 + i * orgSize * 1.24 + orgSize * 0.36, { font: MONT, weight: 600, size: orgSize, color: orgColor, align: "left" }));
      g.font = `600 ${orgSize}px ${MONT}`; cx += Math.max(...ls.map(l => g.measureText(l).width)) + gap * 1.6;
    }
    if (b && cx - x < maxW) fitImg(g, b, cx, y, Math.min(h * 2.4, x + maxW - cx), h, "left");
  }
  function seal(g, cx, cy, r) {
    g.save();
    g.fillStyle = "#A8761E";
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * r * 0.18, cy + r * 0.55); g.lineTo(cx + sx * r * 0.62, cy + r * 1.5); g.lineTo(cx + sx * r * 0.42, cy + r * 1.36); g.lineTo(cx + sx * r * 0.3, cy + r * 1.6); g.lineTo(cx - sx * r * 0.12, cy + r * 0.62); g.closePath(); g.fill(); }
    g.beginPath();
    for (let k = 0; k <= 360; k++) { const t = k * Math.PI / 180, rr2 = r * (1 + 0.055 * Math.cos(30 * t)); g.lineTo(cx + rr2 * Math.cos(t), cy + rr2 * Math.sin(t)); }
    const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.05); gr.addColorStop(0, "#FBE7A1"); gr.addColorStop(0.5, "#E1B04A"); gr.addColorStop(1, "#AD7A22");
    g.fillStyle = gr; g.fill();
    g.strokeStyle = "rgba(255,244,200,.85)"; g.lineWidth = 1.4; g.beginPath(); g.arc(cx, cy, r * 0.8, 0, Math.PI * 2); g.stroke();
    const gi = g.createRadialGradient(cx + r * 0.2, cy + r * 0.25, r * 0.05, cx, cy, r * 0.75); gi.addColorStop(0, "#E9BE5C"); gi.addColorStop(1, "#B98428");
    g.fillStyle = gi; g.beginPath(); g.arc(cx, cy, r * 0.72, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(122,82,14,.55)";
    for (const sx of [-1, 1]) for (let k = 0; k < 7; k++) {
      const t = Math.PI / 2 + sx * (0.45 + k * 0.26), lx = cx + Math.cos(t) * r * 0.58, ly = cy + Math.sin(t) * r * 0.58;
      g.save(); g.translate(lx, ly); g.rotate(t + sx * 0.9); g.beginPath(); g.ellipse(0, 0, r * 0.09, r * 0.035, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    g.fillStyle = "rgba(122,82,14,.85)"; g.beginPath();
    for (let k = 0; k < 10; k++) { const t = -Math.PI / 2 + k * Math.PI / 5, rr2 = k % 2 ? r * 0.12 : r * 0.3; g.lineTo(cx + rr2 * Math.cos(t), cy + rr2 * Math.sin(t)); }
    g.closePath(); g.fill();
    g.restore();
  }
  function ringText(g, s, cx, cy, r, { size = 9, color = INK } = {}) {
    g.save(); g.font = `600 ${size}px ${MONT}`; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    const chars = [...s], step = (Math.PI * 2) / chars.length;
    chars.forEach((ch, i) => { const t = -Math.PI / 2 + i * step; g.save(); g.translate(cx + r * Math.cos(t), cy + r * Math.sin(t)); g.rotate(t + Math.PI / 2); g.fillText(ch, 0, 0); g.restore(); });
    g.restore();
  }
  const kindWord = d => { const t = titleOf(d); return t.toLowerCase().startsWith("certificate ") ? t.slice(12) : t; };
  const footer = (data) => [data.dates, data.venue].filter(Boolean).join("  ·  ");

  // Ribbon: soft tinted paper, flowing lines on the left, content on the right, gold seal.
  T.ribbon = async (g, d, data, A) => {
    g.fillStyle = mix(A, "#ffffff", 0.95); g.fillRect(0, 0, W1, H1);
    g.save(); g.beginPath(); g.rect(0, 0, 380, H1); g.clip();
    // a twisting ribbon of fine lines: wide at the top, pinched low on the left, opening again at the foot
    for (let i = 0; i <= 90; i++) {
      const t = i / 90, f = 1 - Math.abs(t - 0.5) * 2, al = 0.09 + 0.3 * Math.pow(f, 1.2);
      g.strokeStyle = rgba(A, al); g.lineWidth = 0.65;
      g.beginPath(); g.moveTo(-80 + t * 420, -10);
      g.bezierCurveTo(330 - t * 300, H1 * 0.22, 250 - t * 120, H1 * 0.48, 150 + (t - 0.5) * 30, H1 * 0.64);
      g.bezierCurveTo(70 + t * 60, H1 * 0.76, 30 + t * 140, H1 * 0.9, -20 + t * 380, H1 + 10); g.stroke();
    }
    g.restore();
    g.strokeStyle = rgba(A, 0.75); g.lineWidth = 1.3; g.strokeRect(16, 16, W1 - 32, H1 - 32);
    g.strokeStyle = rgba(A, 0.4); g.lineWidth = 0.6; g.strokeRect(24, 24, W1 - 48, H1 - 48);
    const X = 395, ink = mix(A, "#0B1530", 0.45);
    await logos(g, d, X, 52, 52, { orgColor: ink });
    text(g, titleOf(d).toUpperCase(), X, 166, { font: MONT, weight: 600, size: 12.5, color: A, align: "left", spacing: 3.2, max: 520 });
    text(g, data.name, X, 236, { font: MARC, size: 56, color: ink, align: "left", max: 530 });
    g.strokeStyle = rgba(A, 0.55); g.lineWidth = 1; g.beginPath(); g.moveTo(X, 262); g.lineTo(X + 460, 262); g.stroke();
    text(g, verbOf(d).replace(/^has /, "Has "), X, 308, { font: SANS, size: 15.5, color: MUTED, align: "left" });
    const yEnd = para(g, data.programme, X, 352, { font: MARC, size: 33, color: A, align: "left" }, 520, 2, 1.2);
    text(g, footer(data), X, yEnd + 34, { font: SANS, size: 13, color: MUTED, align: "left", max: 520 });
    await sigPair(g, d, 548, [X, X + 200], 150, { align: "left", color: INK, line: rgba(A, 0.7) });
    if (d.seal !== false) seal(g, 845, 512, 54);
    text(g, "Certificate No:", X, 645, { font: MONT, weight: 600, size: 10.5, color: INK, align: "left" });
    text(g, data.number, X + 88, 645, { font: MONO, weight: 500, size: 10.5, color: INK, align: "left" });
    if (data.issued) { text(g, "Issued:", X + 230, 645, { font: MONT, weight: 600, size: 10.5, color: INK, align: "left" }); text(g, data.issued, X + 276, 645, { font: MONT, size: 10.5, color: INK, align: "left" }); }
    qr(g, verifyUrl(data.number), 878, 598, 58, ink, mix(A, "#ffffff", 0.95));
    text(g, "Scan to check", 907, 668, { font: MONT, size: 8, color: MUTED });
  };

  // Grid: white paper, faint pattern in two corners, a big heading.
  T.grid = async (g, d, data, A) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, W1, H1);
    // bottom-left: a tilted grid fading out
    g.save(); g.beginPath(); g.rect(0, 0, W1, H1); g.clip(); g.translate(40, H1 - 30); g.rotate(-0.42);
    for (let i = -14; i <= 14; i++) for (const v of [0, 1]) {
      const k = i * 26; g.strokeStyle = rgba(A, 0.13 * (1 - Math.abs(i) / 15)); g.lineWidth = 0.7; g.beginPath();
      if (v) { g.moveTo(k, -300); g.lineTo(k, 300); } else { g.moveTo(-380, k); g.lineTo(380, k); } g.stroke();
    }
    for (let i = -10; i <= 10; i += 2) for (let j = -10; j <= 10; j += 2) { const f = 1 - Math.hypot(i, j) / 14; if (f > 0) { g.fillStyle = rgba(A, 0.25 * f); g.fillRect(i * 26 - 1.5, j * 26 - 1.5, 3, 3); } }
    g.restore();
    // top-right: rings, plus signs and dots fading towards the middle
    g.save();
    for (let k = 0; k < 90; k++) {
      const a = (k * 137.5) % 360 * Math.PI / 180, rr2 = 18 + Math.sqrt(k / 90) * 320, x = W1 - 20 - Math.abs(Math.cos(a)) * rr2, y = 20 + Math.abs(Math.sin(a)) * rr2 * 0.85;
      const f = Math.max(0, 1 - rr2 / 340), al = 0.06 + 0.24 * f; g.strokeStyle = rgba(A, al); g.fillStyle = rgba(A, al); g.lineWidth = 1.4;
      if (k % 3 === 0) { g.beginPath(); g.arc(x, y, 8 + (k % 5) * 4, 0, Math.PI * 2); g.stroke(); }
      else if (k % 3 === 1) { g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 7, y); g.moveTo(x, y - 7); g.lineTo(x, y + 7); g.stroke(); }
      else { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
    const X = 150, dk = mix(A, "#120A2A", 0.35);
    await logos(g, d, X, 48, 42, { orgColor: dk, orgSize: 11 });
    text(g, "CERTIFICATE", X, 170, { font: MONT, weight: 800, size: 64, color: A, align: "left" });
    text(g, kindWord(d).toUpperCase(), X + 3, 202, { font: MONT, weight: 500, size: 20, color: INK, align: "left", spacing: 7, max: 480 });
    text(g, "No. " + data.number, X + 3, 228, { font: MONO, weight: 500, size: 11, color: MUTED, align: "left" });
    text(g, "AWARDED TO", X, 280, { font: MONT, weight: 600, size: 16, color: dk, align: "left", spacing: 1 });
    text(g, data.name, X, 332, { font: SERIF, style: "italic", weight: 600, size: 44, color: dk, align: "left", max: 560 });
    g.strokeStyle = "#3A3A46"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(X, 348); g.lineTo(X + 500, 348); g.stroke();
    text(g, verbOf(d).replace(/^has /, "Has "), X, 382, { font: MONT, size: 15, color: INK, align: "left" });
    const yEnd = para(g, data.programme, X, 408, { font: MONT, weight: 700, size: 19, color: A, align: "left" }, 600, 2, 1.25);
    text(g, footer(data), X, yEnd + 30, { font: MONT, size: 12.5, color: MUTED, align: "left", max: 600 });
    await sigPair(g, d, 590, [X, 590], 190, { align: "left", titleAbove: true, color: INK, line: "#3A3A46" });
    qr(g, verifyUrl(data.number), 852, 520, 70, dk, "#fff");
    text(g, data.issued ? "Issued " + data.issued : "", 887, 606, { font: MONT, size: 9, color: MUTED });
  };

  // Block: a colour panel on the left with the heading, playful shapes, the name on the right.
  T.block = async (g, d, data, A) => {
    const Y = "#FFB627", C = "#FF6B5E";
    g.fillStyle = "#fff"; g.fillRect(0, 0, W1, H1);
    g.strokeStyle = rgba(A, 0.35); g.lineWidth = 1; for (let k = -20; k < 60; k++) { g.beginPath(); g.moveTo(0, k * 14); g.lineTo(18, k * 14 - 18); g.stroke(); }
    g.fillStyle = Y; g.fillRect(0, H1 - 245, 70, 120);
    g.fillStyle = A; g.beginPath(); g.moveTo(30, 0); g.lineTo(330, 0); g.lineTo(330, H1 - 190); g.lineTo(250, H1 - 110); g.lineTo(30, H1 - 110); g.closePath(); g.fill();
    g.fillStyle = Y; g.beginPath(); g.moveTo(250, H1 - 110); g.lineTo(330, H1 - 190); g.lineTo(410, H1 - 190); g.lineTo(410, H1 - 140); g.lineTo(330, H1 - 140); g.lineTo(300, H1 - 110); g.closePath(); g.fill();
    g.fillStyle = C; g.fillRect(790, 0, 210, 28);
    g.fillStyle = Y; g.beginPath(); g.moveTo(590, 0); g.lineTo(640, 0); g.lineTo(600, 110); g.lineTo(550, 110); g.closePath(); g.fill();
    g.fillStyle = Y; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { g.beginPath(); g.arc(860 + i * 22, 70 + j * 20, 2.6, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = A; g.lineWidth = 14; g.beginPath(); g.moveTo(W1 + 4, 230); g.lineTo(W1 - 60, 290); g.lineTo(W1 + 4, 350); g.stroke();
    g.fillStyle = A; g.beginPath(); g.arc(395, H1 + 8, 64, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = C; g.save(); g.translate(500, H1 - 24); g.rotate(Math.PI / 4); g.fillRect(-20, -20, 40, 40); g.restore();
    g.strokeStyle = rgba(A, 0.35); g.lineWidth = 1; for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(W1 - 120 + k * 14, H1); g.lineTo(W1, H1 - 120 + k * 14 - 14); g.stroke(); }
    const P = 180, logo = await img(d.logo);
    if (logo) { g.fillStyle = "#fff"; rr(g, P - 46, 62, 92, 76, 14); g.fill(); fitImg(g, logo, P - 38, 68, 76, 64); }
    if (d.org) para(g, d.org.toUpperCase(), P, logo ? 170 : 120, { font: MONT, weight: 600, size: 13, color: "#fff" }, 260, 2, 1.3);
    const ln = (y) => { g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(62, y); g.lineTo(298, y); g.stroke(); g.fillStyle = "#fff"; for (const x of [62, 298]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); } };
    ln(222); text(g, "CERTIFICATE", P, 272, { font: MONT, weight: 800, size: 38, color: "#fff", max: 250 });
    text(g, kindWord(d).toUpperCase(), P, 302, { font: MONT, weight: 500, size: 17, color: "#fff", spacing: 1.5, max: 250 }); ln(330);
    qr(g, verifyUrl(data.number), P - 40, 372, 80, A, "#fff");
    text(g, data.number, P, 474, { font: MONO, weight: 500, size: 10, color: "#fff" });
    if (data.issued) text(g, "Issued " + data.issued, P, 490, { font: MONT, size: 9.5, color: "rgba(255,255,255,.85)" });
    const R = 660;
    text(g, "THIS CERTIFICATE IS PRESENTED TO", R, 205, { font: MONT, weight: 500, size: 13, color: INK, spacing: 1.6 });
    text(g, data.name, R, 270, { font: MONT, weight: 700, size: 42, color: INK, max: 520 });
    g.strokeStyle = "#C9CED6"; g.lineWidth = 1; g.beginPath(); g.moveTo(R - 230, 300); g.lineTo(R + 230, 300); g.stroke();
    g.fillStyle = "#C9CED6"; for (const x of [R - 230, R + 230]) { g.beginPath(); g.arc(x, 300, 2.5, 0, Math.PI * 2); g.fill(); }
    text(g, verbOf(d).replace(/^has /, "Has "), R, 338, { font: MONT, size: 14, color: MUTED });
    const yEnd = para(g, data.programme, R, 368, { font: MONT, weight: 700, size: 21, color: A }, 470, 2, 1.25);
    text(g, footer(data), R, yEnd + 28, { font: MONT, size: 12, color: MUTED, max: 470 });
    await sigPair(g, d, 572, [R - 120, R + 120], 170, { color: INK, line: "#8A909A" });
  };

  // Split: warm top, cool bottom, heading on the left, a round "scan to verify" stamp.
  T.split = async (g, d, data, A) => {
    const top = "#EEECE8", band = mix(A, "#ffffff", 0.62), dark = "#34363C", cut = 404;
    g.fillStyle = top; g.fillRect(0, 0, W1, H1); g.fillStyle = band; g.fillRect(0, cut, W1, H1 - cut);
    g.strokeStyle = "#6B6E75"; g.lineWidth = 1; g.beginPath(); g.moveTo(55, 46); g.lineTo(640, 46); g.stroke();
    await logos(g, d, 55, 60, 30, { orgColor: dark, orgSize: 12 });
    g.fillStyle = "#fff"; for (let i = 0; i < 5; i++) for (let j = 0; j < 7; j++) { g.beginPath(); g.arc(760 + i * 34, 60 + j * 30, 3.4, 0, Math.PI * 2); g.fill(); }
    text(g, "CERTIFICATE", 55, 162, { font: MONT, weight: 700, size: 48, color: dark, align: "left" });
    text(g, kindWord(d).toUpperCase(), 55, 214, { font: MONT, weight: 700, size: 48, color: dark, align: "left", max: 640 });
    text(g, "THIS CERTIFICATE IS PROUDLY PRESENTED TO", 57, 246, { font: MONT, weight: 600, size: 11.5, color: dark, align: "left", spacing: 0.6 });
    text(g, data.name, 62, 318, { font: MONT, weight: 300, size: 44, color: dark, align: "left", max: 600 });
    g.strokeStyle = "#7A7D84"; g.lineWidth = 0.9; g.beginPath(); g.moveTo(55, 336); g.lineTo(480, 336); g.stroke();
    const lab = (t, x, y) => text(g, t, x, y, { font: MONT, weight: 500, size: 9.5, color: "#4F535B", align: "left", spacing: 0.8 });
    lab("PROGRAMME", 55, 446);
    const yEnd = para(g, data.programme, 55, 468, { font: MONT, weight: 700, size: 14, color: dark, align: "left" }, 400, 2, 1.3);
    g.strokeStyle = "#5C6067"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(55, yEnd + 12); g.lineTo(455, yEnd + 12); g.stroke();
    lab("DATE", 490, 446); text(g, data.dates || data.issued, 490, 468, { font: MONT, weight: 700, size: 13, color: dark, align: "left", max: 190 });
    g.beginPath(); g.moveTo(490, yEnd + 12); g.lineTo(680, yEnd + 12); g.stroke();
    const said = `${verbOf(d).replace(/^has /, "Has ")} this programme${data.venue ? ", held at " + data.venue : ""}.`;
    para(g, said, 55, yEnd + 44, { font: MONT, size: 11.5, color: "#3F434A", align: "left" }, 420, 2, 1.35);
    await sigPair(g, d, 640, [150, 480], 170, { color: dark, line: "#5C6067" });
    const cx = 862, cy = 552;
    g.strokeStyle = dark; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, 78, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 0.7; g.beginPath(); g.arc(cx, cy, 58, 0, Math.PI * 2); g.stroke();
    ringText(g, "SCAN TO VERIFY • SCAN TO VERIFY • ", cx, cy, 68, { size: 9.5, color: dark });
    qr(g, verifyUrl(data.number), cx - 36, cy - 36, 72, dark, band);
    text(g, data.number, cx, cy + 100, { font: MONO, weight: 500, size: 10, color: dark });
  };

  // data: { name, number, programme, dates, venue, issued }
  async function render(design, data, width = 1000, canvas) {
    await fonts();
    const d = normal(design), c = canvas || document.createElement("canvas");
    c.width = Math.round(width); c.height = Math.round(width / Math.SQRT2);
    const g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.scale(width / W1, width / W1);
    await (T[d.template] || T.ribbon)(g, d, data, d.accent || INK);
    return c;
  }
  // From a stored certificate row (number, name, issued_at, design, info).
  const dataOf = c => ({ name: c.name, number: c.number, programme: c.info?.programme || "", dates: datesText(c.info), venue: c.info?.venue || "", issued: c.issued_at ? dmy(c.issued_at) : "" });
  const sample = (info, name) => ({ name: name || "Dr Babajide Arulogun", number: "TS-" + new Date().getFullYear() + "-SAMPLE", programme: info?.programme || "Programme name", dates: datesText(info) || dmy(new Date().toISOString()), venue: info?.venue || "", issued: dmy(new Date().toISOString()) });

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
