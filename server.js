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
        const stream = parsed.stream || false;

        // Converte formato Anthropic → Gemini
        const geminiContents = messages.map(m => {
          if (typeof m.content === 'string') {
            return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
          }
          // Mensagem com imagens
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

        const endpoint = stream
          ? `/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${API_KEY}`
          : `/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

        const options = {
          hostname: 'generativelanguage.googleapis.com',
          path: endpoint,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        };

        const apiReq = https.request(options, apiRes => {
          console.log('Gemini response status:', apiRes.statusCode);

          if (stream) {
            // Converte SSE do Gemini → SSE formato Anthropic
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Access-Control-Allow-Origin': '*'
            });
            let buffer = '';
            apiRes.on('data', chunk => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (!data || data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  if (text) {
                    const evt = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
                    res.write(`data: ${evt}\n\n`);
                  }
                } catch(e) {}
              }
            });
            apiRes.on('end', () => {
              res.write('data: [DONE]\n\n');
              res.end();
            });
          } else {
            let responseBody = '';
            apiRes.on('data', chunk => responseBody += chunk);
            apiRes.on('end', () => {
              console.log('Gemini response body:', responseBody);
              try {
                const geminiData = JSON.parse(responseBody);
                const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                // Converte para formato Anthropic
                const anthropicFormat = JSON.stringify({ content: [{ type: 'text', text }] });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(anthropicFormat);
              } catch(e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Parse error' }));
              }
            });
          }
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
