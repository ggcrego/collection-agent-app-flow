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
      firstDue:{ month:5, year:2025 },      // EMI #1 — 05 Jun 25 (0-indexed month)
      emi:"₹1,12,500",
      dueNote:"DPD 22",
      stats:[
        ["Monthly EMI",  "₹1,12,500"],
        ["Collected",    "₹14,62,500"],
        ["On-time rate", "86%"],
        ["Avg delay",    "2.1 days"],
      ],
    },
  };

  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  function dueDate(first, n){                       // n is 1-based
    const m = first.month + (n - 1);
    return "05 " + MON[m % 12] + " " + String(first.year + Math.floor(m / 12)).slice(2);
  }

  function render(id, s){
    const mount = document.getElementById(id);
    if(!mount || !s) return;

    const pending = s.total - s.settled - 1;
    let ticks = "";
    for(let n = 1; n <= s.total; n++){
      const state = n <= s.settled ? "paid" : n === s.due ? "due" : "pending";
      const label = state === "paid" ? "Settled" : state === "due" ? "Due · " + s.dueNote : "Pending";
      ticks += '<i class="' + state + '" title="EMI #' + n + " · " + dueDate(s.firstDue, n)
             + " · " + s.emi + " · " + label + '"></i>';
    }

    mount.innerHTML =
      '<div class="sched-head">'
      +  '<span class="sched-count"><b>' + s.settled + "</b> of <b>" + s.total + "</b> EMIs settled</span>"
      +  '<span class="sched-due"><span class="ref">EMI #' + s.due + "</span>due " + esc(s.dueNote) + "</span>"
      + "</div>"
      + '<div class="sched-ticks">' + ticks + "</div>"
      + '<div class="sched-legend">'
      +  '<span><i class="paid"></i>Settled <b>' + s.settled + "</b></span>"
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

  window.LMS.SCHEDULES = SCHEDULES;
  window.LMS.renderSchedule = render;
})();
