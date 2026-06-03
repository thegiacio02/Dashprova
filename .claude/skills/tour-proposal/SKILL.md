---
name: tour-proposal
description: >
  Genera una proposta di tour Como On Boat come pagina web scrollabile, animata
  e d'impatto (un singolo file HTML auto-contenuto, pronto da inviare al
  cliente). Usala quando l'utente descrive un tour ("crea la presentazione per
  il tour X", "fammi la proposta per...", "tour proposal", "presentazione per il
  cliente") fornendo destinazioni/tappe, barca, durata, prezzo, servizi extra.
---

# Como On Boat — Tour Proposal

Trasforma la descrizione a voce libera di un tour in una **presentazione web
scrollabile e animata**, fedele all'identità visiva di Como On Boat. L'output è
**un solo file HTML auto-contenuto** (immagini incorporate in base64) che
l'utente può aprire nel browser o allegare in email/WhatsApp e inviare al
cliente.

## Come funziona (workflow)

1. **Raccogli i contenuti** dalla descrizione dell'utente. Se manca un dato
   essenziale (prezzo, durata, tappe principali), chiedi solo quello — il resto
   inferiscilo con buon senso dal contesto Lake Como.
2. **Scrivi un file dati JSON** in `esempi/<slug>.json` (schema sotto). Mappa
   ogni tappa/sezione alle immagini della libreria (vedi inventario).
3. **Genera** la pagina:
   ```bash
   python3 .claude/skills/tour-proposal/build.py .claude/skills/tour-proposal/esempi/<slug>.json
   ```
   L'output va in `proposte/<slug>.html` con le immagini incorporate.
4. **Consegna** il file all'utente (mostralo/allegalo). Le animazioni si vedono
   solo aprendo il file nel browser, non in uno screenshot statico.
5. Se l'utente vuole un file più leggero da gestire come progetto, usa
   `--no-embed` (collega le immagini invece di incorporarle; serve la cartella
   `assets/`).

## Cosa produce la pagina

- **Hero** a tutto schermo con foto di copertina, zoom lento "Ken Burns",
  titolo serif in dissolvenza, parallasse allo scroll, indicatore di scroll.
- **Sezione esperienza** con intro + "chip" (partenza, ritorno, durata, ospiti).
- **Itinerario** come timeline verticale che si rivela allo scroll.
- **Highlight** a piena larghezza alternati dx/sx, con gallerie e card in
  reveal, numerati (01, 02, ...).
- **La barca** con galleria a griglia.
- **Servizi extra** in card.
- **Prezzo** con conteggio animato che sale fino al totale + lista "incluso".
- **Footer/CTA** con contatti e logo.
- Barra di avanzamento in cima, topbar che compare allo scroll.
- Rispetta `prefers-reduced-motion`; responsive mobile.

## Brand system (già nel template)

- Sfondo navy `#152038` (variante `#0f1830`, `#1c2c4d`).
- Oro `#c9a24b` / `#e3c987` come accento.
- Display **serif** elegante: Cormorant Garamond. Testo **sans**: Poppins
  (entrambi da Google Fonts, con fallback di sistema).
- Foto con angoli arrotondati, micro-zoom all'hover.

Non cambiare la palette/i font senza che l'utente lo chieda: sono ricavati
dalla presentazione Canva originale di Como On Boat.

## Schema JSON dei contenuti

```jsonc
{
  "slug": "nome-file-senza-spazi",        // opzionale, default dal titolo
  "title": "Hidden Gems of Lake Como",    // titolo grande hero
  "subtitle": "6 Hours Private Tour Proposal",
  "date": "1 June 2026",
  "location": "Como",
  "cover_image": "cover-lake-boat",       // chiave libreria o path
  "intro_title": "An elegant day on the water",
  "intro": "Paragrafo introduttivo...",
  "schedule": { "departure": "Como · 11:00", "return": "Como · 17:00",
                "duration": "6 hours", "guests": "Private · 1 boat" },
  "itinerary": ["Tappa 1", "Tappa 2", "..."],   // timeline (testo)
  "highlights": [
    { "name": "Villa Pliniana", "tagline": "Tour Highlight",
      "desc": "Descrizione...", "images": ["villa-pliniana-1","villa-pliniana-2"] }
  ],
  "boat": { "name": "Gozzo Sorrentino", "desc": "...",
            "images": ["boat-7","boat-2","boat-3"] },
  "extras": [ { "title": "Photographer", "desc": "4 hours · 40 pictures",
                "image": "extra-3" } ],
  "included": ["English Speaking Captain", "Fuel", "Insurance", "Tax"],
  "pricing": { "label": "One exclusive boat, all inclusive",
               "base": 1850, "extras_total": 590, "total": 2440,
               "currency": "€", "note": "6 hours" },
  "contacts": { "email": "info@comoonboat.com", "ig": "@comoonboat",
                "phone": "+39 351 363 0708" }
}
```

Note:
- `highlights[].images`: 1, 2 o 3 immagini (la prima diventa larga se sono 3).
- `pricing`: se ci sono `base` + `extras_total` mostra il breakdown "1850€ + 590€";
  il `total` viene animato con un conteggio.
- Qualsiasi `image`/`cover_image` può essere una **chiave della libreria** (sotto),
  un nome file in `assets/img/`, oppure un path a una foto nuova fornita dal cliente.

## Inventario libreria immagini (`assets/img/`)

Foto reali di Como On Boat estratte dalla presentazione originale. Riusale per
le tappe ricorrenti; per tappe nuove chiedi all'utente una foto e passa il path.

| Chiave | Soggetto |
|---|---|
| `cover-lake-boat` | Vista dal gozzo verso villa e montagna (ottima copertina) |
| `villa-pliniana-1`, `-2` | Villa Pliniana (Torno) |
| `villa-cassinella-1`, `-2` | Villa La Cassinella |
| `villa-balbianello-1`, `-2` | Villa del Balbianello |
| `bellagio-1`, `-2` | Bellagio |
| `orrido-nesso-1`, `-2`, `-3` | Orrido di Nesso |
| `varenna-1`, `-2` | Varenna |
| `boat-2` … `boat-7` | Gozzo Sorrentino (interni/esterni/navigazione) |
| `extra-1` | Vassoio aperitivo / Franciacorta |
| `extra-2` | Bouquet di fiori |
| `extra-3` | Servizio fotografico a bordo |
| `gem-1` … `gem-4` | Piccole foto ville (uso libero) |

Logo: `assets/logo/como-on-boat-logo.png`.

## Aggiungere nuove foto

Metti le nuove immagini in `assets/img/` (preferibilmente JPG, lato lungo
≤1400px, qualità ~82 per tenere il file finale leggero) e referenziale per
chiave (nome file senza estensione). Per foto del cliente esterne alla libreria
puoi passare direttamente un path nel JSON.

## Esempio di riferimento

`esempi/hidden-gems-meduca.json` → ricostruisce la proposta "Hidden Gems Lake
Como Tour" (6h, 2440€). Usalo come modello per nuove proposte.
