const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();

console.log('API_KEY length:', API_KEY.length);
console.log('API_KEY starts with:', API_KEY.substring(0, 15));

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
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01'
        }
      };
      const apiReq = https.request(options, apiRes => {
        console.log('API response status:', apiRes.statusCode);
        res.writeHead(apiRes.statusCode, {
          'Content-Type': apiRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        apiRes.pipe(res);
      });
      apiReq.on('error', err => {
        console.error('API Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      });
      apiReq.write(body);
      apiReq.end();
    });
    return;
  }

  // Serve HTML files
  const urlMap = {
    '/': 'index.html',
    '/home': 'index.html',
    '/sports': 'sports.html',
    '/sports.html': 'sports.html',
    '/illusion': 'illusion.html',
    '/illusion.html': 'illusion.html',
    '/mascot': 'mascot.html',
    '/mascot.html': 'mascot.html',
  };

  const fileName = urlMap[req.url] || 'home.html';
  const filePath = path.join(__dirname, fileName);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try home.html as fallback
      fs.readFile(path.join(__dirname, 'home.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 
