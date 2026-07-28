window.LMS = window.LMS || {};

/* ============================================================
   Loan activity ledger
   ------------------------------------------------------------
   Six fixed columns, no horizontal scroll, no frozen columns.

     Date · Activity · Reference · Opening O/S · Movement · Closing O/S

   The Movement cell renders ONLY the categories that actually
   moved on that row, as chips. Adding a new transaction
   category costs one entry in CATEGORIES — the table shape
   never changes, and rows that don't use it show nothing.

   Each chip carries an optional hover card with the underlying
   ledger postings (demand · bucket / was / Δ / now), reusing the
   .pop / .pop-card / .ptab styles from popover.css.

   Balance arithmetic: opening + Σ(categories where
   affectsBalance) = closing. Categories flagged memo:true
   (Upfront Δ) are tracked but excluded, because a hold→accrued
   movement does not change what is outstanding.

   Detail strings are authored here, not user input, so a little
   inline markup (↳, <b>) is intentionally allowed through.
   ============================================================ */
(function(){

  /* ---------- transaction categories: order = chip order ---------- */
  const CATEGORIES = [
    { key:"disbursed",   label:"Disbursed",   affectsBalance:true  },
    { key:"interest",    label:"Interest",    affectsBalance:true  },
    { key:"fees",        label:"Fees",        affectsBalance:true  },
    { key:"cashback",    label:"Cashback",    affectsBalance:true  },
    { key:"paid",        label:"Paid",        affectsBalance:true  },
    { key:"adjustments", label:"Adjustments", affectsBalance:true  },
    { key:"upfront",     label:"Upfront Δ",   affectsBalance:false, memo:true },
  ];

  const PT = "Ledger postings → demand values";

  /* ---------- data: newest first ---------- */
  const LEDGERS = {
    "activity-scf": [
      { date:"25 Jul 26", activity:"Interest accrued", ref:"TXN-ACR-72410",
        opening:3042330, closing:3059330,
        impacts:{ interest:17000, upfront:-10920 },
        open:{ title:"Opening · by component", rows:[["Principal","₹30,42,330"],["Interest","₹0"],["Service fee","₹0"],["Total","₹30,42,330","tot"]] },
        close:{ title:"Closing · by component", rows:[["Principal","₹30,42,330"],["Interest","₹17,000"],["Service fee","₹0"],["Total","₹30,59,330","tot"]] },
        details:{
          interest:{ title:PT, cols:[
            ["interest · accrued","48,420","+17,000","65,420","blue"],
            ["interest · outstanding","0","+17,000","17,000","blue"]]},
          upfront:{ title:PT, cols:[
            ["upfront_interest · hold","40,307","−10,920","29,387","teal"],
            ["upfront_interest · accrued","35,200","+10,920","46,120","teal"]]},
        }},

      { date:"14 Jul 26", activity:"Repayment received", note:"NEFT", ref:"UTR512044987N",
        opening:3380030, closing:3042330,
        impacts:{ interest:42300, paid:-380000, upfront:-20100 },
        open:{ title:"Opening · by component", rows:[["Principal","₹33,80,030"],["Interest","₹0"],["Service fee","₹0"],["Total","₹33,80,030","tot"]] },
        close:{ title:"Closing · by component", rows:[["Principal","₹30,42,330"],["Interest","₹0 · fully settled"],["Service fee","₹0"],["Total","₹30,42,330","tot"]] },
        details:{
          interest:{ title:PT, cols:[
            ["interest · accrued","6,120","+42,300","48,420","blue"],
            ["interest · outstanding","0","+42,300","42,300","blue"]]},
          paid:{ title:PT, cols:[
            ["interest · paid","6,120","+42,300","48,420","green"],
            ["interest · outstanding","42,300","−42,300","0","green"],
            ["principal · paid","19,970","+3,37,700","3,57,670","green"],
            ["principal · outstanding","33,80,030","−3,37,700","30,42,330","green"]],
            rows:[["UTR","UTR512044987N","mini"],["From bank","HDFC ••4410 · NEFT · 14 Jul 26","mini"]]},
          upfront:{ title:PT, cols:[
            ["upfront_interest · hold","60,407","−20,100","40,307","teal"],
            ["upfront_interest · accrued","15,100","+20,100","35,200","teal"]]},
        }},

      { date:"20 Jun 26", activity:"Cashback received", note:"from LN-2401-0114", ref:"TXN-UIS-88213",
        opening:3402360, closing:3380030,
        impacts:{ interest:6120, cashback:-28450, upfront:-8400 },
        open:{ title:"Opening · by component", rows:[["Principal","₹34,00,000"],["Interest","₹0"],["Service fee","₹2,360"],["Total","₹34,02,360","tot"]] },
        close:{ title:"Closing · by component", rows:[["Principal","₹33,80,030"],["Interest","₹0 · fully settled"],["Service fee","₹0 · fully settled"],["Total","₹33,80,030","tot"]] },
        details:{
          interest:{ title:PT, cols:[
            ["interest · accrued","0","+6,120","6,120","blue"],
            ["interest · outstanding","0","+6,120","6,120","blue"]]},
          cashback:{ title:PT + " · settlement order", cols:[
            ["1 · service_fee · paid","0","+2,360","2,360","green"],
            ['<span class="sub">↳</span> service_fee · outstanding',"2,360","−2,360","0","green"],
            ["2 · interest · paid","0","+6,120","6,120","green"],
            ['<span class="sub">↳</span> interest · outstanding',"6,120","−6,120","0","green"],
            ["3 · principal · paid","0","+19,970","19,970","green"],
            ['<span class="sub">↳</span> principal · outstanding',"34,00,000","−19,970","33,80,030","green"],
            ["src DMD-UI-4471 · excess","28,450","−28,450","0","violet","sep"],
            ["src DMD-UI-4471 · settled","0","+28,450","28,450","violet"]],
            rows:[["Funding","internal · no bank movement","mini"]]},
          upfront:{ title:PT, cols:[
            ["upfront_interest · hold","68,807","−8,400","60,407","teal"],
            ["upfront_interest · accrued","6,700","+8,400","15,100","teal"]]},
        }},

      { date:"10 Jun 26", activity:"Service fee charged", note:"incl. GST", ref:"TXN-FEE-69881",
        opening:3400000, closing:3402360,
        impacts:{ fees:2360, upfront:-6700 },
        open:{ title:"Opening · by component", rows:[["Principal","₹34,00,000"],["Interest","₹0"],["Service fee","₹0"],["Total","₹34,00,000","tot"]] },
        close:{ title:"Closing · by component", rows:[["Principal","₹34,00,000"],["Interest","₹0"],["Service fee","₹2,360"],["Total","₹34,02,360","tot"]] },
        details:{
          fees:{ title:PT, cols:[
            ["service_fee · outstanding","0","+2,000","2,000","amber"],
            ["service_fee · tax (GST 18%)","0","+360","360","amber"]]},
          upfront:{ title:PT, cols:[
            ["upfront_interest · hold","75,507","−6,700","68,807","teal"],
            ["upfront_interest · accrued","0","+6,700","6,700","teal"]]},
        }},

      { date:"02 Jun 26", activity:"Disbursed", note:"net ₹33,10,000", ref:"PYTUTR861204",
        opening:0, closing:3400000,
        impacts:{ disbursed:3400000, upfront:75507 },
        close:{ title:"Closing · by component", rows:[["Principal","₹34,00,000"],["Interest","₹0 · upfront on hold"],["Service fee","₹0"],["Total","₹34,00,000","tot"]] },
        details:{
          disbursed:{ title:PT, cols:[
            ["principal · outstanding","0","+34,00,000","34,00,000","blue"],
            ["processing_fee · deducted","0","+12,282","12,282","amber"],
            ["processing_fee · tax_deducted","0","+2,211","2,211","amber"]],
            rows:[["Net payout","₹33,10,000","tot"],["UTR · to bank","PYTUTR861204 · HDFC ••4410","mini"]]},
          upfront:{ title:PT, cols:[
            ["upfront_interest · hold","0","+75,507","75,507","teal"]]},
        }},
    ],

    "activity-emi": [
      { date:"20 Jul 26", activity:"Bounce fee waived",
        opening:1921320, closing:1919040,
        impacts:{ adjustments:-2280 },
        details:{
          adjustments:{ title:PT, cols:[
            ["bounce_fee · waived","0","+2,280","2,280","amber"],
            ["bounce_fee · outstanding","2,280","−2,280","0","amber"]]},
        }},

      { date:"08 Jul 26", activity:"Overdue charges", note:"EMI #14",
        opening:1912640, closing:1921320,
        impacts:{ fees:8680 },
        details:{
          fees:{ title:"Charged on EMI #14 overdue", rows:[
            ["Bounce fee (NACH return)","₹2,280"],["Penal charge","₹6,400"],["Total","₹8,680","tot"]]},
        }},

      { date:"05 Jul 26", activity:"Repaid EMI #13", note:"NACH", ref:"UTR498232771N",
        opening:2025140, closing:1912640,
        impacts:{ paid:-112500 },
        details:{
          paid:{ title:PT, cols:[
            ["interest (EMI #13) · paid","0","+19,450","19,450","green"],
            ["interest (EMI #13) · outstanding","19,450","−19,450","0","green"],
            ["principal (EMI #13) · paid","0","+93,050","93,050","green"],
            ["principal (EMI #13) · outstanding","93,050","−93,050","0","green"]],
            rows:[["Via","NACH · HDFC ••4410","mini"]]},
        }},

      { date:"30 Jun 26", activity:"Interest accrued", note:"EMI #14",
        opening:2006600, closing:2025140, impacts:{ interest:18540 } },

      { date:"31 May 26", activity:"Interest accrued", note:"EMI #13",
        opening:1987150, closing:2006600, impacts:{ interest:19450 } },
    ],
  };

  /* ---------- helpers ---------- */
  const BAL = CATEGORIES.filter(c => c.affectsBalance);

  function grp(n){                                   // Indian digit grouping
    const s = String(n);
    if(s.length <= 3) return s;
    return s.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3);
  }
  const money  = n => "₹" + grp(Math.abs(n));
  const signed = n => (n > 0 ? "+" : "−") + grp(Math.abs(n));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  const delta = r => BAL.reduce((s,c) => s + (r.impacts[c.key] || 0), 0);
  const reconciles = r => r.opening + delta(r) === r.closing;

  function resolve(ref){
    if(!ref) return null;
    const RES = window.LMS.RES || {}, ALIAS = window.LMS.ALIAS || {};
    return RES[ref] ? ref : (ALIAS[ref] || null);
  }

  /* hover card — restored from the original timeline */
  function popCard(d){
    if(!d) return "";
    let h = '<span class="pop-card">';
    if(d.title) h += '<div class="pop-t">' + esc(d.title) + "</div>";
    if(d.cols && d.cols.length){
      h += '<table class="ptab"><tr><th>demand · bucket</th><th>was</th><th>Δ</th><th>now</th></tr>';
      d.cols.forEach(([bucket, was, dlt, now, tone, sep]) => {
        h += "<tr" + (sep ? ' class="sep"' : "") + "><td>" + bucket + "</td><td>" + was + "</td>"
          +  '<td class="d"' + (tone ? ' style="color:var(--' + tone + ')"' : "") + ">" + dlt + "</td>"
          +  "<td>" + now + "</td></tr>";
      });
      h += "</table>";
    }
    (d.rows || []).forEach(([k, v, mod]) => {
      h += '<div class="pop-row' + (mod === "tot" ? " tot" : "") + '"><span class="pk">' + k + "</span>"
        +  '<span class="pv' + (mod === "mini" ? " mini" : "") + '">' + v + "</span></div>";
    });
    return h + "</span>";
  }

  /* a balance figure, optionally with a component breakdown on hover */
  function bal(v, d){
    return d ? '<span class="pop">' + money(v) + popCard(d) + "</span>" : money(v);
  }

  /* the Movement cell: only the categories that actually moved */
  function movement(r){
    const chips = CATEGORIES
      .filter(c => r.impacts[c.key])
      .map(c => {
        const v = r.impacts[c.key], d = (r.details || {})[c.key];
        return '<span class="mv-chip' + (c.memo ? " memo" : "") + (d ? " pop" : "") + '"'
          + (c.memo ? ' title="Memo — upfront interest moving hold → earned. Does not change outstanding."' : "")
          + '><span class="mv-k">' + esc(c.label) + "</span>"
          + '<span class="mv-v ' + (v > 0 ? "pos" : "neg") + '">' + signed(v) + "</span>"
          + popCard(d) + "</span>";
      });
    return chips.length ? chips.join("") : '<span class="dash">—</span>';
  }

  /* ---------- render ---------- */
  function render(id, rows){
    const mount = document.getElementById(id);
    if(!mount || !rows || !rows.length) return;

    let h = '<table class="ledger"><colgroup>'
      + '<col class="w-date"><col class="w-act"><col class="w-ref">'
      + '<col class="w-bal"><col><col class="w-bal"></colgroup>'
      + "<thead><tr>"
      + '<th class="l">Date</th><th class="l">Activity</th><th class="l">Reference</th>'
      + '<th class="c-open">Opening O/S</th>'
      + '<th class="c-mv">Movement <span class="op">＋ charges · − credits</span></th>'
      + '<th class="c-close">＝ Closing O/S</th>'
      + "</tr></thead><tbody>";

    rows.forEach(r => {
      const target = resolve(r.ref);
      h += "<tr" + (target ? ' class="clickable" data-res="' + esc(target) + '"' : "") + ">"
        +  '<td class="l c-date">' + esc(r.date) + "</td>"
        +  '<td class="l c-act" title="' + esc(r.activity + (r.note ? " · " + r.note : "")) + '">'
        +    esc(r.activity)
        +  "</td>"
        +  '<td class="l c-ref">'
        +    (r.ref ? '<span class="ref' + (target ? " link" : "") + '">' + esc(r.ref) + "</span>"
                    : '<span class="dash">—</span>')
        +  "</td>"
        +  '<td class="c-open">' + bal(r.opening, r.open) + "</td>"
        +  '<td class="c-mv"><span class="mv">' + movement(r) + "</span></td>"
        +  '<td class="c-close">' + bal(r.closing, r.close) + "</td>"
        +  "</tr>";
    });
    h += "</tbody>";

    /* totals: same chip vocabulary, so the footer reads like a row */
    const totals = {};
    CATEGORIES.forEach(c => { totals[c.key] = rows.reduce((s,r) => s + (r.impacts[c.key] || 0), 0); });
    const oldest = rows[rows.length - 1], newest = rows[0];
    const totalChips = CATEGORIES.filter(c => totals[c.key]).map(c =>
      '<span class="mv-chip' + (c.memo ? " memo" : "") + '"><span class="mv-k">' + esc(c.label) + "</span>"
      + '<span class="mv-v ' + (totals[c.key] > 0 ? "pos" : "neg") + '">' + signed(totals[c.key])
      + "</span></span>").join("");

    h += '<tfoot><tr><td colspan="3" class="l">Totals</td>'
      +  '<td class="c-open">' + money(oldest.opening) + "</td>"
      +  '<td class="c-mv"><span class="mv">' + totalChips + "</span></td>"
      +  '<td class="c-close">' + money(newest.closing) + "</td>"
      +  "</tr></tfoot></table>";

    mount.innerHTML = h;

    /* Reconciliation is still checked, just not printed — the totals row already
       shows opening → movements → closing. Surfaces in the console if it breaks. */
    const bad = rows.filter(r => !reconciles(r)).length;
    let breaks = 0;
    for(let i = 0; i < rows.length - 1; i++) if(rows[i].opening !== rows[i+1].closing) breaks++;
    const sumOk = oldest.opening + rows.reduce((s,r) => s + delta(r), 0) === newest.closing;
    if(bad || breaks || !sumOk)
      console.warn("[ledger] " + id + " does not reconcile:",
                   { rowsOutOfBalance:bad, continuityBreaks:breaks, totalsMatch:sumOk });

    mount.querySelectorAll("tr.clickable").forEach(tr => {
      tr.addEventListener("click", e => {
        if(e.target.closest(".ref") || e.target.closest(".pop-card")) return;
        const openRes = window.LMS.openRes;
        if(openRes) openRes(tr.dataset.res);
      });
    });
  }

  Object.keys(LEDGERS).forEach(id => render(id, LEDGERS[id]));

  window.LMS.CATEGORIES = CATEGORIES;
  window.LMS.LEDGERS = LEDGERS;
  window.LMS.renderLedger = render;
})();
