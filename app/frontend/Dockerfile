# --- Stage 1: Build Stage ---
FROM node:20-slim AS build

WORKDIR /app

# Define the argument
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL:-/api}

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build the Vite project
COPY . .
RUN npm run build

# --- Stage 2: Production Stage ---
FROM nginx:stable-alpine AS production

# Copy the static files from the build stage to Nginx's default public folder
COPY --from=build /app/dist /usr/share/nginx/html

# Copy a custom nginx config to handle React Router and API proxying
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
