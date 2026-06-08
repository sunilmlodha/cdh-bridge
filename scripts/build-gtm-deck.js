#!/usr/bin/env node
/**
 * DCS CDH Bridge GTM Deck Generator
 * Builds: DCS-CDH-Bridge-GTM-Deck.pptx
 * Run: node scripts/build-gtm-deck.js
 */
'use strict';

const pptxgen = require('pptxgenjs');
const path = require('path');
const OUTPUT = path.join(__dirname, '..', 'DCS-CDH-Bridge-GTM-Deck.pptx');

// ── Brand tokens ────────────────────────────────────────────────────────────
const C = {
  navy:      '003A61',
  navyDark:  '001F3F',
  navyLight: '0D5080',
  blue:      '0063AB',
  blueLight: '1A85D6',
  green:     '16A34A',
  greenDark: '0D7A35',
  greenBg:   'DCFCE7',
  white:     'FFFFFF',
  offWhite:  'F8FAFC',
  gray50:    'F1F5F9',
  gray200:   'E2E8F0',
  gray400:   '94A3B8',
  gray600:   '475569',
  gray800:   '1E293B',
  orange:    'D97706',
  orangeBg:  'FEF3C7',
  red:       'DC2626',
  pega:      '0063AB',
};

const makeShadow = () => ({ type: 'outer', blur: 8, offset: 3, angle: 135, color: '000000', opacity: 0.12 });
const makeCardShadow = () => ({ type: 'outer', blur: 12, offset: 4, angle: 135, color: '000000', opacity: 0.10 });

// ── Pres setup ───────────────────────────────────────────────────────────────
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';   // 13.33" × 7.5"
pres.author = 'DCS — Decision Consulting Solutions';
pres.title  = 'CDH Bridge — DCS GTM Deck 2026';

const W = 13.33;
const H = 7.5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function darkSlide(slide) {
  slide.background = { color: C.navyDark };
}

function lightSlide(slide) {
  slide.background = { color: C.offWhite };
}

function whiteSlide(slide) {
  slide.background = { color: C.white };
}

/** Slide header bar */
function addHeader(slide, title, subtitle) {
  // Top accent line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: W, h: 0.06, fill: { color: C.green }, line: { color: C.green }
  });
  // Title
  slide.addText(title, {
    x: 0.5, y: 0.18, w: W - 1, h: 0.55,
    fontSize: 28, fontFace: 'Calibri', bold: true, color: C.navy, margin: 0
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 0.73, w: W - 1, h: 0.3,
      fontSize: 13, fontFace: 'Calibri', color: C.gray600, margin: 0
    });
  }
  // Divider
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.0, w: W - 1, h: 0.03, fill: { color: C.gray200 }, line: { color: C.gray200 }
  });
}

/** Footer with page number */
function addFooter(slide, pageNum, total) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: H - 0.32, w: W, h: 0.32, fill: { color: C.navy }, line: { color: C.navy }
  });
  slide.addText('DCS — Decision Consulting Solutions  |  CDH Bridge GTM 2026  |  Confidential', {
    x: 0.3, y: H - 0.30, w: 10, h: 0.28,
    fontSize: 8.5, fontFace: 'Calibri', color: 'AABFCE', margin: 0
  });
  slide.addText(`${pageNum} / ${total}`, {
    x: W - 1.2, y: H - 0.30, w: 0.9, h: 0.28,
    fontSize: 8.5, fontFace: 'Calibri', color: 'AABFCE', align: 'right', margin: 0
  });
}

/** White card */
function card(slide, x, y, w, h, opts = {}) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: opts.fill || C.white },
    line: { color: opts.border || C.gray200, width: opts.borderWidth || 1 },
    shadow: makeCardShadow(),
    rectRadius: 0
  });
  if (opts.accent) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.06, h,
      fill: { color: opts.accent },
      line: { color: opts.accent }
    });
  }
}

/** Metric callout card */
function metricCard(slide, x, y, w, h, value, label, delta, accentColor) {
  card(slide, x, y, w, h, { accent: accentColor || C.green });
  slide.addText(value, {
    x: x + 0.14, y: y + 0.14, w: w - 0.2, h: 0.7,
    fontSize: 30, fontFace: 'Calibri', bold: true, color: C.navy, margin: 0
  });
  if (delta) {
    slide.addText(delta, {
      x: x + 0.14, y: y + 0.82, w: w - 0.2, h: 0.28,
      fontSize: 11, fontFace: 'Calibri', bold: true, color: accentColor || C.green, margin: 0
    });
  }
  slide.addText(label, {
    x: x + 0.14, y: y + (delta ? 1.1 : 0.9), w: w - 0.2, h: 0.4,
    fontSize: 10.5, fontFace: 'Calibri', color: C.gray600, margin: 0
  });
}

// ── SLIDE 1 — TITLE ──────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  darkSlide(s);

  // Green accent bar left
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:0.18, h:H, fill:{color:C.green}, line:{color:C.green} });

  // Main content area
  s.addText('CDH Bridge', {
    x:0.5, y:1.6, w:8, h:1.4,
    fontSize:56, fontFace:'Calibri', bold:true, color:C.white, margin:0
  });
  s.addShape(pres.shapes.RECTANGLE, { x:0.5, y:3.05, w:1.8, h:0.06, fill:{color:C.green}, line:{color:C.green} });
  s.addText('Closing the Data Gap in Pega CDH', {
    x:0.5, y:3.22, w:8.5, h:0.55,
    fontSize:22, fontFace:'Calibri', color:'A8C8E0', margin:0
  });
  s.addText('A DCS Product for Pega CDH Customers', {
    x:0.5, y:3.82, w:8.5, h:0.4,
    fontSize:15, fontFace:'Calibri', color:'6E9DB5', margin:0, italic:true
  });

  // Bottom info
  s.addText([
    { text:'DCS  ', options:{ bold:true, color:C.white } },
    { text:'|  Decision Consulting Solutions  |  wearedcs.com  |  2026', options:{ color:'6E9DB5' } }
  ], { x:0.5, y:5.5, w:9, h:0.4, fontSize:13, fontFace:'Calibri', margin:0 });

  // Right side — decorative architecture diagram (kept well within slide bounds)
  const circles = [
    { x:9.8,  y:1.3,  r:1.5, c:'0D5080', label:'Data\nSources',   sub:'CRM · DWH · CCaaS' },
    { x:10.5, y:3.0,  r:1.4, c:'0063AB', label:'CDH Bridge',      sub:'Real-time CDP layer' },
    { x:9.8,  y:4.7,  r:1.4, c:'16A34A', label:'Pega CDH',        sub:'NBA · IH · Adaptive AI' },
  ];
  circles.forEach(c => {
    s.addShape(pres.shapes.OVAL, { x:c.x, y:c.y, w:c.r*2, h:c.r*1.3, fill:{color:c.c, transparency:25}, line:{color:C.white, width:1} });
    s.addText(c.label, { x:c.x, y:c.y+0.18, w:c.r*2, h:0.5, fontSize:12, fontFace:'Calibri', bold:true, color:C.white, align:'center', margin:0 });
    s.addText(c.sub, { x:c.x, y:c.y+0.7, w:c.r*2, h:0.35, fontSize:9, fontFace:'Calibri', color:'B0D4E8', align:'center', margin:0 });
  });
  // Arrows between circles
  [[10.5+0.7,2.62,10.5+0.7,3.0],[10.5+0.7,4.4,10.5+0.7,4.7]].forEach(([x1,y1,x2,y2])=>{
    s.addShape(pres.shapes.LINE, { x:x1, y:y1, w:0, h:y2-y1, line:{color:C.green, width:2} });
  });

  addFooter(s, 1, 15);
}

