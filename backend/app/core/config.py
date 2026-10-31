"""Runtime configuration loaded from environment variables.

Environment variables are read with python-dotenv using the same loading
pattern as app/db/session.py: backend/.env is preferred, otherwise the ambient
environment is used. The RSA signing keys are read from disk at import time so
a missing key fails loudly here instead of producing broken tokens later.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]

_ENV_PATH = BACKEND_DIR / ".env"
if _ENV_PATH.exists():
    load_dotenv(dotenv_path=_ENV_PATH)
else:
    load_dotenv()


def _read_key_file(setting_name: str) -> str:
    """Return the PEM contents of the key file named by an env var.

    Raises:
        RuntimeError: if the variable is unset or points at a missing file.
    """
    raw_path = os.getenv(setting_name, "").strip()
    if not raw_path:
        raise RuntimeError(
            f"{setting_name} is not set. Add it to backend/.env (see backend/.env.example) "
            "and generate the keypair with: "
            "openssl genrsa -out backend/keys/jwt_private.pem 2048"
        )

    key_path = Path(raw_path)
    if not key_path.is_absolute():
        key_path = BACKEND_DIR / key_path
    if not key_path.is_file():
        raise RuntimeError(
            f"{setting_name} points at a missing file: {key_path}. "
            "Generate the keypair with: "
            "openssl genrsa -out backend/keys/jwt_private.pem 2048"
        )

    return key_path.read_text(encoding="utf-8")


JWT_PRIVATE_KEY = _read_key_file("JWT_PRIVATE_KEY_PATH")
JWT_PUBLIC_KEY = _read_key_file("JWT_PUBLIC_KEY_PATH")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
REFRESH_COOKIE_NAME = "refresh_token"
# Set COOKIE_SECURE=true in production so the refresh cookie is only sent over HTTPS.
# It defaults to false so local HTTP development and the test client keep working.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes"}
