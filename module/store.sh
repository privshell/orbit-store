#!/system/bin/sh
# ORBIT // STORE - backend for the WebUI
# Usage: store.sh <command> [args]   (run as root)

export PATH="/system/bin:/system/xbin:/data/adb/ksu/bin:/data/adb/ap/bin:/data/adb/magisk:$PATH"
MODDIR="${ORBIT_MODDIR:-/data/adb/modules/orbit_store}"
DATA="${ORBIT_DATA:-/data/adb/orbit}"
MODULES="${ORBIT_MODULES:-/data/adb/modules}"
DL="$DATA/dl"; CACHE="$DATA/cache"; JOBS="$DATA/jobs"
SOURCES="$DATA/sources.txt"
UA="ORBIT-Store/1.0 (KernelSU module store)"
mkdir -p "$DL" "$CACHE" "$JOBS" 2>/dev/null
[ -f "$SOURCES" ] || echo "https://modules.kernelsu.org/" > "$SOURCES"

BB=""
for b in /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox /data/adb/magisk/busybox; do
  [ -x "$b" ] && { BB=$b; break; }
done

# A leading digit is allowed: Magisk Modules Alt Repo has ids such as 1_MARS_SOM_BASE.
valid_id() { echo "$1" | grep -Eq '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$'; }
valid_url() { echo "$1" | grep -Eq '^https://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$' && ! echo "$1" | grep -q "'"; }
valid_sha() { echo "$1" | grep -Eq '^([0-9a-f]{64}|-)$'; }
jstr() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }

has_curl() { command -v curl >/dev/null 2>&1; }
has_wget() { [ -n "$BB" ] && "$BB" wget --help 2>&1 | grep -q -- '-O'; }

fetch_to() { # url out
  rm -f "$2.part"
  if has_curl && curl -fsSL --connect-timeout 15 --max-time 600 -A "$UA" -o "$2.part" "$1" 2>>"$2.err"; then mv "$2.part" "$2"; return 0; fi
  if has_wget && "$BB" wget -q -T 30 -U "$UA" -O "$2.part" "$1" 2>>"$2.err" && [ -s "$2.part" ]; then mv "$2.part" "$2"; return 0; fi
  rm -f "$2.part"; return 1
}

installer() {
  if [ -x /data/adb/ksud ]; then echo ksud
  elif [ -x /data/adb/apd ]; then echo apd
  elif command -v magisk >/dev/null 2>&1; then echo magisk
  else echo none; fi
}
mgr_install() {
  case "$(installer)" in
    ksud) /data/adb/ksud module install "$1" ;;
    apd) /data/adb/apd module install "$1" ;;
    magisk) magisk --install-module "$1" ;;
    *) echo "No supported root manager (ksud, apd or magisk) was found."; return 1 ;;
  esac
}

sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif [ -n "$BB" ]; then "$BB" sha256sum "$1" | cut -d' ' -f1
  else toybox sha256sum "$1" | cut -d' ' -f1; fi
}

prop() { sed -n "s/^$1=//p" "$2" 2>/dev/null | head -n1 | tr -d '\r'; }

