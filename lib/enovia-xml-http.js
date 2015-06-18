
'use strict';

var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var request = require('request');

// HTTP request detault settings
request = request.defaults({
  jar: true,
  method: 'POST',
  encoding: 'utf8',
  timeout: 10000, // 10 seconds
  headers: {
    'mx-schemaalias': 'en',
    'mx-timezone': 'gmt',
    'connection': 'keep-alive',
    'content-type': 'text/xml'
  }
});

var state = { uri: '', user: '' };

// expose the user property as readonly
Object.defineProperty(exports, 'user', {
  enumerable: true,
  get: function() {
    return state.user;
  }
});

// expose the user property as readonly
Object.defineProperty(exports, 'server', {
  enumerable: true,
  get: function() {
    return state.uri || process.env.MQLURI;
  }
});

/** Connect and login */
exports.connect = function(options, callback) {

  var uri = options.server || exports.server;
  var user = options.user || 'creator';
  var password = options.password || '';
  var vault = options.vault || '';

  state.uri = uri;
  state.user = '';

  console.log(("-- " + uri).grey);

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
    if (state.user) {
      console.log(("-- logged in as: " + state.user).grey);
    }
    callback(error, state.user);
  });
};

/** Executes a command on the server */
exports.exec = function(command, callback) {
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
};


function send(data, callback) {

  // Serialize object into XML
  var builder = new xml2js.Builder();
  var xml = xmlbuilder.create(data).end({ pretty: true, indent: '', newline: '\n' });

  // The server cannot parse self-closing tags....
  xml = xml.replace(/<(.*)\/>/g, "<$1></$1>");

  request({ uri: exports.server, body: xml }, function(error, response, body) {
    if (error) {
      callback(error, undefined);
    } else if (response.statusCode == 200) {
      var parser = new xml2js.Parser({
        trim: true,
        explicitArray: false,
        ignoreAttrs: true
      });
      parser.parseString(body, function(xmlErr, respXml) {

        if (xmlErr) {
          callback(xmlErr, undefined);
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

        // All OK so far... send response XML to callback
        callback(undefined, respXml);

      });

    } else {
      callback("HTTP status: " + response.statusCode, undefined);
    }
  });

}

