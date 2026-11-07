'use strict';
// Private, bounded reference data only. Never stores sessions, permissions or sale records.
const crypto=require('node:crypto'),C=require('../ingauge-audit-core.js');
const TTL=24*60*60*1000,clone=value=>JSON.parse(JSON.stringify(value));
function identity(scope){
 const binding=C.binding(scope.binding),actorId=C.id(scope.actorId),industryId=C.id(scope.industryId);
 if(!/^[1-9]\d*$/.test(actorId)||!/^[1-9]\d*$/.test(industryId))throw Error('Verify the connected account before using reference data.');
 return {binding,actorId,industryId};
}
function rows(kind,value,binding){
 if(!['products','contributors'].includes(kind)||!Array.isArray(value)||value.length>10000)throw Error('The reference list is incomplete.');
 const seen=new Set();return value.map(p=>{
  const id=C.id(p.id);if(!/^[1-9]\d*$/.test(id)||seen.has(id)||!C.text(p.name)||!C.text(p.activeStatus))throw Error('The reference list contains an invalid or duplicated identity.');seen.add(id);
  if(kind==='contributors')return {id,name:C.text(p.name),pulseId:C.text(p.pulseId),activeStatus:C.text(p.activeStatus)};
  if(C.id(p.departmentId)!==binding.departmentId||typeof p.recurring!=='boolean')throw Error('The product catalog belongs to another department or has an unknown charge rule.');
  return {id,name:C.text(p.name),code:C.text(p.code),sku:C.text(p.sku),recurring:p.recurring,activeStatus:C.text(p.activeStatus),departmentId:binding.departmentId};
 });
}
class ReferenceCache{
 constructor({store=null,now=Date.now}={}){this.store=store;this.now=now;this.memory=new Map();this.pending=new Map();this.meta={};}
 location(scope,kind){const who=identity(scope);return {who,path:'ingauge/referenceCache/'+crypto.createHash('sha256').update(C.stable(who)).digest('hex')+'/'+kind};}
 async load(scope,kind,loader,{force=false}={}){
  const {who,path}=this.location(scope,kind),active=this.pending.get(path);
  if(active){if(!force||active.force)return clone(await active.task);await active.task.catch(()=>{});return this.load(scope,kind,loader,{force:true});}
  const task=(async()=>{
   let cached=force?null:this.memory.get(path);if(!force&&!cached&&this.store)try{cached=await this.store.get(path);}catch(_){}
   const age=this.now()-Number(cached?.fetchedAt);
   if(cached?.schema===1&&cached.kind===kind&&C.stable(cached.identity)===C.stable(who)&&Number.isFinite(age)&&age>=0&&age<TTL){
    try{const data=rows(kind,cached.data??(cached.count===0?[]:null),who.binding);if(data.length!==cached.count)throw Error('Count mismatch');this.memory.set(path,cached);this.meta[kind]={fetchedAt:cached.fetchedAt,cached:true,expiresAt:cached.fetchedAt+TTL};return data;}catch(_){}
   }
   // A failed refresh never falls back to an expired entry.
   const data=rows(kind,await loader(),who.binding),fetchedAt=this.now(),entry={schema:1,kind,identity:who,fetchedAt,count:data.length,data};
   this.memory.set(path,entry);if(this.store)try{await this.store.put(path,entry);}catch(_){}
   this.meta[kind]={fetchedAt,cached:false,expiresAt:fetchedAt+TTL};return data;
  })();this.pending.set(path,{task,force});
  try{return clone(await task);}finally{if(this.pending.get(path)?.task===task)this.pending.delete(path);}
 }
 async invalidate(scope,kind){const {path}=this.location(scope,kind);this.memory.delete(path);delete this.meta[kind];if(this.store)try{await this.store.put(path,null);}catch(_){} }
}
module.exports={ReferenceCache,TTL,identity,rows};
