#!/usr/bin/env node
'use strict';

const fs = require('fs');
const nodemailer = require('nodemailer');
const crontab = require('../crontab.js');

const jobId = process.argv[process.argv.length - 3];
const stdoutPath = process.argv[process.argv.length - 2];
const stderrPath = process.argv[process.argv.length - 1];

function loadServerConfig() {
  const configPath = process.env.CRONTAB_UI_MAIL_CONFIG;
  if (!configPath) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function renderTemplate(value, job) {
  if (typeof value !== 'string') return value;
  return value
    .replaceAll('{{jobName}}', job.name || job._id)
    .replaceAll('{{jobId}}', job._id);
}

crontab.get_crontab(jobId, (job) => {
  if (!job) {
    console.error(`Unable to find cron job ${jobId}`);
    process.exitCode = 1;
    return;
  }

  let serverConfig;
  try {
    serverConfig = loadServerConfig();
  } catch (error) {
    console.error(`Unable to load mail configuration: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const transporterConfig = serverConfig?.transporter
    || job.mailing?.transporter
    || job.mailing?.transporterStr;
  const configuredOptions = serverConfig?.mailOptions || job.mailing?.mailOptions;

  if (!transporterConfig || !configuredOptions) {
    console.error('Mail transport or message options are not configured');
    process.exitCode = 1;
    return;
  }

  const transporter = nodemailer.createTransport(transporterConfig);
  const mailOptions = { ...configuredOptions };

  for (const field of ['subject', 'text', 'html']) {
    mailOptions[field] = renderTemplate(mailOptions[field], job);
  }

  mailOptions.attachments = [
    { filename: 'stdout.txt', path: stdoutPath },
    { filename: 'stderr.txt', path: stderrPath },
  ];

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log(`Message sent: ${info.response}`);
  });
});
