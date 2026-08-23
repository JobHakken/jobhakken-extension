# JobHakken extension — changelog

Version shown in the toolbar popup + Options footer (`chrome.runtime.getManifest().version`).
SemVer: **patch** (0.0.x) = fixes/tweaks, **minor** (0.x.0) = a new user-facing feature,
**major** = release milestone. Iterative work stays in patch; minor bumps mark shipped features.

## 0.40.3
- **Fixed: nothing appeared on the jobs page until you refreshed.** Clicking through to Jobs never
  brought the sidebar up — only a full page reload did. LinkedIn swaps pages without reloading, and the
  sidebar was only being set up on a real load. It now appears as you navigate, the same as it already
  did on post search.

## 0.40.2
- **Fixed: the sidebar sometimes covered the page instead of making room for it**, cutting off whatever
  was on the right. The page was moved over once, when you opened the sidebar — but LinkedIn rewrites
  the page's styling as you browse, which quietly undid it, so whether the layout fitted depended on
  whether the page happened to redraw after you opened the panel. It now notices and puts the space
  back straight away.

## 0.40.1
- **Fixed: the job filters found nothing on the real jobs page.** LinkedIn's signed-in job list is built
  from scrambled class names that change over time, and the sidebar was looking for names that simply
  aren't there — so it reported "Showing 0 of 0" and no filter did anything. It now finds each job by
  its own Dismiss button instead, which LinkedIn labels properly for screen readers and doesn't rename.
- **Hide Promoted, Hide Viewed and the company name now work on the signed-in job list.** The labels are
  read from the job card as shown, rather than from an element that only exists on the signed-out page.
  A job whose *description* happens to mention "promoted" is still left alone.

## 0.40.0
- **Fixed: the sidebar only appeared after a manual refresh.** LinkedIn never reloads the page when you
  switch between the All and Posts tabs or run a new search, and the code that decides whether to show
  the sidebar was skipped on exactly those pages — so it could only ever appear on a fresh page load.
  It now follows you as you navigate.
- **Fixed: the job filters found no jobs at all** ("Showing 0 of 0"), which is why hiding Reposted or
  Viewed did nothing. Every class name on LinkedIn's signed-in job list is scrambled and changes
  regularly, and we were looking for names that no longer exist. Job tiles are now found by their own
  Dismiss button — a label LinkedIn has to keep accurate for screen readers — so the filters no longer
  depend on styling that can change underneath them. Verified against a real signed-in capture: 25 of 25
  tiles found, with their titles, companies and Viewed labels.
- **Fixed: a job at "Applied Intuition" was treated as a job you had already applied to**, because the
  company name begins with the same word as the label.

## 0.39.1
- **Fixed: real job posts were greyed out as "someone looking for work".** A full job description — an
  OpenAI firmware role, with salary and a View job button attached — was faded with a reason that said
  the opposite of what the post plainly was. A formal job description lists responsibilities and
  requirements and often never says "we're hiring" anywhere in its text, so no phrase matched. When a
  post has a job listing attached, that now settles it: LinkedIn only shows that card when the author
  attached a real posting, and nobody advertising their own availability attaches one. Measured on a
  saved search of 78 real posts: 71 now correctly recognised, up from 69.

## 0.39.0
- **Show only the posts you want.** Alongside hiding post types, you can now list keywords a post MUST
  mention to stay visible — search broadly on LinkedIn, then narrow to `zephyr` or `bare metal` without
  redoing the search. The sidebar always shows how many posts are visible out of the total, because a
  too-narrow rule that hides everything otherwise looks exactly like the extension being broken.
- **Post filtering now works on any content search, not just hiring searches.** Your hide and show rules
  apply to whatever you searched for. The automatic "not a hiring post" fade still only happens when the
  search itself is about hiring — on any other search nothing is faded until you say so. Your home feed
  is never touched.
- **Fixed: the author's name and headline were being treated as part of the post.** Every post's text
  silently began with something like "Simran Jiwani · Lead Recruiter at Motive Workforce · 4w ·", which
  meant recruiter job titles polluted the matching, and a stranger's real name was sent to the AI that
  suggests tags. The text now starts where the post does. One more genuine hiring post is correctly
  recognised as a result, and your keyword rules no longer match on someone's job title by accident.

## 0.38.0
- **Filter the LinkedIn job list.** On job search and "Top job picks", you can now hide roles you don't
  want to see: by company, by keyword in the title, or by LinkedIn's own labels — promoted, already
  applied, already viewed, reposted, and dismissed. Rules live in the sidebar so you can see and undo
  every one of them in one place.
- **A count you can always see, and a way to check it.** Whenever a filter is on, the sidebar shows
  "Showing 38 of 60" — a filter that quietly removes most of the page is otherwise indistinguishable
  from the extension being broken. Click the count to reveal what was hidden, each row labelled with the
  rule that hid it, so a rule that's too aggressive is easy to spot and remove.

## 0.37.5
- **Fixed (properly this time): hidden posts now actually fade.** A post matching one of your hidden
  tags was labelled "Hidden — matches …" but stayed at full brightness. LinkedIn wraps every post in an
  element that draws nothing of its own, and fading that element has no effect at all — so the fade was
  being applied to something invisible. It now lands on the part of the post you can actually see.

## 0.37.4
- **Fixed: the sidebar still appeared on ordinary websites** — anywhere with a plain file-upload button,
  which includes ChatGPT, webmail and most support forms. A page only counts as a job application now if
  its upload is actually a résumé slot, rather than any upload at all.
- **Fixed: a hidden post stayed at full brightness.** Posts matching one of your hidden tags were
  labelled "Hidden — matches …" but not dimmed, because LinkedIn re-renders and wipes the dim, and we
  only ever applied it once per post. It's now re-applied as the feed changes, so it can't be lost.

## 0.37.3
- **Fixed: the H-1B and sponsorship tags never appeared while browsing jobs.** They were only applied on
  pages that also contained an application form — and a job search or "Top job picks" page doesn't have
  one, so the badges were skipped on exactly the pages they exist for. They now show as you move
  between jobs.

## 0.37.2
- **Far fewer real hiring posts greyed out by mistake.** Measured against a saved copy of a real search
  of 78 posts: 37 were being dismissed as "not a hiring post", now 10 are — and those ten genuinely
  aren't (a career coach's bio, a graphic designer, an opinion post, people actually job hunting).
  - Recruiters tag their own hiring posts `#OpenToWork` to reach job seekers, and that hashtag alone was
    enough to dismiss the post. A clear hiring statement now wins over it.
  - Openers we didn't recognise: `Hiring: …`, `💥 Hiring Alert`, `#hiring!`, `Multiple openings for …`.
  - A bare mention of the word "hiring" still isn't treated as a signal — it appears in half the
    recruiter headlines on this search, so it would grey out the wrong things in the other direction.

## 0.37.1
- **Fixed: genuine hiring posts were being greyed out as "someone looking for work".** A post opening
  "We’re hiring: Firmware Engineers" was not recognised, because LinkedIn writes that apostrophe as a
  curly ’ and we were only looking for a straight '. Every pattern written with a straight apostrophe
  silently missed the real site.
- **Removed the "View job" and "Find this post" links from under each post.** LinkedIn already shows its
  own job card on the post, so ours repeated a button sitting inches away, and "Find this post" was a
  best-effort text search that could land on the wrong post. The row under a post is now just the tags
  you can hide by — the part only we provide — and posts with no tags get no row at all.

## 0.37.0
- **The sidebar now manages your LinkedIn post filters.** Until now the only way to undo a "hide posts
  like this" choice was to scroll back and find the exact chip you clicked days ago. The sidebar now
  lists every tag you're hiding, on LinkedIn's post search, with a box to add one and an ✕ to remove
  one — and the feed updates as you edit. Removing a rule gives those posts back immediately, which it
  previously never did: the post stayed faded even after the rule was gone.
