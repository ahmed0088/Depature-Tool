'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const snap=value=>({val:()=>value,exists:()=>value!==null});
function harness(auth=false){
 const store=new Map(),timers=new Map(),reads=[],writes=[],callbacks=new Map(),failures=new Map(),values=new Map(),events=[];let next=0;
 const user={uid:'user-one',email:'owner@example.test'},firebaseAuth={currentUser:user,signOut:async()=>{events.push('signOut');firebaseAuth.currentUser=null;},onAuthStateChanged:fn=>{firebaseAuth.emit=fn;},setPersistence:async()=>{},signInWithEmailAndPassword:async()=>{events.push('password');return{user};}};
 const ref=path=>({child:p=>ref(path+'/'+p),once:async()=>{reads.push(path);if(failures.has(path))throw failures.get(path);return snap(values.has(path)?values.get(path):null);},on:(name,fn,error)=>{callbacks.set(path,{fn,error});return fn;},off:()=>{},set:async value=>{writes.push({path,value});},update:async value=>{writes.push({path,value});},limitToFirst(){return this;}});
 const db={ref,goOffline:()=>events.push('offline'),goOnline:()=>events.push('online')};
 const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{value:'',checked:false,style:{},dataset:{},textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(){}});return elements.get(id);}
 const ctx={console:{log(){},warn(){},error(){}},Map,Set,Promise,Date,Object,Array,JSON,String,Number,Error,HOTEL_ID:'hotel_a',navigator:{onLine:true},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},document:{hidden:false,addEventListener(){},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]},setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),firebase:{database:Object.assign(()=>db,{INTERNAL:{forceLongPolling:()=>events.push('longPolling')}}),auth:()=>firebaseAuth},window:{addEventListener(){}},location:{reload:()=>events.push('reload')}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('db.js','utf8'),ctx);
 vm.runInContext("_dbShowBanner = msg => { globalThis.banner = msg; }; let currentUser = null;",ctx);
 if(auth){
  // auth.js declares currentUser itself, so use a second context with the same mocks.
  const c={...ctx};delete c.currentUser;vm.createContext(c);vm.runInContext(fs.readFileSync('auth.js','utf8'),c);
  c.document.getElementById=id=>el(id);
  vm.runInContext("applyRole=()=>{};hideLoginScreen=()=>{globalThis.opened=true;};showLoginScreen=()=>{globalThis.shown=true;};updateAuthUI=()=>{};updateLastLogin=()=>{};logActivity=()=>{};_startSelfListener=()=>{};_resetIdleTimer=()=>{};",c);
  // Use the actual profile loader while replacing unrelated rendering.
  return{ctx:c,run:s=>vm.runInContext(s,c),user,firebaseAuth,values,failures,reads,writes,events,timers,store,elements};
 }
 return{ctx,run:s=>vm.runInContext(s,ctx),user,firebaseAuth,values,failures,reads,writes,events,timers,store,callbacks};
}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('pre-login reads and listeners wait for the verified profile without exposing a cached guest',async()=>{
 const h=harness();h.run('dbInit();lsSave("departures", {guest:"old guest"});globalThis.result="pending";fbGet("departures").then(v=>globalThis.result=v);globalThis.changes=[];fbListen("departures",v=>changes.push(v));');
 assert.equal(h.reads.length,0);assert.equal(h.ctx.result,'pending');assert.equal(h.ctx.changes.length,0);assert.equal(h.run('dbError()'),'');
 h.values.set('hotels/hotel_a/departures',{date:'2026-11-21'});h.run('currentUser={uid:"user-one"};fbSignedInNow();');await flush();
 assert.equal(h.ctx.result.date,'2026-11-21');assert(h.callbacks.has('hotels/hotel_a/departures'));assert.equal(h.timers.size,0);
});
test('successful reads do not hide failed writes or an access refusal on another path',async()=>{
 const h=harness();h.run('dbInit();currentUser={uid:"user-one"};');h.failures.set('hotels/hotel_a/settings',Object.assign(Error('refused'),{code:'PERMISSION_DENIED'}));
 await h.run('fbGet("settings")');assert.match(h.run('dbError()'),/access was refused/);assert.doesNotMatch(h.run('dbError()'),/expire/);
 await h.run('fbGet("departures")');assert.match(h.run('dbError()'),/access was refused/);
 h.run('_dbNoteError("saving arrivals",new Error("network"));');h.failures.delete('hotels/hotel_a/settings');await h.run('fbGet("settings")');assert.match(h.run('dbError()'),/saving arrivals/);
 h.run('_dbClearError("saving arrivals")');assert.equal(h.run('dbError()'),'');
});
test('retry uses HTTPS fallback, restores cancelled listeners, and issues zero application writes',async()=>{
 const h=harness();h.run('dbInit();currentUser={uid:"user-one"};globalThis.changes=[];fbListen("departures",v=>changes.push(v));');
 h.callbacks.get('hotels/hotel_a/departures').error(Object.assign(Error('refused'),{code:'PERMISSION_DENIED'}));assert.equal(h.run('_fbFailedListeners.length'),1);
 assert.equal(await h.run('fbRetryConnection()'),true);assert.equal(h.run('_fbFailedListeners.length'),0);assert.equal(h.writes.length,0);assert(h.events.includes('longPolling'));assert.deepEqual(h.events.filter(x=>x==='offline'||x==='online'),['offline','online']);assert.equal(h.timers.size,0);
 h.callbacks.get('hotels/hotel_a/departures').fn(snap({rooms:[]}));assert.equal(h.run('dbError()'),'');
});
test('a read timeout is bounded and a successful read cancels its timer',async()=>{
 const h=harness();const pending=h.run('dbReadWithTimeout({once:()=>new Promise(()=>{})},12)');const timer=[...h.timers.values()][0];assert.equal(timer.ms,12);timer.fn();await assert.rejects(pending,e=>e.code==='db/timeout');assert.equal(h.timers.size,0);
});
test('temporary profile failure retains the authenticated session and retry opens it without a password',async()=>{
 const h=harness(true);h.run('_authLoadEpoch=1;');h.failures.set('hotels/hotel_a/users/user-one',Object.assign(Error('network'),{code:'db/timeout'}));
 await h.run('_authOpenUser(firebase.auth().currentUser,1)');assert(!h.events.includes('signOut'));assert.equal(h.run('currentUser'),null);assert.equal(h.elements.get('loginBtn').textContent,'Retry connection');assert.match(h.elements.get('loginError').textContent,/You are signed in/);assert([...h.timers.values()].some(t=>t.ms===5000));
 h.failures.clear();h.values.set('hotels/hotel_a/users/user-one',{active:true,role:'owner'});await h.run('authLogin()');assert.equal(h.run('currentUser.uid'),'user-one');assert.equal(h.ctx.opened,true);assert(!h.events.includes('password'));assert(!h.events.includes('signOut'));
});
test('an explicit permission denial cannot open a cached owner profile',async()=>{
 const h=harness(true);h.run('_authLoadEpoch=1;');h.store.set('ho_profile_hotel_a_user-one',JSON.stringify({active:true,role:'owner'}));h.failures.set('hotels/hotel_a/users/user-one',Object.assign(Error('refused'),{code:'PERMISSION_DENIED'}));
 await h.run('_authOpenUser(firebase.auth().currentUser,1)');assert.equal(h.run('currentUser'),null);assert(!h.ctx.opened);assert.match(h.elements.get('loginError').textContent,/access was refused/);assert(!h.events.includes('signOut'));
});
test('confirmed inactive or missing accounts remain denied',async()=>{
 for(const profile of [{active:false,role:'owner'},null]){const h=harness(true);h.run('_authLoadEpoch=1;');h.values.set('hotels/hotel_a/users/user-one',profile);h.values.set('hotels/hotel_a/users',{someone:{active:true}});await h.run('_authOpenUser(firebase.auth().currentUser,1)');assert(h.events.includes('signOut'));assert(!h.ctx.opened);}
});
test('a stale profile response cannot reopen the app after sign-out',async()=>{
 const h=harness(true);h.run('_authLoadEpoch=1;');let resolve;h.ctx.promise=new Promise(r=>resolve=r);h.run('loadUserProfile=()=>promise;');const pending=h.run('_authOpenUser(firebase.auth().currentUser,1)');h.run('_authLoadEpoch++;');h.firebaseAuth.currentUser=null;resolve({active:true,role:'owner'});await pending;assert(!h.ctx.opened);assert.equal(h.run('currentUser'),null);
});
test('legacy hotel linking does not wait indefinitely for a nonessential mapping write',async()=>{
 const h=harness();vm.runInContext(fs.readFileSync('tenant.js','utf8'),h.ctx);h.ctx.location.reload=()=>{throw Error('unexpected reload');};h.values.set('userHotels/user-one',null);h.values.set('hotels/hotel_a/users/user-one',{active:true});h.ctx.firebase.database=()=>({ref:path=>({once:async()=>snap(h.values.get(path)||null),set:()=>new Promise(()=>{})})});
 assert.equal(await h.run('tnResolveHotel("user-one")'),'hotel_a');
});
test('automatic connection retry uses the existing session when the network returns',async()=>{
 const h=harness(true);h.run('_authLoadEpoch=1;');h.failures.set('hotels/hotel_a/users/user-one',Object.assign(Error('network'),{code:'db/timeout'}));await h.run('_authOpenUser(firebase.auth().currentUser,1)');
 const retry=[...h.timers.values()].find(t=>t.ms===5000);assert(retry);h.failures.clear();h.values.set('hotels/hotel_a/users/user-one',{active:true,role:'agent'});await retry.fn();assert.equal(h.run('currentProfile.role'),'agent');assert(!h.events.includes('password'));assert(!h.events.includes('signOut'));
});
test('a blocked stale-disconnect acknowledgement is bounded and cannot open or duplicate sign-in',async()=>{
 const h=harness(true);h.run('_authLoadEpoch=1;');h.values.set('hotels/hotel_a/users/user-one',{active:true,role:'owner',forceLogout:true});
 const original=h.ctx.firebase.database;h.ctx.firebase.database=()=>({ref:path=>({...original().ref(path),update:()=>new Promise(()=>{})})});
 const pending=h.run('_authOpenUser(firebase.auth().currentUser,1)');await flush();assert.equal(h.run('_authConnecting'),true);assert.equal(h.run('currentUser'),null);const reads=h.reads.length;await h.run('authLogin()');assert.equal(h.reads.length,reads);[...h.timers.values()].find(t=>t.ms===8000).fn();await pending;assert.equal(h.elements.get('loginBtn').textContent,'Retry connection');assert(!h.ctx.opened);assert(!h.events.includes('signOut'));
});
test('background reads also wait when auth.js has not loaded yet',()=>{
 const h=harness(),c={...h.ctx};vm.createContext(c);vm.runInContext(fs.readFileSync('db.js','utf8'),c);vm.runInContext('fbGet("departures");fbListen("departures",()=>{});',c);assert.equal(vm.runInContext('_fbSignedIn()',c),false);assert.equal(vm.runInContext('_fbReadWaiting.length',c),1);assert.equal(h.reads.length,0);
});
test('use another account cancels the recovery timer and invalidates pending profile responses',async()=>{
 const h=harness(true);h.run('_authLoadEpoch=1;');h.failures.set('hotels/hotel_a/users/user-one',Object.assign(Error('network'),{code:'db/timeout'}));await h.run('_authOpenUser(firebase.auth().currentUser,1)');assert([...h.timers.values()].some(t=>t.ms===5000));await h.run('authUseAnotherAccount()');assert.equal(h.firebaseAuth.currentUser,null);assert.equal(h.run('_authLoadEpoch'),2);assert(![...h.timers.values()].some(t=>t.ms===5000));assert(!h.ctx.opened);
});
