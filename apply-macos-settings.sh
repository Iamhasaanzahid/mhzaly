#!/usr/bin/env bash
# =============================================================================
# apply-macos-settings.sh
# Run this script INSIDE your XFCE session (from a terminal) to apply
# all macOS UI settings at once. Requires D-Bus session bus access.
# =============================================================================
set -e

echo "=============================================="
echo "  Applying macOS Latest UI Settings..."
echo "=============================================="

# ---- XFCE Panel → macOS top menu bar ----
xfconf-query -c xfce4-panel -p /panels/panel-0/position -s "top" --create -t string
xfconf-query -c xfce4-panel -p /panels/panel-0/position-locked -s "true" --create -t bool
xfconf-query -c xfce4-panel -p /panels/panel-0/mode -s "0" --create -t int
xfconf-query -c xfce4-panel -p /panels/panel-0/size -s "34" --create -t uint
xfconf-query -c xfce4-panel -p /panels/panel-0/opacity -s "85" --create -t uint
xfconf-query -c xfce4-panel -p /panels/panel-0/background-mode -s "1" --create -t uint
xfconf-query -c xfce4-panel -p /panels/panel-0/background-color -s "#f5f5f7" --create -t uint

echo "[✓] Panel: top bar, size 34, opacity 85"

# ---- XFWM4 Window Manager ----
xfconf-query -c xfwm4 -p /general/theme -s "WhiteSur-Light" --create -t string
xfconf-query -c xfwm4 -p /general/button_layout -s "CHM|" --create -t string
xfconf-query -c xfwm4 -p /general/title_font -s "Inter Bold 11" --create -t string

echo "[✓] XFWM4: WhiteSur-Light theme, macOS button layout"

# ---- XSettings (GTK theme, icons, cursors, font) ----
xfconf-query -c xsettings -p /Net/ThemeName -s "WhiteSur-Light" --create -t string
xfconf-query -c xsettings -p /Net/IconThemeName -s "WhiteSur" --create -t string
xfconf-query -c xsettings -p /Gtk/CursorThemeName -s "WhiteSur-cursors" --create -t string
xfconf-query -c xsettings -p /Gtk/FontName -s "Inter 11" --create -t string

echo "[✓] XSettings: WhiteSur theme, icons, cursors, Inter font"

# ---- Restart panel to apply ----
xfce4-panel -r 2>/dev/null || true
echo "[✓] Panel restarted"

echo ""
echo "=============================================="
echo "  🎉 macOS settings applied!"
echo "=============================================="
echo ""
echo "Next: Logout & login for Plank dock & Picom"
echo "      to auto-start with macOS glass blur."
echo ""
