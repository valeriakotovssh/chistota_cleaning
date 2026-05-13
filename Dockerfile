FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
