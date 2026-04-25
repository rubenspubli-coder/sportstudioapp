const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const API_KEY = (process.env.OPENAI_API_KEY || '').trim();

console.log('OPENAI API_KEY length:', API_KEY.length);
console.log('OPENAI API_KEY starts with:', API_KEY.substring(0, 10));

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

        // Converte formato Anthropic → OpenAI
        const openaiMessages = [];
        if (systemPrompt) {
          openaiMessages.push({ role: 'system', content: systemPrompt });
        }
        messages.forEach(m => {
          if (typeof m.content === 'string') {
            openaiMessages.push({ role: m.role, content: m.content });
          } else {
            // Mensagem com imagens
            const parts = m.content.map(c => {
              if (c.type === 'text') return { type: 'text', text: c.text };
              if (c.type === 'image') return {
                type: 'image_url',
                image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` }
              };
              return null;
            }).filter(Boolean);
            openaiMessages.push({ role: m.role, content: parts });
          }
        });

        const openaiBody = JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 2500,
          stream: stream,
          messages: openaiMessages
        });

        const options = {
          hostname: 'api.openai.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          }
        };

        const apiReq = https.request(options, apiRes => {
          console.log('OpenAI response status:', apiRes.statusCode);

          if (stream) {
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
                if (data === '[DONE]') continue;
                try {
                  const evt = JSON.parse(data);
                  const text = evt.choices?.[0]?.delta?.content || '';
                  if (text) {
                    const out = JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
                    res.write(`data: ${out}\n\n`);
                  }
                } catch(e) {}
              }
            });
            apiRes.on('end', () => { res.write('data: [DONE]\n\n'); res.end(); });
          } else {
            let responseBody = '';
            apiRes.on('data', chunk => responseBody += chunk);
            apiRes.on('end', () => {
              console.log('OpenAI response:', responseBody.substring(0, 300));
              try {
                const openaiData = JSON.parse(responseBody);
                const text = openaiData.choices?.[0]?.message?.content || '';
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
              } catch(e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Parse error' }));
              }
            });
          }
        });

        apiReq.on('error', err => {
          console.error('OpenAI API Error:', err.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        });

        apiReq.write(openaiBody);
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
