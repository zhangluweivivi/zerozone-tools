import http.server
import socketserver
import os

PORT = 8080
DIRECTORY = "."  # 服务当前目录

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # 必须为整个站点添加这两个 Header，才能让 iframe 中的 wasm 正常运行
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"正在启动 ZeroZone Tools 集成服务...")
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"✅ 服务已启动: http://localhost:{PORT}")
        print("请按 Ctrl+C 停止服务")
        httpd.serve_forever()
