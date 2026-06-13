/*
 * pull the latest content.js from github with jsDelivr, for auto-updates
 */
(function () {
  if (window.__dfjkLeaderboardLoader) return;
  window.__dfjkLeaderboardLoader = true;
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/gh/propadiene-1/dfjk-leaderboard@main/content.js';
  (document.head || document.documentElement).appendChild(s);
})();
