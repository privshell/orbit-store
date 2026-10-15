#!/system/bin/sh
# ORBIT // STORE - Action button: check for updates of installed modules
MODDIR=${0%/*}
sh "$MODDIR/store.sh" check
