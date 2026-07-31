window.LMS = window.LMS || {};

/* ============================================================
   Repayment schedule progress
   ------------------------------------------------------------
   Renders one tick per installment from a count, so the strip
   and the settled/due/pending totals can never disagree.

   Only status and due dates are derived here — no principal or
   interest is generated, because inventing per-row money in an
   audit surface would be worse than showing less. The real
   per-installment figures stay in the table below and on the
   Demands page.
   ============================================================ */
(function(){

  const SCHEDULES = {
    "schedule-emi": {
      total:24, settled:13, due:14,
      late:{ 13:36 },                       // settled, but N days late
      dueDpd:22,
      part:{ 14:{ paid:28820, of:112500 } },// the open EMI took part of a receipt
      firstDue:{ month:5, year:2025 },      // EMI #1 — 05 Jun 25 (0-indexed month)
      emi:"₹1,12,500",
      stats:[
        ["Monthly EMI",  "₹1,12,500"],
        ["Collected",    "₹15,00,000"],
        ["On-time rate", "92%"],
        ["Settled late", "1 of 13 · 36 days"],
      ],
    },
  };

  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  function dueDate(first, n){                       // n is 1-based
    const m = first.month + (n - 1);
    return "05 " + MON[m % 12] + " " + String(first.year + Math.floor(m / 12)).slice(2);
  }

  const state = (s, n) =>
    (s.late || {})[n] ? "late" : n <= s.settled ? "paid" : n === s.due ? "due" : "pending";

  /* RBI ageing bands — derived from DPD, never stored alongside it, so the
     two can't drift apart */
  const band = dpd => dpd <= 0 ? "STD" : dpd <= 30 ? "SMA-0"
                    : dpd <= 60 ? "SMA-1" : dpd <= 90 ? "SMA-2" : "NPA";

  /* ---------- hero pill strip: same source, so it cannot disagree ----------
     The card carries only what isn't already on screen. A live arrear's
     category sits in the Due now column, the identity badge and the foot
     strip; a cured one's is nowhere else, so that is the one worth naming. */
  const rupee = n => "₹" + (String(n).length <= 3 ? n
    : String(n).slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + String(n).slice(-3));

  function ticks(s){
    const late = s.late || {}, part = s.part || {};
    let h = "";
    for(let n = 1; n <= s.total; n++){
      const st = state(s, n);
      const p = part[n];
      const rows = [["EMI", s.emi]];

      if(st === "late"){
        rows.push(["Settled late by", late[n] + " days"]);
        rows.push(["Asset class then", band(late[n])]);
      } else if(st === "due"){
        /* a part payment against an open EMI is the one thing about it that
           isn't already on the pill, so it goes above the DPD */
        if(p) rows.push(["Part settled", rupee(p.paid) + " of " + rupee(p.of)]);
        rows.push(["Overdue", (s.dueDpd || 0) + " days"]);
      } else if(st === "pending"){
        rows.push(["Due", dueDate(s.firstDue, n)]);
      }

      const badge = st === "late" ? late[n] + "d"
                  : st === "due"  ? (s.dueDpd || 0) + "d" : "";
      h += '<span class="' + st + ' pop"'
         + (p ? ' style="--p:' + (p.paid / p.of * 100).toFixed(1) + '%"' : "") + ">"
         + (p ? "<u></u>" : "") + (badge ? "<i>" + badge + "</i>" : "")
         + '<span class="pop-card"><span class="pop-t">EMI #' + n + " of " + s.total + "</span>"
         + rows.map(([k, v]) => '<span class="pop-row"><span class="pk">' + esc(k)
             + '</span><span class="pv">' + esc(v) + "</span></span>").join("")
         + "</span></span>";
    }
    return h;
  }

  function render(id, s){
    const mount = document.getElementById(id);
    if(!mount || !s) return;

    const pending = s.total - s.settled - 1;
    const late = s.late || {};
    const lateCount = Object.keys(late).length;
    let bars = "";
    for(let n = 1; n <= s.total; n++){
      const st = state(s, n);
      const p = (s.part || {})[n];
      const label = st === "late" ? "Settled " + late[n] + " days late"
                  : st === "paid" ? "Settled"
                  : st === "due"  ? "Due · DPD " + s.dueDpd
                      + (p ? " · part settled " + rupee(p.paid) + " of " + rupee(p.of) : "")
                  : "Pending";
      bars += '<i class="' + st + '" title="EMI #' + n + " · " + dueDate(s.firstDue, n)
            + " · " + s.emi + " · " + label + '"></i>';
    }

    mount.innerHTML =
      '<div class="sched-head">'
      +  '<span class="sched-count"><b>' + s.settled + "</b> of <b>" + s.total + "</b> EMIs settled</span>"
      +  '<span class="sched-due"><span class="ref">EMI #' + s.due + "</span>due DPD " + s.dueDpd + "</span>"
      + "</div>"
      + '<div class="sched-ticks">' + bars + "</div>"
      + '<div class="sched-legend">'
      +  '<span><i class="paid"></i>Settled <b>' + (s.settled - lateCount) + "</b> on time</span>"
      +  (lateCount ? '<span><i class="late"></i>Settled late <b>' + lateCount + "</b></span>" : "")
      +  '<span><i class="due"></i>Due <b>1</b> · #' + s.due + "</span>"
      +  '<span><i class="pending"></i>Pending <b>' + pending + "</b></span>"
      +  '<span style="margin-left:auto">Next <b>' + dueDate(s.firstDue, s.due + 1)
      +    "</b> · #" + (s.due + 1) + "</span>"
      + "</div>"
      + '<div class="sched-stats">'
      +  s.stats.map(([k, v]) => '<div><div class="k">' + esc(k) + '</div><div class="v">'
           + esc(v) + "</div></div>").join("")
      + "</div>";
  }

  Object.keys(SCHEDULES).forEach(id => render(id, SCHEDULES[id]));

  /* the hero strip, fed from the same schedule object as the widget above */
  Object.keys(SCHEDULES).forEach(id => {
    const mount = document.getElementById(id.replace("schedule-", "ticks-"));
    if(mount) mount.innerHTML = ticks(SCHEDULES[id]);
  });

  window.LMS.SCHEDULES = SCHEDULES;
  window.LMS.scheduleTicks = ticks;
  window.LMS.renderSchedule = render;
})();
