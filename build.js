const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const wwwDir = path.join(rootDir, 'www');

console.log('[build.js] Starting web assets build...');

if (!fs.existsSync(wwwDir)) {
  fs.mkdirSync(wwwDir, { recursive: true });
}

const filesToCopy = [
  'index.html',
  'style.css',
  'audio.js',
  'engine.js',
  'network.js',
  'qr.js',
  'app.js',
  'icon.svg',
  'manifest.webmanifest',
  'sw.js'
];

let copied = 0;
for (const file of filesToCopy) {
  const src = path.join(rootDir, file);
  const dest = path.join(wwwDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const size = fs.statSync(dest).size;
    console.log(`  ✓ Copied ${file} (${size} bytes)`);
    copied++;
  } else {
    console.warn(`  ⚠ Warning: file not found: ${file}`);
  }
}

console.log(`[build.js] Successfully copied ${copied}/${filesToCopy.length} files to www/`);
