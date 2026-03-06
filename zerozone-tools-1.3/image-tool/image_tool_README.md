# 图片处理工具

纯前端、本地运行的批量图片裁剪与压缩工具。所有处理在浏览器完成，不会上传图片。

## 功能概览
- 批量导入、处理、下载（支持单张下载与 ZIP 打包下载）
- 裁剪模式：`9:16`、`1:1`、`3:4`、`自由裁剪`
  - 固定比例：显示对应虚线框，可拖动位置，大小锁定比例
  - 自由裁剪：默认 9:16，可拖动 8 个控制点改大小；贴近 `1:1` / `3:4` 时自动吸附并切换模式
- 压缩：最长边 1280（可调），目标体积默认 100KB，二分搜索质量逼近
- 导出格式：WebP（推荐）/ PNG

## 本地直接使用
1. 打开 `index.html`（Chrome / Edge / Safari 14+）。
2. 拖拽或选择多张图片。
3. 选择裁剪模式与压缩参数，点击“开始处理所有图片”。
4. 单张下载或“打包下载所有结果 (.zip)”。

## 部署到 ECS（Docker + Nginx）
已提供 `Dockerfile` 和 `.dockerignore`，镜像基于 `nginx:alpine` 纯静态部署。

### 构建镜像
```bash
cd image-tool
docker build -t image-tool:latest .
```

### 本地运行测试
```bash
docker run -d --name image-tool -p 8080:80 image-tool:latest
# 打开 http://localhost:8080
```

### 推送与 ECS 部署（示例）
```bash
# 登录并推送到你的镜像仓库（示例以阿里云 ACR 为例）
docker tag image-tool:latest <registry>/<namespace>/image-tool:latest
docker push <registry>/<namespace>/image-tool:latest

# ECS 上运行
docker run -d --name image-tool -p 80:80 <registry>/<namespace>/image-tool:latest
```

> 若需 HTTPS，可在 ECS 上使用反向代理（如 Nginx/Traefik）或云负载均衡配置证书。

## 依赖说明
- 运行时仅需浏览器，功能依赖 Canvas、WebP 支持与 JSZip（通过 CDN 加载）。
- 无需后端服务或构建步骤，静态资源即可。

## 兼容性与注意事项
- WebP 需现代浏览器（Safari 14+）。
- PNG 不支持质量参数，体积不一定接近目标大小。
- 批量下载时若浏览器拦截，请允许弹出下载；ZIP 打包可避免多次弹窗。 


