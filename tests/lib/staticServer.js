// Minimal static file server for the app root (no external deps -- Node's
// http/fs only), so the test suite doesn't require Python or any other tool
// to be installed. Serves the project root (parent of tests/) exactly like
// Firebase Hosting does for local testing.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// The real firebase-config.js in this repo holds Asha's actual live Firebase
// project keys (needed for the real deployed app). If the test harness served
// that file as-is, initCloud() would connect to her REAL project during every
// automated test run -- real auth listeners firing asynchronously mid-test
// (racing with Playwright clicks -> intermittent "element detached from DOM"
// failures) and, worse, a real risk of test data reaching her live Firestore.
// Serve an inert placeholder here instead; the on-disk file is untouched and
// still deploys with the real keys.
const FAKE_FIREBASE_CONFIG = `self.OPENBOOKER_FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_AUTH_DOMAIN_HERE",
  projectId: "PASTE_PROJECT_ID_HERE",
  storageBucket: "PASTE_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_MESSAGING_SENDER_ID_HERE",
  appId: "PASTE_APP_ID_HERE"
};
`;

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      if (urlPath === '/firebase-config.js') {
        res.writeHead(200, { 'Content-Type': MIME['.js'] });
        res.end(FAKE_FIREBASE_CONFIG);
        return;
      }
      const filePath = path.join(ROOT, urlPath);
      // Prevent escaping the project root.
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}

module.exports = { startServer, ROOT };