installed_json() {
  printf '['; s=""
  for d in "$MODULES"/*/ "${MODULES}_update"/*/; do
    [ -f "$d/module.prop" ] || continue
    p="$d/module.prop"; pend=0
    case "$d" in "${MODULES}_update"/*) pend=1 ;; esac
    st=enabled; [ -f "$d/disable" ] && st=disabled; [ -f "$d/remove" ] && st=remove
    meta=0; case "$(prop metamodule "$p")" in 1 | true) meta=1 ;; esac
    vc=$(prop versionCode "$p"); echo "$vc" | grep -Eq '^[0-9]+$' || vc=0
    printf '%s{"id":"%s","name":"%s","version":"%s","versionCode":%s,"author":"%s","state":"%s","pending":%s,"meta":%s}' "$s" \
      "$(jstr "$(prop id "$p")")" "$(jstr "$(prop name "$p")")" "$(jstr "$(prop version "$p")")" "$vc" \
      "$(jstr "$(prop author "$p")")" "$st" "$pend" "$meta"
    s=","
  done
  printf ']\n'
}

tools_json() {
  c=0; has_curl && c=1; w=0; has_wget && w=1
  printf '{"curl":%s,"wget":%s,"installer":"%s","sdk":"%s","abi":"%s","abis":"%s","device":"%s"}\n' "$c" "$w" "$(installer)" \
    "$(getprop ro.build.version.sdk)" "$(getprop ro.product.cpu.abi)" "$(getprop ro.product.cpu.abilist)" "$(jstr "$(getprop ro.product.device)")"
}

get_url() { # url -> stdout (cached copy on failure)
  valid_url "$1" || { echo '{"error":"invalid url"}'; return 1; }
  key=$(printf '%s' "$1" | (sha256sum 2>/dev/null || "$BB" sha256sum) | cut -c1-16)
  f="$CACHE/$key"
  rm -f "$f.err"
  if fetch_to "$1" "$f.new"; then mv "$f.new" "$f"; cat "$f"; return 0; fi
  if [ -s "$f" ]; then cat "$f"; echo; echo "#ORBIT-CACHED"; return 0; fi
  echo "#ORBIT-FAILED"; return 1
}

# Builds a flashable zip from a GitHub source archive (repo-branch/ inside).
# Root managers want module.prop at the top of the zip; GitHub archives put everything
# one folder down, and devices have unzip but no zip. So the zip is written here, using
# gzip for the deflate data and its trailer for the CRC32 and size.
le16() { printf "\\$(printf %o $(($1 & 255)))\\$(printf %o $((($1 >> 8) & 255)))"; }
le32() { le16 $(($1 & 65535)); le16 $((($1 >> 16) & 65535)); }
zip_dir() { # dir out
  src=$1; out=$2; cd_tmp="$out.cd"; : > "$out"; : > "$cd_tmp"; count=0
  ( cd "$src" && find . -type f | sed 's#^\./##' | LC_ALL=C sort ) > "$out.list" || return 1
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    gzip -c < "$src/$name" > "$out.gz" || return 1
    [ "$(head -c 4 "$out.gz" | tail -c 1 | od -An -tu1 | tr -d " ")" = 0 ] || { echo "gzip header has extra fields"; return 1; }
    glen=$(wc -c < "$out.gz"); clen=$((glen - 18)); nlen=${#name}
    tail -c 8 "$out.gz" > "$out.tr"
    off=$(wc -c < "$out")
    { printf 'PK\003\004'; le16 20; le16 0; le16 8; le16 0; le16 33
      head -c 4 "$out.tr"; le32 $clen; tail -c 4 "$out.tr"; le16 $nlen; le16 0
      printf '%s' "$name"; tail -c +11 "$out.gz" | head -c $clen; } >> "$out"
    { printf 'PK\001\002'; le16 20; le16 20; le16 0; le16 8; le16 0; le16 33
      head -c 4 "$out.tr"; le32 $clen; tail -c 4 "$out.tr"; le16 $nlen; le16 0; le16 0; le16 0; le16 0
      le32 0; le32 $off; printf '%s' "$name"; } >> "$cd_tmp"
    count=$((count + 1))
  done < "$out.list"
  cdoff=$(wc -c < "$out"); cdlen=$(wc -c < "$cd_tmp")
  cat "$cd_tmp" >> "$out"
  { printf 'PK\005\006'; le16 0; le16 0; le16 $count; le16 $count; le32 $cdlen; le32 $cdoff; le16 0; } >> "$out"
  rm -f "$cd_tmp" "$out.gz" "$out.tr" "$out.list"
  [ "$count" -gt 0 ]
}
repack() { # archive.zip out.zip
  w="$DL/.repack.$$"; rm -rf "$w"; mkdir -p "$w"
  if command -v unzip >/dev/null 2>&1; then unzip -q -o "$1" -d "$w" >/dev/null 2>&1
  elif [ -n "$BB" ]; then "$BB" unzip -q -o "$1" -d "$w" >/dev/null 2>&1; fi
  top=$(find "$w" -maxdepth 3 -name module.prop -type f 2>/dev/null | awk '{ print length($0) "\t" $0 }' | sort -n | head -n1 | cut -f2)
  [ -n "$top" ] || { rm -rf "$w"; echo "no module.prop in the archive"; return 1; }
  zip_dir "${top%/module.prop}" "$2"; r=$?
  rm -rf "$w"; return $r
}

job_log() { echo "$*" >> "$JOBS/$JID.log"; }
job_run() { # id url sha [zip|archive]
  JID=$1; url=$2; want=$3; mode=${4:-zip}; z="$DL/$1.zip"
  : > "$JOBS/$JID.log"; echo running > "$JOBS/$JID.status"
  if [ "$url" = local ]; then
    job_log "Using file downloaded by the WebUI"
  else
    job_log "Downloading $url"
    rm -f "$z" "$z.err"
    if ! fetch_to "$url" "$z"; then
      job_log "Download failed: $(tail -c 300 "$z.err" 2>/dev/null)"
      echo nodl > "$JOBS/$JID.status"; return 1
    fi
  fi
  [ -s "$z" ] || { job_log "Downloaded file is empty"; echo fail > "$JOBS/$JID.status"; return 1; }
  job_log "Size: $(wc -c < "$z") bytes"
  got=$(sha_of "$z")
  job_log "sha256: $got"
  if [ "$want" != "-" ]; then
    if [ "$got" != "$want" ]; then
      job_log "sha256 MISMATCH, expected $want. Install aborted."
      rm -f "$z"; echo fail > "$JOBS/$JID.status"; return 1
    fi
    job_log "sha256 verified against the registry"
  else
    job_log "No registry checksum for this file, installing unverified"
  fi
  if [ "$mode" = archive ]; then
    job_log "Source archive: rebuilding it as a flashable zip"
    if ! out=$(repack "$z" "$z.flash" 2>&1); then
      job_log "Repack failed: $out"; rm -f "$z" "$z.flash"; echo fail > "$JOBS/$JID.status"; return 1
    fi
    mv -f "$z.flash" "$z"; job_log "Rebuilt zip: $(wc -c < "$z") bytes"
  fi
  job_log "Installing with $(installer)..."
  if mgr_install "$z" >> "$JOBS/$JID.log" 2>&1; then
    job_log "Done. Reboot to activate."
    echo ok > "$JOBS/$JID.status"; rm -f "$z"
  else
    job_log "Installer reported an error."
    echo fail > "$JOBS/$JID.status"; rm -f "$z"; return 1
  fi
}

check_updates() {
  base=$(head -n1 "$SOURCES"); valid_url "$base" || base="https://modules.kernelsu.org/"
  f="$CACHE/check.json"
  if ! fetch_to "${base%/}/api/v1/modules.json" "$f"; then echo "Could not reach $base"; return 1; fi
  inst=$(installed_json)
  echo "ORBIT // STORE update check"
  echo "Source: $base"
  echo " "
  n=0
  # registry entries: id + stable versionCode
  awk '{ s = s $0 } END {
    n = split(s, a, /"id"[ ]*:[ ]*"/)
    for (i = 2; i <= n; i++) {
      id = substr(a[i], 1, index(a[i], "\"") - 1); r = a[i]; p = index(r, "\"stable\""); if (!p) continue
      r = substr(r, p); if (match(r, /"versionCode"[ ]*:[ ]*[0-9]+/)) { v = substr(r, RSTART, RLENGTH); gsub(/[^0-9]/, "", v); print id, v }
    } }' "$f" > "$CACHE/reg.txt"
  echo "$inst" | awk '{ n = split($0, a, /\},\{/); for (i = 1; i <= n; i++) if (match(a[i], /"id":"[^"]*"/)) {
      id = substr(a[i], RSTART + 6, RLENGTH - 7); vc = 0; v = ""
      if (match(a[i], /"versionCode":[0-9]+/)) vc = substr(a[i], RSTART + 14, RLENGTH - 14)
      if (match(a[i], /"version":"[^"]*"/)) v = substr(a[i], RSTART + 11, RLENGTH - 12)
      print id, vc, v } }' | while read -r id vc v; do
    rv=$(awk -v i="$id" '$1 == i {print $2}' "$CACHE/reg.txt")
    [ -n "$rv" ] || continue
    if [ "$rv" -gt "$vc" ]; then echo "UPDATE  $id  ($v -> versionCode $rv)"; else echo "ok      $id  ($v)"; fi
  done
  echo " "
  echo "Open the WebUI to install updates."
}

cmd_=$1; [ $# -gt 0 ] && shift
case "$cmd_" in
  tools) tools_json ;;
  get) get_url "$1" ;;
  installed) installed_json ;;
  sources) cat "$SOURCES" ;;
  setsources)
    printf '%s' "$1" | base64 -d 2>/dev/null | tr -d '\r' | while read -r u; do valid_url "$u" && echo "$u"; done > "$SOURCES.tmp"
    [ -s "$SOURCES.tmp" ] || echo "https://modules.kernelsu.org/" > "$SOURCES.tmp"
    mv "$SOURCES.tmp" "$SOURCES"; echo '{"ok":true}' ;;
  install) # id url|local sha|- [zip|archive]
    valid_id "$1" && valid_sha "$3" && { [ "$2" = local ] || valid_url "$2"; } || { echo '{"ok":false,"error":"invalid arguments"}'; exit 1; }
    mode=${4:-zip}; case "$mode" in zip|archive) ;; *) echo '{"ok":false,"error":"invalid mode"}'; exit 1 ;; esac
    if [ "$(cat "$JOBS/$1.status" 2>/dev/null)" = running ]; then echo '{"ok":false,"error":"already running"}'; exit 1; fi
    echo running > "$JOBS/$1.status"; : > "$JOBS/$1.log"
    if command -v setsid >/dev/null 2>&1; then setsid sh "$0" _job "$1" "$2" "$3" "$mode" >/dev/null 2>&1 < /dev/null &
    else nohup sh "$0" _job "$1" "$2" "$3" "$mode" >/dev/null 2>&1 < /dev/null & fi
    echo '{"ok":true}' ;;
  _job) job_run "$1" "$2" "$3" "$4" ;;
  job) valid_id "$1" || exit 1
    printf '{"status":"%s","log":"' "$(cat "$JOBS/$1.status" 2>/dev/null || echo none)"
    tail -n 60 "$JOBS/$1.log" 2>/dev/null | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr -d '\r' | awk '{printf "%s\\n", $0}'
    printf '"}\n' ;;
  chunk) # id index base64  (WebView download fallback)
    valid_id "$1" || exit 1
    [ "$2" = 0 ] && rm -f "$DL/$1.zip"
    printf '%s' "$3" | base64 -d >> "$DL/$1.zip" && echo '{"ok":true}' || echo '{"ok":false}' ;;
  open) valid_url "$1" && am start -a android.intent.action.VIEW -d "$1" >/dev/null 2>&1; echo '{"ok":true}' ;;
  reboot) svc power reboot 2>/dev/null || reboot ;;
  check) check_updates ;;
  *) echo "ORBIT // STORE"; echo "commands: tools get installed sources setsources install job chunk open reboot check" ;;
esac
