# Think and Crack SQL

Think independently before asking AI for SQL.

**Business problem → understand schema → explain thinking → improve the plan → write SQL → validate in DB Fiddle → record practice.**

## Learning flow

1. Pick a domain and difficulty. The first unfinished exercise opens automatically.
2. Explain the business result, data sources, reasoning steps and expected output/checks.
3. Check thinking. The rubric scores goal (2), sources (2), scenario-specific steps (4) and output checks (2), normalized to 10.
4. All core goal/source/step checks and at least 8/10 unlock SQL writing. There are no marks for length or unrelated SQL keywords.
5. Write your own PostgreSQL query. Copy schema/data and query separately into DB Fiddle and run there.
6. Record the observed result and confirm you checked it. Progress is **self-reported practice**, not independently validated success.
7. Next opens unfinished work. Suggested reasoning and reference SQL are available only after practice confirmation.

Editing reasoning invalidates its assessment and subsequent stages. Editing SQL invalidates DB Fiddle/confirmation status. Drafts survive reloads.

## Thinking evaluator: scope and limits

The evaluator is a deterministic English-language, scenario-specific rubric, not an LLM or proof of understanding. It checks explanations against expected sources, comparisons, relationships, grouping, calculations and boundaries, and gives missing-point feedback without revealing reference SQL.

Natural phrases such as “keep only”, “sum”, “total”, “average” and “link” are accepted. A valid unfamiliar paraphrase can still be missed, and deliberately crafted prose can satisfy rules without real understanding. Do not use this score to certify competence. Future semantic coaching needs independently evaluated model behavior, privacy choices and a server-side integration; no API keys are required for this release.

SQL correctness is checked by the learner in external DB Fiddle. The app receives no execution results and does not claim automatic validation.

## Scenario bank

240 legacy IDs map to **94 distinct exercises**. Exact duplicate SQL within a domain was consolidated, including repeats across levels. Retained canonical IDs stay stable; aliases preserve old history without inflating counts.

| Domain | Beginner | Intermediate | Expert | Total |
|---|---:|---:|---:|---:|
| Banking | 14 | 5 | 5 | 24 |
| Healthcare | 14 | 5 | 5 | 24 |
| Insurance | 14 | 5 | 4 | 23 |
| Retail | 14 | 5 | 4 | 23 |

Corrections include Banking status ownership; Healthcare specialization/city ownership; explicit thresholds, sorting, ranges and classification bands; deterministic first-five and previous-row ordering; separate product IDs when names repeat; and explicit inclusion/exclusion rules for aggregates. Fixtures include boundary values, missing activity and tied dates.

[data/scenarios.json](data/scenarios.json) contains scenarios, migration aliases, schema/sample data and authored reasoning rubrics. Every reference query is executed in PostgreSQL tests. Execution tests are not an exhaustive proof of every business interpretation.

## Progress and accounts

- Guest and signed-in accounts have separate local-storage keys.
- Thinking, SQL draft, DB Fiddle opened, answer viewed and practiced are distinct states.
- Guest imports and legacy imports require explicit learner action.
- Legacy “completed” entries import only as **answer viewed**, since the old app awarded completion when revealing SQL.
- Local drafts are saved immediately. Cloud updates are debounced and serialized.
- Cloud merges happen atomically per exercise; reset timestamps prevent old offline work restoring cleared progress.
- Account checks on both client and server reject writes/late responses from a previous account.
- Offline simultaneous edits to the same exercise use last-edit timestamps. Device clock differences can affect conflict resolution.

## Supabase setup and rollout

For a new project, run [supabase_setup.sql](supabase_setup.sql) first. For both existing and new projects, run:

**[migrations/002_learning_progress.sql](migrations/002_learning_progress.sql)**

The migration is repeatable. It creates a separate RLS-protected learning_progress table and an authenticated merge function. Existing profiles and legacy progress are preserved. The function checks the expected user ID, locks the user's row and merges edits/reset timestamps.

Apply this migration before publishing the app. Without it, local practice works and the UI reports unavailable cloud sync, with a retry button. Existing magic-link redirect settings still need to allow the deployed site origin.

The browser uses a Supabase publishable key, never a service-role key. Progress remains user-editable practice data; it must not be treated as a trusted certificate record.

## Local development and tests

No build step is required. Serve the repository root over HTTP, for example with Python's http.server on port 8080. Opening index.html directly as a file will not work with JavaScript modules and JSON loading.

Use Node 24 and pnpm:

~~~sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
~~~

If using a preinstalled browser instead, set PLAYWRIGHT_CHANNEL to msedge or chrome before running tests.

Tests cover all 94 reference queries using PGlite/PostgreSQL, rubric examples and negative inputs, account/guest isolation, reset merging, migration/RLS behavior, late cloud responses, and the mobile/browser/offline learning flow. Browser auth is mocked; production magic links and the deployed Supabase project are not exercised.

## Offline releases

The service worker precaches application modules and data together. Missing assets fail installation instead of silently producing partial caches. Bump its cache version whenever publishing changed app/data files. A waiting update activates after existing app tabs close, avoiding mixed-version modules. The Supabase CDN and DB Fiddle require internet; offline guest practice remains available.

## Files

- index.html: responsive UI and styles
- js/app.js: learning flow and account integration
- js/thinking.js: scenario-specific reasoning checks
- js/progress.js: local storage, migration, stages and merging
- js/cloud.js: serialized cloud sync with session guards
- js/schema.js: schema visualization
- data/scenarios.json: 94 exercises and legacy aliases
- migrations/002_learning_progress.sql: cloud progress model
- tests/: regression, PostgreSQL and browser tests

Certificates are not implemented by this change. The existing approved certificate design is not modified.

© Ramgokul Jeyakumar. All rights reserved.
