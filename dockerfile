# ---------- 1. Temel imaj ----------
    FROM node:18-slim

    # ---------- 2. Chromium + bağımlılıklar ----------
    RUN apt-get update && \
        apt-get install -y --no-install-recommends \
            chromium \
            fonts-liberation \
            libappindicator3-1 \
            libasound2 \
            libatk-bridge2.0-0 \
            libatk1.0-0 \
            libcups2 \
            libdbus-1-3 \
            libgdk-pixbuf2.0-0 \
            libnspr4 \
            libnss3 \
            libx11-xcb1 \
            libxcomposite1 \
            libxdamage1 \
            libxrandr2 \
            libu2f-udev \
            libvulkan1 \
            xdg-utils && \
        apt-get clean && \
        rm -rf /var/lib/apt/lists/*
    
    # ---------- 3. Puppeteer’ın kendi tarayıcısını indirmesini engelle ----------
    ENV PUPPETEER_SKIP_DOWNLOAD=true
    
    # ---------- 4. Sistem Chromium’un yolunu uygulamaya aktar ----------
    ENV CHROMIUM_PATH=/usr/bin/chromium
    
    # ---------- 5. Uygulama dosyaları ----------
    WORKDIR /app
    
    # 5‑a Önce package.json → cache katmanı
    COPY package*.json ./
    RUN npm ci --omit=dev   # production bağımlılıkları
    
    # 5‑b Kodun geri kalanı
    COPY . .
    
    # ---------- 6. Ağ ----------
    EXPOSE 5000
    
    # ---------- 7. Başlat ----------
    CMD ["node", "server.js"]
    