const express = require('express');
const { requirePerm } = require('../auth');
const { notFound } = require('../util');
const metrics = require('../metrics');
const reports = require('../reports');

const router = express.Router();
router.use(['/dashboard', '/reports'], requirePerm('dashboard'));

router.get('/dashboard', (req, res) => {
  res.json(Object.assign(metrics.dashboard(String(req.query.period || 'this_fy')), {
    reports: Object.entries(reports.REPORTS).map(([key, r]) => ({ key, title: r.title })),
  }));
});

router.get('/reports/:type.pdf', (req, res) => {
  if (!reports.send(res, req.params.type, String(req.query.period || 'this_fy'))) throw notFound('Unknown report');
});

module.exports = router;
