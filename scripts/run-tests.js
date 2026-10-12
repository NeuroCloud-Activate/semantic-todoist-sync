const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync('scripts').filter(f => f.endsWith('-test.js'));
let failed = 0;

files.forEach(file => {
  const filePath = path.join('scripts', file);
  const result = spawnSync(process.execPath, [filePath], { stdio: 'inherit' });
  if (result.status === 0) {
    console.log('PASS ' + file);
  } else {
    console.log('FAIL ' + file + ' (exit ' + result.status + ')');
    failed++;
  }
});

console.log('Summary: ' + (files.length - failed) + '/' + files.length + ' passed');
if (failed > 0) {
  process.exit(1);
}
