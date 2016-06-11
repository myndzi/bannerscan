'use strict';

const URL = require('url'),
      transports = {
        http: require('http'),
        https: require('https')
      };

const WP_CONTENT_REGEX = /href=('[^']*wp-content[^']*'|"[^"]*wp-content[^"]*"|[^ ]*wp-content[^ ]*)/;

const SCHEMES = {
  '80': 'http',
  '443': 'https'
};

const PORTS = {
  'http:': 80,
  'https:': 443
};

function getHttp(hostname, port, pathname, redirects) {
  redirects = redirects || 0;
  if (redirects >= 3) {
    return Promise.reject(new Error('Too many redirects: ' + redirects));
  }
  
  let scheme = SCHEMES[port],
      url = URL.format({ hostname, port, pathname, protocol: scheme+':' });
  
  let opts = {
    method: 'GET',
    hostname,
    port,
    pathname,
    rejectUnauthorized: false,
    headers: {
      'Connection': 'close'
    }
  };
    
  return new Promise((resolve, reject) => {
    if (!scheme) {
      reject(`Unsupported port: ${port}`);
      return;
    }
    
    let chunks = [ ],
        server = null;
  
    // Could also use http(s).get, but want more flexibility in the options
    // This is a good place to use a library such as bhttp
    const req = transports[scheme].request(opts, res => {
      // error handling
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      
      // redirect handling
      if (res.statusCode >= 300 && res.statusCode < 400) {
        let newUrl = res.headers.location;
        
        if (!newUrl) {
          reject(new Error(`Got redirect: ${res.statusCode} but no Location header`));
          return;
        }
        
        let parsed = URL.parse(newUrl),
            newPort = PORTS[parsed.protocol];
        
        if (port !== newPort) {
          reject(new Error(`Refusing to redirect across ports: ${port} -> ${newPort}`));
          return;
        }

        // valid redirect on the same port
        resolve(getHttp(parsed.hostname, port, parsed.pathname, redirects+1));
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Don't know what to do with HTTP ${res.statusCode}`));
        return;
      }
      
      // success
      if (res.headers.server) {
        // There are other options for identifying a server, but this is straightforward
        // and the others are probably out of the scope of this example and require fairly
        // specific data, e.g. error pages or header fingerprinting of some kind.
        server = res.headers.server || 'unknown';
      }
      
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () =>
        resolve({
          server,
          headers: res.headers,
          url: URL.format({ hostname, port, pathname }),
          body: Buffer.concat(chunks).toString('utf8')
        })
      );
    });
    
    req.once('error', reject);
    req.end();
  });
}


function checkWpContent(str) {
  // Note: don't parse html with regular expressions. Cheerio would be a good
  // package to use here, but since I'm trying to keep with the plain Node API,
  // I'm settling for the quick and dirty here.
  
  // This is also a synchronous function, but we're exposing a promise-based API
  return Promise.resolve(WP_CONTENT_REGEX.test(str));
};

function checkUrl(oldUrl, newPath) {
  // Substitute the last chunk of the path for some arbitrary value. This
  // could probably be made a little more robust. The input url should
  // be the base path to a potential Wordpress installation; if for some
  // reason it does not end in a / (it points to some script or file),
  // the last segment is removed
  let parsed = URL.parse(oldUrl),
      matched = parsed.path.match(/^(.*\/)/);
  
  parsed.pathname = (matched ? matched[1] : '/') + newPath;
 
  return getHttp(parsed.hostname, parsed.port, parsed.pathname)
    .then(data => true)
    .catch(err => false);
}

const checkWpLicense = url => checkUrl(url, 'license.txt');
const checkWpAdmin = url => checkUrl(url, 'wp-admin/');

// scanHttp(url) => Promise({ server, isWordpress })
// supports http and https
function scanHttp(hostname, port) {
  return getHttp(hostname, port, '/')
    .then(data => {
      return checkWpContent(data.body)
        .then(isWordpress => isWordpress || checkWpLicense(data.url))
        .then(isWordpress => isWordpress || checkWpAdmin(data.url))
        .then(isWordpress => ({
          server: data.server,
          isWordpress
        }));
    });
}

module.exports = scanHttp;
