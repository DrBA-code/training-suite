// Training Suite groups: colours and names for groups 1–12, and the ways of placing people
// (random, mixed by sex, mixed by MDA, same MDA together). Shared by the live screen, activities and phones.
window.TSGR = (() => {
  "use strict";
  const COLORS = [
    ["Blue", "#1F5FBF"], ["Orange", "#E07A00"], ["Green", "#0F8A5F"], ["Purple", "#6D3FC0"], ["Red", "#D2391F"], ["Teal", "#0E8EA0"],
    ["Pink", "#D63384"], ["Gold", "#B8860B"], ["Navy", "#203A72"], ["Lime", "#5E9E12"], ["Brown", "#8A5A2B"], ["Grey", "#5B6170"]
  ];
  const METHODS = [
    ["random", "Random", "Shuffled at random"],
    ["sex", "Mix by sex", "Each group gets a fair share of men and women"],
    ["mda_mix", "Mix by MDA", "People from the same MDA are spread across groups"],
    ["mda_same", "Same MDA together", "People from the same MDA sit together"],
    ["choose", "Participants choose", "Phones show the groups; each person picks one"]
  ];
  const color = k => (COLORS[(+k - 1) % 12] || ["", "#5B6170"])[1];
  const colorName = k => (COLORS[(+k - 1) % 12] || ["Group"])[0];
  const keys = cfg => cfg && cfg.n ? Array.from({ length: cfg.n }, (_, i) => String(i + 1)) : [];
  const name = (cfg, k) => { if (k === "A" || k === "B") return "Group " + k; const n = cfg?.names?.[+k - 1]; return (n && String(n).trim()) || "Group " + k; };
  const label = (cfg, k) => `${name(cfg, k)} · ${colorName(k)}`;
  const norm = t => String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const mda = (org, aliases) => { const n = norm(org); return (aliases && aliases[n]) || n; };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // people: [{ participant, sex, organisation }] → { participant: "k" }
  function assign(people, n, method, aliases) {
    const out = {}; if (method === "choose") return out;
    let order;
    if (method === "sex") {
      const by = {}; shuffle(people).forEach(p => (by[p.sex || "?"] = by[p.sex || "?"] || []).push(p));
      order = Object.values(by).sort((a, b) => b.length - a.length).flat();
    } else if (method === "mda_mix") {
      const by = {}; shuffle(people).forEach(p => { const k = mda(p.organisation, aliases) || "?" + Math.random(); (by[k] = by[k] || []).push(p); });
      order = Object.values(by).sort((a, b) => b.length - a.length).flat();
    } else if (method === "mda_same") {
      const by = {}; shuffle(people).forEach(p => { const k = mda(p.organisation, aliases) || "?"; (by[k] = by[k] || []).push(p); });
      const size = Array(n).fill(0), target = Math.ceil(people.length / n);
      const chunks = [];
      Object.values(by).sort((a, b) => b.length - a.length).forEach(list => { for (let i = 0; i < list.length; i += target) chunks.push(list.slice(i, i + target)); });
      chunks.sort((a, b) => b.length - a.length).forEach(c => { const g = size.indexOf(Math.min(...size)); c.forEach(p => (out[p.participant] = String(g + 1))); size[g] += c.length; });
      return out;
    } else order = shuffle(people);
    // deal round the groups, starting each time from the smallest so sizes stay even
    const size = Array(n).fill(0); let at = Math.floor(Math.random() * n);
    order.forEach(p => { out[p.participant] = String(at + 1); size[at]++; at = (at + 1) % n; });
    return out;
  }
  // distinct MDAs with counts, for the "same MDA?" check
  function mdas(people, aliases) {
    const m = new Map();
    people.forEach(p => { const raw = String(p.organisation || "").trim(); if (!raw) return; const k = mda(raw, aliases); const e = m.get(k) || { key: k, label: raw, count: 0, raws: new Set() }; e.count++; e.raws.add(norm(raw)); m.set(k, e); });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }
  return { COLORS, METHODS, color, colorName, keys, name, label, norm, mda, assign, mdas, shuffle };
})();
