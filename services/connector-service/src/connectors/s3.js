'use strict';

const { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { createGunzip } = require('zlib');
const { parse: csvParse } = require('csv-parse');
const { Readable } = require('stream');
const BaseConnector = require('./base-connector');

/**
 * AWS S3 Batch Connector
 *
 * Polls an S3 bucket for new CSV or JSON files.
 * Parses CSV (with csv-parse) or JSON/NDJSON.
 * Supports gzip compression.
 * Moves processed files to /processed/ prefix.
 * Field mapping from connector config.
 */
class S3Connector extends BaseConnector {
  constructor(config) {
    super({
      fieldMappings: [
        { source: 'customer_id', target: 'customerId' },
        { source: 'email', target: 'email', transform: 'lowercase' },
        { source: 'phone', target: 'phone' },
        { source: 'first_name', target: 'firstName' },
        { source: 'last_name', target: 'lastName' },
        { source: 'ltv', target: 'ltv', transform: 'toNumber' }
      ],
      ...config
    });

    if (config.fieldMappings && config.fieldMappings.length > 0) {
      this.fieldMappings = config.fieldMappings;
    }

    const { bucket, prefix, region, accessKeyId, secretAccessKey, processedPrefix } = config;
    this._bucket = bucket;
    this._prefix = prefix || '';
    this._processedPrefix = processedPrefix || 'processed/';
    this._fileFormats = config.fileFormats || ['csv', 'json', 'ndjson'];

    this._s3 = new S3Client({
      region: region || process.env.AWS_REGION || 'us-east-1',
      ...(accessKeyId && secretAccessKey ? {
        credentials: { accessKeyId, secretAccessKey }
      } : {}) // Falls back to IAM role / env vars
    });
  }

  async connect() {
    this.status = 'connecting';
    try {
      // Verify bucket access
      await this._s3.send(new ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: this._prefix,
        MaxKeys: 1
      }));
      this.status = 'connected';
      this.logger.info('S3 connector connected', { bucket: this._bucket });
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  async disconnect() {
    this.status = 'disconnected';
  }

  async test() {
    const start = Date.now();
    try {
      await this.connect();
      const objects = await this._listObjects();
      return {
        success: true,
        recordCount: objects.length,
        latencyMs: Date.now() - start,
        warnings: objects.length === 0 ? ['No files found in the configured prefix'] : []
      };
    } catch (err) {
      return {
        success: false,
        recordCount: 0,
        latencyMs: Date.now() - start,
        warnings: [err.message]
      };
    }
  }

  /**
   * List new files in the S3 bucket (excluding already-processed files).
   */
  async _listObjects(lastSync = null) {
    const objects = [];
    let continuationToken = null;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: this._prefix,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {})
      });

      const result = await this._s3.send(cmd);
      const files = (result.Contents || []).filter(obj => {
        // Skip processed files and directory markers
        if (obj.Key.includes(this._processedPrefix)) return false;
        if (obj.Key.endsWith('/')) return false;

        // Filter by extension
        const ext = obj.Key.split('.').pop().replace(/\.gz$/, '').toLowerCase();
        if (!this._fileFormats.some(fmt => obj.Key.toLowerCase().endsWith(`.${fmt}`) ||
          obj.Key.toLowerCase().endsWith(`.${fmt}.gz`))) return false;

        // Filter by last modified if lastSync provided
        if (lastSync && obj.LastModified <= new Date(lastSync)) return false;

        return true;
      });

      objects.push(...files);
      continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
    } while (continuationToken);

    return objects;
  }

  /**
   * Download and parse an S3 object.
   * @returns {Promise<Array>} Array of parsed records
   */
  async _parseObject(key) {
    this.logger.info('Parsing S3 object', { key });

    const cmd = new GetObjectCommand({ Bucket: this._bucket, Key: key });
    const result = await this._s3.send(cmd);

    let stream = result.Body;

    // Handle gzip
    if (key.endsWith('.gz')) {
      const gunzip = createGunzip();
      stream = stream.pipe(gunzip);
    }

    // Collect stream to buffer
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');

    const lowerKey = key.toLowerCase().replace('.gz', '');

    // Parse based on format
    if (lowerKey.endsWith('.csv')) {
      return this._parseCsv(content);
    } else if (lowerKey.endsWith('.ndjson')) {
      return this._parseNdjson(content);
    } else if (lowerKey.endsWith('.json')) {
      return this._parseJson(content);
    } else {
      throw new Error(`Unsupported file format: ${key}`);
    }
  }

  _parseCsv(content) {
    return new Promise((resolve, reject) => {
      csvParse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true
      }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });
  }

  _parseJson(content) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  _parseNdjson(content) {
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }

  /**
   * Move a processed file to the /processed/ prefix.
   */
  async _markProcessed(key) {
    const fileName = key.split('/').pop();
    const destKey = `${this._processedPrefix}${fileName}`;

    await this._s3.send(new CopyObjectCommand({
      Bucket: this._bucket,
      CopySource: `${this._bucket}/${key}`,
      Key: destKey
    }));

    await this._s3.send(new DeleteObjectCommand({
      Bucket: this._bucket,
      Key: key
    }));

    this.logger.info('File marked as processed', { from: key, to: destKey });
  }

  async fetchBatch(lastSync) {
    const objects = await this._listObjects(lastSync);
    this.logger.info(`Found ${objects.length} new files in S3`, { bucket: this._bucket });

    const allRecords = [];
    for (const obj of objects) {
      try {
        const records = await this._parseObject(obj.Key);
        allRecords.push(...records);
        await this._markProcessed(obj.Key);
      } catch (err) {
        this.logger.error('Failed to parse S3 file', { key: obj.Key, err: err.message });
        // Continue with other files
      }
    }

    return allRecords;
  }

  async stream(onRecord) {
    const Store = require('../connector-store');
    const syncState = await Store.getSyncState(this.id);
    const objects = await this._listObjects(syncState.lastSync);

    for (const obj of objects) {
      try {
        const records = await this._parseObject(obj.Key);
        for (const record of records) {
          await onRecord(record);
        }
        await this._markProcessed(obj.Key);
      } catch (err) {
        this.logger.error('Failed to stream S3 file', { key: obj.Key, err: err.message });
      }
    }
  }
}

module.exports = S3Connector;
