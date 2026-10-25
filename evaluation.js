// Training Suite session evaluation: the default form (Kirkpatrick levels 1 and 2, 17 items) and the scoring.
// Shared by the trainer's pages and participants' phones.
window.TSE = (() => {
  "use strict";
  const SCALES = {
    agree: ["Strongly disagree", "Disagree", "Not sure", "Agree", "Strongly agree"],
    rate: ["Poor", "Fair", "Good", "Very good", "Excellent"],
    stars: ["1", "2", "3", "4", "5"]
  };
  const TYPES = { agree: "Agree / disagree (1–5)", rate: "Poor to excellent (1–5)", stars: "Stars (1–5)", text: "Written answer" };
  // s: { topic, main_topic, key_skill, course_lead }
  function defaultForm(s) {
    const lead = String(s.course_lead || "").trim() || "The facilitator", topic = String(s.main_topic || s.topic || "this topic").trim(), skill = String(s.key_skill || "").trim();
    return [
      { id: "r1", sec: "reaction", type: "agree", text: "The session met its stated objectives." },
      { id: "r2", sec: "reaction", type: "agree", text: "The content was relevant to my job." },
      { id: "r3", sec: "reaction", type: "agree", text: `${lead} explained things clearly.` },
      { id: "r4", sec: "reaction", type: "agree", text: `${lead} encouraged participation and questions.` },
      { id: "r5", sec: "reaction", type: "agree", text: "The activities and exercises helped me learn." },
      { id: "r6", sec: "reaction", type: "agree", text: "The pace of the session was right for me." },
      { id: "r7", sec: "reaction", type: "agree", text: "The slides and materials were clear and useful." },
      { id: "r8", sec: "reaction", type: "agree", text: "The venue and facilities supported learning." },
      { id: "r9", sec: "reaction", type: "agree", text: "The time was well used." },
      { id: "r10", sec: "reaction", type: "agree", text: "I would recommend this session to a colleague." },
      { id: "before", sec: "learning", type: "rate", text: `Before this session, my knowledge of ${topic} was…` },
      { id: "after", sec: "learning", type: "rate", text: `After this session, my knowledge of ${topic} is…` },
      { id: "l1", sec: "learning", type: "agree", text: skill ? `I can now ${skill.replace(/^i can now\s+/i, "")}.` : "I can now do what this session set out to teach." },
      { id: "l2", sec: "learning", type: "agree", text: "I am confident I can apply what I learned at work." },
      { id: "overall", sec: "overall", type: "stars", text: "Overall, how would you rate this session?" },
      { id: "best", sec: "comments", type: "text", text: "What was the most useful thing you learned?" },
      { id: "improve", sec: "comments", type: "text", text: "What could be improved?" }
    ];
  }
  const formFor = (s, ev) => (ev && Array.isArray(ev.items) && ev.items.length ? ev.items : defaultForm(s));
  const SEC = { reaction: "How the session went", learning: "What you learned", overall: "Overall", comments: "In your own words", other: "More questions" };
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  // rows: [{ answers }] → summary numbers
  function score(items, rows) {
    const num = id => rows.map(r => +r.answers?.[id]).filter(v => v >= 1 && v <= 5);
    const per = items.filter(i => i.type !== "text").map(i => { const v = num(i.id); return { ...i, n: v.length, avg: avg(v), dist: [1, 2, 3, 4, 5].map(k => v.filter(x => x === k).length) }; });
    const pct = a => a == null ? null : Math.round((a - 1) / 4 * 100);
    const reaction = avg(per.filter(i => i.sec === "reaction" && i.avg != null).map(i => i.avg));
    const learnItems = per.filter(i => i.sec === "learning" && !["before", "after"].includes(i.id) && i.avg != null).map(i => i.avg);
    const b = per.find(i => i.id === "before"), a = per.find(i => i.id === "after");
    const overall = per.find(i => i.id === "overall");
    const texts = items.filter(i => i.type === "text").map(i => ({ ...i, answers: rows.map(r => ({ t: String(r.answers?.[i.id] || "").trim(), name: r.name })).filter(x => x.t) }));
    return { per, texts, reaction: pct(reaction), learning: pct(avg(learnItems)), before: b?.avg ?? null, after: a?.avg ?? null, overall: overall?.avg ?? null, count: rows.length };
  }
  return { SCALES, TYPES, SEC, defaultForm, formFor, score };
})();
