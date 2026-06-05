'use strict';

/**
 * Redis-backed identity graph using adjacency sets.
 *
 * Redis data model:
 *   graph:node:{nodeId}      STRING  — NodeRecord JSON
 *   graph:edges:{nodeId}     SET     — set of nodeIds this node is connected to
 *   graph:golden:{nodeId}    STRING  — resolved golden customerId
 *   graph:alias:{identifier} STRING  — maps any identifier → nodeId
 *   graph:stats              HASH    — totalNodes, totalEdges, mergeCount
 *
 * NodeRecord: { nodeId, type, value, source, confidence, createdAt, lastSeenAt }
 * Edge: { nodeA, nodeB, edgeType, confidence, createdAt }
 *   edgeType: 'SAME_AS' | 'SEEN_ON' | 'HOUSEHOLD' | 'RELATED_TO'
 */

const { v4: uuidv4 } = require('uuid');
const store = require('../profile-store');
const logger = require('../logger');

const NODE_TYPES   = ['customer', 'email', 'phone', 'device', 'cookie', 'crmId'];
const EDGE_TYPES   = ['SAME_AS', 'SEEN_ON', 'HOUSEHOLD', 'RELATED_TO'];
const NODE_TTL     = 90 * 24 * 60 * 60; // 90 days
const MAX_BFS_HOPS = 4;

// ─── Redis key helpers ────────────────────────────────────────────────────────

function nodeKey(nodeId)       { return `graph:node:${nodeId}`; }
function edgesKey(nodeId)      { return `graph:edges:${nodeId}`; }
function goldenKey(nodeId)     { return `graph:golden:${nodeId}`; }
function aliasKey(identifier)  { return `graph:alias:${String(identifier).toLowerCase()}`; }
const STATS_KEY = 'graph:stats';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getClient() {
  return store.getClient();
}

