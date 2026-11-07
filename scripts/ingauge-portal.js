'use strict';
// Adapter for the public IN-Gauge product-metrics form. Credentials remain in the browser.
const Core = require('../manual-sales-core.js');
const ORIGIN = 'https://app.fpg-ingauge.com';
class ReviewRequired extends Error {}
class InGaugePortal {
  constructor(page) { this.page=page;this.context=null;this.mapping=null;this.guard=null;this.sent=false;this.blocked=''; }
  async installGuard() {
    this.page.on('request',request=>{
      if (request.method()==='POST' && new URL(request.url()).pathname==='/m-api/api/productMetric/secure/searchProductMetricData') {
        try { this.context={body:request.postDataJSON(),headers:Object.fromEntries(Object.entries(request.headers()).filter(([k])=>['authorization','industryid','tenantid','platform','content-type'].includes(k.toLowerCase())))}; } catch (_) {}
      }
    });
    await this.page.route('**/m-api/api/**',async route=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      if (!['POST','PUT','PATCH','DELETE'].includes(method)) return route.continue();
      if (/\/auditTrail\/secure/.test(url.pathname)) return route.abort(); // Approval is deliberately separate.
      if (!/\/productMetric\/secure/.test(url.pathname)) return route.continue();
      if (/\/searchProductMetricData$/.test(url.pathname) && method==='POST') return route.continue();
      if (url.origin===ORIGIN && url.pathname==='/m-api/api/productMetric/secure' && method==='POST' && this.guard && !this.sent) {
        let body;try {body=request.postDataJSON();}catch (_){}
        if (body && Core.allowCreate(this.guard,body,this.mapping)) {this.sent=true;return route.continue();}
      }
      this.blocked='IN-Gauge attempted a write that did not match the reviewed sale.';return route.abort();
    });
  }
  async login(email,password) {
    await this.page.goto(ORIGIN,{waitUntil:'domcontentloaded'});
    if(new URL(this.page.url()).origin!==ORIGIN)throw new ReviewRequired('The portal redirected outside the expected IN-Gauge origin. Sign-in needs review.');
    const emailBox=this.page.locator('#email');
    await emailBox.waitFor({state:'visible',timeout:30000}).catch(()=>{throw new ReviewRequired('The IN-Gauge sign-in page did not load. No sales were submitted.');});
    if (await emailBox.isVisible().catch(()=>false)) {
      if (!email || !password) throw new ReviewRequired('Configure INGAUGE_EMAIL and INGAUGE_PASS in GitHub Actions secrets first.');
      await emailBox.fill(email);
      if (!await this.page.locator('#password[type=password]').isVisible().catch(()=>false)) await this.page.locator('button.login-submit').click();
      await this.page.locator('#password[type=password]').waitFor({state:'visible',timeout:20000}).catch(()=>{throw new ReviewRequired('IN-Gauge requires interactive verification or a changed sign-in form. No sales were submitted.');});
      await this.page.locator('#password[type=password]').fill(password);await this.page.locator('button.login-submit').click();
    }
    await this.page.waitForFunction(()=>!document.querySelector('input#email') && !document.querySelector('input#password'),{},{timeout:30000}).catch(()=>{throw new ReviewRequired('IN-Gauge sign-in did not complete. Check the account or interactive verification.');});
  }
  async select(selector,label,scope=this.page) {
    const field=scope.locator(selector);
    await field.waitFor({state:'attached'});
    let options=[];
    for(let i=0;i<30;i++){
      options=await field.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent,recurring:n.getAttribute('data-isRecurring'),currency:n.getAttribute('data-currency'),retail:n.getAttribute('data-isRetail'),fnb:n.getAttribute('data-isFnB')})));
      if(options.some(o=>Core.nameKey(o.label)===Core.nameKey(label)))break;
      await this.page.waitForTimeout(300);
    }
    const matches=options.filter(o=>Core.nameKey(o.label)===Core.nameKey(label) && o.value && o.value!=='0' && o.value!=='-1');
    if(matches.length!==1) throw new ReviewRequired('The property, department, employee or product did not have one exact dropdown match.');
    const match=matches[0];await field.selectOption(match.value,{force:true});
    await field.evaluate((node,value)=>{if(window.jQuery)window.jQuery(node).trigger('change',[{selected:value}]);},match.value);
    await this.page.waitForTimeout(350);return match;
  }
  async open(property) {
    await this.page.goto(ORIGIN+'/metrics/productMetrics',{waitUntil:'domcontentloaded'});
    const location=await this.select('select#TenantLocation',property);
    await this.select('select#LocationGroup','Front Desk');
    for(let i=0;i<30&&!this.context;i++)await this.page.waitForTimeout(300);
    if(!this.context || String(this.context.body.tenantLocationId)!==location.value || this.context.body.isOperator!==false)throw new ReviewRequired('An account with access to all employee product records is required for the duplicate check.');
    const all=await this.page.locator('select#roleAuditStatus option').evaluateAll(nodes=>nodes.filter(n=>/^all(?:\s|$)/i.test(n.textContent.trim())).map(n=>n.value));
    if(all.length!==1)throw new ReviewRequired('Could not establish an all-status duplicate search.');
    this.allStatus=all[0];this.property=property;
  }
  async search(sale) {
    if(!this.context)throw new ReviewRequired('The live duplicate search is not connected.');
    const records=[];let total=null,first=0;
    for(let page=0;page<25;page++){
      const body={...this.context.body,searchKeyword:sale.conf,auditStatus:this.allStatus,sDate:'2000-01-01',eDate:'2099-12-31',first,total:200,isAllRecords:true,isManuallyAddedRecords:false,isAutoCorrectRecords:false,isAdjustedRecord:false};
      delete body.isBasicRateProduct;delete body.isNonBasicRateProduct;
      const response=await this.page.request.post(ORIGIN+'/m-api/api/productMetric/secure/searchProductMetricData?sortBy=updatedOn&orderBy=DESC',{data:body,headers:this.context.headers});
      if(!response.ok())throw new ReviewRequired('IN-Gauge duplicate search failed. No request will be added.');
      const data=await response.json(),parsed=Core.inspectSearch(data,sale.conf);
      if(Number(data.data.first)!==first)throw new ReviewRequired('IN-Gauge did not confirm the requested search page.');
      records.push(...parsed.rows);total=parsed.total;
      const received=data.data.data.length;first+=received;
      if(first>=total)return records;
      if(!received)throw new ReviewRequired('The duplicate search was incomplete.');
    }
    throw new ReviewRequired('The duplicate search exceeded its verified pagination limit.');
  }
  async fill(sale) {
    this.guard=null;this.sent=false;this.blocked='';
    await this.page.locator('a[title="Add"],button[title="Add"]').first().click();
    const form=this.page.locator('#fastAddModal');await form.waitFor({state:'visible'});
    const location=await this.select('select#TenantLocationSel',this.property,form);
    if(location.currency!=='AED')throw new ReviewRequired('The selected property currency is not verified as AED.');
    const group=await this.select('select#LocationGroupSel','Front Desk',form);
    if(group.retail==='true'||group.fnb==='true')throw new ReviewRequired('Retail or food-and-beverage form requires a separate quantity mapping.');
    const user=await this.select('select#User',sale.seller,form),product=await this.select('select#Product',sale.product,form);
    if(product.recurring!=='false')throw new ReviewRequired('This product is recurring or its charge-day setting is unknown. Review dates and quantity manually.');
    this.mapping={location:location.value,group:group.value,user:user.value,product:product.value};
    const fields={confirmationNumber:sale.conf,arrivalDate:sale.day,departureDate:sale.day,businessDate:sale.day,metricDate:sale.day,roomNights:'1',upsellCharge:(sale.cents/100).toFixed(2),roomNumber:sale.room,memo:'Opera journal '+sale.transaction+' · '+sale.note};
    for(const [key,value] of Object.entries(fields)){
      const field=form.locator('input#'+key+',textarea#'+key);
      if(!await field.count()) {if(['confirmationNumber','departureDate','upsellCharge'].includes(key))throw new ReviewRequired('A required form field is missing.');continue;}
      await field.first().evaluate((node,text)=>{const setter=Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(node,text);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));node.dispatchEvent(new Event('blur',{bubbles:true}));},value);
      const holder=form.locator('#'+key+'Holder');if(await holder.count())await holder.evaluate((node,text)=>{node.value=text;node.dispatchEvent(new Event('change',{bubbles:true}));},value);
    }
    await this.page.waitForTimeout(500);
    const actual=await form.locator('#upsellCharge').inputValue(),nights=await form.locator('#roomNights').inputValue(),total=await form.locator('#totalUpsellAmount').inputValue();
    if(Math.round(Number(actual)*100)!==sale.cents || Number(nights)!==1 || Math.round(Number(total)*100)!==sale.cents)throw new ReviewRequired('IN-Gauge calculated a different charge or number of days. Review this sale manually.');
    if(!await form.locator('button[type=submit]').isEnabled())throw new ReviewRequired('The form has validation errors or a locked date. Review it manually before submission.');
    return this.mapping;
  }
  async closeForm() {await this.page.goto(ORIGIN+'/metrics/productMetrics',{waitUntil:'domcontentloaded'});}
  async submit(sale) {
    this.guard=sale;
    const form=this.page.locator('#fastAddModal');await form.locator('button[type=submit]').click();
    const duplicate=this.page.locator('#updateExistingEvent,#createNewConfirmData');
    await this.page.waitForTimeout(500);
    if(await duplicate.first().isVisible().catch(()=>false))throw new ReviewRequired('IN-Gauge found an existing request; it was not overwritten or duplicated.');
    // Yes saves as Pending. Approve and Create New are never clicked.
    const yes=this.page.locator('#yesConfirmData');await yes.waitFor({state:'visible',timeout:10000});await yes.click();
    for(let i=0;i<40&&!this.sent&&!this.blocked;i++)await this.page.waitForTimeout(250);
    this.guard=null;
    if(this.blocked)throw new ReviewRequired(this.blocked);
    if(!this.sent)throw new ReviewRequired('The form did not send a verified Pending request. Check its validation messages.');
    await this.page.waitForTimeout(1200);
    const found=(await this.search(sale)).filter(record=>Core.recordMatches(sale,record));
    if(found.length!==1)throw new Error('Submission outcome is uncertain. Check IN-Gauge manually before any retry.');
    return {id:String(found[0].id),status:'PENDING'};
  }
}
module.exports={InGaugePortal,ReviewRequired,ORIGIN};
