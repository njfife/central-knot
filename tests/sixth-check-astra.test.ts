// Reproductions from the Astra sixth check (15c8652), kept as regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyAgents, readAgents, restoreAgent } from '../src/agents.ts';
import { applyMcp, readTool, restoreMcp } from '../src/mcp.ts';
import { readHistory } from '../src/manage.ts';
import type { ShareContext } from '../src/share.ts';
import type { HarnessId } from '../src/types.ts';
const tools: HarnessId[] = ['claude-cli','copilot-cli','codex-cli'];
const managed=(key:string)=>[{key,managed:true,off:[]}];
const md=(prompt:string)=>`---\nname: reviewer\ndescription: Review\n---\n\n${prompt}\n`;
const json=(command:string)=>JSON.stringify({mcpServers:{docs:{command}}});
async function box(run:(b:{home:string;context:ShareContext;paths:string[]})=>Promise<void>){
 const base=await fs.mkdtemp(join(tmpdir(),'ck-astra6-case-'));const home=join(base,'home');
 for(const f of ['.claude','.copilot','.codex'])await fs.mkdir(join(home,f,'agents'),{recursive:true});
 const context:ShareContext={home,mode:'custom',read:async()=>[],build:'test',settingsPath:join(base,'settings.json'),realHome:join(base,'real')};
 const paths=['.claude/agents/reviewer.md','.copilot/agents/reviewer.agent.md','.codex/agents/reviewer.toml'].map(p=>join(home,p));
 try{await run({home,context,paths});}finally{await fs.rm(base,{recursive:true,force:true});}
}
const command=async(c:ShareContext,t:HarnessId)=>(await readTool(c,t)).entries.find(e=>e.name==='docs')?.server.command;

test('S1 Codex MCP subtables survive an ordinary update',()=>box(async b=>{
 const target=join(b.home,'.codex/config.toml');
 await fs.writeFile(target,'[mcp_servers.docs]\nurl="https://example.test/mcp"\n[mcp_servers.docs.http_headers]\nX-Region="west"\n[mcp_servers.docs.env_http_headers]\nX-Workspace="WORKSPACE_NAME"\n');
 await applyMcp(b.context,tools.slice(1),managed('docs'));
 await fs.writeFile(join(b.home,'.copilot/mcp-config.json'),JSON.stringify({mcpServers:{docs:{url:'https://example.test/new'}}}));
 await applyMcp(b.context,tools.slice(1),[]);
 assert.match(await fs.readFile(target,'utf8'),/WORKSPACE_NAME/,'tool-specific subtable erased');
}));

test('S2 concurrent MCP tool-specific setting is not overwritten',()=>box(async b=>{
 const target=join(b.home,'.codex/config.toml');
 await fs.writeFile(join(b.home,'.copilot/mcp-config.json'),json('BASE'));
 await fs.writeFile(target,'[mcp_servers.docs]\ncommand="BASE"\nenabled=true\n');
 await applyMcp(b.context,tools.slice(1),managed('docs'));
 await fs.writeFile(join(b.home,'.copilot/mcp-config.json'),json('EDIT'));
 const original=fs.readFile;let reads=0;
 fs.readFile=(async(path:any,...rest:any[])=>{
   if(String(path)===target && ++reads===2)await fs.writeFile(target,'[mcp_servers.docs]\ncommand="BASE"\nenabled=false\n');
   return (original as any)(path,...rest);
 }) as typeof fs.readFile;syncBuiltinESMExports();
 try{await applyMcp(b.context,tools.slice(1),[]);}finally{fs.readFile=original;syncBuiltinESMExports();}
 assert.match(await fs.readFile(target,'utf8'),/enabled=false/,'concurrent native setting reverted');
}));

test('S3 Apply all for a different agent must not consume a folder reset',()=>box(async b=>{
 await fs.writeFile(b.paths[0],md('BASE'));await applyAgents(b.context,tools,managed('reviewer'));
 await fs.writeFile(join(b.home,'.claude/agents/other.md'),md('OTHER'));
 await applyAgents(b.context,tools,managed('other'));
 await fs.rename(join(b.home,'.copilot/agents'),join(b.home,'.copilot/agents-backup'));
 await fs.mkdir(join(b.home,'.copilot/agents'));
 await applyAgents(b.context,tools,[{key:'other',managed:true,off:['codex-cli']}],{only:new Set(['other'])});
 await applyAgents(b.context,tools,[],{now:1000});
 await applyAgents(b.context,tools,[],{now:4000});
 assert.equal(await fs.readFile(b.paths[0],'utf8').catch(()=> 'DELETED'),md('BASE'));
}));

test('S4 process death during agent Restore must not delete it everywhere',()=>box(async b=>{
 await fs.writeFile(b.paths[0],md('BASE'));await applyAgents(b.context,tools,managed('reviewer'));
 await fs.writeFile(b.paths[0],md('EDIT'));await applyAgents(b.context,tools,[]);
 const event=(await readHistory(b.home)).find(e=>e.kind==='edit')!;
 const script=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {restoreAgent} from './src/agents.ts';
 const original=fs.link;fs.link=async(from,to)=>{if(String(to)===process.env.CK_TARGET)process.exit(73);return original(from,to);};syncBuiltinESMExports();
 const c=JSON.parse(process.env.CK_CONTEXT);c.read=async()=>[];await restoreAgent(c,['claude-cli','copilot-cli','codex-cli'],process.env.CK_EVENT);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,CK_TARGET:b.paths[0],CK_CONTEXT:JSON.stringify(b.context),CK_EVENT:event.id},encoding:'utf8'});
 assert.equal(child.status,73,child.stderr);
 await applyAgents(b.context,tools,[],{now:1000});
 await applyAgents(b.context,tools,[],{now:4000});
 assert.equal((await readAgents(b.context,'copilot-cli')).entries[0]?.agent.prompt.trim(),'EDIT');
}));

test('S5 malformed MCP entry must not spread a deletion',()=>box(async b=>{
 await fs.writeFile(join(b.home,'.copilot/mcp-config.json'),json('BASE'));
 await applyMcp(b.context,tools.slice(1),managed('docs'));
 await fs.writeFile(join(b.home,'.copilot/mcp-config.json'),'{"mcpServers":{"docs":null}}');
 await applyMcp(b.context,tools.slice(1),[],{now:1000});
 await applyMcp(b.context,tools.slice(1),[],{now:4000});
 assert.equal(await command(b.context,'codex-cli'),'BASE');
}));

test('S6 Restore must not adopt an MCP edit saved after its write as baseline',()=>box(async b=>{
 const target=join(b.home,'.copilot/mcp-config.json');
 await fs.writeFile(target,json('BASE'));await applyMcp(b.context,tools.slice(1),managed('docs'));
 await fs.writeFile(target,json('EDIT'));await applyMcp(b.context,tools.slice(1),[]);
 const event=(await readHistory(b.home)).find(e=>e.kind==='edit')!;
 const original=fs.link;let injected=false;
 fs.link=async(from,to)=>{await original(from,to);if(String(to)===target&&!injected){injected=true;await fs.writeFile(target,json('CONCURRENT'));}};syncBuiltinESMExports();
 try{await restoreMcp(b.context,tools.slice(1),event.id);}finally{fs.link=original;syncBuiltinESMExports();}
 await applyMcp(b.context,tools.slice(1),[]);
 assert.equal(await command(b.context,'copilot-cli'),'CONCURRENT');
}));
