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
 *        CALENDAR_DAYS         = 7    (opzionale, default 7)
 *        WORK_CALENDAR_IDS     = ...  (opzionale: ID calendario lavoro condiviso,
 *                                       separati da virgola. Es. "abc@group.calendar.google.com")
 *        WORK_DAYS_AHEAD       = 60   (opzionale, default 60. Quanti gg in avanti
 *                                       guardare per i tour lavoro. Indietro: sempre 30gg)
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
  out.WORK_CALENDAR_IDS = (p.getProperty('WORK_CALENDAR_IDS') || '').split(',').map(s => s.trim()).filter(Boolean);
  out.WORK_DAYS_AHEAD = parseInt(p.getProperty('WORK_DAYS_AHEAD') || '60', 10);
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

function eventHtmlLink_(eventId, calendarId) {
  // Google Calendar event URL format: ?eid=base64url(eventId + ' ' + calendarId)
  try {
    const rawId = String(eventId || '').split('@')[0];
    const cal = String(calendarId || '');
    const raw = rawId + ' ' + cal;
    const b64 = Utilities.base64EncodeWebSafe(raw).replace(/=+$/,'');
    return 'https://calendar.google.com/calendar/event?eid=' + b64;
  } catch (e) { return ''; }
}

function collectCalendarEvents_(days, excludeCalendarIds) {
  excludeCalendarIds = excludeCalendarIds || [];
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date(start.getTime() + days*24*60*60*1000);
  const calendars = CalendarApp.getAllCalendars();
  const events = [];
  for (const cal of calendars) {
    const calId = cal.getId();
    if (excludeCalendarIds.indexOf(calId) !== -1) continue;
    let items;
    try { items = cal.getEvents(start, end); } catch (e) { continue; }
    for (const ev of items) {
      try {
        const evId = ev.getId();
        events.push({
          id: evId,
          calendarId: calId,
          title: ev.getTitle() || '',
          start: ev.getStartTime().toISOString(),
          end: ev.getEndTime().toISOString(),
          allDay: ev.isAllDayEvent(),
          location: ev.getLocation() || '',
          calendar: cal.getName() || '',
          url: eventHtmlLink_(evId, calId),
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

function collectWorkTours_(workCalendarIds, daysAhead) {
  // Finestra: ultimi 30gg → +daysAhead. Vogliamo vedere tour creati di recente,
  // anche se la data del tour è nel passato o nel futuro.
  const lookBack = 30;
  const now = new Date();
  const start = new Date(now.getTime() - lookBack * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const events = [];
  for (const calId of workCalendarIds) {
    let cal;
    try { cal = CalendarApp.getCalendarById(calId); } catch (e) { continue; }
    if (!cal) continue;
    let items;
    try { items = cal.getEvents(start, end); } catch (e) { continue; }
    for (const ev of items) {
      try {
        const evId = ev.getId();
        const created = ev.getDateCreated();
        const updated = ev.getLastUpdated();
        const creators = (ev.getCreators && ev.getCreators()) || [];
        events.push({
          id: evId,
          calendarId: calId,
          calendar: cal.getName() || '',
          title: ev.getTitle() || '',
          start: ev.getStartTime().toISOString(),
          end: ev.getEndTime().toISOString(),
          allDay: ev.isAllDayEvent(),
          location: ev.getLocation() || '',
          description: (ev.getDescription() || '').slice(0, 500),
          createdAt: created ? created.toISOString() : '',
          updatedAt: updated ? updated.toISOString() : '',
          creator: creators[0] || '',
          url: eventHtmlLink_(evId, calId)
        });
      } catch (e) { /* skip broken event */ }
    }
  }
  events.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return {
    events: events.slice(0, 200),
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

function pushToFirestore_(props, idToken, fields) {
  // fields = {calendarBriefing?: payload, workTours?: payload}
  const dataFields = {};
  const masks = ['updatedAt'];
  if (fields.calendarBriefing) {
    dataFields.calendarBriefing = toFirestoreValue_(fields.calendarBriefing);
    masks.push('data.calendarBriefing');
  }
  if (fields.workTours) {
    dataFields.workTours = toFirestoreValue_(fields.workTours);
    masks.push('data.workTours');
  }
  const url = 'https://firestore.googleapis.com/v1/projects/' + props.FIREBASE_PROJECT_ID +
              '/databases/(default)/documents/users/' + props.FIREBASE_UID + '/dashboard/state' +
              '?' + masks.map(m => 'updateMask.fieldPaths=' + encodeURIComponent(m)).join('&');
  const body = {
    fields: {
      data: {mapValue: {fields: dataFields}},
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
  const personal = collectCalendarEvents_(props.CALENDAR_DAYS, props.WORK_CALENDAR_IDS);
  const fields = {calendarBriefing: personal};
  let workCount = 0;
  if (props.WORK_CALENDAR_IDS.length) {
    const work = collectWorkTours_(props.WORK_CALENDAR_IDS, props.WORK_DAYS_AHEAD);
    fields.workTours = work;
    workCount = work.events.length;
  }
  pushToFirestore_(props, idToken, fields);
  console.log('Pushed personal=' + personal.events.length + ' workTours=' + workCount);
  return personal.events.length;
}

/** Web App endpoint per CREARE eventi (POST JSON) */
function doPost(e) {
  try {
    const props = getProps_();
    let body = {};
    try { body = JSON.parse(e.postData.contents || '{}'); } catch (er) {}
    if ((body.token || '') !== props.SYNC_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ok:false, error:'unauthorized'})).setMimeType(ContentService.MimeType.JSON);
    }
    const action = body.action || 'create';

    if (action === 'update') {
      const eventId = String(body.eventId || '').trim();
      if (!eventId) throw new Error('Missing eventId');
      const newStart = new Date(String(body.start || ''));
      const newEnd   = new Date(String(body.end   || ''));
      if (isNaN(newStart)) throw new Error('Invalid start');
      if (isNaN(newEnd))   throw new Error('Invalid end');
      // Find event across all calendars
      const calendarId = String(body.calendarId || '').trim();
      let ev = null;
      if (calendarId) {
        const cal = CalendarApp.getCalendarById(calendarId);
        if (cal) ev = cal.getEventById(eventId);
      }
      if (!ev) {
        // fallback: search all calendars
        for (const cal of CalendarApp.getAllCalendars()) {
          ev = cal.getEventById(eventId);
          if (ev) break;
        }
      }
      if (!ev) throw new Error('Event not found: ' + eventId);
      ev.setTime(newStart, newEnd);
      const idToken = fetchFirebaseIdToken_(props);
      const payload = collectCalendarEvents_(props.CALENDAR_DAYS, props.WORK_CALENDAR_IDS);
      pushToFirestore_(props, idToken, {calendarBriefing: payload});
      return ContentService.createTextOutput(JSON.stringify({ok:true, events:payload.events.length})).setMimeType(ContentService.MimeType.JSON);
    }

    if (action !== 'create') {
      return ContentService.createTextOutput(JSON.stringify({ok:false, error:'unsupported action'})).setMimeType(ContentService.MimeType.JSON);
    }

    const title = String(body.title || '').trim();
    if (!title) throw new Error('Missing title');
    const startISO = String(body.start || '').trim();
    if (!startISO) throw new Error('Missing start');
    const start = new Date(startISO);
    if (isNaN(start)) throw new Error('Invalid start');
    const endISO = String(body.end || '').trim();
    const end = endISO ? new Date(endISO) : new Date(start.getTime() + 60*60*1000);
    if (isNaN(end)) throw new Error('Invalid end');

    const calendarId = String(body.calendarId || '').trim();
    const cal = calendarId ? CalendarApp.getCalendarById(calendarId) : CalendarApp.getDefaultCalendar();
    if (!cal) throw new Error('Calendar not found');

    const options = {};
    if (body.location) options.location = String(body.location);
    if (body.description) options.description = String(body.description);

    let created;
    if (body.allDay) {
      created = cal.createAllDayEvent(title, start, options);
    } else {
      created = cal.createEvent(title, start, end, options);
    }

    const idToken = fetchFirebaseIdToken_(props);
    const payload = collectCalendarEvents_(props.CALENDAR_DAYS);
    pushToFirestore_(props, idToken, payload);

    return ContentService.createTextOutput(JSON.stringify({
      ok:true,
      eventId: created.getId(),
      url: eventHtmlLink_(created.getId(), cal.getId()),
      events: payload.events.length
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:String(err && err.message || err)})).setMimeType(ContentService.MimeType.JSON);
  }
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
