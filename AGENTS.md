# AGENTS.md — MU College Timetable System

Rules enforced by CI. Violation = PR rejected, no exceptions, no override by review.

## Async — non-negotiable
- ALL functions touching IO (DB, HTTP, OAuth, solver trigger, file/export) are `async def`.
- Never: `requests`, `psycopg2`, `time.sleep`, sync `sqlalchemy.orm.Session`, sync Google OAuth SDK calls.
- Solver call (`ortools` CP-SAT) is CPU-bound, not IO — run via `asyncio.to_thread(solve_fn)` so event loop stays free. Never call solver directly from an async route body.
- Frontend: no blocking calls in render path; all API calls through generated client, which is async/promise-based by construction.

## Allowed libraries (see docs/STACK.md for the full approved list)
- New dependency = ask human first in PR description. CI fails if a dep not in `docs/STACK.md` appears in lockfile diff.

## Workflow
- Before coding: search repo for existing helper/constraint function. Reuse, don't reimplement.
- Smallest diff. No new file unless the task explicitly lists it. No refactor outside ticket scope.
- Plan first: reply with files to touch + libs to use. Wait for human "ok" before writing code.
- Before marking done: run `make check` locally. Paste full output in PR description.

## Do not touch without explicit human approval
- `backend/migrations/` (Alembic — human reviews every migration by hand)
- `.github/`
- `pyproject.toml` / `package.json` dependency sections
- `backend/app/services/timetable/solver.py` constraint core — any constraint change needs a corresponding update to `docs/SPEC.md` constraint table first

## Domain rules specific to this project (solver correctness > style)
- Decision variable keys on (division, batch, day, start_time, subject, teacher, room) — never collapse batch dimension.
- Lab = exactly 2 consecutive period-slots, same room, same teacher, all batches of a division simultaneously (tri-parallel rule) — see SPEC §Batch Constraints before touching this logic.
- Visiting faculty constraints (`available_days`, `available_time_range`) only activate when `teacher.employment_type == VISITING`. Never let this leak into REGULAR teacher constraint path.
- Manual admin edits lock that slot (`locked = true`); re-solve only touches unlocked slots on conflict. Never trigger a full re-generate from a single-slot edit.

## Before finishing any task
1. `make check` — must be fully green.
2. No new files outside the ones named in the task.
3. State any assumption made, in the PR description, in one line.
