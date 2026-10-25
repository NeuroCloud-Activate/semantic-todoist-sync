const fs=require("fs");
const src=fs.readFileSync(__dirname+"/todoist-live-check.js","utf8");
const mk=(projects)=>({getTodoistSnapshot:async()=>({projects,sections:[{id:"s1",projectId:"P"}],tasks:[{id:"1",content:"a",projectId:"P",labels:[]},{id:"2",content:"b",projectId:"Q",updatedAt:"x"}]})});
(async()=>{
 globalThis.__stsSelfTestOnly=true;
 globalThis.__stsStub=mk([{id:"P",name:"STS Test"}]);
 const ok=JSON.parse(await eval(src));
 if(!ok.ok||ok.steps.selfCheck.status!=="OK") throw new Error("selfcheck: "+JSON.stringify(ok));
 globalThis.__stsStub=mk([{id:"P",name:"STS Test"},{id:"R",name:"STS Test"}]);
 const dup=JSON.parse(await eval(src));
 if(dup.ok||!/exactly one/.test(dup.error)) throw new Error("dup: "+JSON.stringify(dup));
 let undone=0;
 globalThis.__stsSelfTestOnly=false;
 globalThis.__stsStub=Object.assign(mk([{id:"P",name:"STS Test"}]),{chat:async(q)=>/add a new task/.test(q)?{answer:"ok",todoistChanges:{rows:[{op:"create",target:{projectId:"P"},fields:{}}]}}:{answer:"ok"},applyTodoistChanges:async()=>{throw new Error("boom")},undoLastTodoistChanges:async()=>{undone++;return {restored:0}}});
 const thr=JSON.parse(await eval(src));
 if(thr.ok||undone!==1||thr.cleanupUndo!=="done") throw new Error("apply-throw: "+JSON.stringify(thr)+" undone="+undone);
 console.log("guard test passed");
})().catch(e=>{console.error(e.message);process.exit(1)});
