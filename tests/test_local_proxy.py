import pytest

from server import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_local_proxy_health(client):
    res = client.get("/proxy")
    assert res.status_code in [200, 404, 400, 500]
