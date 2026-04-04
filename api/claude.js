export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const type = body.type;

  // ── ANTHROPIC ──────────────────────────────────────────────────────────
  if (type === "claude" || !type) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "API key not configured" });
    try {
      const { type: _t, ...rest } = body;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(rest),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: "Claude request failed: " + e.message });
    }
  }

  // ── SUPABASE HELPER ────────────────────────────────────────────────────
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: "Supabase not configured" });

  const authHeader = req.headers["authorization"] || "";
  const userToken = authHeader.replace("Bearer ", "").trim();

  async function supa(path, method, payload, useUserToken) {
    const headers = {
      "Content-Type": "application/json",
      "apikey": SUPA_KEY,
      "Authorization": useUserToken && userToken ? "Bearer " + userToken : "Bearer " + SUPA_KEY,
      "Prefer": method === "POST" ? "return=representation" : "",
    };
    const opts = { method, headers };
    if (payload && (method === "POST" || method === "PATCH")) opts.body = JSON.stringify(payload);
    const r = await fetch(SUPA_URL + path, opts);
    const text = await r.text();
    try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
    catch { return { ok: r.ok, status: r.status, data: text }; }
  }

  async function supaAuth(path, payload) {
    const url = SUPA_URL + "/auth/v1" + path;
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPA_KEY,
          "Authorization": "Bearer " + SUPA_KEY,
        },
        body: JSON.stringify(payload),
      });
    } catch(fetchErr) {
      return { ok: false, status: 0, data: { msg: "fetch failed: " + fetchErr.message + " | URL: " + url } };
    }
    const text = await r.text();
    try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
    catch { return { ok: r.ok, status: r.status, data: { msg: text } }; }
  }

  // ── REGISTER ───────────────────────────────────────────────────────────
  if (type === "register") {
    const { email, password, name, rolle } = body;
    try {
      const auth = await supaAuth("/signup", { email, password });
      if (!auth.ok) return res.status(400).json({ error: auth.data.msg || auth.data.error_description || auth.data.message || JSON.stringify(auth.data) });
      const userId = auth.data.user?.id;
      if (!userId) return res.status(400).json({ error: "Kein User erstellt" });
      // Kurz warten damit Auth-User propagiert
      await new Promise(r => setTimeout(r, 500));
      const prof = await supa("/rest/v1/profile", "POST", { id: userId, name, rolle }, false);
      if (!prof.ok) return res.status(400).json({ error: "Profil konnte nicht erstellt werden: " + JSON.stringify(prof.data) });
      return res.status(200).json({ user: auth.data.user, session: auth.data.session });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── LOGIN ──────────────────────────────────────────────────────────────
  if (type === "login") {
    const { email, password } = body;
    try {
      const auth = await supaAuth("/token?grant_type=password", { email, password });
      if (!auth.ok) return res.status(400).json({ error: auth.data.error_description || auth.data.msg || "Login fehlgeschlagen" });
      return res.status(200).json({ user: auth.data.user, session: { access_token: auth.data.access_token } });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET PROFILE ────────────────────────────────────────────────────────
  if (type === "get_profile") {
    const { user_id } = body;
    const r = await supa("/rest/v1/profile?id=eq." + user_id + "&select=*", "GET", null, true);
    if (!r.ok) return res.status(400).json({ error: JSON.stringify(r.data) });
    return res.status(200).json(Array.isArray(r.data) ? r.data[0] : r.data);
  }

  // ── SAVE ERGEBNIS ──────────────────────────────────────────────────────
  if (type === "save_ergebnis") {
    const { nutzer_id, disziplin, ergebnis, typ, altersklasse, datum, notizen } = body;
    const r = await supa("/rest/v1/ergebnisse", "POST", { nutzer_id, disziplin, ergebnis, typ, altersklasse, datum, notizen }, true);
    if (!r.ok) return res.status(400).json({ error: JSON.stringify(r.data) });
    return res.status(200).json(r.data);
  }

  // ── GET ERGEBNISSE ─────────────────────────────────────────────────────
  if (type === "get_ergebnisse") {
    const { nutzer_id } = body;
    const r = await supa("/rest/v1/ergebnisse?nutzer_id=eq." + nutzer_id + "&order=datum.desc&select=*", "GET", null, true);
    if (!r.ok) return res.status(400).json({ error: JSON.stringify(r.data) });
    return res.status(200).json(r.data);
  }

  // ── SAVE BEWERTUNG ─────────────────────────────────────────────────────
  if (type === "save_bewertung") {
    const { nutzer_id, datum, disziplin, belastung, energie, gefuehl, notiz } = body;
    const r = await supa("/rest/v1/bewertungen", "POST", { nutzer_id, datum, disziplin, belastung, energie, gefuehl, notiz }, true);
    if (!r.ok) return res.status(400).json({ error: JSON.stringify(r.data) });
    return res.status(200).json(r.data);
  }

  // ── GET BEWERTUNGEN ────────────────────────────────────────────────────
  if (type === "get_bewertungen") {
    const { nutzer_id } = body;
    const r = await supa("/rest/v1/bewertungen?nutzer_id=eq." + nutzer_id + "&order=datum.desc&select=*", "GET", null, true);
    if (!r.ok) return res.status(400).json({ error: JSON.stringify(r.data) });
    return res.status(200).json(r.data);
  }

  // ── SAVE ANLAUF ────────────────────────────────────────────────────────
  if (type === "save_anlauf") {
    const { nutzer_id, disziplin, typ: anlaufTyp, schritte, notiz } = body;
    const r = await supa("/rest/v1/anlaeufe", "POST", { nutzer_id, disziplin, typ: anlaufTyp, schritte, notiz }, true);
    if (!r.ok) return res.status(400).json({ error: JSON.stringify(r.data) });
    return res.status(200).json(r.data);
  }

  // ── GET ANLAEUFE ───────────────────────────────────────────────────────
  if (type === "get_anlaeufe") {
    const { nutzer_id } = body;
    const r = await supa("/rest/v1/anlaeufe?nutzer_id=eq." + nutzer_id + "&order=created_at.desc&select=*", "GET", null, true);
    if (!r.ok) return res.status(400).json({ error: JSON.stringify(r.data) });
    return res.status(200).json(r.data);
  }

  // ── DELETE ACCOUNT ────────────────────────────────────────────────────
  if (type === "delete_account") {
    const { user_id } = body;
    if (!user_id) return res.status(400).json({ error: "Keine User-ID" });
    try {
      // Nutzer-Daten werden durch CASCADE automatisch gelöscht (profile → ergebnisse etc.)
      // Nur den Auth-User müssen wir manuell löschen (braucht Admin-Key)
      const r = await fetch(SUPA_URL + "/auth/v1/admin/users/" + user_id, {
        method: "DELETE",
        headers: {
          "apikey": SUPA_KEY,
          "Authorization": "Bearer " + SUPA_KEY,
        },
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(400).json({ error: "Löschen fehlgeschlagen: " + text });
      }
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "Unknown type: " + type });
}