async function _readNode(nodeId) {
  const raw = await getClient().get(nodeKey(nodeId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function _writeNode(record) {
  await getClient().set(nodeKey(record.nodeId), JSON.stringify(record), 'EX', NODE_TTL);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add (or update lastSeenAt for) a node in the identity graph.
 * Returns the nodeId.
 */
async function addNode(type, value, source) {
  if (!NODE_TYPES.includes(type)) throw new Error(`Unknown node type: ${type}`);
  if (!value) throw new Error('value is required');

  const client = getClient();
  const normValue = String(value).toLowerCase();
  const aliasK = aliasKey(normValue);

  // Check if node already exists for this identifier
  let nodeId = await client.get(aliasK);
  if (nodeId) {
    // Update lastSeenAt
    const existing = await _readNode(nodeId);
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      await _writeNode(existing);
      return nodeId;
    }
  }

  // Create new node
  nodeId = uuidv4();
  const record = {
    nodeId,
    type,
    value: normValue,
    source: source || 'unknown',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };

  const pipeline = client.pipeline();
  pipeline.set(nodeKey(nodeId), JSON.stringify(record), 'EX', NODE_TTL);
  pipeline.set(aliasK, nodeId, 'EX', NODE_TTL);
  pipeline.hincrby(STATS_KEY, 'totalNodes', 1);
  await pipeline.exec();

  logger.debug('Identity graph: node added', { nodeId, type, source });
  return nodeId;
}

/**
 * Add a bidirectional edge between two nodes.
 */
async function addEdge(nodeIdA, nodeIdB, edgeType, confidence) {
  if (!EDGE_TYPES.includes(edgeType)) throw new Error(`Unknown edgeType: ${edgeType}`);
  if (!nodeIdA || !nodeIdB) throw new Error('Both nodeIdA and nodeIdB are required');
  if (nodeIdA === nodeIdB) return; // no self-edges

  const client = getClient();
  const pipeline = client.pipeline();

  // Bidirectional adjacency sets
  pipeline.sadd(edgesKey(nodeIdA), nodeIdB);
  pipeline.expire(edgesKey(nodeIdA), NODE_TTL);
  pipeline.sadd(edgesKey(nodeIdB), nodeIdA);
  pipeline.expire(edgesKey(nodeIdB), NODE_TTL);
  pipeline.hincrby(STATS_KEY, 'totalEdges', 1);

  await pipeline.exec();
  logger.debug('Identity graph: edge added', { nodeIdA, nodeIdB, edgeType, confidence });
}

/**
 * Retrieve a node record by nodeId.
 */
async function getNode(nodeId) {
  return _readNode(nodeId);
}

/**
 * Get all neighbour NodeRecords for a given nodeId.
 */
async function getEdges(nodeId) {
  const client = getClient();
  const neighbourIds = await client.smembers(edgesKey(nodeId));
  if (!neighbourIds || neighbourIds.length === 0) return [];

  const records = await Promise.all(neighbourIds.map(_readNode));
  return records.filter(Boolean);
}

/**
 * BFS walk up to MAX_BFS_HOPS hops; returns first 'customer' type node's value.
 */
async function resolveToGolden(identifier) {
  if (!identifier) return null;
  const client = getClient();
  const norm = String(identifier).toLowerCase();

  // First check the golden cache
  const cachedGolden = await client.get(goldenKey(norm));
  if (cachedGolden) return cachedGolden;

  // Try alias → nodeId
  let startNodeId = await client.get(aliasKey(norm));
  if (!startNodeId) return null;

  // BFS
  const visited = new Set();
  const queue = [{ nodeId: startNodeId, hop: 0 }];

  while (queue.length > 0) {
    const { nodeId, hop } = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = await _readNode(nodeId);
    if (!node) continue;

    if (node.type === 'customer') {
      // Cache result
      await client.set(goldenKey(norm), node.value, 'EX', NODE_TTL);
      return node.value;
    }

    if (hop < MAX_BFS_HOPS) {
      const neighbourIds = await client.smembers(edgesKey(nodeId));
      for (const nid of neighbourIds) {
        if (!visited.has(nid)) queue.push({ nodeId: nid, hop: hop + 1 });
      }
    }
  }

  return null;
}

/**
 * Convenience: adds a node for identifier + creates an edge to the golden customer node.
 */
async function linkIdentifierToCustomer(identifier, type, customerId, confidence, source) {
  // Ensure customer node exists
  const customerNodeId = await addNode('customer', customerId, source || 'system');

  // Ensure identifier node exists
  const identifierNodeId = await addNode(type, identifier, source || 'system');

  // Update confidence on identifier node
  const node = await _readNode(identifierNodeId);
  if (node) {
    node.confidence = confidence != null ? confidence : 1.0;
    await _writeNode(node);
  }

  // Link them
  await addEdge(identifierNodeId, customerNodeId, 'SAME_AS', confidence);

  // Cache the golden resolution
  const client = getClient();
  const norm = String(identifier).toLowerCase();
  await client.set(goldenKey(norm), customerId, 'EX', NODE_TTL);

  logger.debug('Identity graph: identifier linked to customer', { identifier, type, customerId });
}

/**
 * Returns full identity cluster for a customer.
 */
async function getIdentityCluster(customerId) {
  if (!customerId) return null;

  const customerNodeId = await getClient().get(aliasKey(String(customerId).toLowerCase()));
  if (!customerNodeId) return { golden: customerId, aliases: [], devices: [], emails: [], phones: [], crmIds: [] };

  // BFS collect all connected nodes
  const visited = new Set();
  const queue = [customerNodeId];
  const allNodes = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = await _readNode(nodeId);
    if (node) allNodes.push(node);

    const neighbours = await getClient().smembers(edgesKey(nodeId));
    for (const nid of neighbours) {
      if (!visited.has(nid)) queue.push(nid);
    }
  }

  const cluster = {
    golden: customerId,
    aliases: [],
    devices: [],
    emails: [],
    phones: [],
    crmIds: [],
  };

  for (const node of allNodes) {
    if (node.type === 'customer' && node.value !== String(customerId).toLowerCase()) {
      cluster.aliases.push(node.value);
    } else if (node.type === 'device' || node.type === 'cookie') {
      cluster.devices.push(node.value);
    } else if (node.type === 'email') {
      cluster.emails.push(node.value);
    } else if (node.type === 'phone') {
      cluster.phones.push(node.value);
    } else if (node.type === 'crmId') {
      cluster.crmIds.push(node.value);
    }
  }

  return cluster;
}

/**
 * Re-points all secondary edges to primary, marks secondary as alias.
 */
async function mergeGoldenRecords(primaryCustomerId, secondaryCustomerId) {
  if (!primaryCustomerId || !secondaryCustomerId) throw new Error('Both customer IDs required');
  if (primaryCustomerId === secondaryCustomerId) throw new Error('Cannot merge with itself');

  const client = getClient();

  const primaryNodeId   = await client.get(aliasKey(String(primaryCustomerId).toLowerCase()));
  const secondaryNodeId = await client.get(aliasKey(String(secondaryCustomerId).toLowerCase()));

  if (!primaryNodeId)   throw new Error(`Primary customer node not found: ${primaryCustomerId}`);
  if (!secondaryNodeId) throw new Error(`Secondary customer node not found: ${secondaryCustomerId}`);

  // BFS all secondary nodes
  const visited = new Set();
  const queue = [secondaryNodeId];
  const secondaryNodes = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    secondaryNodes.push(nodeId);

    const neighbours = await client.smembers(edgesKey(nodeId));
    for (const nid of neighbours) {
      if (!visited.has(nid)) queue.push(nid);
    }
  }

  // Re-point all secondary edges to primary
  const pipeline = client.pipeline();
  for (const nodeId of secondaryNodes) {
    if (nodeId === secondaryNodeId) continue; // skip the secondary customer node itself
    pipeline.sadd(edgesKey(primaryNodeId), nodeId);
    pipeline.sadd(edgesKey(nodeId), primaryNodeId);
    pipeline.srem(edgesKey(nodeId), secondaryNodeId);
  }

  // Mark secondary customer node as alias type
  const secondaryNode = await _readNode(secondaryNodeId);
  if (secondaryNode) {
    secondaryNode.type = 'alias';
    secondaryNode.goldenCustomerId = primaryCustomerId;
    await _writeNode(secondaryNode);
  }

  // Point secondary alias to primary node
  pipeline.set(aliasKey(String(secondaryCustomerId).toLowerCase()), primaryNodeId, 'EX', NODE_TTL);
  pipeline.set(goldenKey(String(secondaryCustomerId).toLowerCase()), primaryCustomerId, 'EX', NODE_TTL);
  pipeline.hincrby(STATS_KEY, 'mergeCount', 1);

  await pipeline.exec();

  logger.info('Identity graph: golden records merged', { primaryCustomerId, secondaryCustomerId });
}

/**
 * Returns graph-level statistics.
 */
async function getStats() {
  const client = getClient();
  const raw = await client.hgetall(STATS_KEY);
  const stats = {
    totalNodes: parseInt((raw && raw.totalNodes) || '0', 10),
    totalEdges: parseInt((raw && raw.totalEdges) || '0', 10),
    mergeCount: parseInt((raw && raw.mergeCount) || '0', 10),
    nodesByType: {},
  };
  return stats;
}

module.exports = {
  addNode,
  addEdge,
  getNode,
  getEdges,
  resolveToGolden,
  linkIdentifierToCustomer,
  getIdentityCluster,
  mergeGoldenRecords,
  getStats,
  // Expose key helpers for testing
  _keys: { nodeKey, edgesKey, goldenKey, aliasKey, STATS_KEY },
};
