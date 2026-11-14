'use strict';
// Diagnostic only: authenticate to HotelOps, read the saved snapshot, encrypt it locally.
// This script has no database-write methods and never opens IN-Gauge or submits sales.
const fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {connectDb,privateError}=require('./manual-sales-cloud.js');
const C=require('../ingauge-audit-core.js');
function envelope(report,key){const secret=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secret,iv),data=Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(report))),cipher.final()]);return {key:crypto.publicEncrypt({key,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},secret).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
(async()=>{
 const report={schema:2,at:new Date().toISOString()};
 try{
  const authenticated=await connectDb(),db={hotelId:authenticated.hotelId,get:path=>authenticated.get(path)};const [binding,latestSnapshot,latestJob,legacyContext]=await Promise.all(['ingauge/binding','ingauge/latestSnapshot','ingauge/latestJob','ingauge/legacyContext'].map(p=>db.get(p)));
  report.hotelId=db.hotelId;report.binding=binding;report.latestSnapshot=latestSnapshot;report.legacyContext=legacyContext;
  if(latestJob){const job=await db.get('ingauge/jobs/'+latestJob);report.job={tag:latestJob,state:job?.state,snapshotId:job?.snapshotId,at:job?.at,planJson:job?.planJson,note:job?.note,results:job?.results,tally:job?.tally};}
  const snapshotId=latestSnapshot||report.job?.snapshotId;if(!/^ig[a-z0-9-]{6,70}$/.test(snapshotId||''))throw Error('No validated saved snapshot is available.');
  report.snapshot=await db.get('ingauge/snapshots/'+snapshotId);if(!report.snapshot||report.snapshot.hotelId!==db.hotelId)throw Error('Saved snapshot does not match the hotel.');
  if(!C.sameBinding(report.binding,report.snapshot.binding)||!/ibis/i.test(report.binding?.property||''))throw Error('The selected snapshot is for another hotel.');
  const jobs=await db.get('ingauge/jobs');report.recentJobs=Object.entries(jobs||{}).sort((a,b)=>(b[1].reviewedAt||b[1].at||0)-(a[1].reviewedAt||a[1].at||0)).slice(0,30).map(([tag,j])=>({tag,state:j.state,test:j.test,reviewedAt:j.reviewedAt,at:j.at,snapshotId:j.snapshotId,planJson:j.planJson,results:j.results,tally:j.tally,note:j.note}));
  report.stage='complete';
 }catch(e){report.stage='stopped';report.error=privateError(e);}
 const encrypted=envelope(report,fs.readFileSync('scripts/monthly-read-public.pem'));const encoded=Buffer.from(JSON.stringify(encrypted)).toString('base64');
 console.log('MONTHLY_READ_BEGIN');for(let i=0;i<encoded.length;i+=2000)console.log('MONTHLY_READ_CHUNK '+encoded.slice(i,i+2000));console.log('MONTHLY_READ_END');
 console.log(report.stage==='complete'?'Saved snapshot read and encrypted. No sales changed.':'Saved snapshot could not be fully read. Details encrypted.');
})().catch(()=>{console.error('Snapshot diagnostic could not be encrypted.');process.exitCode=1;});
