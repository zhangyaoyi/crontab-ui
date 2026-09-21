'use strict';

/* global serverMailConfigured */

/*********** MessageBox ****************/

function getModal(id) {
  return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
}

function initThemeToggle() {
  var toggle = document.getElementById('theme-toggle');
  var icon = document.getElementById('theme-icon');
  if (!toggle || !icon) return;

  function renderThemeIcon() {
    var isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    icon.className = isDark ? 'bi bi-sun' : 'bi bi-moon-stars';
    toggle.title = isDark ? 'Use light theme' : 'Use dark theme';
  }

  renderThemeIcon();
  toggle.addEventListener('click', function() {
    var isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    var nextTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', nextTheme);
    localStorage.setItem('crontab-ui-theme', nextTheme);
    renderThemeIcon();
  });
}

function formatLastRunTimes() {
  document.querySelectorAll('.last-run-time').forEach(function(element) {
    var date = new Date(element.getAttribute('datetime'));
    if (Number.isNaN(date.getTime())) {
      element.textContent = 'Unknown';
      return;
    }
    element.textContent = date.toLocaleString();
    element.title = date.toString();
  });
}

function filterJobTables(value) {
  var query = String(value || '').trim().toLocaleLowerCase();
  var visibleTotal = 0;

  document.querySelectorAll('.category-panel').forEach(function(panel) {
    var visibleInCategory = 0;
    panel.querySelectorAll('.job-row').forEach(function(row) {
      var matches = !query || row.dataset.search.includes(query);
      row.hidden = !matches;
      if (matches) visibleInCategory += 1;
    });

    panel.hidden = visibleInCategory === 0;
    var count = panel.querySelector('.category-visible-count');
    if (count) count.textContent = visibleInCategory;
    visibleTotal += visibleInCategory;
  });

  var total = document.getElementById('visible-job-count');
  if (total) total.textContent = visibleTotal;

  var empty = document.getElementById('no-search-results');
  if (empty) empty.hidden = visibleTotal !== 0;
}

function showCommand(_id) {
  var job = crontabs.find(function(crontab) { return crontab._id === _id; });
  if (!job) return;

  document.getElementById('command-viewer-title').textContent = job.name || 'Untitled job';
  document.getElementById('command-viewer-content').textContent = job.command || '';
  document.getElementById('copy-command-button').innerHTML = '<i class="bi bi-clipboard me-1"></i> Copy';
  getModal('command-viewer-modal').show();
}

function copyJobCommand() {
  var text = document.getElementById('command-viewer-content').textContent;
  navigator.clipboard.writeText(text).then(function() {
    var button = document.getElementById('copy-command-button');
    button.innerHTML = '<i class="bi bi-check2 me-1"></i> Copied';
    setTimeout(function() {
      button.innerHTML = '<i class="bi bi-clipboard me-1"></i> Copy';
    }, 2000);
  });
}

function infoMessageBox(message, title) {
  document.getElementById('info-body').innerHTML = message;
  document.getElementById('info-title').innerHTML = title;
  getModal('info-popup').show();
}

function errorMessageBox(message) {
  var msg =
    'Operation failed: ' + message + '. ' +
    'Please see the runtime log for details.';
  infoMessageBox(msg, 'Error');
}

function messageBox(body, title, ok_text, close_text, callback) {
  var modalBody = document.getElementById('modal-body');
  if (typeof body === 'string') {
    modalBody.innerHTML = body;
  } else {
    modalBody.innerHTML = '';
    modalBody.appendChild(body);
  }
  document.getElementById('modal-title').innerHTML = title;
  if (ok_text) document.getElementById('modal-button').innerHTML = ok_text;
  if (close_text) document.getElementById('modal-close-button').innerHTML = close_text;

  var btn = document.getElementById('modal-button');
  var newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', function() {
    getModal('popup').hide();
    if (callback) callback();
  });

  getModal('popup').show();
}


/*********** crontab actions ****************/

var schedule = '';
var job_command = '';

function clearQuickSchedule() {
  document.querySelectorAll('.quick-schedule').forEach(function(button) {
    button.classList.remove('active');
  });
}

function syncQuickSchedule() {
  clearQuickSchedule();
  document.querySelectorAll('.quick-schedule').forEach(function(button) {
    if (button.getAttribute('onclick').indexOf("'" + schedule + "'") !== -1) {
      button.classList.add('active');
    }
  });
}

function selectQuickSchedule(button, value) {
  schedule = value;
  clearQuickSchedule();
  button.classList.add('active');
  job_string();
}

function deleteJob(_id) {
  messageBox('<p> Do you want to delete this Job? </p>', 'Confirm delete', null, null, function() {
    $.post(routes.remove, {_id: _id}, function() {
      location.reload();
    });
  });
}

function stopJob(_id) {
  messageBox('<p> Do you want to stop this Job? </p>', 'Confirm stop job', null, null, function() {
    $.post(routes.stop, {_id: _id}, function() {
      location.reload();
    });
  });
}

function startJob(_id) {
  messageBox('<p> Do you want to start this Job? </p>', 'Confirm start job', null, null, function() {
    $.post(routes.start, {_id: _id}, function() {
      location.reload();
    });
  });
}

