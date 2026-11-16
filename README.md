# Bloom 🌼: wellness & health tracker

Habits, food, sleep, water, mood, steps, workouts and weight, plus a flower that flourishes when you keep your routine
and wilts when you don't. Plain HTML/CSS/JS ES modules, no build step. Firebase Auth + Firestore for accounts and sync.

## Features
- **Accounts**: email/password sign-up and sign-in, Google sign-in, and password reset by email. Every user's data is private (see `firestore.rules`).
- **Today**: daily, weekly and monthly habits (check off, at least N, less than N), with streak dots and the flower.
  Habits can be **auto-tracked** from your logs: calories, protein, meals logged, water, sleep, steps, workouts, active minutes and weigh-ins.
  Calorie, protein, water, sleep and step habits can follow your Settings targets automatically.
- **Food**: take a photo and describe the meal, then get an **editable estimate** of calories, protein, carbs, fat and fiber.
  - No AI. A built-in list of about 230 foods and restaurant dishes, plus a parser for quantities and units ("2 slices", "6oz", "1 1/2 cups", "large", "half a…").
  - Portion buttons (Light / Normal / Hearty / Big) let you scale the estimate by looking at your photo.
  - Unrecognized words are flagged so you can add them manually. You can also search and add foods, re-log recent meals, and save favorite meals and foods.
  - Photos are compressed in the browser (about 50 KB) and stored in Firestore. **No Cloud Storage or Blaze plan is needed.**
- **Health**: weight (with BMI and weekly change), sleep hours and quality, water, mood and energy, steps,
  workouts (MET-based calorie estimate, editable), body fat, waist, resting heart rate, and a journal.
- **Trends**: 7, 30 or 90 days of stat tiles and charts for calories, weight, protein, sleep, steps, water, mood and energy, plus a habit success table.
- **Feed** (Strava-style): workouts you log post to your feed with time, calories, effort and your note (switch off
  *Share to my feed* to keep one private, or *Hide* any post). Finishing all your habits and streak milestones post too.
  Friends give 👏 kudos, and a weekly summary sits on top.
- **Friends**: everyone gets a friend code and an invite link. Friends see your flower, how many habits you've done today,
  your streak and (optionally) which habits you finished. Food, weight, photos, sleep and the journal are never shared.
  Send a friend a 💧 cheer; either person can remove the friendship.
- **Notifications**: a bell for friend requests, cheers, and friends finishing their day or hitting streaks, plus an optional
  daily reminder when habits are still left. Device notifications work while Bloom is open or running in the background;
  the free Spark plan has no server, so nothing can reach a fully closed app. On iPhone, add Bloom to the Home Screen first.
- **Settings**: sex, age, height, weight, activity and goal give suggested calories and macros (Mifflin–St Jeor). All targets are editable.
  Also: units (lb/kg), favorite foods, JSON backup export and import, and delete-all-data.
- Works as a home-screen app on phones (manifest included). Past days can be edited with the date arrows.

## Deploy (about 10 minutes)
1. Create a project at https://console.firebase.google.com (the free Spark plan is fine).
2. **Build → Authentication → Get started → Sign-in method**: enable **Email/Password** and **Google**.
3. **Build → Firestore Database → Create database** (production mode). Pick a region near you.
4. Deploy:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add            # pick your project (updates .firebaserc)
   firebase deploy               # hosting + firestore.rules
   ```
5. Open `https://<project-id>.web.app`, create an account, and add the site to your phone's home screen.

On Firebase Hosting the app reads your config from `/__/firebase/init.json`, so `firebase-config.js` can stay as-is.
If you use a custom domain, add it under **Authentication → Settings → Authorized domains** so Google sign-in works.

## Local testing
- `firebase emulators:start` or `firebase serve`, or any static server (`npx serve public`).
- Emulators: `firebase emulators:start --only auth,firestore,hosting --project demo-bloom`, then open
  `http://localhost:5050/?emu`. Use `127.0.0.1:5050/?emu` in a second tab to sign in as a second user.
- Without Firebase config, the app runs in **local mode** (no login; data saved in the browser). `?local` forces local mode.

## Data layout
```
profiles/{uid}              progress snapshot friends can read (name, flower, done/total today, streak, finished)
profiles/{uid}/posts/{id}   feed posts (workout or milestone) with a kudos map {friendUid: name}
profiles/{uid}/friends/{id} who may read it · profiles/{uid}/inbox/{id} cheers and "request accepted" notes
codes/{CODE}                friend code -> uid · requests/{from}_{to} pending friend requests
users/{uid}                 tasks, logs, settings, profile, goals, customFoods
users/{uid}/days/{date}     weight(kg), sleep, sleepQ, water, mood, energy, steps, workouts[], notes, bodyFat, waistCm, rhr
users/{uid}/meals/{id}      date, time, type, description, portion, items[{name, qty, unit, kcal, p, c, f, fiber}], hasPhoto
users/{uid}/photos/{mealId} { data: <jpeg data URL> }
```

## Code map (`public/js`)
`app.js` shell, auth screens and routing · `state.js` state, selectors and the goal calculator · `store.js` local and Firebase backends ·
`habits.js` Today tab and scoring · `food.js` Food tab and meal logger · `foodDb.js` food list · `foodParse.js` description parser ·
`health.js` Health tab and workouts · `trends.js` charts · `social.js` friends, bell and reminders · `settings.js` · `flower.js` mascot · `util.js`.

Estimates are approximate and not medical advice.
