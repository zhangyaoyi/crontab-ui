#!/usr/bin/env node
'use strict';

const crontab = require('../crontab.js');

const jobId = process.argv[2];

if (!jobId) {
  console.error('A job ID is required');
  process.exit(1);
}

crontab.runjob(jobId);
