// Training Suite activities: the catalogue, the question builder and the live runner on the projector.
// Phones answer in checkin/checkin.js; scoring happens in the database (schema-3-activities.sql).
window.TSA = (() => {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LETTERS = "ABCDEF";
  const COLORS = ["#F4B400", "#3FB98A", "#5AA9E6", "#F2786F", "#B48EF0", "#F0A35E"];
  const KINDS = {
    poll:   { name: "Live poll",       line: "Ask the room. Bars grow as votes come in.", opts: true, sec: 0, color: "#F4B400" },
    words:  { name: "Word cloud",      line: "Short answers grow on screen as people repeat them.", sec: 0, color: "#2747C8" },
    quiz:   { name: "Quiz",            line: "Timed multiple choice. Faster right answers score more.", opts: true, scored: true, sec: 20, color: "#2747C8" },
    buzz:   { name: "First to catch",  line: "The first correct answer wins the round.", opts: true, scored: true, sec: 0, color: "#F4B400" },
    battle: { name: "Group battle",    line: "Group A against Group B, with a tug-of-war bar.", opts: true, scored: true, sec: 20, teams: true, color: "#14161C" },
    order:  { name: "Order it",        line: "Put the steps of a process in the right order.", scored: true, sec: 60, color: "#D2391F" },
    match:  { name: "Match it",        line: "Pair each term with its meaning.", scored: true, sec: 60, color: "#2747C8" },
    spot:   { name: "Spot the error",  line: "Participants tap the mistake on a picture.", scored: true, sec: 45, color: "#F4B400" },
    case:   { name: "Case study race", line: "Groups answer a case; the first group to answer is shown.", sec: 300, teams: true, text: true, color: "#14161C" },
    exit:   { name: "Exit ticket",     line: "“One thing I'll apply at my desk.”", sec: 0, text: true, color: "#D2391F" },
    test:   { name: "Pre & post test", line: "The same questions at the start and the end. Each person sees their learning achievement.", opts: true, scored: true, sec: 30, color: "#D2391F", noboard: true }
  };
  const PROMPTY = k => ["case", "exit", "words"].includes(k);
  function blankStep(kind) {
    const k = KINDS[kind] || {};
    if (k.opts) return k.scored ? { q: "", options: ["", "", "", ""], correct: 0 } : { q: "", options: ["", "", ""] };
    if (kind === "words") return { q: "", max: 1 };
    if (kind === "order") return { q: "Put these in the right order", items: [] };
    if (kind === "match") return { q: "Match each term to its meaning", pairs: [] };
    if (kind === "spot") return { q: "Tap the error", image: "", aspect: 1.5, region: null };
    if (kind === "case") return { q: "What should the officer do, and why?", text: "" };
    if (kind === "exit") return { q: "One thing I'll apply at my desk next week" };
    return { q: "" };
  }
  // Tidy and check what was typed. Returns [steps, error].
  function clean(kind, steps) {
    const k = KINDS[kind], out = [];
    for (const [n, s0] of steps.entries()) {
      const s = structuredClone(s0), at = steps.length > 1 ? ` (${PROMPTY(kind) ? "prompt" : "question"} ${n + 1})` : "";
      s.q = String(s.q || "").trim();
      if (!s.q) return [null, "Type the question" + at + "."];
      if (k.opts) {
        const kept = []; let correct = -1;
        s.options.forEach((o, j) => { o = String(o || "").trim(); if (o) { if (j === s.correct) correct = kept.length; kept.push(o); } });
        if (kept.length < 2) return [null, "Give at least two options" + at + "."];
        s.options = kept;
        if (k.scored) { if (correct < 0) return [null, "Tick the correct answer" + at + "."]; s.correct = correct; } else delete s.correct;
      }
      if (kind === "order" && (s.items || []).length < 3) return [null, "List at least three items" + at + ", one per line."];
      if (kind === "order" && new Set(s.items).size !== s.items.length) return [null, "Each item must be different" + at + "."];
      if (kind === "match" && (s.pairs || []).length < 2) return [null, "Add at least two pairs" + at + ", like: term = meaning."];
      if (kind === "match" && new Set(s.pairs.map(p => p.r)).size !== s.pairs.length) return [null, "Each meaning must be different" + at + "."];
      if (kind === "spot" && !s.image) return [null, "Upload a picture" + at + "."];
      if (kind === "spot" && !s.region) return [null, "Click the picture where the error is" + at + "."];
      if (kind === "case") s.text = String(s.text || "").trim();
      out.push(s);
    }
    if (!out.length) return [null, "Add a question."];
    return [out, null];
  }

  // ================= BUILDER =================
  // builder(el, { kind, title, steps, seconds, upload(file) → {url, aspect}, onSave({title, steps, seconds}) → Promise, onCancel })
  function builder(el, o) {
    const k = KINDS[o.kind], kind = o.kind;
    const B = { title: o.title || "", seconds: o.seconds ?? k.sec ?? 0, steps: structuredClone(o.steps && o.steps.length ? o.steps : [blankStep(kind)]) };
    const SECS = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600];
    el.innerHTML = `<div class="bld">
      <label class="fld">Title<input data-b="title" value="${esc(B.title)}" placeholder="${esc(k.name)}"></label>
      <div class="bsteps" data-b="steps"></div>
      <div class="row"><button class="btn ghost small" type="button" data-b="add">+ Add ${PROMPTY(kind) ? "another prompt" : "question"}</button></div>
      <label class="fld" style="max-width:260px">Time per ${PROMPTY(kind) ? "prompt" : "question"}<select data-b="sec">${SECS.map(s => `<option value="${s}" ${s === B.seconds ? "selected" : ""}>${s ? (s >= 60 ? s / 60 + " min" : s + " seconds") : "No timer"}</option>`).join("")}</select></label>
      <div class="wfoot"><button class="btn ghost" type="button" data-b="cancel">Cancel</button><div class="row"><span class="err" data-b="err" role="status"></span><button class="btn red" type="button" data-b="save">Save questions</button></div></div></div>`;
    const q = s => el.querySelector(`[data-b="${s}"]`), stepsEl = q("steps"), errEl = q("err");
    function card(s, i) {
      let body = `<label class="fld">${kind === "case" ? "Task" : PROMPTY(kind) ? "Prompt" : "Question"}<textarea rows="2" data-f="q" data-i="${i}" placeholder="${kind === "case" ? "What should the officer do, and why?" : "Type the question"}">${esc(s.q)}</textarea></label>`;
      if (k.opts) {
        body += `<div class="opts">${s.options.map((op, j) => `<div class="optrow">
          ${k.scored ? `<input type="radio" name="c${i}" data-f="correct" data-i="${i}" value="${j}" ${s.correct === j ? "checked" : ""} aria-label="Correct answer ${LETTERS[j]}">` : "<span></span>"}
          <span class="let" style="background:${COLORS[j]}">${LETTERS[j]}</span>
          <input data-f="opt" data-i="${i}" data-o="${j}" value="${esc(op)}" placeholder="Option ${LETTERS[j]}" aria-label="Option ${LETTERS[j]}">
          <button class="x" data-a="delopt" data-i="${i}" data-o="${j}" type="button" aria-label="Remove option" ${s.options.length <= 2 ? "hidden" : ""}>×</button></div>`).join("")}</div>
          <div class="row">${s.options.length < 6 ? `<button class="btn ghost small" data-a="addopt" data-i="${i}" type="button">+ Option</button>` : ""}<span class="small muted">${k.scored ? "Tick the correct answer." : ""}</span></div>`;
      } else if (kind === "words") {
        body += `<label class="fld" style="max-width:220px">Answers per person<select data-f="max" data-i="${i}">${[1, 2, 3].map(n => `<option ${s.max === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
      } else if (kind === "order") {
        body += `<label class="fld">Items in the CORRECT order, one per line<span class="hint">Phones get them shuffled.</span><textarea rows="5" data-f="items" data-i="${i}" placeholder="Raise a requisition&#10;Get approval&#10;Invite quotations">${esc((s.items || []).join("\n"))}</textarea></label>`;
      } else if (kind === "match") {
        body += `<label class="fld">One pair per line: term = meaning<textarea rows="5" data-f="pairs" data-i="${i}" placeholder="MDA = Ministry, Department or Agency&#10;LPO = Local Purchase Order">${esc((s.pairs || []).map(p => p.l + " = " + p.r).join("\n"))}</textarea></label>`;
      } else if (kind === "spot") {
        body += `<div class="row"><label class="btn ghost small">${s.image ? "Change picture" : "Upload a slide or document picture"}<input type="file" accept="image/*" data-a="spotimg" data-i="${i}" hidden></label><span class="small muted">${s.image ? "Click the picture where the error is." : "PNG or JPG."}</span></div>
          ${s.image ? `<div class="spotpick" data-i="${i}"><img src="${esc(s.image)}" alt="">${s.region ? `<span class="tgt" style="left:${s.region.x * 100}%;top:${s.region.y * 100}%;width:${s.region.r * 2 / s.aspect * 100}%;aspect-ratio:1"></span>` : ""}</div>
          <label class="fld" style="max-width:280px">Target size<input type="range" min="0.03" max="0.25" step="0.01" value="${s.region?.r || 0.08}" data-f="r" data-i="${i}"></label>` : ""}`;
      } else if (kind === "case") {
        body += `<label class="fld">The case (shown on phones)<textarea rows="6" data-f="text" data-i="${i}" placeholder="Describe the situation…">${esc(s.text)}</textarea></label>`;
      }
      const label = (PROMPTY(kind) ? "Prompt" : "Question") + (B.steps.length > 1 ? " " + (i + 1) : "");
      return `<div class="stepc"><div class="sh"><b>${label}</b><span class="mini">${i > 0 ? `<button data-a="up" data-i="${i}" type="button" aria-label="Move up">↑</button>` : ""}${i < B.steps.length - 1 ? `<button data-a="down" data-i="${i}" type="button" aria-label="Move down">↓</button>` : ""}${B.steps.length > 1 ? `<button data-a="del" data-i="${i}" type="button" aria-label="Remove">×</button>` : ""}</span></div>${body}</div>`;
    }
    const draw = () => (stepsEl.innerHTML = B.steps.map(card).join(""));
    draw();
    q("title").addEventListener("input", e => (B.title = e.target.value));
    q("sec").addEventListener("change", e => (B.seconds = +e.target.value));
    q("add").addEventListener("click", () => { B.steps.push(blankStep(kind)); draw(); stepsEl.lastElementChild?.querySelector("textarea")?.focus(); });
    q("cancel").addEventListener("click", () => o.onCancel && o.onCancel());
    q("save").addEventListener("click", async () => {
      const [steps, err] = clean(kind, B.steps);
      if (err) { errEl.textContent = err; return; }
      errEl.textContent = "Saving…";
      try { await o.onSave({ title: B.title.trim() || k.name, steps, seconds: B.seconds }); errEl.textContent = "Saved ✓"; }
      catch (e) { errEl.textContent = (e && e.message) || "Couldn't save."; }
    });
    stepsEl.addEventListener("input", e => {
      const t = e.target, s = B.steps[+t.dataset.i]; if (!s || !t.dataset.f) return;
      const f = t.dataset.f;
      if (f === "q" || f === "text") s[f] = t.value;
      else if (f === "opt") s.options[+t.dataset.o] = t.value;
      else if (f === "correct") s.correct = +t.value;
      else if (f === "max") s.max = +t.value;
      else if (f === "items") s.items = t.value.split("\n").map(x => x.trim()).filter(Boolean);
      else if (f === "pairs") s.pairs = t.value.split("\n").map(x => x.trim().match(/^(.+?)\s*(?:=|→|:|\s-\s)\s*(.+)$/)).filter(Boolean).map(m => ({ l: m[1].trim(), r: m[2].trim() }));
      else if (f === "r") { if (s.region) { s.region = { ...s.region, r: +t.value }; const ring = t.closest(".stepc").querySelector(".tgt"); if (ring) ring.style.width = (s.region.r * 2 / s.aspect * 100) + "%"; } }
    });
    stepsEl.addEventListener("change", async e => {
      const t = e.target; if (t.dataset.a !== "spotimg" || !t.files[0]) return;
      const s = B.steps[+t.dataset.i]; errEl.textContent = "Uploading picture…";
      try { const r = await o.upload(t.files[0]); s.image = r.url; s.aspect = r.aspect; s.region = null; errEl.textContent = ""; draw(); }
      catch (err) { errEl.textContent = "Couldn't upload the picture. " + ((err && err.message) || ""); }
    });
    stepsEl.addEventListener("click", e => {
      const pick = e.target.closest(".spotpick");
      if (pick) { const s = B.steps[+pick.dataset.i], r = pick.getBoundingClientRect(); s.region = { x: +((e.clientX - r.left) / r.width).toFixed(4), y: +((e.clientY - r.top) / r.height).toFixed(4), r: s.region?.r || 0.08 }; draw(); return; }
      const b = e.target.closest("button[data-a]"); if (!b) return;
      const i = +b.dataset.i, s = B.steps[i], a = b.dataset.a;
      if (a === "addopt") s.options.push("");
      if (a === "delopt") { const n = +b.dataset.o; s.options.splice(n, 1); if (s.correct === n) s.correct = 0; else if (s.correct > n) s.correct--; }
      if (a === "up" && i > 0) [B.steps[i - 1], B.steps[i]] = [B.steps[i], B.steps[i - 1]];
      if (a === "down" && i < B.steps.length - 1) [B.steps[i + 1], B.steps[i]] = [B.steps[i], B.steps[i + 1]];
      if (a === "del") B.steps.splice(i, 1);
      draw();
    });
  }
  function shrinkImage(file, max = 1600) {
    return new Promise((res, rej) => {
      const img = new Image(); img.onerror = () => rej(new Error("That file isn't a picture."));
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? res({ blob: b, aspect: +(c.width / c.height).toFixed(4) }) : rej(new Error("Couldn't read the picture.")), "image/jpeg", 0.86);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // ================= LIVE RUNNER =================
  // live(el, { sb, session, activity, run, channel, phones() }) → { main(), next(), prev(), board(), destroy() }
  function live(el, o) {
    const act = o.activity, kind = act.kind, K = KINDS[kind], steps = act.data.steps || [], seconds = +(act.data.seconds || 0);
    const boardOK = K.scored && !K.noboard, noReveal = kind === "test" && o.run === "pre";
    const L = { step: 0, phase: "open", all: [], rows: [], deadline: 0, winner: null, overlay: false, dead: false };
    const pct = x => Math.round((x || 0) * 100);
    const initials = n => String(n || "?").replace(/^(Prof|Dr|Engr|Mr|Mrs|Miss|Ms)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    const firstName = n => String(n || "").replace(/^(Prof|Dr|Engr|Mr|Mrs|Miss|Ms)\.?\s+/i, "").split(/\s+/)[0] || n;
    el.innerHTML = `<div class="lv">
      <div class="lv-top"><span class="lbl" style="color:var(--yellow)" data-l="kind"></span><span class="st-mono" data-l="step"></span><span class="lv-count"><b data-l="count">0</b> <span data-l="countLbl">answered</span></span></div>
      <div class="lv-timer" data-l="timer"><i></i></div>
      <div class="lv-tug" data-l="tug" ${K.teams && kind !== "case" ? "" : "hidden"}><span>Group A <b data-l="tA">0</b></span><div class="track"><i data-l="tBar"></i><span class="mid"></span></div><span><b data-l="tB">0</b> Group B</span></div>
      <h2 class="lv-q" data-l="q"></h2><div class="lv-sub" data-l="sub"></div>
      <div class="lv-viz" data-l="viz"></div>
      <div class="lv-faces" data-l="faces" aria-hidden="true"></div>
      <div class="lv-bar"><button class="key" type="button" data-l="prev" aria-label="Previous question">◀ Q</button><button class="key next" type="button" data-l="main"></button><button class="key" type="button" data-l="nextq" aria-label="Next question">Q ▶</button>${boardOK ? `<button class="key" type="button" data-l="board">Leaderboard</button>` : ""}<span class="st-mono">Space: next step</span></div>
      <div class="lv-over" data-l="over" hidden></div></div>`;
    const $l = n => el.querySelector(`[data-l="${n}"]`);
    const stepNow = () => steps[L.step];
    const label = () => (kind === "test" ? (o.run === "pre" ? "Pre-test" : "Post-test") : K.name);
    async function setPhase(phase) {
      L.phase = phase;
      L.deadline = phase === "open" && seconds > 0 ? Date.now() + seconds * 1000 : 0;
      const { error } = await o.sb.rpc("set_live", { p_session: o.session.id, p_activity: act.id, p_run: o.run, p_step: L.step, p_phase: phase, p_seconds: seconds });
      if (error) $l("sub").textContent = "Couldn't update the phones: " + error.message;
      o.channel?.send({ type: "broadcast", event: "live", payload: { phase, step: L.step } });
      render();
    }
    async function goStep(i) {
      if (i < 0 || i >= steps.length) return;
      L.step = i; L.rows = []; L.winner = null; closeOverlay();
      await setPhase("open"); fetchRows();
    }
    let fetching = false, again = false;
    async function fetchRows() {
      if (L.dead) return;
      if (fetching) { again = true; return; }
      fetching = true;
      const { data } = await o.sb.rpc("live_results", { p_activity: act.id, p_run: o.run });
      fetching = false; if (again) { again = false; setTimeout(fetchRows, 0); }
      if (L.dead) return;
      L.all = Array.isArray(data) ? data : []; L.rows = L.all.filter(r => r.step === L.step);
      if (kind === "buzz" && !L.winner && L.phase === "open") {
        const w = L.rows.filter(r => +r.score === 1).sort((a, b) => new Date(a.at) - new Date(b.at))[0];
        if (w) { L.winner = w; o.channel?.send({ type: "broadcast", event: "winner", payload: { name: w.name, step: L.step } }); await setPhase("reveal"); showWinner(w); }
      }
      render();
    }
    const poll = setInterval(() => { if (L.phase === "open" && !document.hidden) fetchRows(); }, 3000);
    const timer = setInterval(() => {
      const t = $l("timer"); if (!t) return;
      if (!L.deadline || L.phase !== "open") { t.classList.remove("on"); return; }
      const left = Math.max(0, L.deadline - Date.now());
      t.classList.add("on"); t.classList.toggle("low", left < 5000);
      t.firstElementChild.style.transform = `scaleX(${left / (seconds * 1000)})`;
      $l("step").textContent = stepLabel() + ` · ${Math.ceil(left / 1000)}s`;
      if (left <= 0) { L.deadline = 0; setPhase("closed").then(fetchRows); }
    }, 250);
    const onAnswered = () => { clearTimeout(onAnswered.t); onAnswered.t = setTimeout(fetchRows, 300); };
    const stepLabel = () => steps.length > 1 ? `${PROMPTY(kind) ? "Prompt" : "Question"} ${L.step + 1} of ${steps.length}` : "";
    function mainLabel() {
      if (L.overlay) return "Continue";
      if (noReveal) return L.step < steps.length - 1 ? "Next question ▶" : "Finish the pre-test ✓";
      if (L.phase === "open" || L.phase === "closed") return K.scored ? "Reveal answer" : "Show results";
      if (L.step < steps.length - 1) return "Next question ▶";
      return boardOK ? "Final leaderboard" : "Done ✓";
    }
    function main() {
      if (L.overlay) { closeOverlay(); if (L.after) { const f = L.after; L.after = null; f(); } return; }
      if (noReveal) { if (L.step < steps.length - 1) return goStep(L.step + 1); return setPhase("closed").then(() => o.onDone && o.onDone()); }
      if (L.phase === "open" || L.phase === "closed") return setPhase("reveal").then(fetchRows);
      if (L.step < steps.length - 1) return goStep(L.step + 1);
      if (boardOK) { showBoard(true); return; }
      o.onDone && o.onDone();
    }
    function render() {
      if (L.dead) return;
      const s = stepNow(), rev = L.phase === "reveal";
      $l("kind").textContent = label(); $l("step").textContent = stepLabel();
      $l("q").textContent = s.q; $l("sub").textContent = "";
      const phones = o.phones ? o.phones() : 0;
      $l("count").textContent = L.rows.length; $l("countLbl").textContent = phones ? `of ${phones} answered` : "answered";
      $l("main").textContent = mainLabel();
      $l("prev").disabled = L.step === 0; $l("nextq").disabled = L.step >= steps.length - 1;
      if (!$l("tug").hidden) {
        const t = { A: 0, B: 0 }; L.all.forEach(r => { if (r.grp === "A" || r.grp === "B") t[r.grp] += r.points || 0; });
        $l("tA").textContent = t.A; $l("tB").textContent = t.B; $l("tBar").style.width = (t.A + t.B ? 15 + 70 * t.A / (t.A + t.B) : 50) + "%";
      }
      const showFaces = !rev && !["words", "poll", "exit"].includes(kind);
      $l("faces").innerHTML = showFaces ? L.rows.slice(-60).map(r => `<span class="fc ${r.grp}">${r.photo ? `<img src="${esc(r.photo)}" alt="">` : esc(initials(r.name))}</span>`).join("") : "";
      (VIZ[kind] || VIZ.text)($l("viz"), s, L.rows, rev);
    }
    const counts = (rows, n) => { const c = Array(n).fill(0); rows.forEach(r => { const i = +r.answer?.i; if (i >= 0 && i < n) c[i]++; }); return c; };
    function bars(options, c, { hide = false, correct = null } = {}) {
      const max = Math.max(1, ...c), total = c.reduce((a, b) => a + b, 0);
      return `<div class="lv-bars${hide ? " hide" : ""}">${options.map((op, j) => `<div class="lv-row${correct != null ? (j === correct ? " right" : " dim") : ""}">
        <span class="let" style="background:${COLORS[j]}">${LETTERS[j]}</span>
        <span class="tr"><span class="fill" style="width:${(c[j] / max) * 100}%;background:${COLORS[j]}"></span><span class="lab">${esc(op)}</span></span>
        <span class="num">${total ? Math.round(c[j] / total * 100) + "%" : "–"}</span></div>`).join("")}</div>`;
    }
    const waiting = t => `<p class="lv-wait">${esc(t)}</p>`;
    const fmtMs = ms => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : s + "s"; };
    const VIZ = {
      poll(v, s, rows) { v.innerHTML = bars(s.options, counts(rows, s.options.length)); },
      quiz(v, s, rows, rev) {
        v.innerHTML = bars(s.options, counts(rows, s.options.length), { hide: !rev, correct: rev ? s.correct : null });
        if (rev && rows.length) $l("sub").textContent = `${pct(rows.filter(r => +r.score === 1).length / rows.length)}% got it right`;
      },
      buzz(v, s, rows, rev) {
        v.innerHTML = bars(s.options, counts(rows, s.options.length), { hide: !rev, correct: rev ? s.correct : null });
        $l("sub").textContent = L.winner ? `${L.winner.name} caught it first · ${(L.winner.ms / 1000).toFixed(1)}s` : rev ? "Nobody caught this one." : "First correct answer wins!";
      },
      words(v, s, rows) {
        const m = new Map();
        rows.forEach(r => (r.answer?.words || []).forEach(w => { const key = String(w).trim().toLowerCase().replace(/[.!?,;:]+$/, ""); if (key) { const e = m.get(key) || { w: String(w).trim(), n: 0 }; e.n++; m.set(key, e); } }));
        const list = [...m.values()].sort((a, b) => b.n - a.n).slice(0, 60), max = Math.max(1, ...list.map(x => x.n));
        const hash = t => [...t].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
        const size = x => max > 1 ? 22 + 98 * Math.sqrt((x.n - 1) / (max - 1)) : 56;   // all different → one middle size
        v.innerHTML = list.length ? `<div class="lv-cloud">${[...list].sort((a, b) => hash(a.w) - hash(b.w)).map(x => `<span data-s="${size(x)}" style="font-size:${Math.round(size(x))}px;color:${COLORS[hash(x.w) % COLORS.length]}" title="${x.n}">${esc(x.w)}</span>`).join("")}</div>` : waiting("Words appear here as people answer.");
        const c = v.querySelector(".lv-cloud");
        if (c) { let k = 1; const fits = () => c.scrollHeight <= c.clientHeight + 2 && c.scrollWidth <= c.clientWidth + 2;
          for (let n = 0; n < 30 && !fits(); n++) { k *= 0.88; [...c.children].forEach(sp => (sp.style.fontSize = Math.max(11, Math.round(+sp.dataset.s * k)) + "px")); } }
      },
      order(v, s, rows, rev) {
        if (!rev) { v.innerHTML = waiting(`${rows.length} answered. Reveal to see the right order.`); return; }
        $l("sub").textContent = rows.length ? `${pct(rows.filter(r => +r.score === 1).length / rows.length)}% got the whole order right` : "";
        v.innerHTML = `<div class="lv-list">${s.items.map((it, i) => { const ok = rows.filter(r => r.answer?.items?.[i] === it).length; return `<div><b>${i + 1}</b><span>${esc(it)}</span><small>${rows.length ? pct(ok / rows.length) + "% placed right" : ""}</small></div>`; }).join("")}</div>`;
      },
      match(v, s, rows, rev) {
        if (!rev) { v.innerHTML = waiting(`${rows.length} answered. Reveal to see the pairs.`); return; }
        $l("sub").textContent = rows.length ? `${pct(rows.filter(r => +r.score === 1).length / rows.length)}% matched them all` : "";
        v.innerHTML = `<div class="lv-list">${s.pairs.map((p, i) => { const ok = rows.filter(r => r.answer?.rights?.[i] === p.r).length; return `<div><b>${LETTERS[i] || i + 1}</b><span>${esc(p.l)} → ${esc(p.r)}</span><small>${rows.length ? pct(ok / rows.length) + "% right" : ""}</small></div>`; }).join("")}</div>`;
      },
      spot(v, s, rows, rev) {
        const dots = rev ? rows.map(r => `<span class="dot${+r.score === 1 ? " hit" : ""}" style="left:${(+r.answer?.x || 0) * 100}%;top:${(+r.answer?.y || 0) * 100}%"></span>`).join("") : "";
        const ring = rev && s.region ? `<span class="tgt" style="left:${s.region.x * 100}%;top:${s.region.y * 100}%;width:${s.region.r * 2 / s.aspect * 100}%;aspect-ratio:1"></span>` : "";
        v.innerHTML = `<div class="lv-spot"><div class="wrapimg" style="--ar:${s.aspect || 1.5}"><img src="${esc(s.image)}" alt="">${dots}${ring}</div></div>`;
        $l("sub").textContent = rev && rows.length ? `${pct(rows.filter(r => +r.score === 1).length / rows.length)}% found it` : `${rows.length} tapped`;
      },
      text(v, s, rows, rev) {
        const showAll = kind === "exit" || rev;
        const card = r => `<div class="tc ${r.grp}">${esc(r.answer?.text)}<small>${esc(r.name || "")}${r.grp !== "all" ? " · Group " + r.grp : ""}</small></div>`;
        let html = kind === "case" && s.text && !rev ? `<div class="lv-case">${esc(s.text)}</div>` : "";
        if (!showAll) html += waiting(`${rows.length} answer${rows.length === 1 ? "" : "s"} in. Show results to read them.`);
        else if (kind === "case") {
          const groups = ["A", "B", "all"].filter(g => rows.some(r => r.grp === g));
          const firsts = groups.filter(g => g !== "all").map(g => ({ g, r: rows.filter(r => r.grp === g).sort((a, b) => a.ms - b.ms)[0] })).filter(x => x.r).sort((a, b) => a.r.ms - b.r.ms);
          if (firsts.length) $l("sub").textContent = `Group ${firsts[0].g} answered first (${fmtMs(firsts[0].r.ms)})`;
          html += rows.length ? `<div class="lv-cols" style="grid-template-columns:repeat(${groups.length},minmax(0,1fr))">${groups.map(g => `<div><h3>${g === "all" ? "No group" : "Group " + g}</h3>${rows.filter(r => r.grp === g).map(card).join("")}</div>`).join("")}</div>` : waiting("No answers yet.");
        } else html += rows.length ? `<div class="lv-cards">${rows.slice().reverse().map(card).join("")}</div>` : waiting("Answers appear here as people send them.");
        v.innerHTML = html;
      }
    };
    VIZ.battle = VIZ.quiz; VIZ.test = VIZ.quiz; VIZ.exit = VIZ.text; VIZ.case = VIZ.text;
    function totals() {
      const m = new Map();
      L.all.forEach(r => { const e = m.get(r.participant) || { name: r.name, photo: r.photo, grp: r.grp, points: 0 }; e.points += r.points || 0; m.set(r.participant, e); });
      return [...m.values()].sort((a, b) => b.points - a.points);
    }
    const face = p => `<span class="ph">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name))}</span>`;
    function showBoard(final) {
      const t = totals(), top = t.slice(0, 3), rest = t.slice(3, 11);
      let head = `<h2>${final ? "Final leaderboard" : "Leaderboard"}</h2>`;
      if (K.teams) {
        const g = { A: 0, B: 0 }; L.all.forEach(r => { if (g[r.grp] != null) g[r.grp] += r.points || 0; });
        head = `<div class="teamwin">${final ? (g.A === g.B ? "It's a draw!" : (g.A > g.B ? "Group A" : "Group B") + " wins!") : ""}</div><p class="st-mono">Group A ${g.A} · ${g.B} Group B</p><h2 style="font-size:28px">Top players</h2>`;
      }
      const pod = [top[1], top[0], top[2]].map((p, i) => p ? `<div class="pod p${[2, 1, 3][i]}"><span class="rk">${[2, 1, 3][i]}</span>${face(p)}<b>${esc(firstName(p.name))}</b><span>${p.points} pts</span></div>` : "").join("");
      overlay(`<div class="board">${head}${t.length ? `<div class="podium">${pod}</div>${rest.length ? `<div class="rest">${rest.map((p, i) => `<div><b>${i + 4}</b><span>${esc(p.name)}</span><b>${p.points}</b></div>`).join("")}</div>` : ""}` : `<p class="st-mono">No answers yet.</p>`}</div>`);
      if (final) L.after = () => o.onDone && o.onDone();
    }
    function showWinner(w) { overlay(`<div class="winner"><div class="st-hello">Caught it first</div>${face(w)}<h2>${esc(w.name || "")}</h2><p>${esc(w.organisation || "")}${w.organisation ? " · " : ""}${(w.ms / 1000).toFixed(1)} seconds</p></div>`); }
    function overlay(html) { L.overlay = true; $l("over").innerHTML = html; $l("over").hidden = false; $l("main").textContent = mainLabel(); }
    function closeOverlay() { L.overlay = false; $l("over").hidden = true; $l("over").innerHTML = ""; $l("main").textContent = mainLabel(); }
    $l("over").addEventListener("click", main);
    $l("main").addEventListener("click", main);
    $l("prev").addEventListener("click", () => goStep(L.step - 1));
    $l("nextq").addEventListener("click", () => goStep(L.step + 1));
    $l("board")?.addEventListener("click", () => (L.overlay ? closeOverlay() : showBoard(false)));
    goStep(0);
    return {
      main, onAnswered,
      async destroy() {
        L.dead = true; clearInterval(poll); clearInterval(timer);
        await o.sb.rpc("set_live", { p_session: o.session.id, p_activity: null, p_run: "", p_step: 0, p_phase: "idle", p_seconds: 0 });
        o.channel?.send({ type: "broadcast", event: "live", payload: { phase: "idle" } });
      }
    };
  }
  return { KINDS, LETTERS, COLORS, blankStep, clean, builder, live, shrinkImage, PROMPTY };
})();
