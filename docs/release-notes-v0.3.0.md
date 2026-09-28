中文用户请下载 DiskPilot-Lite-0.3.0-cn-win.zip · English users: download DiskPilot-Lite-0.3.0-en-win.zip

这一版新增了英文版，中文版用法和以前一样。

仍然只给建议，不会删除你的任何文件。

下载后先右键解压，再双击「一键扫描C盘.cmd」。

# DiskPilot Lite 0.3.0

- Separate Chinese and English Windows ZIPs, built from one source, with exactly one launcher each. The Chinese package keeps its existing filenames; all English package filenames are English.
- English scanner messages, prompts, cleanup guidance, and report filenames. Existing Chinese-app rules remain, with English names. No new Steam or Teams rules.
- Offline report language switch with visible 中文 / English text and localStorage preference. Imported data and selections survive switching. Saved reports remain standalone HTML under the same network-blocking CSP.
- English-primary README and a Chinese README, linked at the top; updated packaged instructions.
- Automated checks cover English strings and output for CJK, both archive manifests, matching rule patterns, consent, slow-mode heartbeat, language switching, import, save/reopen, and zero report network requests.

Safety is unchanged: suggestions only; never deletes user files. Only the scanner-generated temporary CSV (and its newly created, empty directory) is removed. WizTree is not bundled because its EULA forbids redistribution without a Distribution License. Its licence link appears before installation consent. English accepts Y/y; Chinese accepts Y/y/是; Enter alone declines. Administrator fallback, timing, and heartbeat behavior remain shared.

The required 中文 switch label and user-supplied filenames and paths are intentionally preserved in English mode. English product copy is otherwise free of Chinese characters.
