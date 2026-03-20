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

    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    let pk = creds.private_key.replace(/\\n/g, '\n');
    creds.private_key = pk;
    const sheetId = process.env.GOOGLE_SHEET_ID;

    const token = await getGoogleToken(creds);

    const d = new Date(date);
    const formatted = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    const range = encodeURIComponent('Leads!A:F');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[formatted, name, phone, email || '-', topic || '-', note || '-']]
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

function toBase64url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

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

  const encode = obj => toBase64url(Buffer.from(JSON.stringify(obj)));
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  // base64 erst, dann manuell zu base64url konvertieren
  const sigBase64 = sign.sign(creds.private_key, 'base64');
  const signature = sigBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Kein Access Token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}
