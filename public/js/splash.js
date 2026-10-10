// Full-screen logo for 5 seconds on the first page of each visit, then the page is revealed.
(function () {
  try { if (sessionStorage.getItem('cu_splash')) return; sessionStorage.setItem('cu_splash', '1'); } catch (e) {}
  var root = document.documentElement; root.classList.add('splash-on');
  new Image().src = '/img/logo.jpg';
  function build() {
    var d = document.createElement('div'); d.id = 'splash'; d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'CATCH UP, college event register');
    d.innerHTML = '<img src="/img/logo.jpg" alt=""><div class="sp-bar"><i></i></div>';
    document.body.appendChild(d);
    setTimeout(function () { d.classList.add('out'); setTimeout(function () { d.remove(); root.classList.remove('splash-on'); }, 550); }, 5000);
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