- **Filtering now works on the results page you actually land on.** Typing a search into LinkedIn's box
  lands on the "All" tab, but filtering only ran on the "Posts" tab, so the feature looked dead unless
  you knew to click across. Both work now. Only posts are ever touched — People, Jobs and Company
  cards on that mixed page are left completely alone.
- The sidebar still appears nowhere else: on LinkedIn it shows the filter list and nothing about form
  filling, and on ordinary websites it stays away entirely.

## 0.36.2
- **Fixed: real hiring posts on LinkedIn were being dimmed as "someone looking for work".** A post that
  opens with the most common wording of all — `Hiring: Firmware QA Engineer…` — was not recognised as a
  hiring post unless its author also had the #HIRING photo ring, so genuine roles were faded out with a
  reason that said the opposite of what the post said. Bare `Hiring:`, `#hiring` and `hiring for` are
  now recognised. Posts from people actually looking for work are still filtered out as before.

## 0.36.1
- **The sidebar no longer appears on ordinary websites.** It was showing up anywhere a page had three
  form fields — logins, contact forms, newsletter signups, checkouts, most settings screens. It now
  appears only on real job applications: a known ATS, a page fingerprinted as one, a résumé upload or a
  screening question, or a site you switched on yourself.
- **We now refuse to autofill a page that isn't a job application at all.** Testing caught autofill
  typing a name, email, phone and company into an ordinary contact form. Not filling a form on some
  unrelated website is the whole point — "your data stays in your browser" means nothing if we type it
  into someone else's page ourselves. A site you explicitly switch on still fills.
- **Fixed: Jobvite applications weren't recognised**, so nothing filled on them. We only spotted Jobvite
  by a link in the page's plumbing that company-hosted applications don't always have.
- **Fixed: a dropdown that silently refused to keep your answer.** Some dropdowns only accept a real
  click, others only the keyboard. A fix for one kind had quietly broken the other; now each is tried in
  turn and checked before moving on, so both work.

## 0.36.0
- **Scroll-fill is no longer torn down while the page is still changing.** Enabling "fill as I scroll"
  built a watcher, but any change to the page rebuilt it from scratch — and on a modern application
  form the page changes constantly. The rebuild dropped the watcher *first* and then did its slow work,
  so for a moment nothing was being watched, and a field you scrolled past in that moment was never
  filled (a watcher only notices a field *entering* view, not one already sitting there). The watcher is
  now kept alive and updated in place, so nothing is missed mid-rebuild, and fields a previous answer
  revealed get picked up as they appear.
- **Turning "fill as I scroll" back on now gives the page a fresh pass**, instead of permanently
  skipping fields it had already visited earlier in the session. It still never touches a field that
  already holds a value or that you're typing in.
- **Hiring-post filter on LinkedIn's content search.** On LinkedIn's own post-search results page
  (e.g. searching `hiring "firmware"`), each post now gets a quiet "View job ↗" / "Find this post ↗"
  row, and posts that aren't actually a hiring pitch (job seekers, the dominant noise on this search)
  are dimmed automatically. An AI pass can also suggest short tags ("recruiter agency", "contract role")
  — click one to hide every post like it from then on. Nothing about the page is stored: no post text,
  no author name, no per-post record — only the tags you've chosen to exclude, so future posts can be
  matched against them without another AI call. Runs only on the page you're already viewing; nothing
  is fetched or scraped in the background.
- **Fixed: a dropdown disappeared from the panel the moment it was filled.** Every custom dropdown
  (react-select, used by Greenhouse and most modern ATS) hides its own text box once you pick a value,
  and our field scanner read that as "the page is hiding this field from me" and dropped it. So a
  correctly-filled dropdown silently vanished from the side panel, couldn't be outlined on the page,
  and couldn't be re-filled or corrected — Fill all reported "gone" about a field sitting in plain
  sight. The scanner now judges the dropdown's own visible box rather than the hidden text box inside
  it, so filled dropdowns stay visible and editable. The underlying check is a safety guard against a
  posting hiding a field to harvest your data on autofill; that guard is unchanged — a field the page
  genuinely hides, or removes, is still ignored.
- **Fixed: one field failing to fill could silently stop later fields from filling at all.** After a
  form rewrote a field behind our back, every field filled afterwards was wrongly blamed for it and
  skipped. Verified on a real Greenhouse posting: gender, veteran status, disability status and
  discipline were all being skipped as a result.
- **Fill all is ~2.7× faster** (about 40s → 15s on a long Greenhouse application). It was pausing after
  every single field to watch for the form reacting; it now notices that while moving on to the next
  field instead of waiting.
- **Linked EEO questions now settle correctly.** Some forms render one question as two dropdowns —
  Greenhouse asks Hispanic/Latino yes-no *plus* a race dropdown that only exists while the answer is
  "No" — and declining the race question is the same statement as declining the whole question, so the
  form collapses the pair. Fill all no longer fights that: it stops re-trying the field that triggered
  the collapse, leaving the required field visibly unfilled for you rather than flip-flopping between
  two states and landing on an arbitrary one.
- Demo data now answers the race question with a concrete category instead of "prefer not to say", so
  demo mode has something visible to show on forms that collapse a declined answer.

## 0.35.3
- **Fixed: an unchecked checkbox could still show the green "we filled this" outline.** A standalone
  checkbox's "did this fill?" check read a static attribute instead of whether it was actually checked.
- **Fixed: a job-availability date ("when can you start") could land in a resume-history field** —
  Education's and Employment's own "Start date" asked a completely different question, and the answer
  to one was leaking into the other. Both now correctly stay blank and ask you instead of guessing.
- **Fixed: field outlines looked like a clean box on some fields and a stray underline on others**, for
  the exact same "we filled this" meaning. Marking now finds the field's REAL visible box regardless of
  what a particular ATS's own markup looks like underneath, and adds a soft glow so it reads consistently
  as one box everywhere, not just wherever the underlying page happened to draw its own border.
- **Fields that only appear after answering a prior question** (e.g. Greenhouse's "Race" question,
  which only renders once "Are you Hispanic/Latino?" is answered) are now caught by Fill all — it
  re-checks for newly-fillable fields after each pass instead of a single fixed snapshot.

## 0.35.2
- **Fixed: a dropdown could show the right answer, then silently revert to blank.** On some comboboxes,
  clicking the matched option didn't actually register — the field looked briefly filled (typed search
  text sitting in the box), then reverted the moment you pressed Escape, scrolled away, or the next
  field filled. Now falls back to the same keyboard selection a person would use when a click doesn't
  take, and the "did this work?" check no longer treats leftover typed text as a success.
- **Fixed: a "select all that apply" checkbox question only outlined its first checkbox**, making it
  look like one random checkbox needed attention instead of the whole question. All of them mark now.
- **Fixed: some field outlines were a nearly-invisible sliver** instead of a box around the visible
  control — a few widgets keep their real interactive element sized down to almost nothing.
- **Fill-as-you-scroll now shows what it filled**, the same green/blue outline a manual Fill gets. It
  was the one fill path that left no visible trace before.
## 0.35.1
- **Fixed: fields like School or Location (City) silently stayed blank.** These only show real choices
  once you start typing — nothing renders on open — and the fill logic never tried typing into a field
  that opened empty. It now does, the same way a person would.
- **Fixed: a filled dropdown could be reported as still empty**, which sometimes made the field's own
  "was this filled?" check silently retry or misreport, especially right after picking a search result.
- **Fixed: the green "we filled this" outline could appear on a field before it actually held a value.**
  It showed up the moment ANY field got auto-filled, coloring every other high-confidence field on the
  page too — even ones you hadn't clicked Fill on yet. The outline now only appears once a field
  genuinely holds a value; "need you" fields still mark regardless, since that's a prompt, not a claim
  of success.

## 0.35.0
- **Back up & restore moved to Settings**, under Account & settings, where it belongs — it's account-level,
  not per-site, and not part of filling a form. The two icons are gone from the sidebar.
- **Fixed: backup and restore threw an error in the sidebar.** After reloading the extension, an open page
  keeps a disconnected copy of the sidebar, and anything you clicked failed with a raw error. The sidebar
  now says *"Extension was reloaded — refresh this page to reconnect"* instead, and backup lives on a page
  that can't be disconnected that way.
