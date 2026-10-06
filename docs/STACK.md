# STACK.md — Approved libraries, by job

Anything not listed here needs human sign-off before it enters a lockfile. CI diffs the lockfile against this list.

## Backend
| Job | Library | Notes |
|---|---|---|
| Web framework | FastAPI | async routes only |
| ORM | SQLAlchemy 2.0 (async engine) | never sync `Session` |
| DB driver | asyncpg | via SQLAlchemy async engine |
| DB host | PostgreSQL (Neon) | dev branch per PR via Neon branching |
| Migrations | Alembic | human-reviewed, autogenerate then edit |
| Validation / schemas | Pydantic v2 | request/response models |
| HTTP client (outbound) | httpx (AsyncClient) | never `requests` |
| Constraint solver | Google OR-Tools CP-SAT (`ortools`) | see SPEC — CP-SAT chosen over backtracking, see rationale below |
| Auth | Google OAuth via `authlib` (async flow) | teacher login |
| Background CPU work | `asyncio.to_thread` | wraps solver call only, nothing else |
| PDF export | reportlab | matches reference project |
| Excel export | openpyxl | matches reference project |
| Testing | pytest + pytest-asyncio | |
| Lint | ruff | ASYNC, TID251 banned-api rules on |
| Types | pyright (strict) | |
| Static pattern check | semgrep (custom rules in `.semgrep/`) | enforces async route handlers |
| Dep audit | pip-audit | |
| Package manager | uv | lockfile `uv.lock` committed |

## Frontend
| Job | Library | Notes |
|---|---|---|
| Framework | React + TypeScript | |
| Build | Vite | |
| Routing | TanStack Router | |
| Styling | Tailwind | |
| API client | generated via `openapi-typescript` / `orval` from backend OpenAPI spec | never hand-written fetch/axios |
| Forms | react-hook-form | |
| Lint | ESLint (`no-restricted-imports` bans axios/raw fetch) | |
| Types | `tsc --noEmit` strict | |
| Dead code | knip | |
| Format | Prettier | |
| Test | Vitest | |
| Dep audit | npm audit | |

## Repo-wide
| Job | Tool |
|---|---|
| Secret scan | gitleaks |
| Duplicate code | jscpd |
| PR size gate | danger-js or equivalent script, fail over ~400 line diff |
| CI | GitHub Actions |
| Branch protection | required on `main`, CI green + 1 CODEOWNERS review, includes admins |

## Why CP-SAT over backtracking (for this project)
Reference school project used recursive backtracking with 7 pure-function constraints — fine at small scale, fragile at MU college scale: mixed lecture/lab durations, dynamic batch count, dynamic room pool, 11 hard + 6 soft constraints. CP-SAT (Google OR-Tools):
- Declares all constraints once, lets the SAT engine search — no hand-rolled recursion/timeout/retry loop.
- Natively supports soft constraints via weighted objective (no need for a separate "relax and retry" code path).
- Proven feasible/infeasible with structured conflict info, instead of "1000 attempts failed, guess why."
- Scales to thousands of boolean variables in seconds — matches reference project's own numbers (18 classes × 6 days × 7 periods × 5 subjects ≈ 7k vars, solved in seconds).
No better alternative needed here — Choco/CPLEX add license cost or JVM dependency for no real gain at this scale.
