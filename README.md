# School of Hard Knocks Pipeline

GCU's prospect intelligence dashboard for the School of Hard Knocks outreach list. Live at **gcu-outreach.vercel.app**, deployed from this repo (`GAP333/gcu-outreach`).

## What changed (June 2026 rebuild)

This used to be a single 1,200-line `index.html` with all data baked into the page and saved only to each person's own browser (`localStorage`). That meant: nothing you added stuck around after a refresh, and nobody else on the team ever saw your edits.

It's now a real shared database (Supabase) behind a clean static front end, so the whole team sees the same live list. See `CHANGELOG.md` for the full history of changes going forward — every change from this point on gets logged there.

## File layout

| File | Purpose |
|---|---|
| `index.html` | Page markup only — no data, no logic |
| `styles.css` | All styling |
| `app.js` | All app logic: loads data from Supabase, renders the 3 views (hero/list/detail), handles every write |
| `config.js` | Supabase URL + anon key (you fill this in — see Setup below) |
| `supabase/schema.sql` | Run this once in a new Supabase project to create the tables and load your existing 82 prospects |
| `CHANGELOG.md` | Dated log of every change made to this app from June 2026 onward |
| `vercel.json` | Tells Vercel to serve all files as static (no build step) |

## Setup (one-time, ~10 minutes)

1. **Create a free Supabase project** at [supabase.com](https://supabase.com) (sign up, "New Project", pick a name/region, set a database password — save that password somewhere safe).
2. Once the project is ready, go to **SQL Editor → New query**, paste in the entire contents of `supabase/schema.sql`, and run it. This creates the `prospects` and `touchpoints` tables, sets up permissions, turns on realtime sync, and loads your existing 82 researched prospects.
3. Go to **Project Settings → API**. Copy the **Project URL** and the **`anon` `public` key**.
4. Open `config.js` in this repo and paste those two values in for `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
5. Commit and push (or hand the values to whoever's pushing) — Vercel will redeploy automatically and the site goes live with shared data.

Until step 4 is done, the site will show a yellow "not connected" banner and nothing will save — that's expected.

## How the live multi-user sync works

Every prospect and every touchpoint lives in Supabase, not in the browser. When anyone adds a prospect, changes a tier/stage, saves an email, or logs a touchpoint, it writes straight to the database. Every other open tab is subscribed to Supabase's realtime feed and automatically refreshes when anything changes — so two people working the list at the same time both stay in sync without refreshing.

## One unified list, plus Goals

The nav bar now has two tabs: **Prospects** and **Goals & KPIs**. Prospects shows School of Hard Knocks and Kingdom Impact Council people together in the same place — there's a "Both Lists" filter dropdown if you want to narrow to just one. Every prospect's detail page shows a small badge noting which list they originally came from, and another badge if they were added manually through the "+ Add Prospect" form rather than imported.

**KIC data status:** real. All 976 records from the live `gcu-live.vercel.app` bundle are merged in — 73 flagged green (→ High Priority), 53 flagged yellow (→ Medium), and the remaining ~850 are background research with no flag (→ Low Priority, so they don't clutter the main views but aren't lost).

A few fields didn't map directly onto the shared schema, so here's what happened to them:
- The original A/B/C/D quality grade was dropped — the numeric `score` (0–100) already does that ranking job, and Tier (Whale/Review/Contact) means something different on the SOHK side.
- `bestApproach` and `strategy` (KIC had both) were merged into one `approach` field, preferring `bestApproach` when both existed. Free-text `contact` guidance got appended to the end of that same field.
- `boards` (other board memberships) got appended to the end of `bio` when present.
- Two new fields came over that SOHK doesn't have: `notable` (a one-line "why this person matters" tag, shown as a highlighted callout above the bio) and `draft_email` (a pre-written outreach draft, shown in its own sidebar card with a copy button, when one exists).
- `sourceUrls` now actually populates the "Verified Sources & Articles" panel, which existed in the markup before but was never wired up to anything.
- `faith_confirmed` is **manual only** now — it used to auto-set to true for any KIC record whose bio mentioned anything faith-related, which wrongly flagged ~850 unconfirmed background-research people. Now nobody's flagged automatically; check the box on a person's detail page (under FAITH SIGNAL) once you've actually confirmed it.

## Goals & KPIs

A simple tracker, separate from the prospect lists: add a goal with an optional due date, check it off when it's done (the completion date gets recorded automatically), delete anything you don't need. Meant for you to populate by hand.

## Engagement stages

The old 5-option status dropdown (Needs to be Contacted / Not contacted / Contacted / Meeting booked / Passed) has been replaced with a 4-stage field used for filtering: **Emailed → Interested → Met with → Confirmed**. This is separate from **Tier** (Whale / Review / Contact), which is about *reachability*, not *engagement progress*. Both fields are shared across the SOHK and KIC tabs.

## Touchpoint tracker

Each prospect's detail page has a touchpoint log — every call, email, meeting, or text gets logged with a date, type, who logged it, and an optional note. The app uses this to automatically flag prospects that haven't been touched in 14+ days with a "⚠ Follow up" badge, both on the list view and in the nav bar count. There's also a "Needs Follow-up" filter in the list view.

## Known limitations

- New prospect IDs are computed client-side as `max(existing id across both lists) + 1`. If two people hit "Save" on a brand-new prospect at the exact same moment, there's a small chance of an ID collision. Not expected to come up often with a small team, but worth knowing.
- The Supabase anon key has full read/write access to all tables (gated by the fact that it's not published anywhere public). Don't post the deployed URL or this repo somewhere public-facing without locking that down further.
- The "Add Prospect" category field is now a free-text input (with autocomplete from whatever categories already exist) instead of a fixed dropdown, since SOHK and KIC use different category sets. Type a new one any time.
- Editing an existing prospect doesn't let you move it between the SOHK and KIC lists — the List dropdown only applies when adding something new.
