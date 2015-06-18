#! /usr/bin/env node

'use strict';

var enovia = require('./lib/enovia-xml-http.js');
var readline = require('readline');
var colors = require('colors');
var url = require('url');

var rl = readline.createInterface(process.stdin, process.stdout, completer);

function completer(line) {
  var completions = 'login url quit'.split(' ')
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

rl.on('line', function(line) {
  switch (line.trim()) {
    case "q":
    case "quit":
    case "exit":
      rl.close();
      break;
    case "uri":
    case "url":
    case "server":
      askUri(function() {
        prompt();
      });
      break;
    case "login":
      ensureUri(function() {
        askCredentials(function(user, password) {
          rl.pause();
          var spinner = startSpinner();
          enovia.login({user: user, password: password}, function(error, user) {
            spinner.cancel();
            if (error) {
              console.log(error.toString().red);
            } else {
              console.log("Success!".green);
            }
            rl.resume();
            prompt();
          });
        });
      });
      break;
    default:
      if (line.trim().length > 0) {
        rl.pause();
        enovia.exec(line, function(error, result) {
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

prompt();

