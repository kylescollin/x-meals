(function(){
  var style = document.createElement('style');
  style.textContent = '.site-nav{max-width:680px;margin:0 auto;display:flex;padding:0 20px;border-bottom:1px solid var(--border)}.nav-link{font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-decoration:none;padding:14px 16px 12px;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s}.nav-link:hover{color:var(--ink)}.nav-link.active{color:var(--accent);border-bottom-color:var(--accent)}';
  document.head.appendChild(style);

  var page = location.pathname.split('/').pop() || 'index.html';
  var links = [
    {href:'index.html',   label:'This Week'},
    {href:'recipes.html', label:'Recipes'},
    {href:'journal.html', label:'Journal'}
  ];
  var nav = document.createElement('nav');
  nav.className = 'site-nav';
  links.forEach(function(l){
    var a = document.createElement('a');
    a.href = l.href;
    a.className = 'nav-link' + (page === l.href ? ' active' : '');
    a.textContent = l.label;
    nav.appendChild(a);
  });
  var signOutLink = document.createElement('a');
  signOutLink.href = '#';
  signOutLink.className = 'nav-link';
  signOutLink.textContent = 'Sign Out';
  signOutLink.style.marginLeft = 'auto';
  signOutLink.addEventListener('click', function(e) {
    e.preventDefault();
    if (window.doSignOut) window.doSignOut();
  });
  nav.appendChild(signOutLink);

  document.currentScript.parentNode.insertBefore(nav, document.currentScript);
})();
