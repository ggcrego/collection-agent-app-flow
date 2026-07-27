window.LMS = window.LMS || {};

(function(){
  /* filter chips: visual only in this design prototype */
  document.querySelectorAll(".filters").forEach(f=>{
    f.addEventListener("click",e=>{
      const c = e.target.closest(".fchip"); if(!c) return;
      f.querySelectorAll(".fchip").forEach(x=>x.classList.remove("on"));
      c.classList.add("on");
    });
  });
})();
