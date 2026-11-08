'use strict';
// Compact run metadata only. The live feed may be replaced by the next job;
// this per-tag record survives closing the browser and keeps the final outcome.
module.exports = function historyWriter({ patch, tag, kind, run = '', now = Date.now }) {
  if (!/^[\w-]{1,60}$/.test(tag)) throw new Error('Invalid history tag');
  let last = 0, chain = Promise.resolve(), ended = false;
  const record = { tag, kind, started: now(), ...(run ? { url: run } : {}) };
  return function publish(value) {
    if (ended) return chain;
    for (const key of ['state','step','n','done','prog','test','from','to','mode']) if (value[key] != null) record[key] = value[key];
    if (value.note != null) record.note = String(value.note).replace(/\S+@\S+/g,'•@•').replace(/\s+/g,' ').slice(0,140);
    if (value.tally) record.tally = Object.fromEntries(Object.entries(value.tally).filter(([k,v]) => /^[a-zA-Z_]+$/.test(k) && Number.isFinite(v)).map(([k,v]) => [k,v]));
    const terminal = ['done','error','stopped'].includes(record.state);
    const at = now();
    if (!terminal && last && at-last < 5000) return chain;
    last = at;
    if (terminal) { record.finishedAt = at; ended = true; }
    const payload = { ...record, at };
    chain = chain.catch(()=>{}).then(()=>patch('cloudRuns/'+tag,payload)).catch(()=>{});
    return chain;
  };
};
