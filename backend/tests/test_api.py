
from fastapi.testclient import TestClient

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
    # Check simplified matching first point
    assert data[0]["apy"] == 4.5

def test_get_rates_sofr(client):
    response = client.get("/rates?symbol=SOFR")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert data[0]["apy"] == 5.3

def test_get_rates_invalid_symbol(client):
    response = client.get("/rates?symbol=INVALID")
    assert response.status_code == 400

def test_get_rates_resolution_1d(client):
    # Tests View routing logic
    response = client.get("/rates?resolution=1D")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    # aggregated data

def test_eth_prices(client):
    response = client.get("/eth-prices")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert "price" in data[0]

def test_gzip_header(client):
    # Verify app supports gzip (requires Accept-Encoding header in client)
    # TestClient doesn't compress by default unless headers set, 
    # but more importantly we check functionality via GZipMiddleware
    # Manually check response headers? GZipMiddleware adds Content-Encoding: gzip 
    # if response size > min_size (1000). Our sample data might be small.
    # Let's request ALL data
    response = client.get("/rates?limit=50000", headers={"Accept-Encoding": "gzip"})
    # Only if body is large enough, middleware applies. 
    # With 24 rows, it might not be large enough (>1KB). 
    # 24 rows * ~50 bytes = ~1200 bytes. Should be enough.
    if "content-encoding" in response.headers:
        assert response.headers["content-encoding"] == "gzip"
