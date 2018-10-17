FROM node:8.12

RUN mkdir /app
WORKDIR /app

COPY ./package.json ./package-lock.json /app/
RUN npm install

COPY . /app

CMD ["npm", "run", "start"]

