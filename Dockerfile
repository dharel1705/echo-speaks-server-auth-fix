FROM node:20-alpine

# Install Chromium browser dependencies inside the container OS
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

# Tell Puppeteer to use the container's built-in Chromium binary path
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8580

ENV hubPlatform="Hubitat"
ENV useHeroku=false

CMD [ "node", "index.js" ]
