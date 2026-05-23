# openmaheart

Encrypted GitHub Pages deployment for a private investment dashboard.

This public repository intentionally stores only encrypted dashboard source/state bundles and generic deployment scripts. The actual dashboard is decrypted inside GitHub Actions with the `DASHBOARD_PASSWORD` secret, rebuilt, encrypted again as a browser login payload, and deployed to GitHub Pages.

Public URL after deployment:

`https://galdermajay.github.io/openmaheart/`
