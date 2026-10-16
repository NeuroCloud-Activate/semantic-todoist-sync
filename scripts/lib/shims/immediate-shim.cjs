'use strict';

(function (global) {
  // Provide setImmediate/clearImmediate via MessageChannel (or setTimeout fallback)
  // without any runtime <script> element construction or dynamic code evaluation.
  if (typeof global.setImmediate !== 'function' || typeof global.clearImmediate !== 'function') {
    var nextHandle = 1;
    var tasksByHandle = {};
    var currentlyRunning = false;
    var channel = null;

    function run(task) {
      var callback = task.callback;
      var args = task.args;
      switch (args.length) {
        case 0:
          callback();
          break;
        case 1:
          callback(args[0]);
          break;
        case 2:
          callback(args[0], args[1]);
          break;
        case 3:
          callback(args[0], args[1], args[2]);
          break;
        default:
          callback.apply(undefined, args);
          break;
      }
    }

    function runIfPresent(handle) {
      if (currentlyRunning) {
        global.setTimeout(function () {
          runIfPresent(handle);
        }, 0);
        return;
      }
      var task = tasksByHandle[handle];
      if (task) {
        currentlyRunning = true;
        try {
          run(task);
        } finally {
          delete tasksByHandle[handle];
          currentlyRunning = false;
        }
      }
    }

    function registerImmediate(handle) {
      if (typeof global.MessageChannel !== 'undefined') {
        if (!channel) {
          channel = new global.MessageChannel();
          channel.port1.onmessage = function (event) {
            var h = (event && typeof event.data !== 'undefined') ? event.data : handle;
            runIfPresent(h);
          };
        }
        channel.port2.postMessage(handle);
      } else {
        global.setTimeout(function () {
          runIfPresent(handle);
        }, 0);
      }
    }

    function setImmediate(callback) {
      if (typeof callback !== 'function') {
        // String callbacks are not supported (avoids dynamic code execution).
        return 0;
      }
      var args = [];
      for (var i = 1; i < arguments.length; i++) {
        args.push(arguments[i]);
      }
      var task = { callback: callback, args: args };
      tasksByHandle[nextHandle] = task;
      registerImmediate(nextHandle);
      return nextHandle++;
    }

    function clearImmediate(handle) {
      delete tasksByHandle[handle];
    }

    global.setImmediate = setImmediate;
    global.clearImmediate = clearImmediate;
  }

  // `immediate` package exports a scheduler callable as a function (task).
  var immediateQueue = [];
  var immediateDraining = false;
  var immediateChannel = null;

  function scheduleImmediateDrain() {
    if (typeof global.MessageChannel !== 'undefined') {
      if (!immediateChannel) {
        immediateChannel = new global.MessageChannel();
        immediateChannel.port1.onmessage = function () {
          immediateDrain();
        };
      }
      immediateChannel.port2.postMessage(0);
    } else {
      global.setTimeout(immediateDrain, 0);
    }
  }

  function immediateDrain() {
    immediateDraining = true;
    while (immediateQueue.length) {
      var cb = immediateQueue.shift();
      if (typeof cb === 'function') {
        try {
          cb();
        } catch (e) {
          // Swallow to keep the queue flowing; mirrors best-effort scheduling.
        }
      }
    }
    immediateDraining = false;
  }

  function immediate(task) {
    immediateQueue.push(task);
    if (immediateQueue.length === 1 && !immediateDraining) {
      scheduleImmediateDrain();
    }
  }

  immediate.setImmediate = global.setImmediate;
  immediate.clearImmediate = global.clearImmediate;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = immediate;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this));