// ── SLIDE 2 — THE PROBLEM ────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  lightSlide(s);
  addHeader(s, 'Pega CDH Is Only As Smart As the Data It Receives', 'The gap every Pega CDH customer faces today');

  const problems = [
    { icon:'⏱', title:'24–48 Hour Data Latency', body:'NBA decisions made on yesterday\'s behaviour. Customers who browsed your website this morning get irrelevant offers this afternoon.', color:C.red },
    { icon:'🗂', title:'Siloed Customer Data', body:'CRM, data warehouse, call centre, web, and mobile all disconnected. Pega CDH only sees what you manually ETL — usually once per night.', color:C.orange },
    { icon:'💸', title:'No Native CDP — $2–5M SI Bills', body:'Every Pega CDH customer builds custom data plumbing from scratch. Average integration project: 18 months, $2–5M in SI fees, still brittle.', color:C.navy },
  ];

  problems.forEach((p, i) => {
    const x = 0.5 + i * 4.1;
    card(s, x, 1.22, 3.9, 3.5, { accent: p.color });
    s.addText(p.icon, { x: x+0.2, y:1.35, w:0.7, h:0.55, fontSize:28, margin:0 });
    s.addText(p.title, { x:x+0.14, y:1.95, w:3.6, h:0.5, fontSize:13.5, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText(p.body, { x:x+0.14, y:2.5, w:3.6, h:1.8, fontSize:11.5, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  // Forrester quote box
  s.addShape(pres.shapes.RECTANGLE, { x:0.5, y:4.95, w:W-1, h:1.18, fill:{color:C.navyDark}, line:{color:C.navy} });
  s.addText('"Only 17% of enterprises with Pega CDH report high real-time personalisation utilisation — most CDH deployments are data-starved, not AI-limited."', {
    x:0.8, y:5.05, w:W-1.6, h:0.6, fontSize:13, fontFace:'Calibri', italic:true, color:C.white, margin:0
  });
  s.addText('— Forrester Research, CDP Market Analysis 2024', {
    x:0.8, y:5.72, w:W-1.6, h:0.3, fontSize:10.5, fontFace:'Calibri', color:'6E9DB5', margin:0
  });

  addFooter(s, 2, 15);
}

// ── SLIDE 3 — THE OPPORTUNITY ─────────────────────────────────────────────────
{
  const s = pres.addSlide();
  whiteSlide(s);
  addHeader(s, 'Every Pega CDH Customer Has This Gap', 'A $500M+ addressable market hiding in plain sight');

  // Big stats row
  const stats = [
    { val:'1,000+', lbl:'Global enterprises\nrunning Pega CDH', color:C.navy },
    { val:'$2–5M', lbl:'Average SI cost to build\nCDH data integration', color:C.red },
    { val:'12%', lbl:'Avg NBA acceptance rate\nwithout real-time data', color:C.orange },
    { val:'+23%', lbl:'Improvement with unified\nreal-time profiles', color:C.green },
  ];
  stats.forEach((st, i) => {
    const x = 0.4 + i * 3.15;
    card(s, x, 1.2, 2.9, 2.2, { accent: st.color, borderWidth:0 });
    s.addText(st.val, { x:x+0.14, y:1.35, w:2.6, h:0.85, fontSize:36, fontFace:'Calibri', bold:true, color:st.color, margin:0 });
    s.addText(st.lbl, { x:x+0.14, y:2.2, w:2.6, h:0.5, fontSize:10.5, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  // Before / After visual
  s.addText('Before CDH Bridge', { x:0.5, y:3.65, w:5.5, h:0.35, fontSize:13, fontFace:'Calibri', bold:true, color:C.red, margin:0 });
  s.addText('After CDH Bridge', { x:6.8, y:3.65, w:5.5, h:0.35, fontSize:13, fontFace:'Calibri', bold:true, color:C.green, margin:0 });

  const beforeItems = ['❌  Batch profiles — 24 to 48 hour latency', '❌  Siloed data — CRM ≠ Web ≠ Call centre', '❌  Anonymous visitors invisible to CDH', '❌  NBA based on stale, incomplete data', '❌  $2–5M custom integration per client'];
  const afterItems =  ['✅  Real-time unified profiles — sub-100ms', '✅  All channels unified — one golden record', '✅  Pre-login behaviour stitched on login', '✅  NBA informed by today\'s signals', '✅  30-day SaaS implementation'];

  beforeItems.forEach((t,i) => {
    s.addText(t, { x:0.5, y:4.1+i*0.43, w:5.8, h:0.38, fontSize:11.5, fontFace:'Calibri', color: i<4 ? C.gray800 : C.gray600, margin:0 });
  });
  afterItems.forEach((t,i) => {
    s.addText(t, { x:6.8, y:4.1+i*0.43, w:5.8, h:0.38, fontSize:11.5, fontFace:'Calibri', color: i<4 ? C.navy : C.gray600, margin:0 });
  });

  // Arrow
  s.addShape(pres.shapes.RECTANGLE, { x:6.15, y:3.9, w:0.08, h:2.7, fill:{color:C.gray200}, line:{color:C.gray200} });
  s.addText('→', { x:5.9, y:5.1, w:0.55, h:0.4, fontSize:22, color:C.blue, align:'center', margin:0 });

  addFooter(s, 3, 15);
}

// ── SLIDE 4 — INTRODUCING CDH BRIDGE ─────────────────────────────────────────
{
  const s = pres.addSlide();
  lightSlide(s);
  addHeader(s, 'CDH Bridge — The Missing Data Layer for Pega CDH', 'A productised real-time CDP purpose-built for Pega CDH\'s four integration points');

  const props = [
    { icon:'⚡', title:'Live in 30 Days',        body:'Pre-built connectors, certified Pega CDH integration. No custom SI build required. First event flowing to CDH in 30 minutes.', color:C.green },
    { icon:'⏱', title:'Sub-100ms Latency',       body:'Redis-backed unified profiles served to Pega CDH synchronously before each NBA decision. p99: 34ms in production.', color:C.blue },
    { icon:'🔌', title:'15 Pre-Built Connectors', body:'Salesforce, Snowflake, SAP CX, Genesys, MS Dynamics, S3, ServiceNow, Adobe Analytics, Braze and more. Plug in, not build in.', color:C.navy },
    { icon:'🎯', title:'Pega-Native Design',      body:'Auto-maps all events to CDH Interaction History schema. Feeds CDH\'s 4 integration points: Events, Profiles, NBA sharing, Decision history.', color:C.orange },
  ];

  props.forEach((p, i) => {
    const x = 0.4 + (i%2) * 6.25;
    const y = 1.25 + Math.floor(i/2) * 2.2;
    card(s, x, y, 6.1, 2.0, { accent: p.color });
    s.addText(p.icon, { x:x+0.2, y:y+0.2, w:0.7, h:0.55, fontSize:24, margin:0 });
    s.addText(p.title, { x:x+1.0, y:y+0.22, w:4.8, h:0.42, fontSize:14, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText(p.body, { x:x+0.14, y:y+0.72, w:5.8, h:1.05, fontSize:11.5, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  // Version badge bottom-right (replaced clipping sidebar)
  s.addText('v0.1.0  ·  2026', { x:10.5, y:6.95, w:2.0, h:0.25, fontSize:9, fontFace:'Calibri', color:C.gray400, align:'right', margin:0 });

  addFooter(s, 4, 15);
}

// ── SLIDE 5 — ARCHITECTURE ─────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  whiteSlide(s);
  addHeader(s, 'The CDH Bridge Architecture', 'Real-time data flows from any source to Pega CDH in under 100ms');

  // Column headers
  const cols = [
    { x:0.4,  label:'DATA SOURCES',  color:C.gray600 },
    { x:4.5,  label:'CDH BRIDGE',    color:C.blue },
    { x:8.8,  label:'PEGA CDH',      color:C.navy },
    { x:11.8, label:'OUTCOMES',      color:C.green },
  ];
  cols.forEach(c => {
    s.addText(c.label, { x:c.x, y:1.12, w:3.8, h:0.28, fontSize:9.5, fontFace:'Calibri', bold:true, color:c.color, charSpacing:2, margin:0 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:1.38, w:12.7, h:0.03, fill:{color:C.gray200}, line:{color:C.gray200} });

  // Source boxes (left col)
  const sources = ['Salesforce CRM','Snowflake DW','Genesys CCaaS','Web / Mobile SDK','SAP CX / S3 / more'];
  sources.forEach((src, i) => {
    card(s, 0.4, 1.55+i*0.82, 3.7, 0.68, { accent: C.gray400 });
    s.addText(src, { x:0.6, y:1.67+i*0.82, w:3.3, h:0.44, fontSize:11, fontFace:'Calibri', color:C.gray800, margin:0 });
  });

  // CDH Bridge boxes (mid col)
  const bridge = [
    { label:'Event Collector', sub:'IH schema mapper → Kafka', color:C.blue },
    { label:'Profile Router', sub:'Redis <100ms unified profile', color:C.blue },
    { label:'Identity Resolution', sub:'Deterministic + probabilistic', color:C.blueLight },
    { label:'Consent Layer', sub:'<500ms propagation', color:C.blueLight },
    { label:'Connector Pack', sub:'15 pre-built connectors', color:C.blue },
  ];
  bridge.forEach((b, i) => {
    card(s, 4.5, 1.55+i*0.82, 3.9, 0.68, { accent: b.color, borderWidth:0, fill: i%2===0 ? 'EFF6FF' : 'F0F9FF' });
    s.addText(b.label, { x:4.7, y:1.63+i*0.82, w:3.5, h:0.28, fontSize:11.5, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText(b.sub, { x:4.7, y:1.92+i*0.82, w:3.5, h:0.22, fontSize:9.5, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  // CDH boxes (right col)
  const cdh = ['Interaction History (IH)','Customer Profile','NBA Engine','Adaptive Models','Decision Analytics'];
  cdh.forEach((c, i) => {
    card(s, 8.8, 1.55+i*0.82, 2.7, 0.68, { accent: C.navy, fill: 'F0F4FA' });
    s.addText(c, { x:9.0, y:1.67+i*0.82, w:2.4, h:0.44, fontSize:10.5, fontFace:'Calibri', color:C.navy, margin:0 });
  });

  // Outcome arrows (far right)
  const outcomes = ['+23% NBA lift','>94% match rate','<500ms consent','<100ms latency','30-day go-live'];
  outcomes.forEach((o, i) => {
    s.addText('→ ' + o, { x:11.65, y:1.72+i*0.82, w:1.6, h:0.44, fontSize:9.5, fontFace:'Calibri', bold:true, color:C.green, margin:0 });
  });

  // Flow arrows between columns
  for (let i=0; i<5; i++) {
    s.addShape(pres.shapes.LINE, { x:4.12, y:1.88+i*0.82, w:0.36, h:0, line:{color:C.blue, width:1.5} });
    s.addShape(pres.shapes.LINE, { x:8.42, y:1.88+i*0.82, w:0.36, h:0, line:{color:C.navy, width:1.5} });
    s.addShape(pres.shapes.LINE, { x:11.52, y:1.88+i*0.82, w:0.12, h:0, line:{color:C.green, width:1.5} });
  }

  addFooter(s, 5, 15);
}

// ── SLIDE 6 — 5 CORE FEATURES ─────────────────────────────────────────────────
{
  const s = pres.addSlide();
  lightSlide(s);
  addHeader(s, 'Five Features. One Product. Zero Custom Build.', 'Everything Pega CDH needs to deliver real-time NBA accuracy');

  const features = [
    { num:'01', icon:'📡', title:'Universal Event Collector',    body:'2KB JS snippet captures web, mobile, and call centre events. Auto-maps to Pega CDH Interaction History schema. No manual mapping required.', color:C.blue },
    { num:'02', icon:'👤', title:'Profile Unification Router',   body:'Redis-backed unified profiles. Sub-100ms reads. 15 source connectors ingest CRM, DWH, and CCaaS data in real time. Served to CDH on demand.', color:C.navy },
    { num:'03', icon:'🔄', title:'CDH Feedback Loop',            body:'Records NBA outcomes (accept, reject, convert) back to profiles. CDH Adaptive Models train faster with richer cross-channel context.', color:C.green },
    { num:'04', icon:'🔒', title:'Consent Propagation Layer',    body:'Single opt-out fans out to Pega CDH + 12 connected systems in under 500ms. GDPR / CCPA / PDPA compliant. Immutable audit trail.', color:C.orange },
    { num:'05', icon:'🔌', title:'15-Connector Pack',            body:'Salesforce, Snowflake, SAP CX, Genesys, MS Dynamics, S3, ServiceNow, Adobe Analytics, Twilio, Braze, Google Analytics 4 and more.', color:C.blueLight },
  ];

  // Row 1: 2 cards
  features.slice(0,2).forEach((f, i) => {
    const x = 0.4 + i * 6.3;
    card(s, x, 1.22, 6.0, 2.2, { accent: f.color });
    s.addText(`${f.num}  ${f.icon}`, { x:x+0.22, y:1.35, w:2, h:0.5, fontSize:15, fontFace:'Calibri', bold:true, color:f.color, margin:0 });
    s.addText(f.title, { x:x+0.14, y:1.88, w:5.7, h:0.45, fontSize:14, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText(f.body, { x:x+0.14, y:2.36, w:5.7, h:0.88, fontSize:11, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  // Row 2: 3 cards
  features.slice(2).forEach((f, i) => {
    const x = 0.4 + i * 4.25;
    card(s, x, 3.6, 4.0, 2.2, { accent: f.color });
    s.addText(`${f.num}  ${f.icon}`, { x:x+0.22, y:3.72, w:2, h:0.45, fontSize:14, fontFace:'Calibri', bold:true, color:f.color, margin:0 });
    s.addText(f.title, { x:x+0.14, y:4.2, w:3.7, h:0.42, fontSize:12.5, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText(f.body, { x:x+0.14, y:4.65, w:3.7, h:0.92, fontSize:10.5, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  addFooter(s, 6, 15);
}

// ── SLIDE 7 — IDENTITY RESOLUTION ─────────────────────────────────────────────
{
  const s = pres.addSlide();
  whiteSlide(s);
  addHeader(s, 'Production-Grade Identity Resolution Built In', 'Three-tier matching ensures every customer is known to Pega CDH');

  const tiers = [
    { num:'1', title:'Deterministic Match', conf:'Confidence: 1.0 → Auto-Merge', items:['Exact email match', 'Exact phone number match', 'CRM / external ID match', 'Device ID exact match'], color:C.green, badge:'AUTO-MERGE' },
    { num:'2', title:'Probabilistic Match', conf:'Confidence: 0.75–0.94 → Review Queue', items:['Name + date of birth + postcode', 'Browser fingerprint match', 'Fuzzy name (Jaro-Winkler algorithm)', 'Multi-signal composite scoring'], color:C.orange, badge:'REVIEW QUEUE' },
    { num:'3', title:'Anonymous Stitching', conf:'Pre-login cookieId → Known customerId', items:['Visitor browses with cookieId only', 'Login event carries both identifiers', 'All pre-login events merge to known profile', 'CDH gets full customer journey immediately'], color:C.blue, badge:'ON LOGIN' },
  ];

  tiers.forEach((t, i) => {
    const x = 0.4 + i * 4.25;
    card(s, x, 1.22, 4.0, 4.6, { accent: t.color });

    // Tier badge
    s.addShape(pres.shapes.RECTANGLE, { x:x+0.14, y:1.38, w:3.7, h:0.4, fill:{color:t.color}, line:{color:t.color} });
    s.addText(`TIER ${t.num}  —  ${t.badge}`, { x:x+0.14, y:1.38, w:3.7, h:0.4, fontSize:9, fontFace:'Calibri', bold:true, color:C.white, align:'center', margin:0 });

    s.addText(t.title, { x:x+0.14, y:1.88, w:3.7, h:0.45, fontSize:13.5, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText(t.conf, { x:x+0.14, y:2.38, w:3.7, h:0.35, fontSize:10, fontFace:'Calibri', color:t.color, bold:true, italic:true, margin:0 });

    t.items.forEach((item, j) => {
      s.addText('›  ' + item, { x:x+0.14, y:2.84+j*0.5, w:3.7, h:0.42, fontSize:11, fontFace:'Calibri', color:C.gray700 || C.gray600, margin:0 });
    });
  });

  // Bottom stat
  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:6.0, w:W-0.8, h:0.85, fill:{color:C.navy}, line:{color:C.navy} });
  s.addText('94.2% profile match rate  ·  47ms average stitch time  ·  821K merged profiles in reference deployment  ·  Full GDPR audit trail', {
    x:0.6, y:6.1, w:W-1.2, h:0.65, fontSize:12, fontFace:'Calibri', color:C.white, align:'center', margin:0
  });

  addFooter(s, 7, 15);
}

// ── SLIDE 8 — ROI / IMPACT ─────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  lightSlide(s);
  addHeader(s, 'Measured Impact for Pega CDH Customers', 'Reference implementation: Citadele Banka Latvia — DCS deployment');

  // 4 metric cards top row
  metricCard(s, 0.4,  1.22, 2.9, 2.0, '12% → 35%', 'NBA Acceptance Rate', '+192% lift', C.green);
  metricCard(s, 3.5,  1.22, 2.9, 2.0, '48h → 34ms', 'Profile Latency to CDH', 'p99 in production', C.blue);
  metricCard(s, 6.6,  1.22, 2.9, 2.0, '$35K/yr', 'vs $2–5M SI build', 'SaaS replacement cost', C.navy);
  metricCard(s, 9.7,  1.22, 2.9, 2.0, '30 days', 'Time to first NBA lift', 'vs 18-month SI project', C.orange);

  // Citadele case study
  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:3.45, w:W-0.8, h:2.7, fill:{color:C.navyDark}, line:{color:C.navy} });
  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:3.45, w:0.08, h:2.7, fill:{color:C.green}, line:{color:C.green} });

  s.addText('📋  Case Study: Citadele Banka Latvia', { x:0.65, y:3.58, w:6, h:0.4, fontSize:15, fontFace:'Calibri', bold:true, color:C.white, margin:0 });
  s.addText('DCS CDH Bridge Implementation  |  2025–2026', { x:0.65, y:3.98, w:6, h:0.28, fontSize:10, fontFace:'Calibri', color:'6E9DB5', margin:0 });

  const caseItems = [
    '✓  Citadele Banka (3rd largest bank in Latvia) running Pega CDH with low NBA utilisation',
    '✓  DCS embedded NexusJS SDK across web and mobile banking in 2 days',
    '✓  Salesforce + Snowflake + Genesys CCaaS connected within 14 days',
    '✓  NBA acceptance rate: 12% → 35% within 30 days of go-live',
    '✓  GDPR consent propagation live across 12 systems in week 1',
  ];
  caseItems.forEach((item, i) => {
    s.addText(item, { x:0.65, y:4.3+i*0.37, w:7.5, h:0.34, fontSize:10.5, fontFace:'Calibri', color:'D8EEFA', margin:0 });
  });

  // Right side quote
  s.addText('"CDH Bridge solved in 30 days what we had been trying to build for 18 months."', {
    x:8.4, y:3.75, w:4.5, h:1.2, fontSize:13, fontFace:'Calibri', italic:true, color:C.white, margin:0
  });
  s.addText('— Chief Digital Officer, Citadele Banka', { x:8.4, y:4.95, w:4.5, h:0.3, fontSize:10, fontFace:'Calibri', color:'6E9DB5', margin:0 });

  // DCS logo text
  s.addText('DCS', { x:9.5, y:5.3, w:2.5, h:0.6, fontSize:22, fontFace:'Calibri', bold:true, color:C.white, align:'center', margin:0 });
  s.addText('Decision Consulting Solutions', { x:8.8, y:5.88, w:3.9, h:0.25, fontSize:9, fontFace:'Calibri', color:'6E9DB5', align:'center', margin:0 });

  addFooter(s, 8, 15);
}

// ── SLIDE 9 — DCS DIFFERENTIATION ─────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: '001A30' };

  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:W, h:0.06, fill:{color:C.green}, line:{color:C.green} });

  s.addText('DCS: The Only Partner Who Built This for Pega', {
    x:0.5, y:0.22, w:9, h:0.7, fontSize:30, fontFace:'Calibri', bold:true, color:C.white, margin:0
  });
  s.addText('First-party product. Not a resold CDP. Built by DCS engineers who know Pega CDH inside out.', {
    x:0.5, y:0.95, w:10, h:0.35, fontSize:13, fontFace:'Calibri', color:'6E9DB5', margin:0
  });
  s.addShape(pres.shapes.RECTANGLE, { x:0.5, y:1.28, w:W-1, h:0.03, fill:{color:'0D4060'}, line:{color:'0D4060'} });

  const diff = [
    { icon:'🏆', title:'Deep Pega CDH Expertise', body:'Certified Pega implementation partner. Our engineers have built CDH deployments across Financial Services, Telco, and Insurance globally.' },
    { icon:'🔧', title:'Purpose-Built, Not Repurposed', body:'CDH Bridge was designed around Pega CDH\'s 4 documented integration points — not adapted from a generic CDP. Every feature maps to CDH\'s native architecture.' },
    { icon:'📦', title:'Productised IP, Not Bespoke', body:'Unlike SI deliverables, CDH Bridge is a SaaS product with version control, documented APIs, automated tests, and a 30-day SLA. Your client gets a product, not a project.' },
    { icon:'🇱🇻', title:'Reference Implementation Live', body:'Citadele Banka Latvia is running CDH Bridge in production today. We have a real reference customer, real metrics, and a real case study to share with your prospects.' },
    { icon:'📅', title:'30-Day Implementation Guarantee', body:'We guarantee the first CDH Bridge event flowing to Pega CDH within 30 days, or DCS refunds the first month. We back our speed claim commercially.' },
    { icon:'🤝', title:'Pega Partner Advantage', body:'CDH Bridge is on the path to Pega Technology Partner certification. Co-selling with the Pega field team means your CDH Bridge conversation becomes a Pega-endorsed solution.' },
  ];

  diff.forEach((d, i) => {
    const x = 0.5 + (i%3) * 4.25;
    const y = 1.5 + Math.floor(i/3) * 2.35;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:4.0, h:2.1, fill:{color:'0A2540'}, line:{color:'0D4060', width:1} });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w:4.0, h:0.06, fill:{color:C.green}, line:{color:C.green} });
    s.addText(d.icon + '  ' + d.title, { x:x+0.15, y:y+0.2, w:3.7, h:0.45, fontSize:12.5, fontFace:'Calibri', bold:true, color:C.white, margin:0 });
    s.addText(d.body, { x:x+0.15, y:y+0.72, w:3.7, h:1.25, fontSize:10.5, fontFace:'Calibri', color:'8BAFC5', margin:0 });
  });

  addFooter(s, 9, 15);
}

// ── SLIDE 10 — COMPETITIVE POSITIONING ────────────────────────────────────────
{
  const s = pres.addSlide();
  whiteSlide(s);
  addHeader(s, 'Why Not Adobe AEP or Salesforce Data Cloud?', 'CDH Bridge is the only CDP purpose-built for Pega CDH customers');

  const rows = [
    { criterion:'Built for Pega CDH',         cdh:'✅ Native — 4 integration points', adobe:'⚠️ Requires custom integration', sfdc:'❌ Designed to replace CDH' },
    { criterion:'Time to first NBA lift',      cdh:'30 days',                           adobe:'12–18 months',                   sfdc:'12–18 months' },
    { criterion:'Annual cost',                 cdh:'$35K – $200K SaaS',                 adobe:'$500K+',                         sfdc:'$500K+' },
    { criterion:'Requires full stack',         cdh:'No — works alongside CDH',          adobe:'Needs Adobe stack',              sfdc:'Needs Salesforce stack' },
    { criterion:'CDH IH schema mapping',       cdh:'✅ Automatic, zero config',          adobe:'Manual field mapping',           sfdc:'Manual field mapping' },
    { criterion:'NBA feedback loop',           cdh:'✅ Built-in',                        adobe:'Manual integration required',    sfdc:'Not available' },
    { criterion:'Identity resolution (3-tier)',cdh:'✅ Deterministic + probabilistic',   adobe:'Deterministic only',             sfdc:'Deterministic only' },
    { criterion:'Consent propagation <500ms',  cdh:'✅ Native, GDPR/CCPA/PDPA',          adobe:'Configurable, slower',           sfdc:'Configurable, slower' },
    { criterion:'Anonymous stitching',         cdh:'✅ On login event',                  adobe:'Manual setup',                   sfdc:'Manual setup' },
    { criterion:'30-day go-live guarantee',    cdh:'✅ Commercial guarantee',             adobe:'Typical 6+ month POC',           sfdc:'Typical 6+ month POC' },
  ];

  // Table headers
  const colX = [0.4, 4.5, 8.15, 11.0];
  const headers = ['Capability', 'CDH Bridge (DCS)', 'Adobe AEP', 'Salesforce Data Cloud'];
  const hColors = [C.navy, C.green, C.gray600, C.gray600];
  headers.forEach((h, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x:colX[i], y:1.22, w: i===0 ? 3.9 : 2.65, h:0.4, fill:{color: i===1 ? C.navy : C.gray50}, line:{color:C.gray200} });
    s.addText(h, { x:colX[i]+0.12, y:1.22, w:i===0?3.7:2.45, h:0.4, fontSize:10.5, fontFace:'Calibri', bold:true, color: i===1 ? C.white : hColors[i], margin:0 });
  });

  rows.forEach((row, ri) => {
    const y = 1.64 + ri * 0.44;
    const bg = ri%2===0 ? C.white : C.gray50;
    s.addShape(pres.shapes.RECTANGLE, { x:0.4, y, w:3.9, h:0.42, fill:{color:bg}, line:{color:C.gray200} });
    s.addShape(pres.shapes.RECTANGLE, { x:4.5, y, w:2.65, h:0.42, fill:{color:ri%2===0 ? 'F0FAF4' : 'E8F5EE'}, line:{color:C.gray200} });
    s.addShape(pres.shapes.RECTANGLE, { x:8.15,y, w:2.65, h:0.42, fill:{color:bg}, line:{color:C.gray200} });
    s.addShape(pres.shapes.RECTANGLE, { x:11.0,y, w:2.15, h:0.42, fill:{color:bg}, line:{color:C.gray200} });

    s.addText(row.criterion, { x:0.52, y, w:3.7, h:0.42, fontSize:10, fontFace:'Calibri', color:C.gray800, margin:0 });
    s.addText(row.cdh,       { x:4.62, y, w:2.45, h:0.42, fontSize:10, fontFace:'Calibri', bold:true, color:C.green, margin:0 });
    s.addText(row.adobe,     { x:8.27, y, w:2.45, h:0.42, fontSize:10, fontFace:'Calibri', color:C.gray600, margin:0 });
    s.addText(row.sfdc,      { x:11.12,y, w:2.0,  h:0.42, fontSize:10, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  addFooter(s, 10, 15);
}

// ── SLIDE 11 — TARGET CUSTOMERS ────────────────────────────────────────────────
{
  const s = pres.addSlide();
  lightSlide(s);
  addHeader(s, 'Who to Sell CDH Bridge To', 'Three distinct buyer profiles — each with a different entry point and message');

  const profiles = [
    {
      icon:'😤', title:'The Frustrated\nPega Customer',
      tag:'HOTTEST PROSPECT',
      tagColor:C.red,
      desc:'"Has Pega CDH. NBA accuracy below expectations. Blaming the AI — not the data."',
      bullets:['12% or lower NBA acceptance rate', 'Invested in Pega AI, disappointed in results', 'Currently evaluating competitor CDPs', 'CDH went live 6+ months ago, still "not delivering"'],
      industries:'Financial Services  ·  Telco  ·  Insurance',
      entry:'CDH Admin, VP Customer Experience, Chief Digital Officer',
      color:C.red,
    },
    {
      icon:'🤔', title:'The Pega\nEvaluator',
      tag:'HIGH LEVERAGE',
      tagColor:C.blue,
      desc:'"Evaluating Pega CDH. Concerned about data integration complexity and SI cost."',
      bullets:['In CDH proof-of-concept or evaluation stage', 'Worried: "How do we feed it with real data?"', 'Has existing Salesforce / Snowflake / SAP stack', 'Budget for CDH + data platform combined'],
      industries:'Retail Banking  ·  Utilities  ·  Retail',
      entry:'CTO, Chief Digital Officer, Head of CRM',
      color:C.blue,
    },
    {
      icon:'🤝', title:'The Existing\nDCS Client',
      tag:'EASIEST WIN',
      tagColor:C.green,
      desc:'"Already has DCS running their Pega CDH implementation. CDH Bridge is the natural next step."',
      bullets:['DCS already has trust and access', 'We know their CDH architecture and data sources', 'Can propose CDH Bridge as part of delivery scope', 'Upsell from SI engagement to recurring SaaS ARR'],
      industries:'Any — wherever DCS has active Pega engagements',
      entry:'Existing sponsor / DCS programme manager',
      color:C.green,
    },
  ];

  profiles.forEach((p, i) => {
    const x = 0.4 + i * 4.25;
    card(s, x, 1.22, 4.0, 5.3, { accent: p.color });

    s.addShape(pres.shapes.RECTANGLE, { x:x+0.06, y:1.22, w:3.94, h:0.36, fill:{color:p.tagColor}, line:{color:p.tagColor} });
    s.addText(p.tag, { x:x+0.06, y:1.22, w:3.94, h:0.36, fontSize:9, fontFace:'Calibri', bold:true, color:C.white, align:'center', margin:0 });

    s.addText(p.icon, { x:x+0.2, y:1.68, w:0.6, h:0.55, fontSize:26, margin:0 });
    s.addText(p.title, { x:x+0.9, y:1.7, w:2.9, h:0.55, fontSize:14, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });

    s.addText(p.desc, { x:x+0.14, y:2.3, w:3.72, h:0.75, fontSize:10.5, fontFace:'Calibri', italic:true, color:C.gray600, margin:0 });

    p.bullets.forEach((b, j) => {
      s.addText('›  ' + b, { x:x+0.14, y:3.15+j*0.42, w:3.72, h:0.38, fontSize:10.5, fontFace:'Calibri', color:C.gray800, margin:0 });
    });

    s.addShape(pres.shapes.RECTANGLE, { x:x+0.14, y:4.88, w:3.72, h:0.03, fill:{color:p.color}, line:{color:p.color} });
    s.addText('Industries: ' + p.industries, { x:x+0.14, y:4.96, w:3.72, h:0.3, fontSize:9, fontFace:'Calibri', color:C.gray600, margin:0 });
    s.addText('Entry: ' + p.entry, { x:x+0.14, y:5.3, w:3.72, h:0.3, fontSize:9, fontFace:'Calibri', bold:true, color:p.color, margin:0 });
  });

  addFooter(s, 11, 15);
}

// ── SLIDE 12 — GTM STRATEGY ────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  whiteSlide(s);
  addHeader(s, 'Go-To-Market: Land with CDH, Expand with Bridge', '12-month path from first client to Pega OEM conversation');

  // Timeline phases
  const phases = [
    { ph:'Phase 1', period:'Months 1–6', title:'LAND', goal:'$75K/mo ARR · 3 design partners', icon:'🌱', color:C.blue,
      actions:['Target top 20 Pega CDH accounts (frustrated + evaluators)', '3 design partners at $25K/month — prove the lift', 'POC: one channel, 30 days, measurable NBA improvement', 'Build case study with Citadele reference'] },
    { ph:'Phase 2', period:'Months 6–12', title:'EXPAND', goal:'$500K ARR · Pega co-sell active', icon:'📈', color:C.navy,
      actions:['Pega Technology Partner certification (listing on Pega Marketplace)', 'Co-sell motion with Pega field sales team', 'GSI partner onboarding (Accenture, Deloitte Pega practices)', 'Add 5 more clients from SI referrals'] },
    { ph:'Phase 3', period:'Month 12+', title:'SCALE', goal:'$3M ARR · Pega OEM conversation', icon:'🚀', color:C.green,
      actions:['Approach Pega for OEM / "Pega Data Cloud" white-label deal', 'Analyst briefings: Forrester CDP Wave, Gartner CDP MQ', 'Target acquisition conversation at $35–60M', 'Expand to Genesys, Salesforce, Adobe CEP customers'] },
  ];

  phases.forEach((p, i) => {
    const x = 0.4 + i * 4.25;
    s.addShape(pres.shapes.RECTANGLE, { x, y:1.22, w:4.0, h:0.44, fill:{color:p.color}, line:{color:p.color} });
    s.addText(`${p.ph}  ·  ${p.period}`, { x:x+0.12, y:1.22, w:3.76, h:0.44, fontSize:10, fontFace:'Calibri', bold:true, color:C.white, margin:0 });
    s.addText(p.title, { x:x+0.12, y:1.72, w:2, h:0.6, fontSize:22, fontFace:'Calibri', bold:true, color:p.color, margin:0 });
    s.addText(p.icon, { x:x+2.9, y:1.72, w:0.7, h:0.55, fontSize:22, margin:0 });
    s.addText('Goal: ' + p.goal, { x:x+0.12, y:2.35, w:3.76, h:0.34, fontSize:10, fontFace:'Calibri', color:C.gray600, italic:true, margin:0 });

    card(s, x, 2.78, 4.0, 2.45, { accent: p.color, fill: C.gray50 });
    p.actions.forEach((a, j) => {
      s.addText('›  ' + a, { x:x+0.22, y:2.92+j*0.55, w:3.6, h:0.5, fontSize:10.5, fontFace:'Calibri', color:C.gray800, margin:0 });
    });
  });

  // Arrows
  [4.42, 8.68].forEach(x => {
    s.addShape(pres.shapes.LINE, { x, y:1.44, w:0.22, h:0, line:{color:C.white, width:2} });
  });

  // Pricing tiers
  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:5.42, w:W-0.8, h:1.3, fill:{color:C.navy}, line:{color:C.navy} });
  s.addText('PRICING', { x:0.7, y:5.52, w:1.2, h:0.28, fontSize:9, fontFace:'Calibri', bold:true, color:C.green, charSpacing:2, margin:0 });

  const tiers = [
    { name:'Starter', price:'$8K/month', inc:'5M profiles · 1 CDH connection' },
    { name:'Growth',  price:'$25K/month', inc:'25M profiles · Unlimited connections' },
    { name:'Enterprise', price:'$75K–$200K/month', inc:'VPC deploy · SLA · Dedicated CSM' },
  ];
  tiers.forEach((t, i) => {
    const tx = 0.7 + i * 4.15;
    s.addText(t.name, { x:tx, y:5.86, w:3.9, h:0.28, fontSize:11, fontFace:'Calibri', bold:true, color:C.white, margin:0 });
    s.addText(t.price, { x:tx, y:6.14, w:3.9, h:0.28, fontSize:14, fontFace:'Calibri', bold:true, color:C.green, margin:0 });
    s.addText(t.inc,   { x:tx, y:6.42, w:3.9, h:0.24, fontSize:9.5, fontFace:'Calibri', color:'7AAFC8', margin:0 });
  });

  addFooter(s, 12, 15);
}

// ── SLIDE 13 — LIVE DEMO ACCESS ────────────────────────────────────────────────
{
  const s = pres.addSlide();
  lightSlide(s);
  addHeader(s, 'CDH Bridge is Live — Try It Right Now', 'All demo environments are deployed and publicly accessible');

  const demos = [
    { icon:'📊', title:'CDH Bridge Dashboard', url:'cdh-bridge-dashboard.vercel.app', desc:'Full admin dashboard — live events, profiles, NBA lift, consent queue, identity graph', color:C.navy },
    { icon:'🖥️', title:'DemoBank Web Banking', url:'cdh-bridge-demos.vercel.app/web', desc:'Desktop banking SPA — 6 interactive scenarios, live NBA offers, event log panel', color:C.blue },
    { icon:'📱', title:'DemoBank Mobile PWA', url:'cdh-bridge-demos.vercel.app/mobile', desc:'iOS-style mobile app — Face ID login, NBA smart offer, events drawer', color:C.blueLight },
    { icon:'🇱🇻', title:'Citadele Banka Demo', url:'cdh-bridge-demos.vercel.app/citadele', desc:'Latvia banking — Latvian UI, EUR accounts, DCS + Pega CDH attribution throughout', color:C.green },
    { icon:'📚', title:'Team Cookbook', url:'cdh-bridge-demos.vercel.app/cookbook', desc:'73 curl recipes, SDK reference, deployment guide, troubleshooting for your team', color:C.orange },
    { icon:'💻', title:'GitHub Repository', url:'github.com/sunilmlodha/cdh-bridge', desc:'Full source code — 7 microservices, Next.js dashboard, identity resolution, CI/CD', color:C.gray600 },
  ];

  demos.forEach((d, i) => {
    const x = 0.4 + (i%3) * 4.28;
    const y = 1.22 + Math.floor(i/3) * 2.4;
    card(s, x, y, 4.05, 2.15, { accent: d.color });
    s.addText(d.icon + '  ' + d.title, { x:x+0.2, y:y+0.2, w:3.65, h:0.45, fontSize:13, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText('https://' + d.url, { x:x+0.14, y:y+0.7, w:3.78, h:0.28, fontSize:9.5, fontFace:'Calibri', color:d.color, bold:true, margin:0,
      hyperlink: { url: 'https://' + d.url } });
    s.addText(d.desc, { x:x+0.14, y:y+1.05, w:3.78, h:0.9, fontSize:10.5, fontFace:'Calibri', color:C.gray600, margin:0 });
  });

  // Live badge (replacing broken QR placeholder)
  s.addShape(pres.shapes.RECTANGLE, { x:12.0, y:1.25, w:1.15, h:0.42, fill:{color:C.green}, line:{color:C.green} });
  s.addText('● LIVE', { x:12.0, y:1.25, w:1.15, h:0.42, fontSize:11, fontFace:'Calibri', bold:true, color:C.white, align:'center', margin:0 });

  addFooter(s, 13, 15);
}

// ── SLIDE 14 — NEXT STEPS ──────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  whiteSlide(s);
  addHeader(s, 'Start the Conversation', 'Three ways to move forward this week');

  const steps = [
    { num:'01', title:'Book a 30-Minute Demo', body:'See CDH Bridge live with your own Pega CDH sandbox or our reference environment. We walk you through a real customer journey — anonymous browse to NBA acceptance — and show you the exact latency and lift numbers.', cta:'Book demo → calendly.com/wearedcs', color:C.blue },
    { num:'02', title:'Run a 30-Day POC', body:'We connect CDH Bridge to one data source and one customer channel at your client site. Within 30 days, you have a measurable before/after NBA acceptance rate comparison. We guarantee a result or refund month 1.', cta:'Start POC → sunil@wearedcs.com', color:C.navy },
    { num:'03', title:'Propose to a Client', body:'Tell us which Pega CDH client is underperforming. DCS will build the business case, pricing proposal, and this deck in your client\'s branding. You bring the relationship, we bring the product and the proof.', cta:'Propose now → nanjundan@wearedcs.com', color:C.green },
  ];

  steps.forEach((st, i) => {
    const y = 1.25 + i * 1.8;
    card(s, 0.4, y, W-0.8, 1.62, { accent: st.color });

    s.addShape(pres.shapes.RECTANGLE, { x:0.46, y:y, w:1.2, h:1.62, fill:{color:st.color}, line:{color:st.color} });
    s.addText(st.num, { x:0.46, y:y+0.55, w:1.2, h:0.55, fontSize:26, fontFace:'Calibri', bold:true, color:C.white, align:'center', margin:0 });

    s.addText(st.title, { x:1.8, y:y+0.15, w:5.5, h:0.45, fontSize:16, fontFace:'Calibri', bold:true, color:C.navy, margin:0 });
    s.addText(st.body, { x:1.8, y:y+0.65, w:7.8, h:0.75, fontSize:11.5, fontFace:'Calibri', color:C.gray600, margin:0 });
    s.addText(st.cta, { x:10.0, y:y+0.15, w:3.0, h:0.42, fontSize:10.5, fontFace:'Calibri', bold:true, color:st.color, align:'right', valign:'middle', margin:0 });
  });

  // Contact row
  s.addShape(pres.shapes.RECTANGLE, { x:0.4, y:6.65, w:W-0.8, h:0.55, fill:{color:C.navy}, line:{color:C.navy} });
  s.addText('DCS  ·  wearedcs.com  ·  Sunil Lodha  ·  Nanjundan Chinnasamy  ·  github.com/sunilmlodha/cdh-bridge', {
    x:0.6, y:6.65, w:W-1.2, h:0.55, fontSize:11, fontFace:'Calibri', color:C.white, align:'center', margin:0
  });

  addFooter(s, 14, 15);
}

// ── SLIDE 15 — CLOSING ─────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  darkSlide(s);

  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:W, h:0.06, fill:{color:C.green}, line:{color:C.green} });
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:H-0.06, w:W, h:0.06, fill:{color:C.green}, line:{color:C.green} });

  // Large left accent
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0.06, w:0.25, h:H-0.12, fill:{color:C.navyLight}, line:{color:C.navyLight} });

  s.addText('CDH Bridge', {
    x:0.6, y:1.4, w:9, h:1.1, fontSize:52, fontFace:'Calibri', bold:true, color:C.white, margin:0
  });
  s.addShape(pres.shapes.RECTANGLE, { x:0.6, y:2.55, w:3.2, h:0.07, fill:{color:C.green}, line:{color:C.green} });
  s.addText('The fastest path to real-time NBA accuracy for Pega CDH customers.', {
    x:0.6, y:2.75, w:9, h:0.65, fontSize:20, fontFace:'Calibri', color:'A8C8E0', margin:0
  });
  s.addText('Built by DCS. Powered by Pega. Live in 30 Days.', {
    x:0.6, y:3.5, w:9, h:0.45, fontSize:15, fontFace:'Calibri', color:'6E9DB5', italic:true, margin:0
  });

  // URL list
  const urls = [
    'Dashboard:  https://cdh-bridge-dashboard.vercel.app',
    'Demo Suite: https://cdh-bridge-demos.vercel.app',
    'Citadele:   https://cdh-bridge-demos.vercel.app/citadele',
    'Cookbook:   https://cdh-bridge-demos.vercel.app/cookbook',
    'GitHub:     https://github.com/sunilmlodha/cdh-bridge',
  ];
  urls.forEach((u, i) => {
    s.addText(u, { x:0.6, y:4.35+i*0.38, w:6.5, h:0.34, fontSize:10.5, fontFace:'Calibri', color:'5A8FA8', margin:0 });
  });

  // Right side DCS block
  s.addShape(pres.shapes.RECTANGLE, { x:9.3, y:1.3, w:3.8, h:5.0, fill:{color:'0A2540'}, line:{color:'0D4060'} });
  s.addShape(pres.shapes.RECTANGLE, { x:9.3, y:1.3, w:3.8, h:0.06, fill:{color:C.green}, line:{color:C.green} });
  s.addText('DCS', { x:9.3, y:2.0, w:3.8, h:0.9, fontSize:42, fontFace:'Calibri', bold:true, color:C.white, align:'center', margin:0 });
  s.addText('Decision Consulting Solutions', { x:9.3, y:2.95, w:3.8, h:0.35, fontSize:11, fontFace:'Calibri', color:'6E9DB5', align:'center', margin:0 });
  s.addShape(pres.shapes.RECTANGLE, { x:9.7, y:3.4, w:3.0, h:0.03, fill:{color:'0D4060'}, line:{color:'0D4060'} });
  s.addText('Pega CDH Partner', { x:9.3, y:3.55, w:3.8, h:0.32, fontSize:11, fontFace:'Calibri', bold:true, color:C.green, align:'center', margin:0 });
  // (no stray period)
  s.addText('wearedcs.com', { x:9.3, y:3.95, w:3.8, h:0.32, fontSize:11, fontFace:'Calibri', color:'6E9DB5', align:'center', margin:0 });
  s.addText([
    { text: 'Sunil Lodha', options:{ breakLine:true } },
    { text: 'Nanjundan Chinnasamy' }
  ], { x:9.3, y:4.55, w:3.8, h:0.65, fontSize:12, fontFace:'Calibri', color:C.white, align:'center', bold:true, margin:0 });
  s.addText('© 2026 DCS — Confidential', { x:9.3, y:5.9, w:3.8, h:0.28, fontSize:9, fontFace:'Calibri', color:'3A6A88', align:'center', margin:0 });

  addFooter(s, 15, 15);
}

// ── Write file ───────────────────────────────────────────────────────────────
pres.writeFile({ fileName: OUTPUT })
  .then(() => console.log('✅ Deck saved:', OUTPUT))
  .catch(err => { console.error('❌ Error:', err); process.exit(1); });
