import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent


class HandCamera:
    def __init__(self):
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = None
        self.running = False
        self.hand = None
        self.jpeg = None
        self.error = None
        self.startup = None

    def start(self, camera_index=0):
        with self.lock:
            if self.running:
                return
            if self.thread and self.thread.is_alive():
                raise RuntimeError("カメラを終了しています。しばらくしてから再試行してください。")
            self.stop_event.clear()
            self.hand = None
            self.jpeg = None
            self.error = None
            self.startup = threading.Event()
            self.thread = threading.Thread(
                target=self._capture, args=(camera_index, self.startup), daemon=True
            )
            self.thread.start()
            startup = self.startup

        if not startup.wait(timeout=15):
            self.stop()
            raise RuntimeError("カメラの起動がタイムアウトしました。他のアプリで使用されていないか確認してください。")
        with self.lock:
            if self.error:
                raise RuntimeError(self.error)

    def stop(self):
        self.stop_event.set()
        thread = self.thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=3)
        with self.lock:
            if not thread or not thread.is_alive():
                self.running = False
                self.hand = None
                self.jpeg = None

    def state(self):
        with self.lock:
            return {
                "running": self.running,
                "hand": self.hand,
                "error": self.error,
            }

    def image(self):
        with self.lock:
            return self.jpeg

    def _capture(self, camera_index, startup):
        capture = None
        hands = None
        try:
            import cv2
            import mediapipe as mp

            capture = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW if hasattr(cv2, "CAP_DSHOW") else cv2.CAP_ANY)
            if not capture.isOpened():
                raise RuntimeError(
                    f"カメラ {camera_index} を開けません。デバイスの接続とカメラの権限を確認してください。"
                )
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            hands = mp.solutions.hands.Hands(
                static_image_mode=False,
                max_num_hands=1,
                model_complexity=0,
                min_detection_confidence=0.55,
                min_tracking_confidence=0.5,
            )
            with self.lock:
                self.running = True
            startup.set()

            while not self.stop_event.is_set():
                ok, frame = capture.read()
                if not ok:
                    raise RuntimeError("カメラ映像を取得できません。カメラの接続を確認してください。")
                result = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                hand = None
                if result.multi_hand_landmarks:
                    tip = result.multi_hand_landmarks[0].landmark[8]
                    hand = {"x": round(tip.x, 5), "y": round(tip.y, 5)}
                    height, width = frame.shape[:2]
                    cv2.circle(
                        frame,
                        (int(tip.x * width), int(tip.y * height)),
                        9,
                        (100, 241, 255),
                        2,
                    )
                encoded, buffer = cv2.imencode(
                    ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75]
                )
                if not encoded:
                    raise RuntimeError("カメラのプレビュー映像をエンコードできません。")
                with self.lock:
                    self.hand = hand
                    self.jpeg = buffer.tobytes()
                time.sleep(0.015)
        except Exception as error:
            message = str(error) or error.__class__.__name__
            if error.__class__.__name__ == "ModuleNotFoundError":
                message = "カメラ用ライブラリがありません。pip install -r requirements.txt を実行してください。"
            with self.lock:
                self.error = message
                self.running = False
            if not startup.is_set():
                startup.set()
            if not self.stop_event.is_set():
                print(f"カメラエラー：{message}", flush=True)
        finally:
            if hands is not None:
                hands.close()
            if capture is not None:
                capture.release()
            with self.lock:
                self.running = False
                self.hand = None
                self.jpeg = None
            startup.set()


camera = HandCamera()


class GameHandler(BaseHTTPRequestHandler):
    def _json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._file(ROOT / "index.html", "text/html; charset=utf-8")
        elif path == "/space-background.svg":
            self._file(ROOT / "space-background.svg", "image/svg+xml; charset=utf-8")
        elif path == "/api/hand":
            self._json(200, camera.state())
        elif path == "/camera.jpg":
            image = camera.image()
            if image is None:
                self.send_error(404, "カメラのプレビューはまだ準備できていません")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(image)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(image)
        else:
            self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/camera/start", "/api/camera/stop"):
            self.send_error(404)
            return
        try:
            if path == "/api/camera/start":
                camera_index = int(self.headers.get("X-Camera-Index", "0"))
                if camera_index < 0:
                    raise ValueError("カメラ番号は0以上にしてください。")
                camera.start(camera_index)
            else:
                camera.stop()
            self._json(200, camera.state())
        except (RuntimeError, ValueError) as error:
            self._json(503, {"error": str(error), **camera.state()})

    def _file(self, path, content_type):
        if not path.is_file():
            self.send_error(404)
            return
        payload = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}", flush=True)


def main():
    host = "127.0.0.1"
    port = 8000
    server = ThreadingHTTPServer((host, port), GameHandler)
    print(f"SPACE LINE 起動：http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサービスを終了しています…", flush=True)
    finally:
        camera.stop()
        server.server_close()


if __name__ == "__main__":
    main()
