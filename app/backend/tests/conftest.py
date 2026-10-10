import sys
from pathlib import Path

import pytest

# Make `src` importable when running pytest from app/backend/
sys.path.insert(0, str(Path(__file__).parent.parent))


def pytest_configure(config):
    config.addinivalue_line("markers", "asyncio: mark test as async")
