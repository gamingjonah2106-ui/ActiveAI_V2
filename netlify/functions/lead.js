// netlify/functions/lead.js
// Speichert Leads in Google Sheets – OHNE externe npm-Pakete

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const { name, phone, email, topic, note, date } = JSON.parse(event.body);

    // ── 1. Service Account JSON aus Env laden ──────────────────
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    const sheetId = process.env.GOOGLE_SHEET_ID;

    // ── 2. JWT für Google API erstellen ───────────────────────
    const token = await getGoogleToken(creds);

    // ── 3. Datum formatieren ──────────────────────────────────
    const d = new Date(date);
    const formatted = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    // ── 4. Zeile in Google Sheets schreiben ───────────────────
    const range = encodeURIComponent('Leads!A:F');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[formatted, name, phone, email || '–', topic || '–', note || '–']]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Sheets API Fehler: ${err}`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Lead-Fehler:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Google JWT ohne externe Library ───────────────────────────────
async function getGoogleToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  // RSA-SHA256 Signatur via Node crypto
  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(creds.private_key, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  // JWT gegen Access Token tauschen
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Kein Access Token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}
