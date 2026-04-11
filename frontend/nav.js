// Inject navigation bar into every page
(function () {
  var scriptSrc = document.currentScript.src;
  var root = scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1);

  var links = [
    { label: 'Capture', href: root + 'capture/' },
    { label: 'TODOs', href: root + 'browse/todos/' },
    { label: 'Captures', href: root + 'browse/captures/' },
    { label: 'Knowledge', href: root + 'browse/knowledge/' },
  ];

  var currentPath = window.location.pathname;

  var nav = document.createElement('nav');
  nav.id = 'brainy-nav';

  for (var i = 0; i < links.length; i++) {
    var a = document.createElement('a');
    a.href = links[i].href;
    a.textContent = links[i].label;
    // Match active link by checking if current path ends with the link's path suffix
    var linkPath = new URL(links[i].href).pathname;
    if (currentPath === linkPath || currentPath === linkPath + 'index.html') {
      a.className = 'active';
    }
    nav.appendChild(a);
  }

  document.body.insertBefore(nav, document.body.firstChild);
})();
