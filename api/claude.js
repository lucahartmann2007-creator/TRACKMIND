import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, ...body } = req.body;

  // ── ANTHROPIC (KI-Anfragen) ──────────────────────────────────────────────
  if (type === 'claude' || !type) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (error) {
      return res.status(500).json({ error: 'Claude request failed' });
    }
  }

  // ── SUPABASE (Datenbank-Anfragen) ────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecret) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Nutzer-Token aus dem Authorization-Header lesen
  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.replace('Bearer ', '');

  // Supabase-Client mit dem Secret Key (Server-seitig, voller Zugriff)
  // aber wir setzen den User-Token damit RLS greift
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    global: { headers: { Authorization: `Bearer ${userToken}` } }
  });

  // ── AUTH: Registrieren ───────────────────────────────────────────────────
  if (type === 'register') {
    const { email, password, name, rolle } = body;
    try {
      // 1. Nutzer in Auth erstellen
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email, password,
      });
      if (authError) return res.status(400).json({ error: authError.message });

      // 2. Profil in der profile-Tabelle anlegen
      const { error: profileError } = await supabase
        .from('profile')
        .insert({ id: authData.user.id, name, rolle });
      if (profileError) return res.status(400).json({ error: profileError.message });

      return res.status(200).json({ user: authData.user, session: authData.session });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── AUTH: Einloggen ──────────────────────────────────────────────────────
  if (type === 'login') {
    const { email, password } = body;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ user: data.user, session: data.session });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PROFIL laden ─────────────────────────────────────────────────────────
  if (type === 'get_profile') {
    const { user_id } = body;
    const { data, error } = await supabase
      .from('profile')
      .select('*')
      .eq('id', user_id)
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ── ERGEBNISSE: speichern ────────────────────────────────────────────────
  if (type === 'save_ergebnis') {
    const { nutzer_id, disziplin, ergebnis, typ, altersklasse, datum, notizen } = body;
    const { data, error } = await supabase
      .from('ergebnisse')
      .insert({ nutzer_id, disziplin, ergebnis, typ, altersklasse, datum, notizen })
      .select();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ── ERGEBNISSE: laden ────────────────────────────────────────────────────
  if (type === 'get_ergebnisse') {
    const { nutzer_id } = body;
    const { data, error } = await supabase
      .from('ergebnisse')
      .select('*')
      .eq('nutzer_id', nutzer_id)
      .order('datum', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ── BEWERTUNGEN: speichern ───────────────────────────────────────────────
  if (type === 'save_bewertung') {
    const { nutzer_id, datum, disziplin, belastung, energie, gefuehl, notiz } = body;
    const { data, error } = await supabase
      .from('bewertungen')
      .insert({ nutzer_id, datum, disziplin, belastung, energie, gefuehl, notiz })
      .select();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ── BEWERTUNGEN: laden ───────────────────────────────────────────────────
  if (type === 'get_bewertungen') {
    const { nutzer_id } = body;
    const { data, error } = await supabase
      .from('bewertungen')
      .select('*')
      .eq('nutzer_id', nutzer_id)
      .order('datum', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ── ANLÄUFE: speichern ───────────────────────────────────────────────────
  if (type === 'save_anlauf') {
    const { nutzer_id, disziplin, typ: anlaufTyp, schritte, notiz } = body;
    const { data, error } = await supabase
      .from('anlaeufe')
      .insert({ nutzer_id, disziplin, typ: anlaufTyp, schritte, notiz })
      .select();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  // ── ANLÄUFE: laden ───────────────────────────────────────────────────────
  if (type === 'get_anlaeufe') {
    const { nutzer_id } = body;
    const { data, error } = await supabase
      .from('anlaeufe')
      .select('*')
      .eq('nutzer_id', nutzer_id)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data);
  }

  return res.status(400).json({ error: 'Unknown request type' });
}
