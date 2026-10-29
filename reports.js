// Training Suite reports: a one-page session report and a programme report combining its sessions.
// Built from the same data as the session tabs; printed or saved as PDF from the browser.
window.TSR = (() => {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const ach = (pre, post) => pre == null || post == null ? null : pre >= 100 ? (post >= 100 ? 1 : (post - 100) / 100) : (post - pre) / (100 - pre);
  const pct = v => v == null || isNaN(v) ? "–" : Math.round(v) + "%";
  const hm = sec => { if (sec == null || isNaN(sec)) return "–"; const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dmy = s => { if (!s) return ""; const d = new Date(String(s).slice(0, 10) + "T00:00:00"); return isNaN(d) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const fullName = r => (r.title ? (r.title === "Miss" || r.title === "Ms" ? r.title + " " : r.title + ". ") : "") + (r.name || "");
  const stars = v => v == null ? "–" : (+v).toFixed(1) + " ★";

  // ---------- data ----------
  async function sessionData(sb, s) {
    const safe = p => p.then(r => (r.error ? null : r.data)).catch(() => null);
    const [roll, part, learn, ev] = await Promise.all([safe(sb.rpc("session_roll", { p_session: s.id })), safe(sb.rpc("session_participation", { p_session: s.id })),
      safe(sb.rpc("session_learning", { p_session: s.id })), (s.evaluation || {}).mode === "none" ? Promise.resolve(null) : safe(sb.rpc("session_evaluation", { p_session: s.id }))]);
    const R = roll || [], P = part || [], L = (learn || []).map(r => ({ ...r, a: r.took_pre && r.took_post ? ach(+r.pre, +r.post) : null }));
    const start = s.started_at ? new Date(s.started_at) : R.length ? new Date(Math.min(...R.map(r => +new Date(r.arrived_at)))) : null;
    const firstIn = R.length ? new Date(Math.min(...R.map(r => +new Date(r.arrived_at)))) : null;
    const end = s.ended_at ? new Date(s.ended_at) : null, span = start && end ? (end - start) / 1000 : null;
    const items = window.TSE ? TSE.formFor(s, s.evaluation || {}) : [], E = ev && window.TSE ? TSE.score(items, ev.rows || []) : null;
    const mda = new Map(); R.forEach(r => { const raw = String(r.organisation || "").trim(); if (!raw) return; const k = window.TSGR ? TSGR.norm(raw) : raw.toLowerCase(); const e = mda.get(k) || { label: raw, n: 0 }; e.n++; mda.set(k, e); });
    return {
      s, roll: R, part: P, startAt: s.started_at ? new Date(s.started_at) : firstIn, endAt: s.ended_at ? new Date(s.ended_at) : null, learn: L, eval: E, evalN: ev?.rows?.length || 0, attendees: R.length,
      spent: avg(R.map(r => r.spent_seconds || 0)), span, timePct: span ? avg(R.map(r => Math.min(100, 100 * (r.spent_seconds || 0) / span))) : null,
      early: end ? R.filter(r => r.left_at && end - new Date(r.left_at) > 10 * 60000).length : R.filter(r => r.left_at).length,
      awayAvg: avg(R.map(r => r.away_seconds || 0)),
      sex: { male: R.filter(r => r.sex === "male").length, female: R.filter(r => r.sex === "female").length, other: R.filter(r => r.sex !== "male" && r.sex !== "female").length },
      mdas: [...mda.values()].sort((a, b) => b.n - a.n),
      runs: P[0]?.runs || 0, partAvg: P.length ? avg(P.map(r => r.rate)) : null, top: P.slice(0, 5),
      pre: avg(L.filter(r => r.took_pre).map(r => +r.pre)), post: avg(L.filter(r => r.took_post).map(r => +r.post)), achAvg: avg(L.filter(r => r.a != null).map(r => r.a * 100)), both: L.filter(r => r.a != null).length
    };
  }

  // ---------- pieces ----------
  const kpi = (label, value, sub, color) => `<div class="rk" style="--c:${color}"><span>${esc(label)}</span><b>${value}</b><small>${esc(sub || "")}</small></div>`;
  const bar = (label, v, max, color, right) => `<div class="rb"><span>${esc(label)}</span><i><em style="width:${max ? Math.max(1, 100 * v / max) : 0}%;background:${color}"></em></i><b>${right ?? v}</b></div>`;
  const head = (kind, title, meta, logo) => `<header class="rh"><div><span class="rkind">${esc(kind)}</span><h1>${esc(title)}</h1><p>${meta}</p></div>${logo ? `<img src="${esc(logo)}" alt="" class="rlogo">` : `<span class="rbrand"><img src="assets/logo.png" alt="" width="26" height="28"> Training Suite</span>`}</header>`;
  const foot = () => `<footer class="rf">Prepared with Training Suite on ${esc(dmy(new Date().toISOString()))}. Learning achievement = (post-test − pre-test) ÷ (100 − pre-test).</footer>`;

  // ---------- executive summary: prose, no charts ----------
  const tm = d => d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s+/g, " ") : "";
  const dur = sec => { const m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60; return [h ? `${h} hour${h === 1 ? "" : "s"}` : "", r ? `${r} minute${r === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "under a minute"; };
  const andList = xs => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
  const Plural = (n, one, many) => `${WORDS[n] || n} ${n === 1 ? one : many || one + "s"}`;   // at the start of a sentence
  const cleanEnd = t => String(t || "").trim().replace(/[.;:,\s]+$/, "");
  const lower1 = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  function autoSummary(d, p) {
    const s = d.s, E = d.eval, out = [];
    const obj = String(s.objectives || "").split("\n").map(x => cleanEnd(x.replace(/^\s*(\d+[.)]|[-•*])\s*/, ""))).filter(Boolean);
    const where = [dmy(s.session_date) ? `on ${dmy(s.session_date)}` : "", s.venue ? `at ${s.venue}` : ""].filter(Boolean).join(" ");
    let p1 = `This report summarises the session “${s.topic}”${p?.name ? `, part of the ${p.name} programme` : ""}${where ? `, held ${where}` : ""}.`;
    if (d.startAt && d.endAt && d.endAt > d.startAt) p1 += ` The session started at ${tm(d.startAt)} and ended at ${tm(d.endAt)}, a duration of ${dur((d.endAt - d.startAt) / 1000)}.`;
    else if (s.start_time) p1 += ` It was scheduled to start at ${s.start_time}.`;
    if (s.course_lead) p1 += ` It was facilitated by ${s.course_lead}.`;
    out.push(p1);
    if (String(s.background || "").trim()) out.push(String(s.background).trim());
    if (String(s.rationale || "").trim()) out.push(String(s.rationale).trim());
    if (!String(s.background || "").trim() && !String(s.rationale || "").trim() && (s.main_topic || s.key_skill))
      out.push(`The session focused on ${s.main_topic || s.topic}${s.key_skill ? `, so that participants would be able to ${lower1(cleanEnd(s.key_skill.replace(/^i can now\s+/i, "")))}` : ""}.`);
    if (obj.length) out.push(obj.length === 1 ? `Its objective was that, by the end of the session, participants would be able to ${lower1(obj[0])}.`
      : `By the end of the session, participants were expected to be able to ${andList(obj.map((o, i) => `(${["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][i] || i + 1}) ${lower1(o)}`))}.`);
    if (d.attendees) {
      const sx = d.sex.male + d.sex.female ? ` (${andList([d.sex.male ? plural(d.sex.male, "man", "men") : "", d.sex.female ? plural(d.sex.female, "woman", "women") : ""].filter(Boolean))}${d.sex.other ? `, and ${d.sex.other} who did not say` : ""})` : "";
      const orgs = d.mdas.length ? `, drawn from ${plural(d.mdas.length, "organisation")}${d.mdas.length > 1 ? `, including ${andList(d.mdas.slice(0, 3).map(m => m.label))}` : `: ${d.mdas[0].label}`}` : "";
      let p = `${Plural(d.attendees, "participant")} attended${sx}${orgs}.`;
      const onV = d.roll.filter(r => r.mode === "venue").length, onL = d.roll.filter(r => r.mode === "online").length, chk = d.roll.filter(r => r.venue_check?.how === "gps").length;
      if (onL) p += ` Of these, ${onV} attended at the venue and ${onL} online.`;
      else if (onV && chk) p += ` Attendance at the venue was confirmed by phone location${chk < onV ? ` for ${chk} of them, and the facilitator let in the rest` : ""}.`;
      if (d.timePct != null) p += ` On average, participants were present for ${Math.round(d.timePct)}% of the session${d.early ? `, and ${plural(d.early, "participant")} left before the end` : ""}.`;
      out.push(p);
    } else out.push("No participants checked in for this session.");
    const eng = [];
    if (d.runs) eng.push(`${Plural(d.runs, "interactive activity", "interactive activities")} ${d.runs === 1 ? "was" : "were"} run, with an average participation rate of ${Math.round(d.partAvg || 0)}%.`);
    if (d.pre != null && d.post != null) eng.push(`Knowledge was measured with a pre-test and a post-test: the average score moved from ${Math.round(d.pre)}% to ${Math.round(d.post)}%${d.achAvg != null ? `, a learning achievement of ${Math.round(d.achAvg)}%` : ""}${d.both && d.both < d.attendees ? ` (based on the ${d.both} participants who took both tests)` : ""}.`);
    else if (d.post != null) eng.push(`The average post-test score was ${Math.round(d.post)}%.`);
    if (eng.length) out.push(eng.join(" "));
    if (E && d.evalN) {
      let p = `${Plural(d.evalN, "participant")} completed the evaluation${E.overall != null ? `, rating the session ${E.overall.toFixed(1)} out of 5 overall` : ""}.`;
      if (E.reaction != null || E.learning != null) p += ` Reaction to the session (Kirkpatrick level 1) scored ${E.reaction ?? "–"}% and self-reported learning (level 2) ${E.learning ?? "–"}%${E.before != null && E.after != null ? `; self-rated knowledge of the topic rose from ${E.before.toFixed(1)} to ${E.after.toFixed(1)} out of 5` : ""}.`;
      const best = E.texts.find(t => t.id === "best")?.answers?.[0]?.t, imp = E.texts.find(t => t.id === "improve")?.answers?.[0]?.t;
      if (best || imp) p += ` ${best ? `Participants valued “${cleanEnd(best)}”` : ""}${best && imp ? ", and" : ""}${imp ? `${best ? " suggested" : "Participants suggested"} “${cleanEnd(imp)}”` : ""}.`;
      out.push(p);
    }
    const ach = d.achAvg, rate = E?.overall;
    if (ach != null || rate != null) {
      const good = (ach == null || ach >= 50) && (rate == null || rate >= 4), fair = (ach == null || ach >= 25) && (rate == null || rate >= 3.5);
      out.push(`Overall, the results ${good ? "indicate that the session met its objectives, with clear learning gains and positive feedback from participants" : fair ? "indicate that the session largely met its objectives, with room to strengthen some areas" : "point to areas for improvement, which are reflected in the analytics that follow"}.`);
    }
    return out.join("\n\n");
  }
  const sameName = (a, b) => { const n = x => String(x || "").toLowerCase().replace(/^(prof|dr|engr|mr|mrs|miss|ms)\.?\s+/i, "").replace(/[^a-z ]/g, "").trim(); return !!n(a) && !!n(b) && (n(a).includes(n(b)) || n(b).includes(n(a))); };
  function summaryBlock(d, p, prof) {
    const s = d.s, text = (s.report && String(s.report.summary || "").trim()) || autoSummary(d, p);
    const me = !s.course_lead || sameName(s.course_lead, prof?.full_name), name = s.course_lead || prof?.full_name || "Facilitator";
    const sig = me ? prof?.signature : "", title = me ? prof?.job_title || "Facilitator" : "Facilitator";
    return `<section class="rsum"><h2>Executive summary</h2><div class="rsumtext" id="rSumText">${text.split(/\n\s*\n/).map(x => `<p>${esc(x.trim()).replace(/\n/g, "<br>")}</p>`).join("")}</div>
      <div class="rsign">${sig ? `<img src="${esc(sig)}" alt="Signature">` : `<span class="rsig-blank"></span>`}<span class="rline"></span><b>${esc(name)}</b><span>${esc(title)}</span><span>${esc(dmy((s.ended_at || new Date().toISOString())))}</span></div></section>`;
  }

  function session(d, p, prof) {
    const s = d.s, E = d.eval, obj = String(s.objectives || "").split("\n").map(x => x.trim()).filter(Boolean);
    const meta = [p?.name, dmy(s.session_date), s.start_time, s.venue, s.course_lead && "Course lead: " + s.course_lead].filter(Boolean).map(esc).join(" · ");
    const strong = E ? E.per.filter(i => i.avg != null && i.type !== "stars" && !["before", "after"].includes(i.id)).sort((a, b) => b.avg - a.avg) : [];
    const comments = E ? E.texts.flatMap(t => t.answers.slice(0, 4).map(a => ({ q: t.id, t: a.t }))) : [];
    return `<article class="rpt">${head("Session report", s.topic, meta, p?.cert_design?.logo)}
      ${summaryBlock(d, p, prof)}
      <h2 class="rpart">Analytics</h2>
      <div class="rks">${kpi("Checked in", d.attendees, d.sex.male + d.sex.female ? `${d.sex.male} men · ${d.sex.female} women${d.sex.other ? ` · ${d.sex.other} not said` : ""}` : "", "#1F5FBF")}
        ${kpi("Time in the room", d.timePct != null ? pct(d.timePct) : hm(d.spent), d.timePct != null ? `Average ${hm(d.spent)} of ${hm(d.span)}` : "Average per person", "#0F8A5F")}
        ${kpi("Participation", pct(d.partAvg), `${d.runs} activit${d.runs === 1 ? "y" : "ies"} run`, "#D2391F")}
        ${kpi("Learning achievement", pct(d.achAvg), d.pre != null || d.post != null ? `Pre ${pct(d.pre)} → post ${pct(d.post)}` : "No pre/post test", "#6D3FC0")}
        ${kpi("Participant rating", E?.overall != null ? stars(E.overall) : "–", d.evalN ? `${d.evalN} evaluation${d.evalN === 1 ? "" : "s"}` : "No evaluations", "#B8860B")}</div>
      <div class="rgrid">
        <section><h2>Attendance</h2>
          ${bar("Stayed to the end", d.attendees - d.early, d.attendees, "#0F8A5F")}${bar("Left early", d.early, d.attendees, "#D2391F")}
          <p class="rnote">Average time away: ${hm(d.awayAvg)}.${s.groups ? ` Worked in ${s.groups.n} groups.` : ""}</p>
          ${d.mdas.length ? `<h3>Organisations</h3>${d.mdas.slice(0, 6).map(m => bar(m.label, m.n, d.mdas[0].n, "#1F5FBF")).join("")}${d.mdas.length > 6 ? `<p class="rnote">and ${d.mdas.length - 6} more</p>` : ""}` : ""}</section>
        <section><h2>Learning</h2>
          ${d.pre != null || d.post != null ? `${bar("Average pre-test", d.pre || 0, 100, "#B8860B", pct(d.pre))}${bar("Average post-test", d.post || 0, 100, "#1F5FBF", pct(d.post))}${bar("Learning achievement", Math.max(0, d.achAvg || 0), 100, "#6D3FC0", pct(d.achAvg))}<p class="rnote">${d.both} took both tests.</p>` : `<p class="rnote">No pre-test or post-test in this session.</p>`}
          <h3>Most active</h3>${d.top.length ? `<ol class="rlist">${d.top.map(r => `<li>${esc(r.name)} <small>${r.taken}/${r.runs} · ${r.points} pts</small></li>`).join("")}</ol>` : `<p class="rnote">No activities run.</p>`}</section>
        <section><h2>Evaluation</h2>
          ${E && d.evalN ? `${bar("Reaction (level 1)", E.reaction || 0, 100, "#0F8A5F", pct(E.reaction))}${bar("Learning (level 2)", E.learning || 0, 100, "#1F5FBF", pct(E.learning))}
            ${E.before != null ? `<p class="rnote">Self-rated knowledge: ${E.before.toFixed(1)} before → ${E.after?.toFixed(1)} after (out of 5).</p>` : ""}
            ${strong.length ? `<h3>Strongest</h3><p class="rnote">${esc(strong[0].text)} (${strong[0].avg.toFixed(1)}/5)</p><h3>Weakest</h3><p class="rnote">${esc(strong[strong.length - 1].text)} (${strong[strong.length - 1].avg.toFixed(1)}/5)</p>` : ""}` : `<p class="rnote">No evaluations yet.</p>`}</section>
        <section><h2>Objectives</h2>${obj.length ? `<ol class="rlist">${obj.map(o => `<li>${esc(o)}</li>`).join("")}</ol>` : `<p class="rnote">None recorded.</p>`}
          ${comments.length ? `<h3>In their words</h3>${comments.slice(0, 4).map(c => `<blockquote>“${esc(c.t.slice(0, 160))}${c.t.length > 160 ? "…" : ""}”</blockquote>`).join("")}` : ""}</section>
      </div>${foot()}</article>`;
  }

  // ---------- programme executive summary ----------
  const dm = s => { const d = new Date(String(s).slice(0, 10) + "T00:00:00"); return isNaN(d) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  function autoProgrammeSummary(p, list, people) {
    const out = [], held = list.filter(d => d.attendees), ds = list.map(d => d.s.session_date).filter(Boolean).sort();
    const when = p.dates ? `held ${/\bto\b|–|—|-/.test(p.dates) ? "from " : /^\d/.test(p.dates) ? "on " : ""}${p.dates}` : ds.length ? (ds[0] === ds[ds.length - 1] ? `held on ${dmy(ds[0])}` : `held from ${dmy(ds[0])} to ${dmy(ds[ds.length - 1])}`) : "";
    const leads = [...new Set(list.map(d => String(d.s.course_lead || "").trim()).filter(Boolean))];
    let p1 = `This report summarises the ${p.name} programme${p.code ? ` (${p.code})` : ""}${when ? `, ${when}` : ""}${p.venue ? ` at ${p.venue}` : ""}.`;
    if (list.length) p1 += ` The programme had ${plural(list.length, "session")}: ${andList(list.map(d => `“${d.s.topic}”${d.s.session_date ? ` (${dm(d.s.session_date)})` : ""}`))}.`;
    if (leads.length) p1 += ` ${leads.length === 1 ? `It was facilitated by ${leads[0]}` : `Sessions were facilitated by ${andList(leads)}`}.`;
    out.push(p1);
    if (String(p.background || "").trim()) out.push(String(p.background).trim());
    if (String(p.rationale || "").trim()) out.push(String(p.rationale).trim());
    const obj = String(p.objectives || "").split("\n").map(x => cleanEnd(x.replace(/^\s*(\d+[.)]|[-•*])\s*/, ""))).filter(Boolean);
    if (obj.length) out.push(obj.length === 1 ? `The programme's objective was that participants would be able to ${lower1(obj[0])}.`
      : `By the end of the programme, participants were expected to be able to ${andList(obj.map((o, i) => `(${["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][i] || i + 1}) ${lower1(o)}`))}.`);
    // people across sessions
    const ppl = new Map(); list.forEach(d => d.roll.forEach(r => { const e = ppl.get(r.participant) || { ...r, n: 0 }; e.n++; ppl.set(r.participant, e); }));
    const P = [...ppl.values()], men = P.filter(r => r.sex === "male").length, women = P.filter(r => r.sex === "female").length, other = P.length - men - women;
    if (P.length) {
      const orgs = new Map(); P.forEach(r => { const raw = String(r.organisation || "").trim(); if (!raw) return; const k = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); const e = orgs.get(k) || { label: raw, n: 0 }; e.n++; orgs.set(k, e); });
      const O = [...orgs.values()].sort((a, b) => b.n - a.n), all = held.length > 1 ? P.filter(r => r.n >= held.length).length : null;
      let t = `${Plural(P.length, "participant")} took part${men + women ? ` (${andList([men ? plural(men, "man", "men") : "", women ? plural(women, "woman", "women") : ""].filter(Boolean))}${other ? `, and ${other} who did not say` : ""})` : ""}${O.length ? `, drawn from ${plural(O.length, "organisation")}${O.length > 1 ? `, including ${andList(O.slice(0, 3).map(o => o.label))}` : `: ${O[0].label}`}` : ""}.`;
      if (held.length > 1) t += ` Average attendance was ${Math.round(avg(held.map(d => d.attendees)))} per session, and ${plural(all, "participant")} attended every session.`;
      const tp = held.filter(d => d.timePct != null); if (tp.length) t += ` Participants were present for ${Math.round(avg(tp.map(d => d.timePct)))}% of session time on average.`;
      out.push(t);
    } else out.push("No participants have checked in to this programme's sessions yet.");
    // session by session, one short paragraph each
    if (list.length > 1) {
      out.push(`The sessions are summarised below.`);
      list.forEach((d, i) => {
        const s = d.s, bits = [];
        if (!d.attendees) { out.push(`Session ${i + 1}, “${s.topic}”${s.session_date ? ` (${dmy(s.session_date)})` : ""}${s.status === "completed" ? ", had no participants checked in." : ", has not been held yet."}`); return; }
        let t = `Session ${i + 1}, “${s.topic}”${s.session_date ? `, held on ${dmy(s.session_date)}` : ""}${d.startAt && d.endAt && d.endAt > d.startAt ? ` from ${tm(d.startAt)} to ${tm(d.endAt)}` : ""}${s.course_lead ? ` and facilitated by ${s.course_lead}` : ""}, had ${plural(d.attendees, "participant")}`;
        if (d.timePct != null) bits.push(`present for ${Math.round(d.timePct)}% of the session on average`);
        t += bits.length ? `, ${bits.join(", ")}.` : ".";
        const so = String(s.objectives || "").split("\n").map(x => cleanEnd(x.replace(/^\s*(\d+[.)]|[-•*])\s*/, ""))).filter(Boolean);
        if (so.length) t += ` It aimed to enable participants to ${andList(so.slice(0, 3).map(lower1))}${so.length > 3 ? `, among other objectives` : ""}.`;
        const res = [];
        if (d.runs) res.push(`${Plural(d.runs, "activity", "activities")} ${d.runs === 1 ? "was" : "were"} run (${Math.round(d.partAvg || 0)}% participation)`);
        if (d.pre != null && d.post != null) res.push(`test scores moved from ${Math.round(d.pre)}% to ${Math.round(d.post)}% (learning achievement ${Math.round(d.achAvg ?? 0)}%)`);
        if (d.eval?.overall != null) res.push(`participants rated it ${d.eval.overall.toFixed(1)} out of 5`);
        if (res.length) t += ` ${res[0].charAt(0).toUpperCase() + res[0].slice(1)}${res.length > 1 ? (res.length > 2 ? ", " + res.slice(1, -1).join(", ") + "," : "") + " and " + res[res.length - 1] : ""}.`;
        const imp = d.eval?.texts?.find(x => x.id === "improve")?.answers?.[0]?.t;
        if (imp) t += ` A suggestion for improvement was “${cleanEnd(imp)}”.`;
        out.push(t);
      });
    }
    const eng = [], runs = held.reduce((a, d) => a + (d.runs || 0), 0), parts = held.filter(d => d.partAvg != null && d.runs);
    if (runs) eng.push(`${list.length > 1 ? "Across the programme, " + plural(runs, "interactive activity", "interactive activities") : Plural(runs, "interactive activity", "interactive activities")} ${runs === 1 ? "was" : "were"} run${list.length > 1 ? "" : " across the programme"}, with an average participation rate of ${Math.round(avg(parts.map(d => d.partAvg)) || 0)}%.`);
    const tested = held.filter(d => d.achAvg != null);
    if (tested.length) {
      const best = tested.slice().sort((a, b) => b.achAvg - a.achAvg)[0];
      eng.push(`In ${tested.length === 1 ? "the one session" : `the ${tested.length} sessions`} with a pre-test and post-test, average scores moved from ${Math.round(avg(tested.map(d => d.pre)))}% to ${Math.round(avg(tested.map(d => d.post)))}%, an average learning achievement of ${Math.round(avg(tested.map(d => d.achAvg)))}%${tested.length > 1 ? `; the strongest gain was in “${best.s.topic}” (${Math.round(best.achAvg)}%)` : ""}.`);
    }
    if (eng.length) out.push(eng.join(" "));
    const rated = held.filter(d => d.eval?.overall != null), nEval = held.reduce((a, d) => a + (d.evalN || 0), 0);
    if (rated.length) {
      const reac = rated.filter(d => d.eval.reaction != null), lrn = rated.filter(d => d.eval.learning != null);
      out.push(`Participants completed ${plural(nEval, "evaluation")} and rated the programme ${avg(rated.map(d => d.eval.overall)).toFixed(1)} out of 5 on average${reac.length ? `, with reaction (Kirkpatrick level 1) at ${Math.round(avg(reac.map(d => d.eval.reaction)))}%` : ""}${lrn.length ? ` and self-reported learning (level 2) at ${Math.round(avg(lrn.map(d => d.eval.learning)))}%` : ""}.`);
    }
    if (p.certificates && people) {
      const q = people.filter(x => x.qualifies).length, iss = people.filter(x => x.cert?.status === "valid").length;
      out.push(iss ? `${Plural(iss, "certificate")} ${iss === 1 ? "was" : "were"} issued${q !== iss ? `; ${q} participant${q === 1 ? "" : "s"} met the certificate rules` : ""}.` : `${Plural(q, "participant")} met the certificate rules; certificates have not yet been issued.`);
    }
    const ach = tested.length ? avg(tested.map(d => d.achAvg)) : null, rate = rated.length ? avg(rated.map(d => d.eval.overall)) : null;
    if (ach != null || rate != null) {
      const good = (ach == null || ach >= 50) && (rate == null || rate >= 4), fair = (ach == null || ach >= 25) && (rate == null || rate >= 3.5);
      out.push(`Overall, the results ${good ? "indicate that the programme met its objectives, with clear learning gains and positive feedback from participants" : fair ? "indicate that the programme largely met its objectives, with room to strengthen some areas" : "point to areas for improvement, which are reflected in the analytics that follow"}.`);
    }
    return out.join("\n\n");
  }

  function programme(p, list, people, prof) {
    const run = list.filter(d => d.s.status === "completed" || d.attendees), uniq = people ? people.filter(x => (x.per || []).some(y => y.here)).length : null;
    const issued = people ? people.filter(x => x.cert?.status === "valid").length : null;
    const rated = list.filter(d => d.eval?.overall != null);
    const meta = [p.code, p.dates, p.venue].filter(Boolean).map(esc).join(" · ") || `${list.length} session${list.length === 1 ? "" : "s"}`;
    const text = (p.report && String(p.report.summary || "").trim()) || autoProgrammeSummary(p, list, people);
    return `<article class="rpt">${head("Programme report", p.name, meta, p.cert_design?.logo)}
      <section class="rsum"><h2>Executive summary</h2><div class="rsumtext" id="rSumText">${text.split(/\n\s*\n/).map(x => `<p>${esc(x.trim()).replace(/\n/g, "<br>")}</p>`).join("")}</div>
        <div class="rsign">${prof?.signature ? `<img src="${esc(prof.signature)}" alt="Signature">` : `<span class="rsig-blank"></span>`}<span class="rline"></span><b>${esc(prof?.full_name || "Programme Lead")}</b><span>${esc(prof?.job_title || "Programme Lead")}</span><span>${esc(dmy(new Date().toISOString()))}</span></div></section>
      <h2 class="rpart">Analytics</h2>
      <div class="rks">${kpi("Sessions held", `${run.length}<small>/${list.length}</small>`, "", "#1F5FBF")}
        ${kpi("Participants", uniq ?? Math.max(0, ...list.map(d => d.attendees)), "Took part in at least one session", "#0F8A5F")}
        ${kpi("Average attendance", list.length ? Math.round(avg(run.map(d => d.attendees)) || 0) : "–", "Per session", "#D2391F")}
        ${kpi("Learning achievement", pct(avg(list.filter(d => d.achAvg != null).map(d => d.achAvg))), "Average across sessions", "#6D3FC0")}
        ${kpi("Participant rating", rated.length ? stars(avg(rated.map(d => d.eval.overall))) : "–", issued != null && p.certificates ? `${issued} certificate${issued === 1 ? "" : "s"} issued` : "", "#B8860B")}</div>
      <section class="rwide"><h2>Sessions</h2><table class="rt"><thead><tr><th>Date</th><th>Session</th><th>Checked in</th><th>Time in room</th><th>Participation</th><th>Pre → post</th><th>Achievement</th><th>Rating</th></tr></thead><tbody>
        ${list.map(d => `<tr><td>${esc(dmy(d.s.session_date) || "–")}</td><td><b>${esc(d.s.topic)}</b></td><td>${d.attendees}</td><td>${d.timePct != null ? pct(d.timePct) : hm(d.spent)}</td><td>${d.runs ? pct(d.partAvg) : "–"}</td><td>${d.pre != null || d.post != null ? `${pct(d.pre)} → ${pct(d.post)}` : "–"}</td><td>${pct(d.achAvg)}</td><td>${d.eval?.overall != null ? stars(d.eval.overall) : "–"}</td></tr>`).join("")}</tbody></table></section>
      ${people && people.length ? `<section class="rwide${people.length > 14 ? " rbreak" : ""}"><h2>Participants</h2><table class="rt rsm"><thead><tr><th>Name</th><th>Organisation</th>${list.map((d, i) => `<th title="${esc(d.s.topic)}">S${i + 1}</th>`).join("")}<th>Post-test</th>${p.certificates ? "<th>Certificate</th>" : ""}</tr></thead><tbody>
        ${people.map(x => { const per = Object.fromEntries((x.per || []).map(y => [y.session, y])); return `<tr><td><b>${esc(fullName(x))}</b></td><td>${esc(x.organisation)}</td>${list.map(d => { const y = per[d.s.id]; return `<td class="${y?.here ? "rok" : "rno"}">${y?.here ? y.pct + "%" : "–"}</td>`; }).join("")}<td>${x.post == null ? "–" : x.post + "%"}</td>${p.certificates ? `<td>${x.cert?.status === "valid" ? esc(x.cert.number) : x.qualifies ? "Qualifies" : "Not yet"}</td>` : ""}</tr>`; }).join("")}</tbody></table>
        <p class="rnote">S1, S2… are the sessions in the table above; each cell shows the share of that session the person was in the room.</p></section>` : ""}
      ${foot()}</article>`;
  }
  return { sessionData, session, programme, dmy, autoSummary, autoProgrammeSummary };
})();
