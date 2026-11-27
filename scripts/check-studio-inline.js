const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("studio.html", "utf8");
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
let checked = 0;

for (let index = 0; index < blocks.length; index += 1) {
  const [, attributes, source] = blocks[index];
  if (/\bsrc\s*=/.test(attributes) || !source.trim()) continue;
  new vm.Script(source, { filename: `studio.html:inline-${index + 1}` });
  checked += 1;
}

if (!checked) throw new Error("No inline Studio scripts were checked.");
console.log(`Studio inline JavaScript syntax OK (${checked} scripts).`);
