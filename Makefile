.PHONY: check check-backend check-frontend

check: check-backend
# check: check-backend check-frontend   # restore once frontend exists

check-backend:
	cd backend && uv run ruff format --check .
	cd backend && uv run ruff check . --output-format=github
	cd backend && uv run pyright
	@echo "NOTE: semgrep skipped locally (no native Windows binary) - runs in CI on every push."
	cd backend && uv run alembic upgrade head && uv run alembic check
	cd backend && uv run pytest

check-frontend:
	cd frontend && npm run lint
	cd frontend && npx tsc --noEmit
	cd frontend && npx knip
	cd frontend && npm run gen:api && git diff --exit-code
	cd frontend && npx prettier --check .
	cd frontend && npm test && npm run build