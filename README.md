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

## Phase 2
- **Participants' phones** (`/checkin/#CODE`, the session's QR code): title, name exactly as on the certificate (with a preview), email, organisation, photo and consent. People are matched by email within a programme, so day 2 is one tap. After check-in the page becomes their **session room**: what's on the screen now, their group (A / B), *My items* (files and slides shared with them, with a fly-in alert) and **Tap out**.
- **Live screen** (Start session): one flow of welcome → pre-test → slides with activities after slide N → exit ticket → post-test → evaluation → certificates. The welcome screen shows the QR code, arrivals with *Ẹ káàbọ̀* and a wall of faces. Slides render from the uploaded PDF. **Share file** and **Share this slide** send to everyone, Group A or Group B. Keys: → / Space next, ← back, F full screen.
- **Register** on the session's Attendance tab: photo, name, email, organisation, time in / out, duration, CSV.

Next: gestures and the phone remote on the live screen, the activities running live (polls, quizzes, wheel…), evaluation and pre/post learning achievement, certificates.

## Setup
1. **Database:** Supabase → SQL Editor → New query → paste `supabase/schema.sql` → Run. Then do the same with `supabase/schema-2-participants.sql`.
2. **Auth:** Supabase → Authentication → Sign In / Providers → Email → turn off *Confirm email* (approval is the gate). Under URL Configuration set the Site URL to the Vercel address.
3. **Super Admin:** request access on the site with the admin email, then run the last line of `schema.sql` (the one marked SUPER ADMIN). That account then signs in at `/admin/`. It can't be used as a trainer account; use another email for training.
4. **Hosting:** Vercel → import this repository → Framework preset *Other*, no build command.

`config.js` holds the Supabase URL and the publishable key (safe in web pages). Never put a secret or service_role key in this repository.

## Phase 3: activities live

Run `supabase/schema-3-activities.sql` once in the Supabase SQL Editor (after schema.sql and schema-2-participants.sql).

- **Assessments tab** on each session: write the questions for every quiz, poll, word cloud, first to catch, group battle, order it, match it, spot the error, case study, exit ticket, and the pre/post test.
- **Live screen**: when the flow reaches an activity, press Enter (or ▶ Start). Space moves through open → reveal → next question → leaderboard.
- **Phones** answer on the check-in page. Scoring happens in the database, and answers stay hidden until you reveal them.
- **Pre/post test**: the pre-test never shows the answers. After the post-test, each person sees their learning achievement, (post − pre) ÷ (100 − pre). The **Learning** tab lists everyone, with a CSV download.

## Step 1: check-in and attendance

Run `supabase/schema-4-attendance.sql` once (after schema-3).

- **Programmes → Participants**: paste or upload your list, and choose whether only listed emails can check in. You also set how long participants can open their page after the programme ends.
- **One phone, one person per session.** A second person on the same phone is asked to use their own phone or be checked in by the facilitator (Attendance tab → Check someone in).
- **Time spent** is time in the session minus time away. A tap-out is counted only if the person checks back in. It is shown on the phone and in the register, with each away period.
- **Possible duplicates** (the same name under two emails) are flagged in the register, with a Merge button.
- **End session** closes the room on every phone and shows each person a summary. When the last session ends, the programme is marked Completed. **Reopen session** undoes it.
- The check-in camera shows a head-and-shoulders outline.

## Step 2: participation ranking

Run `supabase/schema-5-participation.sql` once (after schema-4).

- Each launch of an activity on the live screen counts as one activity run.
- The **Participation** tab ranks everyone by how many activities they took part in, then by points. Downloads to CSV.
- The register CSV includes each person's participation and rank.
- Each phone shows "Your participation": activities taken part in, points, and rank.
