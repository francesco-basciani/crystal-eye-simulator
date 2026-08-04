# CE-REL-20260804-github-pages-release

## Authorization and scope

- Date: 2026-08-04 (Europe/Rome).
- Author authorization: commit and publish the current corrected simulator to
  `francesco-basciani/crystal-eye-simulator`, then verify GitHub Pages.
- Baseline GitHub `main`: `9f135e685a88106d75a7c65219344994bce5c48f`.
- Scope: the accumulated simulator, ECI replay, photon-history, orbital
  configuration, UI reorganization, tests, scripts, and provenance changes in
  the current `crystal-eye-simulator/` worktree.
- No changes to `Materiale/`, `Appunti/`, the manuscript, repository
  visibility, Pages permissions, or external services were authorized.

## Pre-publication controls

- Git worktree and untracked files were enumerated before staging.
- No `.openai/`, environment file, credential, private key, or common token
  signature was included.
- A generated Python bytecode cache was excluded, and `.gitignore` was updated
  for `__pycache__/` and `*.py[cod]`.
- `npm ci` reproduced dependencies from `package-lock.json` using Node 22.
- `npm test`: **PASS**, 22/22 tests.
- `npm run lint`: **PASS**.
- `npm run build:pages`: **PASS**; static routes `/`, `/ephemeris`, and
  `/photon-history` were generated under the GitHub Pages base path.
- `git diff --check`: **PASS**.

## Dependency-audit limitation

`npm audit --omit=dev` reported three high-severity advisory groups involving
the installed Next.js/PostCSS/Sharp dependency tree. The suggested automatic
fix would force Next.js 16.3.0 outside the declared dependency range and was
not applied because dependency upgrades require a separate author decision and
regression cycle. This release is exported as static files on GitHub Pages: it
does not deploy a Next.js server, Server Actions, middleware, image optimizer,
or attacker-controlled build inputs. The advisories remain an explicit open
maintenance item rather than being silently ignored.

## Publication mechanism

The existing `.github/workflows/deploy-pages.yml` triggers on pushes to
`main`, runs `npm ci` and `npm run build:pages`, uploads `out/`, and deploys it
with the official GitHub Pages actions. The release commit and workflow run are
identified by the repository history and GitHub Actions deployment associated
with this record.

