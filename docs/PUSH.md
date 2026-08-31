# Pushing updates to GitHub

Repo: **https://github.com/g8tsz/Marker-TITO-replacement**

```powershell
git add .
node scripts/commit-clean.js "feat: your message"
git push origin master
```

Use **`C:\Program Files\Git\bin\git.exe`** — not Cursor’s commit if it adds `Co-authored-by: Cursor`. See [CONTRIBUTING.md](CONTRIBUTING.md).

SSH remote:

```bash
git remote set-url origin git@github.com:g8tsz/Marker-TITO-replacement.git
```
