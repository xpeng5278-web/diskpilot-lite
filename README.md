# DiskPilot Lite · C: space report
中文用户请下载 DiskPilot-Lite-0.3.0-cn-win.zip · English users: download DiskPilot-Lite-0.3.0-en-win.zip

[简体中文](README.zh-CN.md)

Get a readable disk-space report with one double-click. **Suggestions only: DiskPilot Lite never deletes or moves your files.** Reports are processed locally, without uploads.

![Sample report with fictional data](docs/images/report-demo.png)

## Getting started

1. Download `DiskPilot-Lite-0.3.0-en-win.zip` from [Releases](https://github.com/xpeng5278-web/diskpilot-lite/releases/latest).
2. Right-click the ZIP and choose **Extract All**. Open the extracted folder.
3. Double-click **Scan-C-Drive.cmd**. A fast scan usually takes about 1–2 minutes, then the report opens in your browser.

The English package contains exactly `Scan-C-Drive.cmd`, `diskpilot-lite.ps1`, `View-Sample-or-Import-CSV.html`, and `README.txt`. The Chinese package contains `一键扫描C盘.cmd`, `diskpilot-lite.ps1`, `看示例或导入CSV.html`, and `使用说明.txt`. Each package has one launcher.

## Prompts you may see

| Prompt | What it means |
| --- | --- |
| Windows protected your PC (SmartScreen) | This small project is unsigned. If you trust the downloaded source, use More info > Run anyway. |
| Install WizTree? | Read the licence notice. Only **Y/y then Enter** installs it through winget; Enter alone or any other answer declines. The Chinese package also accepts 是. The download is approximately 5–8 MB. |
| Allow this app to make changes to your device? | Yes enables the fast administrator scan. No switches to slow mode, which may take more than 10 minutes. Keep the window open; periodic heartbeat messages confirm it is still running. |

WizTree is by Antibody Software and is free for personal use. It is **not bundled**: its [EULA](https://diskanalyzer.com/eula) forbids redistribution without a [Distribution License](https://diskanalyzer.com/distribution-license). Installation requires explicit consent after the licence link is displayed.

If winget is unavailable or you decline installation, [install WizTree yourself](https://diskanalyzer.com/download), or open **View-Sample-or-Import-CSV.html**. In WizTree select C: > Scan > Ctrl+Alt+E, save the CSV to D: or USB, and drag it into the report.

## Reading and saving a report

- Suggestions are grouped by risk. Checkboxes plan cleanup; they never execute it.
- Sizes are upper bounds for the folders involved. Overlapping folders are counted once; not everything can be removed.
- Instructions use Windows names such as Settings > System > Storage > Temporary files. You can also use Storage Sense or Disk Cleanup. Do not manually delete Windows, Program Files, or WinSxS.
- Existing WeChat, QQ, WeCom, DingTalk, Feishu (Lark), and NetEase Cloud Music rules remain available in both languages. No Steam or Teams rules are added in this release.
- The visible **中文 / English** button at the top right switches language. Your browser remembers the choice in localStorage when available; otherwise the package language is used. Imports and selections survive switching.
- **Save this report** downloads `DiskPilot-Report-YYYY-MM-DD.html` in English mode. Press Ctrl+J to open browser downloads. Scanner-generated English reports use `C-Drive-Report-<time>.html`.
- Saved reports retain selections and work offline as a single HTML file. The CSP blocks network requests. The Chinese switch label is the intentional exception to English-only interface text; actual user paths and filenames are always preserved.

The scanner uses approximately 50–200 MB for its temporary CSV, preferably on D: and otherwise in the temporary directory. It prints the full path and deletes **only its own generated CSV**, plus its newly created temporary folder if empty. An interrupted scan may leave the CSV for manual review. No user files are cleaned by the tool. Reports contain folder paths; consider that before sharing.

Apart from the explicitly accepted winget installation, processing is local with no network or uploads. Windows is required for scanning; modern browsers can view the offline report. Product users do not need Node.js.

## Development

Node.js 20+ is required for building and testing:

```sh
npm test
npm run build
```

The build produces both `dist/DiskPilot-Lite-0.3.0-cn-win.zip` and `dist/DiskPilot-Lite-0.3.0-en-win.zip` from shared source. Extracted files are in `build/cn` and `build/en`.

`src/core.js` parses and aggregates CSV, `src/rules.js` defines cleanup suggestions, `src/app.js` renders the report, and `src/diskpilot-lite.ps1` implements the Windows flow (PowerShell 5.1 compatible). Reviewed English copy is in `src/locales/en.json`; `scripts/localize.js` fails the build on untranslated text. `src/locale.js` switches the shared report modules offline.

The scanner uses `WizTree64.exe C: /export="<temporary CSV>" /admin=1 /exportfiles=0`, elevated with `Start-Process -Verb RunAs`; declining elevation uses `/admin=0`. It waits for process exit and a stable CSV before generating the report. See the [WizTree command-line documentation](https://diskanalyzer.com/guide#csvexport).

Installation command: `winget install --id AntibodySoftware.WizTree -e --source winget --accept-package-agreements --accept-source-agreements --silent`.

## Licence

MIT © xpeng5278-web. WizTree is a product of Antibody Software Limited and is not affiliated with this project.
