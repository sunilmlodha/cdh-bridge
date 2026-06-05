# NexusCDP JavaScript SDK

Browser-embeddable SDK for NexusCDP. No dependencies, no build step. Works via plain `<script>` tag down to IE11.

---

## Quick Start

```html
<script src="nexus.js"></script>
<script>
  NexusCDP.init({ apiKey: 'YOUR_API_KEY' });
  NexusCDP.identify('cust-001', { name: 'Jane Smith', email: 'jane@example.com' });
  NexusCDP.track('product_view', { productId: 'p-123', category: 'loans' });
</script>
```

---

## Installation

### Web
```html
<script src="/path/to/nexus.js"></script>
```

### Mobile web / hybrid
```html
<script src="/path/to/nexus-mobile.js"></script>
```

---

## `init` Options

| Option         | Type    | Default                    | Description                                      |
|----------------|---------|----------------------------|--------------------------------------------------|
| `apiKey`       | string  | *(required)*               | Your NexusCDP API key                            |
| `collectorUrl` | string  | `http://localhost:3001`    | Event collector endpoint                         |
| `profileUrl`   | string  | `http://localhost:3002`    | Profile service endpoint                         |
| `cdhUrl`       | string  | `http://localhost:3010`    | CDH / decision engine endpoint                   |
| `feedbackUrl`  | string  | `http://localhost:3003`    | Feedback service endpoint                        |
| `consentUrl`   | string  | `http://localhost:3004`    | Consent service endpoint                         |
| `debug`        | boolean | `false`                    | Log debug output to console                      |
| `autoTrack`    | boolean | `true`                     | Fire `page_view` on init and SPA navigation      |

---

## Full API Reference

### Core Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `init(options)` | Initialise the SDK. Must be called first. Creates/restores `cookieId` and `sessionId`, flushes event queue. |
| `identify` | `identify(customerId, traits, callback)` | Identify a known user. Stores `customerId` in localStorage. Fires a `login` event containing both `customerId` and `cookieId` for anonymous-to-known stitching. Emits `identify` then `stitch:complete` on success. |
| `track` | `track(eventType, properties, channel, callback)` | Track a custom event. If called before `init`, the event is queued and sent on `init`. |
| `getNBA` | `getNBA(callback)` | Fetch Next Best Action decisions for the current `customerId` from the CDH. Emits `nba:received`. Requires a prior `identify` call. |
| `feedback` | `feedback(decisionId, action, outcome, channel, callback)` | Post offer/decision feedback. Sends `{customerId, decisionId, action, outcome, channel, propensityScore:0.8, timestamp}`. Emits `feedback:sent`. |
| `optOut` | `optOut(channels, callback)` | Opt user out of one or more channels. Posts to the consent service with `source:'web-preference-centre'`. Emits `consent:optout`. |
| `on` | `on(event, handler)` | Register an event listener. Chainable. |
| `getState` | `getState()` | Returns `{customerId, cookieId, sessionId, eventCount, initialized, queueLength}`. |
| `reset` | `reset()` | Clear `customerId` from state and localStorage. Emits `reset`. Chainable. |
| `getLog` | `getLog()` | Returns array of last 50 debug log entries `[{ts, msg, data?}]`. |

### Mobile-only Methods (nexus-mobile.js)

| Method | Signature | Description |
|--------|-----------|-------------|
| `trackAppOpen` | `trackAppOpen(metadata)` | Fires `app_open` event with `{platform:'mobile', metadata}`. |
| `trackAppBackground` | `trackAppBackground()` | Fires `app_background` event with `{platform:'mobile'}`. |
| `biometricLogin` | `biometricLogin(customerId, traits, callback)` | Calls `identify()` with traits merged with `{authMethod:'biometric'}`. |
| `trackNotificationTap` | `trackNotificationTap(notificationId, action, callback)` | Fires `notification_tap` event with `{notificationId, action, platform:'mobile'}`. |

---

## Event Listener Reference

Register listeners with `NexusCDP.on(event, handler)`.

