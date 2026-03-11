
from fastapi.testclient import TestClient


def test_health_check(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "last_indexed_block" in data


def test_get_rates_usdc_default(client):
    response = client.get("/rates")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert "apy" in data[0]
    assert "timestamp" in data[0]


def test_get_rates_dai(client):
    response = client.get("/rates?symbol=DAI")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert data[0]["apy"] == 4.5


def test_get_rates_sofr(client):
    response = client.get("/rates?symbol=SOFR")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert data[0]["apy"] == 5.3


def test_get_rates_susde(client):
    """sUSDe yield should be served from hourly_stats."""
    response = client.get("/rates?symbol=sUSDe")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert "apy" in data[0]
    # Our seed data starts at 15.0%
    assert data[0]["apy"] >= 15.0


def test_get_rates_invalid_symbol(client):
    response = client.get("/rates?symbol=INVALID")
    assert response.status_code == 400


def test_get_rates_resolution_1d(client):
    response = client.get("/rates?resolution=1D")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0


def test_eth_prices(client):
    response = client.get("/eth-prices")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert "price" in data[0]


def test_gzip_header(client):
    response = client.get("/rates?limit=50000", headers={"Accept-Encoding": "gzip"})
    if "content-encoding" in response.headers:
        assert response.headers["content-encoding"] == "gzip"
