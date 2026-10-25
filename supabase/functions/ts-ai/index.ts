// Training Suite AI — a Supabase Edge Function that calls Claude with the Training Suite server key.
// Trainers call it from the app; the key (secret ANTHROPIC_API_KEY) never leaves the server.
// Tasks: case_review (feedback to each group's phone), exit_summary (themes), write_questions (draft questions).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (error: string) => reply({ error });

const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

async function claude(system: string, user: string, maxTokens = 3000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `AI service error ${r.status}`);
  const text = (j.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("The AI reply couldn't be read. Try again.");
  return { data: JSON.parse(text.slice(a, b + 1)), usage: j.usage || {} };
}

const SHAPES: Record<string, string> = {
  quiz: '{"q":"question","options":["A","B","C","D"],"correct":0}  (2 to 6 options; correct = index of the right option)',
  buzz: '{"q":"question","options":["A","B","C","D"],"correct":0}',
  battle: '{"q":"question","options":["A","B","C","D"],"correct":0}',
  test: '{"q":"question","options":["A","B","C","D"],"correct":0}  (a fair test of the learning objectives)',
  poll: '{"q":"question","options":["A","B","C"]}  (opinion poll, no right answer)',
  finger: '{"q":"question","options":["A","B","C"]}  (2 to 5 short options; people answer by raising that many fingers)',
  words: '{"q":"prompt for one or two words","max":1}',
  short: '{"q":"question with a one-word or short-phrase answer","accept":["answer","acceptable variant"]}',
  scale: '{"q":"self-rating question","min":1,"max":10,"low":"Not at all","high":"Completely"}',
  feedback: '{"q":"question asking how useful or clear something was"}',
  order: '{"q":"Put these in the right order","items":["first step","second step","third step","fourth step"]}  (items in the CORRECT order, 3 to 7)',
  match: '{"q":"Match each term to its meaning","pairs":[{"l":"term","r":"meaning"}]}  (3 to 6 pairs, every meaning different)',
  case: '{"q":"the task, e.g. What should the officer do, and why?","text":"a realistic case of 80 to 160 words"}',
  exit: '{"q":"exit ticket prompt"}',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!KEY) return fail("AI isn't set up yet: the ANTHROPIC_API_KEY secret is missing in Supabase.");
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return fail("Sign in again to use AI.");
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await db.from("profiles").select("status, is_admin, expires_at, ai_limit").eq("id", user.id).single();
    if (!me || me.is_admin || me.status !== "active" || (me.expires_at && new Date(me.expires_at) < new Date())) return fail("Your account isn't active.");
    if (me.ai_limit === 0) return fail("AI isn't included in your plan. Ask the Training Suite team to switch it on.");
    if (me.ai_limit > 0) {
      const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
      const { count } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("owner_id", user.id).gte("created_at", start.toISOString());
      if ((count || 0) >= me.ai_limit) return fail(`You've used all ${me.ai_limit} AI requests in your plan this month.`);
    }
    const body = await req.json();
    const task = String(body.task || "");
    const log = (usage: { input_tokens?: number; output_tokens?: number }) =>
      db.from("ai_usage").insert({ owner_id: user.id, task, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 });

    if (task === "write_questions") {
      const kind = String(body.kind || "quiz"), count = Math.max(1, Math.min(10, Number(body.count) || 3));
      if (!SHAPES[kind]) return fail("AI can't write this kind of activity.");
      const system = "You write training activities for adult professionals, mostly Nigerian public servants and civil servants in Lagos State. Use plain, clear English and realistic workplace situations. Return only JSON.";
      const user_ = `Write ${count} ${kind === "case" || kind === "exit" || kind === "words" ? "prompts" : "questions"} for a "${kind}" activity.
Session topic: ${String(body.topic || "").slice(0, 300)}
Learning objectives: ${String(body.objectives || "").slice(0, 1500)}
Extra notes from the trainer: ${String(body.notes || "").slice(0, 800)}
Each item must have this shape: ${SHAPES[kind]}
Wrong options must be plausible. Vary the position of the correct answer.
Return ONLY: {"steps":[ ...items... ]}`;
      const { data, usage } = await claude(system, user_, 3500);
      await log(usage);
      return reply({ steps: Array.isArray(data.steps) ? data.steps.slice(0, count) : [] });
    }

    if (task === "case_review" || task === "exit_summary") {
      const { data: act } = await db.from("activities").select("id, session_id, kind, title, data").eq("id", body.activity_id).single();
      if (!act) return fail("Activity not found.");
      const { data: sess } = await db.from("sessions").select("id, owner_id, topic, objectives").eq("id", act.session_id).single();
      if (!sess || sess.owner_id !== user.id) return fail("This isn't your session.");
      const run = String(body.run || ""), step = Number(body.step) || 0, st = (act.data?.steps || [])[step] || {};
      const { data: rows } = await db.from("responses").select("id, grp, answer, participant_id, participants(full_name)").eq("activity_id", act.id).eq("run", run).eq("step", step).limit(200);
      const answers = (rows || []).filter((r) => String(r.answer?.text || "").trim());
      if (!answers.length) return fail("There are no written answers to review yet.");
      const list = answers.map((r) => `[${r.id}] ${r.grp !== "all" ? "Group " + r.grp + " · " : ""}${String(r.answer.text).slice(0, 1200).replace(/\s+/g, " ")}`).join("\n");
      const isCase = task === "case_review";
      const system = "You are an experienced, warm and fair facilitator of professional training for Nigerian public servants. You judge answers against good practice and the session's objectives. Be specific and encouraging; never harsh. Return only JSON.";
      const user_ = `Session: ${sess.topic}
Objectives: ${String(sess.objectives || "").slice(0, 1200)}
${isCase ? `Case: ${String(st.text || "").slice(0, 2500)}\nTask: ${st.q || ""}` : `Exit ticket prompt: ${st.q || ""}`}
Answers (id in brackets):
${list}

Return ONLY JSON:
{"summary":"2 or 3 sentences for the projector on what the room said${isCase ? " and what a strong answer includes" : ""}",
 "themes":[{"theme":"short theme","count":number}],
 "best":["up to 3 ids of the strongest answers"]${isCase ? `,
 "model":"a model answer in 3 to 5 sentences",
 "feedback":{"<id>":"one or two specific, encouraging sentences for that person or group: what was good and one thing to add (max 45 words)"}` : ""}}`;
      const { data, usage } = await claude(system, user_, isCase ? 4000 : 1500);
      await log(usage);
      const ids = new Set(answers.map((r) => r.id));
      let sent = 0;
      if (isCase && data.feedback && typeof data.feedback === "object") {
        for (const [id, text] of Object.entries(data.feedback)) {
          if (!ids.has(id) || !text) continue;
          const { error } = await db.from("responses").update({ feedback: String(text).slice(0, 2000) }).eq("id", id);
          if (!error) sent++;
        }
      }
      const names: Record<string, string> = Object.fromEntries(answers.map((r) => [r.id, (r as { participants?: { full_name?: string } }).participants?.full_name || ""]));
      const result = { summary: data.summary || "", themes: data.themes || [], best: (data.best || []).filter((x: string) => ids.has(x)).map((id: string) => ({ id, name: names[id], text: answers.find((a) => a.id === id)?.answer?.text })), model: data.model || "", sent };
      await db.from("ai_reviews").upsert({ activity_id: act.id, run, step, session_id: act.session_id, result, created_at: new Date().toISOString() });
      return reply(result);
    }
    if (task === "eval_summary") {
      const { data: sess } = await db.from("sessions").select("id, owner_id, topic").eq("id", body.session_id).single();
      if (!sess || sess.owner_id !== user.id) return fail("This isn't your session.");
      const { data: evs } = await db.from("evaluations").select("answers").eq("session_id", sess.id).limit(500);
      const comments = (evs || []).flatMap((e) => Object.entries(e.answers || {}).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => `[${k}] ${String(v).slice(0, 600).replace(/\s+/g, " ")}`));
      if (!comments.length) return fail("There are no written comments to summarise yet.");
      const system = "You summarise training evaluation comments for a facilitator. Be fair, specific and concise. Return only JSON.";
      const user_ = `Session: ${sess.topic}\nComments (question id in brackets; "best" = most useful thing learned, "improve" = what could be improved):\n${comments.slice(0, 400).join("\n")}\n\nReturn ONLY: {"summary":"2 or 3 sentences","strengths":["up to 4 short points"],"improve":["up to 4 short, practical points"]}`;
      const { data, usage } = await claude(system, user_, 1200);
      await log(usage);
      return reply({ summary: data.summary || "", strengths: data.strengths || [], improve: data.improve || [] });
    }
    return fail("Unknown AI task.");
  } catch (e) {
    return fail((e as Error).message || "The AI request failed. Try again.");
  }
});
