// Reproductions from the Astra fifth check (51a5d32), kept as regressions. N1 injects the concurrent save where the
// write now happens: after the old file is moved aside, before the new one is linked into place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyAgents } from '../src/agents.ts';
import { applyMcp, readTool, restoreMcp } from '../src/mcp.ts';
import { readHistory } from '../src/manage.ts';
import { readRecord, saveRecord, type ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';
const tools: HarnessId[] = ['claude-cli', 'copilot-cli', 'codex-cli'];
const md = (prompt: string) => `---\nname: reviewer\ndescription: Review\n---\n\n${prompt}\n`;
const managed = (key: string) => [{key, managed:true, off: []}];
async function box(run: (b: {home:string; context:ShareContext; paths:string[]})=>Promise<void>) {
  const base = await fs.mkdtemp(join(tmpdir(),'ck-astra5-'));
  const home = join(base,'home');
  for (const name of ['.claude','.copilot','.codex']) await fs.mkdir(join(home,name,'agents'),{recursive:true});
  const context:ShareContext={home,mode:'custom',read:async()=>[],build:'test',settingsPath:join(base,'settings.json'),realHome:join(base,'real')};
  const paths=['.claude/agents/reviewer.md','.copilot/agents/reviewer.agent.md','.codex/agents/reviewer.toml'].map(p=>join(home,p));
  try { await run({home,context,paths}); } finally {await fs.rm(base,{recursive:true,force:true});}
}
const json=(command:string)=>JSON.stringify({mcpServers:{docs:{command}}});
const command=async(context:ShareContext,tool:HarnessId)=>(await readTool(context,tool)).entries.find(e=>e.name==='docs')?.server.command;

test('N1 agent edit saved after final read must survive replacement',()=>box(async b=>{
  await fs.writeFile(b.paths[0],md('BASE')); await applyAgents(b.context,tools,managed('reviewer'));
  await fs.writeFile(b.paths[0],md('UPSTREAM'));
  const original=fs.link; let injected=false;
  fs.link=async(from,to)=>{
    if(String(to)===b.paths[1]&&!injected){injected=true;await fs.writeFile(b.paths[1],md('CONCURRENT UNIQUE'));}
    return original(from,to);
  }; syncBuiltinESMExports();
  try {await applyAgents(b.context,tools,[]);} finally {fs.link=original;syncBuiltinESMExports();}
  assert.ok(injected);
  const files=await fs.readdir(join(b.home,'.central-knot','items','agents'),{recursive:true});
  const all=await Promise.all(files.map(p=>fs.readFile(join(b.home,'.central-knot','items','agents',p),'utf8').catch(()=>'')));
  assert.ok([await fs.readFile(b.paths[1],'utf8'),...all].some(s=>s.includes('CONCURRENT UNIQUE')),'concurrent edit was erased and never stored');
}));

test('N3 missing MCP config root must not delete other tools servers',()=>box(async b=>{
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('BASE'));
  await applyMcp(b.context,tools.slice(1),managed('docs'));
  await fs.rename(join(b.home,'.copilot'),join(b.home,'.copilot-away'));
  await applyMcp(b.context,tools.slice(1),[],{settleMs:0});
  assert.equal(await command(b.context,'codex-cli'),'BASE');
}));

test('N4 MCP deletion spares a never-synced same-name server and finishes in Claude by Write now',()=>box(async b=>{
  await fs.writeFile(join(b.home,'.claude.json'),json('BASE'));
  await applyMcp(b.context,tools.slice(0,2),managed('docs'));
  await fs.writeFile(join(b.home,'.codex','config.toml'),'[mcp_servers.docs]\ncommand="UNRELATED"\n');
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),'{"mcpServers":{}}');
  await applyMcp(b.context,tools,[],{settleMs:0});
  assert.equal(await command(b.context,'codex-cli'),'UNRELATED');
  await applyMcp(b.context,tools,[],{claudeNow:['docs']});
  assert.equal(await command(b.context,'claude-cli'),undefined);
}));

