from fastapi.testclient import TestClient

from backend.app.main import app


def test_model_status_websocket_reports_status_payload():
    client = TestClient(app)

    with client.websocket_connect("/ws/live") as websocket:
        websocket.send_json({"type": "get_model_status"})
        payload = websocket.receive_json()

        assert payload["type"] == "model_status"
        assert "llmReady" in payload
        assert "whisperReady" in payload
        assert "ttsReady" in payload
        assert "installing" in payload
