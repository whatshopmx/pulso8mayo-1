// RP-00: snapshot reproducible de fuentes locales, sin DB ni efectos externos.
// Ejecutar desde la raíz: node tasks/evidencia/vistas-roles-2026-10-30/inventory.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const evidenceDirectory = fileURLToPath(new URL('.', import.meta.url));
const roots = ['app/dashboard', 'app/api', 'app/actions', 'components/dashboard',
  'components/team', 'components/compliance', 'lib/rbac'];
const files = roots.flatMap(root => fs.readdirSync(root, { recursive: true })
  .map(file => `${root}/${file.replaceAll('\\', '/')}`)
  .filter(file => /\.tsx?$/.test(file) && fs.statSync(file).isFile()));
const records = files.map(file => {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [], calls = [], urls = [];
  function visit(node) {
    if (ts.isImportDeclaration(node)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && /auth|[Pp]ermission|[Ss]cope|[Tt]enant|[Rr]ole|[Ss]ession|Service|Engine|db\.|cache|revalidate/.test(node.expression.getText(ast))) calls.push(node.expression.getText(ast));
    if (ts.isStringLiteralLike(node) && /^\/(api|dashboard)\b/.test(node.text)) urls.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { file, sha256: crypto.createHash('sha256').update(source).digest('hex'),
    imports, calls: [...new Set(calls)], urls: [...new Set(urls)] };
});
const output = { head: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  records };
fs.writeFileSync(path.join(evidenceDirectory, 'inventory.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`Inventario: ${records.length} archivos; sin acceso a DB.`);
