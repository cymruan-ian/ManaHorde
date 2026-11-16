# ManaHorde

A local-first Magic: The Gathering collection app for Windows and Android. No build tools or npm downloads are required. Scryfall supplies card details; your collection lives in the browser's IndexedDB.

## Open on Windows

1. Node.js is already available on this computer. On another Windows PC, install the current Node.js LTS release from https://nodejs.org.
2. Double-click **Start ManaHorde.cmd** in this folder. Keep its window open.
3. Open **http://localhost:4173** in Microsoft Edge or Chrome. Always use this exact address (127.0.0.1 is a different storage origin).
4. Use the browser's Install app option to give it its own window and Start menu entry. Installation becomes available after the app's service worker has registered; reload once if needed.

Alternatively run `node server.mjs` in this folder (`npm start` also works if npm is installed). Copy the whole app folder to another computer to run it there; transfer the collection with a JSON backup or Drive sync. Data is not stored in the source folder.

## Add your cards

Search by name or set code and collector number (for example `m21 199`), or use Advanced filters to combine supertype, card type, subtype, colour identity and Commander legality. Select a printing, then record quantity, finish, condition, language, location and notes. New entries default to the `Collection` location. Manual entries work offline and can be validated later. Each addition is a separate entry: quantities are never silently combined. Existing entries can be edited by selecting them. Double-faced cards use the front image and show both faces' rules text.

The local Node server fetches DailyMTG headlines through a same-origin `/api/mtg-news` route to avoid browser CORS restrictions. For an Android or other static-hosted copy, configure an equivalent same-origin server-side proxy for that route. CORS is controlled by the server being contacted; front-end code cannot grant itself permission. Search and images require Scryfall to be reachable. Saved card details work offline. Viewed images are cached up to 250 images; images never viewed on a device may be unavailable offline. The app is an unofficial fan project; Magic card names and imagery belong to their respective owners.

ManaHorde opens on Home, which shows collection totals and a short live headline list from the official DailyMTG news page. My collection has its own page without the summary cards.

## Collection filters and Commander decks

Use **Commander filters** on the collection to filter cards you own by supertype, card type, subtype, colour identity, and Commander legality. The colour choices mean the card's identity fits within the selected colours. Search and finish filters work alongside these filters.

Open **Decks** in the sidebar to expand the deck list, then choose a deck thumbnail to open its page. Choose **New Deck** to create one. In a deck, commander cards appear first with a crown and highlighted border. Use **Set as Commander** on an eligible card to recalculate validation. Assign a deck bracket from 1 to 5. Click a card to adjust its deck quantity across all owned printings, add an unassigned copy, or move one from another deck after confirming. Search Scryfall from the deck page to add a card; ManaHorde uses an owned copy when available and otherwise adds it as **Not Owned**. Use **Add optimised basic lands** to fill toward 37 lands using the deck's colour-pip ratios; unowned basics are added to the shopping list. The My collection button resets filters to **All collection**. New card entries default to the `Collection` location.

Deck validation checks the 100-card total including commander cards, Commander format legality from Scryfall, colour identity, eligible commander selections and supported Partner/Friends forever/Choose a Background pairs, and singleton rules with basic land and “any number” exceptions. Missing Scryfall details are fetched when online. The checker does not interpret every card-specific restriction or all special commander mechanics, so review unusual deck-building restrictions manually.

The Shopping list groups Not Owned cards by name and shows totals by deck; it can be exported to CSV. Not Owned cards do not appear in My collection. Cardmarket price lookup is currently turned off. ManaHorde no longer requests Cardmarket or exchange-rate prices.

## Back up and transfer now (no Google setup required)

Open **Backups & sync → Download backup**. Save the JSON file in your own Google Drive. On your other device, download it from Drive and select **Import & merge**. Imports merge edit history instead of replacing the collection. Keep these JSON files private; they contain your collection, locations, notes and prior edits in plain text.

## Android and HTTPS

This is a Progressive Web App, not an APK or native Windows installer. The local Windows server listens only on this PC. `localhost` on your phone points to your phone, not your computer.

To install on Android, put these public app files on an HTTPS static host: `index.html`, `styles.css`, `app.js`, `core.js`, `drive.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`. Serve at the domain root. No collection data or credentials need to be uploaded. This project has not been deployed to a host automatically.

Open that HTTPS address in Android Chrome, then use **Add to Home screen → Install**. Use the same hosted address on your PCs if you want a single installation origin. Migrating from localhost to a hosted address requires exporting and importing a backup; browser data does not move automatically. The first visit needs internet; later launches use the offline shell. Browser settings control whether installation is offered.

## Connect automatic merging through your Google Drive

The integration is implemented, but it needs an OAuth client belonging to you. Google sign-in cannot work with a fabricated client ID, and no secret should be embedded in this app.

1. Create/select a project in https://console.cloud.google.com/ and enable the **Google Drive API**.
2. Configure **Google Auth Platform** branding, audience and data access. For a personal external app in testing, add your own Google account as a test user. For a managed work account, your organisation's policy may restrict access.
3. Add the scope `https://www.googleapis.com/auth/drive.file`. It grants access to files this app creates or is granted access to, rather than all your Drive files.
4. Create an OAuth client of type **Web application**. Add `http://localhost:4173` under **Authorised JavaScript origins**. Add the exact HTTPS origin for your hosted Android copy too. No redirect URI or client secret is used by this popup token flow.
5. Copy the client ID ending in `.apps.googleusercontent.com` into **Settings & install**. Use the **same OAuth client** on every device. The client ID is public configuration, not a password.
6. Open **Backups & sync → Connect Google Drive**, sign in to the same Google account on each device, then choose **Sync now**. Popup blocking or an expired session may require reconnecting. Tokens stay in memory and disappear when you close the app.

The app creates a visible **ManaHorde Backups** folder and a dated JSON snapshot on every sync. It reads snapshots created by this app and merges their immutable revisions before uploading a new snapshot. Concurrent edits to the same entry remain as conflicts, including deletion versus editing. Conflicts are excluded from collection totals until you select a version under Backups & sync. Sync again after resolving. Edits made locally while a sync is running are preserved, and go to Drive on the next sync.

Sync happens only when you press the button, not in the background. Snapshots are deliberately not automatically deleted. For very large collections or long-term frequent syncing this simple first version will need snapshot compaction and incremental downloading; it currently downloads all its snapshots each time. Do not edit snapshot JSON by hand or delete all recent snapshots: deletion history is part of the merge protocol. Restore of a deliberate old version is not yet a separate feature; importing an old backup does not reverse a newer deletion. Re-add a card if you deliberately want it back.

Google integration has not been verified against your account because an OAuth client is not configured yet. Setup references: https://developers.google.com/identity/oauth2/web/guides/use-token-model and https://developers.google.com/workspace/drive/api/guides/api-specific-auth.

## Storage and maintenance

Keep regular exported backups. Clearing browser site data or removing a browser profile can erase the local copy. Persistent storage can be requested in Settings but the browser may decline it. Device copies are independent until you import a backup or sync. Use **Sync now** on the first device before switching, and again on the second device before editing.

Run `node --test` for revision merging, conflict, deletion and backup integrity checks. Run `node --check app.js` (and repeat for the other JavaScript files) for syntax checks. The equivalent npm scripts are available when npm is installed. Generate PNG installation icons with `node scripts/make-icons.mjs` if changing the icon design. After changing app files, bump the cache version in `sw.js`; close all app windows and reopen to activate the updated worker.
