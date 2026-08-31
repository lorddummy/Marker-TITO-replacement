const express = require('express');
const { requireRole } = require('../middleware/auth');
const { issueTicket } = require('../services/issue');
const { redeemTicket } = require('../services/redeem');

const router = express.Router();

router.post('/slot/cash-out', requireRole('operator', 'admin'), (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotency_key;
    const result = issueTicket({
      ...req.body,
      player_id: req.body.player_id || req.body.card_id,
      idempotencyKey,
    });
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return res.status(result.replayed ? 200 : 201).json({
      ...result,
      connector: 'slot',
      event: 'cash_out',
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/slot/ticket-in', requireRole('operator', 'cage', 'admin'), (req, res) => {
  try {
    const result = redeemTicket({
      ...req.body,
      redemption_point_id: req.body.redemption_point_id || req.body.machine_id || 'EGM-IN',
    });
    if (!result.success) {
      return res.status(result.httpStatus || 409).json(result);
    }
    return res.status(200).json({ ...result, connector: 'slot', event: 'ticket_in' });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
