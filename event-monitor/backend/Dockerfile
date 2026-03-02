FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]
