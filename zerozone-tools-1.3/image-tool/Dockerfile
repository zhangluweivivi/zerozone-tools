FROM nginx:1.27-alpine

# 使用 Nginx 作为静态文件服务器
WORKDIR /usr/share/nginx/html

# 清理默认文件
RUN rm -rf ./*

# 拷贝前端静态资源
COPY . .

# 默认暴露 80 端口
EXPOSE 80

# 保持与官方 nginx 镜像一致的入口
CMD ["nginx", "-g", "daemon off;"]

