# Artisan replica (local reference only)

An exact, working local copy of https://www.artisan.co built by recording what
the real site loads in Chrome and replaying it with the original URLs, so the
Next.js JavaScript, animations, menus and images all work.

## Run

    npm install      # first time only
    npm start        # -> http://localhost:3005

## Commands

| Command | What it does |
|---|---|
| `npm start` | Serves the archive at http://localhost:3005 (`PORT=4000 npm start` to change port) |
| `npm run capture` | Re-records every page in `pages.txt` from the live site (needs internet) |
| `npm run capture -- /pricing /about` | Re-records only specific pages |
| `npm run verify` | Opens every page from the local copy, lists missing files/JS errors, saves screenshots to `screenshots/` |

After a capture, restart `npm start` so it picks up the new archive.
To add a page (e.g. a blog post), add its path to `pages.txt` and run capture.

## Files

- `capture.js` – records the live site into `archive/` (headless Chrome)
- `server.js` – replays `archive/` on localhost
- `verify.js` – checks the local copy page by page
- `pages.txt` – list of pages to record
- `archive/` – recorded files + `manifest.json` (URL -> file)

## Limits

- Forms (demo request, email signup), login and the chat widget talk to
  Artisan's backend and won't work offline.
- Analytics/tracking scripts are blocked on purpose.
- This contains Artisan's trademarks, copy and images. Keep it local, and
  replace the branding/content with your own before publishing anything.
