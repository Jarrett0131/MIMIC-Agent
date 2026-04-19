from __future__ import annotations

import uvicorn

from app.config import APP_PORT


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=APP_PORT)
