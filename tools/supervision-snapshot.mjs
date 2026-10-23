// Read-only view of the live (legacy desktop) OpenCode task. No API keys or
// unrelated sessions are read. Run with Node 24+; WAL access may need approval.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const session = 'ses_eb6600e6dffeh57rGuKEbeGLua';
const dbPath = 'C:/Users/14451/.local/share/opencode/opencode.db';
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const info = db.prepare('SELECT id,title,directory,model,time_updated FROM session WHERE id=?').get(session);
  if (!info || !/SpyMouseWeb$/i.test(info.directory)) throw Error('Target session mismatch');
  const rows = db.prepare('SELECT id,time_updated,data FROM part WHERE session_id=? ORDER BY time_created DESC LIMIT 70').all(session);
  const recent = rows.map(r => ({ id: r.id, updated: new Date(r.time_updated).toISOString(), ...JSON.parse(r.data) }));
  const tools = recent.filter(p => p.type === 'tool').slice(0, 8).map(p => ({
    id: p.id, updated: p.updated, tool: p.tool, status: p.state?.status,
    title: p.state?.title,
    command: p.state?.input?.command?.slice(0, 1800),
    output: String(p.state?.output ?? p.state?.metadata?.output ?? '').slice(-2000),
  }));
  const text = recent.filter(p => p.type === 'text').slice(0, 4).map(p => ({ updated: p.updated, text: p.text?.slice(0, 2500) }));
  const files = ['src', 'tools', 'analysis', 'assets/levels/routes-native'].flatMap(dir =>
    fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => {
      const file = path.join(dir, e.name), s = fs.statSync(file);
      return { file, updated: s.mtime.toISOString(), size: s.size };
    }) : []
  ).sort((a,b) => b.updated.localeCompare(a.updated)).slice(0, 12);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), session: info,
    todos: db.prepare('SELECT content,status,priority FROM todo WHERE session_id=? ORDER BY position').all(session),
    tools, text, files }, null, 2));
} finally { db.close(); }
