FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=America/Bahia DATA_DIR=/data
RUN apk add --no-cache tzdata
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--no-warnings", "server/index.js"]
