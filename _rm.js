const fs = require("fs");
let failed = false;
function edit(file, label, oldText, newText) {
  const raw = fs.readFileSync(file, "utf8");
  const lf = raw.replace(/\r\n/g, "\n");
  const n = lf.split(oldText).length - 1;
  if (n !== 1) { console.error(`REFUSED ${file} [${label}]: ${n} matches, expected 1`); failed = true; return; }
  fs.writeFileSync(file, lf.replace(oldText, newText).replace(/\n/g, "\r\n"));
  console.log(`ok ${file} [${label}]`);
}
module.exports = { edit, done: () => process.exit(failed ? 1 : 0) };
