FROM node:20-alpine
WORKDIR /app
COPY boutika-server/package.json boutika-server/
RUN cd boutika-server && npm install --omit=dev
COPY boutika-server boutika-server
COPY www www
ENV BOUTIKA_DATA=/data PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["node", "boutika-server/src/server.js"]
