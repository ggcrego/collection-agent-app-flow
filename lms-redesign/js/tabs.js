window.LMS = window.LMS || {};

(function(){
  /* loan sub-tabs */
  const loanTabs = document.querySelectorAll("#loanTabs .tab");
  loanTabs.forEach(t=>t.addEventListener("click",()=>{
    loanTabs.forEach(x=>x.classList.toggle("active",x===t));
    document.getElementById("loanpane-scf").classList.toggle("active", t.dataset.loan==="scf");
    document.getElementById("loanpane-emi").classList.toggle("active", t.dataset.loan==="emi");
  }));


  /* configuration scope cascade */
  const scopeNodes = document.querySelectorAll("#cfgCascade .node");
  scopeNodes.forEach(n=>n.addEventListener("click",()=>{
    scopeNodes.forEach(x=>x.classList.toggle("cur",x===n));
    document.querySelectorAll(".scopepane").forEach(p=>p.classList.toggle("active", p.id==="scope-"+n.dataset.scope));
  }));

  /* configuration sub-tabs */
  const cfgTabs = document.querySelectorAll("#cfgTabs .tab");
  cfgTabs.forEach(t=>t.addEventListener("click",()=>{
    cfgTabs.forEach(x=>x.classList.toggle("active",x===t));
    document.getElementById("cfgpane-scf").classList.toggle("active", t.dataset.cfg==="scf");
    document.getElementById("cfgpane-tl").classList.toggle("active", t.dataset.cfg==="tl");
  }));

  /* config toggles: visual only, locked ones don't move */
  document.addEventListener("click",e=>{
    const s = e.target.closest(".sw");
    if(s && !s.classList.contains("locked")) s.classList.toggle("on");
  });
})();