test('N5 MCP old deletion Restore must not overwrite newly managed server',()=>box(async b=>{
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('BASE'));
  await applyMcp(b.context,tools.slice(1),managed('docs'));
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),'{"mcpServers":{}}');
  await applyMcp(b.context,tools.slice(1),[],{settleMs:0});
  const event=(await readHistory(b.context)).find(e=>e.kind==='deleted')!;
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('UNRELATED'));
  await applyMcp(b.context,tools.slice(1),managed('docs'));
  await restoreMcp(b.context,tools.slice(1),event.id);
  assert.equal(await command(b.context,'copilot-cli'),'UNRELATED');
}));

test('N8b MCP deletion made in Codex: Restore keeps Codex enabled=false (DEL-03)',()=>box(async b=>{
  const codex=join(b.home,'.codex','config.toml');
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('BASE'));
  await applyMcp(b.context,tools.slice(1),managed('docs'));
  await fs.writeFile(codex,(await fs.readFile(codex,'utf8')).replace('command = "BASE"\n','command = "BASE"\nenabled = false\n'));
  await applyMcp(b.context,tools.slice(1),[]);
  await fs.writeFile(codex,'[mcp_servers.other]\ncommand = "true"\n');
  await applyMcp(b.context,tools.slice(1),[],{settleMs:0});
  await restoreMcp(b.context,tools.slice(1),(await readHistory(b.context)).find(e=>e.kind==='deleted')!.id);
  assert.match(await fs.readFile(codex,'utf8'),/enabled\s*=\s*false/);
}));

test('N11 interrupted agents conflict must recover loser through History on restart',()=>box(async b=>{
  await fs.writeFile(b.paths[0],md('BASE'));await applyAgents(b.context,tools,managed('reviewer'));
  await fs.writeFile(b.paths[0],md('CLAUDE LOSER'));
  await fs.writeFile(b.paths[1],md('COPILOT WINNER'));
  const original=fs.rename;
  fs.rename=async(from,to)=>{
    if(String(to)===join(b.home,'.central-knot','agents.json'))throw new Error('injected crash before record commit');
    return original(from,to);
  };syncBuiltinESMExports();
  try{await assert.rejects(applyAgents(b.context,tools,[]),/injected crash/);}finally{fs.rename=original;syncBuiltinESMExports();}
  const modulePath='../src/agents.ts?restart=astra5';
  const restarted=await import(modulePath);
  await restarted.applyAgents(b.context,tools,[]);
  assert.ok((await readHistory(b.context)).some(e=>e.losers.some(l=>l.tool==='claude-cli')),'displaced edit has no history or restore after restart');
}));

test('C1 MCP Restore ownership gate holds',()=>box(async b=>{
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('BASE'));
  await applyMcp(b.context,tools.slice(1),managed('docs'));
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('EDIT'));
  await applyMcp(b.context,tools.slice(1),[]);
  const event=(await readHistory(b.context)).find(e=>e.kind==='edit')!;
  const {record}=await readRecord(b.home);record!.owner='other';await saveRecord(b.home,record!);
  assert.equal((await restoreMcp(b.context,tools.slice(1),event.id)).writes,0);
  assert.equal(await command(b.context,'copilot-cli'),'EDIT');
}));

test('C2 MCP and agents only scopes hold pending edits',()=>box(async b=>{
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('BASE'));
  await applyMcp(b.context,tools.slice(1),managed('docs'));
  await fs.writeFile(join(b.home,'.copilot','mcp-config.json'),json('EDIT'));
  assert.equal((await applyMcp(b.context,tools.slice(1),[],{only:new Set(['other'])})).writes,0);
  assert.equal(await command(b.context,'codex-cli'),'BASE');
  await fs.writeFile(b.paths[0],md('BASE'));await applyAgents(b.context,tools,managed('reviewer'));
  await fs.writeFile(b.paths[0],md('EDIT'));
  assert.equal((await applyAgents(b.context,tools,[],{only:new Set(['other'])})).writes,0);
  assert.match(await fs.readFile(b.paths[1],'utf8'),/BASE/);
}));
