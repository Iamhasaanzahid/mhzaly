FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

COPY server/ ./
COPY site/ ./site/

EXPOSE 8788
CMD ["node", "index.js"]
