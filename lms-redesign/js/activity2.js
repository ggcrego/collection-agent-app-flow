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
                      Loan-level: the age of the oldest unpaid
                      Demand. An instalment's own age is a separate
                      number and is never shown in the same slot.
     EMI split        Ledger.demand — every posting already hangs
                      off an instalment, so grouping a repayment's
                      ledger rows by demand IS the split. Nothing
                      is inferred.
     full / partial   amount applied == the amount that was open on
                      that (demand, component). A comparison of two
                      stored numbers, not a judgement.
     Overdue marker   Demand.due_date + 1 day, emitted while the
                      demand still has an open balance. No
                      Transaction exists, so the row says derived
                      and carries no reference or postings.
     Milestone fee    the charge rule's trigger_dpd and amount; the
                      row's DPD is value_date − Demand.due_date.

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
  const MON_FULL = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
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

  /* ============================================================
     SCF loan — demand-keyed, and the interest is already paid.

     This product deducts its interest from the disbursal: the
     borrower receives gross minus upfront minus fees. So interest
     accrues daily as income to us, but it never becomes a
     receivable — each day's accrual is settled the same day out of
     the prepaid pot. Outstanding therefore moves only on
     disbursal, fees, and money coming in.

     There are no instalments here. The demand layer still exists —
     a service fee, a principal milestone, a penal charge — but a
     receipt is appropriated component-first, and whatever is left
     prepays principal the facility has not billed yet.
     ============================================================ */
  function scfRows() {
    const START = D("2026-06-02"), ASOF = D("2026-07-27"), MATURITY = D("2026-08-31");
    const RATE = 0.135, COVER = 90, GROSS = 3400000, PROC_FEE = 14493;
    /* The upfront is the stated rate over the stated cover, computed — not a
       figure typed in beside them. The terms card and the ledger cannot drift
       apart if only one of them is authored. */
    const UPFRONT = Math.round(GROSS * RATE * COVER / 365);
    const NET = GROSS - UPFRONT - PROC_FEE;

    /* A fee on a facility is recovered when money arrives, not dunned on its
       own, so it carries the maturity date and never puts the loan in arrears.
       Only the milestone does that. */
    const DEM = {
      "DMD-SCF-4901": { due: MATURITY,        label: "Service fee" },
      "DMD-SCF-5512": { due: D("2026-07-08"), label: "Principal milestone" },
      "DMD-SCF-5613": { due: D("2026-07-12"), label: "Penal charge" },
    };

    let unbilled = 0, hold = 0, earned = 0;
    const dem = {}, paid = {}, rev = {};
    const put     = (k, c, a) => { (dem[k] = dem[k] || {})[c] = (dem[k][c] || 0) + a; };
    const owed    = k => Object.values(dem[k] || {}).reduce((s, v) => s + v, 0);
    const keys    = () => Object.keys(dem).sort((a, b) => DEM[a].due - DEM[b].due);
    const total   = () => unbilled + keys().reduce((s, k) => s + owed(k), 0);
    const prinOut = () => unbilled + keys().reduce((s, k) => s + (dem[k].principal || 0), 0);
    const oldest  = t => keys().find(k => owed(k) > 0 && DEM[k].due < t);
    const loanDpd = t => { const k = oldest(t); return k ? Math.round((t - DEM[k].due) / DAY) : 0; };

    /* Appropriation on a facility runs component-first — fee, penal, interest,
       principal — oldest demand first inside each. Anything still left prepays
       principal that has not been billed, which is how a cross-loan cashback
       lands on a bullet loan with nothing yet due. */
    const ORDER = ["service_fee", "penal_charge", "interest", "principal"];
    let alloc = [];
    function settle(amount) {
      let left = amount;
      alloc = [];
      ORDER.forEach(c => keys().forEach(k => {
        const due = dem[k][c] || 0;
        if (!due || !left) return;
        const t = Math.min(left, due);
        dem[k][c] -= t; left -= t; paid[c] = (paid[c] || 0) + t;
        alloc.push({ component: c, amount: t, of: due, full: t === due, demand: k });
      }));
      if (left && unbilled) {
        const of = unbilled, t = Math.min(left, unbilled);
        unbilled -= t; left -= t; paid.principal = (paid.principal || 0) + t;
        alloc.push({ component: "principal", amount: t, of, full: false, prepay: true });
      }
      return amount - left;
    }

    const COMP = ["principal", "interest", "service_fee", "penal_charge"];
    const snap = () => {
      const o = { unbilled, hold, earned };
      keys().forEach(k => COMP.forEach(c => { if (dem[k][c]) o["o:" + c] = (o["o:" + c] || 0) + dem[k][c]; }));
      COMP.forEach(c => { if (paid[c]) o["p:" + c] = paid[c]; if (rev[c]) o["r:" + c] = rev[c]; });
      return o;
    };
    const POST = [["unbilled", "principal · unbilled", "zinc"]]
      .concat(COMP.map(c => ["o:" + c, c + " · outstanding", c === "principal" ? "blue" : "amber"]))
      .concat(COMP.map(c => ["p:" + c, c + " · paid",     "green"]))
      .concat(COMP.map(c => ["r:" + c, c + " · reversed", "violet"]))
      .concat([["hold",   "upfront_interest · hold",    "teal"],
               ["earned", "upfront_interest · accrued", "teal"]]);
    const post = (a, b) => POST.filter(([k]) => (a[k] || 0) !== (b[k] || 0))
      .map(([k, lbl, tone]) => [lbl, signed((b[k] || 0) - (a[k] || 0)), tone]);

    const EV = {
      "2026-06-02": [{
        code: "disbursement", activity: "Disbursed",
        note: "gross ₹" + grp(GROSS) + " · upfront ₹" + grp(UPFRONT)
            + " · fee ₹" + grp(PROC_FEE) + " · net ₹" + grp(NET),
        ref: "PYTUTR861204", refKind: "Payout UTR",
        run() { unbilled += GROSS; hold += UPFRONT; return { disbursed: GROSS }; }
      }],
      "2026-06-10": [{
        code: "fee_charge", activity: "Service fee charged",
        note: "service_fee ₹2,000 · tax ₹360",
        ref: "TXN-FEE-69881", refKind: "Transaction",
        run() { put("DMD-SCF-4901", "service_fee", 2360); return { fees: 2360 }; }
      }],
      "2026-06-20": [{
        code: "upfront_interest_settle", activity: "Cashback received",
        note: "source DMD-UI-4471 · LN-2401-0114",
        ref: "TXN-UIS-88213", refKind: "Transaction",
        run() { return { cashback: -settle(28450) }; }
      }],
      "2026-07-08": [{
        code: "schedule", activity: "Milestone fell due", schedule: true,
        note: "principal ₹3,80,000 billed from the facility",
        ref: "DMD-SCF-5512", refKind: "Demand",
        run() { unbilled -= 380000; put("DMD-SCF-5512", "principal", 380000); return {}; }
      }],
      "2026-07-12": [{
        code: "fee_charge", activity: "Penal charge", note: "penal_charge ₹1,850",
        ref: "TXN-PEN-70118", refKind: "Transaction", reversed: true,
        run() { put("DMD-SCF-5613", "penal_charge", 1850); return { penal: 1850 }; }
      }, {
        code: "fee_charge", activity: "Penal charge reversed",
        contra: "TXN-PEN-70118", booked: D("2026-07-16"),
        ref: "TXN-PEN-70118-R", refKind: "Transaction",
        run() { dem["DMD-SCF-5613"].penal_charge -= 1850;
                rev.penal_charge = (rev.penal_charge || 0) + 1850; return { penal: -1850 }; }
      }],
      "2026-07-14": [{
        code: "repayment", activity: "Repayment received",
        note: "NEFT · HDFC ••4410",
        ref: "UTR512044987N", refKind: "Payment UTR",
        run() { return { paid: -settle(380000) }; }
      }],
    };

    const rows = [];
    let peak = 0;
    for (let t = START; t <= ASOF; t += DAY) {
      const key = new Date(t).toISOString().slice(0, 10);

      /* Interest accrues, then is settled the same day out of the prepaid pot,
         so the balance does not move. That zero is the product: 55 rows of
         income recognition that a reader can fold away without losing anything
         the balance column would have told them. */
      if (t > START) {
        const a = snap(), opening = total(), dpd = loanDpd(t);
        const acc = Math.round(prinOut() * RATE / 365);
        const earn = Math.min(hold, acc);
        hold -= earn; earned += earn;
        peak = Math.max(peak, dpd);
        rows.push({
          t, machine: true, code: "accrual", activity: "Interest accrued",
          note: "13.50% p.a. on ₹" + grp(prinOut()) + " · settled from upfront",
          impacts: { upfront: earn }, dpd,
          opening, closing: total(), post: post(a, snap()),
        });
      }

      (EV[key] || []).forEach(e => {
        const a = snap(), opening = total(), dpdBefore = loanDpd(t);
        alloc = [];
        const impacts = e.run();
        const dpd = loanDpd(t);
        peak = Math.max(peak, dpdBefore, dpd);
        const drv = oldest(t);
        rows.push({
          t, machine: false, code: e.code, activity: e.activity, note: e.note,
          ref: e.ref, refKind: e.refKind, contra: e.contra, reversed: e.reversed,
          booked: e.booked, schedule: e.schedule, impacts, dpd,
          cured: dpdBefore > 0 && !drv ? dpdBefore : 0,
          parts: alloc.length ? alloc.slice() : null,
          driver: drv ? "oldest unpaid demand · " + DEM[drv].label + " · due " + fmt(DEM[drv].due) : null,
          opening, closing: total(), post: post(a, snap()),
        });
      });
    }

    return {
      rows, asOf: ASOF, peak, dpd: loanDpd(ASOF),
      netDue: keys().filter(k => DEM[k].due < ASOF).reduce((s, k) => s + owed(k), 0),
      upfront: { deducted: UPFRONT, earned, unearned: hold, net: NET, gross: GROSS, fee: PROC_FEE },
    };
  }

  /* ============================================================
     Term loan — demand-keyed, because the reader's unit is the
     instalment and so is the backend's: every Ledger row hangs off
     a Demand. Two layers of state:

       unbilled — principal the loan still owes but has not billed
                  to any instalment yet
       dem[n]   — what instalment n has been billed, by component,
                  net of what has been paid or waived against it

     An EMI falling due moves principal from the first into the
     second: a reclassification, so net movement is zero and the
     posting pair says so. A repayment walks demands in due order
     and components within each, which is what makes a single
     receipt settle #13 in full and #14 in part without anyone
     authoring that split.
     ============================================================ */
  function termRows() {
    /* Demand rows: installment_number → due_date + component amounts */
    const EMI = {
      12: { due: D("2026-05-05"), prin: 92360, int: 20140 },
      13: { due: D("2026-06-05"), prin: 92720, int: 19780 },
      14: { due: D("2026-07-05"), prin: 93050, int: 19450 },
    };
    const EMI_AMT = 112500, ASOF = D("2026-07-27");
    const LATE_FEE_DPD = 10, LATE_FEE = 1500;   /* charge rule: trigger_dpd + amount */

    let unbilled = 2078270;
    const dem = {}, paid = {}, waived = {};
    const put   = (n, c, a) => { (dem[n] = dem[n] || {})[c] = (dem[n][c] || 0) + a; };
    const waive = (n, c, a) => { dem[n][c] -= a; waived[c] = (waived[c] || 0) + a; };
    const bill  = n => { unbilled -= EMI[n].prin; put(n, "principal", EMI[n].prin); };
    const owed  = n => Object.values(dem[n] || {}).reduce((s, v) => s + v, 0);
    const nums  = () => Object.keys(dem).map(Number).sort((a, b) => a - b);
    const total = () => unbilled + nums().reduce((s, n) => s + owed(n), 0);

    /* The loan's DPD is the age of its oldest unpaid demand — RBI classifies
       the account, not the instalment. An instalment's own age is a different
       number, and on 06 Jul the two are 31 and 1. Never blur them. */
    const oldestUnpaid = t => nums().find(n => owed(n) > 0 && EMI[n].due < t);
    const loanDpd = t => { const n = oldestUnpaid(t); return n ? Math.round((t - EMI[n].due) / DAY) : 0; };
    const emiDpd  = (n, t) => Math.max(0, Math.round((t - EMI[n].due) / DAY));

    /* Settlement waterfall: demands in due order, components within each.
       Records what each demand and each component absorbed, so the per-EMI
       split is a by-product of applying the money — never a second
       calculation that could disagree with the postings. */
    const ORDER = ["bounce_fee", "late_fee", "penal_charge", "interest", "principal"];
    let alloc = [];
    function settle(amount) {
      let left = amount;
      alloc = [];
      nums().forEach(n => {
        if (!left) return;
        const parts = [];
        ORDER.forEach(c => {
          const due = dem[n][c] || 0;
          if (!due || !left) return;
          const t = Math.min(left, due);
          dem[n][c] -= t; left -= t; paid[c] = (paid[c] || 0) + t;
          parts.push({ component: c, amount: t, of: due, full: t === due });
        });
        if (!parts.length) return;
        alloc.push({
          emi: n, parts, due: EMI[n].due,
          applied: parts.reduce((s, p) => s + p.amount, 0),
          open: owed(n), cleared: owed(n) === 0,
        });
      });
      return amount - left;
    }

    /* Postings come out of the same two layers, in the Ledger page's
       vocabulary: component · posting_type. The unbilled line is the
       counterpart that makes a zero-movement billing row legible. */
    const COMP = ["principal", "interest", "bounce_fee", "late_fee", "penal_charge"];
    const snap = () => {
      const o = { unbilled };
      nums().forEach(n => COMP.forEach(c => { if (dem[n][c]) o["o:" + c] = (o["o:" + c] || 0) + dem[n][c]; }));
      COMP.forEach(c => { if (paid[c]) o["p:" + c] = paid[c]; if (waived[c]) o["w:" + c] = waived[c]; });
      return o;
    };
    const POST = [["unbilled", "principal · unbilled", "zinc"]]
      .concat(COMP.map(c => ["o:" + c, c + " · outstanding", c === "principal" || c === "interest" ? "blue" : "amber"]))
      .concat(COMP.map(c => ["p:" + c, c + " · paid",   "green"]))
      .concat(COMP.map(c => ["w:" + c, c + " · waived", "violet"]));
    const post = (a, b) => POST.filter(([k]) => (a[k] || 0) !== (b[k] || 0))
      .map(([k, lbl, tone]) => [lbl, signed((b[k] || 0) - (a[k] || 0)), tone]);

    /* ---- the lifecycle, in value-date order ----
       EMI #13 bounces and stays open while #14 falls due on schedule, so the
       loan carries two overdue instalments through July and one receipt on
       11 Jul settles across both. */
    const EV = [
      { date:"2026-04-30", code:"accrual", emi:12, activity:"Interest accrued",
        note:"11.75% p.a. · billed to EMI #12",
        run(){ put(12,"interest",EMI[12].int); return { interest: EMI[12].int }; } },

      { date:"2026-05-05", code:"schedule", emi:12, activity:"EMI fell due",
        note:"principal ₹"+grp(EMI[12].prin)+" · interest ₹"+grp(EMI[12].int)+" · EMI ₹"+grp(EMI_AMT),
        run(){ bill(12); return {}; } },

      { date:"2026-05-05", code:"repayment", activity:"Repayment received",
        note:"NACH · HDFC ••4410", ref:"UTR481120944N", refKind:"Payment UTR",
        run(){ return { paid: -settle(EMI_AMT) }; } },

      { date:"2026-05-31", code:"accrual", emi:13, activity:"Interest accrued",
        note:"11.75% p.a. · billed to EMI #13",
        run(){ put(13,"interest",EMI[13].int); return { interest: EMI[13].int }; } },

      { date:"2026-06-05", code:"schedule", emi:13, activity:"EMI fell due",
        note:"principal ₹"+grp(EMI[13].prin)+" · interest ₹"+grp(EMI[13].int)+" · EMI ₹"+grp(EMI_AMT),
        run(){ bill(13); return {}; } },

      { date:"2026-06-05", code:"fee_charge", emi:13, activity:"NACH returned",
        note:"bounce_fee ₹2,280", ref:"TXN-BNC-66201", refKind:"Transaction",
        run(){ put(13,"bounce_fee",2280); return { fees: 2280 }; } },

      /* Nothing posts here — no transaction, no ledger row. The date is
         arithmetic on Demand.due_date against an unsettled balance, which is
         why the row is flagged derived and carries no reference. */
      { date:"2026-06-06", code:"overdue", emi:13, derived:true, activity:"EMI overdue",
        note:() => "due "+fmt(EMI[13].due)+" · ₹"+grp(dem[13].principal+dem[13].interest)+" unpaid",
        run(){ return {}; } },

      { date:"2026-06-09", code:"fee_charge", emi:13, activity:"Penal charge",
        note:"penal_charge ₹1,140",
        run(){ put(13,"penal_charge",1140); return { penal: 1140 }; } },

      { date:"2026-06-10", code:"waiver", emi:13, activity:"Penal charge waived",
        note:"penal_charge ₹1,140",
        run(){ waive(13,"penal_charge",1140); return { waived: -1140 }; } },

      { date:"2026-06-30", code:"accrual", emi:14, activity:"Interest accrued",
        note:"11.75% p.a. · billed to EMI #14",
        run(){ put(14,"interest",EMI[14].int); return { interest: EMI[14].int }; } },

      { date:"2026-07-05", code:"schedule", emi:14, activity:"EMI fell due",
        note:"principal ₹"+grp(EMI[14].prin)+" · interest ₹"+grp(EMI[14].int)+" · EMI ₹"+grp(EMI_AMT),
        run(){ bill(14); return {}; } },

      { date:"2026-07-06", code:"overdue", emi:14, derived:true, activity:"EMI overdue",
        note:() => "due "+fmt(EMI[14].due)+" · ₹"+grp(dem[14].principal+dem[14].interest)+" unpaid",
        run(){ return {}; } },

      { date:"2026-07-08", code:"fee_charge", emi:14, activity:"NACH returned",
        note:"bounce_fee ₹2,280", ref:"TXN-BNC-71944", refKind:"Transaction",
        run(){ put(14,"bounce_fee",2280); return { fees: 2280 }; } },

      { date:"2026-07-08", code:"fee_charge", emi:14, activity:"Penal charge",
        note:"penal_charge ₹6,400",
        run(){ put(14,"penal_charge",6400); return { penal: 6400 }; } },

      /* approved on 20 Jul but value-dated back to the charge date — the
         restatement case: history shown here is not what it was last week */
      { date:"2026-07-08", code:"waiver", emi:14, activity:"Bounce fee waived",
        note:"bounce_fee ₹2,280", booked:D("2026-07-20"),
        run(){ waive(14,"bounce_fee",2280); return { waived: -2280 }; } },

      /* the receipt the whole page exists to explain: one payment, two demands */
      { date:"2026-07-11", code:"repayment", activity:"Repayment received",
        note:"IMPS · HDFC ••4410", ref:"UTR498232771N", refKind:"Payment UTR",
        run(){ return { paid: -settle(150000) }; } },

      { date:"2026-07-15", code:"fee_charge", emi:14, activity:"Late fee charged",
        note:"late_fee ₹"+grp(LATE_FEE)+" · charged at DPD "+LATE_FEE_DPD,
        run(){ put(14,"late_fee",LATE_FEE); return { fees: LATE_FEE }; } },
    ];

    let peak = 0;
    const rows = EV.map(e => {
      const t = D(e.date);
      const a = snap(), opening = total(), dpdBefore = loanDpd(t);
      alloc = [];
      const impacts = e.run(t) || {};
      const dpd = loanDpd(t);
      peak = Math.max(peak, dpdBefore, dpd);

      /* Children only when the receipt actually spans demands — a single-EMI
         repayment would just restate its parent, so its components render in
         the parent's own detail instead. */
      const kids = alloc.length > 1 ? alloc.map(k => ({
        t, child: true, split: true, noBal: true, emi: k.emi, dpd,
        cleared: k.cleared,
        activity: k.cleared ? "Settled in full" : "Part-settled",
        note: "due " + fmt(k.due) + " · " + (k.cleared
          ? (emiDpd(k.emi, t) ? "settled " + emiDpd(k.emi, t) + " days late" : "settled on time")
          : "₹" + grp(k.open) + " still open"),
        impacts: { paid: -k.applied }, parts: k.parts,
      })) : null;

      const drv = oldestUnpaid(t);
      return {
        t, machine: e.code === "accrual", code: e.code, activity: e.activity,
        note: typeof e.note === "function" ? e.note() : e.note,
        /* a receipt that touched exactly one demand belongs to it */
        emi: e.emi != null ? e.emi : (alloc.length === 1 ? alloc[0].emi : null),
        dpd, dpdBefore, derived: e.derived,
        ref: e.ref, refKind: e.refKind, booked: e.booked,
        schedule: e.code === "schedule", impacts,
        parts: alloc.length === 1 ? alloc[0].parts : null,
        kids, spans: kids ? kids.length : 0,
        driver: drv ? "oldest unpaid demand · EMI #" + drv + " · due " + fmt(EMI[drv].due) : null,
        opening, closing: total(), post: post(a, snap()),
      };
    });

    const overdue = nums().filter(n => owed(n) > 0 && EMI[n].due < ASOF);
    return {
      rows, asOf: ASOF, peak,
      dpd: loanDpd(ASOF),
      netDue: overdue.reduce((s, n) => s + owed(n), 0),
    };
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

  /* Settlement bar: one stacked bar, same .segbar primitive as the limit meter
     and the upfront earned/unearned split — a payment is one amount divided up,
     not several independent quantities, so it reads as one bar. */
  const TONE = { zinc: "#3f3f46", blue: "#2563eb", amber: "#d97706", teal: "#0d9488" };
  function allocBar(alloc) {
    if (!alloc || alloc.length < 2) return "";
    const total = alloc.reduce((s, a) => s + a.amount, 0);
    if (!total) return "";
    const pct = a => (a.amount / total) * 100;
    return '<div class="a2-alloc">'
      + '<div class="a2-alloc-t">How it was applied · ' + money(total) + "</div>"
      + '<div class="segbar" style="height:8px">'
      + alloc.map(a => '<span style="width:' + pct(a).toFixed(2) + "%;background:" + TONE[a.tone] + '"></span>').join("")
      + "</div><div class=\"legend\">"
      + alloc.map(a => '<span><i style="background:' + TONE[a.tone] + '"></i>' + esc(a.label)
          + " <b class=\"mono\">" + money(a.amount) + "</b> · " + Math.round(pct(a)) + "%</span>").join("")
      + "</div></div>";
  }

  /* A row is worth expanding if it has components, postings, a settlement
     breakdown or a reference. A derived marker has none of those — nothing
     posted, so there is nothing underneath to open. */
  const hasDetail = r => !r.fold &&
    (!!r.ref || (r.post && r.post.length > 0) || (r.parts && r.parts.length > 0)
     || Object.keys(r.impacts || {}).length > 0);

  const PART_TONE = { principal:"zinc", interest:"blue", penal_charge:"amber",
                      bounce_fee:"amber", late_fee:"amber", service_fee:"amber" };

  /* ---------- typed row icons ----------
     Five colours, grouped by what the event does to the position rather than
     by transaction code, so a reader learns the palette once:

       blue    a balance came into existence   disbursement, EMI billed
       teal    income recognised               accrual, upfront earned
       amber   a charge, or risk               fees, penal, overdue, part-paid
       violet  forgiven                        waivers
       green   money came in, or cleared       repayments, settled in full

     Saturation does the rest of the work: on the SCF loan the teal accrual
     runs to 53 rows, so its tint is the lightest in the set. */
  const ICONS = {
    disbursement: ["blue",   'M7 17 17 7M8 7h9v9'],
    schedule:     ["blue",   'M4 6h16v14H4zM4 10h16M9 4v4M15 4v4'],
    accrual:      ["teal",   'M4 17l5.5-6 4 4L20 7M15 7h5v5'],
    upfront_interest_settle: ["teal", 'M12 7v9M8 13l4 4 4-4'],
    overdue:      ["amber",  'M12 4 3 19h18L12 4M12 10v4M12 17h.01'],
    fee_charge:   ["amber",  'M18 6 6 18M8 9a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 8 9M16.5 18.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2'],
    waiver:       ["violet", 'M8 12h8'],
    repayment:    ["green",  'M17 7 7 17M16 17H7V8'],
    settled:      ["green",  'M19 7 10 17l-4.5-4.5'],
    partial:      ["amber",  'M12 5v14'],
  };
  const RING = { waiver: 1, upfront_interest_settle: 1, partial: 1 };

  function icon(r) {
    const key = r.split ? (r.cleared ? "settled" : "partial") : r.code;
    const spec = ICONS[key];
    if (!spec) return "";
    return '<span class="a2-i ' + spec[0] + '" aria-hidden="true">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
      + ' stroke-linecap="round" stroke-linejoin="round">'
      + (RING[key] ? '<circle cx="12" cy="12" r="8.5"/>' : "")
      + '<path d="' + spec[1] + '"/></svg></span>';
  }

  /* Component lines for a settlement. "full" / "partial" is a comparison of
     two real numbers — the amount applied against the amount that was open —
     so it needs no sentence written for it. */
  function partList(parts) {
    return '<div class="a2-parts">' + parts.map(p => {
      /* Money landing on principal the facility has not billed yet is a
         prepayment, not a part-settlement — there was no demand to fall short
         of, so "partial of ₹34,00,000" would be the wrong sentence. */
      const s = p.prepay ? ["pre", "prepaid, not yet billed"]
              : p.full   ? ["full", "full"]
                         : ["part", "partial of " + money(p.of)];
      return '<div class="a2-part"><span class="k">' + esc(p.component) + "</span>"
        + '<span class="v">' + money(p.amount) + "</span>"
        + '<span class="s ' + s[0] + '">' + s[1] + "</span></div>";
    }).join("") + "</div>";
  }

  /* Everything the row used to carry inline, in order of what a reader reaches
     for first: what moved → how it was applied → the postings → the id. */
  function detail(r) {
    let h = '<div class="a2-pin">';
    /* only worth a breakdown when there is more than one component — a lone
       chip just restates the Movement column */
    if (Object.keys(r.impacts || {}).length > 1) {
      h += '<div class="a2-pin-t">Movement · by component</div>'
        + '<div class="a2-chips">' + chips(r) + "</div>";
    }
    h += allocBar(r.alloc || (r.parts && r.parts.length > 1
      ? r.parts.map(p => ({ label: p.component, amount: p.amount,
                            tone: PART_TONE[p.component] || "zinc" }))
      : null));
    if (r.parts && r.parts.length) {
      h += '<div class="a2-pin-t">Settled against '
        + (r.emi ? "EMI #" + r.emi : "open demands") + "</div>" + partList(r.parts);
    }
    if (r.post && r.post.length) {
      h += '<div class="a2-pin-t">Ledger postings</div>' + postList(r.post);
    }
    if (r.ref) {
      const target = resolve(r.ref);
      h += '<div class="a2-pin-t">' + esc(r.refKind || "Reference") + "</div>"
        + '<span class="a2-ref' + (target ? " link" : "") + '"'
        + (target ? ' data-res="' + esc(target) + '"' : "") + ">" + esc(r.ref) + "</span>";
    }
    return h + "</div>";
  }

  function postList(post) {
    if (!post || !post.length) return "";
    return '<div class="a2-post">' + post.map(([lbl, d, tone]) =>
      '<div class="a2-post-r"><span class="a2-post-k">' + esc(lbl) + "</span>"
      + '<span class="a2-post-v" style="color:var(--' + tone + ')">' + d + "</span></div>").join("")
      + "</div>";
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

  function cells(r, opts, depth, risk) {
    const b = band(r.dpd || 0);
    const dateLabel = r.fold ? range(r.from, r.to) : fmt(r.t);
    const n = net(r);
    const expandable = r.fold || !!r.kids || hasDetail(r);

    /* References live in the expanded detail, not on the row. A truncated
       TXN- id is unactionable at a glance and was the single biggest source
       of noise across 60 rows; the row stays clickable to reach it. */
    const prose = [r.note, r.contra ? "reverses " + r.contra : null].filter(Boolean).join(" · ");
    let meta = prose ? '<span class="a2-note">' + esc(prose) + "</span>" : "";
    if (r.booked) meta += '<span class="a2-flag back">booked ' + fmt(r.booked) + "</span>";

    /* A split child shares its parent's value date exactly — repeating it down
       the column would read as four separate events on the same day. */
    let h = '<td class="a2-rail"><i class="' + b + '"></i></td>'
      + '<td class="a2-date">' + (r.split ? "" : esc(dateLabel)) + "</td>";

    if (opts.emi) h += '<td class="a2-emi">' + (r.emi ? "#" + r.emi : '<span class="a2-dash">—</span>') + "</td>";

    const cnt = r.fold ? r.days + " days folded"
              : r.spans ? "applied to " + r.spans + " EMIs" : "";

    h += '<td class="a2-act">'
      + '<div class="a2-t">'
      + '<span class="a2-x' + (expandable ? "" : " off") + '"></span>'
      + icon(r)
      + '<span class="a2-title" title="' + esc(r.activity) + '">' + esc(r.activity) + "</span>"
      + (cnt ? ' <span class="a2-cnt">' + cnt + "</span>" : "")
      + (r.reversed ? ' <span class="a2-flag rev">reversed</span>' : "")
      + (r.contra ? ' <span class="a2-flag con">contra</span>' : "")
      + (r.schedule ? ' <span class="a2-flag sch">schedule</span>' : "")
      /* nothing posted here: the row is arithmetic on a due date, not a
         transaction, and it says so rather than passing as one */
      + (r.derived ? ' <span class="a2-flag der" title="No transaction and no ledger row.'
          + ' Derived from Demand.due_date against an unsettled balance.">derived</span>' : "")
      + (risk ? ' <span class="a2-flag risk ' + b + '"'
          + (r.driver ? ' title="' + esc(r.driver) + '"' : "") + ">" + risk + "</span>" : "")
      + "</div>"
      + (meta ? '<div class="a2-m" title="' + esc(prose) + '">' + meta + "</div>" : "")
      + "</td>";

    /* A row carries a balance only where a TransactionSummary exists. A split
       child is a slice of one transaction, so per-demand opening and closing
       are not in the data — inventing them would be the numeric equivalent of
       writing the narration we refuse to write. */
    h += r.noBal
      ? '<td class="a2-bal open"><span class="a2-dash">—</span></td>'
      : '<td class="a2-bal open">' + money(r.opening) + "</td>";
    /* one signed figure, not a row of chips — the component split moved into
       the expanded detail. This column was Net Δ; the two were the same
       number once Movement stopped enumerating, so they are now one. */
    h += '<td class="a2-mv ' + (n > 0 ? "pos" : n < 0 ? "neg" : "zero") + '">' + (n ? signed(n) : "—") + "</td>"
      + (r.noBal
          ? '<td class="a2-bal close"><span class="a2-dash">—</span></td>'
          : '<td class="a2-bal close">' + money(r.closing) + "</td>");
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
    /* The worst DPD a loan reached is not always visible on a row: a repayment
       that clears a 36-day arrear books the row at the DPD it left behind, not
       the one it found. Where the model walked both, it reports the peak. */
    const peak = model.peak != null ? model.peak
      : chrono.reduce((m, r) => Math.max(m, r.dpd || 0), model.dpd || 0);
    const restated = chrono.filter(r => r.booked).length;
    const foldedCount = folded.filter(r => r.fold).reduce((s, r) => s + r.days, 0);

    /* ---- table ---- */
    let h = '<div class="a2-wrap"><table class="a2"><colgroup>'
      + '<col class="w-rail"><col class="w-date">' + (opts.emi ? '<col class="w-emi">' : "")
      + '<col><col class="w-bal"><col class="w-mv"><col class="w-bal">'
      + "</colgroup><thead><tr>"
      + '<th class="a2-rail"></th><th class="l">Value date</th>'
      + (opts.emi ? '<th class="l">EMI</th>' : "")
      + '<th class="l">Activity <span class="op">click a row for components, postings and refs</span></th>'
      + "<th>Opening O/S</th>"
      + '<th>Movement <span class="op">＋ / −</span></th>'
      + "<th>＝ Closing O/S</th></tr></thead><tbody>";

    /* Month bands. A folded run is one entry here even when it covers 18 days —
       the band counts what the reader sees, and the run's own date range says
       how much sits inside it. */
    const mKey = r => dt(r.t).getUTCFullYear() + "-" + dt(r.t).getUTCMonth();
    const mLabel = r => MON_FULL[dt(r.t).getUTCMonth()] + " " + dt(r.t).getUTCFullYear();
    const mCount = {};
    folded.forEach(r => { const k = mKey(r); mCount[k] = (mCount[k] || 0) + 1; });
    let curMonth = null;
    const span = opts.emi ? 6 : 5;

    /* One emitter for both kinds of child — a folded accrual band's children
       are real transactions, a repayment's children are slices of one. They
       nest the same way, so they render through the same path; what differs is
       whether they carry a balance, and cells() decides that. */
    function emit(r, key, depth, parent) {
      const b = band(r.dpd || 0);
      const kids = r.children || r.kids;
      const cls = ["a2-row", b,
        depth ? "child" : "",
        depth && r.machine ? "sys" : "",     /* reachable by the fold switch */
        r.fold ? "sysfold" : "",
        kids ? "isfold" : "",
        (r.badRow || r.badLink) ? "broken" : ""].filter(Boolean).join(" ");

      h += '<tr class="' + cls + '" data-i="' + key + '"'
        + (parent ? ' data-parent="' + parent + '"' : "")
        + ' style="--d:' + depth + '"' + (depth ? " hidden" : "") + ">"
        + cells(r, opts, depth, r.risk) + "</tr>";

      if (r.badLink) h += '<tr class="a2-break"><td></td><td colspan="' + span + '">'
        + "Opening does not match the previous closing — this row was inserted or restated after the balance was computed.</td></tr>";

      /* The parent's own postings and reference come first, then the per-EMI
         split: the shared transaction identity before what it was applied to.
         Tagged data-parent as well, so one toggle reveals both. */
      if (hasDetail(r)) {
        h += '<tr class="a2-detail" data-detail="' + key + '" data-parent="' + key + '"'
          + ' style="--d:' + depth + '" hidden><td class="a2-rail"><i class="' + b + '"></i></td>'
          + '<td colspan="' + span + '">' + detail(r) + "</td></tr>";
      }
      if (kids) kids.forEach((c, j) => emit(c, key + "." + j, depth + 1, key));
    }

    folded.forEach((r, i) => {
      const k = mKey(r);
      if (k !== curMonth) {
        curMonth = k;
        h += '<tr class="a2-group"><td class="a2-rail"></td>'
          + '<td colspan="' + span + '">' + esc(mLabel(r))
          + '<span class="n">' + mCount[k] + (mCount[k] === 1 ? " entry" : " entries") + "</span></td></tr>";
      }
      emit(r, String(i), 0, null);
    });
    h += "</tbody>";

    /* ---- totals, labelled by the range they actually cover ---- */
    const totalChips = CATS.filter(c => totals[c.key]).map(c =>
      '<span class="a2-chip' + (c.memo ? " memo" : "") + '"><span class="k">' + esc(c.label) + "</span>"
      + '<span class="v ' + (totals[c.key] > 0 ? "pos" : "neg") + '">' + signed(totals[c.key]) + "</span></span>").join("");
    const grandNet = BAL.reduce((s, c) => s + totals[c.key], 0);

    /* The component breakdown left the rows, but a range total IS a summary —
       so it stays, on its own line under the totals rather than inside them. */
    h += '<tfoot><tr><td class="a2-rail"></td>'
      + '<td class="l" colspan="' + (opts.emi ? 3 : 2) + '">Totals'
      + '<span class="a2-sub">' + fmtShort(first.t) + " – " + fmt(last.t) + " · " + chrono.length + " rows</span></td>"
      + '<td class="a2-bal open">' + money(first.opening) + "</td>"
      + '<td class="a2-mv ' + (grandNet > 0 ? "pos" : "neg") + '">' + signed(grandNet) + "</td>"
      + '<td class="a2-bal close">' + money(last.closing) + "</td></tr>"
      + '<tr class="a2-totchips"><td class="a2-rail"></td>'
      + '<td colspan="' + (opts.emi ? 6 : 5) + '"><div class="a2-chips">' + totalChips
      + "</div></td></tr></tfoot></table></div>";

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

      /* the switch reaches system rows only — a repayment's EMI children are
         not machine noise and must not be swept up by it */
      const btn = tools.querySelector("[data-a2-unfold]");
      if (btn) btn.addEventListener("click", () => {
        const open = btn.dataset.open === "1";
        mount.querySelectorAll("tr.child.sys").forEach(tr => { tr.hidden = open; });
        mount.querySelectorAll("tr.sysfold").forEach(tr => tr.classList.toggle("open", !open));
        btn.dataset.open = open ? "0" : "1";
        btn.textContent = (open ? "Show " : "Fold ") + foldedCount + " system rows";
      });
    }

    /* ---- row click reveals whatever hangs off it; ref click opens the drawer ----
       Children, details and grandchildren are all addressed by data-parent, so
       one path handles every level. Closing a row collapses everything nested
       below it, otherwise reopening it would restore a half-expanded tree. */
    mount.addEventListener("click", e => {
      const ref = e.target.closest(".a2-ref.link");
      if (ref) { e.stopPropagation(); if (window.LMS.openRes) window.LMS.openRes(ref.dataset.res); return; }
      const tr = e.target.closest("tr.a2-row");
      if (!tr) return;
      const i = tr.dataset.i;
      const kids = mount.querySelectorAll('tr[data-parent="' + i + '"]');
      if (!kids.length) return;
      const open = tr.classList.toggle("open");
      kids.forEach(k => { k.hidden = !open; });
      if (!open) mount.querySelectorAll("tr[data-i],tr[data-detail]").forEach(x => {
        const k = x.dataset.i || x.dataset.detail;
        if (k !== i && k.indexOf(i + ".") === 0) { x.hidden = true; x.classList.remove("open"); }
      });
    });
  }

  /* ---------- mount ---------- */
  const SCF = scfRows(), TERM = termRows();
  if (document.getElementById("activity2-scf")) render("activity2-scf", SCF, {});
  if (document.getElementById("activity2-emi")) render("activity2-emi", TERM, { emi: true });

  window.LMS.A2 = { CATS, scfRows, termRows, render };
})();
