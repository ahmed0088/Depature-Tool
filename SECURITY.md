# Security

## Reporting a problem

If you find a security problem in HotelOps, please don't open a public issue.
Use **Security → Report a vulnerability** on this repository (private advisory) instead.

## What protects the data

- Hotel data lives in Firebase, never in this repository. The repository is public and holds only the app's code.
- `firebase-config.js` is a Firebase **web** config. It identifies the project and is public by design.
  Access is controlled by Firebase Authentication and the Realtime Database rules (see README → Setup).
- Real staff or guest names, emails, rosters and reports must never be committed. `.gitignore` blocks the usual export files.
