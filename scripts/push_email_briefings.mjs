import fs from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const envPath = new URL('.env.local', ROOT);
const inputPath = new URL(process.argv[2] || '.email_briefings_input.json', ROOT);

function parseEnv(text){
  const out = {};
  for(const raw of text.split(/\r?\n/)){
    const line = raw.trim();
    if(!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if(i === -1) continue;
    out[line.slice(0,i).trim()] = line.slice(i+1).trim();
  }
  return out;
}

function required(env, key){
  const val = env[key];
  if(!val || val.startsWith('your-')) throw new Error(`Missing ${key} in .env.local`);
  return val;
}

function toFirestoreValue(value){
  if(value === null || value === undefined) return {nullValue:null};
  if(Array.isArray(value)) return {arrayValue:{values:value.map(toFirestoreValue)}};
  if(value instanceof Date) return {timestampValue:value.toISOString()};
  switch(typeof value){
    case 'string': return {stringValue:value};
    case 'boolean': return {booleanValue:value};
    case 'number':
      return Number.isInteger(value) ? {integerValue:String(value)} : {doubleValue:value};
    case 'object': {
      const fields = {};
      for(const [k,v] of Object.entries(value)) fields[k] = toFirestoreValue(v);
      return {mapValue:{fields}};
    }
    default:
      return {stringValue:String(value)};
  }
}

function normalizeBriefing(raw){
  const cleanItems = items => (Array.isArray(items) ? items : []).slice(0,5).map(item => ({
    from: String(item.from || '').slice(0,120),
    subject: String(item.subject || '').slice(0,240),
    snippet: String(item.snippet || '').replace(/\s+/g,' ').trim().slice(0,500),
    ts: String(item.ts || ''),
    url: String(item.url || ''),
    unread: !!item.unread,
    reason: String(item.reason || '').slice(0,140)
  }));

  return {
    gmail: {
      updatedAt: raw.gmail?.updatedAt || new Date().toISOString(),
      items: cleanItems(raw.gmail?.items)
    },
    outlook: {
      updatedAt: raw.outlook?.updatedAt || new Date().toISOString(),
      items: cleanItems(raw.outlook?.items)
    }
  };
}

async function main(){
  const env = parseEnv(await fs.readFile(envPath, 'utf8'));
  const apiKey = required(env, 'FIREBASE_API_KEY');
  const projectId = required(env, 'FIREBASE_PROJECT_ID');
  const uid = required(env, 'FIREBASE_UID');
  const email = required(env, 'FIREBASE_EMAIL');
  const password = required(env, 'FIREBASE_PASSWORD');
  const input = normalizeBriefing(JSON.parse(await fs.readFile(inputPath, 'utf8')));

  const authResp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email, password, returnSecureToken:true})
  });
  if(!authResp.ok) throw new Error(`Firebase Auth failed: ${authResp.status} ${await authResp.text()}`);
  const auth = await authResp.json();
  if(auth.localId !== uid) throw new Error(`Authenticated UID ${auth.localId} does not match configured UID ${uid}`);

  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/dashboard/state?updateMask.fieldPaths=data.emailBriefings&updateMask.fieldPaths=updatedAt`;
  const patchResp = await fetch(docUrl, {
    method:'PATCH',
    headers:{
      'Authorization': `Bearer ${auth.idToken}`,
      'Content-Type':'application/json'
    },
    body: JSON.stringify({
      fields:{
        data:{mapValue:{fields:{emailBriefings:toFirestoreValue(input)}}},
        updatedAt:{timestampValue:new Date().toISOString()}
      }
    })
  });
  if(!patchResp.ok) throw new Error(`Firestore update failed: ${patchResp.status} ${await patchResp.text()}`);
  console.log(`Updated emailBriefings: Gmail ${input.gmail.items.length}, Outlook ${input.outlook.items.length}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
