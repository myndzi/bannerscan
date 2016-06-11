'use strict';

const scanSsh = require('./lib/ssh'),
      scanHttp = require('./lib/http');

function report(fn, hostname, port) {
  return fn(hostname, port).then(obj => {
    console.log('OK:  %s:%s -> %j', hostname, port, obj);
    return obj;
  }).catch(err => {
    console.error('ERR: %s:%s -> %s', hostname, port, err.message);
    return null;
  });
}

function scan(hostname) {
  return Promise.all([
    report(scanSsh, hostname, 22),
    report(scanHttp, hostname, 80),
    report(scanHttp, hostname, 443)
  ])
  .catch(err => console.error(err));
}

scan(process.argv[2] || 'localhost');
