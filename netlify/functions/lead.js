// netlify/functions/lead.js
// Google Sheets via REST API – keine externen Pakete

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
    console.error('Lead-Fehler:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function getGoogleToken(creds) {
  const crypto = require('crypto');

  const now = Math.floor(Date.now() / 1000);

  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const payloadB64 = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    sub: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const signingInput = `${headerB64}.${payloadB64}`;

  // Private Key normalisieren
  const privateKey = creds.private_key
    .replace(/\\n/g, '\n')
    .trim();

  const signer = crypto.createSign('sha256WithRSAEncryption');
  signer.update(signingInput);
  signer.end();

  const sigB64 = signer.sign(privateKey, 'base64');
  const sig = sigB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString()
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Kein Access Token: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}
