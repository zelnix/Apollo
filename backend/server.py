"""Supervisor entrypoint (`uvicorn server:app`). The real application lives in backend/app/main.py."""
from app.main import app  # noqa: F401
