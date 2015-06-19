#! /usr/bin/env node

'use strict';

var enovia = require('./lib/enovia-xml-http.js');
var readline = require('readline');
var colors = require('colors');
var quote = require('shell-quote');
var url = require('url');

var rl = readline.createInterface(process.stdin, process.stdout, completer);

function completer(line) {
  var completions = 'login url info monitor quit'.split(' ')
  var hits = completions.filter(function(c) {
    if (c.indexOf(line) == 0) {
      return c;
    }
  });
  return [hits && hits.length ? hits : completions, line];
}

/** compute the prompt */
function prompt() {

  var pt = '';
  var ptlen = 0;

  // add server info
  var server = enovia.server;
  if (server) {

    pt += '~ '.cyan;
    ptlen += 2;

    // add user info
    var user = enovia.user;
    if (user) {
      pt += user.yellow + " @ ".cyan;
      ptlen += user.length + 3;
    }

    pt += server.magenta;
    ptlen += server.length;
  }

  pt += " $ ".cyan;
  ptlen += 2;

  rl.setPrompt(pt, ptlen);
  rl.prompt();

}

/** Asks the user a question */
function ask(name, defaultValue, callback) {
  var question = "? ".green;
  question += name + ": ";
  if (defaultValue) {
    question += ("[" + defaultValue + "] ").grey;
  }
  rl.question(question, function(newValue) {
    callback(newValue || defaultValue || '');
  });
}

function askUri(callback) {
  ask('url', enovia.uri, function(x) {
    if (!x.match(/^https?:\/\/.*$/)) {
      x = 'http://' + x;
    }
    var parsed = url.parse(x);
    enovia.uri = parsed.href;
    callback();
  });
}

function ensureUri(callback) {
  enovia.uri ? callback() : askUri(callback);
}

function askCredentials(callback) {
  ask('user', enovia.user || 'creator', function(user) {
    ask('password', '', function(passwd) {
      callback(user, passwd);
    });
  });
}

function startSpinner(message) {
  var stream = process.stderr;
  if (!stream.isTTY) {
    return function() {};
  }
  var tick = 0;
  var symbols = "-\\|/";
  var preamble = message || '';
  var interval = setInterval(function() {
    stream.cursorTo(0);
    stream.write((preamble + symbols[tick % symbols.length]).cyan + " ");
    stream.clearLine(1);
    tick++;
  }, 350);
  return {
    cancel: function() {
      clearInterval(interval);
      stream.cursorTo(0);
      stream.clearLine(1);
    }
  };
}

function login(user, password, callback) {
  rl.pause();
  var spinner = startSpinner();
  enovia.login({user: user, password: password}, function(error, user) {
    spinner.cancel();
    if (error) {
      console.log(error.toString().red);
    }
    rl.resume();
    callback();
  });
}

// this code is ugly... clean it up!~
function isSetContext(tokens) {
  if (tokens.length == 4 || tokens.length == 6) {
    if (eq('set', 3, tokens[0]) && eq('context', 4, tokens[1]) && (eq('user', 4, tokens[2]) || eq('person', 5, tokens[2]))) {
      if (tokens.length == 4) {
        return { user: tokens[3], password: '' };
      } else if (eq('password', 4, tokens[4])) {
        return { user: tokens[3], password: tokens[5] };
      }
    }
  }
}

function eq(keyword, minlen, s) {
  return s.length >= minlen && keyword.indexOf(s.toLowerCase()) === 0;
}

function printData(data, columns) {
  columns = columns || 20;
  for (var key in data) {
    var value = data[key];
    var line = '  ' + key;
    while (line.length < columns) {
      line += ' ';
    }
    line += " : ".grey + value;
    console.log(line);
  }
}

function forEach(maybeArray, callback) {
  Array.isArray(maybeArray) ?
    maybeArray.forEach(callback) :
    [maybeArray].forEach(callback)
}

function singleValue(maybeValue) {
  return Array.isArray(maybeValue) ? maybeValue[0] : maybeValue;
}

