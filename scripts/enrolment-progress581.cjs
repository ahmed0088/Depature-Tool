'use strict';
const fs=require('node:fs');
(async()=>{let stage='configuration';try{
 const cfg=fs.readFileSync('firebase-config.js','utf8'),field=k=>(cfg.match(new RegExp(k+'\\s*:\\s*["\\\']([^"\\\']+)["\\\']'))||[])[1];
 stage='sign-in';const authResponse=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(field('apiKey')),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:process.env.HOTELOPS_EMAIL,password:process.env.HOTELOPS_PASS,returnSecureToken:true})});
 const auth=await authResponse.json();if(!authResponse.ok||!auth.idToken)throw Error('Sign-in refused');
 const hotel=process.env.HOTELOPS_HOTEL||'ibis_dubai';if(!/^[\w-]{1,80}$/.test(hotel))throw Error('Invalid hotel id');
 stage='read progress';const response=await fetch(field('databaseURL').replace(/\/$/,'')+'/hotels/'+hotel+'/enrollLive.json?auth='+encodeURIComponent(auth.idToken));if(!response.ok)throw Error('Progress unavailable');const live=await response.json();
 if(!live||live.tag!=='accmwfmu3vb'){console.log('ENROLMENT_DIAGNOSTIC '+JSON.stringify({readOnly:true,matchingRun:false}));return;}
 const statuses={};for(const guest of live.report?.guests||[]){const status=String(guest.status||'unknown').replace(/\S+@\S+/g,'[email]').slice(0,120);statuses[status]=(statuses[status]||0)+1;}
 const result={readOnly:true,matchingRun:true,tag:live.tag,state:live.state,step:live.step,total:live.n,processed:live.done,tally:live.tally,statuses,currentIndex:live.current?.index||null};
 // Only known status/code lines and generic worker errors, never guest names or addresses.
 result.genericErrors=(live.con||[]).filter(e=>e.g==='ERR').map(e=>String(e.m||'').replace(/\S+@\S+/g,'[email]')).filter(m=>/^(Browser page error:|Portal request failed|Stopped:|worker |waitFor timeout:|signup button not found)/i.test(m)).map(m=>m.slice(0,150));
 console.log('ENROLMENT_DIAGNOSTIC '+JSON.stringify(result));
 }catch(_){console.error('Read-only enrolment diagnosis failed during '+stage);process.exitCode=1;}})();
