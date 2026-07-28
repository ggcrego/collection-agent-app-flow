window.LMS = window.LMS || {};

/* ============================================================
   Loan activity — v2 proposal
   ------------------------------------------------------------
   Same opening → movement → closing spine as v1, plus the five
   things a finance manager needs that v1 does not carry:

     1. Classification rail — a continuous stripe down the left
        edge coloured by asset category at that point in time.
        Hairline-neutral while the loan is standard, loud only
        when it degrades. Backend source: TransactionSummary
        .asset_category / .due_details.current_dpd, which exist
        per transaction and are currently unused by any view.

     2. Visible reconciliation. v1 checks row balance, continuity
        and totals, then console.warn()s the result. Here the
        check is a seal in the header and a marker on the row
        that breaks — because a running-balance ledger's only
        claim to authority is that it ties out.

     3. Machine rows folded. Daily accrual buries the events that
        matter (53 accrual rows vs 6 events on this loan). Runs of
        consecutive system rows collapse into one expandable band.
        The taxonomy is TxnCode: accrual / month_end_tl_accrual /
        due_date_tl_accrual are machine; disbursement / repayment /
        waiver / fee_charge are events.

     4. Net Δ, so nobody has to subtract closing from opening.

     5. Postings pinned, not hovered. Chips still peek on hover;
        clicking the row expands the full posting set inline so it
        can be compared, keyboard-reached and screenshotted.

   Plus: reversals rendered as contras, value date vs booking date
   split, and the note (v1 authors it, then hides it in a title=).

   Balances are simulated forward from zero rather than authored,
   so the table reconciles by construction.

   ------------------------------------------------------------
   FIELD PROVENANCE — every string on a row is a concatenation of
   existing model fields. Nothing here needs a sentence written
   for it; a serialiser with an f-string produces all of it.

     Activity title   TxnCode → label dict. Note that fee_charge
                      covers service fee, penal and bounce, so the
                      label resolves off the Ledger *component*,
                      not the code alone.
     Reference        Transaction.reference, or Payment.payment_utr
                      / Payout UTR when the row has one.
     Note             component + amount pairs read straight off
                      Ledger rows, e.g. "service_fee ₹2,000 · tax
                      ₹360" is two ledger lines (posting_type
                      outstanding + tax). Payment rows use mode +
                      masked bank account. Accruals use the loan's
                      rate + opening principal.
     Reversal         Transaction.is_reversal, and the contra
                      points at original_transaction.reference.
     Booked / value   Transaction.txn_date vs .value_date; the
                      "restated" count is rows where they differ.
     Opening/closing  consecutive TransactionSummary
                      .outstanding_details.total.
     Movement chips   TransactionSummary deltas, bucketed by
                      component category.
     Rail + DPD       TransactionSummary.asset_category and
                      .due_details.current_dpd, already stored per
                      transaction and unused by any current view.

   Deliberately absent: any clause explaining WHY something
   happened ("charged in error", "goodwill", "first bounce in 12
   months"). Transaction.reason is the field for that, and it is
   user-entered — surface it only once someone is actually typing
   into it, never as generated prose.
   ============================================================ */
