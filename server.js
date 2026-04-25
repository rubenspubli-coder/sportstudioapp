const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const API_KEY = (process.env.GEMINI_API_KEY || '').trim();

console.log('GEMINI API_KEY length:', API_KEY.length);
console.log('GEMINI API_KEY starts with:', API_KEY.substring(0, 15));

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200); res.end(); return;
  }

  if (req.method === 'POST' && req.url === '/api') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('POST /api received, body length:', body.length);

      try {
        const parsed = JSON.parse(body);
        const systemPrompt = parsed.system || '';
        const messages = parsed.messages || [];

        const geminiContents = messages.map(m => {
          if (typeof m.content === 'string') {
            return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
          }
          const parts = m.content.map(c => {
            if (c.type === 'text') return { text: c.text };
            if (c.type === 'image') return { inlineData: { mimeType: c.source.media_type, data: c.source.data } };
            return null;
          }).filter(Boolean);
          return { role: m.role === 'assistant' ? 'model' : 'user', parts };
        });

        const geminiBody = JSON.stringify({
          system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 2500 }
        });

        const MODEL = 'gemini-1.5-flash-002';
        const endpoint = `/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

        console.log('Calling Gemini endpoint:', endpoint.substring(0, 60));

        const options = {
          hostname: 'generativelanguage.googleapis.com',
          path: endpoint,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        };

        const apiReq = https.request(options, apiRes => {
          console.log('Gemini response status:', apiRes.statusCode);
          let responseBody = '';
          apiRes.on('data', chunk => responseBody += chunk);
          apiRes.on('end', () => {
            console.log('Gemini full response:', responseBody.substring(0, 300));
            try {
              const geminiData = JSON.parse(responseBody);
              const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
            } catch(e) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'Parse error' }));
            }
          });
        });

        apiReq.on('error', err => {
          console.error('Gemini API Error:', err.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });

        apiReq.write(geminiBody);
        apiReq.end();

      } catch(e) {
        console.error('Body parse error:', e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid body' }));
      }
    });
    return;
  }

  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
