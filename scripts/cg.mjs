// Minimal CodeGraph DB query helper (MCP tools not exposed; DB queried directly).
// Usage: node scripts/cg.mjs search <name> [limit]
//        node scripts/cg.mjs callers <name> [limit]
//        node scripts/cg.mjs callees <name> [limit]
//        node scripts/cg.mjs node <name>
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('.codegraph/codegraph.db', { readonly: true });
const [, , cmd, name, limitArg] = process.argv;
const limit = Number(limitArg) || 15;

const q = {
  search: () => db.prepare(`
    SELECT n.kind, n.name, f.path, n.start_line, n.signature
    FROM nodes n JOIN files f ON f.id = n.file_id
    WHERE n.name LIKE ? ORDER BY length(n.name) LIMIT ?`).all(`%${name}%`, limit),
  node: () => db.prepare(`
    SELECT n.kind, n.name, f.path, n.start_line, n.end_line, n.signature
    FROM nodes n JOIN files f ON f.id = n.file_id
    WHERE n.name = ? LIMIT ?`).all(name, limit),
  callers: () => db.prepare(`
    SELECT DISTINCT sn.name AS caller, sf.path AS file, sn.start_line
    FROM edges e
    JOIN nodes tn ON tn.id = e.target_id
    JOIN nodes sn ON sn.id = e.source_id
    JOIN files sf ON sf.id = sn.file_id
    WHERE tn.name LIKE ? AND e.kind IN ('calls','invokes') LIMIT ?`).all(`%${name}%`, limit),
  callees: () => db.prepare(`
    SELECT DISTINCT tn.name AS callee, tf.path AS file, tn.start_line
    FROM edges e
    JOIN nodes sn ON sn.id = e.source_id
    JOIN nodes tn ON tn.id = e.target_id
    JOIN files tf ON tf.id = tn.file_id
    WHERE sn.name LIKE ? AND e.kind IN ('calls','invokes') LIMIT ?`).all(`%${name}%`, limit),
};

const rows = (q[cmd] || q.search)();
for (const r of rows) console.log(Object.values(r).join('  |  '));
if (!rows.length) console.log('(no results)');
db.close();
