/**
 * Google Apps Script - Calendar → Firestore sync
 *
 * Legge gli eventi del tuo Google Calendar (default + secondari) per i prossimi
 * N giorni e li pusha sul documento Firestore della dashboard:
 *   users/{FIREBASE_UID}/dashboard/state, campo data.calendarBriefing
 *
 * Funzionalità:
 *   - pushCalendar()  : funzione richiamabile da time trigger ogni 30 min
 *   - doGet(e)        : endpoint Web App per refresh on-demand dalla dashboard
 *                       (richiede ?token=... che corrisponde a SYNC_TOKEN)
 *
 * Setup:
 *   1. Vai su https://script.google.com → New project
 *   2. Incolla questo file in Code.gs
 *   3. Project Settings → Script properties → aggiungi:
 *        FIREBASE_API_KEY      = ...
 *        FIREBASE_PROJECT_ID   = ...
 *        FIREBASE_UID          = ...
 *        FIREBASE_EMAIL        = ...
 *        FIREBASE_PASSWORD     = ...
 *        SYNC_TOKEN            = stringa random (es. uuid)
 *        CALENDAR_DAYS         = 7   (opzionale, default 7)
 *   4. Crea time trigger: clock icon → Add Trigger
 *        funzione: pushCalendar | event: Time-driven | Minutes timer | every 30 min
 *   5. (opzionale) Deploy → New deployment → tipo "Web app"
 *        - Execute as: Me
 *        - Who has access: Anyone
 *        - Copia l'URL e incollalo nella dashboard (impostazioni calendario)
 */

const SCRIPT_VERSION = '1.0.0';

function getProps_() {
  const p = PropertiesService.getScriptProperties();
  const required = ['FIREBASE_API_KEY','FIREBASE_PROJECT_ID','FIREBASE_UID','FIREBASE_EMAIL','FIREBASE_PASSWORD','SYNC_TOKEN'];
  const out = {};
  for (const k of required) {
    const v = p.getProperty(k);
    if (!v) throw new Error('Missing script property: ' + k);
    out[k] = v;
  }
  out.CALENDAR_DAYS = parseInt(p.getProperty('CALENDAR_DAYS') || '7', 10);
  return out;
}

function fetchFirebaseIdToken_(props) {
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(props.FIREBASE_API_KEY);
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      email: props.FIREBASE_EMAIL,
      password: props.FIREBASE_PASSWORD,
      returnSecureToken: true
    })
  });
  const code = resp.getResponseCode();
  if (code !== 200) throw new Error('Firebase auth failed ' + code + ': ' + resp.getContentText().slice(0,200));
  const body = JSON.parse(resp.getContentText());
  if (body.localId !== props.FIREBASE_UID) throw new Error('UID mismatch: ' + body.localId);
  return body.idToken;
}

function collectCalendarEvents_(days) {
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date(start.getTime() + days*24*60*60*1000);
  const calendars = CalendarApp.getAllCalendars();
  const events = [];
  for (const cal of calendars) {
    let items;
    try { items = cal.getEvents(start, end); } catch (e) { continue; }
    for (const ev of items) {
      try {
        events.push({
          id: ev.getId(),
          title: ev.getTitle() || '',
          start: ev.getStartTime().toISOString(),
          end: ev.getEndTime().toISOString(),
          allDay: ev.isAllDayEvent(),
          location: ev.getLocation() || '',
          calendar: cal.getName() || '',
          url: '',
          status: (ev.getMyStatus && ev.getMyStatus()) ? String(ev.getMyStatus()) : '',
          description: (ev.getDescription() || '').slice(0,500)
        });
      } catch (e) { /* skip broken event */ }
    }
  }
  events.sort((a,b) => a.start.localeCompare(b.start));
  return {
    events: events.slice(0,40),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function toFirestoreValue_(value) {
  if (value === null || value === undefined) return {nullValue: null};
  if (Array.isArray(value)) return {arrayValue: {values: value.map(toFirestoreValue_)}};
  if (value instanceof Date) return {timestampValue: value.toISOString()};
  switch (typeof value) {
    case 'string': return {stringValue: value};
    case 'boolean': return {booleanValue: value};
    case 'number':
      return Number.isInteger(value) ? {integerValue: String(value)} : {doubleValue: value};
    case 'object': {
      const fields = {};
      for (const k of Object.keys(value)) fields[k] = toFirestoreValue_(value[k]);
      return {mapValue: {fields}};
    }
    default: return {stringValue: String(value)};
  }
}

function pushToFirestore_(props, idToken, payload) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + props.FIREBASE_PROJECT_ID +
              '/databases/(default)/documents/users/' + props.FIREBASE_UID + '/dashboard/state' +
              '?updateMask.fieldPaths=data.calendarBriefing&updateMask.fieldPaths=updatedAt';
  const body = {
    fields: {
      data: {mapValue: {fields: {calendarBriefing: toFirestoreValue_(payload)}}},
      updatedAt: {timestampValue: new Date().toISOString()}
    }
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + idToken},
    payload: JSON.stringify(body)
  });
  const code = resp.getResponseCode();
  if (code !== 200) throw new Error('Firestore patch failed ' + code + ': ' + resp.getContentText().slice(0,300));
  return code;
}

/** Entry point: chiamato dal time trigger e dal doGet */
function pushCalendar() {
  const props = getProps_();
  const idToken = fetchFirebaseIdToken_(props);
  const payload = collectCalendarEvents_(props.CALENDAR_DAYS);
  pushToFirestore_(props, idToken, payload);
  console.log('Pushed ' + payload.events.length + ' events');
  return payload.events.length;
}

/** Web App endpoint per refresh on-demand */
function doGet(e) {
  try {
    const props = getProps_();
    const token = (e && e.parameter && e.parameter.token) || '';
    if (token !== props.SYNC_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ok:false, error:'unauthorized'})).setMimeType(ContentService.MimeType.JSON);
    }
    const n = pushCalendar();
    return ContentService.createTextOutput(JSON.stringify({ok:true, events:n, version:SCRIPT_VERSION})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:String(err && err.message || err)})).setMimeType(ContentService.MimeType.JSON);
  }
}
