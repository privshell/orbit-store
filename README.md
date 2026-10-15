# ORBIT // STORE

A module store that lives inside your root manager. It merges several module catalogs into one Browse tab with Install and Update buttons, and adds a Lists tab with curated root apps and modules grouped by category.

Built because many managers still point at the old module repository, which is no longer available, so their built-in repo screens stay empty.

## Sources

### Catalogs (installable, in Browse)
| Catalog | What ORBIT installs | Checksum |
| --- | --- | --- |
| [KernelSU Modules](https://modules.kernelsu.org) (default, wins on ID collisions) | Release ZIP from the catalog | sha256 from the catalog, required to match |
| [KernelSU Next Modules Repo](https://github.com/KernelSU-Next/KernelSU-Next-Modules-Repo) | Latest GitHub release ZIP of each repository | GitHub asset digest when GitHub provides one |
| [Magisk Modules Alt Repo](https://github.com/Magisk-Modules-Alt-Repo) | Repository source archive, rebuilt on the device into a flashable ZIP | None published, ORBIT asks before installing |

Entries from the extra catalogs carry a source label (`KSU Next`, `Alt Repo`) and a tag you can filter on. Each extra catalog can be turned off in Settings.

### Curated lists (in Lists)
| List | Content |
| --- | --- |
| [Awesome Android Root](https://awesome-android-root.xyz/apps-and-modules/) ([repo](https://github.com/awesome-android-root/awesome-android-root)) | 16 categories of root apps and modules |
| [Awesome KernelSU](https://github.com/fynks/awesome-kernelsu) | KernelSU modules, tools and resources |
| [Essential root modules](https://gist.github.com/supermarsx/26a1ace8dd4fa9bb88c482e28d51de35) | A curated gist of root modules |

Lists are links curated by their maintainers. Each entry has Open, and GitHub entries also have Releases, which shows the repository's GitHub releases with an Install button.

## Features
- Browse, search, filter by tag or source and sort by recent, popular or name
- One-tap install and update, any listed version, pre-releases when enabled
- Installed tab with update badges and Update all (KernelSU catalog and Alt Repo modules)
- Warnings before installing: metamodule conflicts (two metamodules usually bootloop), Android version and CPU architecture
- Featured tab for one author
- Extra KernelSU Modules API sources (`api/v1/modules.json`)
- Action button: checks your installed modules for updates

## Compatibility
| Root | Installer used |
| --- | --- |
| KernelSU, KernelSU Next, SukiSU, ReSukiSU | `ksud module install` |
| APatch | `apd module install` |
| Magisk | `magisk --install-module` |

The WebUI needs a manager that supports module WebUIs (KernelSU and its forks, APatch, or a WebUI app on Magisk).

Downloads use curl or busybox wget. If neither can reach GitHub, ORBIT downloads through the WebView instead, then verifies the checksum the same way. Alt Repo installs need `gzip` and `unzip` on the device (both ship with Android toybox).

## Limits
- GitHub allows 60 anonymous API calls per hour. KSU Next entries and list Releases use the API only when you open or install one.
- KSU Next and list entries do not declare a module ID, so ORBIT only links them to an installed module when the names match. Update checks for them are not available.
- Alt Repo modules install from the default branch source, not from a tagged release.

## Security
- Only `https` URLs are accepted, and module IDs are validated before they reach the shell
- When a source publishes a sha256 it must match the downloaded ZIP, otherwise the install is aborted
- Installs without a checksum always ask first
- Catalog and list text is always rendered as plain text, never as HTML

No catalog or list audits module code. Install only modules you trust.

## Files
- `/data/adb/orbit/sources.txt` KernelSU API sources, one URL per line
- `/data/adb/orbit/jobs` install logs

## Development
`node tests/sources.test.js` runs the parser tests for the extra catalogs and lists.

## Support
ORBIT is free and open source, built in spare time. If it saved you time, you can [support the work with a small crypto donation](https://github.com/kreza6173-pixel/kreza6173-pixel/blob/main/DONATE.md) (USDT on TRC20, or USDC / SOL on Solana). Starring the repo or opening a clear issue helps just as much.

## License
MIT
