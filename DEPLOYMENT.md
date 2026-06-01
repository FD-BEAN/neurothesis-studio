# Deployment Notes

## Recommended Setup

Use GitHub Pages from the `main` branch root.

This project is a static site, so no build step is required.

## First Push

After creating an empty public GitHub repository named `neurothesis-studio`, run:

```powershell
cd C:\Python\neurothesis-studio
git remote add origin https://github.com/YOUR_USERNAME/neurothesis-studio.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

## Update Deployment Later

After editing files:

```powershell
cd C:\Python\neurothesis-studio
git add .
git commit -m "Update NeuroThesis Studio"
git push
```

GitHub Pages will redeploy automatically after each push.
