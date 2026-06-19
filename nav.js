(function(){
  var style = document.createElement('style');
  style.textContent = [
    // Shared
    '.site-nav{max-width:720px;margin:0 auto;display:flex;align-items:center;padding:0 20px;border-bottom:1px solid var(--border)}',
    '.nav-link{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-decoration:none;padding:14px 14px 12px;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s}',
    '.nav-link:hover{color:var(--ink)}',
    '.nav-link.active{color:var(--accent);border-bottom-color:var(--accent)}',
    '.nav-ico{font-size:15px;line-height:1}',
    // Profile / avatar
    '.nav-prof{margin-left:auto;position:relative;display:flex;align-items:center}',
    '.nav-avatar{width:30px;height:30px;border-radius:50%;border:1px solid var(--border);background:var(--accent-light,#f5e8de);padding:0;cursor:pointer;overflow:hidden;display:flex;align-items:center;justify-content:center;transition:border-color .15s}',
    '.nav-avatar:hover{border-color:var(--accent)}',
    '.nav-avatar-img{width:100%;height:100%;object-fit:cover;display:block}',
    '.nav-avatar-fallback{font-size:13px;font-weight:600;color:var(--accent);font-family:\'DM Sans\',sans-serif}',
    '.nav-menu{display:none;position:absolute;top:calc(100% + 8px);right:0;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:4px;min-width:170px;z-index:300}',
    '.nav-prof.open .nav-menu{display:block}',
    '.nav-menu-name{font-size:13px;font-weight:600;color:var(--ink);padding:9px 11px 7px;font-family:\'DM Sans\',sans-serif;word-break:break-word}',
    '.nav-menu-signout{display:block;width:100%;text-align:left;background:none;border:none;border-top:1px solid var(--border);margin-top:2px;padding:10px 11px;font-size:13px;color:var(--ink);cursor:pointer;font-family:\'DM Sans\',sans-serif;border-radius:0 0 7px 7px;transition:color .15s}',
    '.nav-menu-signout:hover{color:var(--accent)}',
    // Mobile: bottom tab bar
    '@media(max-width:560px){',
    'body{padding-bottom:62px}',
    '.site-nav{position:fixed;bottom:0;left:0;right:0;max-width:none;margin:0;padding:0;background:var(--cream);border-bottom:none;border-top:1px solid var(--border);justify-content:space-around;z-index:150}',
    '.nav-link{flex:1;flex-direction:column;align-items:center;gap:3px;padding:8px 2px 7px;font-size:9px;letter-spacing:.02em;border-bottom:none;margin-bottom:0;text-align:center}',
    '.nav-link.active{border-bottom:none}',
    '.nav-ico{font-size:20px}',
    '.nav-prof{flex:1;margin-left:0;flex-direction:column;justify-content:center;align-items:center;padding:7px 2px}',
    '.nav-avatar{width:26px;height:26px}',
    '.nav-menu{top:auto;bottom:calc(100% + 10px);right:8px}',
    '}'
  ].join('');
  document.head.appendChild(style);

  var page = location.pathname.split('/').pop() || 'index.html';
  var links = [
    {href:'index.html',     label:'This Week', icon:'📅'},
    {href:'groceries.html', label:'Groceries', icon:'🛒'},
    {href:'recipes.html',   label:'Recipes',   icon:'📖'},
    {href:'journal.html',   label:'Journal',   icon:'📔'}
  ];
  var nav = document.createElement('nav');
  nav.className = 'site-nav';
  links.forEach(function(l){
    var a = document.createElement('a');
    a.href = l.href;
    a.className = 'nav-link' + (page === l.href ? ' active' : '');
    a.innerHTML = '<span class="nav-ico">' + l.icon + '</span><span class="nav-lbl">' + l.label + '</span>';
    nav.appendChild(a);
  });

  // Profile avatar + dropdown menu (replaces the old "Sign Out" text link)
  var prof = document.createElement('div');
  prof.className = 'nav-prof';
  var avatar = document.createElement('button');
  avatar.type = 'button';
  avatar.className = 'nav-avatar';
  avatar.setAttribute('aria-label', 'Account');
  avatar.innerHTML = '<span class="nav-avatar-fallback">·</span>';
  var menu = document.createElement('div');
  menu.className = 'nav-menu';
  menu.innerHTML = '<div class="nav-menu-name"></div><button type="button" class="nav-menu-signout">Sign Out</button>';
  prof.appendChild(avatar);
  prof.appendChild(menu);
  nav.appendChild(prof);

  avatar.addEventListener('click', function(e){ e.stopPropagation(); prof.classList.toggle('open'); });
  menu.addEventListener('click', function(e){ e.stopPropagation(); });
  document.addEventListener('click', function(){ prof.classList.remove('open'); });
  menu.querySelector('.nav-menu-signout').addEventListener('click', function(e){
    e.preventDefault();
    if (window.doSignOut) window.doSignOut();
  });

  // Each protected page calls this after requireAuth() resolves, to fill in
  // the Google profile photo + name. nav.js runs before auth, so it starts
  // with a neutral placeholder and gets populated here.
  window.setNavUser = function(user){
    if (!user) return;
    var name = user.displayName || user.email || '';
    var initial = name ? name.charAt(0).toUpperCase() : '·';
    menu.querySelector('.nav-menu-name').textContent = name;
    if (user.photoURL) {
      var img = new Image();
      img.className = 'nav-avatar-img';
      img.alt = name;
      img.onload = function(){ avatar.innerHTML = ''; avatar.appendChild(img); };
      img.onerror = function(){ avatar.innerHTML = '<span class="nav-avatar-fallback">' + initial + '</span>'; };
      img.src = user.photoURL;
    } else {
      avatar.innerHTML = '<span class="nav-avatar-fallback">' + initial + '</span>';
    }
  };

  document.currentScript.parentNode.insertBefore(nav, document.currentScript);
})();
