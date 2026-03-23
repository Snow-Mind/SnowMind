import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function findFiles(dir, name) {
  let results = [];
  try {
    const files = readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const p = join(dir, f.name);
      if (f.isDirectory() && !f.name.includes('node_modules')) {
        results = results.concat(findFiles(p, name));
      } else if (f.name === name) {
        results.push(p);
      }
    }
  } catch(e) {}
  return results;
}

const files = findFiles('node_modules/@zerodev/sdk/_cjs', 'accountMetadata.js');
for (const f of files) {
  console.log('=== ' + f + ' ===');
  console.log(readFileSync(f, 'utf8'));
  console.log('---END---');
}
