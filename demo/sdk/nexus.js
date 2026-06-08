/**
 * NexusCDP Browser SDK v1.0.0
 * Self-contained IIFE — no dependencies, no build step required.
 * IE11 compatible: uses XMLHttpRequest, no fetch, no arrow functions, no const/let in older paths.
 */
(function (root, factory) {
  root.NexusCDP = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  // Auto-detect backend URL: use Railway in production, localhost in dev
  var _backendBase = (function() {
    if (typeof window !== 'undefined' && window.NEXUS_BACKEND_URL) return window.NEXUS_BACKEND_URL;
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      // Running on Vercel — use Railway backend if configured, else stub mode
      return window.NEXUS_RAILWAY_URL || '__STUB__';
    }
    return 'http://localhost';
  })();

  var _config = {
    apiKey: '',
    collectorUrl: _backendBase === '__STUB__' ? '__STUB__' : (_backendBase + ':3001'),
    profileUrl:   _backendBase === '__STUB__' ? '__STUB__' : (_backendBase + ':3002'),
    cdhUrl:       _backendBase === '__STUB__' ? '__STUB__' : (_backendBase + ':3010'),
    feedbackUrl:  _backendBase === '__STUB__' ? '__STUB__' : (_backendBase + ':3003'),
    consentUrl:   _backendBase === '__STUB__' ? '__STUB__' : (_backendBase + ':3004'),
    debug: false,
    autoTrack: true,
    stubMode: _backendBase === '__STUB__'
  };

  var _state = {
    initialized: false,
    customerId: null,
    cookieId: null,
    sessionId: null,
    eventCount: 0,
    queue: [],
    log: [],
    listeners: {}
  };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function _uuid() {
    var s = '';
    var hexChars = '0123456789abcdef';
    for (var i = 0; i < 32; i++) {
      var r = Math.floor(Math.random() * 16);
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        s += '-';
      }
      if (i === 12) {
        s += '4';
      } else if (i === 16) {
        s += hexChars[(r & 0x3) | 0x8];
      } else {
        s += hexChars[r];
      }
    }
    return s;
  }

  function _now() {
    return new Date().toISOString();
  }

  function _log(msg, data) {
    if (_config.debug) {
      if (data !== undefined) {
        console.log('[NexusCDP]', msg, data);
      } else {
        console.log('[NexusCDP]', msg);
      }
    }
    var entry = { ts: _now(), msg: msg };
    if (data !== undefined) { entry.data = data; }
    _state.log.push(entry);
    if (_state.log.length > 50) {
      _state.log.shift();
    }
  }

  function _emit(event, payload) {
    _log('emit:' + event, payload);
    var handlers = _state.listeners[event];
    if (handlers) {
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](payload); } catch (e) { /* swallow */ }
      }
    }
  }

  function _lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function _lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* swallow */ }
  }

  function _lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* swallow */ }
  }

  // ---------------------------------------------------------------------------
  // HTTP helper (XMLHttpRequest, IE11 compatible)
  // ---------------------------------------------------------------------------
  function _request(method, url, payload, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (_config.apiKey) {
      xhr.setRequestHeader('x-api-key', _config.apiKey);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      var ok = xhr.status >= 200 && xhr.status < 300;
      var body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) { body = xhr.responseText; }
      if (callback) { callback(ok ? null : { status: xhr.status, body: body }, body); }
    };
    xhr.onerror = function () {
      if (callback) { callback({ status: 0, body: 'Network error' }, null); }
    };
    if (payload !== null && payload !== undefined) {
      xhr.send(JSON.stringify(payload));
    } else {
      xhr.send();
    }
  }

  // ---------------------------------------------------------------------------
  // Core event post
  // ---------------------------------------------------------------------------
  function _postEvent(payload, callback) {
    var url = _config.collectorUrl + '/v1/events';
    _log('post event', payload);
    _request('POST', url, payload, function (err, body) {
      if (err) {
        _log('event:error', err);
        _emit('event:error', { error: err, payload: payload });
        if (callback) { callback(err, null); }
      } else {
        _state.eventCount++;
        _log('event:sent', body);
        _emit('event:sent', { payload: payload, response: body });
        _emit('event:accepted', { payload: payload, response: body });
        if (callback) { callback(null, body); }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Queue flush
  // ---------------------------------------------------------------------------
  function _flushQueue() {
    var q = _state.queue.slice();
    _state.queue = [];
    _log('flushing queue', { count: q.length });
    for (var i = 0; i < q.length; i++) {
      (function (item) {
        _postEvent(item.payload, item.callback);
      }(q[i]));
    }
  }

  // ---------------------------------------------------------------------------
  // SPA history patching
  // ---------------------------------------------------------------------------
  function _patchHistory() {
    if (typeof history === 'undefined' || typeof history.pushState !== 'function') { return; }
    var orig = history.pushState.bind ? history.pushState.bind(history) : history.pushState;
    history.pushState = function () {
      orig.apply(history, arguments);
      if (_config.autoTrack) {
        NexusCDP.track('page_view', {
          url: window.location.href,
          path: window.location.pathname,
          title: document.title,
          referrer: document.referrer
        }, 'web', null);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  var NexusCDP = {};

  /**
   * Initialize the SDK.
   */
  NexusCDP.init = function (options) {
    if (!options || !options.apiKey) {
      throw new Error('NexusCDP.init requires options.apiKey');
    }

    // Merge options into config
    var keys = ['apiKey', 'collectorUrl', 'profileUrl', 'cdhUrl', 'feedbackUrl', 'consentUrl', 'debug', 'autoTrack'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (options[k] !== undefined) { _config[k] = options[k]; }
    }

    // cookieId — get or create
    var cid = _lsGet('nx_cid');
    if (!cid) {
      cid = _uuid();
      _lsSet('nx_cid', cid);
    }
    _state.cookieId = cid;

    // customerId — restore from storage
    var uid = _lsGet('nx_uid');
    if (uid) { _state.customerId = uid; }

    // sessionId — always fresh per page load
    _state.sessionId = _uuid();

    _state.initialized = true;
    _log('initialized', _config);
    _emit('init', { cookieId: cid, sessionId: _state.sessionId });

    // Flush any queued events
    _flushQueue();

    // Auto page_view
    if (_config.autoTrack) {
      NexusCDP.track('page_view', {
        url: window.location.href,
        path: window.location.pathname,
        title: document.title,
        referrer: document.referrer
      }, 'web', null);

      // Patch SPA history
      _patchHistory();
    }

    return NexusCDP;
  };

  /**
   * Identify a user (anonymous → known stitching).
   */
  NexusCDP.identify = function (customerId, traits, callback) {
    if (!customerId) {
      if (callback) { callback(new Error('customerId required'), null); }
      return;
    }

    _state.customerId = customerId;
    _lsSet('nx_uid', customerId);
    _log('identify', customerId);

    var payload = {
      eventType: 'login',
      customerId: customerId,
      cookieId: _state.cookieId,
      sessionId: _state.sessionId,
      timestamp: _now(),
      channel: 'web',
      traits: traits || {}
    };

    _emit('identify', { customerId: customerId, traits: traits });

    _postEvent(payload, function (err, body) {
      if (!err) {
        _emit('stitch:complete', { customerId: customerId, cookieId: _state.cookieId });
      }
      if (callback) { callback(err, body); }
    });
  };

  /**
   * Track a custom event.
   */
  NexusCDP.track = function (eventType, properties, channel, callback) {
    var payload = {
      eventType: eventType,
      sessionId: _state.sessionId,
      timestamp: _now(),
      channel: channel || 'web',
      properties: properties || {}
    };

    if (_state.customerId) {
      payload.customerId = _state.customerId;
    } else {
      payload.cookieId = _state.cookieId;
    }

    if (!_state.initialized) {
      _log('queued (not initialized)', eventType);
      _state.queue.push({ payload: payload, callback: callback });
      return;
    }

    _postEvent(payload, callback);
  };

  /**
   * Get Next Best Action decisions from CDH.
   */
  NexusCDP.getNBA = function (callback) {
    if (!_state.customerId) {
      var err = new Error('getNBA requires an identified customerId');
      if (callback) { callback(err, null); }
      return;
    }

    var url = _config.cdhUrl + '/nba/decisions/' + encodeURIComponent(_state.customerId);
    _log('getNBA', url);

    _request('GET', url, null, function (err, body) {
      if (err) {
        _log('nba:error', err);
        if (callback) { callback(err, null); }
      } else {
        _log('nba:received', body);
        _emit('nba:received', { customerId: _state.customerId, decisions: body });
        if (callback) { callback(null, body); }
      }
    });
  };

  /**
   * Send offer/decision feedback to the feedback service.
   */
  NexusCDP.feedback = function (decisionId, action, outcome, channel, callback) {
    var payload = {
      customerId: _state.customerId,
      decisionId: decisionId,
      action: action,
      outcome: outcome,
      channel: channel || 'web',
      propensityScore: 0.8,
      timestamp: _now()
    };

    var url = _config.feedbackUrl + '/v1/feedback';
    _log('feedback', payload);

    _request('POST', url, payload, function (err, body) {
      if (!err) {
        _emit('feedback:sent', { payload: payload, response: body });
      }
      if (callback) { callback(err, body); }
    });
  };

  /**
   * Opt the user out of specified channels.
   */
  NexusCDP.optOut = function (channels, callback) {
    var payload = {
      channels: channels || [],
      source: 'web-preference-centre',
      timestamp: _now()
    };

    if (_state.customerId) {
      payload.customerId = _state.customerId;
    } else {
      payload.cookieId = _state.cookieId;
    }

    var url = _config.consentUrl + '/v1/consent/optout';
    _log('optOut', payload);

    _request('POST', url, payload, function (err, body) {
      if (!err) {
        _emit('consent:optout', { payload: payload, response: body });
      }
      if (callback) { callback(err, body); }
    });
  };

  /**
   * Register an event listener.
   */
  NexusCDP.on = function (event, handler) {
    if (typeof handler !== 'function') { return NexusCDP; }
    if (!_state.listeners[event]) { _state.listeners[event] = []; }
    _state.listeners[event].push(handler);
    return NexusCDP;
  };

  /**
   * Get current SDK state snapshot.
   */
  NexusCDP.getState = function () {
    return {
      customerId: _state.customerId,
      cookieId: _state.cookieId,
      sessionId: _state.sessionId,
      eventCount: _state.eventCount,
      initialized: _state.initialized,
      queueLength: _state.queue.length
    };
  };

  /**
   * Reset the SDK — clears user identity.
   */
  NexusCDP.reset = function () {
    _state.customerId = null;
    _lsRemove('nx_uid');
    _log('reset');
    _emit('reset', { cookieId: _state.cookieId });
    return NexusCDP;
  };

  /**
   * Return the last 50 debug log entries.
   */
  NexusCDP.getLog = function () {
    return _state.log.slice();
  };

  return NexusCDP;
}));
