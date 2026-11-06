/*
 * Quotation maths, shared by the server (saving) and the browser (live editor, print view).
 *
 * GST modes
 *  - composite: solar EPC contract (supply + installation in one contract). 70% of the value is
 *    treated as goods at 5% and 30% as services at 18% (≈ 8.9% effective, rates from 22 Sep 2025).
 *  - itemised:  each line carries its own GST rate (e.g. modules 5%, separately billed services 18%).
 * Intra-state (Tamil Nadu customer): each rate is shown as CGST + SGST halves; inter-state as IGST.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteCalc = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const GST_RATES = [0, 5, 12, 18, 28];

  function totals(q) {
    const items = (q.items || []).map((it) => {
      const qty = Math.max(0, Number(it.qty) || 0);
      const rate = Math.max(0, Number(it.rate) || 0);
      return Object.assign({}, it, { amount: r2(qty * rate) });
    });
    const subtotal = r2(items.reduce((a, it) => a + it.amount, 0));
    const discount = r2(Math.min(Math.max(Number(q.discount) || 0, 0), subtotal));
    const taxable = r2(subtotal - discount);
    const taxLines = [];
    if ((q.taxMode || q.tax_mode) === 'itemised') {
      const byRate = {};
      items.forEach((it) => {
        const share = subtotal ? it.amount - (discount * it.amount) / subtotal : 0;
        const g = GST_RATES.includes(Number(it.gst)) ? Number(it.gst) : 18;
        byRate[g] = (byRate[g] || 0) + share;
      });
      Object.keys(byRate).map(Number).sort((a, b) => a - b).forEach((g) => {
        if (!byRate[g] || !g) return;
        taxLines.push({ label: 'GST @ ' + g + '%', rate: g, base: r2(byRate[g]), amount: r2((byRate[g] * g) / 100) });
      });
    } else {
      const goods = r2(taxable * 0.7);
      const services = r2(taxable - goods);
      taxLines.push({ label: 'GST @ 5% on 70% (supply)', rate: 5, base: goods, amount: r2(goods * 0.05) });
      taxLines.push({ label: 'GST @ 18% on 30% (services)', rate: 18, base: services, amount: r2(services * 0.18) });
    }
    const gst = r2(taxLines.reduce((a, l) => a + l.amount, 0));
    const exact = r2(taxable + gst);
    const total = Math.round(exact);
    const subsidy = r2(Math.max(0, Number(q.subsidy) || 0));
    return { items, subtotal, discount, taxable, taxLines, gst, roundOff: r2(total - exact), total, subsidy, effective: Math.max(0, total - subsidy) };
  }

  /** Split a tax line for display: CGST + SGST (same state) or IGST (other state). */
  function split(line, interstate) {
    if (interstate) return [{ label: line.label.replace('GST', 'IGST'), amount: line.amount }];
    const half = r2(line.amount / 2);
    const rate = line.rate / 2;
    const rest = line.label.replace(/^GST @ [\d.]+%/, '').trim();
    return [
      { label: 'CGST @ ' + rate + '% ' + rest, amount: half },
      { label: 'SGST @ ' + rate + '% ' + rest, amount: r2(line.amount - half) },
    ];
  }

  /** PM Surya Ghar central subsidy for homes: ₹30,000/kW up to 2 kW, ₹18,000 for the 3rd kW, max ₹78,000. */
  function subsidyFor(kwp) {
    const k = Number(kwp) || 0;
    if (k <= 0) return 0;
    return Math.round(k <= 2 ? 30000 * k : 60000 + 18000 * Math.min(1, k - 2));
  }

  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
    'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
  const three = (n) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? ONES[h] + ' Hundred' : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  function indian(n) {
    if (n === 0) return '';
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const rest = n % 1000;
    return [crore ? indian(crore) + ' Crore' : '', lakh ? two(lakh) + ' Lakh' : '', thousand ? two(thousand) + ' Thousand' : '', rest ? three(rest) : '']
      .filter(Boolean).join(' ');
  }
  /** 310000 → "Rupees Three Lakh Ten Thousand Only" */
  function words(amount) {
    const n = Math.round(Math.abs(Number(amount) || 0));
    return 'Rupees ' + (n ? indian(n) : 'Zero') + ' Only';
  }

  /** ₹ with Indian digit grouping. */
  function inr(n, decimals) {
    const v = Number(n) || 0;
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 });
  }

  return { totals, split, subsidyFor, words, inr, GST_RATES };
}));
