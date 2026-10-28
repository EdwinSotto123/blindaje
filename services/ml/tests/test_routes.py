from __future__ import annotations

import base64


def test_health_shape(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert set(body["models"]) == {"voice", "text", "image", "audioseal", "videoseal"}
    assert body["models"]["voice"]["dim"] == 192
    assert body["models"]["videoseal"]["dim"] == 256
    assert body["models"]["text"]["dim"] == 384
    assert body["models"]["image"]["dim"] == 384
    assert body["indices"] == {"voz": 0, "voz_segmento": 0, "texto": 0, "imagen": 0}
    assert body["index_version"] is None
    assert body["versions"]["service"]
    assert body["cohort"] == {"size": 0}


def test_all_contract_routes_exist(client):
    spec = client.get("/openapi.json").json()["paths"]
    paths = {(m.upper(), p) for p, ops in spec.items() for m in ops}
    expected = {
        ("GET", "/health"),
        ("POST", "/audio/normalize"),
        ("POST", "/voice/enroll"),
        ("POST", "/voice/embed"),
        ("POST", "/voice/compare"),
        ("POST", "/text/embed"),
        ("POST", "/image/crops"),
        ("POST", "/image/redact"),
        ("POST", "/video/sample"),
        ("POST", "/video/frame"),
        ("POST", "/index/add"),
        ("POST", "/index/search"),
        ("POST", "/index/remove"),
        ("POST", "/index/rebuild"),
        ("GET", "/index/snapshot"),
        ("POST", "/index/load"),
        ("POST", "/graph/analyze"),
        ("POST", "/pdf/render"),
        ("POST", "/authenticity/audio"),
        ("POST", "/authenticity/image"),
        ("POST", "/authenticity/video"),
    }
    assert expected <= paths


def test_token_required_when_configured(make_client):
    c = make_client(token="secreto-de-prueba")
    assert c.get("/health").status_code == 401
    assert c.get("/health", headers={"x-ml-token": "otro"}).status_code == 401
    assert c.get("/health", headers={"x-ml-token": "secreto-de-prueba"}).status_code == 200
    r = c.post("/graph/analyze", json={"nodes": [], "edges": []})
    assert r.status_code == 401
    assert r.json() == {"error": "unauthorized"}


def test_no_token_when_not_configured(client):
    assert client.get("/health").status_code == 200


def test_validation_errors_do_not_echo_input(client):
    secret = "texto muy sensible de la victima"
    r = client.post("/text/embed", json={"texts": [secret], "kind": "otra-cosa"})
    assert r.status_code == 422
    assert secret not in r.text
    assert r.json()["error"] == "invalid_request"


def test_body_too_large(make_client):
    c = make_client(max_body_mb="0.001")
    r = c.post("/audio/normalize", content=b"x" * 5000)
    assert r.status_code == 413


def test_text_embed_with_fake(client):
    r = client.post("/text/embed", json={"texts": ["pago por yape", "pago por yape"], "kind": "passage"})
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == 384 and len(body["vectors"]) == 2
    assert body["vectors"][0] == body["vectors"][1]


def test_bad_base64_is_422(client):
    r = client.post("/image/redact", json={"image_b64": "@@@no-es-base64@@@", "regions": []})
    assert r.status_code == 422
    assert r.json()["error"].startswith("invalid_")


def test_data_url_base64_accepted(client):
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    r = client.post("/image/redact", json={"image_b64": data_url, "regions": []})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