function runJob(_id) {
  messageBox('<p> Do you want to run this Job? </p>', 'Confirm run job', null, null, function() {
    $.post(routes.run, {_id: _id}, function() {
      location.reload();
    });
  });
}

function setCrontab() {
  messageBox('<p> Do you want to set the crontab file? </p>', 'Confirm crontab setup', null, null, function() {
    $.get(routes.crontab, { 'env_vars': $('#env_vars').val() }, function() {
      infoMessageBox('Successfully set crontab file!', 'Information');
      location.reload();
    }).fail(function(response) {
      errorMessageBox(response.statusText);
    });
  });
}

function getCrontab() {
  messageBox(
    '<p> Do you want to get the crontab file? <br /> A backup will be created automatically before importing.</p>',
    'Confirm crontab retrieval', null, null, function() {
      $.get(routes.import_crontab, { 'env_vars': $('#env_vars').val() }, function() {
        infoMessageBox('Successfully got the crontab file!', 'Information');
        location.reload();
      });
    });
}

function editJob(_id) {
  var job = null;
  crontabs.forEach(function(crontab) {
    if (crontab._id == _id) job = crontab;
  });

  if (job) {
    getModal('job').show();
    $('#job-name').val(job.name);
    $('#job-command').val(job.command);
    if (job.schedule.indexOf('@') !== 0) {
      var components = job.schedule.split(' ');
      $('#job-minute').val(components[0]);
      $('#job-hour').val(components[1]);
      $('#job-day').val(components[2]);
      $('#job-month').val(components[3]);
      $('#job-week').val(components[4]);
    }
    if (job.mailing) {
      $('#job-mailing').attr('data-json', JSON.stringify(job.mailing));
    }
    schedule = job.schedule;
    job_command = job.command;
    $('#job-logging').prop('checked', Boolean(job.logging && job.logging != 'false'));
    syncQuickSchedule();
    job_string();
  }

  var saveBtn = document.getElementById('job-save');
  var newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  newSaveBtn.addEventListener('click', function() {
    if (!schedule) schedule = '* * * * *';
    var name = $('#job-name').val();
    var mailing = JSON.parse($('#job-mailing').attr('data-json'));
    var logging = $('#job-logging').prop('checked');
    $.post(routes.save, {name: name, command: collapsedCommand(), schedule: schedule, _id: _id, logging: logging, mailing: mailing}, function() {
      location.reload();
    });
    getModal('job').hide();
  });
}

function newJob() {
  schedule = '';
  job_command = '';
  $('#job-minute').val('*');
  $('#job-hour').val('*');
  $('#job-day').val('*');
  $('#job-month').val('*');
  $('#job-week').val('*');

  getModal('job').show();
  $('#job-name').val('');
  $('#job-command').val('');
  $('#job-mailing').attr('data-json', '{}');
  $('#job-logging').prop('checked', false);
  clearQuickSchedule();
  job_string();

  var saveBtn = document.getElementById('job-save');
  var newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  newSaveBtn.addEventListener('click', function() {
    if (!schedule) schedule = '* * * * *';
    var name = $('#job-name').val();
    var mailing = JSON.parse($('#job-mailing').attr('data-json'));
    var logging = $('#job-logging').prop('checked');
    $.post(routes.save, {name: name, command: collapsedCommand(), schedule: schedule, _id: -1, logging: logging, mailing: mailing}, function() {
      location.reload();
    });
    getModal('job').hide();
  });
}

function duplicateJob(_id) {
  var job = null;
  crontabs.forEach(function(crontab) {
    if (crontab._id == _id) job = crontab;
  });
  if (!job) return;

  var name = job.name ? job.name + ' (copy)' : '';
  var logging = (job.logging && job.logging != 'false') ? job.logging : 'false';
  var mailing = job.mailing || {};

  $.post(routes.save, {
    name: name,
    command: job.command,
    schedule: job.schedule,
    _id: -1,
    logging: logging,
    mailing: mailing
  }, function() {
    location.reload();
  });
}

function doBackup() {
  messageBox('<p> Do you want to take backup? </p>', 'Confirm backup', null, null, function() {
    $.get(routes.backup, {}, function() {
      location.reload();
    });
  });
}

function delete_backup(db_name) {
  messageBox('<p> Do you want to delete this backup? </p>', 'Confirm delete', null, null, function() {
    $.get(routes.delete_backup, {db: db_name}, function() {
      location = routes.root;
    });
  });
}

function restore_backup(db_name) {
  messageBox('<p> Do you want to restore this backup? </p>', 'Confirm restore', null, null, function() {
    $.get(routes.restore_backup, {db: db_name}, function() {
      location = routes.root;
    });
  });
}

function import_db() {
  messageBox(
    '<p> Do you want to import crontab?<br /> A backup will be created automatically before importing.</p>',
    'Confirm import from crontab', null, null, function() {
      $('#import_file').click();
    });
}

