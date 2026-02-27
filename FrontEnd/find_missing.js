const fs = require('fs');
const keysTxt = fs.readFileSync('admin_keys.txt', 'utf8');
const translationsTs = fs.readFileSync('src/i18n/translations.ts', 'utf8');

const keysPattern = /t\(\"([^\"]+)\"\)/g;
let match;
const keysList = new Set();

while ((match = keysPattern.exec(keysTxt)) !== null) {
  keysList.add(match[1]);
}

const missing = [];
for (const key of keysList) {
  if (!translationsTs.includes('"' + key + '"')) {
    missing.push(key);
  }
}
console.log("Missing Admin Keys:\\n", missing.join('\\n'));
