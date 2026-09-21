'use strict';

const Datastore = require('@seald-io/nedb');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const { CronExpressionParser } = require('cron-parser');
const cronstrue = require('cronstrue/i18n');

const humanCronLocale = process.env.HUMANCRON ?? 'en';

const dbFolder = process.env.CRON_DB_PATH || path.join(__dirname, 'crontabs');
console.log(`Cron db path: ${dbFolder}`);

const logFolder = path.join(dbFolder, 'logs');
const envFile = path.join(dbFolder, 'env.db');
const crontabDbFile = path.join(dbFolder, 'crontab.db');
const backupPrefix = 'crontab-ui-backup-';

function formatLocalTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${offsetSign}${pad(Math.floor(absoluteOffset / 60))}${pad(absoluteOffset % 60)}`;

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${offset}`;
}

const db = new Datastore({ filename: crontabDbFile, autocompactionInterval: 60000 });

let cronPath = '/tmp';
if (process.env.CRON_PATH !== undefined) {
  console.log(`Path to crond files set using env variables ${process.env.CRON_PATH}`);
  cronPath = process.env.CRON_PATH;
}

db.loadDatabase((err) => {
  if (err) throw err;
});

if (!fs.existsSync(logFolder)) {
  fs.mkdirSync(logFolder);
}

function buildCrontab(name, command, schedule, stopped, logging, mailing) {
  return {
    name,
    command,
    schedule,
    ...(stopped !== null && { stopped }),
    timestamp: new Date().toString(),
    logging,
    mailing: mailing || {},
  };
}

function makeCommand(tab) {
  const stderr = path.join(cronPath, `${tab._id}.stderr`);
  const stdout = path.join(cronPath, `${tab._id}.stdout`);
  const logFile = path.join(logFolder, `${tab._id}.log`);
  const logFileStdout = path.join(logFolder, `${tab._id}.stdout.log`);

  let cmd = tab.command;
  if (cmd[cmd.length - 1] !== ';') {
    cmd += ';';
  }

  let result = `({ ${cmd} } | tee ${stdout})`;
  result = `(${result} 3>&1 1>&2 2>&3 | tee ${stderr}) 3>&1 1>&2 2>&3`;
  result = `(${result})`;

  if (tab.logging && tab.logging === 'true') {
    result += `; if test -f ${stderr}; then date >> "${logFile}"; cat ${stderr} >> "${logFile}"; fi`;
    result += `; if test -f ${stdout}; then date >> "${logFileStdout}"; cat ${stdout} >> "${logFileStdout}"; fi`;
  }

  if (tab.hook) {
    result += `; if test -f ${stdout}; then ${tab.hook} < ${stdout}; fi`;
  }

  if (tab.mailing && JSON.stringify(tab.mailing) !== '{}') {
    const mailer = path.join(__dirname, 'bin', 'crontab-ui-mailer.js');
    result += `; "${process.execPath}" "${mailer}" "${tab._id}" "${stdout}" "${stderr}"`;
  }

  return result;
}

function makeRunnerCommand(tab) {
  const runner = path.join(__dirname, 'bin', 'crontab-ui-runner.js');
  return `"${process.execPath}" "${runner}" "${tab._id}"`;
}

function addEnvVars(envVars, command) {
  if (envVars) {
    return `(${envVars.replace(/\s*\n\s*/g, ' ').trim()}; (${command}))`;
  }
  return command;
}

function getLastRunAt(tab) {
  if (tab.lastRunAt) return tab.lastRunAt;

  const outputFiles = [
    path.join(cronPath, `${tab._id}.stdout`),
    path.join(cronPath, `${tab._id}.stderr`),
  ];
  const lastModified = outputFiles.reduce((latest, file) => {
    try {
      return Math.max(latest, fs.statSync(file).mtimeMs);
    } catch (_error) {
      return latest;
    }
  }, 0);

  return lastModified ? new Date(lastModified).toISOString() : null;
}

exports.db_folder = dbFolder;
exports.log_folder = logFolder;
exports.env_file = envFile;
exports.crontab_db_file = crontabDbFile;

exports.create_new = (name, command, schedule, logging, mailing) => {
  const tab = buildCrontab(name, command, schedule, false, logging, mailing);
  tab.created = Date.now();
  tab.saved = false;
  db.insert(tab);
};

exports.update = (data) => {
  const tab = buildCrontab(data.name, data.command, data.schedule, null, data.logging, data.mailing);
  tab.saved = false;
  db.update({ _id: data._id }, tab);
};

exports.status = (_id, stopped) => {
  db.update({ _id }, { $set: { stopped, saved: false } });
};

exports.remove = (_id) => {
  db.remove({ _id }, {});
};

exports.crontabs = (callback) => {
  db.find({}).sort({ created: -1 }).exec((err, docs) => {
    if (err) {
      console.error(err);
      return callback([]);
    }
    for (const doc of docs) {
      doc.lastRunAt = getLastRunAt(doc);
      if (doc.schedule === '@reboot') {
        doc.next = 'Next Reboot';
      } else {
        try {
          doc.human = cronstrue.toString(doc.schedule, { locale: humanCronLocale });
          doc.next = CronExpressionParser.parse(doc.schedule).next().toString();
        } catch (e) {
          console.error(e);
          doc.next = 'invalid';
        }
      }
    }
    callback(docs);
  });
};

