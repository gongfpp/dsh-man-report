import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
const root = new URL('../assets/voices/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))
assert.equal(manifest.id,'kobe-doubao-offline-v1');assert.equal(manifest.provider,'doubao');assert.equal(manifest.runtime,undefined)
assert.equal(manifest.exactOnly,false);assert.equal(Object.keys(manifest.clips).length,65);assert.equal(manifest.phrases.length,20)
assert.equal(new Set(manifest.phrases.map(p=>p.id)).size,20)
const { phrases: expectedPhrases } = await import('./generate-doubao-phrases-v3.mjs')
assert.deepEqual(manifest.phrases, expectedPhrases)
const wholeRows = Object.values(manifest.wholeSamples ?? {}).flatMap(byPhrase => Object.values(byPhrase ?? {}))
for(const row of [...Object.values(manifest.clips),...Object.values(manifest.amounts),...wholeRows]){
  assert.match(row.file,/^(clips|amounts)\/[A-Za-z0-9][A-Za-z0-9-]*(?:\.\d+)?\.(mp3|wav)$/)
  const b=readFileSync(new URL(row.file,root));assert.equal(createHash('sha256').update(b).digest('hex'),row.sha256)
  if(row.file.endsWith('.wav')){assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE')}
  else assert.ok(b[0]===0xff||b.toString('ascii',0,3)==='ID3','MP3 container')
}
assert.deepEqual(manifest.amounts,{},'the retired 0.31 whole sample is gone; wholeSamples covers the common amounts')
// Whole-sentence takes: one continuous recording per phrase and amount, never shared.
const wholeSamples = manifest.wholeSamples ?? {}
const WHOLE_AMOUNTS=['0.01','0.02','0.03','0.05','0.08','0.1','0.2','0.3','0.5','1']
assert.deepEqual(Object.keys(wholeSamples).sort(), ['CNY','USD'].flatMap(currency=>WHOLE_AMOUNTS.map(amount=>currency+':'+amount)).sort())
for(const [key,byPhrase] of Object.entries(wholeSamples)){
  const phraseIds = manifest.phrases.map(p=>p.id).sort()
  assert.deepEqual(Object.keys(byPhrase).sort(),phraseIds,key+' must cover every template')
  const hashes = new Set()
  for(const [phraseId,row] of Object.entries(byPhrase)){
    assert.equal(row.phraseId,phraseId)
    assert.equal(row.fullUtterance,true)
    assert.match(row.file,/^amounts\/[A-Za-z0-9][A-Za-z0-9-]*\.mp3$/)
    hashes.add(row.sha256)
  }
  assert.equal(hashes.size,manifest.phrases.length,key+' must not reuse one take across templates')
}
assert.equal(manifest.units.CNY,'unit-yuan')
assert.equal(manifest.clips['unit-yuan'].file,'clips/unit-yuan-t2.wav')
assert.equal(manifest.clips['unit-yuan'].sha256,'bb2bb8ddeaba18e585cb676d96287a13b682bbef73bc27892bcd257166829ce1')
assert.equal(manifest.clips['unit-yuan'].duration,.68)
assert.equal(manifest.clips['unit-yuan'].humanListeningVerified,false)
assert.equal(manifest.clips['unit-yuan'].asrVerified,false)
// Four emotion tiers: every spoken clip exists in each tier with its own file and hash.
const tierKeys=Object.keys(manifest.tierOverrides??{})
assert.deepEqual(tierKeys.sort(),['t1','t3','t4'])
const spokenKeys=Object.keys(manifest.clips)
assert.equal(spokenKeys.length,65)
assert.deepEqual(manifest.tierBands.money.map(b=>b.tier),['t1','t2','t3','t4'])
assert.deepEqual(manifest.tierBands.tokens.map(b=>b.tier),['t1','t2','t3','t4'])
for(const tier of tierKeys){
  assert.equal(Object.keys(manifest.tierOverrides[tier]).length,65)
  for(const key of spokenKeys){
    const row=manifest.tierOverrides[tier][key]
    assert.ok(row,'missing '+tier+'/'+key)
    assert.match(row.file,new RegExp('^clips/'+key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-'+tier+'\\.wav$'))
    assert.ok(row.duration>0&&row.duration<12)
    assert.equal(createHash('sha256').update(readFileSync(new URL(row.file,root))).digest('hex'),row.sha256)
  }
}
for(const key of spokenKeys){
  const hashes=new Set(['t1','t2','t3','t4'].map(t=>t==='t2'?manifest.clips[key].sha256:manifest.tierOverrides[t][key].sha256))
  assert.equal(hashes.size,4,'tiers must not reuse the same recording: '+key)
}
let api
const window={test:v=>api=v,__ModuleLoader__:{load:({factory})=>factory(()=>({}))}}
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
vm.runInNewContext(client.replace("  return { name: 'man-report'","  window.test({ getAudioPlan, numberTokens, displayAmount, billingAmount }); return { name: 'man-report'"),{window,Date})
const tierFor=(value,bands)=>{for(const band of bands){if(band.below===undefined||value<band.below)return band.tier}throw Error('no tier')}
const fileFor=(key,tier)=>tier==='t2'?manifest.clips[key].file:manifest.tierOverrides[tier][key].file
for(const [input,expected] of [[.000749,'0.01'],[.3105,'0.32'],[.31004,'0.32'],[1.2345,'1.24'],[9.9995,'10.00'],[.29,'0.29'],[0,'0.00'],[1e-12,'0.00'],[.01,'0.01'],[1,'1.00'],[1.27,'1.27'],[.1+.2,'0.30']])assert.equal(api.billingAmount(input),expected)
const coveredWhole=(currency,amount,phraseId)=>{
  const row=manifest.wholeSamples?.[`${currency}:${String(Number(api.billingAmount(amount)))}`]?.[phraseId]
  return row?['/api/man-report/voices/'+row.file]:null
}
let wholeHits=0,spliceHits=0
for(const p of manifest.phrases)for(const currency of ['CNY','USD'])for(const amount of [0,.000749,.005,.01,.02,.03,.05,.08,.1,.2,.3,.3105,.5,1,1.27,9.999,10,21.003,101,1001,1000001,999999999999]){
  const files=Array.from(api.getAudioPlan(manifest,amount,currency,undefined,p.id))
  const whole=coveredWhole(currency,amount,p.id)
  if(whole){wholeHits++;assert.deepEqual(files,whole,'whole take for '+amount+' '+currency+' '+p.id);continue}
  spliceHits++
  const unitKey=currency==='CNY'?manifest.units.CNY:api.billingAmount(amount)==='1.00'?manifest.units.USD_SINGULAR:manifest.units.USD
  const tier=tierFor(Number(api.billingAmount(amount)),manifest.tierBands.money)
  const keys=[p.prefix,...api.numberTokens(amount),unitKey,...(p.suffix!==undefined?[p.suffix]:[])]
  assert.deepEqual(files,keys.map(key=>'/api/man-report/voices/'+fileFor(key,tier)),'tier '+tier+' for '+amount+' '+currency+' '+p.id)
  assert.ok(!files.some(path=>path.includes('/amounts/')),'a different whole sentence must never replace a selected template')
  assert.equal(files.filter(path=>path.endsWith('/'+fileFor(unitKey,tier))).length,1)
}
assert.ok(wholeHits>=400,'whole takes must be reachable for the covered amounts: '+wholeHits)
assert.ok(spliceHits>0,'uncovered amounts must keep the spliced bank')
assert.equal(manifest.tokenPhrases.length,4)
for(const phrase of manifest.tokenPhrases)for(const amount of [0,1,999,1000,1234,9999,10000,999999999999]){
 const files=Array.from(api.getAudioPlan(manifest,amount,'CNY',undefined,phrase.id,'tokens'))
 const tier=tierFor(amount,manifest.tierBands.tokens)
 const unitKey=amount===1?'unit-token':'unit-tokens'
 const keys=[phrase.prefix,...api.numberTokens(amount),unitKey,...(phrase.suffix!==undefined?[phrase.suffix]:[])]
 assert.deepEqual(files,keys.map(key=>'/api/man-report/voices/'+fileFor(key,tier)),'token tier '+tier+' for '+amount)
 assert.ok(!files.some(p=>p.includes('/amounts/')||/unit-(yuan|dollar)/.test(p)))
}
assert.deepEqual(Array.from(api.numberTokens(.000749)),['0','dot','0','1'])
assert.deepEqual(Array.from(api.numberTokens(.3105)),['0','dot','3','2'])
assert.deepEqual(Array.from(api.numberTokens(9.9995)),['10'])
for(const path of ['../index.js','../client.js']){
 const text=readFileSync(new URL(path,import.meta.url),'utf8');for(const forbidden of ['openspeech.bytedance.com','voice/resolve','voice/configure','manReport_voice_prepare','豆包连接'])assert.equal(text.includes(forbidden),false)
}
console.log('offline audio: passed (65 hashed clips, 4 emotion tiers x 65 re-recorded clips, 400 whole-sentence takes across 10 amounts x 20 templates x 2 currencies; captions and speech share two-decimal ceiling; no runtime provider/key/tool)')
