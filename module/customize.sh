#!/system/bin/sh
# ORBIT // STORE - installer
SKIPUNZIP=0
ui_print " "
ui_print "  ORBIT // STORE"
ui_print "  Module store for KernelSU Modules"
ui_print " "
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/store.sh" 0 0 0755
set_perm "$MODPATH/action.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
mkdir -p /data/adb/orbit
[ -f /data/adb/orbit/sources.txt ] || echo "https://modules.kernelsu.org/" > /data/adb/orbit/sources.txt
ui_print "- Checking download tools..."
t=$(ORBIT_MODDIR="$MODPATH" sh "$MODPATH/store.sh" tools 2>/dev/null)
echo "$t" | grep -q '"curl":1' && ui_print "  [ok] curl"
echo "$t" | grep -q '"wget":1' && ui_print "  [ok] busybox wget"
echo "$t" | grep -q '"installer":"none"' && ui_print "  [!!] no ksud, apd or magisk found"
command -v gzip >/dev/null 2>&1 && ui_print "  [ok] gzip (Alt Repo source archives)" || ui_print "  [--] no gzip, Alt Repo installs will fail"
ui_print "- WebView download fallback is always available."
ui_print "- Open the WebUI from the module card."
ui_print " "
