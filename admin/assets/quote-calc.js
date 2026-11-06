/*
 * Quotation maths, shared by the server (saving) and the browser (live editor, print view).
 *
 * GST modes
 *  - composite: solar EPC contract (supply + installation in one contract). 70% of the value is
 *    treated as goods at 5% and 30% as services at 18% (≈ 8.9% effective, rates from 22 Sep 2025).
 *  - itemised:  each line carries its own GST rate (e.g. modules 5%, separately billed services 18%).
 * Intra-state supply: each rate is shown as CGST + SGST halves; inter-state as IGST.
 * The place of supply decides which: same state code as the company's GSTIN = intra-state.
 *
 * Formats
 *  - itemwise: every line printed with its own HSN/SAC, quantity, rate, taxable value and GST.
 *  - grouped:  lines rolled up under their group name (modules, inverter, balance of system,
 *              installation…) with one price per group; the components are listed under each group.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteCalc = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const GST_RATES = [0, 5, 12, 18, 28];
  const FORMATS = [['itemwise', 'Item-wise'], ['grouped', 'Grouped']];

  /** GST state codes (place of supply). */
  const STATES = [
    ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
    ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
    ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
    ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
    ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
    ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
    ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory'],
  ];
  const HOME_STATE = '33';
  const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const stateName = (code) => { const s = STATES.find((x) => x[0] === code); return s ? s[1] : ''; };
  const stateLabel = (code) => (stateName(code) ? stateName(code) + ' (' + code + ')' : '');
  /** First two digits of a valid GSTIN, else ''. */
  function gstinState(gstin) {
    const g = String(gstin || '').trim().toUpperCase();
    return GSTIN_RE.test(g) && stateName(g.slice(0, 2)) ? g.slice(0, 2) : '';
  }
  /** The company's own state: from its GSTIN, else Tamil Nadu. */
  const companyState = (cfg) => gstinState(cfg && cfg.gstin) || HOME_STATE;
  /** Inter-state when the place of supply differs from the company's state. No place set: keep the stored flag. */
  function isInterstate(q, cfg) {
    const pos = q.placeOfSupply || q.place_of_supply;
    return pos ? pos !== companyState(cfg) : !!q.interstate;
  }

  /** "Solar PV modules — Waaree 540 Wp, …" → "Solar PV modules" (for the HSN summary). */
  const shortName = (d) => String(d || '').split(/\s+—\s+|,\s*incl\.|\n/)[0].trim().slice(0, 70);

  function splitTax(tax, inter) {
    if (inter) return { cgst: 0, sgst: 0, igst: tax };
    const cgst = r2(tax / 2);
    return { cgst, sgst: r2(tax - cgst), igst: 0 };
  }

  /**
   * q: { items[{group, desc, hsn, qty, unit, rate, gst}], discount, subsidy, taxMode, interstate }
   * opts: { goodsHsn, servicesSac } — codes printed for the 70% / 30% legs of a composite contract.
   */
  function totals(q, opts) {
    opts = opts || {};
    const itemised = (q.taxMode || q.tax_mode) === 'itemised';
    const inter = !!q.interstate;
    const items = (q.items || []).map((it) => {
      const qty = Math.max(0, Number(it.qty) || 0);
      const rate = Math.max(0, Number(it.rate) || 0);
      const gst = GST_RATES.includes(Number(it.gst)) ? Number(it.gst) : 18;
      return Object.assign({}, it, { qty, rate, gst, amount: r2(qty * rate) });
    });
    const subtotal = r2(items.reduce((a, it) => a + it.amount, 0));
    const discount = r2(Math.min(Math.max(Number(q.discount) || 0, 0), subtotal));
    const taxable = r2(subtotal - discount);

    // Share the discount across lines in proportion to value; the last priced line takes the rounding.
    let last = -1;
    items.forEach((it, i) => { if (it.amount > 0) last = i; });
    let left = discount;
    items.forEach((it, i) => {
      const share = i === last ? left : (subtotal ? r2((discount * it.amount) / subtotal) : 0);
      left = r2(left - share);
      it.discount = share;
      it.taxable = r2(it.amount - share);
    });

    let taxLines = [];
    let hsn = [];
    if (itemised) {
      const byRate = {};
      const byHsn = {};
      items.forEach((it) => {
        it.tax = r2((it.taxable * it.gst) / 100);
        Object.assign(it, splitTax(it.tax, inter));
        it.total = r2(it.taxable + it.tax);
        const add = (map, key, seed) => {
          const row = map[key] || (map[key] = Object.assign({ base: 0, amount: 0, cgst: 0, sgst: 0, igst: 0 }, seed));
          row.base += it.taxable; row.amount += it.tax; row.cgst += it.cgst; row.sgst += it.sgst; row.igst += it.igst;
        };
        add(byRate, it.gst, { label: 'GST @ ' + it.gst + '%', rate: it.gst });
        add(byHsn, (it.hsn || '—') + '|' + it.gst, { hsn: it.hsn || '', desc: shortName(it.desc) || it.group, rate: it.gst });
      });
      const tidy = (row) => Object.assign(row, { base: r2(row.base), amount: r2(row.amount), cgst: r2(row.cgst), sgst: r2(row.sgst), igst: r2(row.igst) });
      taxLines = Object.keys(byRate).map(Number).sort((a, b) => a - b).map((g) => tidy(byRate[g])).filter((l) => l.rate && l.amount);
      hsn = Object.keys(byHsn).map((k) => tidy(byHsn[k])).filter((h) => h.base);
    } else {
      const goods = r2(taxable * 0.7);
      const services = r2(taxable - goods);
      const legs = [
        { label: 'GST @ 5% on 70% (supply)', rate: 5, base: goods, hsn: opts.goodsHsn || '8541 43 00', desc: 'Solar power generating system — supply (70%)' },
        { label: 'GST @ 18% on 30% (services)', rate: 18, base: services, hsn: opts.servicesSac || '995461', desc: 'Installation & commissioning services (30%)' },
      ];
      legs.forEach((l) => { l.amount = r2((l.base * l.rate) / 100); Object.assign(l, splitTax(l.amount, inter)); });
      taxLines = legs;
      hsn = legs.map((l) => ({ hsn: l.hsn, desc: l.desc, rate: l.rate, base: l.base, amount: l.amount, cgst: l.cgst, sgst: l.sgst, igst: l.igst }));
      items.forEach((it) => { it.tax = null; it.total = it.taxable; });
    }

    const sum = (k) => r2(taxLines.reduce((a, l) => a + l[k], 0));
    const gst = sum('amount');
    const exact = r2(taxable + gst);
    const total = Math.round(exact);
    const subsidy = r2(Math.max(0, Number(q.subsidy) || 0));
    return {
      items, groups: groupsOf(items), subtotal, discount, taxable, taxLines, hsn, gst,
      cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), interstate: inter, itemised,
      effectiveRate: taxable ? r2((gst / taxable) * 100) : 0,
      roundOff: r2(total - exact), total, subsidy, effective: Math.max(0, total - subsidy),
    };
  }

  /** Lines rolled up by group name, in order of first appearance. A line without a group stands alone. */
  function groupsOf(items) {
    const out = [];
    const map = {};
    items.forEach((it, i) => {
      const name = String(it.group || '').trim();
      const key = name ? 'g:' + name.toLowerCase() : 'i:' + i;
      let g = map[key];
      if (!g) {
        g = map[key] = { name: name || it.desc, single: !name, items: [], amount: 0, discount: 0, taxable: 0, tax: 0, total: 0, rates: [], hsn: [] };
        out.push(g);
      }
      g.items.push(it);
      g.amount += it.amount; g.discount += it.discount || 0; g.taxable += it.taxable;
      g.tax += it.tax || 0; g.total += it.total;
      if (!g.rates.includes(it.gst)) g.rates.push(it.gst);
      if (it.hsn && !g.hsn.includes(it.hsn)) g.hsn.push(it.hsn);
    });
    out.forEach((g) => { ['amount', 'discount', 'taxable', 'tax', 'total'].forEach((k) => { g[k] = r2(g[k]); }); g.rates.sort((a, b) => a - b); });
    return out;
  }

  /** Split a tax line for display: CGST + SGST (same state) or IGST (other state). */
  function split(line, interstate) {
    if (interstate) return [{ label: line.label.replace('GST', 'IGST'), amount: line.amount }];
    const half = line.cgst != null ? line.cgst : r2(line.amount / 2);
    const rate = line.rate / 2;
    const rest = line.label.replace(/^GST @ [\d.]+%/, '').trim();
    return [
      { label: ('CGST @ ' + rate + '% ' + rest).trim(), amount: half },
      { label: ('SGST @ ' + rate + '% ' + rest).trim(), amount: line.sgst != null ? line.sgst : r2(line.amount - half) },
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
  /** 310000 → "Rupees Three Lakh Ten Thousand Only"; 1234.5 → "… and Fifty Paise Only" */
  function words(amount, paise) {
    const v = Math.abs(Number(amount) || 0);
    const n = paise ? Math.floor(v) : Math.round(v);
    const p = paise ? Math.round((v - n) * 100) : 0;
    return 'Rupees ' + (n ? indian(n) : 'Zero') + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
  }

  /** ₹ with Indian digit grouping. */
  function inr(n, decimals) {
    const v = Number(n) || 0;
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 });
  }

  return {
    totals, groupsOf, split, subsidyFor, words, inr, GST_RATES, FORMATS, STATES, HOME_STATE, GSTIN_RE,
    stateName, stateLabel, gstinState, companyState, isInterstate,
  };
}));
