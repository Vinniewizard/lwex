# 📱 MariTech Android APK Build Guide

This project has been fully configured with **CapacitorJS** (the modern native wrapper framework for React/Vite) and holds a fully initialized Android project inside the `/android` directory. 

Because compiling an `.apk` file requires a heavy Android development environment (such as Java Development Kit, Android Native SDK Tools, and Gradle), you should compile the binary on your local machine using this plug-and-play setup.

---

## 🚀 Quick Local Compilation (3 Steps)

### Step 1: Export the Project
1. Open the **Settings Menu** in the top-right of the AI Studio interface.
2. Click **Export ZIP** (or export to your GitHub repository).
3. Extract the ZIP folder on your local computer.

### Step 2: Install Local Prerequisites
Ensure you have the following installed on your machine:
* **Node.js** (v18 or higher)
* **Android Studio** (which automatically installs the Android SDK, Gradle, and Emulator tools)

### Step 3: Run the One-Click Build Commands
Open your computer's terminal inside the project's root folder and run:

```bash
# 1. Install workspace dependencies
npm install

# 2. Build the production assets
npm run build

# 3. Synchronize Web assets with the native Android layer
npx cap sync

# 4. Open the project inside Android Studio for instant build
npx cap open android
```

Once Android Studio opens:
1. Wait a moment for Gradle to index the project (you'll see a progress bar at the bottom right).
2. Go to the top menu bar and select: **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
3. Upon completion, a pop-up in Android Studio will say *"APK(s) generated successfully"* with a **"Locate"** link. Click it to find your installable `app-debug.apk` file!

---

## 🌍 Configuring Your Production Server URL

We have pre-configured the Android app in `capacitor.config.ts` using **Server-Portal Mode**.

This allows the APK to route sessions, database operations, and cashier transactions seamlessly by loading directly from your live server:

```typescript
server: {
  androidScheme: 'https',
  url: 'https://ais-pre-wckffqlqyxp2fbdy72pdco-883535415774.europe-west2.run.app', // Your live production App URL!
}
```

If you deploy your app to a custom domain, simply open `/capacitor.config.ts` and set `url` to your new domain, then re-run:
```bash
npx cap sync
```

---

## 🛠️ Testing on a Live Device / Emulator

If you want to run the app on your computer's emulator or a physical Android phone connected via USB:
1. Make sure **USB Debugging** is turned on in your phone's Developer Settings.
2. Run:
   ```bash
   npx cap run android
   ```
3. Choose the target device to test live!