- **Backups now include your AI key**, so you don't re-enter it after every reinstall. The summary warns
  you that the file is private — don't attach it to an issue or paste it into a chat.

## 0.34.0
- **A ready-made demo file to import.** `e2e/fixtures/demo-import.json` seeds a full placeholder profile,
  a résumé, a cover-letter template and a couple of remembered answers, so testing no longer starts with
  typing everything in again. Import it from the ⤒ button.
- **"Off here" now looks like what it does.** When a site is switched off, the other switches grey out and
  a line says nothing will be filled. Previously "fill as I scroll" and "off here" could both show as on,
  which made scroll-filling look broken when the site was simply silenced.
- **Backups now carry your settings too** — fill-as-you-scroll, silenced sites and section folds. They
  were being dropped on restore, so a restored backup quietly came back with scroll-filling off.
- **It no longer learns from pages that aren't applications.** A dashboard filter on an unrelated site was
  being banked as an answer ("monthly case volume"), and a polluted bank is worse than an empty one
  because it gets offered on real applications.

## 0.33.0
- **Fill as you scroll.** Turn on "fill as I scroll" and each field is filled as it comes into view,
  instead of everything at once when you press a button. Nothing jumps around, because we only ever
  touch what's already on your screen, and fields that appear later get filled when they appear.
  Sensitive questions still wait for their own switch — scrolling past a visa question never answers it.
- **Off here.** A switch to silence the extension on one site, for when it misbehaves on a particular
  employer's page, without turning the whole thing off.
- **What I've learned (🧠).** Every answer you've taught it, with the times used and where you wrote it
  — editable and deletable. A tool that learns needs an undo. The questions each site asks live here too.
- **A tidier sidebar.** Three buttons at the top instead of six. Filled comes first with sensitive
  questions inside it, then what needs you, then résumé and cover letter.
- **Fixed: the extension was treating its own cover-letter box as one of the form's fields**, which
  inflated the field count and produced a nonsense "needs you" row.

## 0.32.0
- **Your learned data can now leave and come back.** Two buttons at the bottom of the sidebar: **⤓**
  saves everything the extension has learned — your profile, the answers you've taught it, every
  question it has seen, your résumés and cover-letter template — to a single file on your machine. **⤒**
  restores it. Reinstalling the extension no longer costs you weeks of answers, and you can carry the
  same corpus to another machine. Restoring merges with whatever is already there rather than wiping it.
- **Your API key is never included in a backup.** A file that quietly carries a credential is a
  liability; the key takes seconds to re-enter.

## 0.31.0
- **Sensitive questions are their own section, with a switch.** Work authorization, visa sponsorship,
  salary, gender, ethnicity, veteran and disability status no longer sit among the things we simply
  couldn't work out. They have their own **Sensitive — your call** section with an **auto / manual**
  switch: leave it on and we fill them from your profile, turn it off and they're yours to answer.
  Either way you can see what we'd put there.
- **Résumé and cover letter are a section in the sidebar**, not a screen you have to go find — open by
  default, right above the fields, because choosing a résumé is part of filling the application.
- The sidebar now leads with what needs you: **Need you**, then **Sensitive**, then **Remembered**, with
  **Filled** collapsed at the bottom.

## 0.30.1
- **Cover letters and drafted answers actually come back now.** Both were being run through a parser
  built for a different response shape, so a perfectly good letter arrived as "nothing came back". A
  cover letter now returns as written, and Draft 2 returns two genuinely different options rather than
  none.

## 0.30.0
- **You can see what we filled, straight after filling it.** Press Fill and the fields we touched are
  outlined on the form itself — no toggle to find. Green where we filled it, blue where it came from
  your own earlier answer, dashed amber where we left it to you.
- **Keep several résumés and pick one per application.** The new 📎 section lists your résumés, marks
  the one being used, and lets you upload another without leaving the form. Your choice is remembered
  per company, so the same employer gets the same résumé next time.
- **Cover letters.** Write one from your profile, or keep your own template and have it adapted to the
  role so it still sounds like you. Always editable before it goes anywhere, and it lands wherever the
  form wants it — typed into the text box, or attached as a file.

## 0.29.0
- **The sidebar folds.** Filled and Remembered start closed, so a 31-field application shows you the
  9 things that still need you instead of everything at once. Your choice sticks per section.
- **See a dropdown's choices without opening it.** Any select or dropdown row can expand to list what
  the field accepts, with ours ticked. Picking from the sidebar sets the value directly — the page's own
  menu never opens, which is also why it can't get left hanging half-open. If your saved answer isn't one
  of the choices, it says so rather than putting it in anyway.
- **See what we touched, on the form itself.** A new ▣ button outlines every field: solid green where we
  filled it, solid blue where it came from your own earlier answer, dashed amber where we've left it to
  you. Solid versus dashed carries the meaning as well as the colour, and it's off until you ask for it.

## 0.28.0
- **JobHakken now lives on the page, not behind a menu.** A small tab sits on the right edge of any
  application page — click it and the sidebar slides in, pushing the page across rather than covering
  the form you're trying to fill. The tab shows a count of the fields still waiting on you, so you can
  see there's something to do without opening anything. Everything from 0.27.0 is inside it: what we
  filled, what we're leaving to you and why, and what you taught us before.

## 0.27.0
- **New side panel — see what we filled, what we're leaving to you, and why.** Open it with the ◫ button
  in the popup. Every field on the application in front of you is in one of three groups: filled with
  high confidence, needs you, or remembered from your own earlier answers.
- **It remembers what you type.** Answer a question we couldn't, and the next form that asks the same
  thing offers your answer back — with where and when you wrote it. It works across different job sites,
  because it matches on the question, not the page. Nothing is filled automatically from memory: after
  you've used an answer a few times it *asks* whether to always fill it. Your answers stay on your device.
- **Nothing we won't stand behind gets guessed.** Work authorization, sponsorship, salary, notice period
  and EEO questions need a strong match or they're handed back to you with the reason. Equal-opportunity
  questions are never auto-filled at all.
- **Two draft answers for open questions, on request.** Press ✍ Draft 2 on a "why this role?" style
  question and your own AI key writes two options to choose from — one call, never automatic. What you
  pick becomes a remembered answer, so it costs nothing next time.
- **See what we've learned about a site.** The ◔ button lists the questions that site asks, the kind of
  control each uses and how often it comes up. Questions and field types only — never your answers.
- **Honest about what we support.** The panel names the system it recognises only where we've verified
  our handling, and otherwise says "generic handling" rather than implying support we can't back.

- **New side panel: see what we filled, what we're leaving to you, and why.** It lists every field on
  the application in front of you in three groups — filled with high confidence, needs you, and
  remembered from your own earlier answers. Anything we won't fill now says *why* ("not in your profile
  yet", "matched only loosely — too important to guess") instead of just sitting there empty. Questions
  where a wrong answer costs you something — work authorization, sponsorship, salary, notice period,
  EEO — need a strong match or they're handed back to you. The panel also names the system it
  recognises, and says "generic handling" when we haven't verified that one yet rather than implying
  support we can't stand behind.

## 0.25.3
- **The popup no longer says "0 fillable fields" on pages it can actually fill.** Two separate causes,
  both fixed. On single-page apps (Ashby and similar) the field count was read from a cache that only
  refreshed when the toolbar badge updated, so a form that rendered *after* that pass showed as empty
  forever — measured on a live Ashby application: 0 reported, 6 actually filled. The count is now taken
  fresh whenever the popup asks. Separately, when a tab was already open while the extension reloaded or
  updated, Chrome left the old content script running but disconnected, so the popup got no answer at all
  and sat on "Checking…" with a fill button that hung. It now reconnects that tab and retries once.

## 0.25.2
- **Dropdowns on Greenhouse and other React-based forms now actually get filled.** Previously the
  extension typed into them and the page threw the value away, so menus like Location or "Are you
  authorized to work…" stayed empty. It now sets the value the way the page's own code does. On a live
  Greenhouse application this took dropdown fill from 23% to 83%.
