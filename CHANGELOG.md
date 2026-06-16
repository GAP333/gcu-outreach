# Changelog

All notable changes to the GCU Prospect Pipeline are logged here, newest first. This started June 16, 2026 — anything before that wasn't tracked.

---

## 2026-06-16 (3) — Merged in the real Kingdom Impact Council data

**What:** Pulled the compiled JS bundle from the live `gcu-live.vercel.app` deployment and extracted all 976 prospect records (Sam grabbed the file from DevTools and uploaded it). Mapped them into the shared schema and seeded them into the KIC tab.

**Breakdown:** 73 records flagged green → Priority: High. 53 flagged yellow → Priority: Medium. The remaining ~850 unflagged background-research records → Priority: Low, so the council's actual shortlist still leads every view.

**Schema additions:** `notable` (text), `draft_email` (text), `source_urls` (jsonb array) — three KIC-only fields that didn't have a home in the SOHK-derived schema. All three render in the detail view now: `notable` as a highlighted one-line callout above the bio, `draft_email` as its own sidebar card with a one-click copy button, and `source_urls` finally wires up the "Verified Sources & Articles" panel that existed in the markup but was never populated.

**Mapping decisions** (documented in full in `supabase/schema.sql` section 7 and `README.md`):
- Dropped the original A/B/C/D quality grade — `score` already ranks things, and KIC's grade didn't mean the same thing as SOHK's Tier field.
- Merged `bestApproach` + `strategy` + free-text `contact` guidance into one `approach` field.
- Folded sparse `boards` data into the end of `bio` when present.
- KIC ids offset by +1000 (range 1001–1996) so they never collide with SOHK's 1–86.

**Not done yet:** the new `notable` / `draft_email` / `source_urls` fields aren't editable through the Add/Edit Prospect form yet — they're populated from the import and display-only for now.

## 2026-06-16 (2) — Combined SOHK and KIC into one app with two tabs

**Why:** Sam needs one tool covering both the School of Hard Knocks pipeline and the Kingdom Impact Council pipeline, run by multiple people.

**Changed**
- Renamed the app to **GCU Prospect Pipeline**, with two switchable tabs in the nav: **School of Hard Knocks** and **Kingdom Impact Council**. Each tab has its own filters, categories, and stats, all backed by the same Supabase database and the same touchpoint tracker.
- Added a `list` column (`SOHK` | `KIC`) to the `prospects` table so one shared schema can serve both tabs without duplicating tables.
- The "Add Prospect" Category field changed from a fixed dropdown (SOHK-specific industries) to a free-text input with autocomplete, since KIC uses a different category set entirely.
- New prospects are automatically tagged with whichever tab is active when you hit Save.

**Pending**
- The Kingdom Impact Council tab is built and ready but has no data in it yet. The real KIC data lives only in the disconnected `gcu-live.vercel.app` app (no GitHub repo). Sam's grabbing the compiled JS bundle from DevTools so it can be migrated in — once that's in hand, it gets seeded the same way the 82 SOHK prospects were, with KIC ids starting at 1000.

## 2026-06-16 (1) — Rebuilt on Supabase, added touchpoints, replaced status field

**Why:** The app only lived in each person's own browser (localStorage). Newly added prospects didn't even survive a page refresh, let alone show up for teammates. With multiple people about to work this list, that had to change.

**Changed**
- Split the single 1,232-line `index.html` into `index.html` (markup), `styles.css`, `app.js`, and `config.js` for maintainability.
- Replaced all data storage with Supabase (Postgres). All 82 existing prospects migrated over (see `supabase/schema.sql`).
- Added realtime sync — every connected browser sees teammates' edits live, no refresh needed.
- Replaced the 5-option status dropdown (Needs to be Contacted / Not contacted / Contacted / Meeting booked / Passed) with a 4-stage `stage` field: **Emailed, Interested, Met with, Confirmed**. Added a matching filter in the list view.
- Fixed: prospects added via "+ Add Prospect" now actually persist (previously they only existed in memory for that page load).

**Added**
- Touchpoint tracker: log calls/emails/meetings/texts per prospect with date, type, note, and who logged it. Visible in the prospect detail view.
- Automatic "needs follow-up" flag (⚠) on any prospect in an active stage with no touchpoint in 14+ days. Reflected in the nav bar count and as a new list filter.
- "Meetings" stat tile now counts real logged Meeting-type touchpoints instead of being a placeholder.
- Connection-status banner + nav indicator showing whether the app is actually talking to the database.
- `README.md` with setup instructions and architecture notes.
- This changelog.

**Not done yet**
- The Kingdom Impact Council dashboard (`gcu-live.vercel.app`) is a separate, disconnected app with no GitHub repo — out of scope for this round until its source is recovered.
