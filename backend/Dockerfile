FROM node:20-alpine

WORKDIR /usr/src/app

# 安装系统 deps:
# - font-noto / font-noto-cjk: Gotenberg 渲染 PDF 中文
# - ffmpeg: transcriptionWorker.js 把 >20MB 的音频压缩成 mono 16k MP3
#   以 fit OpenAI gpt-4o-transcribe 的 25MB 上限 (#249 audio pipeline)
RUN apk update && apk add --no-cache \
    font-noto \
    font-noto-cjk \
    ffmpeg

# 使用阿里云npm镜像
RUN npm config set registry https://registry.npmmirror.com && \
    npm install -g npm@10.2.4

COPY package*.json ./

# 安装依赖
RUN npm install

COPY . .

# 仅在生产环境删除环境文件
ARG NODE_ENV=production
RUN if [ "$NODE_ENV" = "production" ]; then rm -f .env .env.local; fi

EXPOSE 8888

# 生产环境用 node 直接运行，环境变量由 docker-compose 或运行时注入
CMD ["npm", "run", "start"]