(function () {

  /* ---------- movement vocabulary: order = chip order ---------- */
  const CATS = [
    { key: "disbursed", label: "Disbursed", bal: true },
    { key: "interest",  label: "Interest",  bal: true },
    { key: "fees",      label: "Fees",      bal: true },
    { key: "penal",     label: "Penal",     bal: true },
    { key: "cashback",  label: "Cashback",  bal: true },
    { key: "paid",      label: "Paid",      bal: true },
    { key: "waived",    label: "Waived",    bal: true },
    { key: "upfront",   label: "Upfront earned", bal: false, memo: true,
      hint: "Memo — prepaid interest moving hold → earned. Recognises income; does not change what is outstanding." },
  ];
  const BAL = CATS.filter(c => c.bal);

  /* ---------- asset classification bands (RBI) ---------- */
  const band = dpd => dpd <= 0 ? "std" : dpd <= 30 ? "sma0" : dpd <= 60 ? "sma1" : dpd <= 90 ? "sma2" : "npa";
  const BAND_LABEL = { std: "STD", sma0: "SMA-0", sma1: "SMA-1", sma2: "SMA-2", npa: "NPA" };

  /* ---------- formatting ---------- */
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAY = 864e5;
  const D = s => { const [y,m,d] = s.split("-").map(Number); return Date.UTC(y, m-1, d); };
  const dt = t => new Date(t);
  const fmt = t => String(dt(t).getUTCDate()).padStart(2,"0") + " " + MON[dt(t).getUTCMonth()] + " " + String(dt(t).getUTCFullYear()).slice(2);
  const fmtShort = t => String(dt(t).getUTCDate()).padStart(2,"0") + " " + MON[dt(t).getUTCMonth()];

  function grp(n) {                                     // Indian digit grouping
    const s = String(Math.abs(Math.round(n)));
    if (s.length <= 3) return s;
    return s.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3);
  }
  const money  = n => "₹" + grp(n);
  const signed = n => (n >= 0 ? "+" : "−") + grp(n);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

  /* ---------- ledger posting buckets, for the auto-derived detail ----------
     The fee component is named per product: an SCF loan charges a service fee,
     a term loan bounces a NACH. Same bucket, different Component row. */
  const buckets = fee => [
    ["principal · outstanding",   "prin",  "blue"],
    ["interest · outstanding",    "int",   "blue"],
    [fee + " · outstanding",      "fee",   "amber"],
    ["penal_charge · outstanding","penal", "amber"],
    ["principal · paid",          "pPrin", "green"],
    ["interest · paid",           "pInt",  "green"],
    [fee + " · paid",             "pFee",  "green"],
    [fee + " · waived",           "wFee",  "violet"],
    ["penal_charge · waived",     "wPenal","violet"],
    ["upfront_interest · hold",   "hold",  "teal"],
    ["upfront_interest · accrued","earned","teal"],
  ];
  const postings = (a, b, fee) => buckets(fee || "service_fee")
    .filter(([, k]) => (a[k] || 0) !== (b[k] || 0))
    .map(([lbl, k, tone]) => [lbl, grp(a[k] || 0), signed((b[k] || 0) - (a[k] || 0)), grp(b[k] || 0), tone]);

  const outstanding = s => s.prin + s.int + s.fee + s.penal;

  /* ============================================================
     SCF loan — simulated forward, so it reconciles by construction
     ============================================================ */
  function scfRows() {
    const START = D("2026-06-02"), ASOF = D("2026-07-25");
    const RATE = 0.135, UPFRONT = 75507, UPFRONT_DAYS = 90;
    const upDaily = Math.round(UPFRONT / UPFRONT_DAYS);

    const s = { prin:0, int:0, fee:0, penal:0, pPrin:0, pInt:0, pFee:0, wFee:0, wPenal:0, hold:0, earned:0 };
    let dueSince = null, dueAmt = 0;
    const rows = [];

    /* money-movement events, keyed by value date */
    const EV = {
      "2026-06-02": [{
        code: "disbursement", activity: "Disbursed",
        note: "gross ₹34,00,000 · net ₹33,10,000 · HDFC ••4410",
        ref: "PYTUTR861204", refKind: "Payout UTR",
        run() { s.prin += 3400000; s.hold += UPFRONT; return { disbursed: 3400000, upfront: UPFRONT }; }
      }],
      "2026-06-10": [{
        code: "fee_charge", activity: "Service fee charged",
        note: "service_fee ₹2,000 · tax ₹360",
        ref: "TXN-FEE-69881", refKind: "Transaction",
        run() { s.fee += 2360; return { fees: 2360 }; }
      }],
      "2026-06-20": [{
        code: "upfront_interest_settle", activity: "Cashback received",
        note: "source DMD-UI-4471 · LN-2401-0114",
        ref: "TXN-UIS-88213", refKind: "Transaction",
        run() { const applied = settle(28450); return { cashback: -applied }; }
      }],
      "2026-07-08": [{
        code: "schedule", activity: "Instalment fell due", schedule: true,
        note: "principal ₹3,80,000",
        ref: "DMD-SCF-5512", refKind: "Demand",
        run() { dueSince = D("2026-07-08"); dueAmt = 380000; return {}; }
      }],
      "2026-07-12": [{
        code: "fee_charge", activity: "Penal charge", note: "penal_charge ₹1,850",
        ref: "TXN-PEN-70118", refKind: "Transaction", reversed: true,
        run() { s.penal += 1850; return { penal: 1850 }; }
      }, {
        code: "fee_charge", activity: "Penal charge reversed", contra: "TXN-PEN-70118", booked: D("2026-07-16"),
        ref: "TXN-PEN-70118-R", refKind: "Transaction",
        run() { s.penal -= 1850; return { penal: -1850 }; }
      }],
      "2026-07-14": [{
        code: "repayment", activity: "Repayment received",
        note: "NEFT · HDFC ••4410",
        ref: "UTR512044987N", refKind: "Payment UTR",
        run() { const applied = settle(380000); dueSince = null; dueAmt = 0; return { paid: -applied }; }
      }],
    };

    /* waterfall: fee → penal → interest → principal */
    function settle(amount) {
      let left = amount;
      const take = (k, paidKey) => {
        const t = Math.min(left, s[k]);
        s[k] -= t; if (paidKey) s[paidKey] += t; left -= t;
      };
      take("fee", "pFee"); take("penal", null); take("int", "pInt"); take("prin", "pPrin");
      return amount - left;
    }

    for (let t = START; t <= ASOF; t += DAY) {
      const key = new Date(t).toISOString().slice(0, 10);
      const dpd = dueSince ? Math.round((t - dueSince) / DAY) : 0;

      /* accrual runs start-of-day, from the day after disbursement */
      if (t > START) {
        const before = { ...s };
        const acc = Math.round(s.prin * RATE / 365);
        s.int += acc;
        const earn = Math.min(s.hold, upDaily);
        s.hold -= earn; s.earned += earn;
        rows.push({
          t, machine: true, code: "accrual", activity: "Interest accrued",
          note: "13.50% p.a. · on principal ₹" + grp(before.prin),
          impacts: { interest: acc, upfront: earn },
          opening: outstanding(before), closing: outstanding(s),
          dpd, post: postings(before, s),
        });
      }

      (EV[key] || []).forEach(e => {
        const before = { ...s };
        const dpdBefore = dueSince ? Math.round((t - dueSince) / DAY) : 0;
        const impacts = e.run();
        const cured = dpdBefore > 0 && !dueSince ? dpdBefore : 0;
        rows.push({
          t, machine: false, code: e.code, activity: e.activity, note: e.note,
          ref: e.ref, refKind: e.refKind, contra: e.contra, reversed: e.reversed, booked: e.booked,
          schedule: e.schedule, impacts, cured,
          opening: outstanding(before), closing: outstanding(s),
          dpd: dueSince ? Math.round((t - dueSince) / DAY) : 0,
          post: postings(before, s),
        });
      });
    }

    return { rows, asOf: ASOF, dpd: 0, netDue: 0 };
  }

  /* ============================================================
     Term loan — authored, because the reader's unit is the
     instalment, not the day. Balances still walked forward.
     ============================================================ */
  function termRows() {
    const SPEC = [
      { date:"2026-04-30", code:"accrual",    emi:12, dpd:0, activity:"Interest accrued", note:"11.75% p.a.", impacts:{ interest:20140 } },
      { date:"2026-05-05", code:"schedule",   emi:12, dpd:0, activity:"EMI fell due", note:"principal ₹92,360 · interest ₹20,140", impacts:{} },
      { date:"2026-05-05", code:"repayment",  emi:12, dpd:0, activity:"EMI repaid", note:"NACH · HDFC ••4410", impacts:{ paid:-112500 }, ref:"UTR481120944N", refKind:"Payment UTR" },
      { date:"2026-05-31", code:"accrual",    emi:13, dpd:0, activity:"Interest accrued", note:"11.75% p.a.", impacts:{ interest:19780 } },
      { date:"2026-06-05", code:"schedule",   emi:13, dpd:0, activity:"EMI fell due", note:"principal ₹92,720 · interest ₹19,780", impacts:{} },
      { date:"2026-06-05", code:"fee_charge", emi:13, dpd:0, activity:"NACH returned", note:"bounce_fee ₹2,280", impacts:{ fees:2280 }, ref:"TXN-BNC-66201", refKind:"Transaction" },
      { date:"2026-06-09", code:"fee_charge", emi:13, dpd:4, activity:"Penal charge", note:"penal_charge ₹1,140", impacts:{ penal:1140 } },
      { date:"2026-06-10", code:"waiver",     emi:13, dpd:5, activity:"Penal charge waived", note:"penal_charge ₹1,140", impacts:{ waived:-1140 } },
      { date:"2026-06-11", code:"repayment",  emi:13, dpd:0, cured:6, activity:"EMI repaid", note:"IMPS · HDFC ••4410", impacts:{ paid:-114780 }, ref:"UTR489330271N", refKind:"Payment UTR" },
      { date:"2026-06-30", code:"accrual",    emi:14, dpd:0, activity:"Interest accrued", note:"11.75% p.a.", impacts:{ interest:19450 } },
      { date:"2026-07-05", code:"schedule",   emi:14, dpd:0, activity:"EMI fell due", note:"principal ₹93,050 · interest ₹19,450", impacts:{} },
      { date:"2026-07-08", code:"fee_charge", emi:14, dpd:3, activity:"NACH returned", note:"bounce_fee ₹2,280", impacts:{ fees:2280 }, ref:"TXN-BNC-71944", refKind:"Transaction" },
      { date:"2026-07-08", code:"fee_charge", emi:14, dpd:3, activity:"Penal charge", note:"penal_charge ₹6,400", impacts:{ penal:6400 } },
      /* approved on 20 Jul but value-dated back to the charge date — the
         restatement case: history shown here is not what it was last week */
      { date:"2026-07-08", code:"waiver",     emi:14, dpd:3, activity:"Bounce fee waived", note:"bounce_fee ₹2,280", impacts:{ waived:-2280 }, waiveFrom:"fee", booked:D("2026-07-20") },
    ];

    const s = { prin: 2078270, int: 0, fee: 0, penal: 0, pPrin: 0, pInt: 0, pFee: 0, wFee: 0, wPenal: 0, hold: 0, earned: 0 };
    const rows = SPEC.map(spec => {
      const { date, code, activity, note, emi, dpd, impacts, ref, refKind, booked, cured } = spec;
      const before = { ...s };
      /* apply the impacts against real buckets so the posting card is derived, not authored */
      if (impacts.interest) s.int += impacts.interest;
      if (impacts.fees)     s.fee += impacts.fees;
      if (impacts.penal)    s.penal += impacts.penal;
      /* a waiver names the component it forgives — a bounce-fee waiver must not
         quietly eat the penal charge just because penal is settled first */
      if (impacts.waived) {
        const w = -impacts.waived;
        if (spec.waiveFrom === "fee") { s.fee -= w; s.wFee += w; }
        else { s.penal -= w; s.wPenal += w; }
      }
      if (impacts.paid) {
        let left = -impacts.paid;
        const take = (k, pk) => { const t = Math.min(left, s[k]); s[k] -= t; if (pk) s[pk] += t; left -= t; };
        take("fee", "pFee"); take("penal", null); take("int", "pInt"); take("prin", "pPrin");
      }
      return {
        t: D(date), machine: code === "accrual", code, activity, note, emi, dpd, impacts,
        ref, refKind, booked, cured, schedule: code === "schedule",
        opening: outstanding(before), closing: outstanding(s), post: postings(before, s, "bounce_fee"),
      };
    });
    return { rows, asOf: D("2026-07-27"), dpd: 22, netDue: 118900 };
  }

  /* ============================================================
     Folding: machine rows between two events collapse into a band
     ============================================================ */
  function fold(rows) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length === 1) { out.push(run[0]); run = []; return; }
      const impacts = {};
      run.forEach(r => CATS.forEach(c => { if (r.impacts[c.key]) impacts[c.key] = (impacts[c.key] || 0) + r.impacts[c.key]; }));
      out.push({
        t: run[run.length - 1].t, fold: true, machine: true, code: run[0].code,
        activity: run[0].activity, days: run.length,
        from: run[0].t, to: run[run.length - 1].t,
        impacts, opening: run[0].opening, closing: run[run.length - 1].closing,
        dpd: run[run.length - 1].dpd, dpdFrom: run[0].dpd, emi: run[run.length - 1].emi,
        children: run.slice().reverse(),
      });
      run = [];
    };
    rows.forEach(r => { if (r.machine) run.push(r); else { flush(); out.push(r); } });
    flush();
    return out;
  }

  /* ============================================================
     Rendering
     ============================================================ */
  function resolve(ref) {
    if (!ref) return null;
    const RES = window.LMS.RES || {}, ALIAS = window.LMS.ALIAS || {};
    return RES[ref] ? ref : (ALIAS[ref] || null);
  }

  function ptab(post) {
    if (!post || !post.length) return "";
    let h = '<table class="ptab"><tr><th>component · bucket</th><th>was</th><th>Δ</th><th>now</th></tr>';
    post.forEach(([lbl, was, d, now, tone]) => {
      h += "<tr><td>" + esc(lbl) + "</td><td>" + was + '</td><td class="d" style="color:var(--' + tone + ')">'
        + d + "</td><td>" + now + "</td></tr>";
    });
    return h + "</table>";
  }

  function chips(r) {
    const list = CATS.filter(c => r.impacts[c.key]).map(c => {
      const v = r.impacts[c.key];
      return '<span class="a2-chip' + (c.memo ? " memo" : "") + '"'
        + (c.hint ? ' title="' + esc(c.hint) + '"' : "")
        + '><span class="k">' + esc(c.label) + '</span>'
        + '<span class="v ' + (v > 0 ? "pos" : "neg") + '">' + signed(v) + "</span></span>";
    });
    return list.length ? list.join("") : '<span class="a2-dash">no balance movement</span>';
  }

  const net = r => BAL.reduce((sum, c) => sum + (r.impacts[c.key] || 0), 0);

  /* "21 Jun – 08 Jul 26", but "15 – 25 Jul 26" when the run sits in one month */
  function range(a, b) {
    return dt(a).getUTCMonth() === dt(b).getUTCMonth()
      ? String(dt(a).getUTCDate()).padStart(2, "0") + " – " + fmt(b)
      : fmtShort(a) + " – " + fmt(b);
  }

  function cells(r, opts, isChild, risk) {
    const b = band(r.dpd || 0);
    const dateLabel = r.fold ? range(r.from, r.to) : fmt(r.t);
    const n = net(r);
    const expandable = r.fold || (r.post && r.post.length && !isChild);

    /* The ref chip and the booked flag never shrink; everything else is one
       shrinkable run of prose. Separate flex items each carrying their own
       separator leave a trail of stranded dots once the notes truncate away. */
    let meta = "";
    if (r.ref) {
      const target = resolve(r.ref);
      meta += '<span class="a2-ref' + (target ? " link" : "") + '"'
        + (target ? ' data-res="' + esc(target) + '"' : "")
        + ' title="' + esc(r.refKind || "Reference") + '">' + esc(r.ref) + "</span>";
    }
    const prose = [r.note, r.contra ? "reverses " + r.contra : null].filter(Boolean).join(" · ");
    if (prose) meta += '<span class="a2-note">' + (r.ref ? "· " : "") + esc(prose) + "</span>";
    if (r.booked) meta += '<span class="a2-flag back">booked ' + fmt(r.booked) + "</span>";

    let h = '<td class="a2-rail"><i class="' + b + '"></i></td>'
      + '<td class="a2-date">' + esc(dateLabel) + "</td>";

    if (opts.emi) h += '<td class="a2-emi">' + (r.emi ? "#" + r.emi : '<span class="a2-dash">—</span>') + "</td>";

    h += '<td class="a2-act">'
      + '<div class="a2-t">'
      + '<span class="a2-x' + (expandable ? "" : " off") + '"></span>'
      + '<span class="a2-title" title="' + esc(r.activity) + '">' + esc(r.activity) + "</span>"
      + (r.fold ? ' <span class="a2-cnt">' + r.days + " days folded</span>" : "")
      + (r.reversed ? ' <span class="a2-flag rev">reversed</span>' : "")
      + (r.contra ? ' <span class="a2-flag con">contra</span>' : "")
      + (r.schedule ? ' <span class="a2-flag sch">schedule</span>' : "")
      + (risk ? ' <span class="a2-flag risk ' + b + '">' + risk + "</span>" : "")
      + "</div>"
      + (meta ? '<div class="a2-m" title="' + esc([r.ref, prose].filter(Boolean).join(" · ")) + '">'
          + meta + "</div>" : "")
      + "</td>"
      + '<td class="a2-bal open">' + money(r.opening) + "</td>"
      + '<td class="a2-mv"><div class="a2-chips">' + chips(r) + "</div></td>"
      + '<td class="a2-net ' + (n > 0 ? "pos" : n < 0 ? "neg" : "zero") + '">' + (n ? signed(n) : "—") + "</td>"
      + '<td class="a2-bal close">' + money(r.closing) + "</td>";
    return h;
  }

  function render(mountId, model, opts) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    opts = opts || {};
    const chrono = model.rows;
    const folded = fold(chrono);

    /* Episode labels are chronological — "cured" means the arrear ended, which
       only makes sense walking forward. Computing them in display order (which
       runs newest-first) puts "cured" on the row that STARTED the arrear. */
    let walkB = null;
    folded.forEach(r => {
      const b = band(r.dpd || 0);
      if (r.cured) r.risk = "STD · cured from DPD " + r.cured;
      /* an entry marker reports the DPD it entered at, not where the run ended */
      else if (b !== walkB && b !== "std") r.risk = BAND_LABEL[b] + " · DPD " + (r.dpdFrom != null ? r.dpdFrom : r.dpd);
      else if (b !== walkB && walkB && walkB !== "std") r.risk = "STD · cured";
      walkB = b;
    });
    folded.reverse();

    /* ---- reconciliation, checked and then actually shown ---- */
    let broken = 0;
    chrono.forEach(r => { if (r.opening + net(r) !== r.closing) { r.badRow = true; broken++; } });
    for (let i = 1; i < chrono.length; i++) if (chrono[i].opening !== chrono[i-1].closing) { chrono[i].badLink = true; broken++; }
    const first = chrono[0], last = chrono[chrono.length - 1];
    const totals = {};
    CATS.forEach(c => { totals[c.key] = chrono.reduce((s, r) => s + (r.impacts[c.key] || 0), 0); });
    const tiesOut = first.opening + BAL.reduce((s, c) => s + totals[c.key], 0) === last.closing;

    /* ---- risk summary from the rail ---- */
    const days = {};
    chrono.forEach(r => { const b = band(r.dpd || 0); days[b] = (days[b] || 0) + 1; });
    const peak = chrono.reduce((m, r) => Math.max(m, r.dpd || 0), model.dpd || 0);
    const restated = chrono.filter(r => r.booked).length;
    const foldedCount = folded.filter(r => r.fold).reduce((s, r) => s + r.days, 0);

    /* ---- table ---- */
    let h = '<div class="a2-wrap"><table class="a2"><colgroup>'
      + '<col class="w-rail"><col class="w-date">' + (opts.emi ? '<col class="w-emi">' : "")
      + '<col><col class="w-bal"><col class="w-mv"><col class="w-net"><col class="w-bal">'
      + "</colgroup><thead><tr>"
      + '<th class="a2-rail"></th><th class="l">Value date</th>'
      + (opts.emi ? '<th class="l">EMI</th>' : "")
      + '<th class="l">Activity</th><th>Opening O/S</th>'
      + '<th class="l a2-mvh">Movement <span class="op">＋ increases · − reduces outstanding</span></th>'
      + "<th>Net Δ</th><th>＝ Closing O/S</th></tr></thead><tbody>";

    folded.forEach((r, i) => {
      const b = band(r.dpd || 0);
      const flag = (r.badRow || r.badLink) ? " broken" : "";
      h += '<tr class="a2-row ' + b + flag + (r.fold ? " isfold" : "") + '" data-i="' + i + '">' + cells(r, opts, false, r.risk) + "</tr>";
      if (r.badLink) h += '<tr class="a2-break"><td></td><td colspan="' + (opts.emi ? 7 : 6) + '">'
        + "Opening does not match the previous closing — this row was inserted or restated after the balance was computed.</td></tr>";
      if (r.fold) {
        r.children.forEach(c => {
          h += '<tr class="a2-row child ' + band(c.dpd || 0) + '" data-parent="' + i + '" hidden>' + cells(c, opts, true) + "</tr>";
        });
      } else if (r.post && r.post.length) {
        h += '<tr class="a2-detail" data-detail="' + i + '" hidden><td class="a2-rail"><i class="' + b + '"></i></td>'
          + '<td colspan="' + (opts.emi ? 6 : 5) + '"><div class="a2-pin">'
          + '<div class="a2-pin-t">Ledger postings · what actually moved in the books</div>'
          + ptab(r.post) + "</div></td><td></td></tr>";
      }
    });
    h += "</tbody>";

    /* ---- totals, labelled by the range they actually cover ---- */
    const totalChips = CATS.filter(c => totals[c.key]).map(c =>
      '<span class="a2-chip' + (c.memo ? " memo" : "") + '"><span class="k">' + esc(c.label) + "</span>"
      + '<span class="v ' + (totals[c.key] > 0 ? "pos" : "neg") + '">' + signed(totals[c.key]) + "</span></span>").join("");
    const grandNet = BAL.reduce((s, c) => s + totals[c.key], 0);

    h += '<tfoot><tr><td class="a2-rail"></td>'
      + '<td class="l" colspan="' + (opts.emi ? 3 : 2) + '">Totals'
      + '<span class="a2-sub">' + fmtShort(first.t) + " – " + fmt(last.t) + " · " + chrono.length + " rows</span></td>"
      + '<td class="a2-bal open">' + money(first.opening) + "</td>"
      + '<td class="a2-mv"><div class="a2-chips">' + totalChips + "</div></td>"
      + '<td class="a2-net ' + (grandNet > 0 ? "pos" : "neg") + '">' + signed(grandNet) + "</td>"
      + '<td class="a2-bal close">' + money(last.closing) + "</td></tr></tfoot></table></div>";

    /* ---- rail legend + as-of state ---- */
    const legend = Object.keys(days).map(b =>
      '<span class="a2-leg ' + b + '"><i></i>' + BAND_LABEL[b] + " · " + days[b] + " rows</span>").join("");
    h += '<div class="a2-foot">' + legend
      + '<span class="a2-leg-note">Peak DPD ' + peak + " · current DPD " + model.dpd
      + (model.netDue ? " · net due " + money(model.netDue) : " · nothing overdue") + "</span></div>";

    mount.innerHTML = h;

    /* ---- header tools: the seal, the restatement notice, the fold switch ---- */
    const tools = document.querySelector('[data-a2-tools="' + mountId + '"]');
    if (tools) {
      tools.innerHTML =
        (restated ? '<span class="badge amber outline" title="' + restated
          + ' row(s) were booked after their value date, so history shown here has been restated since it was last exported.">'
          + restated + " restated</span>" : "")
        + '<span class="badge ' + (tiesOut && !broken ? "green" : "red") + ' outline" title="'
        + (tiesOut && !broken
            ? "Every row's opening + movement = closing, every closing = the next opening, and the totals tie to the range."
            : "This ledger does not tie out. Do not rely on the closing balance.")
        + '">' + (tiesOut && !broken ? "Reconciled ✓" : broken + " break" + (broken > 1 ? "s" : "") + " ✕") + "</span>"
        + (foldedCount ? '<button class="btn sm" data-a2-unfold="' + mountId + '">Show ' + foldedCount + " system rows</button>" : "")
        + '<button class="btn sm" data-nav="transactions">Transactions</button>'
        + '<button class="btn sm" data-nav="ledger">Ledger</button>';

      const btn = tools.querySelector("[data-a2-unfold]");
      if (btn) btn.addEventListener("click", () => {
        const open = btn.dataset.open === "1";
        mount.querySelectorAll("tr.child").forEach(tr => { tr.hidden = open; });
        mount.querySelectorAll("tr.isfold").forEach(tr => tr.classList.toggle("open", !open));
        btn.dataset.open = open ? "0" : "1";
        btn.textContent = (open ? "Show " : "Fold ") + foldedCount + " system rows";
      });
    }

    /* ---- row click pins the postings; ref click opens the drawer ---- */
    mount.addEventListener("click", e => {
      const ref = e.target.closest(".a2-ref.link");
      if (ref) { e.stopPropagation(); if (window.LMS.openRes) window.LMS.openRes(ref.dataset.res); return; }
      const tr = e.target.closest("tr.a2-row");
      if (!tr || tr.classList.contains("child")) return;
      const i = tr.dataset.i;
      if (tr.classList.contains("isfold")) {
        const kids = mount.querySelectorAll('tr[data-parent="' + i + '"]');
        const open = tr.classList.toggle("open");
        kids.forEach(k => { k.hidden = !open; });
      } else {
        const d = mount.querySelector('tr[data-detail="' + i + '"]');
        if (d) { d.hidden = !d.hidden; tr.classList.toggle("open", !d.hidden); }
      }
    });
  }

  /* ---------- mount ---------- */
  const SCF = scfRows(), TERM = termRows();
  if (document.getElementById("activity2-scf")) render("activity2-scf", SCF, {});
  if (document.getElementById("activity2-emi")) render("activity2-emi", TERM, { emi: true });

  window.LMS.A2 = { CATS, scfRows, termRows, render };
})();
