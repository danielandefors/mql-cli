#! /usr/bin/env node

'use strict';

var enovia = require('./lib/enovia-xml-http.js');
var readline = require('readline');
var colors = require('colors');

var rl = readline.createInterface(process.stdin, process.stdout, completer);

function completer(line) {
  var completions = 'connect exit quit'.split(' ')
  var hits = completions.filter(function(c) {
    if (c.indexOf(line) == 0) {
      return c;
    }
  });
  return [hits && hits.length ? hits : completions, line];
}

function prompt() {
  var user = enovia.user;
  if (user) {
    rl.setPrompt("[".cyan + user.magenta + "] ".cyan + "$ ", user.length + 5);
  } else {
    rl.setPrompt("$ ", 2);
  }
  rl.prompt();
}

rl.on('line', function(line) {
  switch (line.trim()) {
    case "q":
    case "quit":
    case "exit":
      rl.close();
      break;
    case "connect":
      rl.question("? User: ".blue + "[creator] ".yellow.dim, function(user) {
        rl.question("? Password: ".blue, function(password) {
          rl.pause();
          setTimeout(function() {
            enovia.connect({user: user, password: password}, function(error, user) {
              if (error) {
                console.log(error.toString().red);
              }
              rl.resume();
              prompt();
            });
          }, 10);
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

