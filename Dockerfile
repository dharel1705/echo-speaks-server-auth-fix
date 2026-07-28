FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Expose standard communication port
EXPOSE 8580

# Re-apply project configurations
ENV hubPlatform="Hubitat"
ENV useHeroku=false

CMD [ "node", "index.js" ]
