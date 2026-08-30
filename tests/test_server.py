import sys

# Modify sys.argv to prevent EPG fetching during import
sys.argv = ['server.py', '--no-epg']

import pytest

from server import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_health(client):
    res = client.get("/")
    assert res.status_code in [200, 404]
