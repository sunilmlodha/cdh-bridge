'use strict'
module.exports = {
  matchEngine:       require('./match-engine'),
  identityGraph:     require('./identity-graph'),
  confidenceScorer:  require('./confidence-scorer'),
  survivorshipRules: require('./survivorship-rules'),
  reviewQueue:       require('./review-queue'),
  aliasManager:      require('./alias-manager'),
  deviceLinker:      require('./device-linker'),
  anonStitcher:      require('./anonymous-stitcher'),
}
