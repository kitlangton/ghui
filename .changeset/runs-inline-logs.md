---
"@kitlangton/ghui": minor
---

Add an inline log viewer to the runs view. Set `runLogView` to `"inline"` in `config.json` and `enter` on a job or step shows its log in the terminal (scroll with `j`/`k`, `ctrl-d`/`ctrl-u`, `ctrl-f`/`ctrl-b`, `gg`/`G`, or the mouse wheel; `o` opens the job in the browser; `esc` goes back). The default is unchanged: `enter` opens the job on GitHub. `ctrl-f`/`ctrl-b` also page the runs and steps lists.