function setMailConfig(a) {
  var data = JSON.parse(a.getAttribute('data-json'));
  var container = document.createElement('div');

  if (typeof serverMailConfigured !== 'undefined' && serverMailConfigured) {
    var managedWrapper = document.createElement('div');
    managedWrapper.className = 'form-check form-switch mb-3';

    var managedInput = document.createElement('input');
    managedInput.type = 'checkbox';
    managedInput.className = 'form-check-input';
    managedInput.id = 'serverManagedMailInput';
    managedInput.checked = data.serverManaged === true;

    var managedLabel = document.createElement('label');
    managedLabel.className = 'form-check-label';
    managedLabel.setAttribute('for', managedInput.id);
    managedLabel.innerHTML = '<strong>Use server-managed email</strong><br><small class="text-body-secondary">Credentials stay on the server and are not stored with this job.</small>';

    managedWrapper.appendChild(managedInput);
    managedWrapper.appendChild(managedLabel);
    container.appendChild(managedWrapper);
  }

  var message = "<p>This is based on nodemailer. Refer <a href='http://lifepluslinux.blogspot.com/2017/03/introducing-mailing-in-crontab-ui.html'>this</a> for more details.</p>";
  container.innerHTML += message;

  var transporterLabel = document.createElement('label');
  transporterLabel.className = 'form-label';
  transporterLabel.innerHTML = 'Transporter';
  var transporterInput = document.createElement('input');
  transporterInput.type = 'text';
  transporterInput.id = 'transporterInput';
  transporterInput.setAttribute('placeholder', config.transporterStr);
  transporterInput.className = 'form-control';
  if (data.transporterStr) {
    transporterInput.setAttribute('value', data.transporterStr);
  }
  container.appendChild(transporterLabel);
  container.appendChild(transporterInput);

  container.innerHTML += '<br/>';

  var mailOptionsLabel = document.createElement('label');
  mailOptionsLabel.className = 'form-label';
  mailOptionsLabel.innerHTML = 'Mail Config';
  var mailOptionsInput = document.createElement('textarea');
  mailOptionsInput.setAttribute('placeholder', JSON.stringify(config.mailOptions, null, 2));
  mailOptionsInput.className = 'form-control';
  mailOptionsInput.id = 'mailOptionsInput';
  mailOptionsInput.setAttribute('rows', '10');
  if (data.mailOptions)
    mailOptionsInput.innerHTML = JSON.stringify(data.mailOptions, null, 2);
  container.appendChild(mailOptionsLabel);
  container.appendChild(mailOptionsInput);

  container.innerHTML += '<br/>';

  var button = document.createElement('a');
  button.className = 'btn btn-primary btn-sm';
  button.innerHTML = 'Use Defaults';
  button.onclick = function() {
    document.getElementById('transporterInput').value = config.transporterStr;
    document.getElementById('mailOptionsInput').innerHTML = JSON.stringify(config.mailOptions, null, 2);
  };
  container.appendChild(button);

  var buttonClear = document.createElement('a');
  buttonClear.className = 'btn btn-secondary btn-sm';
  buttonClear.innerHTML = 'Clear';
  buttonClear.onclick = function() {
    document.getElementById('transporterInput').value = '';
    document.getElementById('mailOptionsInput').innerHTML = '';
  };
  container.appendChild(buttonClear);

  messageBox(container, 'Mailing', null, null, function() {
    var managedInput = document.getElementById('serverManagedMailInput');
    if (managedInput && managedInput.checked) {
      a.setAttribute('data-json', JSON.stringify({serverManaged: true}));
      return;
    }

    var transporterStr = document.getElementById('transporterInput').value;
    var mailOptions;
    try {
      mailOptions = JSON.parse(document.getElementById('mailOptionsInput').value);
    } catch (err) { /* ignore parse error */ }

    if (transporterStr && mailOptions) {
      a.setAttribute('data-json', JSON.stringify({transporterStr: transporterStr, mailOptions: mailOptions}));
    } else {
      a.setAttribute('data-json', JSON.stringify({}));
    }
  });
}

function setHookConfig(a) {
  messageBox('<p>Coming Soon</p>', 'Hooks', null, null, null);
}

function collapsedCommand() {
  return job_command.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean).join('; ');
}

function job_string() {
  var cmd = collapsedCommand();
  $('#job-string').val(schedule + ' ' + cmd);
  return schedule + ' ' + cmd;
}

function set_schedule() {
  schedule = $('#job-minute').val() + ' ' + $('#job-hour').val() + ' ' + $('#job-day').val() + ' ' + $('#job-month').val() + ' ' + $('#job-week').val();
  job_string();
}

function previewCrontab() {
  $.get(routes.preview_crontab, function(data) {
    document.getElementById('preview-crontab-content').textContent = data || '# (empty crontab)';
    getModal('preview-crontab-modal').show();
  });
}

function copyCrontab() {
  var text = document.getElementById('preview-crontab-content').textContent;
  navigator.clipboard.writeText(text).then(function() {
    var btn = document.querySelector('#preview-crontab-modal .btn-outline-secondary');
    btn.innerHTML = '<i class="bi bi-check2"></i> Copied!';
    setTimeout(function() {
      btn.innerHTML = '<i class="bi bi-clipboard"></i> Copy';
    }, 2000);
  });
}
