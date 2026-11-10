# Boletín · La Biblia en su Contexto

Free landing page and automated newsletter. There are no hosting fees and no server to maintain.

| Part | Where it runs | Cost |
|---|---|---|
| Landing page (`docs/`) | GitHub Pages | Free |
| Signups, emails, scheduling (`apps-script/`) | Google Apps Script, with a Google Sheet as the database and Gmail for sending | Free |

## What happens automatically

1. A visitor signs up and immediately gets a **confirmation email**.
2. When they click it, the **welcome email** goes out right away.
3. The **day 3** and **day 7** emails follow on their own (the "Bienvenida" tab).
4. You write a message in the **"Mensajes"** tab and tick "¿Enviar a todos?", and it goes to every active subscriber.
5. Every email has a one-click **unsubscribe** link.

The Google Sheet *"Boletín · La Biblia en su Contexto"* in your Google Drive is your admin panel. Its "Cómo usar" tab explains everything.

## Limits

A free Gmail account sends about **100 emails per day**. If a broadcast needs more than that, it pauses and continues by itself the next day.

## Updating

- Page text: edit `docs/index.html`, then commit and push. GitHub Pages updates in about a minute.
- Email texts: edit them directly in the Google Sheet. No code is needed.
- Backend code: edit `apps-script/Code.js`, then run `npx clasp push` and `npx clasp deploy -i <deploymentId>`.
