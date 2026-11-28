const crypto = require('node:crypto');

function equalSecret(actual, expected) {
  const actualHash = crypto.createHash('sha256').update(actual).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

module.exports = function adminAuth(req, res, next) {
  if (!['localhost', '127.0.0.1'].includes(req.hostname)) return res.sendStatus(403);
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    return res.status(503).send('Panel de administración no configurado.');
  }

  res.set('Cache-Control', 'no-store');
  const header = req.get('authorization') || '';
  const match = header.match(/^Basic\s+(.+)$/i);
  if (match) {
    let credentials = '';
    try { credentials = Buffer.from(match[1], 'base64').toString('utf8'); } catch {}
    const separator = credentials.indexOf(':');
    const suppliedUser = separator < 0 ? '' : credentials.slice(0, separator);
    const suppliedPassword = separator < 0 ? '' : credentials.slice(separator + 1);
    if (equalSecret(suppliedUser, username) && equalSecret(suppliedPassword, password)) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="UPerfumes inventario", charset="UTF-8"');
  return res.status(401).send('Autenticación requerida.');
};
