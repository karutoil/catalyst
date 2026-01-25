# Aero Backend - Dockerfile

FROM node:20-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ curl

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src
COPY tsconfig.json ./
COPY prisma ./prisma

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Start backend
CMD ["npm", "start"]
