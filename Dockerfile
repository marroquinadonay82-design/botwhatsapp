FROM node:18-slim

# 1. Instalar Chromium y dependencias necesarias manualmente
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Configurar variables para que el bot sepa dónde está el navegador
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

# 3. Instalar dependencias del bot
COPY package*.json ./
RUN npm install

COPY . .

# 4. Arrancar el bot
CMD [ "npm", "start" ]
