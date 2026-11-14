// Per-confirmation/package seller choices. No account or financial writes in this module.
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./ingauge-audit-core.js'):root.InGaugeAuditCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.InGaugeSellerPins=api;})(typeof globalThis==='object'?globalThis:this,function(C){
  'use strict';
  function identity(value){const b=C.binding({...value,property:value?.property||'Selected hotel',department:value?.department||'Selected department'});return {portalUrl:b.portalUrl,tenantId:b.tenantId,propertyId:b.propertyId,departmentId:b.departmentId};}
  function sameTarget(a,b){try{return C.stable(identity(a))===C.stable(identity(b));}catch(_){return false;}}
  function equal(a,b){return C.stable(a||null)===C.stable(b||null);}
  function applicable(pin,binding){return !!pin&&(!pin.binding||sameTarget(pin.binding,binding));}
  function owner(pin,snapshot,aliases=[]){
    if(!applicable(pin,snapshot?.binding)||!pin.seller||pin.skip)return {state:'none',reason:'No fixed seller for this package.'};
    if(pin.contributorId){const person=snapshot.contributors.find(p=>String(p.id)===String(pin.contributorId));return person?{state:'matched',person,reason:'Fixed contributor ID '+person.id+'.'}:{state:'unmatched',reason:'The fixed contributor ID is not available in this hotel. Review the seller; a matching name cannot replace this ID.'};}
    return C.resolveSeller(pin.seller,snapshot.contributors,aliases);
  }
  function decision({confirmation,product,person,binding,previous,by='',at=new Date().toISOString(),reason=''}){
    if(!/^\d+$/.test(String(confirmation||''))||!/^\d*[1-9]\d*$/.test(String(product?.id||''))||!/^\d*[1-9]\d*$/.test(String(person?.id||''))||!String(person.name||'').trim())throw Error('Choose a confirmation, package and identified contributor before fixing the seller.');
    if(previous?.skip)throw Error('This package is excluded in Package Audit. Remove its Skip decision before fixing a seller.');
    return {seller:person.name,contributorId:String(person.id),confirmation:String(confirmation),productId:String(product.id),product:product.name,binding:identity(binding),by:String(by||'Manager').slice(0,100),at,reason:String(reason||'').slice(0,500),source:'IN-Gauge automation',...(previous?.manual?{manual:true}:{})};
  }
  function release(pin){if(!pin?.manual)return null;const next={...pin};for(const k of ['seller','contributorId','reason','source'])delete next[k];return next;}
  function entry(pins,confirmation,productId,preferred,binding){
    const direct=pins?.[preferred];if(applicable(direct,binding))return {key:preferred,pin:direct};
    const matching=Object.entries(pins||{}).filter(([,pin])=>applicable(pin,binding)&&String(pin.confirmation||'')===String(confirmation)&&String(pin.productId||'')===String(productId)&&(pin.seller||pin.manual||pin.skip));
    if(matching.length>1)throw Error('More than one fixed seller choice matches this package. Review its saved choices in Package Audit.');
    return matching.length?{key:matching[0][0],pin:matching[0][1]}:{key:preferred,pin:null};
  }
  function find(pins,op,snapshot){
    const row=snapshot.records.find(r=>r.id===String(op.recordId||'')),productId=String(op.productId||row?.productId||''),conf=String(op.confirmation||row?.confirmation||'');
    if(op.sellerFreeze?.key){const pin=pins[op.sellerFreeze.key];return applicable(pin,snapshot.binding)?pin:null;}
    const stable=Object.values(pins||{}).filter(pin=>applicable(pin,snapshot.binding)&&String(pin.confirmation||'')===conf&&String(pin.productId||'')===productId&&pin.seller&&!pin.skip);
    if(stable.length>1&&!stable.every(pin=>String(pin.contributorId)===String(stable[0].contributorId)))throw Error('Conflicting fixed sellers exist for this package. Review its seller choices.');
    if(stable.length)return stable[0];
    const product=snapshot.products.find(p=>p.id===productId),key=(conf+'|'+(product?.name||row?.product||'')).replace(/[.#$\[\]\/]/g,'_'),pin=pins[key];
    return applicable(pin,snapshot.binding)?pin:null;
  }
  function issue(op,snapshot,pins,aliases=[]){
    if(!['add','edit','approve'].includes(op.action))return '';
    try{const pin=find(pins||{},op,snapshot);if(op.sellerFreeze?.key&&(!pin?.seller||pin.skip))return 'The fixed seller was removed or changed after review. Reopen this sale and review it again.';
      if(!pin?.seller||pin.skip)return '';const who=owner(pin,snapshot,aliases);if(who.state!=='matched')return who.reason||'Review the fixed seller for this hotel.';
      const row=snapshot.records.find(r=>r.id===String(op.recordId||'')),selected=op.action==='approve'?row?.contributorId:op.contributorId;
      return String(selected)!==String(who.person.id)?'This package is fixed to '+who.person.name+' (ID '+who.person.id+'). Reopen the sale to change or unfreeze that choice.':'';
    }catch(error){return error.message;}
  }
  return {identity,sameTarget,equal,applicable,owner,decision,release,entry,find,issue};
});