- **Works on every site, not a fixed list.** The extension used to only wake up on ~40 known job
  boards, so a company's own careers page or a less common system did nothing at all. It now looks at
  any page you open, with a cheap check that skips anything without a form so normal browsing is
  unaffected.
- **Long résumés now import.** Résumés past about two pages were being cut off mid-import and failed
  with "nothing extracted". The limit is raised, and a truncated response is repaired rather than
  discarded.
- **Fewer wasted clicks while filling.** Single-page forms were being filled up to four times over,
  which is what caused the visible jumping up and down. One pass now, with fields revealed later
  (after answering a gate question) filled as they appear.
- **Questions our rules don't recognise can be matched by AI, using your own key.** Only the field
  *labels* and the *names* of your profile fields are sent — never your actual answers. Results are
  remembered per site so the same form costs nothing next time. Legal attestations, consent and
  background-check questions are never matched this way.
- **Fixes:** saving your profile or AI provider no longer needs a page reload; your API key survives an
  extension reload when you tick "remember"; employment-agreement and non-compete questions answer "No"
  by default rather than being guessed at.
## 0.24.2
- **"Report this page" now fills in the details for you.** Filing a bug from the popup pre-fills the
  GitHub issue with everything we'd otherwise have to ask for: the page URL and job, **which ATS the page
  runs on** (Workday/Greenhouse/…), how many fields were found, **the last autofill result** (filled / to
  review / partial), the sponsorship + H-1B signals, your extension version, browser/OS, mode, and which
  AI provider is configured. Still no personal data — never your profile values, résumé, or answers.

## 0.24.1
- **Reset extension (Settings).** A new "Reset extension" button erases everything on this device —
  your profile, résumé, saved answers, captured forms, AI key, settings, and your JobHakken sign-in —
  and leaves you at a clean slate. It **keeps your desktop-app connection** so you don't have to re-pair.
  Two-click confirm so it can't fire by accident; can't be undone.

