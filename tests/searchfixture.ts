// A made-up Library for tests/search.test.ts's query set: about sixty skills, twenty agents and ten MCP servers that read like
// real ones, each with a name, a description and a paragraph of text, as src/searchdocs.ts would make them. Every word here
// was written for this file; none is copied from a real plugin. Two skills are a plugin's own rows (acme-devkit), one skill
// (standup) is kept Off, and a skill and an agent share the name code-reviewer.
import { rowId } from '../src/itemrow.ts';
import type { SearchDoc } from '../src/search.ts';

type Item = [key: string, description: string, text: string, name?: string];

const skills: Item[] = [
  ['pr-review', 'Reviews a pull request for bugs, missing tests and unclear names before it is merged.', 'Read the diff against the base branch, then list each problem with its file and line. Group findings by severity and suggest a fix for each. Never approve a change whose tests fail.'],
  ['terraform-plan', 'Runs terraform plan and explains what each resource change would do.', 'Run terraform plan -out plan.bin in the module folder, then sum up creates, updates and destroys. Flag anything that replaces a database or a load balancer.'],
  ['kubernetes-rollout', 'Rolls out a new image to a Kubernetes deployment and watches it become healthy.', 'Use kubectl set image, then kubectl rollout status with a timeout. If pods crash in a loop, roll back with kubectl rollout undo and collect the last logs.'],
  ['postgres-migrations', 'Writes and checks Postgres schema migrations.', 'Each migration gets an up and a down step. Avoid locking large tables: add columns as nullable first, backfill in batches, then add the constraint.'],
  ['release-notes', 'Drafts release notes from the merged pull requests since the last tag.', 'List features, fixes and breaking changes. Link each line to its pull request and thank outside contributors by handle.'],
  ['commit-message', 'Writes a commit message in the imperative mood with a short summary line.', 'Keep the summary under fifty characters, explain the why in the body and reference the issue number.'],
  ['docker-compose', 'Writes a compose file for a local development stack.', 'Pin image versions, name the volumes, and add healthchecks so that dependent services wait for the database.'],
  ['pdf-forms', 'Fills in PDF forms and lists the fields they hold.', 'Read the field names first, then write the values into the form and save a flattened copy.\nscripts/fill_form.py\nscripts/list_fields.py'],
  ['slide-deck', 'Builds a slide deck for a presentation from an outline.', 'One idea per slide, a title that states the point, and speaker notes under each slide. Export to PDF for sharing.'],
  ['spreadsheet-cleanup', 'Cleans a spreadsheet: trims cells, fixes dates and removes duplicate rows.', 'Find the header row, write date columns as ISO 8601, and report how many rows were dropped.'],
  ['accessibility-audit', 'Audits a web page for accessibility problems.', 'Check contrast, alt text, focus order and ARIA roles. Run axe in the browser and explain each violation in plain words.'],
  ['web-performance', 'Finds why a web page loads slowly.', 'Profile with Lighthouse and the network panel. Look for render-blocking scripts, oversized images and long tasks on the main thread.'],
  ['unit-tests-first', 'Writes failing unit tests before the code that makes them pass.', 'Red, green, refactor: write the smallest test that fails for the behaviour, then just enough code to pass it.'],
  ['translate-strings', 'Translates an app’s interface strings into other languages.', 'Keep placeholders such as {count} intact, respect plural rules, and leave product names as they are.'],
  ['sql-query-helper', 'Writes SQL queries against a database schema you describe.', 'Prefer explicit joins, name every column, and add a LIMIT while exploring.'],
  ['log-search', 'Searches server logs for errors around a given time.', 'Grep by timestamp, follow a request id across services, and show the five lines before each stack trace.'],
  ['incident-report', 'Writes a blameless incident report after an outage.', 'A timeline, the impact, the root cause, what went well, and action items with owners.'],
  ['api-design', 'Reviews a REST API design for consistent names and status codes.', 'Plural nouns for collections, 201 for created, 404 or 410 for gone, and pagination with cursors.'],
  ['graphql-schema', 'Designs a GraphQL schema from a domain model.', 'Use connections for lists and input types for mutations, and deprecate fields instead of removing them.'],
  ['react-hooks', 'Explains and fixes problems with React hooks.', 'A useEffect without a dependency array runs after every render; move derived values into useMemo and keep refs for timers.'],
  ['css-layout', 'Fixes page layout with flexbox and grid.', 'Use grid for two-dimensional layouts and flex for a single row, and avoid fixed heights.'],
  ['git-bisect', 'Finds the commit that broke something with git bisect.', 'Mark one good and one bad commit, script the check, and let git bisect run do the rest.'],
  ['dependency-upgrade', 'Upgrades a project’s dependencies one at a time and runs the tests after each.', 'Read each changelog for breaking changes and keep lockfile changes in their own commit.'],
  ['security-review', 'Looks for common security mistakes in a change.', 'Injection, unsafe deserialisation, missing authorization checks and open redirects.'],
  ['resume-writer', 'Writes a résumé shaped to a job description.', 'Lead with results, put numbers on the impact, and keep it to one page.'],
  ['meeting-notes', 'Turns a meeting transcript into notes with decisions and action items.', 'Name who owns each action and by when, and keep decisions apart from discussion.'],
  ['email-reply', 'Drafts a polite reply to an email.', 'Match the sender’s tone, answer each question in order, and end with a clear next step.'],
  ['k8s-debug', 'Debugs a pod that will not start.', 'kubectl describe pod, then read the events: image pull errors, OOMKilled restarts and failing probes.'],
  ['helm-chart', 'Writes a Helm chart for a service.', 'A values.yaml with sensible defaults, and templates for the deployment, the service and the ingress.'],
  ['aws-cost', 'Explains a cloud bill and finds savings.', 'Group by service, then look for idle EC2 instances, unattached volumes and old snapshots.'],
  ['python-packaging', 'Packages a Python library with pyproject.toml.', 'Use a src layout, declare dependencies with ranges, build a wheel and try it in a fresh venv.'],
  ['rust-errors', 'Explains Rust compiler errors and borrow checker complaints.', 'Read the error code, then choose between cloning, borrowing, or changing who owns the value.'],
  ['regex-builder', 'Builds and explains a regular expression.', 'Anchor the pattern, escape dots, and test it against examples that should not match.'],
  ['data-chart', 'Turns a table of numbers into a clear chart.', 'A bar chart for comparisons and a line chart for change over time; label both axes with units.'],
  ['ci-pipeline', 'Writes a CI pipeline that builds and tests on every push.', 'Cache dependencies, run jobs side by side, and stop early on lint errors.'],
  ['code-reviewer', 'Reviews code style and structure in the files you name.', 'Point at long functions, unclear names and dead code, and suggest smaller units.'],
  ['onboarding-guide', 'Writes a getting-started guide for new contributors.', 'Clone, install, run the tests, make a first change, and link the code map.'],
  ['figma-to-code', 'Turns a design frame into HTML and CSS.', 'Measure spacing from the design tokens and keep each component small.'],
  ['mobile-release', 'Prepares an iOS and Android release.', 'Bump the build numbers, write the store notes, and run the release checklist.'],
  ['cron-schedule', 'Writes and explains cron schedules.', 'Five fields: minute, hour, day of the month, month and day of the week.'],
  ['json-schema', 'Writes a JSON Schema for a sample document.', 'Required fields, enums for fixed values, and additionalProperties false for strict objects.'],
  ['openapi-client', 'Generates a typed API client from an OpenAPI file.', 'Read the paths and components, generate one function per request, and keep generated files out of review.'],
  ['bash-script', 'Writes a careful bash script.', 'set -euo pipefail, quote every variable, and trap errors to clean up temporary files.'],
  ['c++', 'Answers questions about templates and memory.', 'Prefer unique_ptr, RAII and std::span over raw pointers.', 'C++'],
  ['c#', 'Answers questions about LINQ and async code.', 'Prefer records for data, and await every task you start.', 'C#'],
  ['latex-paper', 'Formats a paper in LaTeX.', 'Use the class the venue gives, BibTeX for references, and figures as vector PDF.'],
  ['contract-summary', 'Sums up a contract in plain words.', 'List the obligations, dates, renewal terms and termination clauses.'],
  ['support-macro', 'Writes replies for common support tickets.', 'Greet, restate the problem, give the steps, and invite a reply.'],
  ['seo-check', 'Checks a page’s titles, descriptions and headings for search engines.', 'One h1, unique titles, canonical links and a sitemap.'],
  ['storybook-stories', 'Writes Storybook stories for a UI component.', 'One story per state: empty, loading, error and full.'],
  ['vector-search', 'Sets up semantic search over documents.', 'Chunk the documents, embed them, and keep the vectors in pgvector with an index.'],
  ['load-test', 'Writes a load test and reads its results.', 'Ramp up users slowly, watch p95 latency and the error rate, and stop at the first saturation.'],
  ['feature-flags', 'Puts a feature flag around new code.', 'Default off, remove the flag once it is fully rolled out, and test both paths.'],
  ['timezone-bugs', 'Finds time zone and daylight saving bugs.', 'Store UTC, convert at the edges, and test the hour that repeats in autumn.'],
  ['sqlite-tuning', 'Speeds up slow SQLite queries.', 'EXPLAIN QUERY PLAN, covering indexes, and WAL mode for readers that run at once.'],
  ['deploy-staging', 'Deploys the current branch to the staging environment.', 'Build the image, push it to the registry, update the staging service, and post its address in the team channel.'],
  ['product-brief', 'Writes a one-page product brief.', 'The problem, who has it, what success looks like, and what is out of scope.'],
  ['dashboard-metrics', 'Chooses the metrics for a team dashboard.', 'A few leading indicators, each with an owner and a target.'],
  ['markdown-tables', 'Formats data as Markdown tables.', 'Align the columns, escape pipes, and keep wide tables to six columns.'],
  // Names a person types from their start. The words alone rank handoff above them for "to-": its description holds "to" five times.
  ['to-prd', 'Turns a conversation into a product requirements document and files it as an issue.', 'Ask what problem it solves, list the users, write the scope and what is left out, then open the issue with the document as its body.'],
  ['to-issues', 'Splits a plan into small issues that can each be picked up alone.', 'Read the plan, cut it into thin slices from end to end, and open one issue per slice with what done means.'],
  ['todo-sweep', 'Collects the TODO comments in a codebase into a list of tasks.', 'Search for TODO and FIXME, group them by module, and drop the ones that are already done.'],
  ['auto-triage', 'Labels new bugs by area and how bad they are.', 'Read each report, choose a label, and ask for the steps to reproduce when they are missing.'],
  ['handoff', 'Hands work over to another agent: what to keep, what to drop, where to go next and how to pick it up.', 'Write down what to read first, what to try next and what to leave to the next agent, and tell it how to run the tests.'],
  ['standup', 'Writes a short daily update.', 'Yesterday, today and blockers: three lines, each under twenty words, with the ticket numbers you touched.'],
];
/** A plugin's own rows: their key is plugin@marketplace/name (pluginrows.ts pageRows), and they are named by the item and its plugin. */
const pluginSkills: Item[] = [
  ['acme-devkit@acme-tools/changelog-writer', 'Keeps a CHANGELOG.md in step with each release.', 'Group entries under Added, Changed and Fixed, newest version first.', 'changelog-writer'],
  ['acme-devkit@acme-tools/api-mocker', 'Starts a mock server from an OpenAPI file.', 'Serve example responses for every path, with a delay to try loading states.', 'api-mocker'],
];
const agents: Item[] = [
  ['code-reviewer', 'Use this agent after a feature is written, to review it for correctness and style.', 'You are a careful reviewer. Read the changed files, run the tests, and report problems ordered by how much they would hurt a user.'],
  ['security-reviewer', 'Use this agent to check a change for security problems before it is merged.', 'You look for injection, broken access control and unsafe file handling, and you explain how each could be used.'],
  ['test-writer', 'Writes the tests a module is missing.', 'Find the public functions without tests, write one example per behaviour, and keep each test short.'],
  ['debugger', 'Investigates a failing or flaky test, or a crash, and finds its cause.', 'Reproduce first, then narrow it down by halving the inputs; never guess a fix before the cause is known.'],
  ['architect', 'Plans a feature across modules before any code is written.', 'Name the modules it touches, the data it stores, and the order to build it in.'],
  ['docs-writer', 'Writes and updates documentation.', 'Start from what a reader wants to do, show a working example, then the details.'],
  ['refactorer', 'Simplifies code without changing what it does.', 'Small steps, tests green after each, and no new features on the way.'],
  ['sql-analyst', 'Answers questions about data by writing SQL.', 'Ask which table holds the facts, check row counts, and show the query beside the answer.'],
  ['ux-copywriter', 'Rewrites interface text to be short and clear.', 'Use the words people use, put the action first, and cut every word that does no work.'],
  ['performance-profiler', 'Finds hot paths and memory leaks.', 'Take a profile under real load, look at the top frames, and compare heap snapshots over time.'],
  ['migration-planner', 'Plans a move between frameworks or major versions.', 'List what breaks, move one module at a time, and keep both running until the last one moves.'],
  ['triage-bot', 'Labels and routes new issues.', 'Read the title and body, add a type and an area label, and ask for steps when they are missing.'],
  ['release-manager', 'Runs a release from freeze to tag.', 'Freeze the branch, collect the notes, tag the version, and announce it.'],
  ['data-scientist', 'Explores a dataset and fits simple models.', 'Look at distributions first, keep a holdout set, and report uncertainty with every number.'],
  ['devops-engineer', 'Writes infrastructure as code and build pipelines.', 'Everything in version control, environments made from the same templates, and no manual steps.'],
  ['api-tester', 'Calls an API and checks its responses against its spec.', 'Try each endpoint with good and bad input, and compare status codes and bodies with the spec.'],
  ['product-manager', 'Turns a request into a spec with acceptance criteria.', 'Who asked, what problem it solves, and how we will know it is done.'],
  ['translator', 'Translates documents while keeping their formatting.', 'Keep headings, lists and code blocks as they are, and translate only the prose.'],
  ['tutor', 'Explains a concept step by step for a learner.', 'Ask what they know, build from there, and check understanding with a small exercise.'],
  ['explorer', 'Maps an unfamiliar codebase and says where to start.', 'Read the entry points, follow one request end to end, and write down the main modules.'],
];
const servers: Item[] = [
  ['github', 'Command · npx -y @example/github-mcp', 'npx -y @example/github-mcp'],
  ['postgres', 'Command · npx -y @example/postgres-mcp --read-only postgresql://localhost/app', 'npx -y @example/postgres-mcp --read-only postgresql://localhost/app'],
  ['filesystem', 'Command · npx -y @example/fs-server /Users/me/projects', 'npx -y @example/fs-server /Users/me/projects'],
  ['linear', 'URL · https://mcp.linear.example/sse', 'https://mcp.linear.example/sse'],
  ['sentry', 'URL · https://mcp.sentry.example/mcp', 'https://mcp.sentry.example/mcp'],
  ['browser', 'Command · uvx browser-driver-mcp --headless', 'uvx browser-driver-mcp --headless'],
  ['slack', 'Command · node /opt/slack-bridge/index.js', 'node /opt/slack-bridge/index.js'],
  ['memory', 'Command · npx -y @example/memory-graph', 'npx -y @example/memory-graph'],
  ['kubernetes', 'Command · kubectl-mcp serve --context staging', 'kubectl-mcp serve --context staging'],
  ['docs-search', 'URL · https://docs.example.dev/mcp', 'https://docs.example.dev/mcp'],
];

/** Each item as a document; a plugin's own row is named by its item's name, and gives its plugin's apart (its key is both, with the marketplace). */
const docs = (page: 'skills' | 'mcp' | 'agents', items: Item[]): SearchDoc[] => items.map(([key, description, text, name]) =>
  ({ id: rowId(page, key), ...(key.includes('/') ? { names: [name!], plugin: key.split('@')[0] } : { names: name ? [key, name] : [key] }), description, text }));
export const library: SearchDoc[] = [...docs('skills', skills), ...docs('skills', pluginSkills), ...docs('agents', agents), ...docs('mcp', servers)];
