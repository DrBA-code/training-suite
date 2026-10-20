# Training Suite

Your personal toolkit for professional training delivery: programmes, sessions, check-in, gesture slides, live activities, tests, evaluation and certificates.

Static site (no build step) on Vercel; accounts, data and files in Supabase.

## Phase 1 (this release)
- **Welcome page**, **request access**, **sign in**, password reset.
- **Approval:** new accounts are *pending* until the Super Admin approves them with a plan and an end date. Paused, rejected and expired accounts can't use the workspace.
- **Admin console** (`/admin/`): separate sign-in for the Training Suite team only. Account requests, approve / reject, plans and end dates, pause / reactivate.
- **Dashboard** with collapsible analytics (one open by default).
- **Programmes** (parents of sessions; certificates are optional and set on the programme).
- **My sessions** (All, Live now, Upcoming, Completed, Drafts).
- **New session**, 8 steps: programme and topic (date, objectives) → attendance code, QR and tests → slides and files to share → engagement → assessment → evaluation → certificate → flow (activities placed after slide N).
- **Session page:** run sheet (start, mark done, finish), details, attendance code and QR, files, delete.

Next phases: check-in and the live flow (slides and activities in one sequence, Share file, grab and throw), assessments, evaluation and pre/post learning achievement, certificates.

## Setup
1. **Database:** Supabase → SQL Editor → New query → paste `supabase/schema.sql` → Run.
2. **Auth:** Supabase → Authentication → Sign In / Providers → Email → turn off *Confirm email* (approval is the gate). Under URL Configuration set the Site URL to the Vercel address.
3. **Super Admin:** request access on the site with the admin email, then run the last line of `schema.sql` (the one marked SUPER ADMIN). That account then signs in at `/admin/`. It can't be used as a trainer account; use another email for training.
4. **Hosting:** Vercel → import this repository → Framework preset *Other*, no build command.

`config.js` holds the Supabase URL and the publishable key (safe in web pages). Never put a secret or service_role key in this repository.
