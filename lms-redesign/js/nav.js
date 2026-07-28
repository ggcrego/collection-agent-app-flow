window.LMS = window.LMS || {};

(function(){
  /* ---------- navigation: every view is its own page ---------- */
  const PAGES = {
    account:"index.html", contact:"contact.html", payment:"payment.html",
    loan:"loan-scf.html",          /* default target for the Loans nav item */
    "loan-scf":"loan-scf.html", "loan-term":"loan-term.html",
    payout:"payout.html", transactions:"transactions.html", demands:"demands.html",
    ledger:"ledger.html", configuration:"configuration.html"
  };
  function go(name){
    const page = PAGES[name];
    if(page) window.location.href = page;
  }
  document.querySelectorAll(".nav-item[data-view]")
    .forEach(n=>n.addEventListener("click",()=>go(n.dataset.view)));

  /* expose to the other files */
  window.LMS.PAGES = PAGES;
  window.LMS.go = go;
})();
