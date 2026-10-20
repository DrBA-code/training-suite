// Training Suite admin console: approve, reject, pause and renew accounts. Super Admin only.
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cfg = window.TS_CONFIG || {};
  const sb = window.supabase && cfg.SUPABASE_URL ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const LOGO = s => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true"><rect x="3" y="20" width="32" height="32" fill="#2747C8" transform="rotate(8 19 36)"/><rect x="13" y="24" width="32" height="32" fill="#F4B400" transform="rotate(-3 29 40)"/><g transform="rotate(-7 42 22)"><rect x="26" y="6" width="32" height="32" fill="#D2391F"/><text x="42" y="28.5" text-anchor="middle" font-family="Sora, sans-serif" font-weight="800" font-size="14" fill="#FFFFFF">TS</text></g></svg>`;
  document.querySelectorAll("[data-logo]").forEach(el => el.insertAdjacentHTML("afterbegin", LOGO(+el.dataset.logo)));
  const PLANS = [["Trial · 30 days", 30], ["Course Lead · yearly", 365], ["Programme Lead · yearly", 365], ["Complimentary", 0]];
  const ROLE = r => r === "programme_lead" ? "Programme Lead" : "Course Lead";
  const fmt = d => d ? new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
  let me = null, rows = [], toastT = null;
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3000); }

  async function boot() {
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return gate();
    const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (!data || !data.is_admin) { await sb.auth.signOut(); return gate("That account isn't the Super Admin."); }
    me = data; $("gate").hidden = true; $("shell").hidden = false; $("meName").textContent = me.full_name || me.email;
    await load(); route();
  }
  function gate(msg) { $("shell").hidden = true; $("gate").hidden = false; $("gErr").textContent = msg || ""; }
  $("gForm").addEventListener("submit", async e => {
    e.preventDefault(); $("gErr").textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword({ email: $("gEmail").value.trim(), password: $("gPass").value });
    if (error) return ($("gErr").textContent = "That email and password don't match.");
    boot();
  });
  $("signOut").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

  async function load() {
    const { data, error } = await sb.from("profiles").select("*").eq("is_admin", false).order("created_at", { ascending: false });
    if (error) toast(error.message);
    rows = data || [];
    const n = rows.filter(r => r.status === "pending").length;
    $("nPending").hidden = !n; $("nPending").textContent = n;
  }
  addEventListener("hashchange", route);
  let filter = "active";
  function route() {
    if (!me) return;
    const r = location.hash.replace("#", "") || "requests";
    document.querySelectorAll("[data-nav]").forEach(a => a.setAttribute("aria-current", a.dataset.nav === r ? "page" : "false"));
    r === "accounts" ? viewAccounts() : viewRequests();
  }
  const planOptions = cur => PLANS.map(([p]) => `<option ${p === cur ? "selected" : ""}>${esc(p)}</option>`).join("");
  const plusDays = n => n ? new Date(Date.now() + n * 864e5).toISOString().slice(0, 10) : "";

  function viewRequests() {
    const list = rows.filter(r => r.status === "pending");
    $("view").innerHTML = `<div class="pagehead"><div><span class="lbl">Super Admin</span><h1>Account requests</h1><span class="muted">Approve to give a plan and an end date. Leave the end date empty for no end.</span></div></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Where they train</th><th>Requested</th><th>Plan</th><th>Ends</th><th>Decision</th></tr></thead><tbody>
      ${list.map(r => `<tr data-id="${r.id}"><td><b style="display:block">${esc(r.full_name || "(no name)")}</b><span class="small muted">${esc(r.email)}${r.phone ? " · " + esc(r.phone) : ""}</span></td><td>${ROLE(r.role)}</td><td>${esc(r.where_train || "–")}</td><td class="small muted">${fmt(r.created_at)}</td>
        <td><select data-plan aria-label="Plan for ${esc(r.full_name)}">${planOptions("Trial · 30 days")}</select></td><td><input type="date" data-ends value="${plusDays(30)}" aria-label="End date"></td>
        <td><div class="row"><button class="btn blue small" type="button" data-act="active">Approve</button><button class="btn danger small" type="button" data-act="rejected">Reject</button></div></td></tr>`).join("") || `<tr><td colspan="7" class="muted">No requests waiting.</td></tr>`}
      </tbody></table></div>`;
    wire();
  }
  function viewAccounts() {
    const F = [["active", "Active"], ["suspended", "Paused"], ["rejected", "Rejected"], ["all", "All"]];
    const list = rows.filter(r => r.status !== "pending" && (filter === "all" || r.status === filter));
    $("view").innerHTML = `<div class="pagehead"><div><span class="lbl">Super Admin</span><h1>Accounts</h1></div></div>
      <div class="tabbar" role="tablist">${F.map(([k, n]) => `<button type="button" role="tab" aria-selected="${filter === k}" data-f="${k}">${n}</button>`).join("")}</div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Plan</th><th>Ends</th><th>Change</th></tr></thead><tbody>
      ${list.map(r => { const expired = r.expires_at && new Date(r.expires_at) < new Date(); return `<tr data-id="${r.id}"><td><b style="display:block">${esc(r.full_name || "(no name)")}</b><span class="small muted">${esc(r.email)}</span></td><td>${ROLE(r.role)}</td>
        <td><span class="badge ${r.status === "active" ? (expired ? "soon" : "done") : "draft"}">${r.status === "active" ? (expired ? "Plan ended" : "Active") : r.status === "suspended" ? "Paused" : "Rejected"}</span></td>
        <td><select data-plan>${planOptions(r.plan)}</select></td><td><input type="date" data-ends value="${r.expires_at ? r.expires_at.slice(0, 10) : ""}"></td>
        <td><div class="row">${r.status === "active" ? `<button class="btn ghost small" type="button" data-act="active">Save plan</button><button class="btn danger small" type="button" data-act="suspended">Pause</button>` : `<button class="btn blue small" type="button" data-act="active">Activate</button>`}</div></td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">No accounts here.</td></tr>`}
      </tbody></table></div>`;
    document.querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.f; viewAccounts(); }));
    wire();
  }
  function wire() {
    document.querySelectorAll("tr[data-id] [data-plan]").forEach(s => s.addEventListener("change", () => {
      const days = (PLANS.find(p => p[0] === s.value) || [0, 0])[1];
      s.closest("tr").querySelector("[data-ends]").value = plusDays(days);
    }));
    document.querySelectorAll("tr[data-id] [data-act]").forEach(b => b.addEventListener("click", async () => {
      const tr = b.closest("tr"), ends = tr.querySelector("[data-ends]").value;
      b.disabled = true;
      const { error } = await sb.rpc("admin_decide", { p_user: tr.dataset.id, p_status: b.dataset.act, p_plan: tr.querySelector("[data-plan]").value,
        p_expires: ends ? new Date(ends + "T23:59:59").toISOString() : null, p_note: "" });
      b.disabled = false;
      if (error) return toast(error.message);
      toast({ active: "Saved: account active", rejected: "Request rejected", suspended: "Account paused" }[b.dataset.act]);
      await load(); route();
    }));
  }
  boot();
})();
