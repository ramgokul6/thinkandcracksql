# Data2Dashboard (D2D) · Crack SQL

Think independently before asking AI for SQL.

**Business problem → understand schema → explain thinking → see a reference SQL answer → validate in DB Fiddle.**

## Learning flow

1. Sign in with Google, then pick a domain and difficulty. The first unfinished exercise opens automatically.
2. Explain the solution naturally in one thinking box—what is needed, which data applies, the approach and how to check it.
3. The learner selects **Check My Thinking** after writing the complete response. Only then does the app display the score and coaching. The rubric scores the requested result (2), data (2), scenario-specific approach (4) and output check (2), normalized to 10.
4. When the scenario rubric is ready, the learner chooses **Generate SQL** to reveal its authored reference query. There are no marks for length or unrelated SQL keywords.
5. Copy the scenario schema and sample data, then open DB Fiddle and run the reference SQL there. DB Fiddle results are not returned to Crack SQL.
6. Learners confirm that they ran and checked the query in DB Fiddle; that confirmation unlocks the next exercise. Progress is self-reported, not independently verified.

Changing reasoning recalculates the score immediately and clears the DB Fiddle confirmation. Thinking and progress survive reloads.

## Thinking evaluator: scope and limits

The evaluator is a deterministic English-language, scenario-specific rubric, not an LLM or proof of understanding. It checks explanations against expected sources, comparisons, relationships, grouping, calculations and boundaries, and gives missing-point feedback. The reference SQL is revealed only after the required thinking score.

Natural phrases such as “keep only”, “sum”, “total”, “average” and “link” are accepted. A valid unfamiliar paraphrase can still be missed, and deliberately crafted prose can satisfy rules without real understanding. Do not use this score to certify competence. Future semantic coaching needs independently evaluated model behavior, privacy choices and a server-side integration; no API keys are required for this release.

The web app does not include or run a database engine. Reference queries are checked by the developer test suite against PostgreSQL-compatible fixtures; learners validate them in DB Fiddle. A learner's DB Fiddle results are not transmitted back to Crack SQL.

## Scenario bank

The catalog contains **420 distinct exercises**: 360 across the six required domains and 60 in Retail as an additional domain. Each domain has 20 exercises at each level.

| Domain | Beginner | Intermediate | Expert | Total |
|---|---:|---:|---:|---:|
| Banking | 20 | 20 | 20 | 60 |
| Healthcare | 20 | 20 | 20 | 60 |
| Insurance | 20 | 20 | 20 | 60 |
| Capital Markets | 20 | 20 | 20 | 60 |
| Semiconductor | 20 | 20 | 20 | 60 |
| Education | 20 | 20 | 20 | 60 |
| Retail (extra) | 20 | 20 | 20 | 60 |

Fixtures cover boundaries, missing activity, status combinations, grouping, joins, subqueries, CTEs and window functions. Run `pnpm build:scenarios` after changing the generator; the committed JSON is the deployable artifact.

[data/scenarios.json](data/scenarios.json) contains scenarios, identity aliases, schema/sample data and authored reasoning rubrics. Every reference query is executed in PostgreSQL tests. Execution tests are not an exhaustive proof of every business interpretation.

## Progress and accounts

- Sign-in is required before domain selection or challenge participation; there is no guest practice mode.
- Each signed-in account has a separate local-storage key and cloud progress record.
- Thinking score ready, DB Fiddle opened and learner-confirmed practice are distinct states.
- Legacy imports require explicit learner action.
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

### Admin dashboard and Challenge of the Day

After `002_learning_progress.sql`, run [migrations/003_admin_challenge.sql](migrations/003_admin_challenge.sql). Use the admin-role SQL comment at the end of that migration to assign `app_role=admin` to your own signed-in email, then sign out and back in. The trusted role is stored in Supabase app metadata; both the page and database check it.

The dashboard summarizes sign-ins, scenarios opened and confirmed, thinking scores, SQL-generation events, and DB Fiddle launches. The dashboard does not display ordinary scenario responses, though the existing progress sync stores those responses in the learner's cloud progress so they can resume on another device. Challenge participants intentionally submit their contest explanation and SQL; admins can review those entries. Activity counts do not prove a query was run.

An admin can publish a challenge with start/end times and judging/tie-break rules in the prompt. The database reserves places atomically and caps each challenge at 25 participants. Participants submit their reasoning in plain English; writing SQL is optional. The current setup models one ₹500 winner; an admin records the winner after the challenge closes, and payment is handled separately. The admin form suggests an eight-queens SQL puzzle. No challenge is published automatically.

After a learner confirms all 420 prepared exercises, the home page offers **Generate a new scenario**. It creates 399 additional domain- and level-matched exercises from reviewed templates and values present in the current sample data. The scenarios use stable IDs, so progress can sync across signed-in devices. The generated bank has 12 Beginner, 13 Intermediate and 32 Expert variants per domain. It does not call an AI service; query templates are tested against the matching schemas and each generated query returns fixture rows.

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

Tests cover the 420 prepared and 399 generated reference queries using PGlite/PostgreSQL as a developer-only test dependency, rubric examples and negative inputs, account isolation, reset merging, migration/RLS protections, late cloud responses, and the mobile/browser learning flow. The web app does not load PGlite. Live OAuth, admin-role setup, the new Supabase migration, and production challenge operation still need deployment verification.

## Offline releases

The service worker precaches application modules and data together. Missing assets fail installation instead of silently producing partial caches. Bump its cache version whenever publishing changed app/data files. A waiting update activates after existing app tabs close, avoiding mixed-version modules. The Supabase CDN and DB Fiddle require internet.

## Files

- index.html: responsive UI and styles
- js/app.js: learning flow and account integration
- js/thinking.js: scenario-specific reasoning checks
- js/progress.js: local storage, migration, stages and merging
- js/cloud.js: serialized cloud sync with session guards
- js/schema.js: schema visualization
- js/scenario-generator.js: reviewed domain templates for additional scenarios after the prepared bank is completed
- js/sql-evaluator.js: PostgreSQL fixture checks used by developer tests only; not loaded by the web app
- data/scenarios.json: 420 exercises, schemas, fixtures and rubrics
- scripts/build-scenarios.mjs: reproducible scenario catalog generator
- migrations/002_learning_progress.sql: cloud progress model
- migrations/003_admin_challenge.sql: admin telemetry and challenge participation
- tests/scenario-generator.test.js: generated reasoning and SQL checks
- tests/: regression, PostgreSQL and browser tests

Certificates are intentionally not implemented by this change. Practice confirmation is self-reported and is not a trustworthy certificate record; certificate issuance needs a server-side assessment and eligibility decision.

The browser app uses no database engine. PGlite is only a package used by developer tests to validate the scenario catalog; its bundled browser files are not included in the project or deployment.

© Data2Dashboard (D2D) · Ramgokul Jeyakumar. All rights reserved.