function prettyDuration(durStr) {
  var matches = durStr.match(/^P(\d+H)?(\d+M)?(\d+S)$/);
  if (!matches) return durStr;
  var pretty = [];
  for (var i = 1; i < matches.length; i++) {
    var x = matches[i];
    if (!x) continue;
    var value = parseInt(x);
    var unit = x.charAt(x.length-1);
    switch (unit) {
      case 'H': unit = 'hour'; break;
      case 'M': unit = 'minute'; break;
      case 'S': unit = 'second'; break;
    }
    if (value !== 1) {
      unit += 's';
    }
    pretty.push(value + ' ' + unit);
  }
  return pretty.join(', ');
}

rl.on('line', function(line) {
  switch (line.trim()) {
    case "q":
    case "quit":
    case "exit":
      rl.close();
      break;
    case "info":
      console.log('');
      printData({
        'url': enovia.uri,
        'user': enovia.user,
        'session-id': enovia.sessionId
      }, 12);
      console.log('');
      prompt();
      break;
    case "uri":
    case "url":
    case "server":
      // Change the server URL
      askUri(function() {
        prompt();
      });
      break;
    case "login":
      // Ask for credentials and authenticate
      askCredentials(function(user, password) {
        login(user, password, function() {
          prompt();
        });
      });
      break;
    case "monitor":
      // Get monitor data from server
      rl.pause();
      var spinner = startSpinner();
      enovia.monitorServer(function(error, data) {
        spinner.cancel();
        if (error) {
          console.log(error.toString().red);
        } else if (data) {

          // Pretty print server information

          console.log('');

          var header = data.monitorServer.header;
          printData({
            'server-product': header.product,
            'server-version': header.version,
            'server-uptime': prettyDuration(header.active),
            'server-debug-port': header.port,
            'server-pid': header.pid
          });

          forEach(data.monitorServer.threadDump.thread, function(thread, index) {

            // Skip our own threads...
            if (thread.sessionId === enovia.sessionId) {
              return;
            }

            // Pretty print thread and stack information...
            console.log('\n  thread @ ' + thread.id + ": ");
            forEach(thread.stackTrace.stackEntry, function(entry) {
              var depth = entry.depth;
              var data = {};
              var duration = '';
              if (entry.mqlTraceEntry) {
                duration = prettyDuration(singleValue(entry.mqlTraceEntry.active));
                data['  mql-command'] = entry.mqlTraceEntry.command;
              } else if (entry.adkTraceEntry) {
                duration = prettyDuration(singleValue(entry.adkTraceEntry.active));
                data['  adk-method'] = entry.adkTraceEntry.method;
              } else if (entry.backgroundTaskTrace) {
                duration = prettyDuration(singleValue(entry.backgroundTaskTrace.active));
                data['  bg-task-type'] = entry.backgroundTaskTrace.taskType;
                data['  bg-task-parent'] = entry.backgroundTaskTrace.parentThreadId;
              } else {
                console.log(entry);
              }
              console.log('\n    stack #' + depth + ": " + ("[" + duration + "]").grey);
              printData(data);
            });
          });

          console.log('');

        }
        rl.resume();
        prompt();
      });
      break;
    default:
      // Otherwise, process server command...
      var command = line.trim().replace(/;$/, '');
      if (command.length > 0) {
        rl.pause();

        // Parse command to see if the user is trying to login
        var tokens = quote.parse(command);
        var params = isSetContext(tokens);
        if (params) {
          login(params.user, params.password, function() {
            prompt();
          });
          break;
        }

        // Execute command on the server
        enovia.exec(command, function(error, result) {
          if (error) {
            console.log(error.toString().red);
          } else if (result) {
            if (result.output) {
              console.log(result.output);
            }
            if (result.error) {
              console.log(result.error.red);
            }
            for (var i = 0; i < result.tasks.length; i++) {
              var task = result.tasks[i];
              var level = '';
              switch (task.reason) {
                case "3":
                  level = 'NOTICE';
                  break;
                case "4":
                  level = 'WARNING';
                  break;
                case "5":
                  level = 'ERROR';
                  break;
              }
              if (level) {
                console.log(("# " + level + ": " + task.taskData).red.italic);
              }
            }
          }
          rl.resume();
          prompt();
        });
      } else {
        prompt();
      }
  }
});

rl.on('close', function() {
  console.log("\n\nGoodbye!\n".green);
  process.exit(0);
});

ensureUri(function() {
  prompt();
});
