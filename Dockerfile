FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
RUN npm run check
EXPOSE 3000
CMD ["npm", "start"]
