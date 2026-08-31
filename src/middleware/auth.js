const { safeCompare } = require('../utils/token');
const logger = require('../utils/logger');

/**
 * Role definitions:
 *   operator  – EGM / table integrations: issue, void, extend, batch
 *   cage      – Cage / kiosk readers: validate, redeem
 *   admin     – Full access including reports and audit trails
 *
 * Env vars (comma-separated lists of API keys):
 *   OPERATOR_KEYS  – operator role
 *   CAGE_KEYS      – cage role
 *   ADMIN_KEYS     – admin role
 *   API_KEYS       – backward-compat: treated as admin (full access)
 *
 * A key found in multiple env vars is assigned the highest role (admin > operator/cage).
 */

function _keys(envVar) {
  return (process.env[envVar] || '').split(',').map(k => k.trim()).filter(Boolean);
}

function resolveRole(provided) {
  if (_keys('ADMIN_KEYS').some(k => safeCompare(provided, k))) return 'admin';
  if (_keys('API_KEYS').some(k => safeCompare(provided, k)))   return 'admin';
  if (_keys('OPERATOR_KEYS').some(k => safeCompare(provided, k))) return 'operator';
  if (_keys('CAGE_KEYS').some(k => safeCompare(provided, k)))     return 'cage';
  return null;
}

function _anyKeyConfigured() {
  return (
    _keys('API_KEYS').length > 0 ||
    _keys('ADMIN_KEYS').length > 0 ||
    _keys('OPERATOR_KEYS').length > 0 ||
    _keys('CAGE_KEYS').length > 0
  );
}

/**
 * Authenticate the request and attach req.apiKeyRole.
 */
function requireApiKey(req, res, next) {
  const provided = req.headers['x-api-key'] || req.query.api_key;

  if (!provided) {
    logger.warn('Rejected unauthenticated request', { path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'Missing API key. Provide X-API-Key header.' });
  }

  if (!_anyKeyConfigured()) {
    logger.error('No API keys configured — all requests will be rejected');
    return res.status(500).json({ error: 'Server misconfiguration: no API keys set.' });
  }

  const role = resolveRole(provided);

  if (!role) {
    logger.warn('Rejected invalid API key', { path: req.path, ip: req.ip });
    return res.status(403).json({ error: 'Invalid API key.' });
  }

  req.apiKeyRole = role;
  next();
}

/**
 * Restrict an endpoint to specific roles.
 * Usage: router.post('/sensitive', requireRole('admin', 'operator'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.apiKeyRole)) {
      logger.warn('Forbidden: insufficient role', {
        path:     req.path,
        required: roles,
        actual:   req.apiKeyRole,
        ip:       req.ip,
      });
      return res.status(403).json({
        error: `Forbidden. This operation requires one of: ${roles.join(', ')}.`,
      });
    }
    next();
  };
}

module.exports = { requireApiKey, requireRole };
