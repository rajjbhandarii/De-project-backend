FROM node:20-alpine

WORKDIR /app

# Copy package definitions
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Expose the port the server listens on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
