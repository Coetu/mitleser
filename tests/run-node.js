// Startet alle Tests mit Node:  npm test   (oder: node tests/run-node.js)
// Optional nur bestimmte Dateien:  node tests/run-node.js matcher fixtures
import { files } from './all.js';
import { setFile, run } from './harness.js';

const filters = process.argv.slice(2);
const selected = filters.length ? files.filter((f) => filters.some((x) => f.includes(x))) : files;

for (const file of selected) {
  setFile(file);
  try {
    await import(`./${file}`);
  } catch (error) {
    console.error(`\n✗ ${file} konnte nicht geladen werden:\n  ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  }
}

let lastFile = '';
const summary = await run((r) => {
  if (r.file !== lastFile) {
    lastFile = r.file;
    console.log(`\n${r.file}`);
  }
  if (r.ok) {
    console.log(`  ✓ ${r.name} (${r.ms} ms)`);
  } else {
    console.log(`  ✗ ${r.name}\n      ${String(r.error && r.error.message ? r.error.message : r.error).replace(/\n/g, '\n      ')}`);
  }
});

console.log(`\n${summary.passed} bestanden, ${summary.failed} fehlgeschlagen`);
if (summary.failed > 0) process.exitCode = 1;
