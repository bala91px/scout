# Scout — Cloudflare Pages Functions

This directory contains serverless functions that run on Cloudflare Pages
alongside the static site. They are deployed automatically when CF Pages
detects the `functions/` directory at the project root.

## Routes

| Route          | File                     | Purpose                              |
|----------------|--------------------------|--------------------------------------|
| `POST /api/waitlist` | `functions/api/waitlist.js` | Capture Pro waitlist emails to Loops.so |

---

## One-time setup (waitlist)

Do this **once**, before the next deploy. Without it, the function is
deployed but every email submission stays queued in the user's browser
and won't reach Loops.

### 1. Create a Loops account
- Go to https://loops.so → sign up (free tier: 1,000 contacts + 4,000 emails / 30 days)
- Settings → API → create an API key. Copy it.

### 2. Add the secret to Cloudflare Pages
- Cloudflare dashboard → Workers & Pages → `scout-3qu` (or whatever your project is named)
- **Settings → Environment variables → Production**
- Add variable:
  - Name: `LOOPS_API_KEY`
  - Value: *(paste the key from step 1)*
  - **Encrypt**: yes (so it's stored as a secret, not visible to anyone with read access)
- Save

### 3. (Optional) If you also serve from GitHub Pages or a custom domain
Add a second variable so those origins can call the function:
- Name: `ALLOWED_ORIGINS`
- Value: comma-separated list, e.g. `https://username.github.io,https://scoutapis.dev`
- Encrypt: no (it's a public allowlist, not a secret)

### 4. Deploy
- Push to `main` (or whichever branch CF Pages tracks)
- Wait for the build to finish in the CF dashboard
- The function is now live at `https://scout-3qu.pages.dev/api/waitlist`

### 5. Smoke test
From a terminal:
```bash
curl -X POST https://scout-3qu.pages.dev/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email":"yourname+test@gmail.com","source":"waitlist"}'
```
Expected: `{"ok":true}`

Then check Loops → Audience → Contacts. The email should appear with `userGroup: scout-waitlist`.

---

## How the client uses it

The browser (`index.html`) calls `POST /api/waitlist` with `{ email, source }`.
- `source` ∈ `dwell-5min` | `pdf-2nd` | `fav-click` | `fav-upsell` | `pdf-paywall` | `waitlist`
- Currently the function does NOT forward `source` to Loops (it would 400 unless the
  custom property is pre-defined in the audience). To enable per-trigger analytics later:
  1. In Loops → Audience → Properties → add a text property called `source`
  2. In `functions/api/waitlist.js`, restore `source` to the request body sent to Loops

The client uses **optimistic UX**: the modal closes and the success toast fires
immediately, then the upload runs in the background. Failures are queued in
`localStorage` (`scout-email-pending`) and retry on the next page load. So
short outages, network blips, or a temporarily-missing function won't lose
emails — they'll arrive late.

---

## Recommended hardening (post-launch)

1. **Rate limit** the route at the CF WAF level.
   Dashboard → Security → WAF → Rate limiting rules → 10 requests / min per IP on `/api/waitlist`.
   Protects against subscription bombing and quota exhaustion.

2. **Custom domain CORS** when `scoutapis.dev` (or whatever) goes live, add it to `ALLOWED_ORIGINS`.

3. **Consider Cloudflare Turnstile** if you see abuse. Free, invisible CAPTCHA, drop-in.

---

## Local development

The `npx serve` static server doesn't run Pages Functions, so `/api/waitlist`
will 404 in local preview. The client treats 404 as a transient failure and
keeps emails queued, so the UX still flows correctly during local testing —
emails just don't reach Loops until you deploy.

For full local testing including the function, install Wrangler:
```bash
npm install -g wrangler
wrangler pages dev . --port 3456
```
Then set the env var inline:
```bash
LOOPS_API_KEY=your_key wrangler pages dev . --port 3456
```
