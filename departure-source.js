// A complete current Opera Departures read owns membership of the current queue.
// Absence is not a checkout or an extension; keep the row and its notes for review.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HotelOpsDepartureSource=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const active=new Set(['due','late','na','dnd']),room=v=>String(v??'').trim().replace(/^0+(?=\d)/,''),conf=v=>String(v??'').trim(),name=v=>String(v??'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(MR|MRS|MS|MISS|DR)\b/g,'').replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
 function matches(b,r){if(room(b.roomStr??b.room)!==room(r.room))return false;const a=conf(b.conf),c=conf(r.conf);return a&&c?a===c:!!name(b.name)&&name(b.name)===name(r.name);}
 function scope(s,day){
  if(!s||s.kind!=='departures'||!s.prop||!/^[A-Z0-9]{3,8}$/.test(s.prop)||s.countKnown!==true||s.filtered===true||!Array.isArray(s.rows)||!Number.isSafeInteger(s.total)||s.total<0||s.rows.length!==s.total)return null;
  const listDay=s.date||s.businessDate||(s.rows.length&&s.rows.every(r=>r.departure===day)?day:'');if(listDay!==day)return null;
  if(s.businessDate&&s.businessDate!==day)return null;
  const seen=new Set();for(const r of s.rows){const key=room(r.room);if(!key||!conf(r.conf)||seen.has(key)||r.departure&&r.departure!==day||['cancelled','no_show','due_in'].includes(r.status))return null;seen.add(key);}
  const at=Number(s.contentAt??s.at);if(!Number.isFinite(at)||at<=0)return null;
  return {schema:1,day,at,readId:String(s.h||at),property:String(s.prop||''),total:s.total};
 }
 function applies(r,day){const s=r.operaPresence;return !!(s?.schema===1&&s.day===day&&s.room===room(r.roomStr??r.room)&&s.booking===conf(r.conf)&&Number.isFinite(s.at)&&['present','missing'].includes(s.state));}
 function summary(rows,day){return rows.filter(r=>applies(r,day)).map(r=>r.operaPresence).sort((a,b)=>b.at-a.at)[0]||null;}
 function updates(s,rows,day){const verified=scope(s,day);if(!verified)return[];const latest=summary(rows,day);if(latest&&latest.at>verified.at)return[];
  return rows.flatMap(b=>{const state=s.rows.some(r=>matches(b,r))?'present':'missing',presence={...verified,room:room(b.roomStr??b.room),booking:conf(b.conf),state,wasListed:state==='present'||applies(b,day)&&!!b.operaPresence.wasListed};return Object.keys(presence).every(k=>b.operaPresence?.[k]===presence[k])?[]:[{room:b.roomStr,set:{operaPresence:presence}}];});
 }
 function pending(r,day){return !!(active.has(r.status)&&applies(r,day)&&r.operaPresence.state==='missing');}
 function olderChat(r,day,time){if(!applies(r,day))return false;if(!/^\d{2}:\d{2}$/.test(time||''))return true;const at=new Date(day+'T'+time+':00').getTime();return !Number.isFinite(at)||at<=r.operaPresence.at;}
 function canInferExtension(r,day){return !(r.manual&&pending(r,day)&&!r.operaPresence.wasListed);}
 function canAddChat({room:target,act,weak,known,rows,day}){const verified=summary(rows,day);if(verified&&!rows.some(r=>room(r.roomStr??r.room)===room(target)&&applies(r,day)&&r.operaPresence.state==='present'))return false;
  // A real early-checkout message can still be recorded when Opera has not
  // supplied a complete list. Other in-house messages do not create departures.
  return act==='co'&&!weak||known?.departure===day;
 }
 return {matches,scope,summary,updates,pending,olderChat,canInferExtension,canAddChat};
});
