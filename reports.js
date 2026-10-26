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
    const end = s.ended_at ? new Date(s.ended_at) : null, span = start && end ? (end - start) / 1000 : null;
    const items = window.TSE ? TSE.formFor(s, s.evaluation || {}) : [], E = ev && window.TSE ? TSE.score(items, ev.rows || []) : null;
    const mda = new Map(); R.forEach(r => { const raw = String(r.organisation || "").trim(); if (!raw) return; const k = window.TSGR ? TSGR.norm(raw) : raw.toLowerCase(); const e = mda.get(k) || { label: raw, n: 0 }; e.n++; mda.set(k, e); });
    return {
      s, roll: R, part: P, learn: L, eval: E, evalN: ev?.rows?.length || 0, attendees: R.length,
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

  function session(d, p) {
    const s = d.s, E = d.eval, obj = String(s.objectives || "").split("\n").map(x => x.trim()).filter(Boolean);
    const meta = [p?.name, dmy(s.session_date), s.start_time, s.venue, s.course_lead && "Course lead: " + s.course_lead].filter(Boolean).map(esc).join(" · ");
    const strong = E ? E.per.filter(i => i.avg != null && i.type !== "stars" && !["before", "after"].includes(i.id)).sort((a, b) => b.avg - a.avg) : [];
    const comments = E ? E.texts.flatMap(t => t.answers.slice(0, 4).map(a => ({ q: t.id, t: a.t }))) : [];
    return `<article class="rpt">${head("Session report", s.topic, meta, p?.cert_design?.logo)}
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

  function programme(p, list, people) {
    const run = list.filter(d => d.s.status === "completed" || d.attendees), uniq = people ? people.filter(x => (x.per || []).some(y => y.here)).length : null;
    const issued = people ? people.filter(x => x.cert?.status === "valid").length : null;
    const rated = list.filter(d => d.eval?.overall != null);
    const meta = [p.code, p.dates, p.venue].filter(Boolean).map(esc).join(" · ") || `${list.length} session${list.length === 1 ? "" : "s"}`;
    return `<article class="rpt">${head("Programme report", p.name, meta, p.cert_design?.logo)}
      <div class="rks">${kpi("Sessions held", `${run.length}<small>/${list.length}</small>`, "", "#1F5FBF")}
        ${kpi("Participants", uniq ?? Math.max(0, ...list.map(d => d.attendees)), "Took part in at least one session", "#0F8A5F")}
        ${kpi("Average attendance", list.length ? Math.round(avg(run.map(d => d.attendees)) || 0) : "–", "Per session", "#D2391F")}
        ${kpi("Learning achievement", pct(avg(list.filter(d => d.achAvg != null).map(d => d.achAvg))), "Average across sessions", "#6D3FC0")}
        ${kpi("Participant rating", rated.length ? stars(avg(rated.map(d => d.eval.overall))) : "–", issued != null && p.certificates ? `${issued} certificate${issued === 1 ? "" : "s"} issued` : "", "#B8860B")}</div>
      <section class="rwide"><h2>Sessions</h2><table class="rt"><thead><tr><th>Date</th><th>Session</th><th>Checked in</th><th>Time in room</th><th>Participation</th><th>Pre → post</th><th>Achievement</th><th>Rating</th></tr></thead><tbody>
        ${list.map(d => `<tr><td>${esc(dmy(d.s.session_date) || "–")}</td><td><b>${esc(d.s.topic)}</b></td><td>${d.attendees}</td><td>${d.timePct != null ? pct(d.timePct) : hm(d.spent)}</td><td>${pct(d.partAvg)}</td><td>${d.pre != null || d.post != null ? `${pct(d.pre)} → ${pct(d.post)}` : "–"}</td><td>${pct(d.achAvg)}</td><td>${d.eval?.overall != null ? stars(d.eval.overall) : "–"}</td></tr>`).join("")}</tbody></table></section>
      ${people && people.length ? `<section class="rwide${people.length > 14 ? " rbreak" : ""}"><h2>Participants</h2><table class="rt rsm"><thead><tr><th>Name</th><th>Organisation</th>${list.map((d, i) => `<th title="${esc(d.s.topic)}">S${i + 1}</th>`).join("")}<th>Post-test</th>${p.certificates ? "<th>Certificate</th>" : ""}</tr></thead><tbody>
        ${people.map(x => { const per = Object.fromEntries((x.per || []).map(y => [y.session, y])); return `<tr><td><b>${esc(fullName(x))}</b></td><td>${esc(x.organisation)}</td>${list.map(d => { const y = per[d.s.id]; return `<td class="${y?.here ? "rok" : "rno"}">${y?.here ? y.pct + "%" : "–"}</td>`; }).join("")}<td>${x.post == null ? "–" : x.post + "%"}</td>${p.certificates ? `<td>${x.cert?.status === "valid" ? esc(x.cert.number) : x.qualifies ? "Qualifies" : "Not yet"}</td>` : ""}</tr>`; }).join("")}</tbody></table>
        <p class="rnote">S1, S2… are the sessions in the table above; each cell shows the share of that session the person was in the room.</p></section>` : ""}
      ${foot()}</article>`;
  }
  return { sessionData, session, programme, dmy };
})();
