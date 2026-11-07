#!/usr/bin/env bash
# =============================================================================
# optimize-lowram.sh — Debian XFCE ko fast aur kam RAM wala banane ke liye
# =============================================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[*]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1; }

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  System Fast + Kam RAM Optimization${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 1. Picom — lightweight config (blur/shadow off for low RAM)
info "Picom ko lightweight bana raha hoon..."
printf '%s\n' \
'backend = "glx";' \
'vsync = true;' \
'glx-no-stencil = true;' \
'unredir-if-possible = true;' \
'paint-on-overlay = true;' \
'window-opacity = 1.0;' \
'inactive-opacity = 1.0;' \
'frame-opacity = 1.0;' \
'fading = true;' \
'fade-delta = 5;' \
'fade-in-step = 0.05;' \
'fade-out-step = 0.05;' \
'shadow = false;' \
'database = false;' \
> ~/.config/picom.conf
ok "Picom: blur aur shadow disable ho gaye kam RAM use hoga"
echo ""

# 2. Plank Dock — auto-hide, small icons, no zoom
info "Plank dock ko optimize kar raha hoon..."
printf '%s\n' \
'[PlankDockPreferences]' \
'CurrentWorkspaceOnly=false' \
'DockItems=thunar.dockitem;firefox-esr.dockitem;xfce4-terminal.dockitem' \
'Position=0' \
'PinnedOnly=false' \
'AutoHide=true' \
'HideMode=1' \
'Offset=0' \
'Theme=Transparent' \
'IconSize=36' \
'Monitor=0' \
'ShowDockItem=false' \
'ShowUnpinned=false' \
'LockItems=false' \
'PressureReveal=false' \
'Zoom=false' \
'ZoomPercent=1.0' \
> ~/.config/plank/dock1/settings
ok "Plank: auto-hide, icon size 36, zoom off kam RAM"
echo ""

# 3. XFCE settings — light font, no heavy effects
info "XFCE ko optimize kar raha hoon..."
xfconf-query -c xfwm4 -p /general/theme -s "WhiteSur-Light" --create -t string 2>/dev/null || true
xfconf-query -c xfwm4 -p /general/button_layout -s "CHM|" --create -t string 2>/dev/null || true
xfconf-query -c xsettings -p /Gtk/FontName -s "Inter 10" --create -t string 2>/dev/null || true
ok "XFCE: font chhota kiya effects kam kiye"
echo ""

# 4. Swappiness kam karo (RAM use kam hoga)
info "Swappiness kam kar raha hoon RAM bachane ke liye..."
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-lowram.conf > /dev/null 2>&1 || true
sudo sysctl vm.swappiness=10 2>/dev/null || true
ok "Swappiness: 10 set kiya RAM kam use hoga"
echo ""

# 5. Thunar fast mode
info "Thunar ko fast bana raha hoon..."
xfconf-query -c thunar -p /last-view-type -s "ThunarDetailsView" --create -t string 2>/dev/null || true
xfconf-query -c thunar -p /last-show-hidden -s "false" --create -t bool 2>/dev/null || true
ok "Thunar: optimize ho gaya"
echo ""

# 6. System caches clear karo
info "System caches clear kar raha hoon..."
sudo sync 2>/dev/null || true
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null || true
ok "Caches clear ho gaye"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  🚀 OPTIMIZATION COMPLETE! System ab fast hoga aur kam RAM use karega${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Kya badla:${NC}"
echo "  1. Picom blur/shadow off — GPU aur RAM bachta hai"
echo "  2. Plank auto-hide, icon size 36, zoom off"
echo "  3. Swappiness 10 — RAM pe kam dabaav"
echo "  4. Thunar fast mode"
echo "  5. Caches clear"
echo ""
echo -e "${YELLOW}Zaroori: Logout aur phir login karo taake sab apply ho.${NC}"
echo ""
echo -e "${BLUE}RAM check karne ke liye:${NC}"
echo "  free -h"
echo ""
