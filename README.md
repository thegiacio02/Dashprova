# Dashprova

Dashboard personale pubblicata su GitHub Pages, protetta con Firebase Authentication e sincronizzata con Cloud Firestore.

## File principali

- `dashboard_vita_giacomo.html`: dashboard statica servita da GitHub Pages.
- `firestore.rules`: regole Firestore da copiare/pubblicare nella Firebase Console.
- `dashboard_vita_giacomo.BACKUP.html`: backup storico della dashboard.

## Architettura

La dashboard resta un file statico compatibile con GitHub Pages, ma i dati personali non sono salvati nel repo. Dopo il login email/password con Firebase Auth, il file legge e scrive lo stato della dashboard in:

```text
users/{uid}/dashboard/state
```

Il documento contiene:

```json
{
  "data": {},
  "schemaVersion": 1,
  "updatedAt": "server timestamp"
}
```

Il salvataggio avviene su Firestore con debounce. Gli altri dispositivi ricevono gli aggiornamenti tramite listener realtime o dopo refresh.

## Configurazione Firebase

Nel file `dashboard_vita_giacomo.html`, sostituisci i placeholder:

```js
const FIREBASE_CONFIG = {
  apiKey: 'PASTE_FIREBASE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  appId: 'PASTE_FIREBASE_WEB_APP_ID'
};
const FIREBASE_ALLOWED_UID = 'PASTE_YOUR_FIREBASE_UID';
```

La config web Firebase non è una secret: identifica il progetto client. La sicurezza reale è data da Firebase Auth e dalle Firestore Security Rules. Non mettere password, API key private di servizi terzi, service account o token nel frontend.

## Setup passo passo

1. Crea il progetto Firebase
   - Vai su https://console.firebase.google.com/
   - Crea un nuovo progetto.
   - Aggiungi una Web App.
   - Copia `apiKey`, `authDomain`, `projectId` e `appId` nella costante `FIREBASE_CONFIG`.

2. Abilita Authentication
   - Vai in Authentication.
   - Apri Sign-in method.
   - Abilita Email/Password.
   - Crea manualmente il tuo utente da Authentication > Users.
   - Copia il tuo `UID` utente e inseriscilo in `FIREBASE_ALLOWED_UID`.

3. Crea Firestore
   - Vai in Firestore Database.
   - Crea il database in Production mode.
   - Scegli la location più vicina a te.

4. Pubblica le regole Firestore
   - Apri Firestore Database > Rules.
   - Copia il contenuto di `firestore.rules`.
   - Sostituisci `PASTE_YOUR_FIREBASE_UID` con il tuo UID reale.
   - Pubblica le regole.

5. Aggiungi GitHub Pages ai domini autorizzati
   - Vai in Authentication > Settings > Authorized domains.
   - Aggiungi:

```text
thegiacio02.github.io
```

6. Deploy su GitHub Pages
   - Commit e push dei file sul branch usato da GitHub Pages.
   - Apri:

```text
https://thegiacio02.github.io/Dashprova/dashboard_vita_giacomo.html
```

## Migrazione dati

La prima volta che accedi, se il documento Firestore non esiste, la dashboard crea uno stato vuoto con la struttura attuale. Per migrare dati vecchi:

1. Apri la vecchia versione o un backup.
2. Esporta i dati dalla sezione Dati.
3. Accedi alla nuova dashboard.
4. Importa il JSON dalla sezione Dati.
5. La dashboard salva lo stato importato su Firestore.

## Note di sicurezza

- La vecchia password nel frontend è stata rimossa.
- Il vecchio endpoint Realtime Database hardcoded non è più usato.
- I dati personali non devono essere aggiunti come file `.json` pubblici nel repo.
- Le regole incluse bloccano ogni documento fuori da `users/{uid}/...` e limitano accesso al solo UID configurato.
- La API key Gemini non è hardcoded e non viene salvata nel repo. Se la configuri dalla dashboard, viene salvata in Firestore nel documento `users/{uid}/private/settings`, leggibile solo dal tuo UID tramite le regole Firestore.
- Per ridurre il rischio di abuso, limita la API key Gemini in Google Cloud al dominio `thegiacio02.github.io` e, se usi la preview locale, anche a `localhost`.
