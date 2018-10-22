const request = require('request');
const restify = require('restify');
const corsMiddleware = require('restify-cors-middleware');
const Handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const config = require('indecent');
const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');

const { chain, get, indexOf, merge, set, startCase } = require('lodash');

const mailer = nodemailer.createTransport({
  SES: new AWS.SES({ region: AWS_REGION }),
});

const cors = corsMiddleware({
  origins: ['*'],
  allowHeaders: ['*'],
  exposeHeaders: ['*']
});
 
const KNOWN_EMAILS = (process.env.KNOWN_EMAILS || '').split(',');

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_SES_MAIL_FROM = process.env.AWS_SES_MAIL_FROM;

const FORM_FIELDS = [
  '_from',
  '_subject',
  '_to',
  '_attachment'
];

const PRIVATE_FIELDS = [
  '_fake',
  '_info',
  '_next'
];

const htmlSource = fs.readFileSync(path.join(__dirname, 'html_template.hbs'), { encoding: 'utf8' });
const textSource = fs.readFileSync(path.join(__dirname, 'text_template.hbs'), { encoding: 'utf8' });
const htmlTemplate = Handlebars.compile(htmlSource);
const textTemplate = Handlebars.compile(textSource);
 
var server = restify.createServer();
server.pre(cors.preflight);
server.use(cors.actual);
server.use(restify.bodyParser());
// server.use(restify.plugins.throttle({
//   rate: 1,
//   xff: true
// }));

server.get('/status', (req, res, next) => {
  res.send('contact running');
});

server.post('/:_to', (req, res, next) => {
  const { formData, fields } = parseRequest(req);

  if (indexOf(KNOWN_EMAILS, get(formData, 'to')) < 0) {
    return next(new Error('Unknown email address'));
  }

  sendMail(fields, { formData }).then(response => {
    const redirect = get(fields, 'next');
    if (redirect) {
      res.redirect(redirect, next);
    } else {
      res.json(response);
    }

    return next();
  }).catch(error => {
    return next(error);
  });
});

function parseRequest (req) {
  const body = get(req, 'params');

  const formData = chain(body)
    .pick(FORM_FIELDS)
    .mapKeys((value, key) => key.replace('_', ''))
    .value();

  const fields = chain(body)
    .pick(PRIVATE_FIELDS)
    .mapKeys((value, key) => key.replace('_', ''))
    .value();

  const data = chain(body)
    .omit(PRIVATE_FIELDS)
    .omit(FORM_FIELDS)
    .mapKeys((value, key) => startCase(key))
    .map((value, key) => {
      return { key, value };
    })
    .value();

  set(fields, 'data', data);
  set(formData, 'html', htmlTemplate(fields));
  set(formData, 'text', textTemplate(fields));

  const attachment = get(req, 'files._attachment');
  if (attachment) {
    const filePath = get(attachment, 'path');
    const value = get(fields, 'fake') ? filePath : fs.createReadStream(filePath);

    set(formData, 'attachment', {
      value,
      options: {
        filename: get(attachment, 'name'),
        contentType: get(attachment, 'type')
      }
    });
  }

  return { data, fields, formData };
}

function sendMail (fields, params) {
  const fake = get(fields, 'fake');

  if (fake) {
    return Promise.resolve(merge({ message: 'fake response' }, params));
  }

  const { formData } = params;

  return new Promise((resolve, reject) =>
    mailer.sendMail({
      from: AWS_SES_MAIL_FROM,
      attachments: [formData.attachment],
      ...formData,
    }, (error, info) => {
      if (error) return reject(error);
      resolve(info, { messageId: info.messageId });
    })
  );
}

server.listen(
  process.env.PORT || 3000,
  process.env.HOST || '0.0.0.0',
  () => { 
    console.log(`${server.name} listening at ${server.url}`);
  }
);

