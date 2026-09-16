const fs = require("fs");
const s = fs.readFileSync("tests/equipment-relations.spec.ts", "utf8");
let backticks = 0, braces = 0, parens = 0, brackets = 0;
let inTemplate = 0, line = 1, minBracesLine = null;
const stack = [];
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch === "\n") line++;
  if (ch === "`") { backticks++; continue; }
  if (ch === "{") { braces++; stack.push(["{", line]); }
  if (ch === "(") { parens++; stack.push(["(", line]); }
  if (ch === "[") { brackets++; stack.push(["[", line]); }
  if (ch === "}") { braces--; stack.pop(); }
  if (ch === ")") { parens--; stack.pop(); }
  if (ch === "]") { brackets--; stack.pop(); }
}
console.log({ backticks, braces, parens, brackets, lines: line, eofStack: stack });
console.log("TAIL:", JSON.stringify(s.slice(-120)));
