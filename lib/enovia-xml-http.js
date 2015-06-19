
'use strict';

var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var request = require('request');
var url = require('url');

// create a jar for our cookies
var cookieJar = request.jar();

// HTTP request detault settings
request = request.defaults({
  method: 'POST',
  encoding: 'utf8',
  timeout: 30000, // 30 seconds
  headers: {
    'mx-schemaalias': 'en',
    'mx-timezone': 'gmt',
    'connection': 'keep-alive',
    'content-type': 'text/xml'
  }
});

var state = { uri: process.env.MQLURI || '', user: '', sessionId: '' };

// expose the user property as readonly
Object.defineProperty(exports, 'user', {
  enumerable: true,
  get: function() {
    return state.user;
  }
});

// expose the user property as readonly
Object.defineProperty(exports, 'sessionId', {
  enumerable: true,
  get: function() {
    return state.sessionId;
  }
});

// expose the user property as readonly
Object.defineProperty(exports, 'uri', {
  enumerable: true,
  get: function() {
    return state.uri;
  },
  set: function(val) {
    if (state.uri != val) {
      state.uri = val;
      state.user = '';
      cookieJar = request.jar();
    }
  }
});

// expose the user property as readonly
Object.defineProperty(exports, 'server', {
  enumerable: true,
  get: function() {
    var x = state.uri;
    return x ? url.parse(x).host : '';
  }
});

/** Connect and login */
function login(options, callback) {

  var uri = options.uri || exports.uri;
  var user = options.user || 'creator';
  var password = options.password || '';
  var vault = options.vault || '';

  state.uri = uri;
  state.user = '';

  send({
    bosContext: {
      bosContext: {
        '@argc': 2,
        sessionId: '',
        stackTrace: ''
      },
      reset: {
        tenant: '', // R2013+
        user: user,
        passwd: password,
        lattice: vault,
        application: '',
        clienthost: '', // R2012+
        ipaddress: '', // R2012+
        macaddress: '', // R2012+
        customdata: '', // R2012+
        onlineInstance: '', // R2013+
        indexPassword: '', // R2013+
        extra: '',  // R2012+
        stackTrace: 'NOTHING'
      }
    }
  }, function(error, responseXml) {
    callback(error, state.user);
  });
}

/** Executes a command on the server */
function exec(command, callback) {
  send({
    bosMQLCommand: {
      executeCmd: {
        cmd: command,
        stackTrace: ''
      }
    }
  }, function(error, responseXml) {
    var result = undefined;
    if (responseXml) {

      var returnVal = responseXml.bosMQLCommand.returnVal;

      // Gather command output
      var results = [];
      for (var i = 0, len = parseInt(returnVal.results.count); i < len; i++) {
        results.push(returnVal.results['element.'+i]);
      }

      // Gather command errors
      var errors = [];
      for (var i = 0, len = parseInt(returnVal.errors.count); i < len; i++) {
        errors.push(returnVal.errors['element.'+i]);
      }

      // Gather client tasks
      var tasks = [];
      for (var i = 0, len = parseInt(returnVal.tasks.count); i < len; i++) {
        tasks.push(returnVal.tasks['element.'+i]);
      }

      result = {
        success: returnVal.status === '1',
        output: results.join(''),
        error: errors.join(''),
        tasks: tasks
      };

    }
    callback(error, result);
  });
}

function monitorServer(callback) {
  //console.log("starting...");
  exec('monitor server xml', function(error, result) {
    // console.log("result: ", result);
    if (result && result.output) {
      var parser = new xml2js.Parser({
        trim: true,
        explicitArray: false,
        ignoreAttrs: true
      });
      // console.log("parsing output", result.output);
      parser.parseString(result.output, function(parseError, data) {
        callback(undefined, data);
      });
    } else {
      // console.log("error: ", error);
      callback(error, undefined);
    }
  });
}

/** Send an XML to the server and parse the response */
function send(data, callback) {

  // Serialize object into XML
  var builder = new xml2js.Builder();
  var xml = xmlbuilder.create(data).end({ pretty: true, indent: '', newline: '\n' });

  // The server cannot parse self-closing tags....
  xml = xml.replace(/<(.*)\/>/g, "<$1></$1>");

  request({ uri: state.uri, body: xml, jar: cookieJar }, function(error, response, body) {
    if (error) {
      callback(error, undefined);
    } else if (response.statusCode == 200) {
      var parser = new xml2js.Parser({
        trim: true,
        explicitArray: false,
        ignoreAttrs: true
      });
      parser.parseString(body, function(parseError, respXml) {

        if (parseError) {
          callback(parseError, undefined);
          return;
        }

        // Decode username sent by server
        var username = response.headers['mx-username'];
        if (username) {
          username = new Buffer(username, 'base64').toString('utf8');
        }

        // Update username in global stats
        state.user = username;

        // Check for standard error info in response XML
        if (respXml.exception) {
          callback(respXml.exception, undefined);
          return;
        }

        // Get the session ID
        state.sessionId = '';
        var cookies = cookieJar.getCookieString(state.uri);
        if (cookies) {
          cookies.split(';').forEach(function(cookie) {
            var matches = cookie.trim().match(/^JSESSIONID=(.*)$/);
            if (matches) {
              state.sessionId = matches[1];
            }
          });
        }

        // All OK so far... send response XML to callback
        callback(undefined, respXml);

      });

    } else {
      callback("HTTP status: " + response.statusCode, undefined);
    }
  });

}

exports.login = login;
exports.exec = exec;
exports.monitorServer = monitorServer;

