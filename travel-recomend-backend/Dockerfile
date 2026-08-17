FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV PORT=3300
EXPOSE 3300
CMD ["node", "src/index.js"]