exports.get_crontab = (_id, callback) => {
  db.find({ _id }).exec((err, docs) => {
    callback(docs[0]);
  });
};

exports.runjob = (_id, callback = () => {}) => {
  db.find({ _id }).exec((err, docs) => {
    if (err) return callback(err);
    if (!docs.length) return callback(new Error(`Job not found: ${_id}`));
    const res = docs[0];
    const envVars = exports.get_env();
    let cmd = makeCommand(res);
    cmd = addEnvVars(envVars, cmd);

    db.update({ _id }, { $set: { lastRunAt: new Date().toISOString() } }, {}, (updateError) => {
      if (updateError) {
        console.error(updateError);
        return callback(updateError);
      }

      console.log('Running job');
      console.log(`ID: ${_id}`);
      console.log(`Original command: ${res.command}`);
      console.log(`Executed command: ${cmd}`);

      exec(cmd, (error) => {
        if (error) console.log(error);
      });
      callback();
    });
  });
};

exports.set_crontab = (envVars, callback) => {
  exports.crontabs((tabs) => {
    let crontabString = '';
    if (envVars) {
      crontabString += `${envVars}\n`;
    }
    for (const tab of tabs) {
      if (!tab.stopped) {
        crontabString += `${tab.schedule} ${makeRunnerCommand(tab)}\n`;
      }
    }

    fs.writeFile(envFile, envVars, (err) => {
      if (err) {
        console.error(err);
        return callback(err);
      }
      const fileName = process.env.CRON_IN_DOCKER !== undefined ? 'root' : 'crontab';
      fs.writeFile(path.join(cronPath, fileName), crontabString, (err) => {
        if (err) {
          console.error(err);
          return callback(err);
        }
        exec(`crontab ${path.join(cronPath, fileName)}`, (err) => {
          if (err) {
            console.error(err);
            return callback(err);
          }
          db.update({}, { $set: { saved: true } }, { multi: true });
          callback();
        });
      });
    });
  });
};

exports.get_backup_names = () => {
  const backups = fs.readdirSync(dbFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && (entry.name.startsWith(backupPrefix) || entry.name.startsWith('backup ')))
    .map((entry) => entry.name);

  backups.sort((a, b) => {
    const aMtime = fs.statSync(path.join(dbFolder, a)).mtimeMs;
    const bMtime = fs.statSync(path.join(dbFolder, b)).mtimeMs;
    return bMtime - aMtime;
  });
  return backups;
};

exports.backup = (callback) => {
  const timestamp = formatLocalTimestamp(new Date());
  const dest = path.join(dbFolder, `${backupPrefix}${timestamp}.db`);
  fs.copyFile(crontabDbFile, dest, (err) => {
    if (err) {
      console.error(err);
      return callback(err);
    }
    callback();
  });
};

exports.restore = (dbName) => {
  fs.createReadStream(path.join(dbFolder, dbName))
    .pipe(fs.createWriteStream(crontabDbFile));
  db.loadDatabase();
};

exports.reload_db = () => {
  db.loadDatabase();
};

exports.get_env = () => {
  if (fs.existsSync(envFile)) {
    return fs.readFileSync(envFile, 'utf8').replace('\n', '\n');
  }
  return '';
};

exports.import_crontab = () => {
  exec('crontab -l', (error, stdout) => {
    const lines = stdout.split('\n');
    const namePrefix = Date.now();

    lines.forEach((line, index) => {
      line = line.replace(/\t+/g, ' ');
      const regex = /^((@[a-zA-Z]+\s+)|(([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+))/;
      const command = line.replace(regex, '').trim();
      const schedule = line.replace(command, '').trim();

      let isValid = false;
      try {
        isValid = CronExpressionParser.parse(schedule) !== null;
      } catch (_e) { /* ignore */ }

      // Lines generated by crontab-ui itself are already tracked in the db.
      const isManaged = /crontab-ui-runner\.js"?\s+"?[^\s"]+"?\s*$/.test(command);

      if (command && schedule && isValid && !isManaged) {
        const name = `${namePrefix}_${index}`;
        db.findOne({ command, schedule }, (err, doc) => {
          if (err) throw err;
          if (!doc) {
            exports.create_new(name, command, schedule, null);
          } else {
            doc.command = command;
            doc.schedule = schedule;
            exports.update(doc);
          }
        });
      }
    });
  });
};

exports.preview_crontab = (envVars, callback) => {
  exports.crontabs((tabs) => {
    let crontabString = '';
    if (envVars) {
      crontabString += `${envVars}\n`;
    }
    for (const tab of tabs) {
      if (!tab.stopped) {
        crontabString += `${tab.schedule} ${makeRunnerCommand(tab)}\n`;
      }
    }
    callback(crontabString);
  });
};

exports.autosave_crontab = (callback) => {
  const envVars = exports.get_env();
  exports.set_crontab(envVars, callback);
};
