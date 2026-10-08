# Publishing Noesis to the App Store and Google Play

The phone apps are the same web app wrapped with [Capacitor](https://capacitorjs.com). The wrapper
is set up in `capacitor.config.ts`. Native projects are made on your own computer, because they need
Xcode (Mac only, for iPhone and iPad) and Android Studio.

## What you need first

| Store | Account | Cost |
| --- | --- | --- |
| Apple App Store | Apple Developer Program | $99 a year |
| Google Play | Google Play Console | $25 once |

## First build

```bash
npm install
npm run build
npx cap add ios        # Mac with Xcode only
npx cap add android
npm run cap:sync       # builds the web app and copies it into both native projects
npm run cap:ios        # opens Xcode
npm run cap:android    # opens Android Studio
```

Run `npm run cap:sync` again after every change to the web app.

## What works as is

- Reading, notes, highlights, search, listen mode, themes, importing files through the file picker.
- Search, Noema and sync call `https://noesis.proairetos.com/api/...` (see `src/lib/nativeApi.ts`).

## Still to do before submitting

1. **Sign-in links.** Password reset and email confirmation links open the website, not the app.
   Add a universal link (iOS) and app link (Android) for `noesis.proairetos.com`, or tell people to finish
   those steps in the browser.
2. **Icons and splash screens.** Put a 1024x1024 `icon.png` and a 2732x2732 `splash.png` in `resources/`
   and run `npx @capacitor/assets generate`.
3. **Sharing into the app and opening files** ("Open with Noesis") need small native additions
   (a share extension on iPhone, an intent filter on Android).
4. **App Store review.** Apple asks for more than a website in a frame. Offline reading, file import,
   on-device search and highlights count, so describe them in the review notes.
5. **Privacy answers.** Use `public/privacy.html` as the basis for the store's privacy questions.
6. Set the version and build numbers in Xcode and in `android/app/build.gradle`.
