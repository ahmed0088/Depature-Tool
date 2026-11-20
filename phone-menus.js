// Single-choice menus for phone browsers/webviews whose native select popup can fail.
// Original selects and their change handlers remain the source of truth.
(function(W,D){
  'use strict';
  const media=W.matchMedia('(max-width:760px), (pointer:coarse)'),records=new Map();let frame=0,active=null,overlay=null;
  const title=s=>s.getAttribute('aria-label')||[...(s.labels?.[0]?.childNodes||[])].filter(n=>n.nodeType===3||n.nodeType===1&&!/^(SELECT|BUTTON)$/.test(n.tagName)).map(n=>n.textContent).join(' ').trim().slice(0,90)||s.title||'Choose an option';
  const disabled=o=>o.disabled||o.parentElement?.tagName==='OPTGROUP'&&o.parentElement.disabled;
  const restore=(node,name,value)=>value===null?node.removeAttribute(name):node.setAttribute(name,value);
  function sync(){frame=0;
    for(const [s,r] of records){if(!s.isConnected){r.button.remove();records.delete(s);continue;}r.button.hidden=s.hidden||s.style.display==='none';r.button.disabled=s.disabled;
      const label=s.selectedOptions[0]?.textContent||'Choose…',caption=title(s);if(r.text.textContent!==label)r.text.textContent=label;r.button.setAttribute('aria-label',caption+': '+label);
      if(media.matches){s.setAttribute('aria-hidden','true');s.tabIndex=-1;}else{restore(s,'aria-hidden',r.aria);restore(s,'tabindex',r.tab);}
    }
    if(!media.matches)return;
    D.querySelectorAll('select:not([multiple]):not(.iga-native-select):not([data-native-menu])').forEach(s=>{
      if(records.has(s)||s.size>1||s.hidden||s.style.display==='none')return;
      const button=D.createElement('button'),text=D.createElement('span'),arrow=D.createElement('b');button.type='button';button.className='hosel-trigger';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');button.append(text,arrow);
      records.set(s,{button,text,aria:s.getAttribute('aria-hidden'),tab:s.getAttribute('tabindex')});s.classList.add('hosel-native');s.after(button);button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open(s,button);});
      text.textContent=s.selectedOptions[0]?.textContent||'Choose…';button.setAttribute('aria-label',title(s)+': '+text.textContent);button.disabled=s.disabled;s.setAttribute('aria-hidden','true');s.tabIndex=-1;
    });
  }
  function schedule(){if(!frame)frame=W.requestAnimationFrame(sync);}
  function close(){if(!active)return;const back=active.button;active=null;if(overlay)overlay.hidden=true;if(back?.isConnected){back.setAttribute('aria-expanded','false');back.focus({preventScroll:true});}}
  function viewport(){if(!overlay||overlay.hidden)return;overlay.style.height=(W.visualViewport?.height||W.innerHeight)+'px';overlay.style.top=(W.visualViewport?.offsetTop||0)+'px';}
  function rows(query=''){
    if(!active)return;const list=D.getElementById('hoselOptions');list.replaceChildren();let count=0;
    active.options.forEach((o,index)=>{if(disabled(o.node)||!o.label.toLowerCase().includes(query.toLowerCase()))return;const b=D.createElement('button');b.type='button';b.dataset.hoselIndex=String(index);b.setAttribute('role','option');b.setAttribute('aria-selected',String(o.node.selected));b.textContent=o.label+(o.node.selected?' ✓':'');list.appendChild(b);count++;});
    if(!count){const p=D.createElement('p');p.textContent='No matching options. Try another name.';list.appendChild(p);}
  }
  function choose(index){
    const state=active,option=state?.options[index],s=state?.source;if(!s||!option)return;
    if(!s.isConnected||s.disabled||disabled(option.node)||s.options[option.index]!==option.node||option.node.value!==option.value||option.node.textContent!==option.text){close();W.showToast?.('The choices changed. Open the menu again.','info');return;}
    const changed=s.selectedIndex!==option.index;close();if(!changed)return;
    s.selectedIndex=option.index;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));schedule();
  }
  function open(source,button){
    if(!source?.isConnected||source.disabled)return;close();
    if(!overlay){overlay=D.createElement('div');overlay.id='hoselOverlay';overlay.className='hosel-overlay';overlay.hidden=true;
      overlay.innerHTML='<section class="hosel-sheet" role="dialog" aria-modal="true" aria-labelledby="hoselTitle"><header><h2 id="hoselTitle"></h2><button type="button" data-hosel-close aria-label="Close menu">×</button></header><label class="hosel-search">Search<input id="hoselSearch" type="search" autocomplete="off" placeholder="Type a name…"></label><div id="hoselOptions" role="listbox" aria-labelledby="hoselTitle"></div></section>';D.body.appendChild(overlay);
      overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-hosel-close]'))close();else{const b=e.target.closest('[data-hosel-index]');if(b)choose(Number(b.dataset.hoselIndex));}});
      overlay.addEventListener('input',e=>{if(e.target.id==='hoselSearch')rows(e.target.value);});
      overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.key==='Tab'){const nodes=[...overlay.querySelectorAll('button,input')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&D.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&D.activeElement===last){e.preventDefault();first?.focus();}}else if(['ArrowDown','ArrowUp'].includes(e.key)&&e.target.id!=='hoselSearch'){const nodes=[...overlay.querySelectorAll('[data-hosel-index]')];if(!nodes.length)return;e.preventDefault();const i=nodes.indexOf(D.activeElement);nodes[(i+(e.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length].focus();}});
    }
    active={source,button,options:[...source.options].map((node,index)=>({node,index,value:node.value,text:node.textContent,label:(node.parentElement?.tagName==='OPTGROUP'?node.parentElement.label+' · ':'')+node.textContent})).filter(o=>!disabled(o.node)&&o.text.trim())};
    D.getElementById('hoselTitle').textContent=title(source);D.getElementById('hoselSearch').value='';overlay.hidden=false;button?.setAttribute('aria-expanded','true');rows();viewport();overlay.querySelector('[data-hosel-close]').focus({preventScroll:true});
  }
  const css=`.hosel-trigger{display:none}.hosel-overlay[hidden]{display:none!important}.hosel-overlay{position:fixed;left:0;right:0;top:0;height:100dvh;box-sizing:border-box;z-index:2147483000;background:#080d18a8;display:flex;align-items:center;justify-content:center;padding:12px;color:var(--text,#202535)}.hosel-sheet{display:flex;flex-direction:column;box-sizing:border-box;width:min(540px,100%);max-height:100%;background:var(--card,#fff);border:1px solid var(--border,#ccc);border-radius:18px;overflow:hidden;box-shadow:0 24px 90px #0006}.hosel-sheet header{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:16px;border-bottom:1px solid var(--border,#ccc);flex:none}.hosel-sheet h2{margin:0;font:700 18px var(--font,system-ui);overflow-wrap:anywhere}.hosel-sheet button{-webkit-tap-highlight-color:transparent;touch-action:manipulation;cursor:pointer;color:var(--text,#202535);background:var(--card,#fff);font:inherit}.hosel-sheet header button{min-width:44px;min-height:44px;border:1px solid var(--border,#ccc);border-radius:50%;font-size:24px;flex:none}.hosel-search{display:grid;gap:7px;padding:14px 16px;font:600 13px var(--font,system-ui);flex:none}.hosel-search input{box-sizing:border-box;min-width:0;width:100%;min-height:46px;border:1px solid var(--border,#ccc);border-radius:10px;background:var(--bg2,#f0f2f5);color:var(--text,#202535);font:inherit;font-size:16px;padding:10px 12px}#hoselOptions{overflow:auto;min-height:0;overscroll-behavior:contain;padding:0 10px 12px}#hoselOptions button{display:block;width:100%;text-align:left;min-height:48px;white-space:normal;overflow-wrap:anywhere;padding:12px;border:1px solid var(--border,#ccc);border-radius:10px;margin:6px 0}#hoselOptions button[aria-selected=true]{border-color:var(--accent,#5865f2);background:var(--accent-bg,#e8ecff)}.hosel-sheet :focus-visible{outline:2px solid var(--accent,#5865f2);outline-offset:2px}@media(max-width:760px),(pointer:coarse){select.hosel-native{position:absolute!important;width:1px!important;height:1px!important;min-height:0!important;opacity:0!important;pointer-events:none!important;clip-path:inset(50%)!important}button.hosel-trigger{-webkit-tap-highlight-color:transparent;display:flex;box-sizing:border-box;align-items:center;justify-content:space-between;gap:10px;width:100%;max-width:100%;min-width:0;min-height:46px;padding:10px 12px;text-align:left;white-space:normal;overflow-wrap:anywhere;border:1px solid var(--border2,var(--border,#ccc));border-radius:10px;background:var(--card,#fff);color:var(--text,#202535);font:inherit;font-size:16px;touch-action:manipulation;cursor:pointer}button.hosel-trigger span{min-width:0}button.hosel-trigger b{flex:none}button.hosel-trigger:disabled{opacity:.55;cursor:default}button.hosel-trigger[hidden]{display:none!important}}@media print{.hosel-trigger,.hosel-overlay{display:none!important}select.hosel-native{position:static!important;width:auto!important;height:auto!important;opacity:1!important;clip-path:none!important}}`;
  function start(){const style=D.createElement('style');style.id='hoselStyle';style.textContent=css;D.head.appendChild(style);sync();
    new MutationObserver(changes=>{if(changes.some(r=>r.type==='attributes'&&/^(SELECT|OPTION|OPTGROUP)$/.test(r.target.tagName)||r.type==='characterData'&&r.target.parentElement?.closest('select')||r.type==='childList'&&[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.('select,option,optgroup')||n.querySelector?.('select')))))schedule();}).observe(D.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','selected','label','style']});
    D.addEventListener('change',schedule,true);D.addEventListener('input',e=>{if(!overlay?.contains(e.target))schedule();},true);const changed=()=>{close();schedule();};if(media.addEventListener)media.addEventListener('change',changed);else media.addListener?.(changed);W.visualViewport?.addEventListener('resize',viewport);W.visualViewport?.addEventListener('scroll',viewport);
  }
  W.HotelOpsPhoneMenus={refresh:schedule,open};if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window,document);
