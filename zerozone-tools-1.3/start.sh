#!/bin/bash
# ZeroZone Tools 启动脚本

if command -v python3 &>/dev/null; then
    echo "正在启动集成服务器..."
    open http://localhost:8080 2>/dev/null || true
    python3 server.py
else
    echo "错误: 未找到 python3。请安装 Python 3。"
fi
