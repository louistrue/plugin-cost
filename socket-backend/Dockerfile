FROM node:20-alpine

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Expose the WebSocket port
EXPOSE 8001

# Start the server
CMD ["node", "server.js"] 