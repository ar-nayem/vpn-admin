#!/usr/bin/env bash
set -euo pipefail

app_dir="${VPN_ADMIN_APP_DIR:-/opt/vpn-admin}"
backup_root="${VPN_ADMIN_BACKUP_DIR:-/var/backups/vpn-admin}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${backup_root}/${stamp}"

install -d -m 700 "$destination"

if [[ -f "${app_dir}/private/storefront.db" ]]; then
  sqlite3 "${app_dir}/private/storefront.db" ".backup '${destination}/storefront.db'"
fi

for source in "${app_dir}/data" "${app_dir}/private/storefront"; do
  if [[ -e "$source" ]]; then
    cp -a "$source" "$destination/"
  fi
done

if [[ -f /etc/amnezia/amneziawg/awg0.conf ]]; then
  install -m 600 /etc/amnezia/amneziawg/awg0.conf "$destination/awg0.conf"
fi

printf '%s\n' "$destination"
