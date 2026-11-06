// Returns only phone numbers + emails for a company / person (+ project).

async function serper(path, body) {
  const r = await fetch('https://google.serper.dev/' + path, {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gl: 'in', hl: 'en', ...body }),
  });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}
const SB = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY });
async function sb(path, opts = {}) {
  const { url, key } = SB();
  if (!url || !key) return null;
  const r = await fetch(url + '/rest/v1/' + path, {
    ...opts,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const PH = /(?:\+?91[\s-]?)?(?:0?\d{2,4}[\s-]?\d{6,8}|[6-9]\d{4}[\s-]?\d{5})\b/g;
const EM = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const JUNK = /\.(png|jpg|jpeg|gif|svg|webp)$|^(example|sentry|wixpress)/i;
const digits = (x) => x.replace(/\D/g, '').slice(-10);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY not set' });
  const need = process.env.ACCESS_CODE;
  if (need && req.headers['x-access-code'] !== need) return res.status(401).json({ error: 'Access code required' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  const extra = String(b.extra || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Enter a name' });
  const q = extra ? `${name} ${extra}` : name;
  const qn = q.toLowerCase().replace(/\s+/g, ' ');
  const refresh = !!b.refresh;
  const warn = [];

  // 1) Vault + previously saved web results
  let vault = [], saved = [];
  try {
    vault = (await sb('rpc/vault_contact_lookup', { method: 'POST', body: JSON.stringify({ q }) })) || [];
    saved = (await sb('web_contacts?query_norm=eq.' + encodeURIComponent(qn) + '&select=kind,value,label,source,link,found_at&order=found_at.desc')) || [];
  } catch (e) { warn.push(e.message); }

  if (saved.length && !refresh) {
    return res.status(200).json({
      query: q, vault, from: 'saved',
      phones: saved.filter((x) => x.kind === 'phone'), emails: saved.filter((x) => x.kind === 'email'),
      savedAt: saved[0].found_at, credits: 0, warn,
    });
  }

  const r1 = await Promise.allSettled([
    serper('places', { q }),
    serper('search', { q: `${q} contact number email` }),
    serper('search', { q: `"${q}" phone OR mobile OR "email id" OR "contact us"` }),
  ]);
  const [plc, s1, s2] = r1.map((j) => (j.status === 'fulfilled' ? j.value : null));
  if (!plc && !s1 && !s2) return res.status(502).json({ error: 'Serper failed: ' + r1[0].reason.message });

  const kg = s1 && s1.knowledgeGraph;
  const site = (kg && kg.website) || (plc && plc.places && plc.places.find((p) => p.website) || {}).website || '';
  const dom = host(site);
  let s3 = null;
  if (dom && !/(facebook|linkedin|instagram|google)\./.test(dom)) {
    try { s3 = await serper('search', { q: `"@${dom}"` }); } catch {}
  }

  const phones = [], emails = [], seenP = new Set(), seenE = new Set();
  const addP = (n, label, source, link) => {
    const k = digits(n);
    if (k.length < 8 || seenP.has(k)) return;
    seenP.add(k); phones.push({ value: n.trim(), label, source, link });
  };
  const addE = (e, source, link) => {
    e = e.toLowerCase().replace(/[.,;]+$/, '');
    if (JUNK.test(e) || seenE.has(e)) return;
    seenE.add(e); emails.push({ value: e, source, link });
  };

  ((plc && plc.places) || []).forEach((p) => {
    if (p.phoneNumber) addP(p.phoneNumber, p.title + (p.address ? ' · ' + p.address : ''), 'Google Maps', p.website || '');
  });
  if (kg && kg.attributes) {
    Object.entries(kg.attributes).forEach(([k, v]) => {
      (String(v).match(PH) || []).forEach((n) => addP(n, k, 'Google panel', ''));
      (String(v).match(EM) || []).forEach((e) => addE(e, 'Google panel', ''));
    });
  }
  if (s1 && s1.answerBox) {
    const t = (s1.answerBox.snippet || '') + ' ' + (s1.answerBox.answer || '');
    (t.match(PH) || []).forEach((n) => addP(n, 'Answer box', host(s1.answerBox.link || ''), s1.answerBox.link || ''));
  }
  [s1, s2, s3].forEach((s) => ((s && s.organic) || []).forEach((r) => {
    const t = (r.title || '') + ' ' + (r.snippet || '');
    const src = host(r.link);
    (t.match(PH) || []).forEach((n) => addP(n, (r.title || '').slice(0, 70), src, r.link));
    (t.match(EM) || []).forEach((e) => addE(e, src, r.link));
  }));

  const outP = phones.slice(0, 15), outE = emails.slice(0, 15);

  // 3) Push to Supabase
  let pushed = 0;
  const rows = [
    ...outP.map((x) => ({ kind: 'phone', value: x.value, value_norm: digits(x.value), label: x.label, source: x.source, link: x.link })),
    ...outE.map((x) => ({ kind: 'email', value: x.value, value_norm: x.value, label: '', source: x.source, link: x.link })),
  ].map((x) => ({ ...x, query_norm: qn, query_raw: q, origin: 'serper', found_at: new Date().toISOString() }));
  if (rows.length) {
    try {
      await sb('web_contacts?on_conflict=query_norm,kind,value_norm', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
      });
      pushed = rows.length;
    } catch (e) { warn.push(e.message); }
  }

  res.status(200).json({
    query: q, vault, from: 'serper', site, phones: outP, emails: outE,
    credits: 3 + (s3 ? 1 : 0), pushed, warn,
  });
};
