function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const mainWrapper = document.getElementById('mainWrapper');
  const overlay = document.getElementById('sidebarOverlay');

  if (window.innerWidth < 992) {
    sidebar.classList.toggle('mobile-show');
    overlay.classList.toggle('show');
  } else {
    sidebar.classList.toggle('collapsed');
    mainWrapper.classList.toggle('expanded');
  }
}