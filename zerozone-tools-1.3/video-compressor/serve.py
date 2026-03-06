#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys


class COOPCOEPHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable SharedArrayBuffer by enabling cross-origin isolation
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()


def main():
    port = 8001
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Invalid port, using default 8001")
            port = 8001

    server = HTTPServer(("", port), COOPCOEPHandler)
    print(f"Serving on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
