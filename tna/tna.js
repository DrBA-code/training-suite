// Training needs survey: the page a person opens from their personal WhatsApp link (#token).
(() => {
  "use strict";
  const cfg = window.TS_CONFIG || {}, sb = window.supabase && cfg.SUPABASE_URL ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const IMP = ["Not important", "Slightly", "Important", "Very", "Essential"];
  const ABL = ["None", "Basic", "Fair", "Good", "Expert"];
  const FIELDS = [["department", "Department or unit"], ["grade", "Grade level"], ["role", "Role or job title"], ["years", "Years in service"]];
  const app = document.getElementById("app");
  const top = `<div class="vtop"><img src="../assets/logo.png" alt="" width="30" height="32"> Training Suite</div>`;
  const token = decodeURIComponent(location.hash.replace(/^#\/?/, "")).trim();
  const card = html => (app.innerHTML = top + `<div class="vcard">${html}</div>`);
  const KEY = "ts_tna_" + token;
  const draftGet = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const draftSet = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} };
  const draftDrop = () => { try { localStorage.removeItem(KEY); } catch {} };
  let S = null, A = null;

  async function load() {
    if (!sb) return card(`<h1>Not set up</h1><p class="muted">This survey isn't connected yet.</p>`);
    if (!/^[0-9a-f-]{36}$/i.test(token)) return card(`<h1>Link not complete</h1><p class="muted">Open the full link from your message. If it was cut off, ask the sender to send it again.</p>`);
    const { data, error } = await sb.rpc("tna_open", { p_token: token });
    if (error) return card(`<h1>Couldn't open the survey</h1><p class="muted">Check your connection and try again.</p><button class="btn" type="button" onclick="location.reload()">Try again</button>`);
    if (!data) return card(`<h1>Link not found</h1><p class="muted">This link isn't valid any more. Ask the sender for a new one.</p>`);
    S = data;
    if (S.status === "draft") return card(`<h1>${esc(S.title)}</h1><p class="muted">This survey hasn't opened yet. Please try the link again later.</p>`);
    const saved = S.answers || {};
    A = draftGet() || { profile: {}, ratings: {}, open: {} };
    A.profile = { organisation: S.person.organisation, department: S.person.department, grade: S.person.grade, ...(saved.profile || {}), ...(A.profile || {}) };
    A.ratings = { ...(saved.ratings || {}), ...(A.ratings || {}) };
    A.open = { ...(saved.open || {}), ...(A.open || {}) };
    if (S.status === "closed") return card(`<div class="big">🙏</div><h1>This survey is closed</h1><p class="muted">${S.submitted_at ? "Your answers were received. Thank you." : "It's no longer taking answers. Thank you."}</p>`);
    if (S.submitted_at && !draftGet()) return thanks(false);
    form();
  }
  const who = () => ((S.person.title ? S.person.title + " " : "") + S.person.name).trim();
  function thanks(justNow) {
    card(`<div class="big">${justNow ? "🎉" : "✅"}</div><h1>${justNow ? "Thank you" : "You've already answered"}, ${esc(who())}</h1>
      <p>${justNow ? "Your answers have been received. They'll help plan training that fits your work." : "Your answers were received. You can change them until the survey closes."}</p>
      <button class="btn ghost" type="button" id="again">Change my answers</button>`);
    document.getElementById("again").onclick = () => form();
  }
  const scale = (kind, aid, val) => `<div class="scale ${kind}" role="group">${(kind === "imp" ? IMP : ABL).map((l, i) => `<button type="button" data-k="${kind}" data-a="${esc(aid)}" data-v="${i + 1}" aria-pressed="${+val === i + 1}">${i + 1}<small>${l}</small></button>`).join("")}</div>`;
  function form() {
    const areas = S.areas || [], f = S.fields || {};
    let lastCat = "";
    app.innerHTML = top + `
      <div class="vcard"><span class="lbl">${esc(S.org || "Training needs survey")}</span><h1>${esc(S.title)}</h1><p><b>Hello ${esc(who())}.</b></p>${S.intro ? `<p>${esc(S.intro).replace(/\n/g, "<br>")}</p>` : ""}
        <p class="small muted">${areas.length} skill areas · about ${Math.max(3, Math.round(areas.length * 0.35 + 1))} minutes. Your answers save on this phone as you go.</p></div>
      <div class="vcard"><h2>About you</h2>
        <label class="fld">Organisation/MDA<input id="pf_organisation" value="${esc(A.profile.organisation)}" maxlength="200"></label>
        ${FIELDS.filter(([k]) => f[k]).map(([k, l]) => `<label class="fld">${l}<input id="pf_${k}" value="${esc(A.profile[k])}" maxlength="${k === "grade" ? 60 : 200}" ${k === "years" ? 'inputmode="numeric"' : ""}></label>`).join("")}</div>
      <div class="tprog" aria-hidden="true"><span id="pTxt"></span><i><em id="pBar"></em></i></div>
      ${areas.map(a => { const r = A.ratings[a.id] || {}, head = a.cat !== lastCat ? `<h2 style="margin:6px 4px -4px;font-size:18px">${esc(a.cat)}</h2>` : ""; lastCat = a.cat;
        return `${head}<div class="vcard area ${r.imp && r.abl ? "done" : ""}" data-area="${esc(a.id)}"><div><b style="font-size:17px">${esc(a.name)}</b>${a.desc ? `<div class="small muted">${esc(a.desc)}</div>` : ""}</div>
          <div class="q">How important is this to your job?</div>${scale("imp", a.id, r.imp)}<div class="q">How able are you in it today?</div>${scale("abl", a.id, r.abl)}</div>`; }).join("")}
      ${(S.questions || []).length ? `<div class="vcard"><h2>In your own words</h2><p class="small muted">Optional.</p>${S.questions.map(q => `<label class="fld">${esc(q.text)}<textarea id="oq_${esc(q.id)}" rows="3" maxlength="1500">${esc(A.open[q.id])}</textarea></label>`).join("")}</div>` : ""}
      <p class="err" id="err" role="alert"></p>
      <div class="sendbar"><button class="btn red" type="button" id="send">Send my answers</button></div>`;
    const prog = () => { const n = areas.filter(a => A.ratings[a.id]?.imp && A.ratings[a.id]?.abl).length; document.getElementById("pTxt").textContent = `${n} of ${areas.length} skill areas rated`; document.getElementById("pBar").style.width = (areas.length ? 100 * n / areas.length : 0) + "%"; };
    prog();
    app.querySelectorAll(".scale button").forEach(b => (b.onclick = () => {
      const r = (A.ratings[b.dataset.a] = A.ratings[b.dataset.a] || {}); r[b.dataset.k] = +b.dataset.v;
      b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      const c = b.closest(".area"); c.classList.toggle("done", !!(r.imp && r.abl)); draftSet(A); prog();
      if (r.imp && r.abl && b.dataset.k === "abl") { const next = c.nextElementSibling?.classList.contains("area") ? c.nextElementSibling : c.nextElementSibling?.nextElementSibling; if (next?.classList.contains("area") && !next.classList.contains("done")) setTimeout(() => next.scrollIntoView({ behavior: "smooth", block: "center" }), 180); }
    }));
    app.querySelectorAll("[id^=pf_]").forEach(i => (i.oninput = () => { A.profile[i.id.slice(3)] = i.value.trim(); draftSet(A); }));
    app.querySelectorAll("[id^=oq_]").forEach(i => (i.oninput = () => { A.open[i.id.slice(3)] = i.value; draftSet(A); }));
    document.getElementById("send").onclick = async e => {
      const err = document.getElementById("err"); err.textContent = "";
      const miss = areas.filter(a => !(A.ratings[a.id]?.imp && A.ratings[a.id]?.abl));
      if (miss.length) { err.textContent = `Please rate ${miss.length === 1 ? "one more skill area" : miss.length + " more skill areas"}: both scales for each.`; app.querySelector(`.area[data-area="${CSS.escape(miss[0].id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const ratings = {}; areas.forEach(a => (ratings[a.id] = { imp: A.ratings[a.id].imp, abl: A.ratings[a.id].abl }));
      const open = {}; (S.questions || []).forEach(q => { const t = String(A.open[q.id] || "").trim(); if (t) open[q.id] = t.slice(0, 1500); });
      const b = e.currentTarget; b.disabled = true; b.textContent = "Sending…";
      const { error } = await sb.rpc("tna_submit", { p_token: token, p_answers: { profile: A.profile, ratings, open } });
      if (error) { b.disabled = false; b.textContent = "Send my answers"; err.textContent = /closed/i.test(error.message || "") ? "This survey has closed. Thank you." : "Couldn't send. Check your connection and try again: your answers are kept on this phone."; return; }
      draftDrop(); S.submitted_at = new Date().toISOString(); S.answers = { profile: A.profile, ratings, open }; scrollTo({ top: 0 }); thanks(true);
    };
  }
  load();
})();