| Event | Fired when | Payload |
|-------|------------|---------|
| `init` | SDK initialised | `{cookieId, sessionId}` |
| `identify` | `identify()` called | `{customerId, traits}` |
| `stitch:complete` | Identify POST succeeded (anonymous → known link) | `{customerId, cookieId}` |
| `event:sent` | Event POST completed (any outcome) | `{payload, response}` |
| `event:accepted` | Event POST returned 2xx | `{payload, response}` |
| `event:error` | Event POST failed | `{error, payload}` |
| `nba:received` | `getNBA()` returned decisions | `{customerId, decisions}` |
| `feedback:sent` | Feedback POST succeeded | `{payload, response}` |
| `consent:optout` | Opt-out POST succeeded | `{payload, response}` |
| `reset` | `reset()` called | `{cookieId}` |

---

## Event Type → CDH Interaction History Mapping

| SDK `eventType` | CDH IH Node | Description |
|-----------------|-------------|-------------|
| `page_view` | `IH.WebBrowse` | Page/screen viewed |
| `product_view` | `IH.ProductView` | Product detail page or offer viewed |
| `app_open` | `IH.AppSession` | Mobile app opened or foregrounded |
| `form_submit` | `IH.Interaction` | Any form submission (application, enquiry, etc.) |
| `purchase` | `IH.Conversion` | Transaction or purchase completed |
| `call_start` | `IH.CallStart` | Outbound or inbound call initiated |
| `offer_accept` | `IH.OfferAccepted` | Customer accepted a presented offer |
| `offer_reject` | `IH.OfferRejected` | Customer declined a presented offer |
| `login` | `IH.Login` | Customer authenticated (also triggers anonymous-to-known stitching) |

---

## localStorage Keys

| Key | Purpose |
|-----|---------|
| `nx_cid` | Anonymous cookie/device ID (persists across sessions) |
| `nx_uid` | Known customer ID (set after `identify`) |

---

## Example: Full Integration

```html
<script src="nexus.js"></script>
<script>
  // 1. Register listeners before init
  NexusCDP
    .on('init', function(s) { console.log('SDK ready, cookieId:', s.cookieId); })
    .on('stitch:complete', function(s) { console.log('Stitched:', s.customerId); })
    .on('nba:received', function(d) { renderOffers(d.decisions); })
    .on('event:error', function(e) { console.warn('Event failed:', e.error); });

  // 2. Initialise
  NexusCDP.init({
    apiKey: 'my-api-key',
    collectorUrl: 'https://collector.nexuscdp.example.com',
    cdhUrl: 'https://cdh.nexuscdp.example.com',
    debug: true
  });

  // 3. Identify on login
  NexusCDP.identify('cust-001', { segment: 'premium', age: 34 }, function(err) {
    if (!err) {
      // 4. Fetch next best actions
      NexusCDP.getNBA(function(err, decisions) {
        if (!err) { renderOffers(decisions); }
      });
    }
  });

  // 5. Track interactions
  NexusCDP.track('product_view', { productId: 'loan-flex-12m', category: 'personal-loans' });

  // 6. Capture offer feedback
  NexusCDP.feedback('dec-789', 'presented', 'accepted', 'web', null);

  // 7. Consent opt-out
  NexusCDP.optOut(['email', 'sms'], function(err) {
    if (!err) { showConfirmation(); }
  });
</script>
```

---

## Mobile Example

```html
<script src="nexus-mobile.js"></script>
<script>
  NexusCDP.init({ apiKey: 'my-api-key' });

  // App lifecycle
  NexusCDP.trackAppOpen({ campaignId: 'push-summer-sale', osVersion: '17.4' });

  // Biometric login
  NexusCDP.biometricLogin('cust-001', { segment: 'retail' }, function(err) {
    if (!err) { NexusCDP.getNBA(renderOffers); }
  });

  // Push notification tap
  NexusCDP.trackNotificationTap('notif-abc', 'open', null);

  // Background event
  window.addEventListener('blur', function() {
    NexusCDP.trackAppBackground();
  });
</script>
```
