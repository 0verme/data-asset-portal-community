'use strict';

const {spawn} = require('node:child_process');

const invalidText = /[\u0000\r\n]/u;

function fail(callback, message) {
  process.nextTick(() => callback(new Error(message)));
}

function isSafeText(value) {
  return typeof value === 'string' && value.length > 0 && !invalidText.test(value);
}

function complete(callback, error) {
  if (error) callback(error);
  else callback();
}

function runCheckout(git, targetPath, ref, callback) {
  if (!isSafeText(ref) || ref.startsWith('-')) {
    fail(callback, 'A safe checkout ref is required');
    return;
  }

  const child = spawn(git, ['checkout', ref], {
    cwd: targetPath,
    shell: false,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  let settled = false;
  const done = error => {
    if (settled) return;
    settled = true;
    complete(callback, error);
  };
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.once('error', done);
  child.once('close', code => {
    if (code === 0) done();
    else done(new Error(`git checkout failed with code ${code}: ${stderr}`));
  });
}

module.exports = function clone(repo, targetPath, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};
  callback = callback || (() => {});

  if (!isSafeText(repo) || !isSafeText(targetPath)) {
    fail(callback, 'Repository URL and target path are required');
    return;
  }
  if (options.args !== undefined) {
    fail(callback, 'opts.args is not supported by the safe clone adapter');
    return;
  }
  if (options.checkout !== undefined &&
      (!isSafeText(options.checkout) || options.checkout.startsWith('-'))) {
    fail(callback, 'A safe checkout ref is required');
    return;
  }

  const git = options.git || 'git';
  if (!isSafeText(git)) {
    fail(callback, 'A safe git executable is required');
    return;
  }

  const args = ['clone'];
  if (options.shallow) args.push('--depth', '1');
  // Keep the repository URL after the option terminator; spawn never invokes a shell.
  args.push('--', repo, targetPath);

  const child = spawn(git, args, {
    shell: false,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  let settled = false;
  const done = error => {
    if (settled) return;
    settled = true;
    complete(callback, error);
  };
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.once('error', done);
  child.once('close', code => {
    if (code !== 0) {
      done(new Error(`git clone failed with code ${code}: ${stderr}`));
      return;
    }
    if (options.checkout) runCheckout(git, targetPath, options.checkout, done);
    else done();
  });
};
