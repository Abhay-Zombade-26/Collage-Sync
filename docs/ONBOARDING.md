# Team Onboarding: Read This First

## The one idea
Our repo has robots (CI) that check every PR. If your code breaks a rule,
the PR is **rejected automatically** with a message saying why.
You do not need to remember all rules. Just run the checks and fix what they say.

AI coding agents write code that *works* but often breaks our rules
(too long, wrong library, sync instead of async). The robots catch that.

## Files to read (in this order, 10 minutes)
1. `docs/SPEC.md`    what we are building
2. `docs/STACK.md`   which libraries we use for which job
3. `AGENTS.md`       rules your AI agent must follow

## Setup (once)
````bash
git clone <repo-url>
cd <repo>
git checkout main && git pull
# frontend
cd frontend && npm ci
# install git hooks (checks run on every commit)
pre-commit install
````
Then run `make check` once. It must be green before you touch anything.
If it is not green on a fresh clone, tell the team lead. Do not fix it yourself.

## Working on a task (every time)
1. Pick ONE small task. Create a branch from main:
   `git checkout -b feat/short-name`
2. Open your AI agent. Start with this message:

   > Read AGENTS.md, docs/STACK.md, docs/SPEC.md.
   > Task: <one sentence>.
   > Allowed files: <list>.
   > First reply with a PLAN only: files you will edit and libraries you will use.
   > Do not write code until I say ok.

3. Read the plan. If it adds new files, new libraries, or big code for a
   small job, say no and ask for a smaller plan.
4. Say "ok, implement". Keep the diff small.
5. Run `make check`. Fix every error. Repeat until green.
6. Push and open a PR. Fill the checklist.

## API calls (frontend)
- Never write fetch/axios by hand.
- Use the generated client. After backend changes run `npm run gen:api`.
- If an endpoint you need is missing, ask the backend dev. Do not fake it.

## If CI rejects your PR
This is normal. It is not a punishment.
1. Open the failed check on the PR, read the error message. It says what rule broke and how to fix.
2. Paste the error into your AI agent:
   > CI failed with this error. Fix it following AGENTS.md. Smallest change only.
3. Run `make check`, push again.

## Never do
- Push directly to `main` (blocked anyway)
- Add a library without asking
- Edit `.github/`, `migrations/`, `pyproject.toml`, `package.json` deps without lead approval
- Disable a lint rule or add `# noqa` / `eslint-disable` to make an error go away
- Create new files "just in case"
- Merge with red CI

## Stuck?
- Rule unclear: read `AGENTS.md`
- Check seems wrong: tell the lead, do not bypass it
- Not sure where to start: pick the first ticket labeled `good-first-task`
````
````

# Step 4: Make sure friend actually follows it

Docs alone not enough. Do these:

1. **Make first ticket tiny.** Example: "add one button + wire to generated client". He runs the whole flow once, with you watching or reviewing. Rules learned by doing, not reading.
2. **Call 15 min, tomorrow start.** Share screen. Show: clone, `make check`, plan-first prompt, one deliberate CI failure and fix. Do this live once.
3. **CODEOWNERS** with you as owner on sensitive files. Friend cannot sneak in deps or CI edits.
4. **Review his first 2-3 PRs hard.** After that CI + habit carry it.
5. **Watch for bypass.** `eslint-disable`, `# noqa`, `type: ignore` spikes = he is dodging the robots. Can add a CI check that counts them and fails if they grow.
6. **Fix CI errors that confuse people.** Every time friend asks "what this error mean?", improve that rule's message. The guardrail gets better, the guide stays short.

# Quick check before tomorrow

- [ ] CI + docs merged to `main`
- [ ] Branch protection ON, includes admins
- [ ] `make check` green on a fresh clone (test it yourself in a new folder)
- [ ] `ONBOARDING.md`, PR template committed
- [ ] First tiny ticket written
- [ ] Friend added to repo with write access (not admin)

Command names in guide (`make check`, `npm run gen:api`) are placeholders. Change to match your repo.

Want a version for backend teammates too (async rules, Alembic steps)? Or a short "first ticket" example for friend?