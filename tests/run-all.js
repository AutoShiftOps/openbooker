// Runs every *.test.js file in this folder against a local static server,
// in order, and prints a pass/fail summary. Exits non-zero if anything failed.
//
// Uses async spawn(), not spawnSync(): the static server lives in this same
// process, and spawnSync blocks the entire Node event loop until the child
// exits -- including the HTTP server the child is trying to fetch from. That
// combination deadlocks (child waits on a page load that the parent can never
// serve while it's blocked waiting on the child). spawn() + awaiting the
// 'exit' event keeps the event loop free so the server can actually respond.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { startServer } = require('./lib/staticServer');

const PORT = 8888;
const BASE_URL = `http://localhost:${PORT}`;

function runTest(filePath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [filePath], {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL }
    });
    child.on('exit', code => resolve(code === 0));
  });
}

(async () => {
  const server = await startServer(PORT);
  console.log(`Static server up at ${BASE_URL}\n`);

  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort();

  const results = [];
  for (const file of files) {
    console.log(`--- ${file} ---`);
    const ok = await runTest(path.join(__dirname, file));
    results.push({ file, ok });
    console.log('');
  }

  server.close();

  const failed = results.filter(r => !r.ok);
  console.log('==================== SUMMARY ====================');
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);

  process.exit(failed.length ? 1 : 0);
})();