## 0.24.0
- **Fixed "Send résumé to extension" from the website.** The website's résumé handoff was being rejected
  because the two sides disagreed on how the résumé version is labeled — the site sends a numeric
  version and the extension expected the old text tag. Now it accepts the numeric `schemaVersion` (5)
  the site + desktop app use (ADR-0005), with the old tag still accepted during rollout. (#107)
- **Fixed résumé PDF upload showing garbled text.** Uploading a PDF résumé could dump binary/glyph-code
  gibberish into the text box (reported by a user). The extractor now applies fonts' `/ToUnicode` maps
  (so Word/Google-Docs subset-font PDFs decode to real text), honors text layout (no split/glued
  words), scrapes only page-content streams (never font/image binary), and — if it still can't read the
  file (e.g. a scanned/image-only PDF) — leaves the box empty and tells you to paste the text instead,
  rather than showing garbage.
- **Résumé version check.** When connected to the desktop app, the extension now reads the résumé
  format version the app sends and, if the app is newer than the extension understands, tells you to
  update — instead of silently mis-filling. (ADR-0005 schema validation over the bridge.)
- **Verified desktop-app connection.** When you connect the extension to the desktop app, the extension
  now makes the local app **prove it holds your connection token** — a challenge/response handshake the
  app answers — *before* sending the token or any data. A rogue program on your machine posing as
  JobHakken is refused, and your token never reaches it. (Completes the #1 bridge-trust hardening now
  that the desktop app ships the matching handshake; older apps still connect during rollout.)
- **Pick your AI provider.** BYOK settings now have a provider picker (shared with the desktop app):
  OpenRouter, OpenAI, **Claude (Anthropic)**, **Gemini (Google)**, GLM/Zhipu, and local runtimes —
  **Ollama, LM Studio, Codex** (no key needed) — plus **Custom** for any OpenAI-compatible endpoint.
  Choosing one prefills its base URL + model and requests only that provider's browser access. Claude
  and Gemini connect natively (not routed through anyone else).
- **Better coverage insight (privacy-preserving).** Autofill now records — as anonymous, opt-out
  metadata only — which ATS *family* a form runs on (Workday/Greenhouse/…, from the page fingerprint,
  never the URL or company) and which *types* of field it detected but couldn't fill (e.g. work
  authorization, salary, a custom dropdown — from a fixed vocabulary, never the label text or your
  answers). This tells us where to improve autofill without reading your applications. Same opt-out
  analytics toggle governs it; nothing about your specific job hunt is captured. (Coverage Layer 1 #105.)
- **First-party analytics (infrastructure).** The same anonymous, opt-out, metadata-only telemetry can
  now also flow to our own PostHog project (the one the website uses), so product usage sits in one
  place. Cookieless (no person profile), routed through our own domain, and inert unless configured in a
  release build — no new permissions, no third-party scripts. (First-party sink #106.)
- **Fewer permissions by default.** The extension no longer asks for access to third-party AI providers
  (OpenRouter, OpenAI, …) at install. Those are now **optional** — requested only if you bring your own
  AI key, and only for the one provider you choose (a one-time browser prompt when you save your key).
  Out of the box the extension talks to just your local desktop app and jobhakken.com; local AI
  endpoints (127.0.0.1) keep working with no prompt. Smaller footprint, same features.
- **Help us support more sites (privacy-preserving).** When you open the toolbar on a job application we
  don't support yet, the extension can now note *that* an unsupported job form exists — as a **salted,
  anonymized fingerprint of the site's domain** plus a coarse guess at which ATS it runs — so we know
  which platforms to add next. It never sends the site address, the company, the page, or anything you
  typed; it only looks at the current tab when *you* click the toolbar (the `activeTab` permission — no
  always-on site access), and only if analytics are on. This is how we stay scoped instead of reading
  every website like other autofill extensions. (Coverage Layer 2 #278.)

## 0.23.0
- **Send your résumé straight from the website into the extension.** Build a résumé on jobhakken.com and
  hand it off to the extension in one click — it lands in your autofill profile (name, contact, links,
  experience, education) ready to fill applications. Nothing leaves your browser: the résumé travels
  website → extension locally, and the incoming data is validated and can never silently blank an
  existing profile. The extension now advertises this to the site (`capabilities: ['resume-import']`) so
  the "Send to extension" button appears only when this build supports it. (Cross-surface link #358 / #107.)

## 0.22.4
- **The website can now tell that you have the extension installed.** Adds `externally_connectable` for
  jobhakken.com + app.jobhakken.com and a small ping handler, so the site can show a "Connected" state
  (and later hand off your résumé) — without any data leaving your browser. Only JobHakken's own origins
  can reach it, and inbound messages are validated. (Cross-surface link #358; the site UI follows.)

## 0.22.3
- **Hardened the desktop-app connection against local impersonators.** Before sending your connection
  token to the local app, the extension now requires the server to prove it holds that token (an HMAC
  challenge) — so a rogue program on your machine that merely pretends to be JobHakken is rejected
  instead of harvesting the token. Older apps keep working; fully active once the desktop app ships the
  matching challenge.

## 0.22.2
- **Privacy Policy & Terms of Use links** in Settings. The Account & settings section now links to
  jobhakken.com/privacy-policy and jobhakken.com/terms-of-service.

## 0.22.1
- **Sign-in is easier to find — and shows what you unlock.** A persistent sign-in chip now sits in the
  Profile & settings header (“Sign in” signed out, your account once you’re in) on every section. And a
  signed-out “Unlock 3 more features” card on Home teases what an account adds — AI answers, H-1B salary
  insights, sync — with a hover tip on each chip and one-click sign-in. Dismissible, never nags once
  you’re in, and autofill stays free.

## 0.22.0
- **H-1B company insights, right in the popup.** For the company on the current job page, expand the new
  “🛂 H-1B history” panel to see how many H-1B petitions they’ve filed, the typical wage (and range), and
  a scrollable **table of the top sponsored roles with per-role filings and wages** — all summed across
  the company’s legal entities (e.g. Amazon’s ~17k filings, not the 2 you’d get from an exact-name match). It’s a **premium** feature: available on a paid/builder
  account or when the desktop app is connected; everyone else sees a short prompt. Data is bundled and
  looked up on-device — nothing about the page leaves your browser.

## 0.21.3
- **Managed-AI subscribers now read their real plan.** When signed in, the extension fetches your tier
  from the webapp’s `/api/entitlement` (source of truth: `profiles.subscription_tier`) using your access
  token, instead of a token field that was never populated — so a Plus/Pro/Max plan is finally
  recognised. Using your own AI key is unaffected. (Activates once the backend endpoint is live.)

## 0.21.2
- Internal: bump the shared `@jobhakken/core` library 0.1.0 → 0.2.0 (cross-surface sync-consumer /
  materialize groundwork, ADR-0009). No user-facing change; sponsor/eligibility classifiers unchanged.

## 0.21.1
- **Groundwork for signing in with your JobHakken account.** Fixed the auth handshake so the extension
  can detect your website sign-in — it now reads the session from the app.jobhakken.com cookie (the app
  moved to cookie-based sessions, including large chunked sessions) instead of localStorage where it no
  longer lives. Using your own AI key is unaffected; managed AI for subscribers still needs a couple of
  backend pieces before it’s live.

## 0.21.0
- **Redesigned Profile & settings page.** The row of tabs is now a calm left sidebar with collapsible
  sections and a “you’re X% ready to apply” bar at the top, so it’s clear what’s set up and what’s left.
  Long explanations are tucked behind ⓘ icons (click or hover for the detail), and the duplicated
  desktop-app setup is merged into one place. Every field and setting is unchanged — just easier to move
  through, and it still respects your light/dark theme.

## 0.20.3
- **Custom Fields → “Advanced: matching operators” now shows worked examples.** It was just a legend of
  symbols; now it shows what each one does on a real field label (e.g. `^salary` starts-with, `salary &&
  !current`, `sponsor || visa`, `=gpa` exact), so targeting tricky questions is clear.

## 0.20.2
- **Screening questions on Lever-style applications now fill.** Custom dropdown questions whose label
  sits next to the field (common on Lever and similar forms) were being skipped; the copilot now reads
  those side-labels and answers them. Bumps the autofill engine 0.1.0 → 0.2.1, which also brings the
  accumulated engine improvements (answer-bank, intl phone E.164, Oracle/react-select comboboxes,
  Ashby EEO/work-auth) that had never shipped to the extension.

## 0.20.1
- **Common questions, one click to add.** Custom Fields now has a row of the questions people hit most
  (notice period, start date, relocate, sponsorship, references, GPA…) — click one to add it, pre-filled
  with a sensible answer to edit. JobHakken can't put every possible field on the profile page, so this
  makes the ones you run into quick to set up.

## 0.20.0
- **Don't like an AI answer? Refine it.** After drafting, the popup lets you pick a drafted question,
  tell the AI what to change (e.g. "make it shorter and mention my Python experience"), and redo just
  that one answer — using your own key, still review-first, never submitted.

## 0.19.2
- **Clearer "Autofill" vs "Autofill + AI".** After "Autofill + AI" the popup now shows a distinct
  "✍️ N AI answers" chip, so you can see what the AI wrote versus what was filled from your profile —
  and those AI answers are the purple-outlined ones on the page.

## 0.19.1
- **Résumé upload now attaches to applications — without the desktop app.** Uploading a PDF/Word résumé
  in Settings now keeps the file and attaches it to application forms (it used to only work when the
  desktop app was connected, so standalone users saw the résumé field left empty). Kept on your device.

## 0.19.0
- **Jobvite applications no longer get stuck at the "Location of Residence" step.** When your country
  clearly matches an option, JobHakken selects it to reveal the form and fills it in the same click.
  It only does this when it can match your *own* stated country — it never picks a residence/consent
  option for you otherwise, and never submits.

## 0.18.1
- **A reminder to set your EEO/demographic answers once.** A résumé never contains gender/race/veteran/
  disability, and JobHakken never guesses them — so the Additional tab now nudges you to set them once
  (with "Decline to self-identify" as the common choice), and the résumé parser points you there too.

## 0.18.0
- **Upload a Word (.docx) résumé too, not just PDF** — and the upload is now a clear, prominent button
  ("Upload a PDF or Word file"), no longer easy to miss.
- **Review fields are now outlined in bright violet** (was a faint amber) — much easier to spot the
  fields to check on the page.
- **Custom Fields is easier to use** — an examples table (e.g. "notice period" → "2 weeks", "how did
  you hear" → "LinkedIn") and clearer input hints.

## 0.17.0
- **Two clear buttons: "Autofill" and "Autofill + AI".** "Autofill" fills the form; "Autofill + AI"
  fills *and* drafts the open-ended answers in one click.
- **You can now see exactly what to review.** Fields JobHakken fills but that you should double-check
  (defaults, AI drafts) are **outlined in amber on the page**, and the popup's "N to review" is a button
  that scrolls straight to them — no more guessing what "to review" means.

## 0.16.0
- **Upload a PDF résumé (not just paste).** The "Parse a résumé" panel now takes a PDF — the extension
  reads the text on-device and drops it into the box for you to review, then parse with AI. Works for
  normal text-based PDFs; a scanned/image-only PDF can't be read, so you'll be asked to paste instead.

## 0.15.1
- A gentle, one-time "enjoying JobHakken? leave a review" note appears in the popup after a couple of
  good autofills — dismissible, shown at most once ever, counted only on your device.

## 0.15.0
- **Sign in with your JobHakken account.** Settings → "Sign in with JobHakken" opens the JobHakken
  website (the same login you use everywhere — password, code, or Google); once you're in, the
  extension picks up your account automatically. It's the groundwork for managed AI and syncing across
  devices. Optional — the extension still works without an account, and free with your own AI key. Your
  sign-in stays on your device; only your email/plan is kept (never your password or refresh token).

## 0.14.0
- **Fill your profile from a résumé with AI — no desktop app.** In Settings → Profile, paste your
  résumé text and click "Parse with AI"; it extracts your name, contact, links, and work/education
  history into the fields for you to review. Uses your own AI key (Settings → AI drafting), only uses
  what's written (never invents details), and never sends your résumé to JobHakken. Sensitive fields
  (salary, EEO, work authorization) are never guessed from a résumé.

## 0.13.2
- **"Draft answers" now works with just your AI key.** Fixed: the button was only shown when the
  desktop app was connected, so someone using only their own AI key couldn't reach it. It now appears
  whenever a key is set (or the app is connected). "Save job" stays desktop-only.

## 0.13.1
- **See your AI usage in the popup.** After drafting answers, the popup shows a running "N drafts this
  month · X tokens · ≈ cost" line so you always know what the AI has used. It's counted on your device
  only and never sent to JobHakken; the cost is an estimate at gpt-4o-mini rates (your actual rate
  depends on the model you choose).

## 0.13.0
- **Draft answers with your own AI key — no desktop app needed.** Open-ended application questions
  ("What excites you about this role?", "Describe a project you're proud of") can now be drafted right
  in the extension. Add your own AI key (OpenRouter, OpenAI, or any compatible provider) under
  **Settings → AI drafting** and it works on any plan, at no cost to us. Everything else — name,
  contact, work authorization, EEO, dropdowns — still fills with **no key and no AI**; the key only
  drafts the essay questions rules can't answer. Answers are always shown for you to review, never
  submitted. Your key is kept in memory for the browser session only and never sent to JobHakken.

## 0.12.1
- **Autofill now fills every field by default — including work authorization, visa sponsorship,
  salary, and EEO/demographic questions.** It's your own data and nothing is ever submitted for you
  (you review first), so the copilot no longer leaves these common, required questions blank. You can
  still turn off "Autofill sensitive fields" in Settings if you'd rather fill those by hand.

## 0.12.0
- **A real first-run experience.** Installing the extension now opens a setup page with a short
  “Getting started — three steps” guide, so you’re never staring at a cold toolbar icon wondering
  what to do. Dismissible once you’re set up.
- **The popup guides you when there’s nothing to fill.** Instead of a dead-end message, it now shows
  a **“Set up your profile →”** button (and again on a job page if your profile isn’t set up yet).
- **Clearer setup.** The old “Desktop” tab is now **“Settings”**, with a **“Connect the app”**
  section moved to the top so it’s the first thing you see (not buried under other options). It
  explains what connecting unlocks, links to the download, and drops the technical wording —
  “connection code” instead of “token”, no raw IP address, no “beta”.
- **Fix:** on a page with nothing to fill, the **Autofill** button is now correctly disabled (a
  latent error previously left the empty-state half-rendered).
- **Less clutter on the settings page.** Rewrote the dense, developer-flavoured text in plain
  language and tucked the power-user / engineering controls (custom sites, “help improve autofill”,
  developer capture, rule operators) behind a collapsed **Advanced** section, so a first-time user
  only sees what matters to them.

## 0.11.4
- **Plainer language throughout.** Replaced insider jargon with words anyone can follow:
  "Standalone" → "App not connected", "No profile" → "Profile not set up", the visa badges now
  read "Sponsors visas ✓" / "Won't sponsor visa" (instead of "H‑1B sponsor" / "No sponsorship"),
  the résumé-tailoring button drops "ATS", the match score reads "Résumé match", and the connected
  status no longer shows a raw IP address.

## 0.11.3
- **Fix: clearer results for "Draft answer" and "Save job".** Both buttons now show a full,
  plain-language outcome (success or a helpful reason) beneath them instead of a cut-off error
  stuck on the button — e.g. "Turn off Demo mode to use this on real data." or "Open the
  JobHakken desktop app first, then try again."

## 0.11.2
- **Fix: "⚑ Report this page" now files to our real tracker.** Feedback was pointing at a
  placeholder repo; it now opens an issue on the public
  [JobHakken-issues](https://github.com/JobHakken/JobHakken-issues) tracker (tagged
  `extension-feedback`), so reports actually reach us.

## 0.11.1
- **Stronger privacy while autofilling.** Autofilled values are no longer written into page DOM
  attributes where the site's own scripts could read them back — the extension now tracks what it
  filled entirely in memory.
- **Hardened desktop-app connection.** The localhost bridge to the desktop app now only accepts a
  fixed set of methods, verifies the caller, validates the port, and caps response sizes — so a
  misbehaving local program can't stall or overload the extension.
- **Safer question autofill.** Free-text question fields are only filled when there's a clear label
  match, and the extension prefers the field inside the form you're on.
- **Reliability & polish.** Capture writes are serialized (no lost/duplicated saves), stored PII is
  redacted more thoroughly, popup text is fully HTML-escaped, and analytics only ever report a
  coarse browser/OS and never throw.

## 0.11.0
- **Anonymous, opt-out usage analytics.** A new **Settings** toggle (on by default) lets the
  extension share **metadata-only** usage stats — which features you use, success/failure, the
  extension version, and browser/OS — to help improve the product. It **never** sends your résumé,
  job postings, form values, or personal data, and you can turn it off anytime.
- **Tighter permissions & safety.** The copilot no longer injects into non-job local pages (removed
  the broad `localhost` content-script match), an explicit content-security policy is enforced, and
  connection/status text is HTML-escaped.
- **Fix: Cancel during autofill.** A completing run could wipe a newer run's abort controller and
  break its Cancel — now a completing run only clears its own, so Cancel always stops the active run.

## 0.10.0
- **Save a job to the desktop feed.** The popup's **Save job** button now adds the open role to
  the desktop app's tracker (the New column) over the local bridge — deduped by URL, so
  re-clicking never creates a duplicate. Needs the app open. (Was a "coming soon" stub.)
- **Loupe brand mark.** The popup + Options header now show the JobHakken **loupe** monogram —
  matching the desktop app, website, and toolbar icon. The old diamond mark is retired everywhere.
- **Fix: visa-sponsor lookup used the site name.** Analyze was querying the *hostname*
  ("linkedin") instead of the real employer, so the H-1B / UK sponsor signal often missed. It now
  reads the actual company from the page title.

## 0.9.3
- **Manual light/dark theme toggle.** A 🖥→☀→🌙 button in the popup header and on the Options
  page. Default follows the system theme; Light/Dark override it and the choice persists across
  both surfaces (`chrome.storage`). The Options (profile) page got real dark tokens so the whole
  form reads correctly in dark, not just the save bar.
- **Brand-matched UI.** The popup + Options now use the JobHakken website palette (sage-green on a
  warm canvas, off-white text — pulled from `landingPage` design tokens) instead of the old indigo
  accent, and the in-app logo is the **same diamond mark as the toolbar icon** (was a ⚡ gradient).
  One consistent identity across the icon, popup, and options.

## 0.9.2
- **Store-ready packaging.** The toolbar + Web Store icon set (16/32/48/128) is now declared in
  the manifest and **generated at build time from the website brand mark**
  (`apps/landingPage/public/favicon.svg`) — one source of truth, so a rebrand of the favicon
  flows into the extension automatically. Added a `pnpm run package` script that builds and
  emits the upload `.zip`.
- **Scoped the content script to job sites.** It no longer runs on every page (`<all_urls>`) —
  it now activates only on job boards + applicant-tracking hosts (LinkedIn, Indeed, Workday,
  Greenhouse, Lever, iCIMS, SuccessFactors, Ashby, SmartRecruiters, Taleo, …), with
  `all_frames` so embedded ATS forms on company career pages still work. Cleaner permissions +
  faster Web Store review.

## 0.9.1
- **Renamed to JobHakken.** The extension name, toolbar title, popup, and Options page now read
  **JobHakken** (UI/behavior otherwise unchanged, per the rebrand). The desktop-app bridge
  handshake keeps its internal identifier so existing connections keep working.

## 0.9.0
- **New ATS: SAP SuccessFactors autofill.** The engine now fills SuccessFactors (SAP RCM)
  application forms (e.g. `career4.successfactors.com/portalcareer`). Its dropdowns are
  `sfCascadingPicklist` widgets — an `<input role="combobox">` whose options load on click —
  which the engine was mis-reading as plain text (so Country / State / work-authorization /
  veteran & disability self-ID never filled). They're now classified as comboboxes and driven
  by the interactive pass. Coverage on the captured form is 18/21 fields (86%). Locked in with
  a real-page fixture + regression suite (`sites/successfactors.test.ts`).
- **Fix:** the **GDPR cookie-consent banner** is no longer treated as form fields. In
  particular the *"Consent to cookies from provider LinkedIn"* toggle previously mis-resolved
  to the `linkedin` profile key and could be toggled during autofill — cookie-consent controls
  (by class/id/ancestor/label) are now excluded everywhere.

## 0.8.7
- **Fix:** badges no longer **duplicate** (a row of repeated pills). The green H-1B badge and
  red mark sit next to the same company, so each one's "am I already here?" check saw the other
  badge as the immediate sibling and re-injected — now the check scans a small sibling window,
  so exactly one of each stays. New E2E guards both no-duplication and re-injection-after-wipe.

## 0.8.6
- **Fix (the "works on saved page, gone on live" bug):** LinkedIn is a React app that wipes
  DOM nodes it didn't create on every re-render — so our injected badges flashed in and
  vanished. Badges now **re-inject automatically**: idempotency is keyed on the badge actually
  being present in the page (not a one-time flag), and the company→approvals lookup is cached,
  so each DOM re-render cheaply restores both the green H-1B badge and the red won't-sponsor
  mark. This is why they held on the downloaded (static) page but not live.

## 0.8.5
- **Fix (regression):** the green H-1B badge + popup verdict stopped showing after 0.8.2
  because tile-matching returned early and skipped the reliable detail-pane company. The
  opened job's company is now always looked up (drives the badge + popup), with tiles as
  best-effort on top.
- **Red "won't sponsor" mark now shows on the page too**, next to the green H-1B badge on the
  opened job (previously only in the popup) — both signals appear together on LinkedIn.
- **Richer feedback issue:** "⚑ Report this page" now files a structured GitHub issue (job
  title, company, full posting URL, detection state, sponsorship + H-1B flags, repro steps).

## 0.8.4
- **Classifier hardened against the full 703-job ground truth** (shared core). New catches
  found by a precision/recall audit (`scripts/eligibility-audit.mjs`): plural "no visa
  **sponsorships** available", "unable to consider candidates requiring sponsorship", "U.S.
  Citizen **or Green Card** holder / Permanent Resident", and non-adjacent "Active **SECRET**
  U.S. Government **Clearance**". Precision guards added so these stay clean: permissive
  "citizens, PRs, **or otherwise authorized to work**", "sponsorship **experience**" (skills
  line), positive plural "sponsorships **are available**", and electrical "**creepage/
  clearance**". Result on the 703 jobs: 281 flagged, **0 false positives**.

## 0.8.3
- **Won't-sponsor detection catches more real phrasings** (shared core classifier): e.g.
  "Sponsorship for work authorization, now or in the future, is unavailable" (words between
  "sponsorship" and "unavailable"), "Indefinite U.S. work authorization required", and
  "temporary visas are ineligible". Re-validated on 703 real jobs — still 0 false positives.

## 0.8.2
- **Feedback now goes to a public repo.** "⚑ Report this page" filed to the private
  jobhakken repo (404 for users) — it now opens an issue on the public
  `pranav083/cautious-octo-spork` with the `extension-feedback` label.
- **More live-robust LinkedIn tiles.** The H-1B badge (and won't-sponsor mark) anchor to the
  job-title link inside each list `<li>` (present on every live card regardless of LinkedIn's
  obfuscated classes) and read the company from known elements or the tile's text; badges are
  forced visible with `!important` so host CSS can't hide them. (Still best-confirmed on saved
  pages — see note; a live card's HTML nails it.)

## 0.8.1
- **Fix:** the popup job line showed the site ("linkedin") as the company. It now reads the
  real company from the page title ("Title | Company | LinkedIn").
- **Broader LinkedIn tile matching** for the H-1B badge + won't-sponsor mark: added more
  list-item and company selectors (`scaffold-layout__list-item`, `data-job-id`, entity-lockup
  subtitle, primary-description) since LinkedIn's list DOM uses obfuscated classes. (Detail
  pages are validated; the search-list tiles need a saved list page to fully confirm.)

## 0.8.0
- **Inline H-1B sponsor badges on LinkedIn.** A green "✓ H-1B sponsor" pill now appears next
  to a company on job tiles/pages when that employer has H-1B approvals on record — no need to
  open the popup, and it works **standalone** (a compact ~124k-employer list, ~2.8 MB, is
  bundled and owned by the background worker). Matching sums a brand's exact + word-prefix
  entries ("emerson" → "emerson electric" + "emerson process …") so short LinkedIn names
  resolve like the desktop's fuzzy matcher. The popup shows the same as a green chip.
- **Two complementary signals, by design:** the green H-1B badge is a *company-level* hint
  (has this employer sponsored before?), while the red "🛂 won't sponsor" mark is the
  *role-level* override read from the specific job description — both can appear on the same
  tile (e.g. a sponsoring company posting a citizenship-only role). Both gated by
  "I need visa sponsorship". Regenerate the list with `pnpm run gen:h1b-ext`.

## 0.7.2
- **"Test mode" is now "Demo mode"** (clearer for users) — same anonymous sample identity;
  labels updated across the popup and Options (storage/behavior unchanged). A seeded demo
  *account* is planned for when the hosted/paid tier adds sign-in.
- **Feedback → prefilled GitHub issue.** New "⚑ Report this page" in the popup with quick
  reasons (not detected / autofill missed / wrong sponsorship flag / other). It opens a
  prefilled issue with PII-safe context (host only, version, mode, field count) — and for
  "not detected" it also opts the site in so it works next time.
- **Clearer site control.** "Always active on this site" → "➕ Always run JobHakken on this
  site", with a one-line hint (for job/career sites we don't auto-detect).
- E2E now attaches before/after autofill screenshots so filling quality is visible in the
  report/trace.

## 0.7.1
- **Sponsorship marker now actually attaches on LinkedIn.** The job id is read from the JD
  container's stable id (`JobDetails_AboutTheJob_<id>`) rather than the URL, so it works on a
  single job-detail page (and saved pages) too. On the search list it marks/hides the job's
  **tile**; on a job-detail page (no list) it marks right next to the **job title**. Validated
  against real saved LinkedIn pages (Emerson, West Coast Solutions).
- **Marker + popup verdict are compact.** A small red "🛂 No sponsorship" pill (on the tile/
  title) and a small "🛂 Won't sponsor" chip in the popup — both reveal the full reason on
  hover, instead of a large always-on banner.
- **Autofill can be cancelled and times out.** While running, the Autofill button becomes
  "✕ Cancel" (a second click aborts). The slow AI/résumé step is bounded (20s default, 45s for
  ATS-tailored) so it never hangs — synchronous field fills are kept and reported as partial.

## 0.7.0
- **Toolbar popup is now the whole UI — the floating on-page panel is gone.** The docked
  "⚡" circle was fragile on SPA re-renders (LinkedIn/Workday); the extension is now driven
  entirely from the toolbar icon, which is always available regardless of the page. The popup
  holds everything the panel did: connection/test status, live fillable-field count, Autofill
  (+ ATS-tailored), Job insights (ATS match / visa / keywords), Draft answer, Save job, dev
  Capture, and "always active on this site". It drives the page via a content-script RPC; all
  page work still happens in the content script.
- **Sponsorship marker moved to the job tile.** Instead of a badge in the description, a
  blocked job now gets a red "🛂 No sponsorship" pill + red rail on its list card (tile).
- **New: "Hide these jobs" option** (Options → under "I need visa sponsorship"). When on,
  won't-sponsor jobs are hidden from the list rather than marked. LinkedIn reveals the full
  description only when a job is opened, so a job is judged on open; the desktop app hides
  them upfront (it has every job's full description).

## 0.6.1
- **Fix:** the sponsorship badge now matches the current LinkedIn DOM. LinkedIn ships
  obfuscated CSS classes with a stable id prefix `JobDetails_AboutTheJob_<jobId>`; the badge
  now targets `[id^="JobDetails"]` (older `#job-details` + generic `job-description` kept as
  fallbacks) and reads `textContent` so a collapsed "…show more" description is still
  classified. Validated against a real saved LinkedIn page.
- **Fix (privacy):** in test mode the popup and Options no longer show the real cached
  identity — the connection line reads **"Connected · 🧪 Test mode"** instead of your name.
- **Fix (reliability):** the on-page panel/bubble re-attaches itself if a single-page-app
  re-render (LinkedIn, Workday) drops its host, so the ⚡ icon reappears instead of vanishing.

## 0.6.0
- **Visa-sponsorship filter (local, no AI).** New Options toggle **"🛂 I need visa
  sponsorship"** (off by default). When on, job pages (LinkedIn and generic career sites)
  whose description explicitly rules out sponsorship — U.S. citizenship, a security
  clearance, "no sponsorship," or export-control (ITAR/EAR) — get a warning badge on the
  open job, and that job's list card is dimmed. Runs entirely on-device using the same
  classifier the desktop app uses (`@jobhakken/core`, validated against ~700 real jobs).
  LinkedIn list cards lack the full description, so only the opened job is judged; the
  desktop feed does the full hiding. Reflected live when toggled (no reload). E2E-guarded.

## 0.5.3
- Live connection status: the panel showed "Connected" from cached credentials even after
  the desktop app was closed. It now **polls the bridge** (on load, tab focus, every 8s),
  so closing the app flips to **Standalone** and reopening it **auto-reconnects** — the
  status reflects real reachability. Cached creds still allow standalone autofill.

## 0.5.2
- Fix the panel flashing on non-application pages (e.g. GitHub settings). The "looks like
  an application" heuristic no longer triggers on a bare count of profile fields
  (name/email/company also appear on settings pages) — it now requires a real
  job-application signal: a résumé/CV upload, or an EEO/screening field (work
  authorization, sponsorship, cover letter, salary, veteran/disability, …).

## 0.5.1
- Options → "Import from my résumé" now respects test mode: when test mode is on (the
  extension toggle, or the connected app's sandbox), Import loads the **anonymous dummy
  profile** instead of your real résumé, and the button stays usable even without a
  connection. E2E guards it.

## 0.5.0
- Auto-capture now records the **whole application flow**, not just structure: per field,
  whether it was **filled by autofill, filled manually by you, or left empty**, plus a
  PII-safe value (your details scrubbed; emails/phones/long text → shapes like `[email]`;
  short answers like "Yes"/"LinkedIn" kept). Updated live as you fill (debounced), one
  evolving record per application URL. The **manually-filled fields are the autofill gaps**
  — the key learning signal.
- Options copy clarified: **Auto-capture** = the local corpus (default on, with Export);
  **Fixture capture (developer)** = the separate one-off download tool.

## 0.4.6
- Test mode is now unmistakable + synced:
  - **Desktop app:** an app-wide amber "🧪 TEST MODE — sandbox with dummy data, your real
    jobs & résumé are safe" banner on every screen, with an "Exit test mode" button. (An
    empty test sandbox can no longer be mistaken for data loss.)
  - **Extension:** the panel's TEST banner live-syncs to the app's test mode (refreshes on
    tab focus + periodically), matching the fill behavior which already uses dummy data
    whenever the app is in its sandbox.

## 0.4.5
- Manage the sites the extension is active on:
  - **Panel:** "➕ Always open JobHakken on this site" — one click adds the current host
    (panel opens + auto-captures there); shows "✓ active" once added.
  - **Options → My sites:** list your added domains with remove (✕), plus add any domain
    by hand (e.g. `careers.company.com`). Built-in ATS list stays always-on.

## 0.4.4
- Tighten when the panel opens — the v0.4.3 gate used "any fillable field", so a lone
  search box (google.com etc.) tripped it. Now the panel opens ONLY on job-application
  pages: a known ATS host, an ATS-fingerprinted page, a user-opted-in site, or a page
  that looks like an application form (≥3 fields map to profile data, or a résumé upload).
  E2E asserts it stays hidden on a search-box page.

## 0.4.3
- Fix: the panel no longer appears on every website — it shows only on **application
  pages** (fillable fields present, or a page fingerprinted as a known ATS). This also
  makes it appear on ATS pages like Greenhouse even before the form finishes loading
  (re-evaluated on DOM changes). Starts hidden to avoid a flash on ordinary pages.

## 0.4.2
- Fix: no more "allow this site to access local device" prompt on every page. Bridge
  calls (127.0.0.1) are now proxied through the background service worker (extension
  origin) instead of fetched from the content script (page origin), which the browser
  gated behind a per-site permission prompt. Same functionality, zero prompts.

## 0.4.1
- Fix: test mode is now consistent across ALL personal data. A single `isTestActive()`
  (extension toggle OR connected-app sandbox) governs the profile **and** documents, so
  résumé upload no longer fetched the real résumé (real name) when test mode came from
  the app. AI "Draft answer" is disabled in test mode (it's grounded in the real résumé).
  Job insights / linking stay on the real connection — jobs carry no personal data.

## 0.4.0
- Redesigned on-page panel (autofill-first):
  - **Two autofill actions** with the résumé merged in — **Autofill** (your default
    résumé) and **Autofill + ATS** (résumé tailored to this job via the new
    `tailoredResumeFile` bridge RPC). No separate attach step.
  - **Job insights collapse** behind a click-to-expand bar (ATS match ring, H-1B/visa
    signal, keyword gaps) so autofill stays the focus; analyzed lazily on expand.
  - **Settings gear** in the header; **Draft answer** (AI, fills the first screening
    field) and Save as small secondary buttons.
  - **Not connected → only Autofill** is shown; all app/AI surfaces are omitted.
- Save-to-feed is stubbed ("soon") pending proper job creation.

## 0.3.2
- Test mode now **syncs with the desktop app**: a `status` bridge RPC reports the app's
  sandbox state, and the extension fills anonymous data whenever *either* its own toggle
  or the connected app is in test mode (no more mismatched modes).
- Company career sites: auto-capture now also fires when a page is **fingerprinted as an
  ATS** (Workday/Greenhouse/Lever/… running under a company domain / in an iframe), not
  just on the hostname allowlist.

## 0.3.1
- Auto-capture now scoped to a **known-ATS allowlist** (Workday, Greenhouse, Lever,
  Ashby, iCIMS, SmartRecruiters, Workable, Taleo, SuccessFactors, BambooHR, Jobvite, …)
  — no more capturing arbitrary non-application pages that happen to have a few fields.
- **Per-site opt-in**: on an unknown host, the panel offers "Capture applications on this
  site" so you decide. Everything still anonymized + local.
- Corpus storage moved to per-record keys + a small index (no more rewriting the whole
  corpus on each save) — matters for a heavy multi-day run.
- (Full form-region capture kept as the default during the discovery phase; a compact
  coverage-only format will come once the corpus shows which signals actually matter.)

## 0.3.0
- Auto-capture corpus (default on): passively snapshots every job-application page
  (≥4 fields), scrubs your personal details at source, and stores it locally
  (chrome.storage.local, `unlimitedStorage`) to learn field coverage over time. Never
  opens dropdowns / touches the form, never captures other browsing, never leaves the
  machine. Options: toggle + count + **Export corpus** + Clear.
- Aims: strengthen the offline seed/filters from real data and pinpoint where LLM calls
  are actually needed — reducing manual data entry over time.

## 0.2.4
- Cover-letter upload: your default cover-letter text (saved in the profile) is rendered
  to a PDF in-browser and attached to cover-letter file inputs on Autofill — no AI needed.
  Test mode uses the bundled dummy. Shared minimal PDF builder (lib/pdf.ts).
- E2E now also asserts the cover letter attaches.

## 0.2.3
- Real résumé upload: when connected to the desktop app, Autofill attaches your latest
  saved résumé (rendered to PDF by the app's `resumeFile` bridge RPC). Test mode still
  uses the bundled dummy PDF.
- Playwright E2E now asserts résumé upload (DataTransfer) + live lazy-combobox pick in a
  real browser — coverage jsdom can't provide.

## 0.2.2
- Answer bank: sensible default answers for common screening questions that don't map to
  a profile field — e.g. "Have you previously worked here?" → No (review confidence; a
  user rule always overrides). Desktop app gains an isolated Test Mode (Settings).

## 0.2.1
- Precision from a real live Workday capture: exclude page-chrome comboboxes (language /
  settings header menus) and anonymous framework helper inputs (hidden combobox
  value-holders) from detection. Real "My Information" coverage 17/27 → 17/20.
- New fields: Suffix, County (appear on Workday) — resolved + fillable.
- Added the live Workday "My Information" capture as a regression fixture.

## 0.2.0
- **Multi-row sections:** clicks "Add another" to create a row for every Work Experience
  and Education entry (Workday + Greenhouse), then fills each.
- **Résumé / cover-letter auto-upload** on Autofill (test mode uses a bundled dummy PDF;
  real files come from the connected desktop app / your default).
- Larger dummy test profile (extra experience + education entries) to exercise multi-row.
- Version now surfaced in the panel + Options for change tracking.

## 0.1.0
- Docked panel + popup; standalone or desktop-connected autofill.
- Generic engine: seed dictionary, learned mappings, attribute + fuzzy resolution.
- Real ATS fixtures (Greenhouse, Workday) + per-site tests.
- Fill sensitive fields by default with an opt-out.
- Workday lazy-combobox live picker + segmented date-picker fill.
- Test mode (anonymous dummy data) + Capture mode (one-click PII-safe fixtures + coverage).
- Work-experience bullet-point highlights.
