'use strict';

const net = require('net');

const SSH_VERSION_REGEX = /^SSH-([^\s-]+)-([^\s-]+)(?: (.*))?$/;

// scanSsh(hostname, port) -> Promise({ protoversion, softwareversion, comment })
function scanSsh(host, port) {
  return new Promise((resolve, reject) => {
    // It's unlikely that we won't receive all the data in a single packet here,
    // but important to show consideration for the possibility anyway.
    let buf = new Buffer(0), timer = null;
    
    const client = net.createConnection({ host, port });
    
    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    
    const cleanup = () => {
      clearTimer();
      client.removeAllListeners('done');
      client.removeAllListeners('error');
      client.removeAllListeners('end');
      client.destroy();
    };
    
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out connecting'));
    }, 5000);
    
    const maybeDone = line => {
      let matches = line.match(SSH_VERSION_REGEX);
      if (!matches) { return false; }
      
      cleanup();
      
      resolve({
        protoversion: matches[1],
        softwareversion: matches[2],
        comment: matches.length === 4 ? matches[3] : null
      });
      
      // Shortcut any further looping, though we don't expect we should have anything
      // else after we've received the version string
      return true;
    };
    
    client.once('connect', clearTimer);
    client.once('error', err => {
      cleanup();
      reject(err);
    });
    client.once('end', () => {
      // If we haven't resolved the promise yet, we never got a suitable string,
      // so reject it. If we have, rejecting it will do nothing.
      cleanup();
      reject(new Error('No suitable version string was received'));
    });
    client.on('data', chunk => {
      // Normally, I would accumulate buffers rather than strings, but since the
      // SSH protocol is string-based and RFC-4253 specifies that other lines may
      // be sent before the version line, I am choosing instead to accumulate an
      // array of strings representing each line. I would typically be using a
      // package I wrote, binary-split-streams2 for this line-splitting, however
      // I wanted this example code to use only the Node API with no dependencies.
      
      // Even though the version string should be US-ASCII, that is compatible
      // with UTF-8, which lines preceding the version string should be encoded
      // with, according to the RFC. We're not implementing the control character
      // filtering because we have no intent to display such lines if they are sent.
      
      let lines = Buffer.concat([ buf, chunk ]).toString('utf8').split('\r\n');

      // If the string ends in \r\n, .split will give us an empty item for the last
      // piece of the array, so we're not getting rid of any data we want here
      buf = Buffer.from(lines.pop(), 'utf8');
      
      // Using reduce here for side-effects: forEach can't be ended early.
      // Could probably also use some ES6 mechanisms such as for-of
      lines.reduce((done, line) => done || maybeDone(line), false);
    });
  });
}

module.exports = scanSsh;